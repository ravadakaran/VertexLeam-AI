import type { Request, Response, NextFunction } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { limit, cacheGet, cacheSet } from '../../cache.ts'
import { observeAiOutcome } from '../../utils/metrics.ts'
import { courseScope, tutorCourseScope, lectureScope, moduleScope, text, keySchema, replay, invalid, conflict } from '../learning/scope.ts'
import type { Profile } from '../../types.ts'
import { recordActivity } from '../gamification/routes.ts'
import { recordMasteryEvidence } from '../personalization/routes.ts'

export const ai = Router()
const student=[authenticate,requireRole('student')],member=[authenticate,requireRole('student','instructor')]
const chatIpLimit=async(req:Request,res:Response,next:NextFunction)=>{
  await limit(res,'ai-chat-ip',req.ip??req.socket.remoteAddress??'unknown',120)
  next()
}
const chatLimit=async(req:Request,res:Response,next:NextFunction)=>{
  await limit(res,'ai-chat-ip',req.ip??req.socket.remoteAddress??'unknown',120)
  await limit(res,'ai-chat',req.user!.id,20)
  next()
}
const aiJobsLimit=async(req:Request,res:Response,next:NextFunction)=>{
  await limit(res,'ai-jobs',req.user!.id,30)
  next()
}
const unavailable=()=>{observeAiOutcome('unavailable');return new HttpError(503,'AI_UNAVAILABLE','AI provider is not configured')}
const messageBody=z.strictObject({message:text(4000),request_id:uuid})
const tutorMasteryBody=z.strictObject({topic_id:uuid,understood:z.boolean()})
const modeBody=z.strictObject({mode:z.enum(['beginner','intermediate','advanced'])})
const sessionBody=z.strictObject({course_id:uuid})
const sessionQuery=z.strictObject({course_id:uuid})
const ingestBody=z.strictObject({content:z.string().max(1000000).default(''),segments:z.array(z.strictObject({start_seconds:z.int().nonnegative(),end_seconds:z.int().positive(),text:text(12000)})).max(20000).default([])})
function wordChunks(content:string,limit=380,overlap=55){
  const words=content.trim().split(/\s+/).filter(Boolean),chunks:string[]=[]
  for(let start=0;start<words.length;){const end=Math.min(words.length,start+limit);chunks.push(words.slice(start,end).join(' '));if(end===words.length)break;start=end-overlap}
  return chunks
}
const serviceToken=(user:Profile,courseId:string)=>{
  const secret=process.env.AI_SERVICE_TOKEN
  if(!secret||!process.env.AI_SERVICE_URL||process.env.AI_OUTBOUND_DATA_APPROVED!=='true')throw unavailable()
  return {authorization:`Bearer ${jwt.sign({sub:user.id,course_id:courseId},secret,{expiresIn:60,audience:'vertexlearn-ai-service',issuer:'vertexlearn-core'})}`,actor_id:user.id,course_id:courseId}
}
async function callAi(path:string,token:ReturnType<typeof serviceToken>,payload:unknown){
  const origin=process.env.AI_SERVICE_URL
  if(!origin)throw unavailable()
  let response:globalThis.Response
  try{response=await fetch(new URL(path,origin),{method:'POST',headers:{'content-type':'application/json',authorization:token.authorization},body:JSON.stringify({payload,actor_id:token.actor_id,course_id:token.course_id}),signal:AbortSignal.timeout(15000)})}
  catch{observeAiOutcome('unavailable');throw new HttpError(503,'AI_UNAVAILABLE','AI provider is temporarily unavailable')}
  if(!response.ok){observeAiOutcome('unavailable');throw new HttpError(503,'AI_UNAVAILABLE','AI provider is temporarily unavailable')}
  observeAiOutcome('ok')
  return response.json() as Promise<any>
}
ai.get('/ai/health',async(_req,res)=>{
  const ok=Boolean(process.env.AI_SERVICE_URL&&process.env.AI_SERVICE_TOKEN&&process.env.AI_OUTBOUND_DATA_APPROVED==='true')
  res.status(ok?200:503).json({status:ok?'configured':'unavailable'})
})
ai.post('/ai/chat/sessions',...member,chatLimit,async(req,res)=>{
  const body=parse(sessionBody,req.body),requestKey=parse(keySchema,req.get('Idempotency-Key'))
  const result=await transaction(async client=>{
    await tutorCourseScope(client,req.user!,body.course_id)
    serviceToken(req.user!,body.course_id)
    const {rows:[mastery]}=await client.query(`SELECT avg(m.score)::float score FROM learner_mastery m JOIN learning_topics t ON t.id=m.topic_id
      WHERE m.user_id=$1 AND t.course_id=$2`,[req.user!.id,body.course_id])
    const mode=mastery.score===null?'intermediate':mastery.score<0.4?'beginner':mastery.score<0.75?'intermediate':'advanced'
    return replay(client,req.user!.id,'ai-session:'+body.course_id,requestKey,body,async()=>{
      const {rows:[session]}=await client.query('INSERT INTO ai_chat_sessions(user_id,course_id,mode) VALUES($1,$2,$3) RETURNING id,course_id,mode,created_at',[req.user!.id,body.course_id,mode])
      return session
    })
  })
  res.status(201).set('Cache-Control','private, no-store').json(result)
})
ai.get('/ai/chat/sessions',...member,chatIpLimit,async(req,res)=>{
  const {course_id:courseId}=parse(sessionQuery,req.query)
  await tutorCourseScope(db,req.user!,courseId)
  const {rows}=await db.query(`SELECT s.id,s.course_id,s.mode,s.created_at,
    (SELECT content FROM ai_chat_messages m WHERE m.session_id=s.id AND m.role='user' ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last_question
    FROM ai_chat_sessions s WHERE s.user_id=$1 AND s.course_id=$2 ORDER BY s.created_at DESC,s.id DESC LIMIT 30`,[req.user!.id,courseId])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
ai.put('/ai/chat/sessions/:id/mode',...member,chatIpLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id),body=parse(modeBody,req.body)
  const session=await transaction(async client=>{
    const {rows:[existing]}=await client.query('SELECT id,course_id FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[id,req.user!.id])
    if(!existing)throw new HttpError(404,'NOT_FOUND','Chat session not found')
    await tutorCourseScope(client,req.user!,existing.course_id)
    const {rows:[updated]}=await client.query(`UPDATE ai_chat_sessions SET mode=$3 WHERE id=$1 AND user_id=$2 RETURNING id,course_id,mode`,[id,req.user!.id,body.mode])
    return updated
  })
  res.set('Cache-Control','private, no-store').json(session)
})
ai.get('/ai/chat/sessions/:id/messages',...member,chatIpLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const {rows:[session]}=await db.query('SELECT id,course_id FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[id,req.user!.id])
  if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
  await tutorCourseScope(db,req.user!,session.course_id)
  const {rows}=await db.query(`SELECT request_id,role,content,sources,created_at FROM ai_chat_messages WHERE session_id=$1
    ORDER BY created_at,request_id,CASE role WHEN 'user' THEN 0 ELSE 1 END`,[id])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
ai.post('/ai/chat/sessions/:id/messages',...member,chatLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id),body=parse(messageBody,req.body),request={request_id:body.request_id}
  const result=await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([id,request.request_id])])
    const {rows:[session]}=await client.query('SELECT id,user_id,course_id,mode FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[id,req.user!.id])
    if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
    const scope=await tutorCourseScope(client,req.user!,session.course_id)
    const prior=await client.query<{role:string;content:string;sources:unknown}>('SELECT role,content,sources FROM ai_chat_messages WHERE session_id=$1 AND request_id=$2',[id,request.request_id])
    const priorUser=prior.rows.find(row=>row.role==='user')
    const priorAssistant=prior.rows.find(row=>row.role==='assistant')
    if(priorUser&&priorUser.content!==body.message)throw conflict('Request ID was already used for a different message')
    if(priorAssistant)return {reply:priorAssistant.content,sources:priorAssistant.sources,mode:session.mode,request_id:body.request_id}
    const token=serviceToken(req.user!,session.course_id)
    const {rows:recentMessages}=await client.query<{role:'user'|'assistant';content:string}>(
      `SELECT role,content FROM ai_chat_messages WHERE session_id=$1
       ORDER BY created_at DESC,request_id DESC,CASE role WHEN 'assistant' THEN 0 ELSE 1 END LIMIT 10`,[id])
    const history=recentMessages.reverse().map(message=>({role:message.role,content:message.content}))
    const provider=await callAi('/v1/chat',token,{question:body.message,mode:session.mode,history})
    if(typeof provider.reply!=='string'||provider.reply.length>8000||!Array.isArray(provider.sources))throw unavailable()
  const sourceList=z.array(z.strictObject({chunk_id:uuid})).max(6).safeParse(provider.sources)
  if(!sourceList.success)throw unavailable()
  const sourceIds=sourceList.data.map(s=>s.chunk_id)
    const sources=sourceIds.length?await client.query(`SELECT DISTINCT ON(c.id) c.lecture_id,l.title lecture_title,c.start_seconds timestamp_seconds,
      c.page_number,c.source_name,c.id chunk_id
      FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id AND g.status='active' JOIN lectures l ON l.id=c.lecture_id
      WHERE c.course_id=$1 AND c.id=ANY($2::uuid[])`,[session.course_id,sourceIds]):{rows:[]}
    if(sources.rows.length!==sourceIds.length)throw unavailable()
    const output=sources.rows.map(({chunk_id,...source})=>source)
    await client.query('INSERT INTO ai_chat_messages(session_id,request_id,role,content) VALUES($1,$2,\'user\',$3) ON CONFLICT DO NOTHING',[id,request.request_id,body.message])
    await client.query('INSERT INTO ai_chat_messages(session_id,request_id,role,content,sources) VALUES($1,$2,\'assistant\',$3,$4) ON CONFLICT DO NOTHING',[id,request.request_id,provider.reply,JSON.stringify(output)])
    if(!scope.is_reviewer)await recordActivity(req.user!.id,client)
    return {reply:provider.reply,sources:output,mode:session.mode,request_id:body.request_id}
  })
  res.set('Cache-Control','private, no-store').json(result)
})

