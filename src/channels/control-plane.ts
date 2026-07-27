/**
 * Signed control-plane discovery, route, and JWS verification contracts.
 *
 * Signature-only helpers establish authenticity and freshness; request
 * handlers must use the body-bound verifier before authorizing an operation.
 *
 * @module channels/control-plane
 *
 * @example Verify a body-bound control-plane request
 * ```ts
 * import { verifyControlPlaneJws } from "veryfront/channels/control-plane";
 *
 * const claims = await verifyControlPlaneJws(jws, rawBody, {
 *   audience: "project-slug",
 *   expectedProjectId: "project-id",
 *   expectedSubject: "run_123",
 *   expectedSurface: "studio",
 *   maxAgeSeconds: 60,
 *   publicKeyPem,
 * });
 * ```
 */
import { SECURITY_VIOLATION } from "#veryfront/errors";
import type { Agent } from "#veryfront/agent/types.ts";
import { getAgUiRuntimeRunIdSchema } from "#veryfront/agent/runtime/ag-ui-contract.ts";
import type { HandlerContext } from "#veryfront/types/server.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { base64urlDecodeBytes, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

const SIGNATURE_SKEW_SECONDS = 5;
const MAX_COMPACT_JWS_CODE_UNITS = 16 * 1024;
const MAX_COMPACT_JWS_HEADER_CODE_UNITS = 4 * 1024;
const MAX_COMPACT_JWS_PAYLOAD_CODE_UNITS = 8 * 1024;
const MAX_PUBLIC_KEY_PEM_CODE_UNITS = 8 * 1024;
const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SIGNATURE_BASE64URL_CODE_UNITS = 86;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

/** Shared control plane agents list path value. */
export const CONTROL_PLANE_AGENTS_LIST_PATH = "/api/control-plane/agents/list";
/** Shared control plane runs path prefix value. */
export const CONTROL_PLANE_RUNS_PATH_PREFIX = "/api/control-plane/runs/";
/** Shared control plane run stream path value. */
export const CONTROL_PLANE_RUN_STREAM_PATH = "/api/control-plane/runs/:runId/stream";

const CONTROL_PLANE_RUNS_REGEX_PREFIX = CONTROL_PLANE_RUNS_PATH_PREFIX.replaceAll("/", "\\/");
const CONTROL_PLANE_CANCEL_PATH_PATTERN = new RegExp(
  `^${CONTROL_PLANE_RUNS_REGEX_PREFIX}([^/]+)$`,
);
const CONTROL_PLANE_STREAM_OR_RESUME_PATH_PATTERN = new RegExp(
  `^${CONTROL_PLANE_RUNS_REGEX_PREFIX}([^/]+)\\/(?:stream|resume)$`,
);
const controlPlaneRunIdSchema = lazySchema(getAgUiRuntimeRunIdSchema);

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

  const match = normalizedMethod === "DELETE"
    ? CONTROL_PLANE_CANCEL_PATH_PATTERN.exec(requestPath)
    : normalizedMethod === "POST"
    ? CONTROL_PLANE_STREAM_OR_RESUME_PATH_PATTERN.exec(requestPath)
    : null;

  return match?.[1] !== undefined && controlPlaneRunIdSchema.safeParse(match[1]).success;
}

const getAvatarUrlSchema = defineSchema((v) => v.string().url());
const avatarUrlSchema = lazySchema(getAvatarUrlSchema);

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
export type DispatchClaims = ReturnType<typeof parseDispatchClaims>;
/** Public API contract for control plane claims. */
export type ControlPlaneClaims = ReturnType<typeof parseControlPlaneClaims>;

/** Public API contract for runtime agent discovery deps. */
export interface RuntimeAgentDiscoveryDeps {
  ensureProjectDiscovery: (ctx: HandlerContext) => Promise<unknown>;
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Compare runtime metadata by stable code-point name and id order. */
export function compareRuntimeAgentMetadata(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  return compareStrings(left.name, right.name) || compareStrings(left.id, right.id);
}

function assertValidMaxAgeSeconds(maxAgeSeconds: number): void {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature max age must be a non-negative safe integer",
    });
  }
}

