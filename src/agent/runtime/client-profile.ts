import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Zod schema for get runtime client type. */
export const getRuntimeClientTypeSchema = defineSchema((v) =>
  v.enum(["web", "cli", "api", "internal"])
);

/** Zod schema for get runtime client capability. */
export const getRuntimeClientCapabilitySchema = defineSchema((v) =>
  v.enum([
    "ui_panels",
    "form_input",
    "media_display",
    "project_switching",
  ])
);

/** Zod schema for get runtime client profile. */
export const getRuntimeClientProfileSchema = defineSchema((v) =>
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
export const runtimeClientTypeSchema = lazySchema(getRuntimeClientTypeSchema);
/** Schema for runtime client capability.
 * @deprecated Use getRuntimeClientCapabilitySchema()
 */
export const runtimeClientCapabilitySchema = lazySchema(getRuntimeClientCapabilitySchema);
/** Schema for runtime client profile.
 * @deprecated Use getRuntimeClientProfileSchema()
 */
export const runtimeClientProfileSchema = lazySchema(getRuntimeClientProfileSchema);

/** Public API contract for runtime client type. */
export type RuntimeClientType = InferSchema<ReturnType<typeof getRuntimeClientTypeSchema>>;
/** Public API contract for runtime client capability. */
export type RuntimeClientCapability = InferSchema<
  ReturnType<typeof getRuntimeClientCapabilitySchema>
>;
/** Public API contract for runtime client profile. */
export type RuntimeClientProfile = InferSchema<ReturnType<typeof getRuntimeClientProfileSchema>>;

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
    capabilities: ["ui_panels", "form_input", "media_display", "project_switching"],
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
