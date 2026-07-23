export function sandboxSessionRoute(
  apiUrl: string,
  sessionId: string,
  path = "",
): string {
  const base = `${apiUrl}/sandbox-sessions/${encodeURIComponent(sessionId)}`;
  return path ? `${base}${path}` : base;
}

export async function readSandboxFileContent(res: Response): Promise<string> {
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return await res.text();
  }

  const json = await res.json();
  if (typeof json?.content !== "string") {
    throw new Error("Sandbox file response missing content");
  }

  return json.content;
}
