import type { SecurityConfig } from "./types.ts";
import { validateOriginSync } from "../cors/validators.ts";

export function setCors(
  headers: Headers,
  req: Request,
  securityConfig: SecurityConfig | null,
): void {
  const validation = validateOriginSync(req.headers.get("origin"), securityConfig?.cors);
  const allowedOrigin = validation.allowedOrigin;

  if (!allowedOrigin) return;

  headers.set("Access-Control-Allow-Origin", allowedOrigin);

  if (allowedOrigin !== "*") {
    headers.set("Vary", "Origin");
  }
}
