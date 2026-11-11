import { bumpCatalogGeneration } from '../../cache.ts'

if (!['development', 'test'].includes(process.env.APP_ENV ?? '') ||
    !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12) {
  throw new Error('Demo seeding requires development/test APP_ENV and DEMO_PASSWORD of at least 12 characters')
}

const DEMO_COURSE_ID = '00000000-0000-4000-8000-00000000d5a1'
const DEMO_MODULE_ID = '00000000-0000-4000-8000-00000000d5a2'
const DEMO_LECTURE_1_ID = '00000000-0000-4000-8000-00000000d5a3'
const DEMO_LECTURE_2_ID = '00000000-0000-4000-8000-00000000d5a4'
const DEMO_TOPIC_ID = '00000000-0000-4000-8000-00000000d5a5'
const DEMO_QUIZ_ID = '00000000-0000-4000-8000-00000000d5a6'
const DEMO_ASSIGNMENT_ID = '00000000-0000-4000-8000-00000000d5a7'
const DEMO_THREAD_ID = '00000000-0000-4000-8000-00000000d5a8'
const DEMO_ROOT_POST_ID = '00000000-0000-4000-8000-00000000d5a9'
const DEMO_ANNOUNCEMENT_ID = '00000000-0000-4000-8000-00000000d5aa'
const DEMO_CRITERION_ID = '00000000-0000-4000-8000-00000000d5ab'
const DEMO_OPT_1_ID = '00000000-0000-4000-8000-00000000d5ac'
const DEMO_OPT_2_ID = '00000000-0000-4000-8000-00000000d5ad'
const DEMO_Q_ID = '00000000-0000-4000-8000-00000000d5ae'

const DEMO_APPROVAL_ID = '00000000-0000-4000-8000-00000000d5af'
const DEMO_CORRELATION_ID = '00000000-0000-4000-8000-00000000d5b0'

const { db, transaction } = await import('../index.ts')

try {
  await transaction(async client => {
    const { rows: users } = await client.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE email = ANY($1::varchar[])",
      [['instructor@vertexlearn.test', 'student@vertexlearn.test', 'admin@vertexlearn.test']]
    )
    const instructor = users.find(u => u.email === 'instructor@vertexlearn.test')
    const student = users.find(u => u.email === 'student@vertexlearn.test')
    const admin = users.find(u => u.email === 'admin@vertexlearn.test')

    if (!instructor || !student || !admin) {
      throw new Error('Run npm run db:seed before running demo:seed')
    }

    await client.query(`
      INSERT INTO courses (
        id, instructor_id, title, description, category, difficulty,
        price, pricing_tier, status, rating, submitted_at, revision
      ) VALUES (
        $1, $2,
        'Data Structures and Algorithms',
        'Synthetic reference course covering asymptotic complexity, balanced trees, graphs, and dynamic programming.',
        'Computer Science',
        'intermediate',
        0,
        'free',
        'approved',
        4.90,
        now(),
        2
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = 'approved',
        rating = EXCLUDED.rating,
        revision = 2
    `, [DEMO_COURSE_ID, instructor.id])

    await client.query(`
      INSERT INTO course_approvals (
        id, course_id, reviewed_by, decision, comment, correlation_id
      ) VALUES (
        $1, $2, $3, 'approved', 'Synthetic DSA reference catalog seed', $4
      )
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_APPROVAL_ID, DEMO_COURSE_ID, admin.id, DEMO_CORRELATION_ID])

    await client.query(`
      INSERT INTO modules (id, course_id, title, order_index)
      VALUES ($1, $2, 'Module 1: Asymptotic Complexity & Trees', 0)
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_MODULE_ID, DEMO_COURSE_ID])

    await client.query(`
      INSERT INTO lectures (id, module_id, title, order_index, duration_seconds, media_status)
      VALUES
        ($1, $2, 'Big-O Notation & Recurrences', 0, 420, 'none'),
        ($3, $2, 'Balanced Binary Search Trees', 1, 540, 'none')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_LECTURE_1_ID, DEMO_MODULE_ID, DEMO_LECTURE_2_ID])

    await client.query(`
      INSERT INTO learning_topics (id, course_id, name, description)
      VALUES ($1, $2, 'Algorithmic Complexity', 'Asymptotic notation, recurrences, and balanced tree invariants.')
      ON CONFLICT (course_id, name) DO NOTHING
    `, [DEMO_TOPIC_ID, DEMO_COURSE_ID])

    const questions = [
      {
        id: DEMO_Q_ID,
        question_text: 'What is the tight worst-case time complexity of binary search on a sorted array of n items?',
        question_type: 'mcq',
        max_points: 10,
        options: [
          { id: DEMO_OPT_1_ID, option_text: 'O(log n)', is_correct: true },
          { id: DEMO_OPT_2_ID, option_text: 'O(n^2)', is_correct: false }
        ]
      }
    ]

    await client.query(`
      INSERT INTO quizzes (id, module_id, is_ai_generated, latest, published)
      VALUES ($1, $2, false, 1, 1)
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_QUIZ_ID, DEMO_MODULE_ID])

    await client.query(`
      INSERT INTO quiz_revisions (quiz_id, revision, title, status, questions)
      VALUES ($1, 1, 'Complexity & Trees Check', 'approved', $2::jsonb)
      ON CONFLICT (quiz_id, revision) DO NOTHING
    `, [DEMO_QUIZ_ID, JSON.stringify(questions)])

    await client.query(`
      INSERT INTO assignments (id, course_id, title, instructions, due_date, rubric)
      VALUES (
        $1, $2,
        'Lab 1: Merge Sort & Inversions',
        'Implement divide-and-conquer inversion counting in O(n log n) time using synthetic test cases.',
        now() + interval '14 days',
        $3::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `, [
      DEMO_ASSIGNMENT_ID,
      DEMO_COURSE_ID,
      JSON.stringify([{ id: DEMO_CRITERION_ID, label: 'Asymptotic Correctness', max_points: 100 }])
    ])

    await client.query(`
      INSERT INTO enrollments (user_id, course_id, progress_percent)
      VALUES ($1, $2, 50)
      ON CONFLICT (user_id, course_id) DO NOTHING
    `, [student.id, DEMO_COURSE_ID])

    await client.query(`
      INSERT INTO discussion_threads (id, course_id, created_by, title)
      VALUES ($1, $2, $3, 'Week 1 Study Group: Asymptotic Bounds')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_THREAD_ID, DEMO_COURSE_ID, instructor.id])

    await client.query(`
      INSERT INTO discussion_posts (id, thread_id, user_id, content)
      VALUES ($1, $2, $3, 'Welcome to Data Structures and Algorithms! Share your recurrence questions in this thread.')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_ROOT_POST_ID, DEMO_THREAD_ID, instructor.id])

    await client.query(`
      INSERT INTO announcements (id, course_id, posted_by, content)
      VALUES ($1, $2, $3, 'Syllabus published: Module 1 practice quiz and Lab 1 rubric are live.')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_ANNOUNCEMENT_ID, DEMO_COURSE_ID, instructor.id])

    await bumpCatalogGeneration(client)
  })
  console.log(`Seeded DSA reference demo course ${DEMO_COURSE_ID}`)
} finally {
  await db.end()
}
