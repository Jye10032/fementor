export type StartSessionResponse = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
};

export type ResumeFile = {
  name: string;
  summary: string;
  original_filename: string;
  updated_at: string;
};

export type ResumeLibraryResponse = {
  user_id: string;
  has_resume: boolean;
  profile: {
    id: string;
    name: string;
    resume_summary: string;
    active_resume_file: string;
    updated_at: string;
  } | null;
  files: ResumeFile[];
};

export type JdFile = {
  name: string;
  updated_at: string;
};

export type JdLibraryResponse = {
  user_id: string;
  has_jd: boolean;
  profile: {
    id: string;
    name: string;
    active_jd_file: string;
    updated_at: string;
  } | null;
  files: JdFile[];
};

export type InterviewSession = {
  id: string;
  user_id: string;
  status: "in_progress" | "completed";
  summary: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionListResponse = {
  user_id: string;
  items: InterviewSession[];
};
