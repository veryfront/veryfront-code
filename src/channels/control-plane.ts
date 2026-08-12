import { SECURITY_VIOLATION } from "#veryfront/errors";
import type { Agent } from "#veryfront/agent/types.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import type { HandlerContext } from "#veryfront/types/server.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";

const SIGNATURE_SKEW_SECONDS = 5;
const MAX_SIGNATURE_JWS_CODE_UNITS = 16 * 1024;
const MAX_SIGNATURE_PUBLIC_KEY_CODE_UNITS = 8 * 1024;
const MAX_SIGNED_REQUEST_METHOD_CODE_UNITS = 32;
const MAX_SIGNED_REQUEST_PATH_CODE_UNITS = 4 * 1024;
const SIGNED_REQUEST_PATH_BASE = "https://control-plane.invalid";
const SIGNED_REQUEST_METHOD_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Z]+$/u;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const SafeURL = URL;

/** Shared control plane agents list path value. */
export const CONTROL_PLANE_AGENTS_LIST_PATH = "/api/control-plane/agents/list";
/** Shared control plane runs path prefix value. */
export const CONTROL_PLANE_RUNS_PATH_PREFIX = "/api/control-plane/runs/";
/** Shared control plane run stream path value. */
export const CONTROL_PLANE_RUN_STREAM_PATH = "/api/control-plane/runs/:runId/stream";

const CONTROL_PLANE_RUN_ID_PATH_SEGMENT = "[^/]+";
const CONTROL_PLANE_RUNS_REGEX_PREFIX = CONTROL_PLANE_RUNS_PATH_PREFIX.replaceAll("/", "\\/");

/** Request header the control plane carries its signed operation envelope in. */
export const CONTROL_PLANE_JWS_HEADER = "x-veryfront-control-plane-jws";

/** Request header a platform channel dispatch carries its signed envelope in. */
export const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";

/** The one route that accepts a signed channel dispatch envelope. */
export const CHANNEL_INVOKE_PATH = "/channels/invoke";

const CONTROL_PLANE_RUN_OPERATION_PATH =
  /^\/api\/control-plane\/runs\/[^/]+\/(?:execute|stream|resume)$/u;
const CONTROL_PLANE_RUN_PATH = /^\/api\/control-plane\/runs\/[^/]+$/u;

/**
 * True when a method and path pair addresses a registered control-plane handler.
 *
 * The reserved namespace is wider than the set of routes the runtime actually
 * serves. Only these shapes reach a handler that authenticates a signed
 * operation envelope through `verifyControlPlaneRequest`:
 *
 * - `POST /api/control-plane/agents/list`
 * - `POST /api/control-plane/runs/{runId}/execute`
 * - `POST /api/control-plane/runs/{runId}/stream`
 * - `POST /api/control-plane/runs/{runId}/resume`
 * - `DELETE /api/control-plane/runs/{runId}`
 *
 * Any other path under the prefix falls through to project code, so treating
 * the prefix as proof of a control-plane request would hand a project's own
 * routes whatever exemption the caller grants.
 *
 * Match this against `URL.pathname`, which resolves dot segments, so a path
 * cannot be smuggled past the anchored patterns.
 */
export function isControlPlaneSurfaceRoute(
  method: string,
  pathname: string | undefined,
): boolean {
  const normalizedMethod = method.toUpperCase();
  const requestPath = pathname ?? "";

  if (normalizedMethod === "POST") {
    return requestPath === CONTROL_PLANE_AGENTS_LIST_PATH ||
      CONTROL_PLANE_RUN_OPERATION_PATH.test(requestPath);
  }
  if (normalizedMethod === "DELETE") {
    return CONTROL_PLANE_RUN_PATH.test(requestPath);
  }
  return false;
}

