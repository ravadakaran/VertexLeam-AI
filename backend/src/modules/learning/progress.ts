import type { PoolClient } from 'pg'
import type { Profile } from '../../types.ts'
import { transaction } from '../../db/index.ts'
import { conflict, digest, invalid, lectureScope } from './scope.ts'
import { refreshAwards, invalidateLeaderboard } from '../gamification/routes.ts'

type Heartbeat = {
  position_seconds: number; event_id: string; playback_id: string; sequence: number
  played_ranges: Array<{ start_seconds: number; end_seconds: number }>
}

async function view(client: PoolClient, enrollment: string, lecture: string, duration: number) {
  const { rows: [row] } = await client.query(`
    SELECT coalesce(p.position_seconds, 0) AS position_seconds,
      coalesce((SELECT sum(upper(r)-lower(r))::int FROM unnest(p.coverage) AS r),0) AS watched_seconds,
      coalesce(p.rewatch_count, 0)::int AS rewatch_count,
      p.last_watched_at
    FROM enrollments e LEFT JOIN lecture_progress p ON p.enrollment_id=e.id AND p.lecture_id=$2
    WHERE e.id=$1
  `, [enrollment, lecture])
  return { ...row, completed: duration > 0 && row.watched_seconds >= duration,
    progress_percent: duration ? Math.round(row.watched_seconds * 10000 / duration) / 100 : 0 }
}

export function readProgress(user: Profile, id: string) {
  return transaction(async client => {
    const lecture = await lectureScope(client, user, id, 'learner')
    return view(client, lecture.enrollment_id!, id, lecture.duration_seconds)
  })
}

export async function writeProgress(user: Profile, id: string, body: Heartbeat) {
  let courseId: string | undefined
  const result = await transaction(async client => {
    const lecture = await lectureScope(client, user, id, 'learner')
    courseId = lecture.course_id
    const enrollment = lecture.enrollment_id!, duration = lecture.duration_seconds
    if (!duration || body.position_seconds > duration || body.played_ranges.some(range =>
      range.end_seconds <= range.start_seconds || range.end_seconds > duration)) throw invalid('Playback range is outside this lecture')
    await client.query('SELECT id FROM enrollments WHERE id=$1 FOR UPDATE', [enrollment])
    const { rows: [playback] } = await client.query(`
      SELECT ordinal FROM playback_sessions WHERE id=$1 AND lecture_id=$2 AND enrollment_id=$3 AND expires_at>now()
    `, [body.playback_id, id, enrollment])
    if (!playback) throw invalid('Playback session is invalid or expired')
    const fingerprint = digest(JSON.stringify(body))
    const inserted = await client.query(`
      INSERT INTO playback_events(enrollment_id,lecture_id,event_id,digest) VALUES($1,$2,$3,$4)
      ON CONFLICT DO NOTHING
    `, [enrollment, id, body.event_id, fingerprint])
    if (!inserted.rowCount) {
      const { rows: [prior] } = await client.query(
        'SELECT digest FROM playback_events WHERE enrollment_id=$1 AND lecture_id=$2 AND event_id=$3', [enrollment, id, body.event_id])
      if (prior.digest !== fingerprint) throw conflict('Playback event ID was reused')
      return view(client, enrollment, id, duration)
    }
    const ranges = '{' + body.played_ranges.map(range => `[${range.start_seconds},${range.end_seconds})`).join(',') + '}'
    const { rows: [priorProgress] } = await client.query(`
      SELECT position_seconds, playback_ordinal, coalesce(rewatch_count, 0)::int AS rewatch_count,
        coalesce((SELECT sum(upper(r)-lower(r))::int FROM unnest(coverage) AS r), 0) AS watched_seconds
      FROM lecture_progress WHERE enrollment_id=$1 AND lecture_id=$2
    `, [enrollment, id])
    const isRewatch = Boolean(priorProgress && duration > 0 && priorProgress.watched_seconds >= duration &&
      (playback.ordinal > priorProgress.playback_ordinal || (body.position_seconds < priorProgress.position_seconds && body.played_ranges.some(r => r.start_seconds <= 2))))
    const rewatchInc = isRewatch ? 1 : 0
    await client.query(`
      INSERT INTO lecture_progress AS p(enrollment_id,lecture_id,coverage,position_seconds,playback_ordinal,sequence,rewatch_count,last_watched_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT(enrollment_id,lecture_id) DO UPDATE SET coverage=p.coverage+excluded.coverage,
        rewatch_count=p.rewatch_count+excluded.rewatch_count,
        last_watched_at=now(),
        (position_seconds,playback_ordinal,sequence) = (
          SELECT CASE WHEN n THEN excluded.position_seconds ELSE p.position_seconds END,
                 CASE WHEN n THEN excluded.playback_ordinal ELSE p.playback_ordinal END,
                 CASE WHEN n THEN excluded.sequence ELSE p.sequence END
          FROM (SELECT (excluded.playback_ordinal,excluded.sequence)>(p.playback_ordinal,p.sequence) AS n) ordering
        )
    `, [enrollment, id, ranges, body.position_seconds, playback.ordinal, body.sequence, rewatchInc])
    await client.query(`
      INSERT INTO enrollment_curriculum(enrollment_id,lecture_id)
      SELECT $1,l.id FROM lectures l JOIN modules m ON m.id=l.module_id
      WHERE m.course_id=$2 AND l.duration_seconds>0
        AND NOT EXISTS(SELECT 1 FROM enrollment_curriculum WHERE enrollment_id=$1)
      ON CONFLICT DO NOTHING
    `, [enrollment, lecture.course_id])
    await client.query(`
      UPDATE enrollments SET progress_percent=coalesce((
        SELECT round(avg(coalesce((SELECT sum(upper(r)-lower(r)) FROM unnest(p.coverage) AS r),0)::numeric
          * 100 / l.duration_seconds),2)
        FROM enrollment_curriculum c JOIN lectures l ON l.id=c.lecture_id
        LEFT JOIN lecture_progress p ON p.enrollment_id=c.enrollment_id AND p.lecture_id=c.lecture_id
        WHERE c.enrollment_id=$1
      ),0) WHERE id=$1
    `, [enrollment])
    await refreshAwards(user.id, lecture.course_id, client)
    return view(client, enrollment, id, duration)
  })
  if (courseId) await invalidateLeaderboard(courseId)
  return result
}
