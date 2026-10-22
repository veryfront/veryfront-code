import { isApiKeyToken } from "../auth/login.ts";

// Captured at module load, before project code runs: a caller may check a
// credential after project config was evaluated, so the check reads only the
// status, through intrinsics project code cannot replace.
const applyIntrinsic = Reflect.apply;
const responseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const streamCancel = ReadableStream.prototype.cancel;

/**
 * Whether the API at `apiUrl` rejects `apiToken` outright (401 or 403). Checks
 * the same endpoint `validateCredential` does for each kind of credential, but
 * never reads the response body, so no identity data is parsed. Throws when
 * the request fails.
 */
export async function isCredentialRejected(
  apiToken: string,
  apiUrl: string,
  transport: typeof fetch,
): Promise<boolean> {
  const path = isApiKeyToken(apiToken) ? "/projects?limit=1" : "/me";
  const response = await transport(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
  });
  const body = applyIntrinsic(responseBody, response, []) as ReadableStream | null;
  if (body) await (applyIntrinsic(streamCancel, body, []) as Promise<void>).catch(() => {});
  const status = applyIntrinsic(responseStatus, response, []) as number;
  return status === 401 || status === 403;
}