function validateSignedRequestFreshness(
  claims: Pick<SignedRequestClaims, "exp" | "iat">,
  maxAgeSeconds: number,
): void {
  assertValidMaxAgeSeconds(maxAgeSeconds);
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature timestamps must be safe integers",
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= claims.iat) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature expiration must be after its issue time",
    });
  }
  if (claims.exp <= now) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature expired" });
  }
  if (claims.iat > now + SIGNATURE_SKEW_SECONDS) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature issued in the future" });
  }
  if (now - claims.iat > maxAgeSeconds) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is too old" });
  }
}

function base64urlDecodeToBytes(input: string): ArrayBuffer {
  const bytes = base64urlDecodeBytes(input);
  if (!bytes) {
    throw new TypeError("Invalid base64url encoding in compact JWS");
  }
  return toArrayBuffer(bytes);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function parseCompactJwsPart<T>(encodedPart: string): T {
  return JSON.parse(utf8Decoder.decode(base64urlDecodeToBytes(encodedPart))) as T;
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

function readStringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw new TypeError(`Compact JWS field "${field}" must be a string`);
  }
  return candidate;
}

function readIntegerField(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isInteger(candidate)) {
    throw new TypeError(`Compact JWS field "${field}" must be an integer`);
  }
  return candidate;
}

function parseCompactJwsProtectedHeader(encodedHeader: string): void {
  const header = parseCompactJwsObject(encodedHeader, "protected header");
  if (header.alg !== "EdDSA") {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature must use the EdDSA algorithm",
    });
  }
  if ("crit" in header) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature uses unsupported critical header parameters",
    });
  }
  if (header.typ !== undefined && typeof header.typ !== "string") {
    throw new TypeError('Compact JWS field "typ" must be a string');
  }
  if (header.kid !== undefined && typeof header.kid !== "string") {
    throw new TypeError('Compact JWS field "kid" must be a string');
  }
}

function parseDispatchClaims(encodedPayload: string) {
  const claims = parseCompactJwsObject(encodedPayload, "payload");
  return {
    iss: readStringField(claims, "iss"),
    aud: readStringField(claims, "aud"),
    sub: readStringField(claims, "sub"),
    project_id: readStringField(claims, "project_id"),
    platform: readStringField(claims, "platform"),
    body_sha256: readStringField(claims, "body_sha256"),
    iat: readIntegerField(claims, "iat"),
    exp: readIntegerField(claims, "exp"),
  };
}

function parseControlPlaneClaims(encodedPayload: string) {
  const claims = parseCompactJwsObject(encodedPayload, "payload");
  const surface = readStringField(claims, "surface");
  if (!CONTROL_PLANE_SURFACES.includes(surface as ControlPlaneSurface)) {
    throw new TypeError('Compact JWS field "surface" is not supported');
  }

  return {
    iss: readStringField(claims, "iss"),
    aud: readStringField(claims, "aud"),
    sub: readStringField(claims, "sub"),
    surface: surface as ControlPlaneSurface,
    project_id: readStringField(claims, "project_id"),
    request_hash: readStringField(claims, "request_hash"),
    iat: readIntegerField(claims, "iat"),
    exp: readIntegerField(claims, "exp"),
  };
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const normalizedPem = pem.trim();
  if (
    normalizedPem.length > MAX_PUBLIC_KEY_PEM_CODE_UNITS ||
    !normalizedPem.startsWith(begin) ||
    !normalizedPem.endsWith(end)
  ) {
    throw new TypeError(`Invalid ${label} PEM envelope`);
  }

  const body = normalizedPem.slice(begin.length, -end.length).replace(/\s/g, "");
  if (body.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new TypeError(`Invalid ${label} PEM body`);
  }

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
  const hash = await crypto.subtle.digest("SHA-256", utf8Encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(hash));
}

type CompactJwsParts = readonly [
  encodedHeader: string,
  encodedPayload: string,
  encodedSignature: string,
];