/**
 * True for a request that is a control-plane dispatch rather than a browser one.
 *
 * Both conditions must hold. The method and path must address a registered
 * control-plane handler (see {@link isControlPlaneSurfaceRoute}), and the
 * request must carry a control-plane signature header. The receiving handler
 * verifies that envelope against the dispatch signing key, and the signature
 * covers the request method and path, so an envelope minted for one surface
 * cannot be replayed against another.
 *
 * Callers use this to keep gates that assume a browser client, such as CSRF
 * double-submit validation, from standing in front of platform dispatch.
 *
 * Do not read a true result as evidence that the caller is the platform, and do
 * not argue the exemption is safe because the header is hard to attach. It is
 * not hard to attach. A project can configure a permissive `security.cors`, and
 * on the default path `resolveNormalizedCORSPreflightPolicy` reflects whatever
 * `Access-Control-Request-Headers` asked for, so the runtime will advertise this
 * header to a cross-origin caller. The proxy likewise forwards an unverified
 * `x-veryfront-*-jws` from a public request rather than stripping it. Assume an
 * attacker can set this header at will.
 *
 * The exemption is safe for a narrower reason that does not depend on who can
 * set the header. Skipping the gate concedes only the browser-credential check;
 * authority still comes from the signature the receiving handler verifies, which
 * an attacker cannot forge. And every route this predicate admits is owned by a
 * handler registered ahead of `ApiHandlerWrapper` and instantiated
 * unconditionally, so an admitted request always terminates at that verification
 * and can never fall through to project code. A forged header buys a different
 * rejection, nothing more. That ordering is the load-bearing part; it is pinned
 * by `server/runtime-handler/dispatch-exemption-ordering.test.ts`, and the
 * behaviour it protects by `security/http/dispatch-exemption-matrix.test.ts`.
 *
 * A project route that merely sits at a look-alike path is not a registered
 * surface and does not satisfy this predicate at all.
 *
 * This is not authentication. It only reports that authority for the request
 * comes from a signature the handler checks, never from ambient credentials.
 */
export function isSignedControlPlaneDispatch(req: Request): boolean {
  const signature = req.headers.get(CONTROL_PLANE_JWS_HEADER);
  if (signature === null || signature.length === 0) return false;

  return isControlPlaneSurfaceRoute(req.method, new SafeURL(req.url).pathname);
}

/**
 * True when a method and path pair addresses the channel dispatch handler.
 *
 * `POST /channels/invoke` is the one route `ChannelInvokeHandler` registers,
 * and the only route that verifies a channel dispatch envelope. It is
 * deliberately not part of {@link isControlPlaneSurfaceRoute}: the control
 * plane's `channels` surface names a product surface inside a control-plane
 * envelope, not this HTTP route, and this route carries a different envelope.
 *
 * The `/channels/` namespace is reserved but not exclusively routed, so any
 * sibling or child path is matched exactly rather than by prefix. Match this
 * against `URL.pathname`, which resolves dot segments.
 */
export function isChannelDispatchRoute(
  method: string,
  pathname: string | undefined,
): boolean {
  return method.toUpperCase() === "POST" && pathname === CHANNEL_INVOKE_PATH;
}

/**
 * True for a request that is a platform channel dispatch rather than a browser one.
 *
 * Both conditions must hold. The method and path must be the one route the
 * channel invoke handler owns (see {@link isChannelDispatchRoute}), and the
 * request must carry a dispatch signature header. The handler then verifies
 * that envelope with `verifyDispatchJws`, which binds the Ed25519 signature to
 * the issuer, the project audience, the project id, the dispatch id, the
 * platform and a SHA-256 hash of the body, with expiry and skew bounds; the
 * handler additionally rejects an envelope whose claims do not match the
 * dispatch id, platform and project id in the payload it acts on.
 *
 * Callers use this to keep gates that assume a browser client, such as CSRF
 * double-submit validation, from standing in front of platform dispatch. The
 * channel dispatcher and the runtime-owner re-dispatch in
 * `resolveRuntimeOwnerInvokeUrl` hold no `__Host-vf_csrf` cookie to echo and
 * derive no authority from one.
 *
 * As with {@link isSignedControlPlaneDispatch}, assume an attacker can set this
 * header: a permissive project `security.cors` makes the runtime advertise it on
 * a preflight, and the proxy forwards an unverified one. The exemption is safe
 * because it concedes only the browser-credential check (authority still comes
 * from the envelope `ChannelInvokeHandler` verifies, which an attacker cannot
 * forge), and because `ChannelInvokeHandler` is registered ahead of
 * `ApiHandlerWrapper` and instantiated unconditionally, so an admitted request
 * always terminates at that verification rather than at project code.
 *
 * This is not authentication. It only reports that authority for the request
 * comes from a signature the handler checks, never from ambient credentials.
 */
export function isSignedChannelDispatch(req: Request): boolean {
  const signature = req.headers.get(DISPATCH_JWS_HEADER);
  if (signature === null || signature.length === 0) return false;

  return isChannelDispatchRoute(req.method, new SafeURL(req.url).pathname);
}

/**
 * True for control-plane run surfaces that can dispatch without project config.
 *
 * Stream/resume/cancel use signed request payload/session state and must not be
 * blocked by stale release config bootstraps. Execute deliberately remains
 * strict because it can consume project config for React/CSS build inputs.
 */
