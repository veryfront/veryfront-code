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

/**
 * A failure this generator states itself: the served catalog or the overlay
 * cannot be turned into a usable module, and the message says why in words
 * chosen here — positions and field names, never a served value. The command
 * prints it as it is; only an UNPLANNED error goes through the redaction
 * formatter, which would otherwise cut these messages down too.
 */
export class ModelCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCatalogError";
  }
}

function fail(detail: string): never {
  throw new ModelCatalogError(`Served model catalog is unusable: ${detail}`);
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

const MODEL_FIELDS: readonly FieldSpec[] = [
  { key: "id", type: "a string", required: true },
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
 *
 * `__proto__` is named rather than derived: it is an accessor on the object
 * prototype but not an own property of it, so it is absent from the list
 * below. It is also the one name that does not merely shadow a member -- as a
 * key of a generated object literal it sets the prototype and the entry itself
 * disappears -- so it is not left to the shape rule alone to catch.
 */
const RESERVED_PROVIDER_SEGMENTS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "__proto__",
  "prototype",
  "veryfront-cloud",
]);

/**
 * Why this provider name cannot be used, or undefined when it can.
 *
 * The served `provider` field is not only routed through: it is rendered as a
 * key of the generated provider tables. A name outside this shape would either
 * be unroutable or, for a name every object already carries, land in a table
 * as something other than an ordinary entry. Both are refused here rather than
 * generated.
 */
