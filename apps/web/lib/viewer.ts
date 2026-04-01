import { apiRequest } from "./api";

export type ViewerCapabilities = {
  can_use_resume_ocr?: boolean;
  daily_resume_ocr_limit?: number;
  remaining_resume_ocr_count?: number;
  daily_interview_session_limit?: number;
  remaining_interview_session_count?: number;
  can_manage_public_sources?: boolean;
};

export type Viewer = {
  id: string;
  auth_user_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  role?: string;
  plan: string;
  capabilities?: ViewerCapabilities;
  runtime_mode?: string;
  public_source_driver?: string;
  public_source_storage_target?: string;
};

export type ViewerResponse = {
  viewer: Viewer;
};

export async function fetchViewer(baseUrl: string) {
  return apiRequest<ViewerResponse>(baseUrl, "/v1/me", { auth: "required" });
}
