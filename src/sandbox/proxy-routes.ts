import { REQUEST_ERROR } from "#veryfront/errors";
import { MAX_SANDBOX_FILE_RESPONSE_BYTES, readBoundedSandboxText } from "./transport.ts";

export function sandboxSessionRoute(
  apiUrl: string,
  sessionId: string,
  path = "",
): string {
  const base = `${apiUrl.replace(/\/+$/, "")}/sandbox-sessions/${encodeURIComponent(sessionId)}`;
  return path ? `${base}${path}` : base;
}

export async function readSandboxFileContent(
  res: Response,
  options: {
    operation?: string;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const operation = options.operation ?? "Sandbox file read";
  const text = await readBoundedSandboxText(res, {
    operation,
    maxBytes: options.maxBytes ?? MAX_SANDBOX_FILE_RESPONSE_BYTES,
    signal: options.signal,
  });
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return text;
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
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
