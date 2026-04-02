CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  clerk_user_id text UNIQUE NOT NULL,
  email text,
  name text,
  avatar_url text,
  role text NOT NULL DEFAULT 'user',
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  resume_summary text NOT NULL DEFAULT '',
  resume_structured_json text NOT NULL DEFAULT '',
  active_resume_file text NOT NULL DEFAULT '',
  active_jd_file text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id);

CREATE TABLE IF NOT EXISTS resume_parse_usage (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  file_hash text,
  source_type text NOT NULL,
  engine text,
  status text NOT NULL,
  charged boolean NOT NULL DEFAULT false,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resume_parse_usage_user_created
  ON resume_parse_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_parse_usage_user_source_created
  ON resume_parse_usage(user_id, source_type, created_at DESC);

CREATE TABLE IF NOT EXISTS resume_parse_cache (
  id text PRIMARY KEY,
  user_id text,
  file_hash text UNIQUE NOT NULL,
  source_type text NOT NULL,
  parsed_text text NOT NULL,
  summary text NOT NULL,
  parse_meta jsonb,
  original_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_parse_cache_file_hash ON resume_parse_cache(file_hash);

CREATE TABLE IF NOT EXISTS interview_session (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL,
  summary text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  keyword_queue_json text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_session_user_created
  ON interview_session(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interview_turn (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  question_id text,
  turn_index integer NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  strengths_json text NOT NULL,
  weaknesses_json text NOT NULL,
  evidence_refs_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_turn_session_turn_index
  ON interview_turn(session_id, turn_index);

CREATE TABLE IF NOT EXISTS interview_question (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  order_no integer NOT NULL,
  source text NOT NULL DEFAULT 'llm',
  question_type text NOT NULL DEFAULT 'basic',
  difficulty text NOT NULL DEFAULT 'medium',
  stem text NOT NULL,
  expected_points_json text NOT NULL DEFAULT '[]',
  resume_anchor text NOT NULL DEFAULT '',
  source_ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  keyword text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_question_session_order
  ON interview_question(session_id, order_no);
CREATE INDEX IF NOT EXISTS idx_interview_question_session_status
  ON interview_question(session_id, status, order_no);

CREATE TABLE IF NOT EXISTS chat_session (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_session_user_updated
  ON chat_session(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_message_session_created
  ON chat_message(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS question_source (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  source_ref_id text NOT NULL,
  canonical_question text NOT NULL,
  question_text text NOT NULL,
  normalized_question text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'medium',
  track text NOT NULL DEFAULT '',
  chapter text NOT NULL DEFAULT '',
  knowledge_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  merged_into_source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_source_source_ref
  ON question_source(source_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_question_source_track_chapter
  ON question_source(track, chapter, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_source_canonical
  ON question_source(canonical_question, track, chapter);

CREATE TABLE IF NOT EXISTS user_question_bank (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  question_source_id text NOT NULL,
  track text NOT NULL DEFAULT '',
  chapter text NOT NULL DEFAULT '',
  custom_question_text text NOT NULL DEFAULT '',
  review_status text NOT NULL DEFAULT 'pending',
  mastery_level integer NOT NULL DEFAULT 0,
  weakness_tag text NOT NULL DEFAULT '',
  next_review_at timestamptz,
  last_practiced_at timestamptz,
  is_favorited boolean NOT NULL DEFAULT false,
  source_channel text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_question_bank_user_source
  ON user_question_bank(user_id, question_source_id);
CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_chapter
  ON user_question_bank(user_id, chapter, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_review
  ON user_question_bank(user_id, review_status, next_review_at);

CREATE TABLE IF NOT EXISTS question_attempt (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  user_question_bank_id text NOT NULL,
  session_type text NOT NULL,
  session_id text,
  answer text NOT NULL DEFAULT '',
  score integer NOT NULL DEFAULT 0,
  strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback text NOT NULL DEFAULT '',
  mastered boolean NOT NULL DEFAULT false,
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_attempt_user_question_bank_created
  ON question_attempt(user_question_bank_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public_source_sync_state (
  id text PRIMARY KEY,
  source_name text NOT NULL,
  last_synced_at timestamptz,
  last_server_time timestamptz,
  last_sync_status text NOT NULL DEFAULT 'idle',
  last_error_message text NOT NULL DEFAULT '',
  local_item_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_source_sync_state_source_name
  ON public_source_sync_state(source_name);

CREATE TABLE IF NOT EXISTS attempt (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  mode text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attempt_user_created
  ON attempt(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_ref (
  id text PRIMARY KEY,
  attempt_id text NOT NULL,
  source_type text NOT NULL,
  source_uri text NOT NULL,
  quote text NOT NULL,
  confidence double precision
);

CREATE INDEX IF NOT EXISTS idx_evidence_ref_attempt
  ON evidence_ref(attempt_id);

CREATE TABLE IF NOT EXISTS score_report (
  id text PRIMARY KEY,
  attempt_id text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_report_attempt
  ON score_report(attempt_id);

CREATE TABLE IF NOT EXISTS weakness_tag (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  tag text NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weakness_tag_user_tag
  ON weakness_tag(user_id, tag);

CREATE TABLE IF NOT EXISTS experience_sync_job (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  keyword text NOT NULL,
  status text NOT NULL,
  requested_limit integer NOT NULL DEFAULT 10,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experience_sync_job_user_created
  ON experience_sync_job(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experience_sync_job_status
  ON experience_sync_job(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS experience_post (
  id text PRIMARY KEY,
  source_platform text NOT NULL,
  source_post_id text NOT NULL,
  source_url text NOT NULL,
  keyword text NOT NULL DEFAULT '',
  title text NOT NULL,
  author_name text NOT NULL DEFAULT '',
  published_at timestamptz,
  content_raw text NOT NULL,
  content_cleaned text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  role_name text NOT NULL DEFAULT '',
  interview_stage text NOT NULL DEFAULT '未知',
  quality_score integer NOT NULL DEFAULT 0,
  popularity integer NOT NULL DEFAULT 0,
  is_valid boolean NOT NULL DEFAULT true,
  clean_status text NOT NULL DEFAULT 'pending',
  crawl_job_id text,
  content_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_experience_post_source_unique
  ON experience_post(source_platform, source_post_id);
CREATE INDEX IF NOT EXISTS idx_experience_post_published
  ON experience_post(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_experience_post_job
  ON experience_post(crawl_job_id);
CREATE INDEX IF NOT EXISTS idx_experience_post_company_role
  ON experience_post(company_name, role_name, published_at DESC);

CREATE TABLE IF NOT EXISTS experience_question_group (
  id text PRIMARY KEY,
  post_id text NOT NULL,
  topic_cluster text NOT NULL DEFAULT '',
  canonical_question text NOT NULL DEFAULT '',
  group_order integer NOT NULL DEFAULT 0,
  group_type text NOT NULL DEFAULT 'single',
  frequency_score double precision NOT NULL DEFAULT 0,
  confidence double precision NOT NULL DEFAULT 0,
  embedding_json text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experience_question_group_post
  ON experience_question_group(post_id, group_order ASC);

CREATE TABLE IF NOT EXISTS experience_question_item (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  post_id text NOT NULL,
  question_text_raw text NOT NULL,
  question_text_normalized text NOT NULL DEFAULT '',
  question_role text NOT NULL DEFAULT 'main',
  order_in_group integer NOT NULL DEFAULT 0,
  parent_item_id text,
  category text NOT NULL DEFAULT '其他',
  difficulty text NOT NULL DEFAULT 'medium',
  follow_up_intent text NOT NULL DEFAULT 'clarify',
  expected_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  knowledge_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding_id text NOT NULL DEFAULT '',
  chain_anchor text NOT NULL DEFAULT 'generic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experience_question_item_post
  ON experience_question_item(post_id, order_in_group ASC);
CREATE INDEX IF NOT EXISTS idx_experience_question_item_group
  ON experience_question_item(group_id, order_in_group ASC);
CREATE INDEX IF NOT EXISTS idx_experience_question_item_category
  ON experience_question_item(category, difficulty);
CREATE INDEX IF NOT EXISTS idx_experience_question_item_role
  ON experience_question_item(question_role);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_parse_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_parse_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_source_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weakness_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_post ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_question_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_question_item ENABLE ROW LEVEL SECURITY;
