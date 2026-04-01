const { db } = require('./core');

const upsertUser = ({
  id,
  name,
  resume_summary,
  resume_structured_json,
  active_resume_file,
  active_jd_file,
}) => {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, name, resume_summary, resume_structured_json, active_resume_file, active_jd_file FROM user_profile WHERE id = ?')
    .get(id);

  if (existing) {
    const nextName = name !== undefined ? name : existing.name;
    const nextResumeSummary = resume_summary !== undefined ? resume_summary : existing.resume_summary;
    const nextResumeStructuredJson = resume_structured_json !== undefined ? resume_structured_json : existing.resume_structured_json;
    const nextActiveResumeFile = active_resume_file !== undefined ? active_resume_file : existing.active_resume_file;
    const nextActiveJdFile = active_jd_file !== undefined ? active_jd_file : existing.active_jd_file;

    db.prepare(
      `
      UPDATE user_profile
      SET name = ?, resume_summary = ?, resume_structured_json = ?, active_resume_file = ?, active_jd_file = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(nextName, nextResumeSummary, nextResumeStructuredJson, nextActiveResumeFile, nextActiveJdFile, now, id);
    return { id, updated_at: now, created: false };
  }

  db.prepare(
    `
    INSERT INTO user_profile (id, name, resume_summary, resume_structured_json, active_resume_file, active_jd_file, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, name || '', resume_summary || '', resume_structured_json || '', active_resume_file || '', active_jd_file || '', now, now);

  return { id, updated_at: now, created: true };
};

const getUserById = (id) =>
  db
    .prepare(
      `
      SELECT id, name, resume_summary, resume_structured_json, active_resume_file, active_jd_file, created_at, updated_at
      FROM user_profile
      WHERE id = ?
    `,
    )
    .get(id);

const setActiveResumeFile = ({ userId, fileName, resumeSummary, resumeStructuredJson }) => {
  const now = new Date().toISOString();
  const result = db.prepare(
    `
    UPDATE user_profile
    SET active_resume_file = ?, resume_summary = ?, resume_structured_json = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(fileName, resumeSummary, resumeStructuredJson || '', now, userId);
  if (result.changes === 0) {
    throw new Error('user not found');
  }
  return getUserById(userId);
};

const setActiveJdFile = ({ userId, fileName }) => {
  const now = new Date().toISOString();
  const result = db.prepare(
    `
    UPDATE user_profile
    SET active_jd_file = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(fileName, now, userId);
  if (result.changes === 0) {
    throw new Error('user not found');
  }
  return getUserById(userId);
};

module.exports = {
  getUserById,
  setActiveJdFile,
  setActiveResumeFile,
  upsertUser,
};