export function isConfigOptionalControlPlaneRunRequest(
  method: string,
  pathname: string | undefined,
): boolean {
  const normalizedMethod = method.toUpperCase();
  const requestPath = pathname ?? "";

  if (normalizedMethod === "DELETE") {
    return new RegExp(`^${CONTROL_PLANE_RUNS_REGEX_PREFIX}${CONTROL_PLANE_RUN_ID_PATH_SEGMENT}$`)
      .test(requestPath);
  }

  if (normalizedMethod !== "POST") {
    return false;
  }

  return new RegExp(
    `^${CONTROL_PLANE_RUNS_REGEX_PREFIX}${CONTROL_PLANE_RUN_ID_PATH_SEGMENT}\\/(?:stream|resume)$`,
  ).test(requestPath);
}

const getCompactJwsHeaderSchema = defineSchema((v) =>
  v.object({
    alg: v.literal("EdDSA"),
    typ: v.string().optional(),
    kid: v.string().optional(),
  })
);
const compactJwsHeaderSchema = lazySchema(getCompactJwsHeaderSchema);

/** Allowed control-plane surfaces — source of truth for the schema and {@link ControlPlaneSurface}. */
export const CONTROL_PLANE_SURFACES = ["studio", "channels", "a2a", "mcp"] as const;

/** Zod schema for get control plane surface. */
export const getControlPlaneSurfaceSchema = defineSchema((v) => v.enum(CONTROL_PLANE_SURFACES));
/** Zod schema for control plane surface. */
export const ControlPlaneSurfaceSchema = lazySchema(getControlPlaneSurfaceSchema);

/** Zod schema for get control plane agents list request. */
export const getControlPlaneAgentsListRequestSchema = defineSchema((v) =>
  v.object({
    requestId: v.string().min(1),
    projectId: v.string().min(1),
    surface: getControlPlaneSurfaceSchema(),
  })
);
/** Zod schema for control plane agents list request. */
export const ControlPlaneAgentsListRequestSchema = lazySchema(
  getControlPlaneAgentsListRequestSchema,
);

/** Zod schema for get runtime agent skill. */
export const getRuntimeAgentSkillSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string().optional(),
    tags: v.array(v.string()).optional(),
    examples: v.array(v.string()).optional(),
  })
);
/** Zod schema for runtime agent skill. */
export const RuntimeAgentSkillSchema = lazySchema(getRuntimeAgentSkillSchema);

/** Zod schema for get runtime suggestion. */
export const getRuntimeSuggestionSchema = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("prompt"),
      title: v.string().min(1),
      prompt: v.string().min(1),
    }).strict(),
    v.object({
      id: v.string().min(1),
      type: v.literal("prompt"),
    }).strict(),
    v.object({
      type: v.literal("task"),
      id: v.string().min(1),
    }).strict(),
  ])
);
/** Zod schema for runtime suggestion. */
export const RuntimeSuggestionSchema = lazySchema(getRuntimeSuggestionSchema);

/** Zod schema for get runtime suggestions. */
export const getRuntimeSuggestionsSchema = defineSchema((v) =>
  v.object({
    welcomeMessage: v.string().min(1).optional(),
    suggestions: v.array(getRuntimeSuggestionSchema()),
  })
);
/** Zod schema for runtime suggestions. */
export const RuntimeSuggestionsSchema = lazySchema(getRuntimeSuggestionsSchema);

/** Zod schema for get runtime agent. */
export const getRuntimeAgentSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string().nullable().optional(),
    avatar_url: v.string().url().nullable().optional(),
    model: v.string().nullable().optional(),
    version: v.string().nullable().optional(),
    skills: v.array(getRuntimeAgentSkillSchema()).optional(),
    suggestions: getRuntimeSuggestionsSchema().optional(),
  })
);
/** Zod schema for runtime agent. */
export const RuntimeAgentSchema = lazySchema(getRuntimeAgentSchema);

/** Zod schema for get runtime agent list response. */
export const getRuntimeAgentListResponseSchema = defineSchema((v) =>
  v.object({
    agents: v.array(getRuntimeAgentSchema()),
  })
);
/** Zod schema for runtime agent list response. */
export const RuntimeAgentListResponseSchema = lazySchema(getRuntimeAgentListResponseSchema);

/** Zod schema for get dispatch claims. */
const getDispatchClaimsSchema = defineSchema((v) =>
  v.object({
    iss: v.string(),
    aud: v.string(),
    sub: v.string(),
    project_id: v.string(),
    platform: v.string(),
    body_sha256: v.string(),
    iat: v.number().int(),
    exp: v.number().int(),
  })
);
const dispatchClaimsSchema = lazySchema(getDispatchClaimsSchema);