function parseCompactJwsEnvelope(jws: string): CompactJwsParts {
  if (jws.length > MAX_COMPACT_JWS_CODE_UNITS) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is too large" });
  }

  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature must be a compact JWS" });
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature must include header, payload, and signature",
    });
  }
  if (
    encodedHeader.length > MAX_COMPACT_JWS_HEADER_CODE_UNITS ||
    encodedPayload.length > MAX_COMPACT_JWS_PAYLOAD_CODE_UNITS ||
    encodedSignature.length !== ED25519_SIGNATURE_BASE64URL_CODE_UNITS
  ) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature has an invalid compact JWS part size",
    });
  }

  return [encodedHeader, encodedPayload, encodedSignature];
}

async function verifyCompactJwsEnvelope(
  parts: CompactJwsParts,
  publicKeyPem: string,
): Promise<void> {
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signature = base64urlDecodeToBytes(encodedSignature);
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature has an invalid Ed25519 signature size",
    });
  }

  const signingInput = utf8Encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const publicKey = await importEd25519PublicKey(publicKeyPem);
  const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
  if (!verified) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature verification failed" });
  }
}

async function verifySignedRequestJws<TClaims extends SignedRequestClaims>(
  jws: string,
  body: string,
  options: {
    audience: string;
    parseClaims: (encodedPayload: string) => TClaims;
    expectedProjectId?: string;
    expectedSubject?: string;
    hashClaimKey: keyof TClaims & string;
    maxAgeSeconds: number;
    publicKeyPem: string;
    scopedClaim?: {
      key: keyof TClaims & string;
      label: string;
      value: string;
    };
  },
): Promise<TClaims> {
  assertValidMaxAgeSeconds(options.maxAgeSeconds);

  const parts = parseCompactJwsEnvelope(jws);
  await verifyCompactJwsEnvelope(parts, options.publicKeyPem);
  const [encodedHeader, encodedPayload] = parts;

  parseCompactJwsProtectedHeader(encodedHeader);
  const claims = options.parseClaims(encodedPayload);

  if (claims.iss !== "veryfront-api") {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane issuer mismatch" });
  }

  if (claims.aud !== options.audience) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane audience mismatch" });
  }

  if (
    options.expectedProjectId !== undefined && claims.project_id !== options.expectedProjectId
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane project mismatch" });
  }

  if (options.expectedSubject !== undefined && claims.sub !== options.expectedSubject) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane subject mismatch" });
  }

  if (options.scopedClaim && claims[options.scopedClaim.key] !== options.scopedClaim.value) {
    throw SECURITY_VIOLATION.create({
      detail: `Control-plane ${options.scopedClaim.label} mismatch`,
    });
  }

  validateSignedRequestFreshness(claims, options.maxAgeSeconds);

  const requestHash = claims[options.hashClaimKey];
  if (typeof requestHash !== "string") {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request hash is missing" });
  }

  const bodyHash = await sha256Base64url(body);
  if (requestHash !== bodyHash) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane body hash mismatch" });
  }

  return claims;
}

/**
 * Resolve the skills visible to an agent and return stable, public metadata.
 *
 * Owner-aware registry filtering prevents an agent from advertising skills it
 * cannot resolve during execution.
 */
export function resolveAgentSkills(agent: Agent): RuntimeAgentSkill[] {
  // Owner-aware: the agent's metadata advertises exactly what the agent can
  // resolve at runtime — unowned skills plus its own.
  const skillsConfig = agent.config.skills === false ? [] : agent.config.skills ?? true;
  return Array.from(
    skillRegistryInternal.resolveForAgent(skillsConfig, { agentId: agent.id }).values(),
  )
    .map((skill) =>
      RuntimeAgentSkillSchema.parse({
        id: skill.id,
        name: skill.metadata.name || skill.id,
        ...(skill.metadata.description ? { description: skill.metadata.description } : {}),
      })
    )
    .sort(compareRuntimeAgentMetadata);
}

