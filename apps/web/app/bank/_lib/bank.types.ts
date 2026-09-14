export type BankItem = {
  id: string;
  chapter: string;
  question: string;
  difficulty: string;
  weakness_tag: string;
  review_status: string;
  next_review_at: string | null;
  source_question_type?: string;
  source_question_source?: string;
  tags: string[];
};

export type BankResponse = {
  user_id?: string;
  chapter: string | null;
  items: BankItem[];
};

export type OfficialQuestion = {
  id: string;
  canonical_question: string;
  question_text: string;
  category: string;
  difficulty: string;
  track: string;
  chapter: string;
  knowledge_points: string[];
  expected_points: string[];
  is_imported: boolean;
  read_only: true;
  updated_at: string;
};

export type OfficialQuestionBankResponse = {
  items: OfficialQuestion[];
  total: number;
  source: "remote_official";
  read_only: true;
};

export type OfficialQuestionBankStatus = {
  configured: boolean;
  reachable: boolean;
  read_only?: boolean;
  total: number;
  last_error?: string;
};
