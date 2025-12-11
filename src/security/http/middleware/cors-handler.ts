
import type { SecurityConfig } from "./types.ts";
import { validateOriginSync } from "../cors/validators.ts";

export function setCors(headers: Headers, req: Request, securityConfig: SecurityConfig | null) {
  const conf = securityConfig?.cors;

  const validation = validateOriginSync(req.headers.get("origin"), conf);

  if (validation.allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
  }

  if (validation.allowedOrigin && validation.allowedOrigin !== "*") {
    headers.set("Vary", "Origin");
  }
}
