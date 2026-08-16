import type { DataResult, StaticDataResult } from "./types.ts";
import { normalizeDataResponseMetadata } from "./response-metadata.ts";

/** Validate and snapshot a project hook result before recording success. */
export function validateDataResult(
  value: unknown,
  hookName: "getStaticData",
): StaticDataResult;
export function validateDataResult(
  value: unknown,
  hookName: "getServerData",
): DataResult;
export function validateDataResult(
  value: unknown,
  hookName: "getServerData" | "getStaticData",
): DataResult {
  const fail = (): never => {
    throw new TypeError(`${hookName} must return a valid data result object`);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();

  const result = value as Record<string, unknown>;
  const props = result.props;
  const redirect = result.redirect;
  const notFound = result.notFound;
  const revalidate = result.revalidate;
  const responseMetadata = normalizeDataResponseMetadata(result, hookName);
  let redirectDestination: string | undefined;
  let redirectPermanent: boolean | undefined;

  if (
    redirect !== undefined &&
    (redirect === null || typeof redirect !== "object" || Array.isArray(redirect))
  ) {
    return fail();
  }
  if (redirect !== undefined) {
    const redirectRecord = redirect as Record<string, unknown>;
    if (
      typeof redirectRecord.destination !== "string" ||
      (redirectRecord.permanent !== undefined && typeof redirectRecord.permanent !== "boolean")
    ) return fail();
    redirectDestination = redirectRecord.destination;
    redirectPermanent = redirectRecord.permanent as boolean | undefined;
  }
  if (notFound !== undefined && typeof notFound !== "boolean") return fail();
  if (
    revalidate !== undefined && revalidate !== false &&
    (typeof revalidate !== "number" || !Number.isFinite(revalidate))
  ) return fail();

  const normalized: DataResult = {};
  if (redirectDestination !== undefined) {
    normalized.redirect = {
      destination: redirectDestination,
      ...(redirectPermanent !== undefined ? { permanent: redirectPermanent } : {}),
    };
  } else if (notFound === true) {
    normalized.notFound = true;
  } else {
    if (props !== undefined) normalized.props = props;
    if (notFound !== undefined) normalized.notFound = notFound;
    if (revalidate !== undefined) normalized.revalidate = revalidate as number | false;
  }
  if (responseMetadata.headers) normalized.headers = responseMetadata.headers;
  if (responseMetadata.cookies) normalized.cookies = responseMetadata.cookies;
  return normalized;
}