ai.post('/ai/chat/sessions/:id/messages/:requestId/mastery',...student,chatIpLimit,async(req,res)=>{
  const sessionId=parse(uuid,req.params.id),requestId=parse(uuid,req.params.requestId),body=parse(tutorMasteryBody,req.body)
  const result=await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${req.user!.id}:tutor:${requestId}`])
    const {rows:[session]}=await client.query('SELECT id,course_id FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[sessionId,req.user!.id])
    if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
    await tutorCourseScope(client,req.user!,session.course_id)
    const {rowCount}=await client.query("SELECT 1 FROM ai_chat_messages WHERE session_id=$1 AND request_id=$2 AND role='assistant'",[sessionId,requestId])
    if(!rowCount)throw new HttpError(404,'NOT_FOUND','Tutor response not found')
    const {rows:[topic]}=await client.query('SELECT id FROM learning_topics WHERE id=$1 AND course_id=$2',[body.topic_id,session.course_id])
    if(!topic)throw invalid('Topic must belong to this course')
    const evidenceId='tutor:'+requestId
    const {rows:[existing]}=await client.query('SELECT topic_id,score::float score FROM mastery_events WHERE user_id=$1 AND evidence_id=$2 AND evidence_kind=\'tutor_self_assessment\'',[req.user!.id,evidenceId])
    const score=body.understood?1:0
    if(existing&&(existing.topic_id!==body.topic_id||Number(existing.score)!==score))throw conflict('Tutor feedback was already recorded for a different response')
    if(existing){
      const {rows:[current]}=await client.query('SELECT topic_id,score::float score,confidence::float confidence,updated_at FROM learner_mastery WHERE user_id=$1 AND topic_id=$2',[req.user!.id,body.topic_id])
      return current
    }
    return recordMasteryEvidence(client,req.user!.id,body.topic_id,evidenceId,score,'tutor_self_assessment')
  })
  res.set('Cache-Control','private, no-store').json(result)
})

ai.post('/ai/lectures/:id/ingest',authenticate,requireRole('instructor','admin'),aiJobsLimit,async(req,res)=>{
  const lectureId=parse(uuid,req.params.id),body=parse(ingestBody,req.body)
  const source=await transaction(async client=>{
    const lecture=await lectureScope(client,req.user!,lectureId,'author')
    if(body.segments.some(segment=>segment.start_seconds>=segment.end_seconds||segment.end_seconds>lecture.duration_seconds))throw invalid('Transcript segment is outside the lecture duration')
    const {rows:assets}=await client.query(`SELECT id,name FROM lecture_assets WHERE lecture_id=$1 AND (resource OR name='captions.vtt') ORDER BY name,id`,[lectureId])
    return {lecture,assets}
  })
  const extracted=source.assets.length?await callAi('/v1/extract',serviceToken(req.user!,source.lecture.course_id),{
    lecture_id:lectureId,resource_ids:source.assets.map((asset:any)=>asset.id)
  }):{documents:[]}
  if(!Array.isArray(extracted.documents))throw unavailable()
  const docs=[
    ...(body.segments.length?body.segments.map(segment=>({...segment,page_number:null,source_asset_id:null,source_name:'transcript'})):
      body.content.trim()?[{text:body.content,start_seconds:null,end_seconds:null,page_number:null,source_asset_id:null,source_name:'transcript'}]:[]),
    ...extracted.documents
  ]
  const chunks=docs.flatMap((document:any)=>wordChunks(String(document.text??'')).map(content=>({content,
    start_seconds:document.start_seconds??null,end_seconds:document.end_seconds??null,page_number:document.page_number??null,
    source_asset_id:document.source_asset_id??null,source_name:document.source_name??'transcript'})))
  if(!chunks.length)throw invalid('No readable transcript, captions, or document text was found')
  const sourceHash=createHash('sha256').update(JSON.stringify(docs)).digest('hex')
  const result=await transaction(async client=>{
    const lecture=await lectureScope(client,req.user!,lectureId,'author')
    if(lecture.course_id!==source.lecture.course_id)throw new HttpError(409,'CONFLICT','Lecture scope changed during ingestion')
    const hash=sourceHash
    const {rows:[gen]}=await client.query(`INSERT INTO ai_source_generations(lecture_id,generation,status,source_hash)
      SELECT $1,coalesce(max(generation),0)+1,'processing',$2 FROM ai_source_generations WHERE lecture_id=$1 RETURNING *`,[lectureId,hash])
    for(let i=0;i<chunks.length;i++){
      const c=chunks[i]
      await client.query(`INSERT INTO ai_chunks(generation_id,course_id,lecture_id,ordinal,content,start_seconds,end_seconds,page_number,source_asset_id,source_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[gen.id,lecture.course_id,lectureId,i,c.content,c.start_seconds,c.end_seconds,c.page_number,c.source_asset_id,c.source_name])
    }
    return { generation: gen, course_id: lecture.course_id }
  })
  try {
    await callAi('/v1/embed', serviceToken(req.user!, result.course_id), { generation_id: result.generation.id })
    // Status remains 'processing' until POST /ai/jobs/:id/publish confirms non-null embeddings and activates the generation.
  } catch (error) {
    await db.query("UPDATE ai_source_generations SET status='failed',error='Embedding provider unavailable' WHERE id=$1", [result.generation.id])
    throw error
  }
  res.status(202).json({id:result.generation.id,status:result.generation.status,lecture_id:lectureId})
})

