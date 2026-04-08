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
