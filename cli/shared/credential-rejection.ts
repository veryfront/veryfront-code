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
 * Whether the API at `apiUrl` rejects `apiToken` outright (401 or 403). Checks
 * the same endpoint `validateCredential` does for each kind of credential, but
 * never reads the response body, so no identity data is parsed. Throws when
 * the request fails or takes longer than `timeoutMs`.
 */
export async function isCredentialRejected(
  apiToken: string,
  apiUrl: string,
  transport: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const base = applyIntrinsic(stringEndsWith, apiUrl, ["/"])
    ? applyIntrinsic(stringSlice, apiUrl, [0, -1]) as string
    : apiUrl;
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
  return isCredentialRejectionStatus(applyIntrinsic(responseStatus, response, []) as number);
}
