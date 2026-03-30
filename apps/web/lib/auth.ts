import { Viewer } from "./viewer";

export type AuthUser = {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type AuthState = {
  authReady: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  authUser: AuthUser | null;
  viewer: Viewer | null;
  viewerLoading: boolean;
  viewerError: string | null;
  getToken: () => Promise<string | null>;
  refreshViewer: () => Promise<Viewer | null>;
};
