CREATE TABLE agent_runtime_session (
  id text PRIMARY KEY,
  interview_session_id text NOT NULL,
  runtime_id text NOT NULL,
  external_session_id text,
  runtime_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT fk_agent_runtime_session_interview_session
    FOREIGN KEY (interview_session_id) REFERENCES interview_session(id) ON DELETE RESTRICT,
  CONSTRAINT chk_agent_runtime_session_status
    CHECK (status IN ('active', 'closed', 'failed')),
  CONSTRAINT chk_agent_runtime_session_closed_at
    CHECK (
      (status = 'active' AND closed_at IS NULL)
      OR (status IN ('closed', 'failed') AND closed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_agent_runtime_session_active_interview_runtime
  ON agent_runtime_session(interview_session_id, runtime_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX idx_agent_runtime_session_external
  ON agent_runtime_session(runtime_id, external_session_id)
  WHERE external_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_agent_runtime_session_id_interview
  ON agent_runtime_session(id, interview_session_id);
CREATE INDEX idx_agent_runtime_session_status_created
  ON agent_runtime_session(status, created_at DESC);

CREATE UNIQUE INDEX idx_interview_turn_session_id
  ON interview_turn(session_id, id);

CREATE TABLE agent_run (
  id text PRIMARY KEY,
  runtime_session_id text NOT NULL,
  interview_session_id text NOT NULL,
  interview_turn_id text,
  task_type text NOT NULL,
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  skill_name text NOT NULL DEFAULT '',
  skill_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'running',
  deadline_ms integer NOT NULL,
  max_steps integer NOT NULL,
  max_tokens integer,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_usd numeric(18, 8),
  error_category text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT fk_agent_run_runtime_interview_session
    FOREIGN KEY (runtime_session_id, interview_session_id)
    REFERENCES agent_runtime_session(id, interview_session_id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_run_interview_turn
    FOREIGN KEY (interview_session_id, interview_turn_id)
    REFERENCES interview_turn(session_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_agent_run_status
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'timed_out')),
  CONSTRAINT chk_agent_run_budget
    CHECK (deadline_ms > 0 AND max_steps > 0 AND (max_tokens IS NULL OR max_tokens > 0)),
  CONSTRAINT chk_agent_run_metrics
    CHECK (
      (duration_ms IS NULL OR duration_ms >= 0)
      AND (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
      AND (total_tokens IS NULL OR total_tokens >= 0)
      AND (cost_usd IS NULL OR cost_usd >= 0)
    ),
  CONSTRAINT chk_agent_run_completed_at
    CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR (status <> 'running' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX idx_agent_run_runtime_session_started
  ON agent_run(runtime_session_id, started_at DESC);
CREATE INDEX idx_agent_run_interview_turn
  ON agent_run(interview_turn_id)
  WHERE interview_turn_id IS NOT NULL;
CREATE INDEX idx_agent_run_status_started
  ON agent_run(status, started_at DESC);

ALTER TABLE public.agent_runtime_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run ENABLE ROW LEVEL SECURITY;
