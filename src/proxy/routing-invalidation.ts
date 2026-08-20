import { verifyDispatchJws } from "#veryfront/channels/control-plane.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  isCanonicalOpaqueProjectIdentifier,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";
import { ProxyResponseBodyError, readProxyResponseText } from "./response-body.ts";

export const PROXY_ROUTING_INVALIDATION_PATH = "/_proxy/internal/routing-invalidation";
export const PROXY_ROUTING_INVALIDATION_PLATFORM = "proxy-routing";
export const PROXY_ROUTING_INVALIDATION_SUBJECT = "deployment-routing-invalidation";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const PUBLIC_KEY_ENV_VAR = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const MAX_SIGNATURE_AGE_SECONDS = 60;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BODY_TIMEOUT_MS = 60_000;
const MAX_LOGGED_REJECTION_REASON_CODE_UNITS = 200;
const MAX_REJECTION_CLASS_CODE_UNITS = 64;
const MAX_TRACKED_REJECTION_CLASSES = 32;
const OVERFLOW_REJECTION_CLASS = "OverflowRejection";
const REJECTION_WARNING_WINDOW_MS = 60_000;
const MISSING_SIGNATURE_REJECTION_CLASS = "MissingDispatchSignature";

export interface ProxyRoutingInvalidationRequest {
  readonly version: 1;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly deploymentId: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly releaseId: string;
}

export interface ProxyRoutingInvalidationEvent extends ProxyRoutingInvalidationRequest {
  readonly eventId: string;
}

export interface ProxyRoutingInvalidationPublishResult {
  readonly acknowledged: number;
  readonly converged: boolean;
  readonly recipients: number;
}

export interface ProxyRoutingInvalidationPublisher {
  publish(
    event: ProxyRoutingInvalidationEvent,
  ): Promise<ProxyRoutingInvalidationPublishResult>;
}

/**
 * Warning sink for rejected invalidations.
 *
 * Structurally compatible with `proxyLogger`, which is what `src/proxy/main.ts`
 * passes in.
 */
export interface ProxyRoutingInvalidationLogger {
  warn(message: string, extra?: Record<string, unknown>): void;
}

/**
 * Coalescer for rejection warnings.
 *
 * This endpoint sits on the public listener with no source-IP guard, so an
 * unauthenticated caller can drive one log write per request. Without this,
 * every rejection is a separate line in the log pipeline.
 */
export interface ProxyRoutingInvalidationRejectionThrottle {
  /**
   * Open a warning window for `rejectionClass`, or coalesce into the window
   * that is already open.
   *
   * Returns the number of warnings coalesced away since the previous emission,
   * or `null` when this rejection should stay silent.
   */
  admit(rejectionClass: string): number | null;
}

interface ProxyRoutingInvalidationHandlerOptions {
  bodyReadTimeoutMs?: number;
  createEventId?: () => string;
  logger?: ProxyRoutingInvalidationLogger;
  publicKeyPem?: string;
  publisher: ProxyRoutingInvalidationPublisher | null;
  /**
   * Omit to warn on every rejection. `src/proxy/main.ts` passes one so a flood
   * against the public listener cannot flood the log pipeline with it.
   */
  rejectionThrottle?: ProxyRoutingInvalidationRejectionThrottle;
}

/**
 * Build a rejection throttle that emits at most one warning per class per
 * window and counts the rest.
 *
 * The first rejection of a class always warns, so a new failure mode is never
 * hidden — this endpoint stayed inert for a month precisely because rejections
 * were silent, and suppressing the first occurrence would rebuild that trap.
 * Repeats inside the window are counted and reported on the next emission.
 *
 * Classes are bounded and never caller-chosen (see `classifySignatureRejection`),
 * but the tracking map is capped anyway: an unforeseen error type carrying a
 * dynamic `name` must not turn this into a memory leak.
 */
export function createProxyRoutingInvalidationRejectionThrottle(
  options: { nowMs?: () => number; windowMs?: number } = {},
): ProxyRoutingInvalidationRejectionThrottle {
  const nowMs = options.nowMs ?? (() => Date.now());
  const windowMs = options.windowMs ?? REJECTION_WARNING_WINDOW_MS;
  const openWindows = new Map<string, { openedAtMs: number; coalesced: number }>();
  return {
    admit(rejectionClass: string): number | null {
      const key = openWindows.has(rejectionClass) ||
          openWindows.size < MAX_TRACKED_REJECTION_CLASSES
        ? rejectionClass
        : OVERFLOW_REJECTION_CLASS;
      const now = nowMs();
      const open = openWindows.get(key);
      if (open) {
        const elapsedMs = now - open.openedAtMs;
        // A clock that stepped backwards expires the window rather than
        // silencing the class until the clock catches up.
        if (elapsedMs >= 0 && elapsedMs < windowMs) {
          open.coalesced += 1;
          return null;
        }
      }
      openWindows.set(key, { openedAtMs: now, coalesced: 0 });
      return open?.coalesced ?? 0;
    },
  };
}

