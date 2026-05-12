import type { Agent } from "#veryfront/agent";
import type { HandlerContext } from "#veryfront/types";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";

const SIGNATURE_SKEW_SECONDS = 5;

export const CONTROL_PLANE_AGENTS_LIST_PATH = "/api/control-plane/agents/list";
export const CONTROL_PLANE_AGENT_STREAM_PATH = "/api/control-plane/agents/stream";
export const CONTROL_PLANE_AGENT_RUNS_PATH_PREFIX = "/api/control-plane/agents/runs/";

const getCompactJwsHeaderSchema = defineSchema((v) =>
  v.object({
    alg: v.literal("EdDSA"),
    typ: v.string().optional(),
    kid: v.string().optional(),
  })
);
const compactJwsHeaderSchema = getCompactJwsHeaderSchema();

export const getControlPlaneSurfaceSchema = defineSchema((v) =>
  v.enum(["studio", "channels", "a2a", "mcp"])
);
export const ControlPlaneSurfaceSchema = getControlPlaneSurfaceSchema();

export const getControlPlaneAgentsListRequestSchema = defineSchema((v) =>
  v.object({
    requestId: v.string().min(1),
    projectId: v.string().min(1),
    surface: getControlPlaneSurfaceSchema(),
  })
);
export const ControlPlaneAgentsListRequestSchema = getControlPlaneAgentsListRequestSchema();

export const getRuntimeAgentSkillSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string().optional(),
    tags: v.array(v.string()).optional(),
    examples: v.array(v.string()).optional(),
  })
);
export const RuntimeAgentSkillSchema = getRuntimeAgentSkillSchema();

export const getRuntimeAgentSuggestionSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      id: v.string().min(1),
      type: v.literal("prompt"),
      title: v.string().min(1),
      description: v.string().optional(),
      prompt: v.string().min(1),
    }),
    v.object({
      id: v.string().min(1),
      type: v.literal("task"),
      title: v.string().min(1),
      description: v.string().optional(),
      task: v.string().min(1),
      prompt: v.string().min(1).optional(),
    }),
  ])
);
export const RuntimeAgentSuggestionSchema = getRuntimeAgentSuggestionSchema();

export const getRuntimeAgentSuggestionsSchema = defineSchema((v) =>
  v.object({
    welcomeMessage: v.string().min(1).optional(),
    suggestions: v.array(getRuntimeAgentSuggestionSchema()),
  })
);
export const RuntimeAgentSuggestionsSchema = getRuntimeAgentSuggestionsSchema();

export const getRuntimeAgentSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    name: v.string().min(1),
    description: v.string().nullable().optional(),
    model: v.string().nullable().optional(),
    version: v.string().nullable().optional(),
    skills: v.array(getRuntimeAgentSkillSchema()).optional(),
    suggestions: getRuntimeAgentSuggestionsSchema().optional(),
  })
);
export const RuntimeAgentSchema = getRuntimeAgentSchema();

export const getRuntimeAgentListResponseSchema = defineSchema((v) =>
  v.object({
    agents: v.array(getRuntimeAgentSchema()),
  })
);
export const RuntimeAgentListResponseSchema = getRuntimeAgentListResponseSchema();

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
const dispatchClaimsSchema = getDispatchClaimsSchema();

const getControlPlaneClaimsSchema = defineSchema((v) =>
  v.object({
    iss: v.string(),
    aud: v.string(),
    sub: v.string(),
    surface: getControlPlaneSurfaceSchema(),
    project_id: v.string(),
    request_hash: v.string(),
    iat: v.number().int(),
    exp: v.number().int(),
  })
);
const controlPlaneClaimsSchema = getControlPlaneClaimsSchema();

export type ControlPlaneSurface = InferSchema<ReturnType<typeof getControlPlaneSurfaceSchema>>;
export type ControlPlaneAgentsListRequest = InferSchema<
  ReturnType<typeof getControlPlaneAgentsListRequestSchema>
>;
export type RuntimeAgentSkill = InferSchema<ReturnType<typeof getRuntimeAgentSkillSchema>>;
export type RuntimeAgentSuggestion = InferSchema<
  ReturnType<typeof getRuntimeAgentSuggestionSchema>
>;
export type RuntimeAgentSuggestions = InferSchema<
  ReturnType<typeof getRuntimeAgentSuggestionsSchema>
>;
export type RuntimeAgent = InferSchema<ReturnType<typeof getRuntimeAgentSchema>>;
export type RuntimeAgentListResponse = InferSchema<
  ReturnType<typeof getRuntimeAgentListResponseSchema>
>;
export type DispatchClaims = InferSchema<ReturnType<typeof getDispatchClaimsSchema>>;
export type ControlPlaneClaims = InferSchema<ReturnType<typeof getControlPlaneClaimsSchema>>;

