import { REQUEST_ERROR, type VeryfrontError } from "#veryfront/errors";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

const MAX_SANDBOX_ERROR_BODY_BYTES = 8 * 1024;
const SANDBOX_ERROR_BODY_TIMEOUT_MS = 5_000;

/** Keep the SDK error identity while exposing a bounded canonical API problem. */
function responseProblem(text: string, status: number): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const problem = value as Record<string, unknown>;
  if (problem.status !== status || status < 400 || status > 599) return undefined;
  const projected: Record<string, unknown> = { status };
  for (const key of ["type", "title", "slug", "category"] as const) {
    const field = problem[key];
    if (typeof field !== "string" || field.length === 0 || field.length > 2048) return undefined;
    projected[key] = field;
  }
  for (const key of ["detail", "instance", "suggestion"] as const) {
    const field = problem[key];
    if (typeof field === "string" && field.length <= 4096) projected[key] = field;
  }
  if (Array.isArray(problem.errors) && problem.errors.length <= 50) {
    const errors: Record<string, string>[] = [];
    for (const item of problem.errors) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const fields: Record<string, string> = {};
      for (const key of ["field", "message", "code"]) {
        const field = (item as Record<string, unknown>)[key];
        if (typeof field === "string" && field.length <= 1024) fields[key] = field;
      }
      errors.push(fields);
    }
    projected.errors = errors;
  }
  return projected;
}

/** @internal Preserve HTTP status without changing the existing request-error slug/category. */
export async function createSandboxHttpError(
  response: Response,
  operation: string,
  signal?: AbortSignal | null,
): Promise<VeryfrontError> {
  const deadline = AbortSignal.timeout(SANDBOX_ERROR_BODY_TIMEOUT_MS);
  let text: string;
  let truncated: boolean;
  try {
    ({ text, truncated } = await readResponseTextPrefix(
      response,
      MAX_SANDBOX_ERROR_BODY_BYTES,
      signal ? AbortSignal.any([signal, deadline]) : deadline,
    ));
  } catch (cause) {
    return REQUEST_ERROR.create({
      status: response.status,
      detail: `${operation}: ${response.status} (response body unavailable)`,
      cause,
    });
  }
  const problem = truncated ? undefined : responseProblem(text, response.status);
  return REQUEST_ERROR.create({
    status: response.status,
    detail: `${operation}: ${response.status}${text ? ` ${text}` : ""}${
      truncated ? " [truncated]" : ""
    }`,
    context: problem
      ? { responseProblem: problem }
      : truncated
      ? { responseTruncated: true }
      : undefined,
  });
}
