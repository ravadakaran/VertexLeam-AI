import { Router } from 'express'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { courseScope } from '../learning/scope.ts'

export const personalization = Router()
const student = [authenticate, requireRole('student')]
const author = [authenticate, requireRole('instructor', 'admin')]
const words=(value:string)=>value.toLowerCase().match(/[a-z0-9]+/g)?.filter(word=>word.length>2)??[]
function cosine(left:string[],right:string[]){
  const a=new Map<string,number>(),b=new Map<string,number>()
  for(const word of left)a.set(word,(a.get(word)??0)+1)
  for(const word of right)b.set(word,(b.get(word)??0)+1)
  let dot=0;for(const [word,count] of a)dot+=count*(b.get(word)??0)
  const norm=(map:Map<string,number>)=>Math.sqrt([...map.values()].reduce((sum,count)=>sum+count*count,0))
  const denominator=norm(a)*norm(b)
  return denominator?dot/denominator:0
}

personalization.post('/courses/:id/topics', ...author, async (req, res) => {
  const courseId=parse(uuid,req.params.id), body=z.strictObject({name:z.string().trim().min(1).max(120),description:z.string().max(2000).default('')}).parse(req.body)
  const {rows:[scope]}=await db.query('SELECT id FROM courses WHERE id=$1',[courseId])
  if(!scope)throw new HttpError(404,'NOT_FOUND','Course not found')
  await courseScope(db,req.user!,courseId,'author')
  const {rows:[topic]}=await db.query('INSERT INTO learning_topics(course_id,name,description) VALUES($1,$2,$3) ON CONFLICT(course_id,name) DO UPDATE SET description=EXCLUDED.description RETURNING *',[courseId,body.name,body.description])
  res.status(201).json(topic)
})

personalization.get('/users/me/mastery', ...student, async (req,res)=>{
  const courseId=req.query.course_id===undefined?undefined:parse(uuid,req.query.course_id)
  if(courseId)await courseScope(db,req.user!,courseId,'learner')
  const {rows}=await db.query(`SELECT t.id topic_id,t.course_id,t.name,coalesce(m.score,0.5)::float score,
    coalesce(m.confidence,0)::float confidence,m.updated_at,CASE WHEN coalesce(m.score,0.5)<0.4 THEN 'beginner'
    WHEN coalesce(m.score,0.5)<0.75 THEN 'intermediate' ELSE 'advanced' END band
    FROM learning_topics t JOIN enrollments e ON e.course_id=t.course_id AND e.user_id=$1
    LEFT JOIN learner_mastery m ON m.topic_id=t.id AND m.user_id=$1
    WHERE ($2::uuid IS NULL OR t.course_id=$2) ORDER BY coalesce(m.score,0.5),t.name`,[req.user!.id,courseId??null])
  res.set('Cache-Control','private, no-store').json({items:rows})
})

personalization.get('/users/me/study-plan', ...student, async (req,res)=>{
  const courseId=req.query.course_id===undefined?undefined:parse(uuid,req.query.course_id)
  if(courseId){
    await courseScope(db,req.user!,courseId,'learner')
    const {rows:[saved]}=await db.query('SELECT plan FROM learner_study_plans WHERE user_id=$1 AND course_id=$2',[req.user!.id,courseId])
    if(saved){res.set('Cache-Control','private,no-store').json(saved.plan);return}
  }
  const {rows}=await db.query(`SELECT t.id topic_id,t.course_id,c.title course_title,t.name topic_name,
    coalesce(m.score,0.5)::float mastery,coalesce(m.confidence,0)::float confidence,
    EXISTS(SELECT 1 FROM quizzes q JOIN modules qm ON qm.id=q.module_id JOIN quiz_attempts a ON a.quiz_id=q.id
      JOIN quiz_revisions qr ON qr.quiz_id=a.quiz_id AND qr.revision=a.quiz_revision
      CROSS JOIN LATERAL jsonb_array_elements(qr.questions) question
      WHERE qm.course_id=t.course_id AND a.user_id=$1 AND a.status='graded' AND question->>'topic_id'=t.id::text) has_history,
    (SELECT l.id FROM lectures l JOIN modules lm ON lm.id=l.module_id WHERE lm.course_id=t.course_id ORDER BY lm.order_index,l.order_index LIMIT 1) lecture_id
    FROM learning_topics t JOIN courses c ON c.id=t.course_id JOIN enrollments e ON e.course_id=t.course_id AND e.user_id=$1
    LEFT JOIN learner_mastery m ON m.topic_id=t.id AND m.user_id=$1 WHERE ($2::uuid IS NULL OR t.course_id=$2)
    ORDER BY coalesce(m.score,0.5),t.name LIMIT 12`,[req.user!.id,courseId??null])
  const generatedAt=new Date(),startDate=new Date(Date.UTC(generatedAt.getUTCFullYear(),generatedAt.getUTCMonth(),generatedAt.getUTCDate()))
  const steps=rows.map((row:any,index:number)=>{
    const day=index%7+1,scheduled=new Date(startDate.getTime()+(day-1)*86400000)
    return {order:index+1,day,scheduled_for:scheduled.toISOString().slice(0,10),estimated_minutes:row.mastery<0.4?35:25,
      course_id:row.course_id,course_title:row.course_title,topic_id:row.topic_id,topic:row.topic_name,
      lecture_id:row.lecture_id,action:row.mastery<0.4?'Review the lesson, then retry a practice question':'Study this topic and check your understanding',
      reason:row.has_history?'Prior finalized quiz performance indicates this priority':'Syllabus-based cold-start step',mastery:row.mastery}
  })
  const days=Array.from({length:7},(_,index)=>{
    const date=new Date(startDate.getTime()+index*86400000).toISOString().slice(0,10)
    return {day:index+1,scheduled_for:date,steps:steps.filter(step=>step.day===index+1)}
  })
  await transaction(async client=>{
    const byCourse=new Map<string,typeof steps>()
    for(const step of steps){const grouped=byCourse.get(step.course_id)??[];grouped.push(step);byCourse.set(step.course_id,grouped)}
    for(const [courseId,courseSteps] of byCourse)await client.query(`INSERT INTO learner_study_plans(user_id,course_id,plan,generated_at)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id,course_id) DO UPDATE SET plan=EXCLUDED.plan,generated_at=EXCLUDED.generated_at`,
      [req.user!.id,courseId,JSON.stringify({days:days.map(day=>({...day,steps:day.steps.filter(step=>step.course_id===courseId)}))}),generatedAt])
  })
  res.set('Cache-Control','private, no-store').json({generated_at:generatedAt.toISOString(),days,steps})
})