ai.post('/ai/jobs/:id/publish',authenticate,requireRole('instructor','admin'),aiJobsLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const result=await transaction(async client=>{
    const {rows:[row]}=await client.query(`SELECT g.*,m.course_id FROM ai_source_generations g JOIN lectures l ON l.id=g.lecture_id JOIN modules m ON m.id=l.module_id WHERE g.id=$1 FOR UPDATE`,[id])
    if(!row)throw new HttpError(404,'NOT_FOUND','Ingestion generation not found')
    await courseScope(client,req.user!,row.course_id,'author')
    const {rowCount}=await client.query('SELECT 1 FROM ai_chunks WHERE generation_id=$1 AND embedding IS NULL LIMIT 1',[id])
    if(rowCount)throw new HttpError(409,'CONFLICT','Generation embeddings are incomplete')
    await client.query("UPDATE ai_source_generations SET status='superseded' WHERE lecture_id=$1 AND status='active'",[row.lecture_id])
    const updated=await client.query("UPDATE ai_source_generations SET status='active' WHERE id=$1 AND status='processing' RETURNING id,status",[id])
    if(!updated.rowCount)throw new HttpError(409,'CONFLICT','Generation is not processing')
    return updated.rows[0]
  })
  res.json(result)
})

ai.get('/ai/jobs/:id',authenticate,requireRole('student','instructor','admin'),async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const {rows:[row]}=await db.query(`SELECT g.id,g.status,g.error,g.lecture_id,m.course_id FROM ai_source_generations g JOIN lectures l ON l.id=g.lecture_id JOIN modules m ON m.id=l.module_id WHERE g.id=$1`,[id])
  if(!row)throw new HttpError(404,'NOT_FOUND','Job not found')
  await courseScope(db,req.user!,row.course_id,req.user!.roles.includes('student')?'learner':'author')
  res.set('Cache-Control','private, no-store').json(row)
})

