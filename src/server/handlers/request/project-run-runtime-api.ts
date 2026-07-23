import { getEnvironmentConfig } from "#veryfront/config";
import { API_CLIENT_ERROR, INVALID_ARGUMENT, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import type { HandlerContext } from "../types.ts";
import type { EvalReportUploadInput } from "./project-run-types.ts";

export interface ProjectRunRuntimeApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export function getProjectRunRuntimeApiToken(req: Request, ctx: HandlerContext): string {
  return req.headers.get("x-token") ?? ctx.proxyToken ?? ctx.requestContext?.token ?? "";
}

export function createProjectRunRuntimeApiClient(
  req: Request,
  ctx: HandlerContext,
): ProjectRunRuntimeApiClient {
  const apiUrl = getEnvironmentConfig().apiBaseUrl;
  const token = getProjectRunRuntimeApiToken(req, ctx);
  if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

  async function requestJson<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw API_CLIENT_ERROR.create({
        detail: `Veryfront API request failed: ${response.status} ${response.statusText}`,
      });
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  return {
    get: (path, params) => requestJson("GET", path, undefined, params),
    post: (path, body) => requestJson("POST", path, body),
    put: (path, body) => requestJson("PUT", path, body),
    patch: (path, body) => requestJson("PATCH", path, body),
    delete: (path) => requestJson("DELETE", path),
  };
}

export async function uploadEvalReportToProjectFiles(
  input: EvalReportUploadInput,
): Promise<string | null> {
  const client = createProjectRunRuntimeApiClient(input.req, input.ctx);
  const encodedProject = encodeURIComponent(input.projectReference);
  const encodedPath = encodeURIComponent(input.reportPath);
  const reportWithPath = { ...input.report, reportPath: input.reportPath };
  const response = await client.put<{ path?: string }>(
    `/projects/${encodedProject}/files/${encodedPath}`,
    { content: `${JSON.stringify(reportWithPath, null, 2)}\n` },
  );
  return response.path ?? input.reportPath;
}

export async function resolveProjectRunUploadIdsToPaths(
  client: ProjectRunRuntimeApiClient,
  projectReference: string,
  uploadIds: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const uploadId of uploadIds) {
    const upload = await client.get<{ path?: string }>(
      `/projects/${encodeURIComponent(projectReference)}/uploads/${encodeURIComponent(uploadId)}`,
    );
    if (!upload.path) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Upload not found: ${uploadId}` });
    }
    paths.push(upload.path);
  }
  return paths;
}