/** Get browser-safe runtime metadata for an agent. */
export function getRuntimeAgentPublicMetadata(
  id: string,
  agent: Agent,
): RuntimeAgentPublicMetadata {
  const rawConfig = agent.config as unknown as Record<string, unknown>;
  const suggestionsParseResult = rawConfig.suggestions === undefined
    ? null
    : RuntimeSuggestionsSchema.safeParse(rawConfig.suggestions);
  const suggestions = suggestionsParseResult?.success ? suggestionsParseResult.data : undefined;
  const avatarUrl = typeof rawConfig.avatarUrl === "string" && rawConfig.avatarUrl.trim().length > 0
    ? rawConfig.avatarUrl
    : typeof rawConfig.avatar_url === "string" && rawConfig.avatar_url.trim().length > 0
    ? rawConfig.avatar_url
    : undefined;
  const parsedAvatarUrl = avatarUrl === undefined
    ? undefined
    : avatarUrlSchema.safeParse(avatarUrl);

  return {
    id,
    name: typeof rawConfig.name === "string" && rawConfig.name.trim().length > 0
      ? rawConfig.name
      : id,
    description: typeof rawConfig.description === "string" ? rawConfig.description : null,
    ...(parsedAvatarUrl?.success ? { avatar_url: parsedAvatarUrl.data } : {}),
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
    .sort(compareRuntimeAgentMetadata);

  return RuntimeAgentListResponseSchema.parse({ agents });
}

/**
 * Verify the Ed25519 signature of a dispatch JWS and the recency of its
 * timestamps, without binding to a particular request body or audience.
 *
 * This is intentionally weaker than {@link verifyDispatchJws}: it answers
 * "was this JWS minted by a holder of the control-plane private key and is it
 * still fresh?" It grants authenticity only: it MUST NOT authorize forwarded
 * headers, filesystem paths, project selection, or any other request-scoped
 * capability. Callers that consume request payloads MUST still call
 * {@link verifyDispatchJws} / {@link verifyControlPlaneJws} to bind the
 * signature to the body, audience, and project.
 *
 * Returns true iff the signature verifies and `iat`/`exp` are within the
 * allowed skew and max-age window. All other failures (including parsing
 * errors) resolve to false so callers can treat the signal as present-but-not-
 * proven without raising.
 */
export async function verifyDispatchJwsSignature(
  jws: string,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  return await verifySignedRequestJwsSignature(jws, parseDispatchClaims, options);
}

/**
 * Verify the signature and freshness of a control-plane JWS without granting
 * body, audience, project, subject, or surface authorization.
 *
 * This has the same authenticity-only contract as
 * {@link verifyDispatchJwsSignature}; request handlers must still perform the
 * body-bound {@link verifyControlPlaneJws} check before consuming a request.
 */
export async function verifyControlPlaneJwsSignature(
  jws: string,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  return await verifySignedRequestJwsSignature(jws, parseControlPlaneClaims, options);
}

async function verifySignedRequestJwsSignature<TClaims extends SignedRequestClaims>(
  jws: string,
  parseClaims: (encodedPayload: string) => TClaims,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  try {
    assertValidMaxAgeSeconds(options.maxAgeSeconds);
    const parts = parseCompactJwsEnvelope(jws);
    await verifyCompactJwsEnvelope(parts, options.publicKeyPem);
    const [encodedHeader, encodedPayload] = parts;

    parseCompactJwsProtectedHeader(encodedHeader);
    const claims = parseClaims(encodedPayload);

    if (claims.iss !== "veryfront-api") return false;

    validateSignedRequestFreshness(claims, options.maxAgeSeconds);

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
    parseClaims: parseDispatchClaims,
    expectedProjectId: options.expectedProjectId,
    ...(options.expectedSubject !== undefined ? { expectedSubject: options.expectedSubject } : {}),
    hashClaimKey: "body_sha256",
    maxAgeSeconds: options.maxAgeSeconds,
    publicKeyPem: options.publicKeyPem,
    ...(options.expectedPlatform !== undefined
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

/** Verify control plane JWS. */
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
  },
): Promise<ControlPlaneClaims> {
  return verifySignedRequestJws(jws, body, {
    audience: options.audience,
    parseClaims: parseControlPlaneClaims,
    expectedProjectId: options.expectedProjectId,
    ...(options.expectedSubject !== undefined ? { expectedSubject: options.expectedSubject } : {}),
    hashClaimKey: "request_hash",
    maxAgeSeconds: options.maxAgeSeconds,
    publicKeyPem: options.publicKeyPem,
    ...(options.expectedSurface !== undefined
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
