import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { limit } from '../../cache.ts'
import { courseScope, lectureScope, moduleScope, text, keySchema, replay, invalid } from '../learning/scope.ts'
import type { Profile } from '../../types.ts'
import { recordActivity } from '../gamification/routes.ts'

export const ai = Router()
const student=[authenticate,requireRole('student')],member=[authenticate,requireRole('student')]
const chatLimit=async(req:any,res:any,next:any)=>{await limit(res,'ai-chat',req.user!.id,20);next()}
const unavailable=()=>new HttpError(503,'AI_UNAVAILABLE','AI provider is not configured')
const messageBody=z.strictObject({message:text(4000),request_id:uuid})
const modeBody=z.strictObject({mode:z.enum(['beginner','intermediate','advanced'])})
const sessionBody=z.strictObject({course_id:uuid})
const serviceToken=(user:Profile,courseId:string)=>{
  const secret=process.env.AI_SERVICE_TOKEN
  if(!secret||!process.env.AI_SERVICE_URL||process.env.AI_OUTBOUND_DATA_APPROVED!=='true')throw unavailable()
  return {authorization:`Bearer ${jwt.sign({sub:user.id,course_id:courseId},secret,{expiresIn:60,audience:'vertexlearn-ai-service',issuer:'vertexlearn-core'})}`,actor_id:user.id,course_id:courseId}
}
async function callAi(path:string,token:ReturnType<typeof serviceToken>,payload:unknown){
  const origin=process.env.AI_SERVICE_URL
  if(!origin)throw unavailable()
  let response:Response
  try{response=await fetch(new URL(path,origin),{method:'POST',headers:{'content-type':'application/json',authorization:token.authorization},body:JSON.stringify({payload,actor_id:token.actor_id,course_id:token.course_id}),signal:AbortSignal.timeout(15000)})}
  catch{throw new HttpError(503,'AI_UNAVAILABLE','AI provider is temporarily unavailable')}
  if(!response.ok)throw new HttpError(503,'AI_UNAVAILABLE','AI provider is temporarily unavailable')
  return response.json() as Promise<any>
}
ai.get('/ai/health',async(_req,res)=>{
  const ok=Boolean(process.env.AI_SERVICE_URL&&process.env.AI_SERVICE_TOKEN&&process.env.AI_OUTBOUND_DATA_APPROVED==='true')
  res.status(ok?200:503).json({status:ok?'configured':'unavailable'})
})
ai.post('/ai/chat/sessions',...member,chatLimit,async(req,res)=>{
  const body=parse(sessionBody,req.body),requestKey=parse(keySchema,req.get('Idempotency-Key'))
  const result=await transaction(async client=>{
    await courseScope(client,req.user!,body.course_id,'learner')
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
ai.put('/ai/chat/sessions/:id/mode',...member,async(req,res)=>{
  const id=parse(uuid,req.params.id),body=parse(modeBody,req.body)
  const {rows:[session]}=await db.query(`UPDATE ai_chat_sessions SET mode=$3 WHERE id=$1 AND user_id=$2 RETURNING id,course_id,mode`,[id,req.user!.id,body.mode])
  if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
  res.set('Cache-Control','private, no-store').json(session)
})
ai.get('/ai/chat/sessions/:id/messages',...member,async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const {rows:[session]}=await db.query('SELECT id FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[id,req.user!.id])
  if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
  const {rows}=await db.query('SELECT role,content,sources,created_at FROM ai_chat_messages WHERE session_id=$1 ORDER BY created_at',[id])
  res.set('Cache-Control','private, no-store').json({items:rows})
})
ai.post('/ai/chat/sessions/:id/messages',...member,chatLimit,async(req,res)=>{
  const id=parse(uuid,req.params.id),body=parse(messageBody,req.body),request={request_id:body.request_id}
  const result=await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([id,request.request_id])])
    const {rows:[session]}=await client.query('SELECT id,user_id,course_id,mode FROM ai_chat_sessions WHERE id=$1 AND user_id=$2',[id,req.user!.id])
    if(!session)throw new HttpError(404,'NOT_FOUND','Chat session not found')
    const prior=await client.query('SELECT content,sources FROM ai_chat_messages WHERE session_id=$1 AND request_id=$2 AND role=\'assistant\'',[id,request.request_id])
    if(prior.rowCount)return {reply:prior.rows[0].content,sources:prior.rows[0].sources,mode:session.mode}
    const token=serviceToken(req.user!,session.course_id)
    const provider=await callAi('/v1/chat',token,{question:body.message,mode:session.mode,history:[]})
    if(typeof provider.reply!=='string'||provider.reply.length>8000||!Array.isArray(provider.sources))throw unavailable()
  const sourceList=z.array(z.strictObject({chunk_id:uuid})).max(6).safeParse(provider.sources)
  if(!sourceList.success)throw unavailable()
  const sourceIds=sourceList.data.map(s=>s.chunk_id)
    const sources=sourceIds.length?await client.query(`SELECT DISTINCT ON(c.id) c.lecture_id,l.title lecture_title,c.start_seconds timestamp_seconds,c.id chunk_id
      FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id AND g.status='active' JOIN lectures l ON l.id=c.lecture_id
      WHERE c.course_id=$1 AND c.id=ANY($2::uuid[])`,[session.course_id,sourceIds]):{rows:[]}
    if(sources.rows.length!==sourceIds.length)throw unavailable()
    const output=sources.rows.map(({chunk_id,...source})=>source)
    await client.query('INSERT INTO ai_chat_messages(session_id,request_id,role,content) VALUES($1,$2,\'user\',$3) ON CONFLICT DO NOTHING',[id,request.request_id,body.message])
    await client.query('INSERT INTO ai_chat_messages(session_id,request_id,role,content,sources) VALUES($1,$2,\'assistant\',$3,$4) ON CONFLICT DO NOTHING',[id,request.request_id,provider.reply,JSON.stringify(output)])
    await recordActivity(req.user!.id,client)
    return {reply:provider.reply,sources:output,mode:session.mode}
  })
  res.set('Cache-Control','private, no-store').json(result)
})

