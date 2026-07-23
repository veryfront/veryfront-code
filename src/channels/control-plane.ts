import { SECURITY_VIOLATION } from "#veryfront/errors";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { readOwnDataProperty, snapshotDenseArray, snapshotJsonValue } from "./snapshot.ts";

export type {
  InferSchema,
  InferShape,
  RefinementCtx,
  Schema,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";

const SIGNATURE_SKEW_SECONDS = 5;
const MAX_SIGNATURE_AGE_SECONDS = 86_400;
const MAX_JWS_SEGMENT_LENGTH = 16_384;
const MAX_COMPACT_JWS_LENGTH = MAX_JWS_SEGMENT_LENGTH * 3 + 2;
const MAX_PUBLIC_KEY_PEM_LENGTH = 16_384;
const MAX_SIGNED_BODY_BYTES = 128 * 1_024;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_AVATAR_URL_LENGTH = 2_048;
const MAX_RUNTIME_AGENTS = 1_000;
const MAX_RUNTIME_AGENT_SKILLS = 256;
const MAX_RUNTIME_SUGGESTIONS = 100;
const MAX_RUNTIME_AGENT_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_SKILL_TAGS = 64;
const MAX_SKILL_EXAMPLES = 32;
const MAX_SKILL_TEXT_LENGTH = 4_096;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ED25519_SIGNATURE_BYTES = 64;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function serializedJsonBytes(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : textEncoder.encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

/** Shared control plane agents list path value. */
export const CONTROL_PLANE_AGENTS_LIST_PATH = "/api/control-plane/agents/list";
/** Shared control plane runs path prefix value. */
export const CONTROL_PLANE_RUNS_PATH_PREFIX = "/api/control-plane/runs/";
/** Shared control plane run stream path value. */
export const CONTROL_PLANE_RUN_STREAM_PATH = "/api/control-plane/runs/:runId/stream";

const CONTROL_PLANE_RUN_ID_PATH_SEGMENT = "[^/]+";
const CONTROL_PLANE_RUNS_REGEX_PREFIX = CONTROL_PLANE_RUNS_PATH_PREFIX.replaceAll("/", "\\/");
const CONTROL_PLANE_RUN_CANCEL_PATTERN = new RegExp(
  `^${CONTROL_PLANE_RUNS_REGEX_PREFIX}${CONTROL_PLANE_RUN_ID_PATH_SEGMENT}$`,
);
const CONTROL_PLANE_RUN_CONFIG_OPTIONAL_POST_PATTERN = new RegExp(
  `^${CONTROL_PLANE_RUNS_REGEX_PREFIX}${CONTROL_PLANE_RUN_ID_PATH_SEGMENT}\\/(?:stream|resume)$`,
);

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
    return CONTROL_PLANE_RUN_CANCEL_PATTERN.test(requestPath);
  }

  if (normalizedMethod !== "POST") {
    return false;
  }

  return CONTROL_PLANE_RUN_CONFIG_OPTIONAL_POST_PATTERN.test(requestPath);
}

/** Allowed control-plane surfaces, the source of truth for {@link ControlPlaneSurface}. */
export const CONTROL_PLANE_SURFACES = ["studio", "channels", "a2a", "mcp"] as const;

/** Public API contract for a control-plane surface. */
export type ControlPlaneSurface = (typeof CONTROL_PLANE_SURFACES)[number];

/** Request payload for control-plane agent discovery. */
export interface ControlPlaneAgentsListRequest {
  /** Unique request identifier. */
  requestId: string;
  /** Project identifier bound to the request. */
  projectId: string;
  /** Control-plane surface requesting discovery. */
  surface: ControlPlaneSurface;
}

/** Skill metadata exposed for a runtime agent. */
export interface RuntimeAgentSkill {
  /** Skill identifier. */
  id: string;
  /** Human-readable skill name. */
  name: string;
  /** Optional skill description. */
  description?: string;
  /** Optional skill tags. */
  tags?: string[];
  /** Optional skill examples. */
  examples?: string[];
}

