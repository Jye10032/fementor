-- Pending input is durable independently of the atomic score/queue commit.
CREATE TABLE interview_answer_submission (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retryable', 'completed')),
  attempt_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_answer_submission_session ON interview_answer_submission(session_id, created_at);
CREATE UNIQUE INDEX idx_answer_submission_running ON interview_answer_submission(session_id) WHERE status = 'running';
ALTER TABLE interview_answer_submission ENABLE ROW LEVEL SECURITY;
