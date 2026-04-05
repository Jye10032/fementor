export type JsonValue = Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type ApiRequestConfig = RequestInit & {
  auth?: "required" | "optional" | "none";
};

let resolveApiToken: () => Promise<string | null> = async () => null;

async function readResponsePayload<T>(res: Response): Promise<T & { error?: string }> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.toLowerCase().includes("application/json")) {
    return (await res.json()) as T & { error?: string };
  }

  const text = await res.text();
  const compactText = text.replace(/\s+/g, " ").trim();
  const snippet = compactText.slice(0, 160) || `HTTP ${res.status}`;

  throw new ApiError(
    `接口返回了非 JSON 内容（${contentType || "unknown"}）。请检查 API Base 配置。响应片段：${snippet}`,
    res.status,
  );
}

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

  const method = (options?.method || "GET").toUpperCase();
  const useCache = method === "GET" && authMode === "none";

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
    ...(useCache ? {} : { cache: "no-store" as RequestCache }),
  });

  const data = await readResponsePayload<T>(res);
  if (!res.ok) {
    const payload = data as { error?: string; message?: string };
    throw new ApiError(payload.message || payload.error || `HTTP ${res.status}`, res.status, payload.error || null);
  }
  return data;
}