/** Suggestion exposed by a runtime agent. */
export type RuntimeSuggestion =
  | {
    /** Suggestion discriminator. */
    type: "prompt";
    /** Human-readable prompt title. */
    title: string;
    /** Prompt text. */
    prompt: string;
  }
  | {
    /** Referenced prompt identifier. */
    id: string;
    /** Suggestion discriminator. */
    type: "prompt";
  }
  | {
    /** Suggestion discriminator. */
    type: "task";
    /** Referenced task identifier. */
    id: string;
  };

/** Suggestion collection exposed by a runtime agent. */
export interface RuntimeSuggestions {
  /** Optional welcome message. */
  welcomeMessage?: string;
  /** Ordered suggestions. */
  suggestions: RuntimeSuggestion[];
}

/** Runtime agent metadata returned to the control plane. */
export interface RuntimeAgent {
  /** Runtime registry identifier. */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** Optional agent description. */
  description?: string | null;
  /** Optional browser-safe avatar URL. */
  avatar_url?: string | null;
  /** Optional model identifier. */
  model?: string | null;
  /** Optional agent version. */
  version?: string | null;
  /** Skills available to the agent. */
  skills?: RuntimeAgentSkill[];
  /** Suggestions exposed by the agent. */
  suggestions?: RuntimeSuggestions;
}

/** Browser-safe subset of runtime agent metadata. */
export type RuntimeAgentPublicMetadata = Pick<
  RuntimeAgent,
  "id" | "name" | "description" | "avatar_url" | "suggestions"
>;

/** Response returned by runtime agent discovery. */
export interface RuntimeAgentListResponse {
  /** Discovered runtime agents. */
  agents: RuntimeAgent[];
}

/** Agent fields required to build runtime discovery metadata. */
export interface RuntimeAgentMetadataSource {
  /** Runtime agent identifier. */
  id: string;
  /** Metadata-bearing agent configuration. */
  config: {
    /** Optional human-readable name. */
    name?: string;
    /** Optional avatar URL. */
    avatarUrl?: string;
    /** Deprecated serialized avatar URL. */
    avatar_url?: string;
    /** Optional public description. */
    description?: string;
    /** Optional model identifier. */
    model?: string;
    /** Optional version metadata. */
    version?: unknown;
    /** Skill selection for runtime discovery. */
    skills?: true | string[];
    /** Optional public suggestions. */
    suggestions?: unknown;
  };
}

interface RuntimeAgentConfigSnapshot {
  readonly avatarUrl?: unknown;
  readonly avatar_url?: unknown;
  readonly description?: unknown;
  readonly model?: unknown;
  readonly name?: unknown;
  readonly skills?: true | string[];
  readonly suggestions?: unknown;
  readonly version?: unknown;
}

interface RuntimeAgentSourceSnapshot {
  readonly id: string;
  readonly config: RuntimeAgentConfigSnapshot;
}

/** Claims carried by a signed channel dispatch. */
export interface DispatchClaims {
  /** Token issuer. */
  iss: string;
  /** Intended project audience. */
  aud: string;
  /** Dispatch subject identifier. */
  sub: string;
  /** Project identifier. */
  project_id: string;
  /** Source platform. */
  platform: string;
  /** SHA-256 digest of the signed body. */
  body_sha256: string;
  /** Issued-at time in Unix seconds. */
  iat: number;
  /** Expiration time in Unix seconds. */
  exp: number;
}

/** Claims carried by a signed control-plane request. */
export interface ControlPlaneClaims {
  /** Token issuer. */
  iss: string;
  /** Intended project audience. */
  aud: string;
  /** Request subject identifier. */
  sub: string;
  /** Control-plane surface. */
  surface: ControlPlaneSurface;
  /** Project identifier. */
  project_id: string;
  /** SHA-256 digest of the signed body. */
  request_hash: string;
  /** Issued-at time in Unix seconds. */
  iat: number;
  /** Expiration time in Unix seconds. */
  exp: number;
}

