export type ExperienceSyncJob = {
  id: string;
  keyword: string;
  status: "pending" | "running" | "completed" | "failed";
  requested_limit: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string;
};

export type ExperienceListItem = {
  id: string;
  title: string;
  source_platform: string;
  source_url: string;
  company_name: string;
  role_name: string;
  interview_stage: string;
  published_at: string;
  summary: string;
  popularity: number;
  question_group_count: number;
  question_item_count: number;
};

export type ExperienceListResponse = {
  items: ExperienceListItem[];
  page: number;
  page_size: number;
  total: number;
};

export type ExperienceQuestionItem = {
  id: string;
  group_id: string;
  post_id: string;
  question_text_raw: string;
  question_text_normalized: string;
  question_role: string;
  order_in_group: number;
  parent_item_id: string | null;
  category: string;
  difficulty: string;
  follow_up_intent: string;
  expected_points: string[];
  knowledge_points: string[];
};

export type ExperienceQuestionGroup = {
  id: string;
  post_id: string;
  topic_cluster: string;
  canonical_question: string;
  group_order: number;
  group_type: string;
  frequency_score: number;
  confidence: number;
  items: ExperienceQuestionItem[];
};

export type ExperienceDetail = {
  id: string;
  source_platform: string;
  source_post_id: string;
  source_url: string;
  keyword: string;
  title: string;
  author_name: string;
  published_at: string;
  content_raw: string;
  content_cleaned: string;
  summary: string;
  company_name: string;
  role_name: string;
  interview_stage: string;
  popularity: number;
  is_valid: number;
  clean_status: string;
  groups: ExperienceQuestionGroup[];
};

export type ExperienceDetailResponse = {
  item: ExperienceDetail;
};

export type ExperienceRecleanResponse = {
  item: ExperienceDetail;
  message: string;
};

export type ExperienceSyncCreateResponse = {
  job_id: string;
  status: ExperienceSyncJob["status"];
};

export type ExperienceSyncStatusResponse = {
  job: ExperienceSyncJob;
};
