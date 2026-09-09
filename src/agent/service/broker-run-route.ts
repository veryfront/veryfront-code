import { getRuntimeAgentRunIdSchema } from "../runtime/agent-invocation-contract.ts";

/** Decode one path segment and enforce the canonical runtime run ID contract. */
export function decodeBrokerRunId(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const parsed = getRuntimeAgentRunIdSchema().safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

/** Read the signed stream target without changing the path used for signature verification. */
export function parseBrokerSignedRunPath(pathname: string): string | null {
  const match = /^\/api\/control-plane\/runs\/([^/]+)\/stream$/u.exec(pathname);
  return match ? decodeBrokerRunId(match[1]!) : null;
}