/** Zod schema for get control plane surface. */
export const getControlPlaneSurfaceSchema: () => Schema<ControlPlaneSurface> = defineSchema((v) =>
  v.enum(CONTROL_PLANE_SURFACES)
);
/** Zod schema for control plane surface. */
export const ControlPlaneSurfaceSchema: Schema<ControlPlaneSurface> = lazySchema(
  getControlPlaneSurfaceSchema,
);

/** Zod schema for get control plane agents list request. */
export const getControlPlaneAgentsListRequestSchema: () => Schema<ControlPlaneAgentsListRequest> =
  defineSchema((v) =>
    v.object({
      requestId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      projectId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      surface: getControlPlaneSurfaceSchema(),
    }).strip()
  );
/** Zod schema for control plane agents list request. */
export const ControlPlaneAgentsListRequestSchema: Schema<ControlPlaneAgentsListRequest> =
  lazySchema(
    getControlPlaneAgentsListRequestSchema,
  );

/** Zod schema for get runtime agent skill. */
export const getRuntimeAgentSkillSchema: () => Schema<RuntimeAgentSkill> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    name: v.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    description: v.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    tags: v.array(v.string().min(1).max(MAX_IDENTIFIER_LENGTH)).max(MAX_SKILL_TAGS).optional(),
    examples: v.array(v.string().max(MAX_SKILL_TEXT_LENGTH)).max(MAX_SKILL_EXAMPLES).optional(),
  }).strip()
);
/** Zod schema for runtime agent skill. */
export const RuntimeAgentSkillSchema: Schema<RuntimeAgentSkill> = lazySchema(
  getRuntimeAgentSkillSchema,
);

/** Zod schema for get runtime suggestion. */
export const getRuntimeSuggestionSchema: () => Schema<RuntimeSuggestion> = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("prompt"),
      title: v.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
      prompt: v.string().min(1).max(MAX_SKILL_TEXT_LENGTH),
    }).strict(),
    v.object({
      id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      type: v.literal("prompt"),
    }).strict(),
    v.object({
      type: v.literal("task"),
      id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    }).strict(),
  ])
);
/** Zod schema for runtime suggestion. */
export const RuntimeSuggestionSchema: Schema<RuntimeSuggestion> = lazySchema(
  getRuntimeSuggestionSchema,
);

/** Zod schema for get runtime suggestions. */
export const getRuntimeSuggestionsSchema: () => Schema<RuntimeSuggestions> = defineSchema((v) =>
  v.object({
    welcomeMessage: v.string().min(1).max(MAX_SKILL_TEXT_LENGTH).optional(),
    suggestions: v.array(getRuntimeSuggestionSchema()).max(MAX_RUNTIME_SUGGESTIONS),
  }).strip()
);
/** Zod schema for runtime suggestions. */
export const RuntimeSuggestionsSchema: Schema<RuntimeSuggestions> = lazySchema(
  getRuntimeSuggestionsSchema,
);

/** Zod schema for get runtime agent. */
export const getRuntimeAgentSchema: () => Schema<RuntimeAgent> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    name: v.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    description: v.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
    avatar_url: v.string().url().max(MAX_AVATAR_URL_LENGTH).refine(
      (value) => normalizeAvatarUrl(value) !== undefined,
      { message: "Runtime agent avatar URL must use HTTP or HTTPS without credentials" },
    ).nullable().optional(),
    model: v.string().max(MAX_IDENTIFIER_LENGTH).nullable().optional(),
    version: v.string().max(MAX_IDENTIFIER_LENGTH).nullable().optional(),
    skills: v.array(getRuntimeAgentSkillSchema()).max(MAX_RUNTIME_AGENT_SKILLS).optional(),
    suggestions: getRuntimeSuggestionsSchema().optional(),
  }).strip()
);
/** Zod schema for runtime agent. */
export const RuntimeAgentSchema: Schema<RuntimeAgent> = lazySchema(getRuntimeAgentSchema);