function describeUnusableProvider(provider: string): string | undefined {
  if (!PROVIDER_SEGMENT_PATTERN.test(provider)) {
    return `is not lowercase words joined by hyphens or dots`;
  }
  if (RESERVED_PROVIDER_SEGMENTS.has(provider)) return `is reserved`;
  return undefined;
}

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
  const unusableSegment = describeUnusableProvider(segment);
  if (unusableSegment !== undefined) {
    return `has a provider segment that ${unusableSegment}`;
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
 *
 * A failure names the entry by its position (`models[3]`) and the field, never
 * by a served value: these messages reach the terminal, and a value that has
 * just failed validation is exactly the one not to print.
 */
export function parseServedCatalog(payload: unknown): ServedCatalog {
  const root = asRecord(payload) ?? fail("the payload is not a JSON object");
  checkFields(root, CATALOG_FIELDS, "the catalog");

  const models = (root.models as readonly unknown[]).map((entry, index) => {
    const subject = `models[${index}]`;
    const model = asRecord(entry) ??
      fail(`${subject} must be an object, not ${describe(entry)}`);
    checkFields(model, MODEL_FIELDS, subject);

    const unroutable = describeUnroutableModelId(model.modelId as string);
    if (unroutable !== undefined) fail(`${subject} modelId ${unroutable}`);

    const unusableProvider = describeUnusableProvider(model.provider as string);
    if (unusableProvider !== undefined) {
      fail(`${subject} provider ${unusableProvider}`);
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
  for (
    const [index, provider] of (root.providers as readonly string[]).entries()
  ) {
    if (provider === "" || providers.includes(provider)) continue;
    const unusable = describeUnusableProvider(provider);
    if (unusable !== undefined) fail(`providers[${index}] ${unusable}`);
    providers.push(provider);
  }
  if (providers.length === 0) fail("it lists no provider");

  return { models, providers, defaultModelId: root.defaultModelId as string };
}

/** Orders strings by code point, so output never depends on a locale or ICU build. */
export function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** What one pass over the served models yields. */
type ServedFacts = {
  readonly chatModels: ChatModelEntry[];
  readonly transportCapabilities: (readonly [string, TransportCapabilities])[];
  /** Every served model under the id the runtime looks capabilities up by. */
  readonly canonicalIds: string[];
  /** Display label per provider, taken from that provider's models. */
  readonly labels: Map<string, string>;
  /** Model-id prefixes that differ from the provider they name. */
  readonly aliasPrefixes: Map<string, Set<string>>;
  /** Position of the first model that implied each `<provider>/<prefix>` alias. */
  readonly aliasPositions: Map<string, number>;
  /** Position of the model each provider's label was first taken from. */
  readonly labelPositions: Map<string, number>;
};

/** The chat entry for one served model. */
function readChatModel(
  served: ServedModel,
  overlay: ModelCatalogOverlay,
): ChatModelEntry {
  const entryIds = new Map(overlay.entryIds);
  const budgets = new Map(overlay.thinkingBudgetTokens);
  // Both tables are keyed by the CANONICAL id (`<provider>/<upstream>`), as
  // the overlay contract states and as the transport table already is. The
  // served id may carry a provider alias instead (`google-ai-studio/foo` for
  // provider `google`), and looking that up would miss every row.
  const key = capabilityKey(served);
  // `reasoning` is the served name for this fact and the only one read: the
  // payload also carries the older `thinking` spelling, but two sources for
  // one fact can disagree. It is also the authority on WHETHER a model
  // reasons, so an overlay budget, which says how much, is dropped for a model
  // the catalog serves as non-reasoning.
  const reasons = served.capabilities.reasoning === true;
  const thinkingBudgetTokens = reasons ? budgets.get(key) : undefined;
  return {
    id: entryIds.get(key) ?? served.id,
    modelId: served.modelId,
    provider: served.provider,
    name: served.name,
    description: served.description ?? "",
    // A declared budget already means the model reasons, so the flag is
    // emitted only where no budget carries that fact.
    ...(reasons && thinkingBudgetTokens === undefined
      ? { thinking: true }
      : {}),
    ...(thinkingBudgetTokens === undefined ? {} : { thinkingBudgetTokens }),
  };
}

/**
 * The id the runtime looks capability rows up by.
 *
 * `createVeryfrontCloudModelRuntime` parses a request id, which resolves any
 * provider alias to its canonical provider, and then rebuilds the lookup key as
 * `<canonical provider>/<upstream id>`. A row keyed by the served id would
 * therefore never be found for a model whose id carries an alias, such as one
 * published under `google-ai-studio/` while its provider is `google`.
 */
function capabilityKey(served: ServedModel): string {
  const slashIndex = served.modelId.indexOf("/");
  const upstream = slashIndex > 0
    ? served.modelId.slice(slashIndex + 1)
    : served.modelId;
  return `${served.provider}/${upstream}`;
}

/** Transport facts for one served model, or undefined when it declares none. */
function readTransportCapabilities(
  served: ServedModel,
  overlay: ModelCatalogOverlay,
): TransportCapabilities | undefined {
  const functionToolReasoning = new Map(
    overlay.openAIChatReasoningWithFunctionTools,
  )
    .get(capabilityKey(served));
  // A reasoning control on a model the catalog serves as non-reasoning is the
  // catalog contradicting itself, and `reasoning` settles it.
  const reasoningMode = served.capabilities.reasoning === true
    ? served.capabilities.reasoning_mode
    : undefined;
  // `anthropicThinkingMode` is a fact about the Anthropic wire format: the
  // runtime reads it only when building Anthropic provider options, and on
  // any other surface it would merely suppress the generic reasoning option
  // and leave the model without thinking. So it is emitted only for a
  // provider the overlay routes over the Anthropic surface.
  const surface =
    new Map(overlay.providerRouting).get(served.provider)?.surface ??
      overlay.defaultSurface;
  const transport = served.capabilities.transport;
  const entry: TransportCapabilities = {
    ...(surface === "anthropic" && reasoningMode !== undefined &&
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
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/** Record the provider's label and any alias its model id implies. */
function recordProviderFacts(
  served: ServedModel,
  index: number,
  facts: ServedFacts,
): void {
  // The label table is keyed by provider, so two models of one provider
  // offering different labels leaves no honest answer to publish. Named by
  // position: the labels and the provider are served values.
  const known = facts.labels.get(served.provider);
  if (known === undefined) {
    facts.labels.set(served.provider, served.providerLabel);
    facts.labelPositions.set(served.provider, index);
  } else if (known !== served.providerLabel) {
    fail(
      `models[${
        facts.labelPositions.get(served.provider)
      }] and models[${index}] ` +
        "are served with conflicting display labels for their provider",
    );
  }

  // A model id whose provider segment differs from the canonical provider
  // names an accepted provider alias.
  const slashIndex = served.modelId.indexOf("/");
  const prefix = slashIndex > 0
    ? served.modelId.slice(0, slashIndex)
    : served.provider;
  if (prefix === served.provider) return;
  const prefixes = facts.aliasPrefixes.get(served.provider) ??
    new Set<string>();
  if (!prefixes.has(prefix)) {
    facts.aliasPositions.set(`${served.provider}/${prefix}`, index);
  }
  prefixes.add(prefix);
  facts.aliasPrefixes.set(served.provider, prefixes);
}

/** One pass over the served models, gathering everything the tables need. */
function readServedModels(
  catalog: ServedCatalog,
  overlay: ModelCatalogOverlay,
): ServedFacts {
  const facts: ServedFacts = {
    chatModels: [],
    transportCapabilities: [],
    canonicalIds: [],
    labels: new Map(),
    aliasPrefixes: new Map(),
    aliasPositions: new Map(),
    labelPositions: new Map(),
  };
  for (const [index, served] of catalog.models.entries()) {
    facts.chatModels.push(readChatModel(served, overlay));
    facts.canonicalIds.push(capabilityKey(served));
    const capabilities = readTransportCapabilities(served, overlay);
    if (capabilities !== undefined) {
      facts.transportCapabilities.push([capabilityKey(served), capabilities]);
    }
    recordProviderFacts(served, index, facts);
  }
  return facts;
}

/** The alias and label tables, in provider order. */
function buildProviderTables(
  providerOrder: readonly string[],
  facts: ServedFacts,
  overlay: ModelCatalogOverlay,
): {
  providerAliases: (readonly [string, string])[];
  providerLabels: (readonly [string, string])[];
} {
  // The runtime consults the alias map BEFORE it accepts a provider as
  // written, so a retained alias is checked for the two ways it could hijack
  // ids: a key outside the served-alias shape would make ids the runtime
  // deliberately refuses resolve, and a key that names another provider —
  // served, or routed by the overlay — would send that provider's every id
  // to the alias's target. The overlay names repository values, so they are
  // printed.
  const providers = new Set([
    ...providerOrder,
    ...overlay.providerRouting.map(([provider]) => provider),
  ]);
  for (const [alias, provider] of overlay.retainedProviderAliases) {
    const unusable = describeUnusableProvider(alias);
    if (unusable !== undefined) {
      fail(`overlay retainedProviderAliases alias "${alias}" ${unusable}`);
    }
    if (alias !== provider && providers.has(alias)) {
      fail(
        `overlay retainedProviderAliases alias "${alias}" names a provider of its own, so it cannot stand for "${provider}"`,
      );
    }
  }

  const providerAliases: (readonly [string, string])[] = [];
  const providerLabels: (readonly [string, string])[] = [];
  for (const provider of providerOrder) {
    const label = facts.labels.get(provider) ??
      fail(
        `provider "${provider}" serves a model but carries no display label`,
      );
    providerLabels.push([provider, label]);
    providerAliases.push([provider, provider]);
    // Derived from the served ids and retained by the overlay, as one sorted
    // group per provider, so the table does not move when the catalog stops
    // (or starts) spelling an alias the overlay retains anyway.
    const derived = [...facts.aliasPrefixes.get(provider) ?? []];
    // A derived alias is held to the same rule as a retained one: a prefix
    // that names another provider — served, or routed by the overlay — would
    // send that provider's every id here, since the runtime reads the alias
    // map before accepting a provider as written. Named by the position of
    // the model that implied it: the prefix is a served value.
    for (const prefix of derived) {
      if (providers.has(prefix)) {
        fail(
          `models[${facts.aliasPositions.get(`${provider}/${prefix}`)}] ` +
            "carries a provider segment that names another provider, so its " +
            "alias would shadow that provider",
        );
      }
    }
    const retained = overlay.retainedProviderAliases
      .filter(([, target]) => target === provider)
      .map(([alias]) => alias);
    const prefixes = [...new Set([...derived, ...retained])]
      .filter((alias) => alias !== provider)
      .sort(compareCodePoints);
    for (const prefix of prefixes) providerAliases.push([prefix, provider]);
  }
  // A retained alias for a provider the catalog lists no chat model for
  // follows the served groups, in overlay order. Like a routing row, an alias
  // is a fact about ids the runtime accepts, not about the chat list: model
  // ids of that provider the runtime resolves without a chat entry still go
  // through it, and its routing row is kept by `routedProviders` on the same
  // reasoning. Its provider has no label or display-order row, which only the
  // chat list needs.
  const served = new Set(providerOrder);
  for (const [alias, provider] of overlay.retainedProviderAliases) {
    if (!served.has(provider) && alias !== provider) {
      providerAliases.push([alias, provider]);
    }
  }
  return { providerAliases, providerLabels };
}

/**
 * The providers that need a routing row: every provider in the served order,
 * then every provider the overlay routes that the catalog does not name, in
 * overlay order.
 *
 * Routing is a fact about a provider's gateway surface, not about which chat
 * models the catalog lists for it, so a routing row is never conditioned on a
 * chat entry or a retained transport row being present. Model ids the runtime
 * resolves without either (an embedding model, for one) still route through
 * these rows, and dropping a row would move them to the default surface.
 */
function routedProviders(
  providerOrder: readonly string[],
  overlayRouting: readonly (readonly [string, unknown])[],
): string[] {
  const providers = [...providerOrder];
  for (const [provider] of overlayRouting) {
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

/**
 * The transport table: entries retained for models the catalog no longer
 * serves come first and in overlay order, so the table stays stable as models
 * enter and leave. A served model that declares no transport fact has none,
 * and a retained entry must not outlive it as a stale override.
 */
function buildTransportTable(
  facts: ServedFacts,
  overlay: ModelCatalogOverlay,
): (readonly [string, TransportCapabilities])[] {
  // Same key space as the rows themselves: canonical provider, upstream id.
  const served = new Set(facts.canonicalIds);
  return [
    ...overlay.retainedTransportCapabilities.filter(([modelId]) =>
      !served.has(modelId)
    ),
    ...facts.transportCapabilities,
  ];
}

/**
 * Build the catalog data from a served catalog payload and the overlay.
 *
 * Every field of the result comes from a field named by
 * {@link parseServedCatalog} or from the overlay. The payload is validated
 * first, the tables are built from the validated value, and the result is
 * checked against what the package's lookups require before it is returned.
 */
export function buildModelCatalogData(
  payload: unknown,
  overlay: ModelCatalogOverlay,
): ModelCatalogData {
  assertOverlayInvariants(overlay);
  const catalog = parseServedCatalog(payload);
  const facts = readServedModels(catalog, overlay);

  // The display order and the label table are about the chat list, so a
  // listed provider with no chat model has no row in either: nothing would be
  // shown under it, and its label is taken from its models. It keeps whatever
  // alias and routing rows the overlay gives it, like a retained provider, and
  // `findListedProvidersWithoutModels` names it for the operator — a
  // provider that only serves models this package lists no chat entry for
  // (an embedding model, say) is a state the catalog may legitimately be in.
  const withModels = new Set(facts.chatModels.map((model) => model.provider));
  const providerOrder = catalog.providers.filter((provider) =>
    withModels.has(provider)
  );

  const { providerAliases, providerLabels } = buildProviderTables(
    providerOrder,
    facts,
    overlay,
  );
  const routingByProvider = new Map(overlay.providerRouting);
  const transportCapabilities = buildTransportTable(facts, overlay);
  const defaultEntry = facts.chatModels.find(
    (model) => model.modelId === catalog.defaultModelId,
  ) ??
    fail("the default model is not one of the served models");

  const data: ModelCatalogData = {
    defaultModelId: defaultEntry.id,
    providerAliases,
    // A provider the overlay does not route falls back to the surface the
    // package already uses for an unlisted provider, so routing stays declared
    // for every provider the catalog names. Every provider the overlay routes
    // keeps its row whether or not the catalog still names it: model ids of
    // that provider resolve through the row regardless of any chat entry, and
    // dropping it would send them on the default surface, i.e. the wrong
    // protocol.
    providerRouting: routedProviders(
      providerOrder,
      overlay.providerRouting,
    ).map(
      (provider) =>
        [
          provider,
          routingByProvider.get(provider) ??
            { surface: overlay.defaultSurface },
        ] as const,
    ),
    defaultSurface: overlay.defaultSurface,
    gatewayPathPrefix: overlay.gatewayPathPrefix,
    surfaceGatewayApiVersions: overlay.surfaceGatewayApiVersions,
    defaultGatewayApiVersion: overlay.defaultGatewayApiVersion,
    modelTransportCapabilities: transportCapabilities,
    chatModels: facts.chatModels,
    providerLabels,
    providerOrder,
  };
  // The output has to be readable back by the package's lookups, so it is
  // checked here rather than left to whoever reviews the generated diff.
  assertCatalogInvariants(data);
  // Last, so a contradiction in the catalog itself is reported before a
  // spelling in the overlay: an overlay key spelled with an alias the served
  // ids imply is refused too (the retained aliases were checked with the
  // overlay's own invariants).
  refuseAliasKeyedOverlayRows(
    overlay,
    new Map(
      [...facts.aliasPrefixes].flatMap(([provider, prefixes]) =>
        [...prefixes].map((prefix) => [prefix, provider] as const)
      ),
    ),
  );
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
    ...overlayModelKeyTables(overlay),
    [
      "retainedProviderAliases",
      overlay.retainedProviderAliases.map(([key]) => key),
    ],
  ];
  // The aliases the overlay itself declares are known here; the ones the
  // served catalog implies are checked once the catalog has been read. A
  // retained "alias" that is itself a routed provider is not an alias but a
  // shadowing, which the alias table's own check names for what it is.
  const routedProviders = new Set(
    overlay.providerRouting.map(([provider]) => provider),
  );
  refuseAliasKeyedOverlayRows(
    overlay,
    new Map(
      overlay.retainedProviderAliases.filter(([alias]) =>
        !routedProviders.has(alias)
      ),
    ),
  );
  for (const [name, keys] of tables) {
    const duplicates = findDuplicates(keys);
    if (duplicates.length > 0) {
      fail(`overlay ${name} declares a key twice: ${duplicates.join(", ")}`);
    }
  }
  // The runtime refuses a budget that is not a positive safe integer while it
  // initialises its chat models, so a budget outside that range would be
  // generated, published, and then make the package throw at import. The
  // predicate mirrors `isPositiveSafeInteger` in
  // `src/provider/veryfront-cloud/model-catalog.ts`.
  for (const [modelId, budget] of overlay.thinkingBudgetTokens) {
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      fail(
        `overlay thinkingBudgetTokens for "${modelId}" is ${budget}, which the runtime ignores: it must be a positive safe integer`,
      );
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
  // `anthropicThinkingMode` has a reading only on the Anthropic surface (see
  // `readTransportCapabilities`); a retained row that declares it for a
  // provider routed elsewhere would suppress the generic reasoning option and
  // leave the model without thinking. The overlay is the repository's own,
  // so the entry is named.
  const routing = new Map(overlay.providerRouting);
  for (const [modelId, capabilities] of overlay.retainedTransportCapabilities) {
    if (capabilities.anthropicThinkingMode === undefined) continue;
    const slashIndex = modelId.indexOf("/");
    const provider = slashIndex > 0 ? modelId.slice(0, slashIndex) : modelId;
    const surface = routing.get(provider)?.surface ?? overlay.defaultSurface;
    if (surface !== "anthropic") {
      fail(
        `overlay retainedTransportCapabilities declares anthropicThinkingMode for "${modelId}", whose provider routes over the "${surface}" surface`,
      );
    }
  }
  // The runtime builds the gateway URL as
  // `${gatewayPathPrefix}/${provider}/${apiVersion}` by plain interpolation, so
  // an empty or malformed component yields a URL that points somewhere else.
  const badPrefix = describeUnusablePathComponent(
    overlay.gatewayPathPrefix,
    true,
  );
  if (badPrefix !== undefined) {
    fail(`overlay gatewayPathPrefix ${badPrefix}`);
  }
  for (
    const [surface, version] of [
      ...overlay.surfaceGatewayApiVersions,
      ["(default)", overlay.defaultGatewayApiVersion] as const,
    ]
  ) {
    const badVersion = describeUnusablePathComponent(version, false);
    if (badVersion !== undefined) {
      fail(`overlay gateway API version for ${surface} ${badVersion}`);
    }
  }
}

/**
 * The characters a gateway path segment may carry: RFC 3986's unreserved set.
 * An allowlist, not a list of the characters `URL.pathname` is known to
 * rewrite (`\\`, `%`, `?`, `#`, whitespace, ...): the assembled route is
 * assigned to `URL.pathname`, and anything outside this set is either
 * transformed there or has a meaning of its own in a URL.
 */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

/**
 * Why a value cannot be a component of the gateway path, or undefined when it
 * can: non-empty, no leading or trailing slash, no empty, `.` or `..`
 * segment, every segment within the unreserved characters; a single segment
 * unless `allowSegments`.
 */
function describeUnusablePathComponent(
  value: string,
  allowSegments: boolean,
): string | undefined {
  if (value === "") return "is empty";
  if (value.startsWith("/") || value.endsWith("/")) {
    return `starts or ends with a slash: ${quote(value)}`;
  }
  const segments = value.split("/");
  if (!allowSegments && segments.length > 1) {
    return `must be a single path segment: ${quote(value)}`;
  }
  if (
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    return `has an empty or relative segment: ${quote(value)}`;
  }
  if (segments.some((segment) => !PATH_SEGMENT_PATTERN.test(segment))) {
    return `has a segment outside the unreserved URL characters (letters, digits, "-", ".", "_", "~"): ${
      quote(value)
    }`;
  }
  return undefined;
}

/**
 * The overlay tables keyed by canonical model id, with their keys. Used by
 * both key checks: no duplicate key, and no key naming a provider alias.
 */
function overlayModelKeyTables(
  overlay: ModelCatalogOverlay,
): ReadonlyArray<readonly [string, readonly string[]]> {
  return [
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
  ];
}

/**
 * Refuse an overlay key whose provider segment is one of `aliases` (alias →
 * canonical provider). The runtime looks every model-keyed table up by the
 * CANONICAL id, so a row keyed by an alias is never found: the fact it carries
 * silently disappears the moment the catalog stops serving the model under
 * that spelling. The overlay is the repository's own, so the key is named.
 */
function refuseAliasKeyedOverlayRows(
  overlay: ModelCatalogOverlay,
  aliases: ReadonlyMap<string, string>,
): void {
  for (const [table, keys] of overlayModelKeyTables(overlay)) {
    for (const key of keys) {
      const slashIndex = key.indexOf("/");
      if (slashIndex <= 0) continue;
      const provider = key.slice(0, slashIndex);
      const canonical = aliases.get(provider);
      if (canonical !== undefined && canonical !== provider) {
        fail(
          `overlay ${table} key "${key}" names the provider alias "${provider}"; keys are canonical, so it must be "${canonical}/${
            key.slice(slashIndex + 1)
          }"`,
        );
      }
    }
  }
}

/**
 * Where one key appears more than once in `table`, as positions
 * (`chatModels[0] and chatModels[3]`). The keys themselves are served values
 * and these failures reach the terminal, so the positions stand in for them.
 */
function describeDuplicatePositions(
  table: string,
  keys: readonly string[],
): readonly string[] {
  const positions = new Map<string, number[]>();
  keys.forEach((key, index) => {
    positions.set(key, [...positions.get(key) ?? [], index]);
  });
  return [...positions.values()]
    .filter((at) => at.length > 1)
    .map((at) => at.map((index) => `${table}[${index}]`).join(" and "));
}

/** Positions in `data.chatModels` of the entries `select` picks out. */
function chatModelPositions(
  data: ModelCatalogData,
  select: (model: ModelCatalogData["chatModels"][number]) => boolean,
): readonly string[] {
  return data.chatModels.flatMap((model, index) =>
    select(model) ? [`chatModels[${index}]`] : []
  );
}

/**
 * Every failure below names positions in the generated tables, never a served
 * value: the values are the platform's data and the message is terminal output.
 */
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
export function assertCatalogInvariants(data: ModelCatalogData): void {
  // Every table the runtime reads by first match or through a Map: a key that
  // appears twice makes an entry unreachable rather than reporting itself.
  const runtimeId = (model: ChatModelEntry) => {
    const slashIndex = model.modelId.indexOf("/");
    const upstream = slashIndex > 0
      ? model.modelId.slice(slashIndex + 1)
      : model.modelId;
    return `${model.provider}/${upstream}`;
  };
  const uniqueKeyTables: ReadonlyArray<
    readonly [table: string, keys: readonly string[], message: string]
  > = [
    [
      "chatModels",
      data.chatModels.map((model) => model.id),
      "published id claimed by more than one model",
    ],
    [
      "chatModels",
      data.chatModels.map((model) => model.modelId),
      "model id claimed by more than one entry",
    ],
    // Two entries may differ in their raw ids and still be ONE model to the
    // runtime, which resolves a provider alias before it rebuilds the lookup
    // key as <canonical provider>/<upstream id> — the same key the capability
    // rows use. Publishing both would offer one model twice, with whichever
    // thinking default happened to be listed first.
    [
      "chatModels",
      data.chatModels.map(runtimeId),
      "entries collapse to one runtime model",
    ],
    [
      "providerAliases",
      data.providerAliases.map(([alias]) => alias),
      "provider alias mapped more than once",
    ],
    [
      "modelTransportCapabilities",
      data.modelTransportCapabilities.map(([modelId]) => modelId),
      "transport capabilities declared twice for",
    ],
    [
      "providerLabels",
      data.providerLabels.map(([provider]) => provider),
      "display label declared twice for",
    ],
    [
      "providerOrder",
      data.providerOrder,
      "provider listed twice in the display order",
    ],
    [
      "providerRouting",
      data.providerRouting.map(([provider]) => provider),
      "provider routing declared twice for",
    ],
    // This table is read through a Map too, so a surface declared twice keeps
    // one version and discards the other without saying which.
    [
      "surfaceGatewayApiVersions",
      data.surfaceGatewayApiVersions.map(([surface]) => surface),
      "gateway API version declared twice for",
    ],
  ];
  for (const [table, keys, message] of uniqueKeyTables) {
    const duplicates = describeDuplicatePositions(table, keys);
    if (duplicates.length > 0) fail(`${message}: ${duplicates.join(", ")}`);
  }

  // `resolveVeryfrontCloudModelId` reads a request as `alias ||
  // DEFAULT_VERYFRONT_CLOUD_MODEL_ID`, so an empty published id is
  // indistinguishable from no request and quietly resolves the default model.
  // Checking the published id covers both the served id and an `entryIds` row
  // the overlay left empty, which would otherwise pass every other invariant
  // while shipping a model nobody can select.
  const unselectable = chatModelPositions(data, (model) => model.id === "");
  if (unselectable.length > 0) {
    fail(
      `published id is empty, so the model resolves as the default instead: ${
        unselectable.join(", ")
      }`,
    );
  }

  // `resolveVeryfrontCloudModelId` matches a request against the model ids
  // first, and returns any remaining request that contains a slash as already
  // canonical, so it never reaches the lookup by published id. A published id
  // carrying a slash is therefore reachable only when it IS its own model id.
  const unreachable = chatModelPositions(
    data,
    (model) => model.id !== model.modelId && model.id.includes("/"),
  );
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
  const ungrouped = chatModelPositions(
    data,
    (model) => !ordered.has(model.provider),
  );
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
      `the default model names ${defaults.length} entries, not exactly one`,
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
 * The providers the served catalog lists, parsed once for the reports below:
 * `buildModelCatalogData` validates the same payload, and the reports read
 * the list rather than parsing again.
 */
export function listServedProviders(payload: unknown): readonly string[] {
  return parseServedCatalog(payload).providers;
}

/**
 * Listed providers with no chat model, as positions in the served `providers`
 * list (`providers[2]`; the values are served data). They get no display or
 * label row — see `buildModelCatalogData` — and are reported so a provider
 * that unexpectedly lost every chat model is noticed. The generated diff
 * shows the name.
 */
export function findListedProvidersWithoutModels(
  listedProviders: readonly string[],
  data: ModelCatalogData,
): readonly string[] {
  const ordered = new Set(data.providerOrder);
  return listedProviders.flatMap((provider, index) =>
    ordered.has(provider) ? [] : [`providers[${index}]`]
  );
}

/**
 * Listed providers the overlay declares no routing for, as positions in the
 * served `providers` list (`providers[2]`; the names are served values and
 * this list is printed). Walks the LISTED providers, not the display order: a
 * provider with no chat model has no display row but still routes its other
 * ids, on the default surface unless the overlay says otherwise, and that is
 * exactly where a wrong wire format would go unnoticed.
 */
export function findUnroutedProviders(
  listedProviders: readonly string[],
  overlay: ModelCatalogOverlay,
): readonly string[] {
  const routed = new Set(overlay.providerRouting.map(([provider]) => provider));
  return listedProviders.flatMap((provider, index) =>
    routed.has(provider) ? [] : [`providers[${index}]`]
  );
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
    " * read the diff, and open a pull request with it. Facts the served catalog",
    " * does not carry live in `scripts/build/model-catalog-overlay.ts`.",
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
    "/**",
    " * Provider display order. The order is user-visible. Literal, so the label",
    " * table below can be typed by exactly these providers.",
    " */",
    "export const VERYFRONT_CLOUD_PROVIDER_ORDER = Object.freeze([",
    ...data.providerOrder.map((provider) => `${quote(provider)},`),
    "] as const) satisfies readonly KnownVeryfrontCloudProviderId[];",
    "",
    "/**",
    " * Display label for each DISPLAYED provider: the providers in the display",
    " * order, not every known one. A known provider the catalog lists no chat",
    " * model for keeps its alias and routing rows but has no label row, and the",
    " * type says so rather than requiring one.",
    " */",
    "export const VERYFRONT_CLOUD_PROVIDER_LABELS: Readonly<",
    "  Record<(typeof VERYFRONT_CLOUD_PROVIDER_ORDER)[number], string>",
    "> = Object.freeze({",
    ...data.providerLabels.map(([provider, label]) =>
      `${objectKey(provider)}: ${quote(label)},`
    ),
    "});",
    "",
  ];
  return lines.join("\n");
}