ai.post('/ai/lectures/:id/summarize',...student,aiJobsLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const lecture=await lectureScope(db,req.user!,id,'learner'),token=serviceToken(req.user!,lecture.course_id)
  const {rows}=await db.query("SELECT c.id,c.content,c.start_seconds,c.page_number,c.source_name,l.id lecture_id,l.title lecture_title,g.id generation_id FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id JOIN lectures l ON l.id=c.lecture_id WHERE c.lecture_id=$1 AND g.status='active' ORDER BY c.ordinal",[id])
  if(!rows.length)throw unavailable()
  const cacheKey=`ai:summary:${id}:${rows[0].generation_id}`
  const cached=await cacheGet<{summary:string;sources:any[]}>(cacheKey)
  if(cached){
    res.set('Cache-Control','private, no-store').json(cached)
    return
  }
  const result=await callAi('/v1/summarize',token,{chunks:rows})
  if(typeof result.summary!=='string'||result.summary.length>10000||!Array.isArray(result.sources))throw unavailable()
  const sourceIds=result.sources.map((source:any)=>source.chunk_id)
  const sourceRows=rows.filter((row:any)=>sourceIds.includes(row.id))
  if(sourceRows.length!==new Set(sourceIds).size||!sourceRows.length)throw unavailable()
  let summary=result.summary
  for(const source of sourceRows)summary=summary.replaceAll(source.id,`${source.source_name??source.lecture_title}${source.page_number!==null?` p. ${source.page_number}`:source.start_seconds!==null?` at ${source.start_seconds}s`:''}`)
  const payload={summary,sources:sourceRows.map((source:any)=>({lecture_id:source.lecture_id,lecture_title:source.lecture_title,source_name:source.source_name,...(source.page_number!==null&&{page_number:source.page_number}),...(source.start_seconds!==null&&{timestamp_seconds:source.start_seconds})}))}
  await cacheSet(cacheKey,payload,86400)
  res.set('Cache-Control','private, no-store').json(payload)
})
ai.post('/ai/modules/:id/flashcards',...student,aiJobsLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id),scope=await moduleScope(db,req.user!,id,'learner'),token=serviceToken(req.user!,scope.id)
  const {rows:chunks}=await db.query("SELECT c.id,c.content FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id JOIN lectures l ON l.id=c.lecture_id WHERE c.course_id=$1 AND l.module_id=$2 AND g.status='active' ORDER BY l.order_index,c.ordinal LIMIT 80",[scope.id,id])
  if(!chunks.length)throw unavailable()
  const result=await callAi('/v1/flashcards',token,{chunks})
  if(!Array.isArray(result.items)||result.items.length>10||result.items.some((item:any)=>typeof item.question!=='string'||typeof item.answer!=='string'||item.question.length>1000||item.answer.length>2000))throw unavailable()
  const cards=result.items.map((item:any)=>({question:item.question,answer:item.answer,card_hash:createHash('sha256').update(item.question.trim().toLowerCase()+'\0'+item.answer.trim().toLowerCase()).digest('hex')}))
  const saved=await transaction(async client=>{
    for(const card of cards)await client.query(`INSERT INTO learner_flashcards(user_id,module_id,card_hash,question,answer,source_chunks)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,module_id,card_hash) DO NOTHING`,[req.user!.id,id,card.card_hash,card.question,card.answer,chunks.map((chunk:any)=>chunk.id)])
    const {rows}=await client.query(`SELECT id,question,answer,created_at,last_reviewed_at,next_review_at FROM learner_flashcards
      WHERE user_id=$1 AND module_id=$2 ORDER BY next_review_at,id LIMIT 100`,[req.user!.id,id])
    return rows
  })
  res.set('Cache-Control', 'private, no-store').json({items:saved})
})

