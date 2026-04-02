const path = require('path');
const dotenv = require('dotenv');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE || '').trim();

function getSslConfig() {
  return process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false };
}

function getPool() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString: DATABASE_URL,
    ssl: getSslConfig(),
  });
}

const SAMPLE_QUESTION_SOURCES = [
  {
    source_type: 'seed',
    source_ref_id: 'frontend-event-loop',
    canonical_question: 'Explain the JavaScript event loop',
    question_text: 'Explain the JavaScript event loop and the difference between macrotasks and microtasks.',
    normalized_question: 'explain javascript event loop microtasks macrotasks',
    category: 'interview',
    difficulty: 'medium',
    track: 'frontend',
    chapter: 'JavaScript',
    knowledge_points: ['event loop', 'microtask', 'macrotask'],
    expected_points: ['call stack', 'task queue', 'promise jobs'],
    metadata: { seeded: true },
  },
  {
    source_type: 'seed',
    source_ref_id: 'react-re-render',
    canonical_question: 'What causes React components to re-render',
    question_text: 'What causes React components to re-render, and how do you reduce unnecessary re-renders?',
    normalized_question: 'react rerender causes reduce unnecessary rerenders',
    category: 'interview',
    difficulty: 'medium',
    track: 'frontend',
    chapter: 'React',
    knowledge_points: ['state update', 'props', 'memo'],
    expected_points: ['state changes', 'parent render', 'memoization tradeoff'],
    metadata: { seeded: true },
  },
  {
    source_type: 'seed',
    source_ref_id: 'browser-reflow-repaint',
    canonical_question: 'Reflow vs repaint',
    question_text: 'What is the difference between reflow and repaint in the browser rendering pipeline?',
    normalized_question: 'difference between reflow and repaint browser rendering',
    category: 'interview',
    difficulty: 'easy',
    track: 'frontend',
    chapter: 'Browser',
    knowledge_points: ['layout', 'paint', 'render tree'],
    expected_points: ['layout invalidation', 'paint only change'],
    metadata: { seeded: true },
  },
];

async function run() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const item of SAMPLE_QUESTION_SOURCES) {
      await client.query(
        `
        INSERT INTO question_source (
          id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
          category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
          metadata_json, status, merged_into_source_id, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11::jsonb, $12::jsonb,
          $13::jsonb, 'active', NULL, now(), now()
        )
        ON CONFLICT (source_type, source_ref_id)
        DO UPDATE SET
          canonical_question = EXCLUDED.canonical_question,
          question_text = EXCLUDED.question_text,
          normalized_question = EXCLUDED.normalized_question,
          category = EXCLUDED.category,
          difficulty = EXCLUDED.difficulty,
          track = EXCLUDED.track,
          chapter = EXCLUDED.chapter,
          knowledge_points_json = EXCLUDED.knowledge_points_json,
          expected_points_json = EXCLUDED.expected_points_json,
          metadata_json = EXCLUDED.metadata_json,
          status = 'active',
          updated_at = now()
        `,
        [
          randomUUID(),
          item.source_type,
          item.source_ref_id,
          item.canonical_question,
          item.question_text,
          item.normalized_question,
          item.category,
          item.difficulty,
          item.track,
          item.chapter,
          JSON.stringify(item.knowledge_points),
          JSON.stringify(item.expected_points),
          JSON.stringify(item.metadata),
        ],
      );
    }
    await client.query('COMMIT');
    console.log(`[seed] upserted ${SAMPLE_QUESTION_SOURCES.length} question_source rows`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[seed.failed]', error.message);
  process.exit(1);
});
