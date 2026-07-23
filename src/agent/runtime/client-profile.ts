import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";

/** Runtime client category used to select trusted capability defaults. */
export type RuntimeClientType = "web" | "cli" | "api" | "internal";

/** Capability advertised by a runtime client. */
export type RuntimeClientCapability =
  | "ui_panels"
  | "form_input"
  | "media_display"
  | "project_switching"
  | "project.evals.read"
  | "project.evals.write"
  | "project.evals.run";

/** Validated identity and capability profile for a runtime client. */
export interface RuntimeClientProfile {
  /** Stable client identifier. */
  id: string;
  /** Client category. */
  type: RuntimeClientType;
  /** Whether Veryfront recognizes the client as trusted. */
  trusted: boolean;
  /** Capabilities available to the client. */
  capabilities: RuntimeClientCapability[];
}

/** Returns the schema for runtime client categories. */
export const getRuntimeClientTypeSchema: () => Schema<RuntimeClientType> = defineSchema((v) =>
  v.enum(["web", "cli", "api", "internal"] as const)
);

/** Returns the schema for runtime client capabilities. */
export const getRuntimeClientCapabilitySchema: () => Schema<RuntimeClientCapability> = defineSchema(
  (v) =>
    v.enum(
      [
        "ui_panels",
        "form_input",
        "media_display",
        "project_switching",
        "project.evals.read",
        "project.evals.write",
        "project.evals.run",
      ] as const,
    ),
);

/** Returns the schema for runtime client profiles. */
export const getRuntimeClientProfileSchema: () => Schema<RuntimeClientProfile> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(128),
    type: getRuntimeClientTypeSchema(),
    trusted: v.boolean(),
    capabilities: v.array(getRuntimeClientCapabilitySchema()),
  })
);

/** Schema for runtime client type.
 * @deprecated Use getRuntimeClientTypeSchema()
 */
export const runtimeClientTypeSchema: Schema<RuntimeClientType> = lazySchema(
  getRuntimeClientTypeSchema,
);
/** Schema for runtime client capability.
 * @deprecated Use getRuntimeClientCapabilitySchema()
 */
export const runtimeClientCapabilitySchema: Schema<RuntimeClientCapability> = lazySchema(
  getRuntimeClientCapabilitySchema,
);
/** Schema for runtime client profile.
 * @deprecated Use getRuntimeClientProfileSchema()
 */
export const runtimeClientProfileSchema: Schema<RuntimeClientProfile> = lazySchema(
  getRuntimeClientProfileSchema,
);

const getClientMetadataSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(128),
    type: getRuntimeClientTypeSchema().optional(),
    platform: v.string().min(1).max(128).optional(),
    version: v.string().min(1).max(64).optional(),
  }).strict()
);

const getClientEnvelopeSchema = defineSchema((v) =>
  v.object({
    veryfront: v
      .object({
        client: getClientMetadataSchema().optional(),
      })
      .passthrough()
      .optional(),
  }).passthrough()
);

type FirstPartyClientProfile = {
  type: RuntimeClientType;
  capabilities: RuntimeClientCapability[];
};

const FIRST_PARTY_CLIENTS: Readonly<Record<string, FirstPartyClientProfile>> = {
  "veryfront-studio": {
    type: "web",
    capabilities: [
      "ui_panels",
      "form_input",
      "media_display",
      "project_switching",
      "project.evals.read",
      "project.evals.write",
      "project.evals.run",
    ],
  },
  "veryfront-cli": {
    type: "cli",
    capabilities: [],
  },
  "veryfront-api": {
    type: "api",
    capabilities: [],
  },
};

/** Resolves runtime client profile. */
export function resolveRuntimeClientProfile(
  forwardedProps: Record<string, unknown> | undefined,
): RuntimeClientProfile | null {
  const parsed = getClientEnvelopeSchema().safeParse(forwardedProps);
  if (!parsed.success) {
    return null;
  }

  const metadata = parsed.data.veryfront?.client;
  const clientId = metadata?.id.trim();
  if (!clientId) {
    return null;
  }

  const knownClient = FIRST_PARTY_CLIENTS[clientId];
  if (knownClient) {
    return getRuntimeClientProfileSchema().parse({
      id: clientId,
      type: metadata?.type ?? knownClient.type,
      trusted: true,
      capabilities: knownClient.capabilities,
    });
  }

  return getRuntimeClientProfileSchema().parse({
    id: clientId,
    type: metadata?.type ?? "api",
    trusted: false,
    capabilities: [],
  });
}

/** Client allows studio MCP helper. */
export function clientAllowsStudioMcp(
  clientProfile: RuntimeClientProfile | null | undefined,
): boolean {
  if (!clientProfile?.trusted) {
    return false;
  }

  return (
    clientProfile.capabilities.includes("ui_panels") ||
    clientProfile.capabilities.includes("form_input") ||
    clientProfile.capabilities.includes("media_display")
  );
}
