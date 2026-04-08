export type ResumeFile = {
  name: string;
  path: string;
  size: number;
  updated_at: string;
  summary: string;
  original_filename: string;
};

export type ResumeLibraryResponse = {
  has_resume: boolean;
  profile: {
    id: string;
    name: string;
    resume_summary: string;
    active_resume_file: string;
    active_jd_file?: string;
    updated_at: string;
  } | null;
  files: ResumeFile[];
};

export type JdFile = {
  name: string;
  path: string;
  size: number;
  updated_at: string;
  content?: string;
};

export type JdLibraryResponse = {
  has_jd: boolean;
  profile: {
    id: string;
    name: string;
    active_jd_file: string;
    updated_at: string;
  } | null;
  files: JdFile[];
};

export type Tab = "resume" | "jd";

export const TEXT_FILE_EXTENSIONS = ["txt", "md", "markdown", "json", "html", "htm", "csv"];
export const BINARY_RESUME_EXTENSIONS = ["pdf", "docx"];
export const RESUME_FILE_EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...BINARY_RESUME_EXTENSIONS];
export const JD_FILE_EXTENSIONS = TEXT_FILE_EXTENSIONS;

export function getFileExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}
