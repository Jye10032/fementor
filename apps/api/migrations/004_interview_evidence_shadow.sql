-- Additive shadow results: old interview scores and queue remain unchanged.
CREATE TABLE interview_evidence_evaluation (
  turn_id text NOT NULL REFERENCES interview_turn(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
  contract_version text NOT NULL CHECK (contract_version = 'evidence-v1'),
  input_hash text NOT NULL,
  result_json text NOT NULL,
  provenance_json text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (turn_id, contract_version)
);
CREATE INDEX idx_interview_evidence_session ON interview_evidence_evaluation(session_id);
ALTER TABLE interview_evidence_evaluation ENABLE ROW LEVEL SECURITY;
