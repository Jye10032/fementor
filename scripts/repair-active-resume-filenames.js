const fs = require('fs');
const path = require('path');
const Database = require('../apps/api/node_modules/better-sqlite3');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const USER_DOC_ROOT = path.join(DATA_ROOT, 'user_docs');
const DB_PATH = path.join(DATA_ROOT, 'fementor.db');

const db = new Database(DB_PATH);

const isGenericResumeFile = (fileName) => /^resume(?:-\d+)?\.md$/i.test(fileName);
const isMeaningfulResumeFile = (fileName) => /^resume-.+\.md$/i.test(fileName) && !/^resume-\d+\.md$/i.test(fileName);

const isPlaceholderContent = (content) => {
  const normalized = String(content || '').trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 32 && ['demo', 'test', 'placeholder'].includes(normalized);
};

const repairUser = (userId) => {
  const user = db.prepare('SELECT active_resume_file FROM user_profile WHERE id = ?').get(userId);
  if (!user?.active_resume_file || !isGenericResumeFile(user.active_resume_file)) {
    return null;
  }

  const profileDir = path.join(USER_DOC_ROOT, userId, 'profile');
  if (!fs.existsSync(profileDir)) {
    return null;
  }

  const activePath = path.join(profileDir, user.active_resume_file);
  if (!fs.existsSync(activePath)) {
    return null;
  }

  const activeContent = fs.readFileSync(activePath, 'utf8');
  if (activeContent.trim().length < 100) {
    return null;
  }

  const placeholderCandidates = fs.readdirSync(profileDir)
    .filter((fileName) => isMeaningfulResumeFile(fileName))
    .filter((fileName) => {
      const content = fs.readFileSync(path.join(profileDir, fileName), 'utf8');
      return isPlaceholderContent(content);
    });

  if (placeholderCandidates.length !== 1) {
    return null;
  }

  const targetName = placeholderCandidates[0];
  const targetPath = path.join(profileDir, targetName);

  fs.writeFileSync(targetPath, activeContent, 'utf8');
  fs.unlinkSync(activePath);
  db.prepare('UPDATE user_profile SET active_resume_file = ?, updated_at = ? WHERE id = ?')
    .run(targetName, new Date().toISOString(), userId);

  return {
    user_id: userId,
    from: user.active_resume_file,
    to: targetName,
  };
};

const run = () => {
  const userIds = db.prepare('SELECT id FROM user_profile').all().map((row) => row.id);
  const repaired = userIds.map(repairUser).filter(Boolean);
  console.log(JSON.stringify({ repaired: repaired.length, items: repaired }, null, 2));
};

try {
  run();
} finally {
  db.close();
}
