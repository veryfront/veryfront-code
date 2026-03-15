import type { Agent } from "#veryfront/agent";
import type { HandlerContext } from "#veryfront/types";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { z } from "zod";

const SIGNATURE_SKEW_SECONDS = 5;

const compactJwsHeaderSchema = z.object({
  alg: z.literal("EdDSA"),
  typ: z.string().optional(),
  kid: z.string().optional(),
});

export const ControlPlaneSurfaceSchema = z.enum(["studio", "channels", "a2a", "mcp"]);

export const ControlPlaneAgentsListRequestSchema = z.object({
  requestId: z.string().min(1),
  projectId: z.string().min(1),
  surface: ControlPlaneSurfaceSchema,
});

export const RuntimeAgentSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});

export const RuntimeAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  skills: z.array(RuntimeAgentSkillSchema).optional(),
});

export const RuntimeAgentListResponseSchema = z.object({
  agents: z.array(RuntimeAgentSchema),
});

const dispatchClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string(),
  project_id: z.string(),
  platform: z.string(),
  body_sha256: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});

const controlPlaneClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string(),
  surface: ControlPlaneSurfaceSchema,
  project_id: z.string(),
  request_hash: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type ControlPlaneSurface = z.infer<typeof ControlPlaneSurfaceSchema>;
export type ControlPlaneAgentsListRequest = z.infer<typeof ControlPlaneAgentsListRequestSchema>;
export type RuntimeAgentSkill = z.infer<typeof RuntimeAgentSkillSchema>;
export type RuntimeAgent = z.infer<typeof RuntimeAgentSchema>;
export type RuntimeAgentListResponse = z.infer<typeof RuntimeAgentListResponseSchema>;
export type DispatchClaims = z.infer<typeof dispatchClaimsSchema>;
export type ControlPlaneClaims = z.infer<typeof controlPlaneClaimsSchema>;

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
    claimsSchema: z.ZodType<TClaims>;
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

  const header = compactJwsHeaderSchema.parse(
    JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encodedHeader))),
  );
  const claims = options.claimsSchema.parse(
    JSON.parse(new TextDecoder().decode(base64urlDecodeToBytes(encodedPayload))),
  );

  if (header.alg !== "EdDSA") {
    throw new Error("Unsupported control-plane JWS algorithm");
  }

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

function getRuntimeAgentMetadata(agent: Agent): RuntimeAgent {
  const rawConfig = agent.config as unknown as Record<string, unknown>;

  return RuntimeAgentSchema.parse({
    id: agent.id,
    name: typeof rawConfig.name === "string" && rawConfig.name.trim().length > 0
      ? rawConfig.name
      : agent.id,
    description: typeof rawConfig.description === "string" ? rawConfig.description : null,
    model: agent.config.model ?? null,
    version: typeof rawConfig.version === "string" ? rawConfig.version : null,
    skills: resolveAgentSkills(agent),
  });
}

export async function listRuntimeAgents(
  ctx: HandlerContext,
  deps: RuntimeAgentDiscoveryDeps,
): Promise<RuntimeAgentListResponse> {
  await deps.ensureProjectDiscovery(ctx);

  const agents = deps.getAllAgentIds()
    .map((id) => deps.getAgent(id))
    .filter((agent): agent is Agent => Boolean(agent))
    .map(getRuntimeAgentMetadata)
    .sort((left, right) => left.name.localeCompare(right.name));

  return RuntimeAgentListResponseSchema.parse({ agents });
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