personalization.get('/users/me/recommendations', ...student, async (req,res)=>{
  const result=await transaction(async client=>{
    const {rows}=await client.query(`SELECT c.id,c.title,c.description,c.category,
      coalesce(avg(m.score),0.5)::float mastery,count(m.topic_id)::int evidence
      FROM courses c LEFT JOIN learning_topics t ON t.course_id=c.id LEFT JOIN learner_mastery m ON m.topic_id=t.id AND m.user_id=$1
      WHERE c.status='approved' AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$1)
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,[req.user!.id])
    const interest=await client.query(`SELECT t.name FROM learning_topics t JOIN learner_mastery m ON m.topic_id=t.id
      WHERE m.user_id=$1 AND m.score<0.75 ORDER BY t.name`,[req.user!.id])
    const profile=interest.rows.flatMap((row:any)=>words(row.name))
    const ranked=rows.map((c:any)=>{
      const candidate=words(c.title+' '+(c.description??'')+' '+c.category)
      const similarity=cosine(profile,candidate)
      const rule=c.evidence?1-Math.min(1,c.mastery):0.5
      const score=Math.round((0.6*rule+0.4*similarity)*100000)/100000
      const reason=c.evidence?'Prioritize a related course to strengthen lower-mastery topics':'Explore an approved course based on the available catalog'
      return {course_id:c.id,title:c.title,score,reason}
    }).sort((a:any,b:any)=>b.score-a.score||a.course_id.localeCompare(b.course_id)).slice(0,10)
    await client.query('DELETE FROM learner_recommendations WHERE user_id=$1',[req.user!.id])
    for(let i=0;i<ranked.length;i++)await client.query('INSERT INTO learner_recommendations(user_id,course_id,rank,score,reason) VALUES($1,$2,$3,$4,$5)',[req.user!.id,ranked[i].course_id,i+1,ranked[i].score,ranked[i].reason])
    return ranked
  })
  res.set('Cache-Control','private, no-store').json({items:result})
})

export async function recordMasteryEvidence(client:any,userId:string,topicId:string,evidenceId:string,score:number,evidenceKind:'quiz'|'tutor_self_assessment'){
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${userId}:${topicId}`])
  await client.query(`INSERT INTO mastery_events(user_id,topic_id,evidence_id,score,evidence_kind) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,topic_id,evidence_id) DO UPDATE SET score=EXCLUDED.score,evidence_kind=EXCLUDED.evidence_kind,accepted_at=now()`,
    [userId,topicId,evidenceId,score,evidenceKind])
  const {rows:events}=await client.query('SELECT score FROM mastery_events WHERE user_id=$1 AND topic_id=$2 ORDER BY accepted_at,id',[userId,topicId])
  let mastery=0.5
  for(const event of events)mastery=0.8*mastery+0.2*Number(event.score)
  const {rows:[result]}=await client.query(`INSERT INTO learner_mastery(user_id,topic_id,score,confidence) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id,topic_id) DO UPDATE SET score=EXCLUDED.score,confidence=EXCLUDED.confidence,updated_at=now()
    RETURNING topic_id,score::float score,confidence::float confidence,updated_at`,[userId,topicId,mastery,Math.min(1,events.length/5)])
  return result
}

export async function recordQuizMastery(client:any,userId:string,attemptId:string,questions:any[],scores:Record<string,number>){
  const perTopic=new Map<string,{earned:number;maximum:number}>()
  for(const q of questions){if(!q.topic_id)continue;const entry=perTopic.get(q.topic_id)??{earned:0,maximum:0};entry.maximum+=Number(q.max_points);entry.earned+=Number(scores[q.id]??0)/100;perTopic.set(q.topic_id,entry)}
  for(const [topicId,value] of perTopic){
    const valid=await client.query('SELECT 1 FROM learning_topics WHERE id=$1',[topicId]);if(!valid.rowCount)continue
    await recordMasteryEvidence(client,userId,topicId,'quiz:'+attemptId,value.maximum?value.earned/value.maximum:0,'quiz')
  }
}
