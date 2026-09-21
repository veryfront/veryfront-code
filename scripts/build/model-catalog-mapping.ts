/**
 * Pure mapping from the served model catalog to the catalog data module.
 *
 * Nothing here touches the network or the filesystem, so the whole mapping is
 * exercised by unit tests over hand-built payloads. The network fetch and the
 * file write live in `generate-model-catalog.ts`.
 *
 * The mapping is an ALLOWLIST: {@link buildModelCatalogData} reads named keys
 * and nothing else, so a field the platform adds cannot reach this package by
 * default. A field belongs in the allowlist only when the package acts on it.
 *
 * Where the payload carries two spellings of one fact, only the served de
 * facto name is read (`reasoning`, `reasoning_mode`, `transport`). Reading
 * both, or falling back from one to the other, would let two sources for the
 * same fact disagree, so each fact has exactly one source here.
 *
 * @module scripts/build/model-catalog-mapping
 */

import type {
  ModelCatalogOverlay,
  OverlayProviderRouting,
  OverlayTransportCapabilities,
} from "./model-catalog-overlay.ts";

/** One chat model entry of the generated module. */
export type ChatModelEntry = {
  readonly id: string;
  readonly modelId: string;
  readonly provider: string;
  readonly name: string;
  readonly description: string;
  readonly thinking?: boolean;
  readonly thinkingBudgetTokens?: number;
};

/** Model-specific transport capabilities of the generated module. */
export type TransportCapabilities = OverlayTransportCapabilities;

/** Everything the generated module declares, in the order it declares it. */
export type ModelCatalogData = {
  readonly defaultModelId: string;
  readonly providerAliases: readonly (readonly [string, string])[];
  readonly providerRouting:
    readonly (readonly [string, OverlayProviderRouting])[];
  readonly defaultSurface: string;
  readonly gatewayPathPrefix: string;
  readonly surfaceGatewayApiVersions: readonly (readonly [string, string])[];
  readonly defaultGatewayApiVersion: string;
  readonly modelTransportCapabilities:
    readonly (readonly [string, TransportCapabilities])[];
  readonly chatModels: readonly ChatModelEntry[];
  readonly providerLabels: readonly (readonly [string, string])[];
  readonly providerOrder: readonly string[];
};

/** Reasoning controls this package builds requests for. Any other value is dropped. */
const KNOWN_REASONING_MODES: ReadonlySet<string> = new Set(["adaptive"]);