/** Zod schema for get runtime agent list response. */
export const getRuntimeAgentListResponseSchema: () => Schema<RuntimeAgentListResponse> =
  defineSchema((v) =>
    v.object({
      agents: v.array(getRuntimeAgentSchema()).max(MAX_RUNTIME_AGENTS),
    }).strip().refine(
      (value) =>
        (serializedJsonBytes(value) ?? Number.POSITIVE_INFINITY) <=
          MAX_RUNTIME_AGENT_RESPONSE_BYTES,
      { message: "Runtime agent response exceeds the supported limit" },
    )
  );
/** Zod schema for runtime agent list response. */
export const RuntimeAgentListResponseSchema: Schema<RuntimeAgentListResponse> = lazySchema(
  getRuntimeAgentListResponseSchema,
);

/** Project identity available to channel discovery operations. */
export interface ChannelRequestContext {
  /** Project identifier resolved for the request. */
  projectId?: string;
}

/** Request context that provides project discovery as a capability. */
export interface ChannelDiscoveryContext extends ChannelRequestContext {
  /** Discover project-owned runtime definitions for this request. */
  ensureProjectDiscovery(): Promise<unknown>;
}

/**
 * Legacy server-context projection accepted by the default discovery adapter.
 *
 * New integrations should provide {@link ChannelDiscoveryContext}. This
 * projection keeps existing server handler contexts source-compatible without
 * exposing the complete server handler contract through the channels API.
 */
export interface LegacyChannelRequestContext extends ChannelRequestContext {
  /** Absolute project directory used by the runtime adapter. */
  projectDir: string;
  /** Runtime adapter fields required by project discovery. */
  adapter: {
    /** Filesystem adapter used to discover project definitions. */
    fs: unknown;
  };
}

/** Request contexts supported by the default channel discovery adapter. */
export type SupportedChannelRequestContext =
  | ChannelDiscoveryContext
  | LegacyChannelRequestContext;

/** Public API contract for runtime agent discovery dependencies. */
export interface RuntimeAgentDiscoveryDeps<
  TContext extends ChannelRequestContext = ChannelRequestContext,
> {
  /** Ensure project-owned runtime definitions are discovered. */
  ensureProjectDiscovery: (ctx: TContext) => Promise<unknown>;
  /** Resolve a discovered agent by registry identifier. */
  getAgent: (id: string) => RuntimeAgentMetadataSource | undefined;
  /** List discovered runtime agent identifiers. */
  getAllAgentIds: () => string[];
}

interface SignedRequestClaims {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  project_id: string;
  sub: string;
}

function isBoundedClaimString(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isControlPlaneSurface(value: unknown): value is ControlPlaneSurface {
  return typeof value === "string" &&
    (CONTROL_PLANE_SURFACES as readonly string[]).includes(value);
}

function ownDataValue(value: object, key: string): unknown {
  const property = readOwnDataProperty(value, key);
  return property.ok && property.present ? property.value : undefined;
}

function parseSignedRequestClaims(value: unknown): SignedRequestClaims | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const iss = ownDataValue(value, "iss");
  const aud = ownDataValue(value, "aud");
  const sub = ownDataValue(value, "sub");
  const projectId = ownDataValue(value, "project_id");
  const iat = ownDataValue(value, "iat");
  const exp = ownDataValue(value, "exp");
  if (
    !isBoundedClaimString(iss) || !isBoundedClaimString(aud) ||
    !isBoundedClaimString(sub) || !isBoundedClaimString(projectId) ||
    !isNonNegativeSafeInteger(iat) || !isNonNegativeSafeInteger(exp)
  ) {
    return undefined;
  }
  return { iss, aud, sub, project_id: projectId, iat, exp };
}

