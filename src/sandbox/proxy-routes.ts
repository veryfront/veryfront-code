import { REQUEST_ERROR } from "#veryfront/errors";

const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;

export function sandboxSessionRoute(
  apiUrl: string,
  sessionId: string,
  path = "",
): string {
  const normalizedApiUrl = applyIntrinsic(stringReplace, apiUrl, [/\/+$/, ""]) as string;
  const base = `${normalizedApiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`;
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
