import { verifyDispatchJws } from "#veryfront/channels/control-plane.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const PROXY_ROUTING_INVALIDATION_PATH = "/_proxy/internal/routing-invalidation";
export const PROXY_ROUTING_INVALIDATION_PLATFORM = "proxy-routing";
export const PROXY_ROUTING_INVALIDATION_SUBJECT = "deployment-routing-invalidation";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export interface ProxyRoutingInvalidationRequest {
  version: 1;
  projectId: string;
  projectSlug: string;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  releaseId: string;
}

export interface ProxyRoutingInvalidationEvent extends ProxyRoutingInvalidationRequest {
  eventId: string;
}

export interface ProxyRoutingInvalidationPublishResult {
  acknowledged: number;
  converged: boolean;
  recipients: number;
}

export interface ProxyRoutingInvalidationPublisher {
  publish(
    event: ProxyRoutingInvalidationEvent,
  ): Promise<ProxyRoutingInvalidationPublishResult>;
}

interface ProxyRoutingInvalidationHandlerOptions {
  createEventId?: () => string;
  publicKeyPem?: string;
  publisher: ProxyRoutingInvalidationPublisher | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function readBoundedRequestBody(
  req: Request,
): Promise<{ body: string } | { error: "too-large" | "unreadable" }> {
  if (!req.body) return { body: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel("Request body is too large").catch(() => undefined);
        return { error: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes) };
}

export function parseProxyRoutingInvalidationRequest(
  body: string,
): ProxyRoutingInvalidationRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const input = parsed as Record<string, unknown>;
  if (
    input.version !== 1 ||
    !nonEmptyString(input.projectId) ||
    !nonEmptyString(input.projectSlug) ||
    !nonEmptyString(input.deploymentId) ||
    !nonEmptyString(input.environmentId) ||
    !nonEmptyString(input.environmentName) ||
    !nonEmptyString(input.releaseId)
  ) {
    return null;
  }

  return {
    version: 1,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    deploymentId: input.deploymentId,
    environmentId: input.environmentId,
    environmentName: input.environmentName,
    releaseId: input.releaseId,
  };
}

export async function handleProxyRoutingInvalidationRequest(
  req: Request,
  options: ProxyRoutingInvalidationHandlerOptions,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const publicKeyPem = options.publicKeyPem ?? getHostEnv(PUBLIC_KEY_ENV_VAR) ?? "";
  if (!publicKeyPem || !options.publisher) {
    return jsonResponse(503, { error: "Routing invalidation is unavailable" });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse(413, { error: "Request body is too large" });
  }

  const bodyResult = await readBoundedRequestBody(req);
  if ("error" in bodyResult && bodyResult.error === "too-large") {
    return jsonResponse(413, { error: "Request body is too large" });
  }
  if ("error" in bodyResult) {
    return jsonResponse(400, { error: "Invalid routing invalidation request" });
  }
  const { body } = bodyResult;

  const input = parseProxyRoutingInvalidationRequest(body);
  if (!input) return jsonResponse(400, { error: "Invalid routing invalidation request" });

  const jws = req.headers.get(DISPATCH_JWS_HEADER);
  if (!jws) return jsonResponse(401, { error: "Invalid routing invalidation signature" });

  try {
    await verifyDispatchJws(jws, body, {
      audience: input.projectSlug,
      expectedPlatform: PROXY_ROUTING_INVALIDATION_PLATFORM,
      expectedProjectId: input.projectId,
      expectedSubject: PROXY_ROUTING_INVALIDATION_SUBJECT,
      maxAgeSeconds: MAX_SIGNATURE_AGE_SECONDS,
      publicKeyPem,
    });
  } catch {
    return jsonResponse(401, { error: "Invalid routing invalidation signature" });
  }

  try {
    const createEventId = options.createEventId ?? (() => crypto.randomUUID());
    const result = await options.publisher.publish({
      eventId: createEventId(),
      ...input,
    });
    return jsonResponse(result.converged ? 200 : 503, { ...result });
  } catch {
    return jsonResponse(503, { error: "Routing invalidation did not converge" });
  }
}
