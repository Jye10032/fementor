const { db } = require('./core');

const saveScoringResult = ({
  attemptId,
  scoreReportId,
  userId,
  mode,
  question,
  answer,
  evidenceRefs,
  score,
  strengths,
  weaknesses,
  feedback,
  weaknessRows,
}) => {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO attempt (id, user_id, mode, question, answer, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(attemptId, userId, mode, question, answer, now);

    const insertEvidence = db.prepare(
      `
      INSERT INTO evidence_ref (id, attempt_id, source_type, source_uri, quote, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    );
    for (const row of evidenceRefs) {
      insertEvidence.run(
        row.id,
        attemptId,
        row.source_type,
        row.source_uri,
        row.quote,
        row.confidence,
      );
    }

    db.prepare(
      `
      INSERT INTO score_report (id, attempt_id, score, strengths_json, weaknesses_json, feedback, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      scoreReportId,
      attemptId,
      score,
      JSON.stringify(strengths),
      JSON.stringify(weaknesses),
      feedback,
      now,
    );

    const findWeakness = db.prepare(
      'SELECT id, hit_count FROM weakness_tag WHERE user_id = ? AND tag = ?',
    );
    const updateWeakness = db.prepare(
      'UPDATE weakness_tag SET hit_count = ?, last_seen_at = ? WHERE id = ?',
    );
    const insertWeakness = db.prepare(
      'INSERT INTO weakness_tag (id, user_id, tag, hit_count, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const w of weaknessRows) {
      const existing = findWeakness.get(userId, w.tag);
      if (existing) {
        updateWeakness.run(existing.hit_count + 1, now, existing.id);
      } else {
        insertWeakness.run(w.id, userId, w.tag, 1, now);
      }
    }
  });

  tx();
};

const getWeaknessesByUser = (userId, limit = 20) =>
  db
    .prepare(
      `
      SELECT tag, hit_count, last_seen_at
      FROM weakness_tag
      WHERE user_id = ?
      ORDER BY hit_count DESC, last_seen_at DESC
      LIMIT ?
    `,
    )
    .all(userId, limit);

const listAttemptsByUser = (userId, limit = 20) =>
  db
    .prepare(
      `
      SELECT a.id, a.user_id, a.mode, a.question, a.answer, a.created_at, sr.score
      FROM attempt a
      LEFT JOIN score_report sr ON sr.attempt_id = a.id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `,
    )
    .all(userId, limit);

module.exports = {
  getWeaknessesByUser,
  listAttemptsByUser,
  saveScoringResult,
};