/** Zod schema for get control plane claims. */
const getControlPlaneClaimsSchema = defineSchema((v) =>
  v.object({
    iss: v.string(),
    aud: v.string(),
    sub: v.string(),
    surface: getControlPlaneSurfaceSchema(),
    project_id: v.string(),
    request_hash: v.string(),
    request_method: v.string().min(1).max(MAX_SIGNED_REQUEST_METHOD_CODE_UNITS),
    request_path: v.string().min(1).max(MAX_SIGNED_REQUEST_PATH_CODE_UNITS),
    iat: v.number().int(),
    exp: v.number().int(),
  })
);
const controlPlaneClaimsSchema = lazySchema(getControlPlaneClaimsSchema);

/** Public API contract for control plane surface (literal union, not widened to `string`). */
export type ControlPlaneSurface = (typeof CONTROL_PLANE_SURFACES)[number];
/** Request payload for control plane agents list. */
export type ControlPlaneAgentsListRequest = InferSchema<
  ReturnType<typeof getControlPlaneAgentsListRequestSchema>
>;
/** Public API contract for runtime agent skill. */
export type RuntimeAgentSkill = InferSchema<ReturnType<typeof getRuntimeAgentSkillSchema>>;
/** Public API contract for runtime suggestion. */
export type RuntimeSuggestion = InferSchema<
  ReturnType<typeof getRuntimeSuggestionSchema>
>;
/** Public API contract for runtime suggestions. */
export type RuntimeSuggestions = InferSchema<
  ReturnType<typeof getRuntimeSuggestionsSchema>
>;
/** Public API contract for runtime agent. */
export type RuntimeAgent = InferSchema<ReturnType<typeof getRuntimeAgentSchema>>;
/** Public API contract for browser-safe runtime agent metadata. */
export type RuntimeAgentPublicMetadata = Pick<
  RuntimeAgent,
  "id" | "name" | "description" | "avatar_url" | "suggestions"
>;
/** Response payload for runtime agent list. */
export type RuntimeAgentListResponse = InferSchema<
  ReturnType<typeof getRuntimeAgentListResponseSchema>
>;
/** Public API contract for dispatch claims. */
export type DispatchClaims = InferSchema<ReturnType<typeof getDispatchClaimsSchema>>;
/** Public API contract for control plane claims. */
export type ControlPlaneClaims = InferSchema<ReturnType<typeof getControlPlaneClaimsSchema>>;

/** Public API contract for runtime agent discovery deps. */
export interface RuntimeAgentDiscoveryDeps {
  ensureProjectDiscovery: (ctx: HandlerContext) => Promise<DiscoveryResult>;
  getAgent: (id: string) => Agent | undefined;
  getAllAgentIds: () => string[];
}

type SignedRequestClaims = {
  aud: string;
  exp: number;
  iat: number;
  project_id: string;
  sub: string;
} & Record<string, unknown>;

function base64urlDecodeToBytes(input: string): ArrayBuffer {
  const normalized = input
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");

  return toArrayBuffer(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseCompactJwsPart<T>(encodedPart: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encodedPart))) as T;
}

function parseCompactJwsObject(
  encodedPart: string,
  label: string,
): Record<string, unknown> {
  const value = parseCompactJwsPart<unknown>(encodedPart);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Compact JWS ${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function readCompactJwsString(
  value: Record<string, unknown>,
  field: string,
): string {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, field);
  const candidate = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof candidate !== "string") {
    throw new TypeError(`Compact JWS field "${field}" must be a string`);
  }
  return candidate;
}

function readCompactJwsInteger(
  value: Record<string, unknown>,
  field: string,
): number {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, field);
  const candidate = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof candidate !== "number" || !Number.isInteger(candidate)) {
    throw new TypeError(`Compact JWS field "${field}" must be an integer`);
  }
  return candidate;
}

function requireCanonicalSignedRequestMethod(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_SIGNED_REQUEST_METHOD_CODE_UNITS ||
    !SIGNED_REQUEST_METHOD_PATTERN.test(value)
  ) {
    throw new TypeError('Compact JWS field "request_method" must be a canonical HTTP method');
  }
  return value;
}

function requireCanonicalSignedRequestPath(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_SIGNED_REQUEST_PATH_CODE_UNITS ||
    value[0] !== "/"
  ) {
    throw new TypeError('Compact JWS field "request_path" must be a canonical URL pathname');
  }

  let parsed: URL;
  try {
    parsed = new SafeURL(value, SIGNED_REQUEST_PATH_BASE);
  } catch {
    throw new TypeError('Compact JWS field "request_path" must be a canonical URL pathname');
  }
  if (
    parsed.origin !== SIGNED_REQUEST_PATH_BASE ||
    parsed.pathname !== value ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError('Compact JWS field "request_path" must be a canonical URL pathname');
  }
  return value;
}