/**
 * Bucket a rejection by the failing check rather than by its message.
 *
 * The message can carry caller-shaped fragments — a claim-schema rejection can
 * name the properties the caller sent — so keying windows on it would let a
 * caller mint unlimited classes and defeat the coalescing. Which error type our
 * verification throws is ours alone.
 */
function classifySignatureRejection(error: unknown): string {
  const name = error instanceof Error && typeof error.name === "string" ? error.name : "";
  return name.length > 0 && name.length <= MAX_REJECTION_CLASS_CODE_UNITS
    ? name
    : "UnrecognizedRejection";
}

/**
 * Describe why a dispatch signature was refused, without ever echoing the
 * credential.
 *
 * Every message this can surface is minted by our own verification code
 * ("Control-plane audience mismatch", "Control-plane signature expired",
 * `Missing extension for contract "SchemaValidator"`, …) and names the check
 * that failed rather than the material that failed it. The bound keeps a
 * third-party error message from turning a proxy log line into an unbounded
 * write.
 */
function describeSignatureRejection(error: unknown): string {
  const message = error instanceof Error && typeof error.message === "string"
    ? error.message
    : "Unrecognized routing invalidation signature failure";
  return message.length > MAX_LOGGED_REJECTION_REASON_CODE_UNITS
    ? `${message.slice(0, MAX_LOGGED_REJECTION_REASON_CODE_UNITS)}…`
    : message;
}

/**
 * Report a refused invalidation.
 *
 * A 401 here means a deployment is still being routed to the previous release,
 * so it has to be diagnosable from proxy logs alone: the response body is
 * deliberately generic, and the sender only ever sees that generic body.
 *
 * The warning carries the failing check and nothing else. The body reached this
 * point unauthenticated, so its `projectId`, `projectSlug`, `deploymentId`,
 * `environmentId` and `releaseId` are attacker-chosen: logging them would let
 * any caller on the public listener attribute a forged rejection to someone
 * else's project, and would write kilobytes of caller-controlled text per
 * request into the log pipeline. Identifiers may only be logged past a
 * successful `verifyDispatchJws`, never here. Diagnosis does not need them: the
 * question a stuck rollout raises is *why* dispatch was refused, and the sender
 * already holds the authenticated identifiers for the attempt it made.
 */
function warnRejectedInvalidation(
  logger: ProxyRoutingInvalidationLogger | undefined,
  throttle: ProxyRoutingInvalidationRejectionThrottle | undefined,
  rejectionClass: string,
  reason: string,
): void {
  if (!logger) return;
  const coalesced = throttle ? throttle.admit(rejectionClass) : 0;
  if (coalesced === null) return;
  try {
    logger.warn("Rejected proxy routing invalidation", {
      reason,
      ...(coalesced > 0 ? { coalescedSincePreviousWarning: coalesced } : {}),
    });
  } catch {
    // A logging sink must never upgrade a rejection into a 500.
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

async function readBoundedRequestBody(
  req: Request,
  timeoutMs: number,
): Promise<
  { body: string } | { error: "timeout" | "too-large" | "unreadable" }
> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromRequest = (): void => {
    controller.abort(req.signal.reason);
  };
  if (req.signal.aborted) abortFromRequest();
  else req.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException(
        "Routing invalidation request body timed out",
        "TimeoutError",
      ),
    );
  }, timeoutMs);
  try {
    const response = new Response(req.body, { headers: req.headers });
    return {
      body: await readProxyResponseText(
        response,
        MAX_REQUEST_BODY_BYTES,
        controller.signal,
      ),
    };
  } catch (error) {
    if (timedOut) return { error: "timeout" };
    if (
      error instanceof ProxyResponseBodyError &&
      (error.failure === "too-large" ||
        error.failure === "too-many-chunks")
    ) {
      return { error: "too-large" };
    }
    return { error: "unreadable" };
  } finally {
    clearTimeout(timeoutId);
    req.signal.removeEventListener("abort", abortFromRequest);
  }
}

