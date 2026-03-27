import { apiRequest } from "./api";

export type ViewerCapabilities = {
  can_use_resume_ocr?: boolean;
  daily_resume_ocr_limit?: number;
  remaining_resume_ocr_count?: number;
};

export type Viewer = {
  id: string;
  auth_user_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  plan: string;
  capabilities?: ViewerCapabilities;
};

export type ViewerResponse = {
  viewer: Viewer;
};

export async function fetchViewer(baseUrl: string) {
  return apiRequest<ViewerResponse>(baseUrl, "/v1/me", { auth: "required" });
}