ai.post('/ai/lectures/:id/ingest',authenticate,requireRole('instructor','admin'),async(req,res)=>{
  const lectureId=parse(uuid,req.params.id),body=z.strictObject({content:text(1000000),segments:z.array(z.strictObject({start_seconds:z.int().nonnegative(),end_seconds:z.int().positive(),text:text(12000)})).max(20000)}).parse(req.body)
  const result=await transaction(async client=>{
    const lecture=await lectureScope(client,req.user!,lectureId,'author')
    if(body.segments.some(segment=>segment.start_seconds>=segment.end_seconds||segment.end_seconds>lecture.duration_seconds))throw invalid('Transcript segment is outside the lecture duration')
    const hash=createHash('sha256').update(body.content).digest('hex')
    const {rows:[gen]}=await client.query(`INSERT INTO ai_source_generations(lecture_id,generation,status,source_hash)
      SELECT $1,coalesce(max(generation),0)+1,'processing',$2 FROM ai_source_generations WHERE lecture_id=$1 RETURNING *`,[lectureId,hash])
    const chunks=body.segments.length?body.segments:body.content.match(/.{1,2200}(?:\s|$)/gs)?.map((content,i)=>({start_seconds:0,end_seconds:0,text:content.trim()}))??[]
    for(let i=0;i<chunks.length;i++){
      const c=chunks[i]
      await client.query('INSERT INTO ai_chunks(generation_id,course_id,lecture_id,ordinal,content,start_seconds,end_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',[gen.id,lecture.course_id,lectureId,i,c.text,c.start_seconds||null,c.end_seconds||null])
    }
    return { generation: gen, course_id: lecture.course_id }
  })
  try {
    await callAi('/v1/embed', serviceToken(req.user!, result.course_id), { generation_id: result.generation.id })
    await db.query("UPDATE ai_source_generations SET status='processing' WHERE id=$1", [result.generation.id])
  } catch (error) {
    await db.query("UPDATE ai_source_generations SET status='failed',error='Embedding provider unavailable' WHERE id=$1", [result.generation.id])
    throw error
  }
  res.status(202).json({id:result.generation.id,status:result.generation.status,lecture_id:lectureId})
})

ai.post('/ai/jobs/:id/publish',authenticate,requireRole('instructor','admin'),async(req,res)=>{
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

ai.post('/ai/lectures/:id/summarize',...student,async(req,res)=>{
  const id=parse(uuid,req.params.id)
  const lecture=await lectureScope(db,req.user!,id,'learner'),token=serviceToken(req.user!,lecture.course_id)
  const {rows}=await db.query("SELECT c.id,c.content,c.start_seconds,l.id lecture_id,l.title lecture_title FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id JOIN lectures l ON l.id=c.lecture_id WHERE c.lecture_id=$1 AND g.status='active' ORDER BY c.ordinal",[id])
  if(!rows.length)throw unavailable()
  const result=await callAi('/v1/summarize',token,{chunks:rows})
  if(typeof result.summary!=='string'||result.summary.length>10000||!Array.isArray(result.sources))throw unavailable()
  const sourceIds=result.sources.map((source:any)=>source.chunk_id)
  const sourceRows=rows.filter((row:any)=>sourceIds.includes(row.id))
  if(sourceRows.length!==new Set(sourceIds).size||!sourceRows.length)throw unavailable()
  let summary=result.summary
  for(const source of sourceRows)summary=summary.replaceAll(source.id,`${source.lecture_title}${source.start_seconds!==null?` at ${source.start_seconds}s`:''}`)
  res.set('Cache-Control','private, no-store').json({summary,sources:sourceRows.map((source:any)=>({lecture_id:source.lecture_id,lecture_title:source.lecture_title,...(source.start_seconds!==null&&{timestamp_seconds:source.start_seconds})}))})
})
ai.post('/ai/modules/:id/flashcards',...student,async(req,res)=>{
  const id=parse(uuid,req.params.id),scope=await moduleScope(db,req.user!,id,'learner'),token=serviceToken(req.user!,scope.id)
  const {rows}=await db.query("SELECT c.id,c.content FROM ai_chunks c JOIN ai_source_generations g ON g.id=c.generation_id JOIN lectures l ON l.id=c.lecture_id WHERE c.course_id=$1 AND l.module_id=$2 AND g.status='active' ORDER BY l.order_index,c.ordinal LIMIT 80",[scope.id,id])
  if(!rows.length)throw unavailable()
  const result=await callAi('/v1/flashcards',token,{chunks:rows})
  if(!Array.isArray(result.items)||result.items.length>10||result.items.some((item:any)=>typeof item.question!=='string'||typeof item.answer!=='string'||item.question.length>1000||item.answer.length>2000))throw unavailable()
  res.set('Cache-Control','private, no-store').json(result)
})

ai.post('/ai/modules/:id/quiz-draft',authenticate,requireRole('instructor','admin'),async(req,res)=>{
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
