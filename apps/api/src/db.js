const { DB_PATH } = require('./db/core');
const { init } = require('./db/init');
const users = require('./db/users');
const scoring = require('./db/scoring');
const interview = require('./db/interview');
const questionBank = require('./db/question-bank');
const chat = require('./db/chat');
const experience = require('./db/experience');
const questionSource = require('./db/question-source');
const publicSourceSync = require('./db/public-source-sync');

module.exports = {
  DB_PATH,
  init,
  ...users,
  ...scoring,
  ...interview,
  ...questionBank,
  ...chat,
  ...experience,
  ...questionSource,
  ...publicSourceSync,
};