function parseDispatchClaims(value: unknown): DispatchClaims | undefined {
  const common = parseSignedRequestClaims(value);
  if (!common || typeof value !== "object" || value === null) return undefined;
  const platform = ownDataValue(value, "platform");
  const bodySha256 = ownDataValue(value, "body_sha256");
  if (
    !isBoundedClaimString(platform) || typeof bodySha256 !== "string" ||
    !SHA256_BASE64URL_PATTERN.test(bodySha256)
  ) {
    return undefined;
  }
  return { ...common, platform, body_sha256: bodySha256 };
}

function parseControlPlaneClaims(value: unknown): ControlPlaneClaims | undefined {
  const common = parseSignedRequestClaims(value);
  if (!common || typeof value !== "object" || value === null) return undefined;
  const surface = ownDataValue(value, "surface");
  const requestHash = ownDataValue(value, "request_hash");
  if (
    !isControlPlaneSurface(surface) ||
    typeof requestHash !== "string" || !SHA256_BASE64URL_PATTERN.test(requestHash)
  ) {
    return undefined;
  }
  return {
    ...common,
    surface,
    request_hash: requestHash,
  };
}

function isCompactJwsHeader(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  let keys: string[];
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return false;
    keys = ownKeys as string[];
  } catch {
    return false;
  }
  if (keys.some((key) => key !== "alg" && key !== "typ" && key !== "kid")) return false;
  if (ownDataValue(value, "alg") !== "EdDSA") return false;

  const typ = ownDataValue(value, "typ");
  if (typ !== undefined && (typeof typ !== "string" || typ.length < 1 || typ.length > 32)) {
    return false;
  }
  const kid = ownDataValue(value, "kid");
  return kid === undefined || isBoundedClaimString(kid);
}

function base64urlDecodeToBytes(input: string): ArrayBuffer {
  if (
    input.length === 0 || input.length > MAX_JWS_SEGMENT_LENGTH ||
    input.length % 4 === 1 || !BASE64URL_PATTERN.test(input)
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature encoding is invalid" });
  }

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
  return JSON.parse(textDecoder.decode(base64urlDecodeToBytes(encodedPart))) as T;
}

function pemToDer(pem: string, label: string): ArrayBuffer {
  if (textEncoder.encode(pem).byteLength > MAX_PUBLIC_KEY_PEM_LENGTH) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane public key is invalid" });
  }

  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const trimmed = pem.trim();
  if (!trimmed.startsWith(begin) || !trimmed.endsWith(end)) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane public key is invalid" });
  }

  const body = trimmed.slice(begin.length, -end.length).replace(/\s/g, "");
  if (!body || body.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane public key is invalid" });
  }

  return toArrayBuffer(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)));
}

let cachedPublicKey: { pem: string; key: Promise<CryptoKey> } | undefined;

function importEd25519PublicKey(pem: string): Promise<CryptoKey> {
  if (cachedPublicKey?.pem === pem) return cachedPublicKey.key;

  const key = crypto.subtle.importKey(
    "spki",
    pemToDer(pem, "PUBLIC KEY"),
    "Ed25519",
    false,
    ["verify"],
  );
  cachedPublicKey = { pem, key };
  void key.catch(() => {
    if (cachedPublicKey?.key === key) cachedPublicKey = undefined;
  });
  return key;
}

async function sha256Base64url(body: string): Promise<string> {
  if (body.length > MAX_SIGNED_BODY_BYTES) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request body is too large" });
  }
  const encodedBody = textEncoder.encode(body);
  if (encodedBody.byteLength > MAX_SIGNED_BODY_BYTES) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane request body is too large" });
  }

  const hash = await crypto.subtle.digest("SHA-256", encodedBody);
  return base64urlEncodeBytes(new Uint8Array(hash));
}

