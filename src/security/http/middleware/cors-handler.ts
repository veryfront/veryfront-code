import type { SecurityConfig } from "./types.ts";
import { validateOriginSync } from "../cors/validators.ts";

export function setCors(
  headers: Headers,
  req: Request,
  securityConfig: SecurityConfig | null,
): void {
  const allowedOrigin = validateOriginSync(
    req.headers.get("origin"),
    securityConfig?.cors,
  ).allowedOrigin;

  if (!allowedOrigin) return;

  headers.set("Access-Control-Allow-Origin", allowedOrigin);

  if (allowedOrigin === "*") return;

  headers.set("Vary", "Origin");
}
