import { z } from "zod";

export const runtimeClientTypeSchema = z.enum(["web", "cli", "api", "internal"]);
export const runtimeClientCapabilitySchema = z.enum([
  "ui_panels",
  "form_input",
  "media_display",
  "project_switching",
]);

export const runtimeClientProfileSchema = z.object({
  id: z.string().min(1).max(128),
  type: runtimeClientTypeSchema,
  trusted: z.boolean(),
  capabilities: z.array(runtimeClientCapabilitySchema),
});

export type RuntimeClientType = z.infer<typeof runtimeClientTypeSchema>;
export type RuntimeClientCapability = z.infer<typeof runtimeClientCapabilitySchema>;
export type RuntimeClientProfile = z.infer<typeof runtimeClientProfileSchema>;

const clientMetadataSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: runtimeClientTypeSchema.optional(),
    platform: z.string().min(1).max(128).optional(),
    version: z.string().min(1).max(64).optional(),
  })
  .strict();

const clientEnvelopeSchema = z
  .object({
    veryfront: z
      .object({
        client: clientMetadataSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

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

export function resolveRuntimeClientProfile(
  forwardedProps: Record<string, unknown> | undefined,
): RuntimeClientProfile | null {
  const parsed = clientEnvelopeSchema.safeParse(forwardedProps);
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
    return runtimeClientProfileSchema.parse({
      id: clientId,
      type: metadata?.type ?? knownClient.type,
      trusted: true,
      capabilities: knownClient.capabilities,
    });
  }

  return runtimeClientProfileSchema.parse({
    id: clientId,
    type: metadata?.type ?? "api",
    trusted: false,
    capabilities: [],
  });
}

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