function requireSignedRequestBinding(
  claims: SignedRequestClaims,
  requestMethod: string,
  requestPath: string,
): void {
  const expectedMethod = requireCanonicalSignedRequestMethod(requestMethod);
  const expectedPath = requireCanonicalSignedRequestPath(requestPath);
  if (claims.request_method !== expectedMethod) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request method mismatch" });
  }
  if (claims.request_path !== expectedPath) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request path mismatch" });
  }
}

function readExpectedRequestBinding(options: object): {
  method: string;
  path: string;
} {
  const methodDescriptor = ObjectGetOwnPropertyDescriptor(options, "requestMethod");
  const pathDescriptor = ObjectGetOwnPropertyDescriptor(options, "requestPath");
  if (
    !methodDescriptor ||
    !("value" in methodDescriptor) ||
    typeof methodDescriptor.value !== "string" ||
    !pathDescriptor ||
    !("value" in pathDescriptor) ||
    typeof pathDescriptor.value !== "string"
  ) {
    throw new TypeError("Control-plane request binding must use string data properties");
  }
  return {
    method: methodDescriptor.value,
    path: pathDescriptor.value,
  };
}

function parseSignatureProtectedHeader(encodedHeader: string): void {
  const header = parseCompactJwsObject(encodedHeader, "protected header");
  if (header.alg !== "EdDSA" || "crit" in header) {
    throw new TypeError("Compact JWS protected header is not supported");
  }
  if (header.typ !== undefined && typeof header.typ !== "string") {
    throw new TypeError('Compact JWS field "typ" must be a string');
  }
  if (header.kid !== undefined && typeof header.kid !== "string") {
    throw new TypeError('Compact JWS field "kid" must be a string');
  }
}

function parseSignatureBaseClaims(encodedPayload: string): {
  claims: Record<string, unknown>;
  base: SignedRequestClaims;
} {
  const claims = parseCompactJwsObject(encodedPayload, "payload");
  return {
    claims,
    base: {
      iss: readCompactJwsString(claims, "iss"),
      aud: readCompactJwsString(claims, "aud"),
      sub: readCompactJwsString(claims, "sub"),
      project_id: readCompactJwsString(claims, "project_id"),
      iat: readCompactJwsInteger(claims, "iat"),
      exp: readCompactJwsInteger(claims, "exp"),
    },
  };
}

function parseDispatchSignatureClaims(encodedPayload: string): SignedRequestClaims {
  const { claims, base } = parseSignatureBaseClaims(encodedPayload);
  return {
    ...base,
    platform: readCompactJwsString(claims, "platform"),
    body_sha256: readCompactJwsString(claims, "body_sha256"),
  };
}

function parseControlPlaneSignatureClaims(encodedPayload: string): SignedRequestClaims {
  const { claims, base } = parseSignatureBaseClaims(encodedPayload);
  const surface = readCompactJwsString(claims, "surface");
  if (!CONTROL_PLANE_SURFACES.includes(surface as ControlPlaneSurface)) {
    throw new TypeError('Compact JWS field "surface" is not supported');
  }
  return {
    ...base,
    surface,
    request_hash: readCompactJwsString(claims, "request_hash"),
    request_method: requireCanonicalSignedRequestMethod(
      readCompactJwsString(claims, "request_method"),
    ),
    request_path: requireCanonicalSignedRequestPath(
      readCompactJwsString(claims, "request_path"),
    ),
  };
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s/g, "");

  return toArrayBuffer(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)));
}

let cachedEd25519PublicKey:
  | { pem: string; promise: Promise<CryptoKey> }
  | undefined;

function importEd25519PublicKey(pem: string): Promise<CryptoKey> {
  if (cachedEd25519PublicKey?.pem === pem) {
    return cachedEd25519PublicKey.promise;
  }

  const promise = crypto.subtle.importKey(
    "spki",
    pemToDer(pem, "PUBLIC KEY"),
    "Ed25519",
    false,
    ["verify"],
  );
  cachedEd25519PublicKey = { pem, promise };
  void promise.catch(() => {
    if (cachedEd25519PublicKey?.promise === promise) {
      cachedEd25519PublicKey = undefined;
    }
  });
  return promise;
}

async function sha256Base64url(body: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return base64urlEncodeBytes(new Uint8Array(hash));
}

