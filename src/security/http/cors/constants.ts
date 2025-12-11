
import { DEV_LOCALHOST_ORIGINS } from "@veryfront/config";
import { getEnv } from "../../../platform/compat/process.ts";

export const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export const DEFAULT_HEADERS = ["Content-Type", "Authorization"];

export const DEFAULT_MAX_AGE = 86400;

export { DEV_LOCALHOST_ORIGINS };

export const HTTP_NO_CONTENT = 204;
export const HTTP_FORBIDDEN = 403;

export function isProductionMode(): boolean {
  try {
    const veryfrontEnv = getEnv("VERYFRONT_ENV");
    const nodeEnv = getEnv("NODE_ENV");
    const denoEnv = getEnv("DENO_ENV");

    if (
      veryfrontEnv === "development" ||
      nodeEnv === "development" ||
      denoEnv === "development"
    ) {
      return false;
    }

    return true;
  } catch {
    return true;
  }
}
