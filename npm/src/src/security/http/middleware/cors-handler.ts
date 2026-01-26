import * as dntShim from "../../../../_dnt.shims.js";
import type { SecurityConfig } from "./types.js";
import { validateOriginSync } from "../cors/validators.js";

export function setCors(
  headers: dntShim.Headers,
  req: dntShim.Request,
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
