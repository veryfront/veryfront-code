
import type { CORSConfig, CORSHeaderOptions } from "./types.ts";
import { validateOrigin, validateOriginSync } from "./validators.ts";

export async function applyCORSHeaders(options: CORSHeaderOptions): Promise<Response | void> {
  const { request, response, headers: headersObj, config } = options;

  const validation = await validateOrigin(request.headers.get("origin"), config);

  if (!validation.allowedOrigin) {
    return response;
  }

  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());

  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }

  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return;
}

export function applyCORSHeadersSync(options: CORSHeaderOptions): Response | void {
  const { request, response, headers: headersObj, config } = options;
  const validation = validateOriginSync(request.headers.get("origin"), config);

  if (!validation.allowedOrigin) {
    return response;
  }

  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());

  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }

  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return;
}

export function shouldApplyCORS(request: Request, config?: boolean | CORSConfig): boolean {
  if (!config) {
    return false;
  }

  if (config === true) {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return config.origin === "*";
  }

  return true;
}