async function verifySignedRequestJws<TClaims extends SignedRequestClaims>(
  jws: string,
  body: string,
  options: {
    audience: string;
    parseClaims: (value: unknown) => TClaims | undefined;
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
  if (
    typeof jws !== "string" || typeof body !== "string" || typeof options.publicKeyPem !== "string"
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane verification input is invalid" });
  }
  if (
    !Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1 ||
    options.maxAgeSeconds > MAX_SIGNATURE_AGE_SECONDS
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature age limit is invalid" });
  }
  if (
    !isBoundedClaimString(options.audience) ||
    options.expectedProjectId !== undefined &&
      !isBoundedClaimString(options.expectedProjectId) ||
    options.expectedSubject !== undefined &&
      !isBoundedClaimString(options.expectedSubject) ||
    options.scopedClaim !== undefined && !isBoundedClaimString(options.scopedClaim.value)
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane verification scope is invalid" });
  }

  if (jws.length > MAX_COMPACT_JWS_LENGTH) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is too large" });
  }

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

  let claims: TClaims;
  try {
    if (!isCompactJwsHeader(parseCompactJwsPart(encodedHeader))) {
      throw new TypeError("Invalid compact JWS header");
    }
    const parsedClaims = options.parseClaims(parseCompactJwsPart(encodedPayload));
    if (!parsedClaims) throw new TypeError("Invalid compact JWS claims");
    claims = parsedClaims;
  } catch {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature payload is invalid" });
  }

  const signingInput = textEncoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64urlDecodeToBytes(encodedSignature);
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is invalid" });
  }
  let verified: boolean;
  try {
    const publicKey = await importEd25519PublicKey(options.publicKeyPem);
    verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
  } catch {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature verification failed" });
  }

  if (!verified) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature verification failed" });
  }

  if (claims.iss !== "veryfront-api") {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane issuer mismatch" });
  }

  if (claims.aud !== options.audience) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane audience mismatch" });
  }

  if (options.expectedProjectId !== undefined && claims.project_id !== options.expectedProjectId) {
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

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= claims.iat) {
    throw SECURITY_VIOLATION.create({
      detail: "Control-plane signature validity window is invalid",
    });
  }
  if (claims.exp <= now) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature expired" });
  }

  if (claims.iat > now + SIGNATURE_SKEW_SECONDS) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature issued in the future" });
  }

  if (now - claims.iat > options.maxAgeSeconds) {
    throw SECURITY_VIOLATION.create({ detail: "Control-plane signature is too old" });
  }

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

function optionalAgentConfigValue(config: object, key: string): unknown {
  const property = readOwnDataProperty(config, key);
  return property.ok && property.present ? property.value : undefined;
}

function snapshotRuntimeAgentSource(agent: RuntimeAgentMetadataSource): RuntimeAgentSourceSnapshot {
  const idProperty = readOwnDataProperty(agent, "id");
  const configProperty = readOwnDataProperty(agent, "config");
  if (
    !idProperty.ok || !idProperty.present || typeof idProperty.value !== "string" ||
    idProperty.value.length === 0 || idProperty.value.length > MAX_IDENTIFIER_LENGTH ||
    !configProperty.ok || !configProperty.present ||
    typeof configProperty.value !== "object" || configProperty.value === null ||
    Array.isArray(configProperty.value)
  ) {
    throw SECURITY_VIOLATION.create({ detail: "Runtime agent metadata source is invalid" });
  }

  const rawSkills = optionalAgentConfigValue(configProperty.value, "skills");
  let skills: true | string[] | undefined;
  if (rawSkills === true) {
    skills = true;
  } else if (rawSkills !== undefined && rawSkills !== false && rawSkills !== null) {
    const skillIds = snapshotDenseArray<string>(rawSkills, MAX_RUNTIME_AGENT_SKILLS);
    if (
      !skillIds.ok ||
      skillIds.value.some((skillId) =>
        typeof skillId !== "string" || skillId.length === 0 ||
        skillId.length > MAX_IDENTIFIER_LENGTH
      )
    ) {
      throw SECURITY_VIOLATION.create({ detail: "Runtime agent skill selection is invalid" });
    }
    skills = skillIds.value;
  }

  const rawSuggestions = optionalAgentConfigValue(configProperty.value, "suggestions");
  const suggestionsSnapshot = rawSuggestions === undefined
    ? undefined
    : snapshotJsonValue(rawSuggestions, { maxNodes: 10_000 });

  return {
    id: idProperty.value,
    config: {
      avatarUrl: optionalAgentConfigValue(configProperty.value, "avatarUrl"),
      avatar_url: optionalAgentConfigValue(configProperty.value, "avatar_url"),
      description: optionalAgentConfigValue(configProperty.value, "description"),
      model: optionalAgentConfigValue(configProperty.value, "model"),
      name: optionalAgentConfigValue(configProperty.value, "name"),
      ...(skills === undefined ? {} : { skills }),
      ...(suggestionsSnapshot?.ok ? { suggestions: suggestionsSnapshot.value } : {}),
      version: optionalAgentConfigValue(configProperty.value, "version"),
    },
  };
}

