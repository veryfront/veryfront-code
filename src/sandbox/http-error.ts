import { REQUEST_ERROR, type VeryfrontError } from "#veryfront/errors";
import { sanitizeBoundedDiagnosticText } from "#veryfront/errors/diagnostic-policy.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

const MAX_SANDBOX_ERROR_BODY_BYTES = 8 * 1024;
const SANDBOX_ERROR_BODY_TIMEOUT_MS = 5_000;
// Parse untrusted bodies without passing them through mutable application hooks.
const parseJson = JSON.parse;
const isArray = Array.isArray;
const ownDescriptor = Object.getOwnPropertyDescriptor;

function ownValue(value: object, key: string): unknown {
  const descriptor = ownDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** Keep the SDK error identity while exposing a bounded canonical API problem. */
function responseProblem(text: string, status: number): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = parseJson(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || isArray(value)) return undefined;
  const problem = value;
  if (ownValue(problem, "status") !== status || status < 400 || status > 599) return undefined;
  const projected: Record<string, unknown> = { status };
  for (const key of ["type", "title", "slug", "category"] as const) {
    const field = ownValue(problem, key);
    if (typeof field !== "string" || field.length === 0 || field.length > 2048) return undefined;
    projected[key] = sanitizeBoundedDiagnosticText(field);
  }
  for (const key of ["detail", "instance", "suggestion"] as const) {
    const field = ownValue(problem, key);
    if (typeof field === "string" && field.length <= 4096) {
      projected[key] = sanitizeBoundedDiagnosticText(field);
    }
  }
  const problemErrors = ownValue(problem, "errors");
  if (isArray(problemErrors) && problemErrors.length <= 50) {
    const errors: Record<string, string>[] = [];
    for (let index = 0; index < problemErrors.length; index++) {
      const item = ownValue(problemErrors, String(index));
      if (!item || typeof item !== "object" || isArray(item)) return undefined;
      const fields: Record<string, string> = {};
      for (const key of ["field", "message", "code"]) {
        const field = ownValue(item, key);
        if (typeof field === "string" && field.length <= 1024) {
          fields[key] = sanitizeBoundedDiagnosticText(field);
        }
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
    detail: `${operation}: ${response.status}${problem ? ` ${JSON.stringify(problem)}` : ""}${
      truncated ? " [truncated]" : ""
    }`,
    context: problem
      ? { responseProblem: problem }
      : truncated
      ? { responseTruncated: true }
      : undefined,
  });
}
