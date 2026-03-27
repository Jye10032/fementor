export type JsonValue = Record<string, unknown>;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiRequestConfig = RequestInit & {
  auth?: "required" | "optional" | "none";
};

let resolveApiToken: () => Promise<string | null> = async () => null;

export function setApiTokenResolver(resolver: () => Promise<string | null>) {
  resolveApiToken = resolver;
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options?: ApiRequestConfig,
): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  const authMode = options?.auth ?? "optional";
  const token = authMode === "none" ? null : await resolveApiToken();

  if (authMode === "required" && !token) {
    throw new ApiError("请先登录后再继续。", 401);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error || `HTTP ${res.status}`, res.status);
  }
  return data;
}
