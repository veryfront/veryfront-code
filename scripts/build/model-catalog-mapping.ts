/**
 * Pure mapping from the served model catalog to the catalog data module.
 *
 * Nothing here touches the network or the filesystem, so the whole mapping is
 * exercised by unit tests over hand-built payloads. The network fetch and the
 * file write live in `generate-model-catalog.ts`.
 *
 * The mapping is an ALLOWLIST: {@link parseServedCatalog} names every field
 * the generator reads, and {@link buildModelCatalogData} reads only from what
 * it returns, so a field the platform adds cannot reach this package by
 * default. A field belongs in the allowlist only when the package acts on it.
 *
 * A consumed field must be ABSENT, where it is optional, or carry the type it
 * is read as. A present value of the wrong type fails generation and names the
 * model and the field: coercing it would turn a broken payload into an
 * ordinary-looking removal, and merging that would drop something the platform
 * still serves. Unknown keys, unknown vendors and unknown string VALUES are
 * tolerated, because those are things the platform may legitimately add.
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

function fail(detail: string): never {
  throw new Error(`Served model catalog is unusable: ${detail}`);
}

/** Type a consumed field must carry when it is present. */
type FieldType =
  | "a string"
  | "a boolean"
  | "an object"
  | "an array of strings"
  | "an array";

/** One consumed field: what it is called, what it must be, whether it may be absent. */
type FieldSpec = {
  readonly key: string;
  readonly type: FieldType;
  readonly required: boolean;
};

/**
 * Every field this generator reads, and nothing else. A field listed here must
 * be absent (where optional) or carry this type; a present value of the wrong
 * type fails generation rather than being coerced. Fields NOT listed here are
 * never read, so their shape cannot matter.
 */
const CATALOG_FIELDS: readonly FieldSpec[] = [
  { key: "models", type: "an array", required: true },
  { key: "providers", type: "an array of strings", required: true },
  { key: "defaultModelId", type: "a string", required: true },
];

/** Identity fields, validated first so later failures can name the model. */
const MODEL_ID_FIELD: readonly FieldSpec[] = [{
  key: "id",
  type: "a string",
  required: true,
}];

const MODEL_FIELDS: readonly FieldSpec[] = [
  { key: "modelId", type: "a string", required: true },
  { key: "provider", type: "a string", required: true },
  { key: "name", type: "a string", required: true },
  { key: "description", type: "a string", required: false },
  { key: "providerLabel", type: "a string", required: true },
  { key: "capabilities", type: "an object", required: false },
];

/**
 * Shape a provider segment must have, restated from `model-catalog.ts`.
 *
 * The runtime takes the provider from a model id by cutting at the first `/`
 * and passing the segment to `resolveVeryfrontCloudProviderId`, which requires
 * this shape. A generated entry that does not satisfy it is published but
 * unroutable, so the generator refuses it rather than shipping it. An
 * integration test pins this rule to the runtime's behaviour, so the two
 * cannot drift apart.
 */
const PROVIDER_SEGMENT_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Segments the runtime refuses, so a provider can never be confused with a
 * member every object carries, nor with the gateway prefix itself.
 */
const RESERVED_PROVIDER_SEGMENTS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
  "veryfront-cloud",
]);

/** The gateway prefix the runtime strips before parsing a model id. */
const GATEWAY_MODEL_PREFIX = "veryfront-cloud/";

/**
 * Why the runtime could not use this model id, or undefined when it can.
 *
 * This is the conjunction of every step a generated id passes through on its
 * way to a constructed model: `resolveVeryfrontCloudProviderFromModelId` and
 * `resolveVeryfrontCloudProviderId` in `model-catalog.ts`, then
 * `parseVeryfrontCloudModelId` in `shared.ts`, whose result feeds
 * `resolveVeryfrontCloudGatewayPath`. An id that fails any of them is
 * published and unusable, so the generator refuses it here instead.
 *
 * The upstream segment is checked for exactly what `parseVeryfrontCloudModelId`
 * requires of it, which is that it is non-empty and carries no surrounding
 * whitespace. Nothing constrains its characters, and nothing here may: an
 * upstream id legitimately contains dots, colons, slashes and the like, and a
 * character class invented here would reject models the platform can serve.
 *
 * The kind-specific rules in that function are deliberately NOT mirrored. That
 * embeddings accept only some providers, and that a Mistral id must already be
 * in the catalog, are conditions of a particular call, not properties of a
 * catalog entry.
 */