function snapshotProxyRoutingInvalidationRequest(
  value: unknown,
): ProxyRoutingInvalidationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const version = ownDataValue(descriptors, "version");
  const projectId = ownDataValue(descriptors, "projectId");
  const projectSlug = ownDataValue(descriptors, "projectSlug");
  const deploymentId = ownDataValue(descriptors, "deploymentId");
  const environmentId = ownDataValue(descriptors, "environmentId");
  const environmentName = ownDataValue(descriptors, "environmentName");
  const releaseId = ownDataValue(descriptors, "releaseId");
  if (
    version !== 1 ||
    !isCanonicalOpaqueProjectIdentifier(projectId) ||
    typeof projectSlug !== "string" ||
    !isCanonicalProjectSlug(projectSlug) ||
    projectSlug !== projectSlug.toLowerCase() ||
    !isCanonicalOpaqueProjectIdentifier(deploymentId) ||
    !isCanonicalOpaqueProjectIdentifier(environmentId) ||
    !isCanonicalOpaqueProjectIdentifier(environmentName) ||
    !isCanonicalOpaqueProjectIdentifier(releaseId)
  ) {
    return null;
  }

  return Object.freeze({
    version: 1,
    projectId,
    projectSlug,
    deploymentId,
    environmentId,
    environmentName,
    releaseId,
  });
}

export function parseProxyRoutingInvalidationRequest(
  body: string,
): ProxyRoutingInvalidationRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  return snapshotProxyRoutingInvalidationRequest(parsed);
}

export function parseProxyRoutingInvalidationEvent(
  value: unknown,
): ProxyRoutingInvalidationEvent | null {
  const request = snapshotProxyRoutingInvalidationRequest(value);
  if (!request || !value || typeof value !== "object") return null;
  let eventId: unknown;
  try {
    eventId = ownDataValue(
      Object.getOwnPropertyDescriptors(value),
      "eventId",
    );
  } catch {
    return null;
  }
  if (!isCanonicalOpaqueProjectIdentifier(eventId)) return null;
  return Object.freeze({ eventId, ...request });
}

export function parseProxyRoutingInvalidationPublishResult(
  value: unknown,
): ProxyRoutingInvalidationPublishResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const acknowledged = ownDataValue(descriptors, "acknowledged");
  const converged = ownDataValue(descriptors, "converged");
  const recipients = ownDataValue(descriptors, "recipients");
  if (
    !isNonNegativeSafeInteger(acknowledged) ||
    !isNonNegativeSafeInteger(recipients) ||
    acknowledged > recipients ||
    typeof converged !== "boolean" ||
    (converged &&
      (recipients === 0 ||
        acknowledged < recipients))
  ) {
    return null;
  }
  return Object.freeze({
    acknowledged,
    converged,
    recipients,
  });
}

function resolveBodyReadTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_REQUEST_BODY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_REQUEST_BODY_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Routing invalidation body timeout must be an integer between 1 and ${MAX_REQUEST_BODY_TIMEOUT_MS}`,
    );
  }
  return value;
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

  const bodyResult = await readBoundedRequestBody(
    req,
    resolveBodyReadTimeout(options.bodyReadTimeoutMs),
  );
  if ("error" in bodyResult && bodyResult.error === "too-large") {
    return jsonResponse(413, { error: "Request body is too large" });
  }
  if ("error" in bodyResult && bodyResult.error === "timeout") {
    return jsonResponse(408, { error: "Routing invalidation request timed out" });
  }
  if ("error" in bodyResult) {
    return jsonResponse(400, { error: "Invalid routing invalidation request" });
  }
  const { body } = bodyResult;

  const input = parseProxyRoutingInvalidationRequest(body);
  if (!input) return jsonResponse(400, { error: "Invalid routing invalidation request" });

  const jws = req.headers.get(DISPATCH_JWS_HEADER);
  if (!jws) {
    warnRejectedInvalidation(
      options.logger,
      options.rejectionThrottle,
      MISSING_SIGNATURE_REJECTION_CLASS,
      `Request is missing the ${DISPATCH_JWS_HEADER} dispatch signature`,
    );
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
  } catch (error) {
    warnRejectedInvalidation(
      options.logger,
      options.rejectionThrottle,
      classifySignatureRejection(error),
      describeSignatureRejection(error),
    );
    return jsonResponse(401, { error: "Invalid routing invalidation signature" });
  }

  try {
    const createEventId = options.createEventId ?? (() => crypto.randomUUID());
    const event = parseProxyRoutingInvalidationEvent({
      eventId: createEventId(),
      ...input,
    });
    if (!event) throw new TypeError("Routing invalidation event is invalid");
    const result = parseProxyRoutingInvalidationPublishResult(
      await options.publisher.publish(event),
    );
    if (!result) {
      throw new TypeError("Routing invalidation publisher returned an invalid result");
    }
    return jsonResponse(result.converged ? 200 : 503, { ...result });
  } catch {
    return jsonResponse(503, { error: "Routing invalidation did not converge" });
  }
}