async function verifySignedRequestJws<TClaims extends SignedRequestClaims>(
  jws: string,
  body: string,
  options: {
    audience: string;
    claimsSchema: Schema<TClaims>;
    expectedProjectId?: string;
    expectedSubject?: string;
    hashClaimKey: keyof TClaims & string;
    maxAgeSeconds: number;
    publicKeyPem: string;
    parseClaims: (encodedPayload: string) => SignedRequestClaims;
    requestBinding?: {
      method: string;
      path: string;
    };
    scopedClaim?: {
      key: keyof TClaims & string;
      label: string;
      value: string;
    };
  },
): Promise<TClaims> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature must be a compact JWS" });
  }

  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature must include header, payload, and signature",
    });
  }

  compactJwsHeaderSchema.parse(parseCompactJwsPart(encodedHeader));
  const claims = options.claimsSchema.parse(parseCompactJwsPart(encodedPayload));
  const claimSnapshot = options.parseClaims(encodedPayload);

  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64urlDecodeToBytes(encodedSignature);
  const publicKey = await importEd25519PublicKey(options.publicKeyPem);
  const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);

  if (!verified) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature verification failed" });
  }

  if (claimSnapshot.iss !== "veryfront-api") {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane issuer mismatch" });
  }

  if (claimSnapshot.aud !== options.audience) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane audience mismatch" });
  }

  if (options.expectedProjectId && claimSnapshot.project_id !== options.expectedProjectId) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane project mismatch" });
  }

  if (options.expectedSubject && claimSnapshot.sub !== options.expectedSubject) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane subject mismatch" });
  }

  if (
    options.scopedClaim &&
    claimSnapshot[options.scopedClaim.key] !== options.scopedClaim.value
  ) {
    throw SECURITY_VIOLATION.create({
      detail: `Control-plane ${options.scopedClaim.label} mismatch`,
    });
  }

  if (options.requestBinding) {
    requireSignedRequestBinding(
      claimSnapshot,
      options.requestBinding.method,
      options.requestBinding.path,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (claimSnapshot.exp <= now) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature expired" });
  }

  if (claimSnapshot.iat > now + SIGNATURE_SKEW_SECONDS) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature issued in the future" });
  }

  if (now - claimSnapshot.iat > options.maxAgeSeconds) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is too old" });
  }

  const requestHash = claimSnapshot[options.hashClaimKey];
  if (typeof requestHash !== "string") {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request hash is missing" });
  }

  const bodyHash = await sha256Base64url(body);
  if (requestHash !== bodyHash) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane body hash mismatch" });
  }

  return claims;
}

