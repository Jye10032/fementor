const { db } = require('./core');

const createChatSession = ({ id, userId, title }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO chat_session (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, userId, title || '', now, now);
  return { id, user_id: userId, title: title || '', created_at: now, updated_at: now };
};

const getChatSession = (sessionId) =>
  db
    .prepare(
      `
      SELECT id, user_id, title, created_at, updated_at
      FROM chat_session
      WHERE id = ?
    `,
    )
    .get(sessionId);

const addChatMessage = ({ id, sessionId, role, content }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO chat_message (id, session_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, sessionId, role, content, now);
  db.prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?').run(now, sessionId);
  return { id, session_id: sessionId, role, content, created_at: now };
};

const listChatMessages = (sessionId, limit = 100) =>
  db
    .prepare(
      `
      SELECT id, session_id, role, content, created_at
      FROM chat_message
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `,
    )
    .all(sessionId, limit);

module.exports = {
  addChatMessage,
  createChatSession,
  getChatSession,
  listChatMessages,
};