export interface RuntimeAgentDiscoveryDeps {
  ensureProjectDiscovery: (ctx: HandlerContext) => Promise<void>;
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

function pemToDer(pem: string, label: string): ArrayBuffer {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s/g, "");

  return toArrayBuffer(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)));
}

async function importEd25519PublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToDer(pem, "PUBLIC KEY"),
    "Ed25519",
    false,
    ["verify"],
  );
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
    scopedClaim?: {
      key: keyof TClaims & string;
      label: string;
      value: string;
    };
  },
): Promise<TClaims> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("Control-plane signature must be a compact JWS");
  }

  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Control-plane signature must include header, payload, and signature");
  }

  compactJwsHeaderSchema.parse(parseCompactJwsPart(encodedHeader));
  const claims = options.claimsSchema.parse(parseCompactJwsPart(encodedPayload));

  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64urlDecodeToBytes(encodedSignature);
  const publicKey = await importEd25519PublicKey(options.publicKeyPem);
  const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);

  if (!verified) {
    throw new Error("Control-plane signature verification failed");
  }

  if (claims.iss !== "veryfront-api") {
    throw new Error("Control-plane issuer mismatch");
  }

  if (claims.aud !== options.audience) {
    throw new Error("Control-plane audience mismatch");
  }

  if (options.expectedProjectId && claims.project_id !== options.expectedProjectId) {
    throw new Error("Control-plane project mismatch");
  }

  if (options.expectedSubject && claims.sub !== options.expectedSubject) {
    throw new Error("Control-plane subject mismatch");
  }

  if (options.scopedClaim && claims[options.scopedClaim.key] !== options.scopedClaim.value) {
    throw new Error(`Control-plane ${options.scopedClaim.label} mismatch`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new Error("Control-plane signature expired");
  }

  if (claims.iat > now + SIGNATURE_SKEW_SECONDS) {
    throw new Error("Control-plane signature issued in the future");
  }

  if (now - claims.iat > options.maxAgeSeconds) {
    throw new Error("Control-plane signature is too old");
  }

  const requestHash = claims[options.hashClaimKey];
  if (typeof requestHash !== "string") {
    throw new Error("Control-plane request hash is missing");
  }

  const bodyHash = await sha256Base64url(body);
  if (requestHash !== bodyHash) {
    throw new Error("Control-plane body hash mismatch");
  }

  return claims;
}

function resolveAgentSkills(agent: Agent): RuntimeAgentSkill[] {
  if (!agent.config.skills) {
    return [];
  }

  return Array.from(skillRegistry.resolveForAgent(agent.config.skills).values())
    .map((skill) =>
      RuntimeAgentSkillSchema.parse({
        id: skill.id,
        name: skill.metadata.name || skill.id,
        ...(skill.metadata.description ? { description: skill.metadata.description } : {}),
      })
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getRuntimeAgentMetadata(id: string, agent: Agent): RuntimeAgent {
  const rawConfig = agent.config as unknown as Record<string, unknown>;
  const suggestionsParseResult = rawConfig.suggestions === undefined
    ? null
    : RuntimeAgentSuggestionsSchema.safeParse(rawConfig.suggestions);
  const suggestions = suggestionsParseResult?.success ? suggestionsParseResult.data : undefined;

  return RuntimeAgentSchema.parse({
    id,
    name: typeof rawConfig.name === "string" && rawConfig.name.trim().length > 0
      ? rawConfig.name
      : id,
    description: typeof rawConfig.description === "string" ? rawConfig.description : null,
    model: agent.config.model ?? null,
    version: typeof rawConfig.version === "string" ? rawConfig.version : null,
    skills: resolveAgentSkills(agent),
    ...(suggestions === undefined ? {} : { suggestions }),
  });
}

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
    publicKeyPem: string;
    maxAgeSeconds: number;
  },
): Promise<boolean> {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) return false;

    compactJwsHeaderSchema.parse(parseCompactJwsPart(encodedHeader));
    const claims = dispatchClaimsSchema.parse(parseCompactJwsPart(encodedPayload));

    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const signature = base64urlDecodeToBytes(encodedSignature);
    const publicKey = await importEd25519PublicKey(options.publicKeyPem);
    const verified = await crypto.subtle.verify("Ed25519", publicKey, signature, signingInput);
    if (!verified) return false;

    if (claims.iss !== "veryfront-api") return false;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) return false;
    if (claims.iat > now + SIGNATURE_SKEW_SECONDS) return false;
    if (now - claims.iat > options.maxAgeSeconds) return false;

    return true;
  } catch {
    return false;
  }
}

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
    claimsSchema: controlPlaneClaimsSchema,
    expectedProjectId: options.expectedProjectId,
    ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}),
    hashClaimKey: "request_hash",
    maxAgeSeconds: options.maxAgeSeconds,
    publicKeyPem: options.publicKeyPem,
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