ai.get('/users/me/flashcards',...student,async(req,res)=>{
  const courseId=req.query.course_id===undefined?undefined:parse(uuid,req.query.course_id)
  const {rows}=await db.query(`SELECT f.id,f.module_id,m.title module_title,c.id course_id,c.title course_title,f.question,f.answer,
      f.created_at,f.last_reviewed_at,f.next_review_at
    FROM learner_flashcards f JOIN modules m ON m.id=f.module_id JOIN courses c ON c.id=m.course_id
    JOIN enrollments e ON e.course_id=c.id AND e.user_id=f.user_id AND c.status='approved'
    WHERE f.user_id=$1 AND ($2::uuid IS NULL OR c.id=$2)
    ORDER BY f.next_review_at,f.created_at DESC,f.id LIMIT 200`,[req.user!.id,courseId??null])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
ai.post('/users/me/flashcards/:id/review',...student,async(req,res)=>{
  z.strictObject({}).parse(req.body)
  const cardId=parse(uuid,req.params.id)
  const {rows:[card]}=await db.query(`UPDATE learner_flashcards f SET last_reviewed_at=now(),review_count=review_count+1,
    next_review_at=now()+CASE WHEN review_count=0 THEN interval '1 day' WHEN review_count=1 THEN interval '3 days'
      WHEN review_count=2 THEN interval '7 days' ELSE interval '14 days' END
    FROM modules m JOIN courses c ON c.id=m.course_id AND c.status='approved' JOIN enrollments e ON e.course_id=m.course_id AND e.user_id=$1
    WHERE f.id=$2 AND f.user_id=$1 AND m.id=f.module_id
    RETURNING f.id,f.review_count,f.last_reviewed_at,f.next_review_at`,[req.user!.id,cardId])
  if(!card)throw new HttpError(404,'NOT_FOUND','Flashcard not found')
  res.set('Cache-Control','private,no-store').json(card)
})

ai.get('/users/me/ai-usage',...member,async(req,res)=>{
  const {rows:[usage]}=await db.query(`SELECT count(*)::int requests,coalesce(sum(input_tokens),0)::bigint input_tokens,
    coalesce(sum(output_tokens),0)::bigint output_tokens FROM ai_provider_usage
    WHERE actor_id=$1 AND recorded_at>=date_trunc('month',now())`,[req.user!.id])
  res.set('Cache-Control','private,no-store').json(usage)
})

ai.post('/ai/study-plan',...student,aiJobsLimit,async(req,res)=>{
  const {course_id:courseId}=z.strictObject({course_id:uuid}).parse(req.body)
  await courseScope(db,req.user!,courseId,'learner')
  const token=serviceToken(req.user!,courseId)
  let {rows:topics}=await db.query(`SELECT t.name,coalesce(m.score,0.5)::float mastery,coalesce(m.confidence,0)::float confidence
    FROM learning_topics t LEFT JOIN learner_mastery m ON m.topic_id=t.id AND m.user_id=$1
    WHERE t.course_id=$2 ORDER BY coalesce(m.score,0.5),t.name LIMIT 40`,[req.user!.id,courseId])
  if(!topics.length){
    const syllabus=await db.query(`SELECT title name,0.5::float mastery,0::float confidence FROM modules WHERE course_id=$1 ORDER BY order_index LIMIT 40`,[courseId])
    topics=syllabus.rows
  }
  if(!topics.length)throw invalid('Add course topics or modules before generating a study plan')
  const {rows:history}=await db.query(`SELECT t.name topic,e.score::float score FROM mastery_events e
    JOIN learning_topics t ON t.id=e.topic_id WHERE e.user_id=$1 AND t.course_id=$2
    ORDER BY e.accepted_at DESC,e.id DESC LIMIT 30`,[req.user!.id,courseId])
  const generated=await callAi('/v1/study-plan',token,{topics,quiz_history:history})
  const planSchema=z.strictObject({days:z.array(z.strictObject({day:z.number().int().min(1).max(7),steps:z.array(z.strictObject({
    topic:text(120),action:text(500),estimated_minutes:z.number().int().min(10).max(120)
  })).max(3)})).length(7)})
  const parsed=planSchema.safeParse(generated)
  const topicNames=new Set(topics.map((topic:any)=>String(topic.name)))
  if(!parsed.success||parsed.data.days.some((day,index)=>day.day!==index+1||day.steps.some(step=>!topicNames.has(step.topic))))throw unavailable()
  const generatedAt=new Date(),startDate=new Date(Date.UTC(generatedAt.getUTCFullYear(),generatedAt.getUTCMonth(),generatedAt.getUTCDate()))
  const days=parsed.data.days.map(day=>({day:day.day,scheduled_for:new Date(startDate.getTime()+(day.day-1)*86400000).toISOString().slice(0,10),steps:day.steps}))
  const result={generated_at:generatedAt.toISOString(),course_id:courseId,days,steps:days.flatMap(day=>day.steps.map(step=>({...step,day:day.day,scheduled_for:day.scheduled_for}))) }
  await db.query(`INSERT INTO learner_study_plans(user_id,course_id,plan,generated_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id,course_id) DO UPDATE SET plan=EXCLUDED.plan,generated_at=EXCLUDED.generated_at`,[req.user!.id,courseId,JSON.stringify(result),generatedAt])
  res.set('Cache-Control','private,no-store').json(result)
})

ai.post('/ai/modules/:id/quiz-draft',authenticate,requireRole('instructor','admin'),aiJobsLimit,async(req,res)=>{
  z.strictObject({}).parse(req.body)
  const moduleId=parse(uuid,req.params.id),requestKey=parse(keySchema,req.get('Idempotency-Key')),scope=await moduleScope(db,req.user!,moduleId,'author'),token=serviceToken(req.user!,scope.id)
  const replayScope='ai-quiz-draft:'+moduleId,replayDigest=createHash('sha256').update(JSON.stringify({})).digest('hex')
  const {rows:[prior]}=await db.query('SELECT digest,response FROM request_replays WHERE user_id=$1 AND scope=$2 AND key=$3',[req.user!.id,replayScope,requestKey])
  if(prior){if(prior.digest!==replayDigest)throw new HttpError(409,'CONFLICT','Idempotency key was used for a different request');res.status(201).set('Cache-Control','private, no-store').json(prior.response);return}
  const {rows:chunks}=await db.query(`SELECT c.id,c.content FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id
    JOIN lectures l ON l.id=c.lecture_id WHERE c.course_id=$1 AND l.module_id=$2 AND g.status='active'
    ORDER BY l.order_index,c.ordinal LIMIT 80`,[scope.id,moduleId])
  if(chunks.length===0)throw unavailable()
  const generated=await callAi('/v1/quiz-draft',token,{chunks})
  const validIds=new Set(chunks.map((chunk:any)=>String(chunk.id)))
  const draftSchema=z.strictObject({title:text(200),questions:z.array(z.any()).min(5).max(10)})
  const draft=draftSchema.parse(generated)
  const questions=draft.questions.map((q:any)=>{
    const parsed=z.strictObject({question_text:text(12000),question_type:z.enum(['mcq','multi_select','short_answer']),max_points:z.number().min(0.01).max(10000),rubric:text(12000).optional(),evidence:text(1200),options:z.array(z.strictObject({option_text:text(2000),is_correct:z.boolean()})).optional()}).parse(q)
    const evidenceIds=[...parsed.evidence.matchAll(/[0-9a-f-]{36}/gi)].map(match=>match[0])
    if(evidenceIds.length===0||evidenceIds.some(sourceId=>!validIds.has(sourceId)))throw new HttpError(503,'AI_UNAVAILABLE','Generated question evidence is invalid')
    const options=parsed.options??[]
    if(parsed.question_type==='short_answer'?options.length!==0||!parsed.rubric:options.length<2||options.filter(option=>option.is_correct).length===0||parsed.question_type==='mcq'&&options.filter(option=>option.is_correct).length!==1)throw new HttpError(503,'AI_UNAVAILABLE','Generated question shape is invalid')
    return {id:randomUUID(),question_text:parsed.question_text,question_type:parsed.question_type,max_points:parsed.max_points,...(parsed.rubric&&{rubric:parsed.rubric}),source_chunks:evidenceIds,options:options.map(option=>({...option,id:randomUUID()}))}
  })
  const result=await transaction(async client=>replay(client,req.user!.id,replayScope,requestKey,{},async()=>{
    const {rows:[quiz]}=await client.query(`INSERT INTO quizzes(module_id,is_ai_generated) VALUES($1,true) RETURNING id,module_id,is_ai_generated,latest,published`,[moduleId])
    const {rows:[revision]}=await client.query(`INSERT INTO quiz_revisions(quiz_id,revision,title,status,questions) VALUES($1,1,$2,'draft',$3) RETURNING revision,title,status`,[quiz.id,draft.title,JSON.stringify(questions)])
    await client.query("INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES($1,'quiz.ai_draft','quiz',$2,$3)",[req.user!.id,quiz.id,{sources:chunks.map((chunk:any)=>chunk.id),correlation_id:req.requestId}])
    return {quiz_id:quiz.id,module_id:moduleId,is_ai_generated:true,title:revision.title,status:revision.status,revision:'"1"',questions:questions.map((q:any)=>({question_text:q.question_text,question_type:q.question_type,max_points:q.max_points,...(q.rubric&&{rubric:q.rubric}),options:q.options.map((option:any)=>({option_text:option.option_text,is_correct:option.is_correct}))}))}
  }))
  res.status(201).set('Cache-Control','private, no-store').json(result)
})
