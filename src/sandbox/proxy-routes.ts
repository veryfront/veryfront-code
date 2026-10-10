import { REQUEST_ERROR } from "#veryfront/errors";
import type { CommandOptions } from "./types.ts";

const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;

export function sandboxSessionRoute(
  apiUrl: string,
  sessionId: string,
  path = "",
): string {
  const normalizedApiUrl = applyIntrinsic(stringReplace, apiUrl, [/\/+$/, ""]) as string;
  const base = `${normalizedApiUrl}/sandboxes/${encodeURIComponent(sessionId)}`;
  return path ? `${base}${path}` : base;
}

export async function readSandboxFileContent(res: Response): Promise<string> {
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return await res.text();
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw REQUEST_ERROR.create({
      detail: "Sandbox file response is not valid JSON",
      cause,
    });
  }

  const content = json && typeof json === "object"
    ? (json as { content?: unknown }).content
    : undefined;
  if (typeof content !== "string") {
    throw REQUEST_ERROR.create({ detail: "Sandbox file response missing content" });
  }

  return content;
}

/** @internal Allow synchronous execution plus transport slack without disabling the default bound. */
export function sandboxCommandRequestTimeoutMs(options?: CommandOptions): number {
  return options?.timeoutSeconds === undefined ? 60_000 : (options.timeoutSeconds + 5) * 1000;
}

/** @internal Keep a deadline active until the complete asynchronous operation has settled. */
export async function withSandboxRequestDeadline<T>(
  timeoutMs: number,
  action: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) return await action(undefined);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
