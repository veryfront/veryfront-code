import { verifyDispatchJws } from "#veryfront/channels/control-plane.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

/** Internal HTTP path that accepts signed routing invalidations. */
export const PROXY_ROUTING_INVALIDATION_PATH = "/_proxy/internal/routing-invalidation";
/** Dispatch platform claim required for routing invalidations. */
export const PROXY_ROUTING_INVALIDATION_PLATFORM = "proxy-routing";
/** Dispatch subject claim required for routing invalidations. */
export const PROXY_ROUTING_INVALIDATION_SUBJECT = "deployment-routing-invalidation";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_ROUTING_FIELD_BYTES = 256;
const MAX_DISPATCH_JWS_BYTES = 16 * 1024;
const DEFAULT_BODY_READ_TIMEOUT_MS = 5_000;
const MAX_BODY_READ_TIMEOUT_MS = 30_000;

/** Validated deployment routing data accepted by the proxy. */
export interface ProxyRoutingInvalidationRequest {
  /** Payload schema version. */
  version: 1;
  /** Project identifier. */
  projectId: string;
  /** Project slug used as the dispatch audience. */
  projectSlug: string;
  /** Deployment identifier. */
  deploymentId: string;
  /** Environment identifier. */
  environmentId: string;
  /** Environment name. */
  environmentName: string;
  /** Activated release identifier. */
  releaseId: string;
}

/** Routing invalidation data with its unique delivery identifier. */
export interface ProxyRoutingInvalidationEvent extends ProxyRoutingInvalidationRequest {
  /** Unique identifier used to deduplicate event delivery. */
  eventId: string;
}

/** Replica acknowledgement summary for a published invalidation. */
export interface ProxyRoutingInvalidationPublishResult {
  /** Number of distinct replicas that acknowledged the event. */
  acknowledged: number;
  /** Whether every subscribed recipient acknowledged the event. */
  converged: boolean;
  /** Number of replicas subscribed when the event was published. */
  recipients: number;
}

/** Publishes a routing invalidation and waits for replica acknowledgements. */
export interface ProxyRoutingInvalidationPublisher {
  /** Publishes one event and returns its convergence summary. */
  publish(
    event: ProxyRoutingInvalidationEvent,
  ): Promise<ProxyRoutingInvalidationPublishResult>;
}

/** Dependencies and configuration for the routing invalidation HTTP handler. */
export interface ProxyRoutingInvalidationHandlerOptions {
  /** Maximum time to read the complete request body. */
  bodyReadTimeoutMs?: number;
  /** Generates the delivery identifier. Defaults to a random UUID. */
  createEventId?: () => string;
  /** PEM-encoded public key used to verify the dispatch signature. */
  publicKeyPem?: string;
  /** Replica publisher. A null value disables the endpoint. */
  publisher: ProxyRoutingInvalidationPublisher | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validRoutingField(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !hasControlCharacter(value) &&
    new TextEncoder().encode(value).byteLength <= MAX_ROUTING_FIELD_BYTES;
}

function validPublishResult(value: unknown): value is ProxyRoutingInvalidationPublishResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(result.acknowledged) ||
    (result.acknowledged as number) < 0 ||
    !Number.isSafeInteger(result.recipients) ||
    (result.recipients as number) < 0 ||
    typeof result.converged !== "boolean"
  ) {
    return false;
  }
  const acknowledged = result.acknowledged as number;
  const recipients = result.recipients as number;
  return acknowledged <= recipients &&
    (!result.converged || (recipients > 0 && acknowledged === recipients));
}

function normalizeBodyReadTimeout(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value <= 0) {
    return DEFAULT_BODY_READ_TIMEOUT_MS;
  }
  return Math.min(value, MAX_BODY_READ_TIMEOUT_MS);
}

async function readChunkWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  if (signal.aborted) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), Math.max(1, Math.ceil(timeoutMs)));
  });
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeout, aborted]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedRequestBody(
  req: Request,
  timeoutMs: number,
): Promise<{ body: string } | { error: "too-large" | "unreadable" }> {
  if (!req.body) return { body: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let canReleaseLock = true;
  const deadline = performance.now() + timeoutMs;

  try {
    while (true) {
      const result = await readChunkWithin(
        reader,
        req.signal,
        deadline - performance.now(),
      );
      if (!result) {
        canReleaseLock = false;
        void reader.cancel("Request body read timed out").catch(() => undefined);
        return { error: "unreadable" };
      }
      const { done, value } = result;
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        void reader.cancel("Request body is too large").catch(() => undefined);
        return { error: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "unreadable" };
  } finally {
    if (canReleaseLock) reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { error: "unreadable" };
  }
}

/** Parses and validates a routing invalidation JSON body. */
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
    !validRoutingField(input.projectId) ||
    !validRoutingField(input.projectSlug) ||
    !validRoutingField(input.deploymentId) ||
    !validRoutingField(input.environmentId) ||
    !validRoutingField(input.environmentName) ||
    !validRoutingField(input.releaseId)
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

/** Verifies and publishes one signed proxy routing invalidation request. */
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

  const declaredLengthHeader = req.headers.get("content-length");
  if (declaredLengthHeader !== null) {
    if (!/^\d+$/u.test(declaredLengthHeader)) {
      return jsonResponse(400, { error: "Invalid routing invalidation request" });
    }
    const declaredLength = Number(declaredLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_REQUEST_BODY_BYTES) {
      return jsonResponse(413, { error: "Request body is too large" });
    }
  }

  const bodyResult = await readBoundedRequestBody(
    req,
    normalizeBodyReadTimeout(options.bodyReadTimeoutMs),
  );
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
  if (!jws || new TextEncoder().encode(jws).byteLength > MAX_DISPATCH_JWS_BYTES) {
    return jsonResponse(401, { error: "Invalid routing invalidation signature" });
  }

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
    const eventId = createEventId();
    if (!validRoutingField(eventId)) {
      return jsonResponse(503, { error: "Routing invalidation did not converge" });
    }
    const result = await options.publisher.publish({
      eventId,
      ...input,
    });
    if (!validPublishResult(result)) {
      return jsonResponse(503, { error: "Routing invalidation did not converge" });
    }
    return jsonResponse(result.converged ? 200 : 503, {
      acknowledged: result.acknowledged,
      converged: result.converged,
      recipients: result.recipients,
    });
  } catch {
    return jsonResponse(503, { error: "Routing invalidation did not converge" });
  }
}