/** OpenAI transports this package builds requests for. Any other value is dropped. */
const KNOWN_OPENAI_TRANSPORTS: ReadonlySet<string> = new Set([
  "chat-completions",
  "responses",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function readArray(
  source: Record<string, unknown>,
  key: string,
): readonly unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function fail(detail: string): never {
  throw new Error(`Served model catalog is unusable: ${detail}`);
}

/**
 * Build the catalog data from a served catalog payload and the overlay.
 *
 * Every field of the result comes from a key named here or from the overlay.
 * The payload is read as `unknown`, so an unknown field, an unknown vendor and
 * an unknown capability key are all dropped rather than carried.
 *
 * Throws when the payload cannot describe a usable catalog: an empty model or
 * provider list, a default model that no entry claims, or a provider with no
 * model to take its display label from. A scheduled run that throws fails
 * loudly, which is the intended alert.
 */
export function buildModelCatalogData(
  payload: unknown,
  overlay: ModelCatalogOverlay,
): ModelCatalogData {
  const root = asRecord(payload) ?? fail("the payload is not a JSON object");

  const servedModels = readArray(root, "models").map(asRecord).filter((
    model,
  ): model is Record<string, unknown> => model !== undefined);
  if (servedModels.length === 0) fail("it lists no model");

  const providerOrder: string[] = [];
  for (const provider of readArray(root, "providers")) {
    if (typeof provider !== "string" || provider.length === 0) continue;
    if (!providerOrder.includes(provider)) providerOrder.push(provider);
  }
  if (providerOrder.length === 0) fail("it lists no provider");

  const entryIds = new Map(overlay.entryIds);
  const thinkingBudgets = new Map(overlay.thinkingBudgetTokens);
  const chatReasoningWithFunctionTools = new Map(
    overlay.openAIChatReasoningWithFunctionTools,
  );

  const chatModels: ChatModelEntry[] = [];
  const servedTransportCapabilities:
    (readonly [string, TransportCapabilities])[] = [];
  const labelByProvider = new Map<string, string>();
  const aliasPrefixes = new Map<string, Set<string>>();

  for (const served of servedModels) {
    const servedId = readString(served, "id");
    const modelId = readString(served, "modelId");
    const provider = readString(served, "provider");
    const name = readString(served, "name");
    if (!servedId || !modelId || !provider || !name) continue;

    const capabilities = asRecord(served.capabilities) ?? {};
    // `reasoning` is the served name for this fact and the only one read: the
    // payload also carries the older `thinking` spelling, but two sources for
    // one fact can disagree, so only `reasoning` is allowed in. It is also the
    // authority on WHETHER a model reasons. The overlay says how much, so a
    // budget for a model the catalog serves as non-reasoning is dropped rather
    // than left to assert reasoning the catalog no longer claims.
    const reasons = readBoolean(capabilities, "reasoning") === true;
    const thinkingBudgetTokens = reasons
      ? thinkingBudgets.get(modelId)
      : undefined;
    chatModels.push({
      id: entryIds.get(modelId) ?? servedId,
      modelId,
      provider,
      name,
      description: readString(served, "description") ?? "",
      // A declared budget already means the model reasons, so the flag is
      // emitted only where no budget carries that fact.
      ...(reasons && thinkingBudgetTokens === undefined
        ? { thinking: true }
        : {}),
      ...(thinkingBudgetTokens === undefined ? {} : { thinkingBudgetTokens }),
    });

    // A reasoning control on a model the catalog serves as non-reasoning is
    // the catalog contradicting itself. `reasoning` settles it, so the control
    // is dropped rather than written out beside the flag that denies it.
    const reasoningMode = reasons
      ? readString(capabilities, "reasoning_mode")
      : undefined;
    const transport = readString(capabilities, "transport");
    const functionToolReasoning = chatReasoningWithFunctionTools.get(modelId);
    const capabilityEntry: TransportCapabilities = {
      ...(reasoningMode !== undefined &&
          KNOWN_REASONING_MODES.has(reasoningMode)
        ? { anthropicThinkingMode: reasoningMode as "adaptive" }
        : {}),
      ...(transport !== undefined && KNOWN_OPENAI_TRANSPORTS.has(transport)
        ? { openAITransport: transport as "chat-completions" | "responses" }
        : {}),
      ...(functionToolReasoning === undefined
        ? {}
        : { openAIChatReasoningWithFunctionTools: functionToolReasoning }),
    };
    if (Object.keys(capabilityEntry).length > 0) {
      servedTransportCapabilities.push([modelId, capabilityEntry]);
    }

    const label = readString(served, "providerLabel");
    if (label !== undefined && !labelByProvider.has(provider)) {
      labelByProvider.set(provider, label);
    }

    // A model ID whose provider segment differs from the canonical provider
    // names an accepted provider alias.
    const slashIndex = modelId.indexOf("/");
    const prefix = slashIndex > 0 ? modelId.slice(0, slashIndex) : provider;
    if (prefix !== provider) {
      const prefixes = aliasPrefixes.get(provider) ?? new Set<string>();
      prefixes.add(prefix);
      aliasPrefixes.set(provider, prefixes);
    }
  }
  if (chatModels.length === 0) {
    fail("no served model carries the fields an entry needs");
  }

  const providerAliases: (readonly [string, string])[] = [];
  const providerLabels: (readonly [string, string])[] = [];
  for (const provider of providerOrder) {
    const label = labelByProvider.get(provider) ??
      fail(`provider "${provider}" has no model to take a display label from`);
    providerLabels.push([provider, label]);
    providerAliases.push([provider, provider]);
    for (const prefix of [...aliasPrefixes.get(provider) ?? []].sort()) {
      providerAliases.push([prefix, provider]);
    }
  }

  const routingByProvider = new Map(overlay.providerRouting);
  const providerRouting = providerOrder.map((provider) =>
    // A provider the overlay does not route falls back to the surface the
    // package already uses for an unlisted provider, so routing stays
    // declared for every provider the catalog names.
    [
      provider,
      routingByProvider.get(provider) ?? { surface: overlay.defaultSurface },
    ] as const
  );

  // Retained entries come first and in overlay order, so the table stays
  // stable as models enter and leave the served catalog. A model is served
  // whenever the catalog lists it, whether or not it carries a transport fact:
  // a served model that declares none has none, and a retained entry must not
  // outlive it as a stale override.
  const servedModelIds = new Set(chatModels.map((model) => model.modelId));
  const modelTransportCapabilities = [
    ...overlay.retainedTransportCapabilities.filter(([modelId]) =>
      !servedModelIds.has(modelId)
    ),
    ...servedTransportCapabilities,
  ];

  const servedDefaultModelId = readString(root, "defaultModelId") ??
    fail("it names no default model");
  const defaultEntry =
    chatModels.find((model) => model.modelId === servedDefaultModelId) ??
      fail(
        `the default model "${servedDefaultModelId}" is not one of the served models`,
      );

  return {
    defaultModelId: defaultEntry.id,
    providerAliases,
    providerRouting,
    defaultSurface: overlay.defaultSurface,
    gatewayPathPrefix: overlay.gatewayPathPrefix,
    surfaceGatewayApiVersions: overlay.surfaceGatewayApiVersions,
    defaultGatewayApiVersion: overlay.defaultGatewayApiVersion,
    modelTransportCapabilities,
    chatModels,
    providerLabels,
    providerOrder,
  };
}

/** Providers the catalog names that the overlay declares no routing for. */
export function findUnroutedProviders(
  data: ModelCatalogData,
  overlay: ModelCatalogOverlay,
): readonly string[] {
  const routed = new Set(overlay.providerRouting.map(([provider]) => provider));
  return data.providerOrder.filter((provider) => !routed.has(provider));
}

function quote(value: string): string {
  return JSON.stringify(value);
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function objectKey(value: string): string {
  return IDENTIFIER_PATTERN.test(value) ? value : quote(value);
}

function frozenTuple(key: string, value: string): string {
  return `Object.freeze([${quote(key)}, ${value}] as const),`;
}

function renderTransportCapabilities(
  capabilities: TransportCapabilities,
): string {
  const fields: string[] = [];
  if (capabilities.anthropicThinkingMode !== undefined) {
    fields.push(
      `anthropicThinkingMode: ${
        quote(capabilities.anthropicThinkingMode)
      } as const`,
    );
  }
  if (capabilities.openAITransport !== undefined) {
    fields.push(
      `openAITransport: ${quote(capabilities.openAITransport)} as const`,
    );
  }
  if (capabilities.openAIChatReasoningWithFunctionTools !== undefined) {
    fields.push(
      `openAIChatReasoningWithFunctionTools: ${capabilities.openAIChatReasoningWithFunctionTools}`,
    );
  }
  return `Object.freeze({ ${fields.join(", ")} })`;
}

function renderChatModel(model: ChatModelEntry): string {
  const fields = [
    `id: ${quote(model.id)}`,
    `modelId: ${quote(model.modelId)}`,
    `provider: ${quote(model.provider)}`,
    `name: ${quote(model.name)}`,
    `description: ${quote(model.description)}`,
  ];
  if (model.thinking !== undefined) fields.push(`thinking: ${model.thinking}`);
  if (model.thinkingBudgetTokens !== undefined) {
    fields.push(`thinkingBudgetTokens: ${model.thinkingBudgetTokens}`);
  }
  return `Object.freeze({ ${fields.join(", ")} }),`;
}

function renderRouting(routing: OverlayProviderRouting): string {
  const fields = [`surface: ${quote(routing.surface)} as const`];
  if (routing.native !== undefined) fields.push(`native: ${routing.native}`);
  return `Object.freeze({ ${fields.join(", ")} })`;
}

/**
 * Render the catalog data as the source of the generated module.
 *
 * Deterministic over its input: every list keeps the order
 * {@link buildModelCatalogData} produced, no value is read from the clock or
 * the environment, and no run identifier is emitted. The generator runs the
 * repository formatter over the result, so formatting is stable too.
 */
export function renderModelCatalogModule(data: ModelCatalogData): string {
  const lines = [
    "/**",
    " * Veryfront Cloud model catalog data.",
    " *",
    " * Generated file. Do not edit by hand: run `deno task generate:model-catalog`,",
    " * or let the scheduled catalog sync open the pull request that updates it.",
    " * Facts the served catalog does not carry live in",
    " * `scripts/build/model-catalog-overlay.ts`.",
    " *",
    " * Data only: this module holds the catalog tables and contains no logic. Every",
    " * export is a plain frozen value, and the only imports are types. Resolution",
    " * logic lives in `model-catalog.ts`, which is the module to import from.",
    " */",
    "import type {",
    "  KnownVeryfrontCloudProviderId,",
    "  VeryfrontCloudChatModel,",
    "  VeryfrontCloudProviderId,",
    "  VeryfrontCloudWireSurface,",
    '} from "./model-catalog.ts";',
    "",
    "/**",
    " * Gateway routing for one provider.",
    " *",
    " * The surface is the wire format the provider's gateway endpoint speaks. It is",
    " * the only fact routing needs, so a provider this package does not list is",
    " * reachable as soon as its surface is known.",
    " */",
    "export type VeryfrontCloudProviderRouting = {",
    "  /** Wire format spoken by the provider's gateway endpoint. */",
    "  readonly surface: VeryfrontCloudWireSurface;",
    "  /**",
    "   * Whether the provider implements the surface natively rather than only",
    "   * speaking its wire format. On the OpenAI surface, native providers can use",
    "   * the Responses transport; the others keep to Chat Completions.",
    "   */",
    "  readonly native?: boolean;",
    "};",
    "",
    "/** Model-specific transport capabilities that cannot be inferred from the provider family. */",
    "export type VeryfrontCloudModelTransportCapabilities = {",
    '  readonly anthropicThinkingMode?: "adaptive";',
    '  readonly openAITransport?: "chat-completions" | "responses";',
    "  readonly openAIChatReasoningWithFunctionTools?: boolean;",
    "};",
    "",
    "/**",
    " * Default Veryfront Cloud model ID used when no model is configured.",
    " * Update this when the current default is deprecated. Otherwise the default",
    " * path silently breaks for users who have not set an explicit model.",
    " */",
    `export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = ${
      quote(data.defaultModelId)
    };`,
    "",
    "/**",
    " * Accepted provider aliases mapped to their canonical provider ID.",
    " * Frozen entries in alias order; build a Map locally if lookup-by-key is needed.",
    " */",
    "export const VERYFRONT_CLOUD_PROVIDER_ALIASES: ReadonlyArray<",
    "  readonly [string, KnownVeryfrontCloudProviderId]",
    "> = Object.freeze([",
    ...data.providerAliases.map(([alias, provider]) =>
      frozenTuple(alias, quote(provider))
    ),
    "]);",
    "",
    "/**",
    " * Gateway routing per provider. A provider missing from this table is routed",
    " * on the default surface, so the package reaches a provider it does not list",
    " * without a code change.",
    " * Frozen entries; build a Map locally if lookup-by-key is needed.",
    " */",
    "export const VERYFRONT_CLOUD_PROVIDER_ROUTING: ReadonlyArray<",
    "  readonly [VeryfrontCloudProviderId, Readonly<VeryfrontCloudProviderRouting>]",
    "> = Object.freeze([",
    ...data.providerRouting.map(([provider, routing]) =>
      frozenTuple(provider, renderRouting(routing))
    ),
    "]);",
    "",
    "/** Surface used for a provider the routing table does not list. */",
    `export const DEFAULT_VERYFRONT_CLOUD_SURFACE = ${
      quote(data.defaultSurface)
    };`,
    "",
    "/** Leading gateway path segments, shared by every surface. */",
    `export const VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX = ${
      quote(data.gatewayPathPrefix)
    };`,
    "",
    "/**",
    " * Gateway API version per surface, appended after the provider segment.",
    " * Frozen entries; build a Map locally if lookup-by-key is needed.",
    " */",
    "export const VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS: ReadonlyArray<",
    "  readonly [string, string]",
    "> = Object.freeze([",
    ...data.surfaceGatewayApiVersions.map(([surface, version]) =>
      frozenTuple(surface, quote(version))
    ),
    "]);",
    "",
    "/** Gateway API version used for a surface without its own entry. */",
    "export const DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION = " +
    `${quote(data.defaultGatewayApiVersion)};`,
    "",
    "/**",
    " * Transport capabilities keyed by canonical provider/model ID. Both",
    " * provider-specific and provider-neutral option resolution consult this table",
    " * so the two representations cannot contradict each other.",
    " * Frozen entries; build a Map locally if lookup-by-key is needed.",
    " */",
    "export const VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES: ReadonlyArray<",
    "  readonly [string, Readonly<VeryfrontCloudModelTransportCapabilities>]",
    "> = Object.freeze([",
    ...data.modelTransportCapabilities.map(([modelId, capabilities]) =>
      frozenTuple(modelId, renderTransportCapabilities(capabilities))
    ),
    "]);",
    "",
    "/**",
    " * Chat model entries in display order. The order is user-visible. Each entry is",
    " * frozen here, so the data is immutable for any module that imports it.",
    " */",
    "export const VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES: readonly VeryfrontCloudChatModel[] =",
    "  Object.freeze([",
    ...data.chatModels.map(renderChatModel),
    "  ]);",
    "",
    "/** Display label for each provider. */",
    "export const VERYFRONT_CLOUD_PROVIDER_LABELS: Readonly<",
    "  Record<KnownVeryfrontCloudProviderId, string>",
    "> = Object.freeze({",
    ...data.providerLabels.map(([provider, label]) =>
      `${objectKey(provider)}: ${quote(label)},`
    ),
    "});",
    "",
    "/** Provider display order. The order is user-visible. */",
    "export const VERYFRONT_CLOUD_PROVIDER_ORDER: readonly KnownVeryfrontCloudProviderId[] =",
    "  Object.freeze([",
    ...data.providerOrder.map((provider) => `${quote(provider)},`),
    "  ]);",
    "",
  ];
  return lines.join("\n");
}
