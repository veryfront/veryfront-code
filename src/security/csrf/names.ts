import { HTTP_TOKEN_PATTERN } from "#veryfront/utils/cors-policy-limits.ts";
import { MAX_CSRF_NAME_LENGTH } from "#veryfront/utils/constants/security.ts";

export const DEFAULT_CSRF_COOKIE_NAME = "__Host-vf_csrf";
export const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";

export interface CsrfNameOptions {
  cookieName?: string;
  headerName?: string;
}

export function requireCsrfName(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CSRF_NAME_LENGTH ||
    !HTTP_TOKEN_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must be a valid HTTP token no longer than ${MAX_CSRF_NAME_LENGTH} characters`,
    );
  }
  return value;
}

export function resolveCsrfNames(options?: CsrfNameOptions): {
  cookieName: string;
  headerName: string;
} {
  return {
    cookieName: requireCsrfName(
      options?.cookieName ?? DEFAULT_CSRF_COOKIE_NAME,
      "CSRF cookieName",
    ),
    headerName: requireCsrfName(
      options?.headerName ?? DEFAULT_CSRF_HEADER_NAME,
      "CSRF headerName",
    ),
  };
}
