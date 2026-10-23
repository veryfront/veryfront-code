import { isApiKeyToken, isCredentialRejectionStatus } from "../auth/login.ts";

// Captured at module load, before project code runs: a caller may check a
// credential after project config was evaluated. The request init and its
// headers have no prototype, so an inherited getter never sees the token, and
// the check reads only the status, through intrinsics project code cannot
// replace.
const applyIntrinsic = Reflect.apply;
const objectCreate = Object.create;
const abortSignalTimeout = AbortSignal.timeout;
const stringEndsWith = String.prototype.endsWith;
const stringSlice = String.prototype.slice;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const streamCancel = ReadableStream.prototype.cancel;

/**
 * How the API at `apiUrl` answers for `apiToken`: `rejected` on 401 or 403,
 * `accepted` on a 2xx, and `unknown` otherwise. Checks the same endpoint
 * `validateCredential` does for each kind of credential, but never reads the
 * response body, so no identity data is parsed. Throws when the request fails
 * or takes longer than `timeoutMs`.
 */
export async function checkCredential(
  apiToken: string,
  apiUrl: string,
  transport: typeof fetch,
  timeoutMs: number,
): Promise<"rejected" | "accepted" | "unknown"> {
  let base = apiUrl;
  while (applyIntrinsic(stringEndsWith, base, ["/"])) {
    base = applyIntrinsic(stringSlice, base, [0, -1]) as string;
  }
  const path = isApiKeyToken(apiToken) ? "/projects?limit=1" : "/me";
  const headers = objectCreate(null) as Record<string, string>;
  headers.Authorization = `Bearer ${apiToken}`;
  headers.Accept = "application/json";
  const init = objectCreate(null) as RequestInit;
  init.headers = headers;
  init.signal = applyIntrinsic(abortSignalTimeout, AbortSignal, [timeoutMs]) as AbortSignal;
  const response = await transport(`${base}${path}`, init);
  const body = applyIntrinsic(responseBody, response, []) as ReadableStream | null;
  if (body) await (applyIntrinsic(streamCancel, body, []) as Promise<void>).catch(() => {});
  const status = applyIntrinsic(responseStatus, response, []) as number;
  if (isCredentialRejectionStatus(status)) return "rejected";
  return status >= 200 && status < 300 ? "accepted" : "unknown";
}