function resolveAgentSkillsFromSnapshot(agent: RuntimeAgentSourceSnapshot): RuntimeAgentSkill[] {
  if (!agent.config.skills) return [];

  // Owner-aware: the agent's metadata advertises exactly what the agent can
  // resolve at runtime: unowned skills plus its own.
  const skills = Array.from(
    skillRegistry.resolveForAgent(agent.config.skills, { agentId: agent.id }).values(),
  );
  if (skills.length > MAX_RUNTIME_AGENT_SKILLS) {
    throw SECURITY_VIOLATION.create({ detail: "Runtime agent skill limit exceeded" });
  }

  return skills
    .map((skill) =>
      RuntimeAgentSkillSchema.parse({
        id: skill.id,
        name: skill.metadata.name || skill.id,
        ...(skill.metadata.description ? { description: skill.metadata.description } : {}),
      })
    )
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
}

/** Resolve public skill metadata for a runtime agent. */
export function resolveAgentSkills(agent: RuntimeAgentMetadataSource): RuntimeAgentSkill[] {
  return resolveAgentSkillsFromSnapshot(snapshotRuntimeAgentSource(agent));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePublicText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function normalizeAvatarUrl(value: unknown): string | undefined {
  const normalized = normalizePublicText(value, MAX_AVATAR_URL_LENGTH);
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function getRuntimeAgentPublicMetadataFromSnapshot(
  id: string,
  rawConfig: RuntimeAgentConfigSnapshot,
): RuntimeAgentPublicMetadata {
  const suggestionsParseResult = rawConfig.suggestions === undefined
    ? null
    : RuntimeSuggestionsSchema.safeParse(rawConfig.suggestions);
  const suggestions = suggestionsParseResult?.success ? suggestionsParseResult.data : undefined;
  const avatarUrl = normalizeAvatarUrl(rawConfig.avatarUrl) ??
    normalizeAvatarUrl(rawConfig.avatar_url);
  const name = normalizePublicText(rawConfig.name, MAX_DISPLAY_NAME_LENGTH) ?? id;
  const description = normalizePublicText(rawConfig.description, MAX_DESCRIPTION_LENGTH) ?? null;

  return RuntimeAgentSchema.parse({
    id,
    name,
    description,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    ...(suggestions === undefined ? {} : { suggestions }),
  });
}

/** Get browser-safe runtime metadata for an agent. */
export function getRuntimeAgentPublicMetadata(
  id: string,
  agent: RuntimeAgentMetadataSource,
): RuntimeAgentPublicMetadata {
  const source = snapshotRuntimeAgentSource(agent);
  return getRuntimeAgentPublicMetadataFromSnapshot(id, source.config);
}

function getRuntimeAgentMetadata(id: string, agent: RuntimeAgentMetadataSource): RuntimeAgent {
  const source = snapshotRuntimeAgentSource(agent);
  const rawConfig = source.config;
  const publicMetadata = getRuntimeAgentPublicMetadataFromSnapshot(id, rawConfig);

  return RuntimeAgentSchema.parse({
    ...publicMetadata,
    model: normalizePublicText(rawConfig.model, MAX_IDENTIFIER_LENGTH) ?? null,
    version: normalizePublicText(rawConfig.version, MAX_IDENTIFIER_LENGTH) ?? null,
    skills: resolveAgentSkillsFromSnapshot(source),
  });
}

/** List runtime agents. */
export async function listRuntimeAgents<TContext extends ChannelRequestContext>(
  ctx: TContext,
  deps: RuntimeAgentDiscoveryDeps<TContext>,
): Promise<RuntimeAgentListResponse> {
  await deps.ensureProjectDiscovery(ctx);

  const registeredAgentIdsSnapshot = snapshotDenseArray<string>(
    deps.getAllAgentIds(),
    MAX_RUNTIME_AGENTS,
  );
  if (!registeredAgentIdsSnapshot.ok) {
    throw SECURITY_VIOLATION.create({ detail: "Runtime agent limit exceeded" });
  }
  const registeredAgentIds = registeredAgentIdsSnapshot.value;
  for (const id of registeredAgentIds) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_IDENTIFIER_LENGTH) {
      throw SECURITY_VIOLATION.create({ detail: "Runtime agent identifier is invalid" });
    }
  }
  const agentIds = [...new Set(registeredAgentIds)];

  const agents: RuntimeAgent[] = [];
  let responseBytes = textEncoder.encode('{"agents":[]}').byteLength;
  for (const id of agentIds) {
    const agent = deps.getAgent(id);
    if (!agent) continue;

    const metadata = getRuntimeAgentMetadata(id, agent);
    const metadataBytes = serializedJsonBytes(metadata);
    if (
      metadataBytes === undefined ||
      responseBytes + metadataBytes + (agents.length > 0 ? 1 : 0) >
        MAX_RUNTIME_AGENT_RESPONSE_BYTES
    ) {
      throw SECURITY_VIOLATION.create({ detail: "Runtime agent response limit exceeded" });
    }
    responseBytes += metadataBytes + (agents.length > 0 ? 1 : 0);
    agents.push(metadata);
  }
  agents.sort((left, right) =>
    compareText(left.name, right.name) || compareText(left.id, right.id)
  );

  return RuntimeAgentListResponseSchema.parse({ agents });
}