export function resolveAgentSkills(agent: Agent): RuntimeAgentSkill[] {
  // Owner-aware: the agent's metadata advertises exactly what the agent can
  // resolve at runtime — unowned skills plus its own.
  const skillsConfig = agent.config.skills === false ? [] : agent.config.skills ?? true;
  return Array.from(
    skillRegistry.resolveForAgent(skillsConfig, { agentId: agent.id }).values(),
  )
    .map((skill) =>
      RuntimeAgentSkillSchema.parse({
        id: skill.id,
        name: skill.metadata.name || skill.id,
        ...(skill.metadata.description ? { description: skill.metadata.description } : {}),
      })
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConfiguredSuggestion(value: unknown): unknown {
  if (typeof value === "string") {
    return {
      type: "prompt",
      title: value,
      prompt: value,
    };
  }

  if (
    isRecord(value) &&
    value.type === undefined &&
    typeof value.title === "string" &&
    typeof value.prompt === "string"
  ) {
    return {
      type: "prompt",
      title: value.title,
      prompt: value.prompt,
    };
  }

  return value;
}

function normalizeConfiguredSuggestions(value: unknown): unknown {
  const wrapped = Array.isArray(value) ? { suggestions: value } : value;
  if (!isRecord(wrapped) || !Array.isArray(wrapped.suggestions)) {
    return wrapped;
  }

  return {
    ...wrapped,
    suggestions: wrapped.suggestions.map(normalizeConfiguredSuggestion),
  };
}

/** Get browser-safe runtime metadata for an agent. */
export function getRuntimeAgentPublicMetadata(
  id: string,
  agent: Agent,
): RuntimeAgentPublicMetadata {
  const rawConfig = agent.config as unknown as Record<string, unknown>;
  const suggestionsParseResult = rawConfig.suggestions === undefined
    ? null
    : RuntimeSuggestionsSchema.safeParse(
      normalizeConfiguredSuggestions(rawConfig.suggestions),
    );
  const suggestions = suggestionsParseResult?.success ? suggestionsParseResult.data : undefined;
  const avatarUrl = typeof rawConfig.avatarUrl === "string" && rawConfig.avatarUrl.trim().length > 0
    ? rawConfig.avatarUrl
    : typeof rawConfig.avatar_url === "string" && rawConfig.avatar_url.trim().length > 0
    ? rawConfig.avatar_url
    : undefined;

  return {
    id,
    name: typeof rawConfig.name === "string" && rawConfig.name.trim().length > 0
      ? rawConfig.name
      : id,
    description: typeof rawConfig.description === "string" ? rawConfig.description : null,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    ...(suggestions === undefined ? {} : { suggestions }),
  };
}

function getRuntimeAgentMetadata(id: string, agent: Agent): RuntimeAgent {
  const rawConfig = agent.config as unknown as Record<string, unknown>;
  const publicMetadata = getRuntimeAgentPublicMetadata(id, agent);

  return RuntimeAgentSchema.parse({
    ...publicMetadata,
    model: agent.config.model ?? null,
    version: typeof rawConfig.version === "string" ? rawConfig.version : null,
    skills: resolveAgentSkills(agent),
  });
}

/** List runtime agents. */
export async function listRuntimeAgents(
  ctx: HandlerContext,
  deps: RuntimeAgentDiscoveryDeps,
): Promise<RuntimeAgentListResponse> {
  await deps.ensureProjectDiscovery(ctx);

  const agents = deps.getAllAgentIds()
    .map((id) => ({ id, agent: deps.getAgent(id) }))
    .filter((entry): entry is { id: string; agent: Agent } => Boolean(entry.agent))
    .map(({ id, agent }) => getRuntimeAgentMetadata(id, agent))
    .sort((left, right) => left.name.localeCompare(right.name));

  return RuntimeAgentListResponseSchema.parse({ agents });
}

/**
 * Verify the Ed25519 signature of a dispatch JWS and the recency of its
 * timestamps, without binding to a particular request body or audience.
 *
 * This is intentionally weaker than {@link verifyDispatchJws}: it answers
 * "was this JWS minted by a holder of the control-plane private key and is it
 * still fresh?" and is used as a trust signal in code paths (proxy-trust,
 * adapter selection) that don't yet have access to the authoritative request
 * body or project audience. Callers that consume request payloads MUST still
 * call {@link verifyDispatchJws} / {@link verifyControlPlaneJws} to bind the
 * signature to the body and project.
 *
 * Returns true iff the signature verifies and `iat`/`exp` are within the
 * allowed skew and max-age window. All other failures (including parsing
 * errors) resolve to false so callers can treat the signal as present-but-not-
 * proven without raising.
 */
export async function verifyDispatchJwsSignature(
  jws: string,
  options: {
    audience?: string;
    expectedProjectId?: string;
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  return await verifySignedRequestJwsSignature(jws, parseDispatchSignatureClaims, options);
}

/**
 * Verify the signature, freshness, and exact HTTP operation binding of a
 * control-plane JWS without granting body or subject authorization.
 *
 * This is still not sufficient to authorize a request. Request handlers must
 * use {@link verifyControlPlaneJws} to bind the signature to the request body.
 */
export async function verifyControlPlaneJwsSignature(
  jws: string,
  options: {
    audience?: string;
    expectedProjectId?: string;
    publicKeyPem: string;
    maxAgeSeconds: number;
    requestMethod: string;
    requestPath: string;
  },
): Promise<boolean> {
  let requestBinding: { method: string; path: string };
  try {
    requestBinding = readExpectedRequestBinding(options);
  } catch {
    return false;
  }
  return await verifySignedRequestJwsSignature(
    jws,
    parseControlPlaneSignatureClaims,
    {
      audience: options.audience,
      expectedProjectId: options.expectedProjectId,
      maxAgeSeconds: options.maxAgeSeconds,
      publicKeyPem: options.publicKeyPem,
      requestBinding,
    },
  );
}

/**
 * Verify a control-plane JWS against its request body without depending on the
 * extension-backed schema registry.
 *
 * The split proxy uses this after it has resolved the project audience. It
 * needs the signed body binding before it may turn target metadata in the body
 * into trusted downstream headers, while the authoritative request handler
 * still performs the full schema-backed verification.
 */
export async function verifyControlPlaneJwsRequestSignature(
  jws: string,
  body: string,
  options: {
    audience: string;
    expectedProjectId?: string;
    publicKeyPem: string;
    maxAgeSeconds: number;
    requestMethod: string;
    requestPath: string;
  },
): Promise<boolean> {
  let requestBinding: { method: string; path: string };
  try {
    requestBinding = readExpectedRequestBinding(options);
  } catch {
    return false;
  }

  return await verifySignedRequestJwsSignature(
    jws,
    parseControlPlaneSignatureClaims,
    {
      audience: options.audience,
      expectedProjectId: options.expectedProjectId,
      maxAgeSeconds: options.maxAgeSeconds,
      publicKeyPem: options.publicKeyPem,
      requestBinding,
      expectedRequestHash: await sha256Base64url(body),
      requestHashClaimKey: "request_hash",
    },
  );
}

async function verifySignedRequestJwsSignature(
  jws: string,
  parseClaims: (encodedPayload: string) => SignedRequestClaims,
  options: {
    audience?: string;
    expectedProjectId?: string;
    publicKeyPem: string;
    maxAgeSeconds: number;
    expectedRequestHash?: string;
    requestHashClaimKey?: string;
    requestBinding?: {
      method: string;
      path: string;
    };
  },
): Promise<boolean> {
  try {
    if (
      jws.length > MAX_SIGNATURE_JWS_CODE_UNITS ||
      options.publicKeyPem.length > MAX_SIGNATURE_PUBLIC_KEY_CODE_UNITS ||
      !Number.isSafeInteger(options.maxAgeSeconds) ||
      options.maxAgeSeconds < 0
    ) {
      return false;
    }

    const parts = jws.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

    // Proxy authenticity checks must remain available before extension-backed
    // schema registration. Authoritative request handlers still use the shared
    // schemas below for full body/audience/project authorization.
    parseSignatureProtectedHeader(encodedHeader);
    const claims = parseClaims(encodedPayload);

    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64urlDecodeToBytes(encodedSignature);
    const publicKey = await importEd25519PublicKey(options.publicKeyPem);
    const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
    if (!verified) return false;

    if (claims.iss !== "veryfront-api") return false;
    if (options.audience !== undefined && claims.aud !== options.audience) return false;
    if (
      options.expectedProjectId !== undefined &&
      claims.project_id !== options.expectedProjectId
    ) {
      return false;
    }
    if (options.requestBinding) {
      requireSignedRequestBinding(
        claims,
        options.requestBinding.method,
        options.requestBinding.path,
      );
    }
    if (
      options.expectedRequestHash !== undefined &&
      (
        options.requestHashClaimKey === undefined ||
        claims[options.requestHashClaimKey] !== options.expectedRequestHash
      )
    ) {
      return false;
    }
    if (
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= claims.iat
    ) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) return false;
    if (claims.iat > now + SIGNATURE_SKEW_SECONDS) return false;
    if (now - claims.iat > options.maxAgeSeconds) return false;

    return true;
  } catch {
    return false;
  }
}

/** Verify dispatch JWS. */
export async function verifyDispatchJws(
  jws: string,
  body: string,
  options: {
    audience: string;
    expectedPlatform?: string;
    expectedProjectId?: string;
    expectedSubject?: string;
    maxAgeSeconds: number;
    publicKeyPem: string;
  },
): Promise<DispatchClaims> {
  return verifySignedRequestJws(jws, body, {
    audience: options.audience,
    claimsSchema: dispatchClaimsSchema,
    expectedProjectId: options.expectedProjectId,
    ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}),
    hashClaimKey: "body_sha256",
    maxAgeSeconds: options.maxAgeSeconds,
    parseClaims: parseDispatchSignatureClaims,
    publicKeyPem: options.publicKeyPem,
    ...(options.expectedPlatform
      ? {
        scopedClaim: {
          key: "platform" as const,
          label: "platform",
          value: options.expectedPlatform,
        },
      }
      : {}),
  });
}

/** Verify a control-plane JWS against its body and canonical HTTP operation. */
export async function verifyControlPlaneJws(
  jws: string,
  body: string,
  options: {
    audience: string;
    expectedProjectId?: string;
    expectedSubject?: string;
    expectedSurface?: ControlPlaneSurface;
    maxAgeSeconds: number;
    publicKeyPem: string;
    requestMethod: string;
    requestPath: string;
  },
): Promise<ControlPlaneClaims> {
  const requestBinding = readExpectedRequestBinding(options);
  return verifySignedRequestJws(jws, body, {
    audience: options.audience,
    claimsSchema: controlPlaneClaimsSchema,
    expectedProjectId: options.expectedProjectId,
    ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}),
    hashClaimKey: "request_hash",
    maxAgeSeconds: options.maxAgeSeconds,
    parseClaims: parseControlPlaneSignatureClaims,
    publicKeyPem: options.publicKeyPem,
    requestBinding,
    ...(options.expectedSurface
      ? {
        scopedClaim: {
          key: "surface" as const,
          label: "surface",
          value: options.expectedSurface,
        },
      }
      : {}),
  });
}
