import { privateTextTrim } from "#veryfront/security/private-text.ts";

const JsonParse = JSON.parse;
const hasOwn = Object.hasOwn;

/**
 * A plain cancel may carry no body or a non-JSON one; only an explicit own flag opts in.
 * Captured intrinsics keep project prototype mutations from steering this decision.
 */
export function readRunStopConfirmation(rawBody: string): boolean {
  if (privateTextTrim(rawBody) === "") return false;
  try {
    const body: unknown = JsonParse(rawBody);
    return typeof body === "object" && body !== null && hasOwn(body, "confirmStopped") &&
      (body as { confirmStopped?: unknown }).confirmStopped === true;
  } catch {
    return false;
  }
}
