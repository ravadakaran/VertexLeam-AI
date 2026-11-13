import { Router } from 'express'
import { z } from 'zod'
import { db, transaction } from '../../db/index.ts'
import { authenticate, requireRole } from '../../middleware/auth.ts'
import { HttpError, parse, uuid } from '../../http.ts'
import { courseScope, moduleScope } from '../learning/scope.ts'

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

personalization.get('/courses/:id/topics',authenticate,requireRole('student','instructor','admin'),async (req,res)=>{
  const courseId=parse(uuid,req.params.id)
  await courseScope(db,req.user!,courseId,req.user!.roles.includes('student')?'learner':'author')
  const {rows}=await db.query('SELECT id,name,description FROM learning_topics WHERE course_id=$1 ORDER BY name,id',[courseId])
  res.set('Cache-Control','private, no-store').json({items:rows})
})

personalization.get('/modules/:id/topics', ...author, async (req,res)=>{
  const moduleId=parse(uuid,req.params.id)
  await moduleScope(db,req.user!,moduleId,'author')
  const {rows}=await db.query(`SELECT t.id,t.name,t.description FROM learning_topics t JOIN modules m ON m.course_id=t.course_id
    WHERE m.id=$1 ORDER BY t.name,t.id`,[moduleId])
  res.set('Cache-Control','private, no-store').json({items:rows})
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
    // Signal 1: Topic mastery & weak topics (< 0.75)
    const {rows:weakTopics}=await client.query(`SELECT t.id topic_id,t.course_id,t.name,coalesce(m.score,0.5)::float score,
      coalesce(m.confidence,0)::float confidence FROM learning_topics t
      JOIN learner_mastery m ON m.topic_id=t.id WHERE m.user_id=$1 AND m.score<0.75 ORDER BY m.score ASC,t.name`,[req.user!.id])

    // Signal 2: Weak quiz attempts (< 75%)
    const {rows:weakQuizzes}=await client.query(`SELECT q.id quiz_id,q.module_id,m.course_id,m.title module_title,c.title course_title,a.score
      FROM quiz_attempts a JOIN quizzes q ON q.id=a.quiz_id JOIN modules m ON m.id=q.module_id JOIN courses c ON c.id=m.course_id
      WHERE a.user_id=$1 AND a.status='graded' AND a.score<75 ORDER BY a.started_at DESC LIMIT 10`,[req.user!.id])

    // Signal 3: Assignment performance
    const {rows:weakAssignments}=await client.query(`SELECT a.id assignment_id,a.course_id,c.title course_title,a.title,s.grade
      FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN courses c ON c.id=a.course_id
      WHERE s.user_id=$1 AND s.grade IS NOT NULL AND s.grade<70 ORDER BY s.submitted_at DESC LIMIT 10`,[req.user!.id])

    // Signal 4: Enrollment history & curriculum progress
    const {rows:enrolledCurriculum}=await client.query(`SELECT e.course_id,c.title course_title,e.progress_percent,
        m.id module_id,m.title module_title,m.order_index module_order,
        l.id lecture_id,l.title lecture_title,l.duration_seconds,l.order_index lecture_order,
        coalesce(p.position_seconds,0)::int position_seconds,
        coalesce((SELECT sum(upper(r)-lower(r))::int FROM unnest(p.coverage) AS r),0)::int watched_seconds,
        coalesce(p.rewatch_count,0)::int rewatch_count
      FROM enrollments e JOIN courses c ON c.id=e.course_id JOIN modules m ON m.course_id=c.id JOIN lectures l ON l.module_id=m.id
      LEFT JOIN lecture_progress p ON p.enrollment_id=e.id AND p.lecture_id=l.id
      WHERE e.user_id=$1 AND l.duration_seconds>0 ORDER BY c.title,m.order_index,l.order_index`,[req.user!.id])

    // Signal 5: AI tutor user questions
    const {rows:tutorQueries}=await client.query(`SELECT m.content,s.course_id FROM ai_chat_messages m
      JOIN ai_chat_sessions s ON s.id=m.session_id WHERE s.user_id=$1 AND m.role='user' ORDER BY m.created_at DESC LIMIT 20`,[req.user!.id])

    // Combined profile of learner interest and weak concepts
    const profileWords=[
      ...weakTopics.flatMap((t:any)=>words(t.name)),
      ...weakQuizzes.flatMap((q:any)=>words(q.module_title)),
      ...tutorQueries.flatMap((tq:any)=>words(tq.content)),
      ...weakAssignments.flatMap((a:any)=>words(a.title))
    ]

    // Output 1: Suggested courses
    const {rows:candidates}=await client.query(`SELECT c.id,c.title,c.description,c.category,
      coalesce(avg(m.score),0.5)::float mastery,count(m.topic_id)::int evidence
      FROM courses c LEFT JOIN learning_topics t ON t.course_id=c.id LEFT JOIN learner_mastery m ON m.topic_id=t.id AND m.user_id=$1
      WHERE c.status='approved' AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.user_id=$1)
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,[req.user!.id])

    const rankedCourses=candidates.map((c:any)=>{
      const candidateWords=words(c.title+' '+(c.description??'')+' '+c.category)
      const similarity=cosine(profileWords,candidateWords)
      const rule=c.evidence?1-Math.min(1,c.mastery):0.5
      const score=Math.round((0.6*rule+0.4*similarity)*100000)/100000
      let reason='Explore an approved course based on the available catalog'
      let inputSignal='topic_mastery'
      const matchedWeakTopic=weakTopics.find((t:any)=>candidateWords.some(w=>words(t.name).includes(w)))
      const matchedTutor=tutorQueries.find((tq:any)=>candidateWords.some(w=>words(tq.content).includes(w)))
      const matchedQuiz=weakQuizzes.find((q:any)=>candidateWords.some(w=>words(q.module_title).includes(w)))
      if(matchedWeakTopic){reason=`Weak in ${matchedWeakTopic.name} (${Math.round(matchedWeakTopic.score*100)}%) — Recommend ${c.title}`;inputSignal='topic_mastery'}
      else if(matchedQuiz){reason=`Low quiz score in ${matchedQuiz.module_title} — Recommend ${c.title}`;inputSignal='quiz_scores'}
      else if(matchedTutor){reason=`Based on your AI tutor queries — Recommend ${c.title}`;inputSignal='ai_tutor_questions'}
      else if(c.evidence){reason='Prioritize a related course to strengthen lower-mastery topics';inputSignal='topic_mastery'}
      return {course_id:c.id,title:c.title,score,reason,input_signal:inputSignal}
    }).sort((a:any,b:any)=>b.score-a.score||a.course_id.localeCompare(b.course_id)).slice(0,10)

    // Output 2: Suggested modules
    const moduleRecs:Array<{module_id:string;course_id:string;course_title:string;title:string;score:number;reason:string;input_signal:string}>=[]
    for(const q of weakQuizzes){
      if(!moduleRecs.some(r=>r.module_id===q.module_id)){
        moduleRecs.push({module_id:q.module_id,course_id:q.course_id,course_title:q.course_title,title:q.module_title,score:0.92,
          reason:`Low quiz score (${q.score}%) — Recommend reviewing ${q.module_title}`,input_signal:'quiz_scores'})
      }
    }
    for(const t of weakTopics){
      const matchingLec=enrolledCurriculum.find((lec:any)=>words(lec.module_title+' '+lec.lecture_title).some(w=>words(t.name).includes(w)))
      if(matchingLec&&!moduleRecs.some(r=>r.module_id===matchingLec.module_id)){
        moduleRecs.push({module_id:matchingLec.module_id,course_id:matchingLec.course_id,course_title:matchingLec.course_title,title:matchingLec.module_title,
          score:Math.round((1-t.score)*100000)/100000,reason:`Weak in ${t.name} (mastery ${Math.round(t.score*100)}%) — Recommend ${matchingLec.module_title}`,input_signal:'topic_mastery'})
      }
    }
    for(const tq of tutorQueries){
      const qWords=words(tq.content)
      const matchingLec=enrolledCurriculum.find((lec:any)=>words(lec.module_title).some(w=>qWords.includes(w)))
      if(matchingLec&&!moduleRecs.some(r=>r.module_id===matchingLec.module_id)){
        moduleRecs.push({module_id:matchingLec.module_id,course_id:matchingLec.course_id,course_title:matchingLec.course_title,title:matchingLec.module_title,
          score:0.78,reason:`Based on your AI tutor queries — Recommend practicing ${matchingLec.module_title}`,input_signal:'ai_tutor_questions'})
      }
    }

    // Output 3: Suggested lectures
    const lectureRecs:Array<{lecture_id:string;module_id:string;course_id:string;course_title:string;title:string;duration_seconds:number;progress_percent:number;dropoff_seconds:number;score:number;reason:string;input_signal:string}>=[]
    // Drop-off resume
    for(const l of enrolledCurriculum){
      if(l.position_seconds>0&&l.watched_seconds<l.duration_seconds){
        lectureRecs.push({lecture_id:l.lecture_id,module_id:l.module_id,course_id:l.course_id,course_title:l.course_title,title:l.lecture_title,duration_seconds:l.duration_seconds,
          progress_percent:Math.round(l.watched_seconds*100/l.duration_seconds),dropoff_seconds:l.position_seconds,score:0.95,
          reason:`Resume playback: ${Math.round(l.watched_seconds*100/l.duration_seconds)}% watched (paused at ${Math.floor(l.position_seconds/60)}:${(l.position_seconds%60).toString().padStart(2,'0')})`,
          input_signal:'enrollment_history'})
      }
    }
    // Next unwatched lecture
    for(const l of enrolledCurriculum){
      if(l.watched_seconds===0&&!lectureRecs.some(r=>r.lecture_id===l.lecture_id)){
        lectureRecs.push({lecture_id:l.lecture_id,module_id:l.module_id,course_id:l.course_id,course_title:l.course_title,title:l.lecture_title,duration_seconds:l.duration_seconds,
          progress_percent:0,dropoff_seconds:0,score:0.80,reason:`Next lecture up in ${l.course_title}`,input_signal:'enrollment_history'})
        if(lectureRecs.length>=6)break
      }
    }

    // Persist into database tables
    await client.query('DELETE FROM learner_recommendations WHERE user_id=$1',[req.user!.id])
    for(let i=0;i<rankedCourses.length;i++)await client.query('INSERT INTO learner_recommendations(user_id,course_id,rank,score,reason) VALUES($1,$2,$3,$4,$5)',[req.user!.id,rankedCourses[i].course_id,i+1,rankedCourses[i].score,rankedCourses[i].reason])

    await client.query('DELETE FROM learner_targeted_recommendations WHERE user_id=$1',[req.user!.id])
    for(const c of rankedCourses){
      await client.query(`INSERT INTO learner_targeted_recommendations(user_id,target_type,course_id,title,score,reason,input_signal)
        VALUES($1,'course',$2,$3,$4,$5,$6)`,[req.user!.id,c.course_id,c.title,c.score,c.reason,c.input_signal])
    }
    for(const m of moduleRecs.slice(0,6)){
      await client.query(`INSERT INTO learner_targeted_recommendations(user_id,target_type,course_id,module_id,title,score,reason,input_signal)
        VALUES($1,'module',$2,$3,$4,$5,$6,$7)`,[req.user!.id,m.course_id,m.module_id,m.title,m.score,m.reason,m.input_signal])
    }
    for(const l of lectureRecs.slice(0,6)){
      await client.query(`INSERT INTO learner_targeted_recommendations(user_id,target_type,course_id,module_id,lecture_id,title,score,reason,input_signal)
        VALUES($1,'lecture',$2,$3,$4,$5,$6,$7,$8)`,[req.user!.id,l.course_id,l.module_id,l.lecture_id,l.title,l.score,l.reason,l.input_signal])
    }

    return {items:rankedCourses,courses:rankedCourses,modules:moduleRecs.slice(0,6),lectures:lectureRecs.slice(0,6)}
  })
  res.set('Cache-Control','private, no-store').json(result)
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
