-- Private, attempt-scoped, validated specialist output; never exposed by routes.
CREATE TABLE interview_agent_artifact (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES interview_answer_submission(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  expert TEXT NOT NULL CHECK (expert IN ('evaluate_answer', 'design_question')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (submission_id, attempt_id, call_id)
);
CREATE INDEX idx_agent_artifact_session ON interview_agent_artifact(session_id, created_at);
ALTER TABLE interview_agent_artifact ENABLE ROW LEVEL SECURITY;