export function describeUnroutableModelId(
  modelId: string,
): string | undefined {
  // The runtime strips the gateway prefix first, so an id that carries it has
  // nothing left to cut.
  if (modelId.startsWith(GATEWAY_MODEL_PREFIX)) {
    return `carries the "${GATEWAY_MODEL_PREFIX}" prefix, which the runtime strips`;
  }
  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0) return "has no provider segment before a forward slash";

  const segment = modelId.slice(0, slashIndex);
  if (!PROVIDER_SEGMENT_PATTERN.test(segment)) {
    return `has a provider segment "${segment}" that is not lowercase words joined by hyphens or dots`;
  }
  if (RESERVED_PROVIDER_SEGMENTS.has(segment)) {
    return `has a reserved provider segment "${segment}"`;
  }

  const upstream = modelId.slice(slashIndex + 1);
  if (upstream === "") return "has no model segment after the provider segment";
  if (upstream.trim() !== upstream) {
    return "has whitespace around its model segment";
  }
  return undefined;
}

const CAPABILITY_FIELDS: readonly FieldSpec[] = [
  { key: "reasoning", type: "a boolean", required: false },
  { key: "reasoning_mode", type: "a string", required: false },
  { key: "transport", type: "a string", required: false },
];

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

function hasType(value: unknown, type: FieldType): boolean {
  switch (type) {
    case "a string":
      return typeof value === "string";
    case "a boolean":
      return typeof value === "boolean";
    case "an object":
      return asRecord(value) !== undefined;
    case "an array":
      return Array.isArray(value);
    case "an array of strings":
      return Array.isArray(value) &&
        value.every((entry) => typeof entry === "string");
  }
}

/** Check one group of consumed fields, naming the subject in any failure. */
function checkFields(
  source: Record<string, unknown>,
  fields: readonly FieldSpec[],
  subject: string,
): void {
  for (const { key, type, required } of fields) {
    const value = source[key];
    // A required field that is present but empty is as unusable as an absent
    // one, and saying "is missing" describes both.
    if (value === undefined || (required && value === "")) {
      if (required) fail(`${subject} is missing ${key}`);
      continue;
    }
    if (!hasType(value, type)) {
      fail(`${subject} ${key} must be ${type}, not ${describe(value)}`);
    }
  }
}

/** Capability values this generator reads. */
type ServedCapabilities = {
  readonly reasoning?: boolean;
  readonly reasoning_mode?: string;
  readonly transport?: string;
};

/** One served model, reduced to the fields this generator reads. */
type ServedModel = {
  readonly id: string;
  readonly modelId: string;
  readonly provider: string;
  readonly name: string;
  readonly description?: string;
  readonly providerLabel: string;
  readonly capabilities: ServedCapabilities;
};

/** The served catalog, reduced to the fields this generator reads. */
type ServedCatalog = {
  readonly models: readonly ServedModel[];
  readonly providers: readonly string[];
  readonly defaultModelId: string;
};

/**
 * Validate the consumed subset of a served catalog payload, once, up front.
 *
 * The mapping reads only from the result, so no consumed value can reach it
 * with an unexpected shape, and no wrong-typed value can be coerced into a
 * plausible-looking absence. Unknown keys are dropped here, which is the
 * allowlist; unknown string values pass through and are judged later.
 */
export function parseServedCatalog(payload: unknown): ServedCatalog {
  const root = asRecord(payload) ?? fail("the payload is not a JSON object");
  checkFields(root, CATALOG_FIELDS, "the catalog");

  const models = (root.models as readonly unknown[]).map((entry, index) => {
    const model = asRecord(entry) ??
      fail(`models[${index}] must be an object, not ${describe(entry)}`);
    checkFields(model, MODEL_ID_FIELD, `models[${index}]`);
    const subject = `model "${model.id as string}"`;
    checkFields(model, MODEL_FIELDS, subject);

    const unroutable = describeUnroutableModelId(model.modelId as string);
    if (unroutable !== undefined) {
      fail(`${subject} modelId "${model.modelId}" ${unroutable}`);
    }

    const capabilities = model.capabilities === undefined
      ? {}
      : model.capabilities as Record<string, unknown>;
    checkFields(capabilities, CAPABILITY_FIELDS, `${subject} capabilities`);

    // Every cast below is licensed by the checks just above.
    return {
      id: model.id as string,
      modelId: model.modelId as string,
      provider: model.provider as string,
      name: model.name as string,
      description: model.description as string | undefined,
      providerLabel: model.providerLabel as string,
      capabilities: capabilities as ServedCapabilities,
    };
  });
  if (models.length === 0) fail("it lists no model");

  const providers: string[] = [];
  for (const provider of root.providers as readonly string[]) {
    if (provider !== "" && !providers.includes(provider)) {
      providers.push(provider);
    }
  }
  if (providers.length === 0) fail("it lists no provider");

  return { models, providers, defaultModelId: root.defaultModelId as string };
}