async function verifySignedJwsSignature<TClaims extends SignedRequestClaims>(
  jws: string,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
  parseClaims: (value: unknown) => TClaims | undefined,
): Promise<boolean> {
  try {
    if (
      !Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1 ||
      options.maxAgeSeconds > MAX_SIGNATURE_AGE_SECONDS
    ) {
      return false;
    }
    if (jws.length > MAX_COMPACT_JWS_LENGTH) return false;
    const parts = jws.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

    if (!isCompactJwsHeader(parseCompactJwsPart(encodedHeader))) return false;
    const claims = parseClaims(parseCompactJwsPart(encodedPayload));
    if (!claims) return false;

    const signingInput = textEncoder.encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64urlDecodeToBytes(encodedSignature);
    if (signature.byteLength !== ED25519_SIGNATURE_BYTES) return false;
    const publicKey = await importEd25519PublicKey(options.publicKeyPem);
    const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
    if (!verified) return false;

    if (claims.iss !== "veryfront-api") return false;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= claims.iat) return false;
    if (claims.exp <= now) return false;
    if (claims.iat > now + SIGNATURE_SKEW_SECONDS) return false;
    if (now - claims.iat > options.maxAgeSeconds) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a dispatch JWS signature and freshness without binding it to a body,
 * audience, or project. Payload consumers must still call
 * {@link verifyDispatchJws} before trusting dispatch data.
 */
export function verifyDispatchJwsSignature(
  jws: string,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  return verifySignedJwsSignature(jws, options, parseDispatchClaims);
}

/**
 * Verify a control-plane JWS signature and freshness without binding it to a
 * body, audience, project, or surface. Payload consumers must still call
 * {@link verifyControlPlaneJws} before trusting control-plane data.
 */
export function verifyControlPlaneJwsSignature(
  jws: string,
  options: {
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  return verifySignedJwsSignature(jws, options, parseControlPlaneClaims);
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
