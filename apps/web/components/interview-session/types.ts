import { RefObject } from "react";

export type InterviewQuestion = {
  id: string;
  session_id: string;
  order_no: number;
  source: "resume" | "doc" | "llm" | "experience";
  question_type: "basic" | "project" | "scenario" | "follow_up";
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  status: "pending" | "asked" | "answered" | "skipped";
};

export type TurnResponse = {
  session_id: string;
  question_id?: string | null;
  turn_id: string | null;
  turn_index: number;
  intent?: "answer" | "clarify" | "question_back" | "skip" | "meta" | "invalid";
  handled_as?: "answer" | "non_answer" | "skip";
  current_question_status?: InterviewQuestion["status"];
  score?: number;
  strengths?: string[];
  weaknesses?: string[];
  feedback?: string;
  standard_answer?: string;
  evaluation_text?: string;
  reply_text?: string;
  retrieval_strategy?: string;
  evidence_refs_count?: number;
  next_question?: InterviewQuestion | null;
};

export type TurnRecord = TurnResponse & {
  question: string;
  answer: string;
};

export type InterviewTurnHistoryItem = {
  id: string;
  session_id: string;
  question_id?: string | null;
  turn_index: number;
  question: string;
  answer: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  evidence_refs_count: number;
  created_at: string;
};

export type RetrospectResponse = {
  session_id: string;
  chapter: string;
  avg_score: number;
  turns_count: number;
  promoted_questions: number;
  promoted_new_questions: number;
  promoted_updated_questions: number;
  memory_path?: string;
  long_term_memory?: {
    stable_strengths: string[];
    stable_weaknesses: string[];
    project_signals: string[];
    role_fit_signals: string[];
    recommended_focus: string[];
  };
};

export type QuestionQueueResponse = {
  session_id: string;
  items: InterviewQuestion[];
  current_question: InterviewQuestion | null;
};

export type TurnHistoryResponse = {
  session_id: string;
  items: InterviewTurnHistoryItem[];
};

export type ConversationRow = {
  id: string;
  role: "user" | "assistant";
  kind: "answer" | "evaluation" | "notice";
  content: string;
};

export type InterviewTurnStageEvent = {
  step: string;
  message: string;
};

export type InterviewTurnTokenEvent = {
  textChunk?: string;
  timestamp?: string;
};

export type QuestionCardMode = "active" | "transition" | "completed";

export type StageStep =
  | "idle"
  | "receiving"
  | "retrieving"
  | "evaluating"
  | "deciding"
  | "generating_followup"
  | "transition"
  | "completed";

export type PanelTab = "progress" | "queue" | "retrospect";

export type ComposerTextareaRef = RefObject<HTMLTextAreaElement>;

export type Props = {
  initialSessionId: string;
};

export type InterviewSessionDetail = {
  id: string;
  user_id?: string;
  status: "in_progress" | "completed";
  summary: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};