/**
 * Build the catalog data from a served catalog payload and the overlay.
 *
 * Every field of the result comes from a key named here or from the overlay.
 * The payload is read as `unknown`, so an unknown field, an unknown vendor and
 * an unknown capability key are all dropped rather than carried.
 *
 * Throws when the payload cannot describe a usable catalog: an empty model or
 * provider list, a listed model that cannot be identified, a default model
 * that no entry claims, or a provider with no model to take its display label
 * from. A scheduled run that throws fails loudly, which is the intended alert.
 * Nothing is ever dropped quietly: a model that vanishes from the output has
 * to have vanished from the catalog.
 */
export function buildModelCatalogData(
  payload: unknown,
  overlay: ModelCatalogOverlay,
): ModelCatalogData {
  assertOverlayInvariants(overlay);
  const catalog = parseServedCatalog(payload);
  const providerOrder = [...catalog.providers];

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

  for (const served of catalog.models) {
    const { id: servedId, modelId, provider, name, capabilities } = served;
    // `reasoning` is the served name for this fact and the only one read: the
    // payload also carries the older `thinking` spelling, but two sources for
    // one fact can disagree, so only `reasoning` is allowed in. It is also the
    // authority on WHETHER a model reasons. The overlay says how much, so a
    // budget for a model the catalog serves as non-reasoning is dropped rather
    // than left to assert reasoning the catalog no longer claims.
    const reasons = capabilities.reasoning === true;
    const thinkingBudgetTokens = reasons
      ? thinkingBudgets.get(modelId)
      : undefined;
    chatModels.push({
      id: entryIds.get(modelId) ?? servedId,
      modelId,
      provider,
      name,
      description: served.description ?? "",
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
    const reasoningMode = reasons ? capabilities.reasoning_mode : undefined;
    const transport = capabilities.transport;
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

    // The label table is keyed by provider, so two models of one provider
    // offering different labels leaves no honest answer to publish.
    const label = served.providerLabel;
    const knownLabel = labelByProvider.get(provider);
    if (knownLabel === undefined) {
      labelByProvider.set(provider, label);
    } else if (knownLabel !== label) {
      fail(
        `provider "${provider}" is served with conflicting display labels: ` +
          `"${knownLabel}" and "${label}"`,
      );
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

  // A listed provider that serves no model is legitimate: the platform may
  // list one with nothing routable right now. It contributes no group, so it
  // is left out of every table rather than failing the run.
  //
  // Whether a provider is served is decided by whether a model names it, never
  // by whether a label was found for it. Those coincide, because the platform
  // declares the label required and this generator enforces that, but reading
  // the label would make an absent label look like an absent provider and drop
  // models that are still listed.
  const providersWithModels = new Set(
    chatModels.map((model) => model.provider),
  );
  // The platform derives its provider list from the models it serves, so a
  // listed provider with no model cannot come from a correct payload: it is an
  // upstream defect, and saying so is this generator's job.
  const unserved = providerOrder.filter((provider) =>
    !providersWithModels.has(provider)
  );
  if (unserved.length > 0) {
    fail(`listed provider serves no model: ${unserved.join(", ")}`);
  }

  const providerAliases: (readonly [string, string])[] = [];
  const providerLabels: (readonly [string, string])[] = [];
  for (const provider of providerOrder) {
    const label = labelByProvider.get(provider) ??
      fail(
        `provider "${provider}" serves a model but carries no display label`,
      );
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

  const servedDefaultModelId = catalog.defaultModelId;
  const defaultEntry =
    chatModels.find((model) => model.modelId === servedDefaultModelId) ??
      fail(
        `the default model "${servedDefaultModelId}" is not one of the served models`,
      );

  const data: ModelCatalogData = {
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
  // The label table is keyed by `KnownVeryfrontCloudProviderId`, which is
  // hand-written and public, so a provider leaving the catalog drops a key the
  // type still requires. Writing that file would turn an upstream change into
  // a typecheck failure somewhere else, long after the run that caused it, so
  // it is refused here and named instead. Removing a provider is a public type
  // change, and a person makes it.
  const publishedProviders = new Set(data.providerOrder);
  const missingKnown = overlay.knownProviders.filter(
    (provider) => !publishedProviders.has(provider),
  );
  if (missingKnown.length > 0) {
    fail(
      `the catalog no longer serves ${missingKnown.join(", ")}, which ` +
        `KnownVeryfrontCloudProviderId still lists. Removing a provider is a ` +
        `public type change: update that union and this overlay by hand.`,
    );
  }

  // The output has to be readable back by the package's lookups, so it is
  // checked here rather than left to whoever reviews the generated diff.
  assertCatalogInvariants(data);
  return data;
}

/** Keys that appear more than once, in the order they first appear. */
function findDuplicates(keys: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }
  return [...duplicated];
}

/**
 * Check the generated data against what the package's lookups require.
 *
 * Every lookup in `model-catalog.ts` resolves either by first match
 * (`findVeryfrontCloudModel`, `findVeryfrontCloudModelByModelId`,
 * `resolveVeryfrontCloudModelId`) or through a `Map` built from a table
 * (provider aliases, transport capabilities, provider routing, gateway API
 * versions). Both silently prefer one entry and discard the rest, so a
 * duplicate does not announce itself: it makes a model or a provider
 * unreachable. These are the preconditions of those lookups, not house style,
 * so generation fails rather than shipping data that cannot be read back.
 */
/**
 * Every keyed table the generator consumes from the overlay.
 *
 * Each is turned into a `Map`, here or in the package, so a key written twice
 * keeps one row and discards the other without saying which. The overlay is
 * hand-edited, which is exactly where that happens.
 */
export function assertOverlayInvariants(overlay: ModelCatalogOverlay): void {
  const tables: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["providerRouting", overlay.providerRouting.map(([key]) => key)],
    [
      "surfaceGatewayApiVersions",
      overlay.surfaceGatewayApiVersions.map(([key]) => key),
    ],
    ["entryIds", overlay.entryIds.map(([key]) => key)],
    ["thinkingBudgetTokens", overlay.thinkingBudgetTokens.map(([key]) => key)],
    [
      "openAIChatReasoningWithFunctionTools",
      overlay.openAIChatReasoningWithFunctionTools.map(([key]) => key),
    ],
    [
      "retainedTransportCapabilities",
      overlay.retainedTransportCapabilities.map(([key]) => key),
    ],
    ["knownProviders", overlay.knownProviders],
  ];
  for (const [name, keys] of tables) {
    const duplicates = findDuplicates(keys);
    if (duplicates.length > 0) {
      fail(`overlay ${name} declares a key twice: ${duplicates.join(", ")}`);
    }
  }
  // Two entry ids pointing at one published id would collide in the catalog.
  const duplicateEntryIds = findDuplicates(
    overlay.entryIds.map(([, id]) => id),
  );
  if (duplicateEntryIds.length > 0) {
    fail(
      `overlay entryIds publishes one id for several models: ${
        duplicateEntryIds.join(", ")
      }`,
    );
  }
}

export function assertCatalogInvariants(data: ModelCatalogData): void {
  const duplicateIds = findDuplicates(data.chatModels.map((model) => model.id));
  if (duplicateIds.length > 0) {
    fail(
      `published id claimed by more than one model: ${duplicateIds.join(", ")}`,
    );
  }

  const duplicateModelIds = findDuplicates(
    data.chatModels.map((model) => model.modelId),
  );
  if (duplicateModelIds.length > 0) {
    fail(
      `model id claimed by more than one entry: ${
        duplicateModelIds.join(", ")
      }`,
    );
  }

  const duplicateAliases = findDuplicates(
    data.providerAliases.map(([alias]) => alias),
  );
  if (duplicateAliases.length > 0) {
    fail(
      `provider alias mapped more than once: ${duplicateAliases.join(", ")}`,
    );
  }

  const duplicateCapabilities = findDuplicates(
    data.modelTransportCapabilities.map(([modelId]) => modelId),
  );
  if (duplicateCapabilities.length > 0) {
    fail(
      `transport capabilities declared twice for: ${
        duplicateCapabilities.join(", ")
      }`,
    );
  }

  const duplicateLabels = findDuplicates(
    data.providerLabels.map(([provider]) => provider),
  );
  if (duplicateLabels.length > 0) {
    fail(`display label declared twice for: ${duplicateLabels.join(", ")}`);
  }

  const duplicateOrder = findDuplicates([...data.providerOrder]);
  if (duplicateOrder.length > 0) {
    fail(
      `provider listed twice in the display order: ${
        duplicateOrder.join(", ")
      }`,
    );
  }

  const duplicateRouting = findDuplicates(
    data.providerRouting.map(([provider]) => provider),
  );
  if (duplicateRouting.length > 0) {
    fail(`provider routing declared twice for: ${duplicateRouting.join(", ")}`);
  }

  // `resolveVeryfrontCloudModelId` matches a request against the model ids
  // first, and returns any remaining request that contains a slash as already
  // canonical, so it never reaches the lookup by published id. A published id
  // carrying a slash is therefore reachable only when it IS its own model id.
  const unreachable = data.chatModels
    .filter((model) => model.id !== model.modelId && model.id.includes("/"))
    .map((model) => `${model.id} (${model.modelId})`);
  if (unreachable.length > 0) {
    fail(
      `published id contains a slash without being the model id, so it never resolves: ${
        unreachable.join(", ")
      }`,
    );
  }

  // `groupVeryfrontCloudModelsByProvider` walks the provider order and picks
  // each provider's models, so a model whose provider is not in that order is
  // published but never shown. The served order is the platform's own
  // statement, so a model outside it is a contradiction to report, not a
  // position for this generator to invent.
  const ordered = new Set(data.providerOrder);
  const ungrouped = [
    ...new Set(
      data.chatModels.filter((model) => !ordered.has(model.provider)).map((
        model,
      ) => `${model.id} (${model.provider})`),
    ),
  ];
  if (ungrouped.length > 0) {
    fail(
      `provider not in the provider order, so these models are never listed: ${
        ungrouped.join(", ")
      }`,
    );
  }

  // `model-catalog.ts` throws at module load when the default names no entry,
  // so a generated file that breaks this cannot even be imported.
  const defaults = data.chatModels.filter((model) =>
    model.id === data.defaultModelId
  );
  if (defaults.length !== 1) {
    fail(
      `the default model "${data.defaultModelId}" names ${defaults.length} entries, not exactly one`,
    );
  }

  // This table is read through a Map too, so a surface declared twice keeps
  // one version and discards the other without saying which.
  const duplicateVersions = findDuplicates(
    data.surfaceGatewayApiVersions.map(([surface]) => surface),
  );
  if (duplicateVersions.length > 0) {
    fail(
      `gateway API version declared twice for: ${duplicateVersions.join(", ")}`,
    );
  }

  // `resolveVeryfrontCloudGatewayPath` reads the version for the surface a
  // provider routes on, so every routed surface needs one, as does the
  // surface used for a provider the table does not list.
  const versioned = new Set(
    data.surfaceGatewayApiVersions.map(([surface]) => surface),
  );
  const unversioned = [
    ...new Set(data.providerRouting.map(([, routing]) => routing.surface)),
    data.defaultSurface,
  ].filter((surface) => !versioned.has(surface));
  if (unversioned.length > 0) {
    fail(
      `no gateway API version for surface: ${
        [...new Set(unversioned)].join(", ")
      }`,
    );
  }
}

/**
 * Overlay rows that no longer refer to anything in the output.
 *
 * Reported rather than fatal, and deliberately so: a vendor withdrawing a
 * model would otherwise stop the catalog syncing until somebody pruned the
 * overlay, which punishes an unrelated change. The overlay's own contract is
 * that a row is deleted once it no longer applies, so this is the reminder.
 * `retainedTransportCapabilities` is exempt by definition: those rows exist
 * precisely because the catalog no longer serves the model.
 */
export function findStaleOverlayKeys(
  data: ModelCatalogData,
  overlay: ModelCatalogOverlay,
): readonly string[] {
  const modelIds = new Set(data.chatModels.map((model) => model.modelId));
  const providers = new Set(data.providerOrder);
  const stale: string[] = [];

  const modelKeyed: ReadonlyArray<
    readonly [string, readonly (readonly [string, unknown])[]]
  > = [
    ["entryIds", overlay.entryIds],
    ["thinkingBudgetTokens", overlay.thinkingBudgetTokens],
    [
      "openAIChatReasoningWithFunctionTools",
      overlay.openAIChatReasoningWithFunctionTools,
    ],
  ];
  for (const [table, rows] of modelKeyed) {
    for (const [modelId] of rows) {
      if (!modelIds.has(modelId)) stale.push(`${table} "${modelId}"`);
    }
  }
  for (const [provider] of overlay.providerRouting) {
    if (!providers.has(provider)) stale.push(`providerRouting "${provider}"`);
  }
  return stale;
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
