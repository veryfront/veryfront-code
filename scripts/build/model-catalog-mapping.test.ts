import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCatalogInvariants,
  buildModelCatalogData,
  findStaleOverlayKeys,
  findUnroutedProviders,
  type ModelCatalogData,
  renderModelCatalogModule,
} from "./model-catalog-mapping.ts";
import type { ModelCatalogOverlay } from "./model-catalog-overlay.ts";

/**
 * Every payload here is hand-built with obviously fake values. The real
 * catalog is not copied into this repository: the point of the allowlist is
 * that the generator never carries a field it was not told to carry, and a
 * fake payload proves that better than a real one.
 */

const OVERLAY: ModelCatalogOverlay = {
  providerRouting: [
    ["acme-labs", { surface: "openai", native: true }],
    ["beta-works", { surface: "openai" }],
  ],
  defaultSurface: "openai",
  gatewayPathPrefix: "ai/gateway",
  surfaceGatewayApiVersions: [["openai", "v1"], ["anthropic", "v1"]],
  defaultGatewayApiVersion: "v1",
  entryIds: [["acme-labs-api/mystery-1", "mystery"]],
  thinkingBudgetTokens: [
    ["acme-labs-api/mystery-1", 4096],
    // Served with `reasoning: false`, so this budget must not be emitted.
    ["beta-works/plain-3", 512],
  ],
  openAIChatReasoningWithFunctionTools: [["beta-works/riddle-9", false]],
  retainedTransportCapabilities: [
    ["acme-labs/gone-0", { anthropicThinkingMode: "adaptive" }],
    // Served and carrying a transport fact, so the served entry lands.
    ["beta-works/riddle-9", { openAITransport: "responses" }],
    // Served but carrying no transport fact at all. Still served, so the
    // retained entry is dropped rather than kept as a stale override.
    ["beta-works/plain-3", { anthropicThinkingMode: "adaptive" }],
  ],
};

/** Marker values that must never reach the generated module, whatever key carries them. */
const FORBIDDEN_MARKERS = [
  "host-a",
  "host-b",
  "region-a",
  "region-b",
  "tier-a",
  "jurisdiction-a",
  "precision-a",
  "precision-source-a",
  "certification-a",
  "retention-a",
  "surprise-field-a",
  "surprise-capability-a",
];

/** Key names that must never appear in the generated module. */
const FORBIDDEN_KEY_PATTERN =
  /deployment|host|region|tier|jurisdiction|quantization|precision/i;
const PRICE_KEY_PATTERN = /pric|cost|usd/i;
const OTHER_FORBIDDEN_KEY_PATTERN = /certification|retention|surprise/i;

function fakePricing(): Record<string, number> {
  return { inputUsdPer1M: 1, outputUsdPer1M: 2 };
}

function fakeDeployment(host: string, region: string): Record<string, unknown> {
  return {
    host,
    tier: "tier-a",
    jurisdiction: "jurisdiction-a",
    region,
    quantization: "precision-a",
    precisionSource: "precision-source-a",
    certifications: ["certification-a"],
    dataRetention: "retention-a",
    supportedProviderTools: ["web_search"],
    pricing: fakePricing(),
  };
}

/** A payload carrying every forbidden field class plus fields nothing names. */
function fakePayload(): Record<string, unknown> {
  return {
    models: [
      {
        id: "mystery-1",
        modelId: "acme-labs-api/mystery-1",
        provider: "acme-labs",
        providerLabel: "Acme Labs",
        providerLogoKey: "acme-labs",
        name: "Mystery 1",
        description: "A model that does not exist",
        aliases: ["mystery", "acme-labs-api/mystery-1"],
        capabilities: {
          thinking: true,
          reasoning: true,
          tool_call: true,
          temperature: false,
          open_weights: false,
          supported_parameters: ["max_tokens"],
          modalities: { input: ["text"] },
          limit: { output: 1024 },
          reasoning_mode: "adaptive",
          surpriseCapability: "surprise-capability-a",
        },
        temperature: null,
        supportedProviderTools: ["web_search"],
        pricing: fakePricing(),
        providerPricing: fakePricing(),
        pricingSources: { directProvider: "https://example.invalid/pricing" },
        deployments: [
          fakeDeployment("host-a", "region-a"),
          fakeDeployment("host-b", "region-b"),
        ],
        surpriseField: "surprise-field-a",
      },
      {
        id: "riddle-9",
        modelId: "beta-works/riddle-9",
        provider: "beta-works",
        providerLabel: "Beta Works",
        providerLogoKey: "beta-works",
        name: "Riddle 9",
        description: "Another model that does not exist",
        aliases: ["beta-works/riddle-9", "riddle-9"],
        capabilities: {
          thinking: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          open_weights: true,
          supported_parameters: ["max_tokens", "temperature"],
          modalities: { input: ["text"] },
          transport: "chat-completions",
        },
        temperature: { min: 0, max: 2 },
        supportedProviderTools: [],
        pricing: fakePricing(),
        providerPricing: fakePricing(),
        pricingSources: { directProvider: "https://example.invalid/pricing" },
        deployments: [fakeDeployment("host-a", "region-a")],
      },
      {
        id: "plain-3",
        modelId: "beta-works/plain-3",
        provider: "beta-works",
        providerLabel: "Beta Works",
        providerLogoKey: "beta-works",
        name: "Plain 3",
        description: "A model with no reasoning",
        aliases: ["beta-works/plain-3"],
        capabilities: {
          thinking: false,
          reasoning: false,
          tool_call: true,
          temperature: true,
          open_weights: true,
          supported_parameters: ["max_tokens"],
          modalities: { input: ["text"] },
          reasoning_mode: "surprise-capability-a",
          transport: "surprise-capability-a",
        },
        temperature: { min: 0, max: 1 },
        supportedProviderTools: [],
        pricing: fakePricing(),
        providerPricing: fakePricing(),
        pricingSources: { directProvider: "https://example.invalid/pricing" },
        deployments: [fakeDeployment("host-b", "region-b")],
      },
      {
        // Carries `reasoning` and no `thinking` key at all.
        id: "quiet-7",
        modelId: "beta-works/quiet-7",
        provider: "beta-works",
        providerLabel: "Beta Works",
        providerLogoKey: "beta-works",
        name: "Quiet 7",
        description: "A model served without the older flag",
        aliases: ["beta-works/quiet-7"],
        capabilities: {
          reasoning: true,
          tool_call: true,
          temperature: true,
          open_weights: true,
          supported_parameters: ["max_tokens"],
          modalities: { input: ["text"] },
        },
        temperature: { min: 0, max: 1 },
        supportedProviderTools: [],
        pricing: fakePricing(),
        providerPricing: fakePricing(),
        pricingSources: { directProvider: "https://example.invalid/pricing" },
        deployments: [fakeDeployment("host-a", "region-a")],
      },
      {
        // The two spellings disagree. `reasoning` is the one that counts.
        id: "loud-8",
        modelId: "beta-works/loud-8",
        provider: "beta-works",
        providerLabel: "Beta Works",
        providerLogoKey: "beta-works",
        name: "Loud 8",
        description: "A model whose older flag contradicts the served one",
        aliases: ["beta-works/loud-8"],
        capabilities: {
          thinking: true,
          reasoning: false,
          tool_call: true,
          temperature: true,
          open_weights: true,
          supported_parameters: ["max_tokens"],
          modalities: { input: ["text"] },
        },
        temperature: { min: 0, max: 1 },
        supportedProviderTools: [],
        pricing: fakePricing(),
        providerPricing: fakePricing(),
        pricingSources: { directProvider: "https://example.invalid/pricing" },
        deployments: [fakeDeployment("host-b", "region-b")],
      },
    ],
    providers: ["acme-labs", "beta-works"],
    defaultModelId: "beta-works/riddle-9",
    surpriseTopLevel: "surprise-field-a",
  };
}

/** Every key name reachable from a value, so a leaked field is caught by name too. */
function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

describe("scripts/build/model-catalog-mapping", () => {
  it("maps the allowlisted served fields onto the catalog entries", () => {
    const data = buildModelCatalogData(fakePayload(), OVERLAY);

    assertEquals(data.chatModels, [
      {
        // The served ID is replaced by the short entry ID the overlay names.
        id: "mystery",
        modelId: "acme-labs-api/mystery-1",
        provider: "acme-labs",
        name: "Mystery 1",
        description: "A model that does not exist",
        thinkingBudgetTokens: 4096,
      },
      {
        id: "riddle-9",
        modelId: "beta-works/riddle-9",
        provider: "beta-works",
        name: "Riddle 9",
        description: "Another model that does not exist",
        thinking: true,
      },
      {
        id: "plain-3",
        modelId: "beta-works/plain-3",
        provider: "beta-works",
        name: "Plain 3",
        description: "A model with no reasoning",
      },
      {
        id: "quiet-7",
        modelId: "beta-works/quiet-7",
        provider: "beta-works",
        name: "Quiet 7",
        description: "A model served without the older flag",
        thinking: true,
      },
      {
        id: "loud-8",
        modelId: "beta-works/loud-8",
        provider: "beta-works",
        name: "Loud 8",
        description: "A model whose older flag contradicts the served one",
      },
    ]);
    assertEquals(data.defaultModelId, "riddle-9");
    assertEquals(data.providerOrder, ["acme-labs", "beta-works"]);
    assertEquals(data.providerLabels, [
      ["acme-labs", "Acme Labs"],
      ["beta-works", "Beta Works"],
    ]);
    // A model ID prefix that differs from the canonical provider is an alias.
    assertEquals(data.providerAliases, [
      ["acme-labs", "acme-labs"],
      ["acme-labs-api", "acme-labs"],
      ["beta-works", "beta-works"],
    ]);
  });

  it("takes the reasoning fact from the served name, not from the older spelling", () => {
    const byId = new Map(
      buildModelCatalogData(fakePayload(), OVERLAY).chatModels.map((
        model,
      ) => [model.id, model]),
    );

    // Served as `reasoning` with no `thinking` key anywhere on the model.
    assertEquals(byId.get("quiet-7")?.thinking, true);
    // `thinking: true` with `reasoning: false`: the served name decides.
    assertEquals(byId.get("loud-8")?.thinking, undefined);
  });

  it("emits a thinking budget only while the served catalog says the model reasons", () => {
    // The overlay says how much a model may think, never whether it thinks.
    const entryFor = (reasoning: boolean) => {
      const payload = fakePayload();
      const models = payload.models as Record<string, unknown>[];
      const served = models.find((model) =>
        model.modelId === "beta-works/plain-3"
      );
      served!.capabilities = {
        ...served!.capabilities as Record<string, unknown>,
        reasoning,
      };
      return buildModelCatalogData(payload, OVERLAY).chatModels.find((model) =>
        model.id === "plain-3"
      );
    };

    const off = entryFor(false);
    assertEquals(off?.thinkingBudgetTokens, undefined);
    assertEquals(off?.thinking, undefined);

    const on = entryFor(true);
    assertEquals(on?.thinkingBudgetTokens, 512);
  });

  it("carries the served transport facts and the overlay facts, and drops unknown values", () => {
    const data = buildModelCatalogData(fakePayload(), OVERLAY);

    assertEquals(data.modelTransportCapabilities, [
      // Retained first: the catalog stopped serving it, the package still
      // resolves it. A retained entry for a served model is ignored.
      ["acme-labs/gone-0", { anthropicThinkingMode: "adaptive" }],
      ["acme-labs-api/mystery-1", { anthropicThinkingMode: "adaptive" }],
      ["beta-works/riddle-9", {
        openAITransport: "chat-completions",
        openAIChatReasoningWithFunctionTools: false,
      }],
      // `plain-3` declares a reasoning mode and a transport this package does
      // not build requests for, so it contributes no entry at all.
    ]);
  });

  it("drops every forbidden field class and every unknown field", () => {
    const data = buildModelCatalogData(fakePayload(), OVERLAY);
    const rendered = renderModelCatalogModule(data);
    const serialized = JSON.stringify(data);

    for (const marker of FORBIDDEN_MARKERS) {
      assertEquals(
        serialized.includes(marker),
        false,
        `"${marker}" reached the catalog data`,
      );
      assertEquals(
        rendered.includes(marker),
        false,
        `"${marker}" reached the generated module`,
      );
    }

    for (const key of collectKeys(data, new Set())) {
      assertEquals(
        FORBIDDEN_KEY_PATTERN.test(key) || PRICE_KEY_PATTERN.test(key) ||
          OTHER_FORBIDDEN_KEY_PATTERN.test(key),
        false,
        `the catalog data carries a "${key}" field`,
      );
    }
    for (
      const pattern of [
        FORBIDDEN_KEY_PATTERN,
        PRICE_KEY_PATTERN,
        OTHER_FORBIDDEN_KEY_PATTERN,
      ]
    ) {
      assertEquals(
        pattern.test(rendered),
        false,
        `the generated module matches ${pattern}`,
      );
    }
  });

  it("succeeds for an unknown vendor, an unknown capability key and several deployments", () => {
    // Nothing in the fake payload is a vendor this package lists, one model
    // declares capability keys nothing names, and one carries two deployments.
    const data = buildModelCatalogData(fakePayload(), OVERLAY);

    assertEquals(data.chatModels.length, 5);
    assertEquals(renderModelCatalogModule(data).length > 0, true);
  });

  it("routes a provider the overlay does not list on the default surface, and reports it", () => {
    const overlay: ModelCatalogOverlay = { ...OVERLAY, providerRouting: [] };
    const data = buildModelCatalogData(fakePayload(), overlay);

    assertEquals(data.providerRouting, [
      ["acme-labs", { surface: "openai" }],
      ["beta-works", { surface: "openai" }],
    ]);
    assertEquals(findUnroutedProviders(data, overlay), [
      "acme-labs",
      "beta-works",
    ]);
    assertEquals(findUnroutedProviders(data, OVERLAY), []);
  });

  it("produces the same module text on every run over the same payload", () => {
    const first = renderModelCatalogModule(
      buildModelCatalogData(fakePayload(), OVERLAY),
    );
    const second = renderModelCatalogModule(
      buildModelCatalogData(fakePayload(), OVERLAY),
    );

    assertEquals(first, second);
    // No timestamp and no run identifier can make two runs differ.
    assertEquals(/\d{4}-\d{2}-\d{2}/.test(first), false);
  });

  it("marks the module as generated and says how to regenerate it", () => {
    const rendered = renderModelCatalogModule(
      buildModelCatalogData(fakePayload(), OVERLAY),
    );

    assertStringIncludes(rendered, "Generated file. Do not edit by hand");
    assertStringIncludes(rendered, "deno task generate:model-catalog");
  });

  it("keeps the exports and the declaration order of the data module", () => {
    const rendered = renderModelCatalogModule(
      buildModelCatalogData(fakePayload(), OVERLAY),
    );
    const exported = [...rendered.matchAll(/^export (?:const|type) (\w+)/gm)]
      .map(([, name]) => name);

    assertEquals(exported, [
      "VeryfrontCloudProviderRouting",
      "VeryfrontCloudModelTransportCapabilities",
      "DEFAULT_VERYFRONT_CLOUD_MODEL_ID",
      "VERYFRONT_CLOUD_PROVIDER_ALIASES",
      "VERYFRONT_CLOUD_PROVIDER_ROUTING",
      "DEFAULT_VERYFRONT_CLOUD_SURFACE",
      "VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX",
      "VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS",
      "DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION",
      "VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES",
      "VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES",
      "VERYFRONT_CLOUD_PROVIDER_LABELS",
      "VERYFRONT_CLOUD_PROVIDER_ORDER",
    ]);
  });

  it("fails loudly on a payload that cannot describe a usable catalog", () => {
    assertThrows(
      () => buildModelCatalogData(null, OVERLAY),
      Error,
      "not a JSON object",
    );
    assertThrows(
      () =>
        buildModelCatalogData(
          {
            models: [],
            providers: ["acme-labs"],
            defaultModelId: "acme-labs/none",
          },
          OVERLAY,
        ),
      Error,
      "lists no model",
    );
    assertThrows(
      () => buildModelCatalogData({ models: [], providers: [] }, OVERLAY),
      Error,
      "is missing defaultModelId",
    );

    const missingDefault = {
      ...fakePayload(),
      defaultModelId: "acme-labs-api/not-served",
    };
    assertThrows(
      () => buildModelCatalogData(missingDefault, OVERLAY),
      Error,
      "is not one of the served models",
    );

    // A listed entry missing an identity field is a broken payload, not a
    // removal: dropping it would produce a pull request deleting a model the
    // platform still serves.
    const malformed = fakePayload();
    delete (malformed.models as Record<string, unknown>[])[1].name;
    assertThrows(
      () => buildModelCatalogData(malformed, OVERLAY),
      Error,
      'model "riddle-9" is missing',
    );

    // A present value of the wrong type says so, rather than being reported
    // as absent or quietly coerced.
    const untyped = fakePayload();
    (untyped.models as Record<string, unknown>[])[2].modelId = 42;
    assertThrows(
      () => buildModelCatalogData(untyped, OVERLAY),
      Error,
      'model "plain-3" modelId must be a string, not a number',
    );
  });

  it("omits a listed provider that serves no model, rather than failing", () => {
    // The platform may list a provider with nothing routable right now. That
    // is not a broken payload: the provider simply contributes no group.
    const payload = {
      ...fakePayload(),
      providers: ["acme-labs", "beta-works", "ghost-co"],
    };

    const data = buildModelCatalogData(payload, OVERLAY);

    assertEquals(data.providerOrder, ["acme-labs", "beta-works"]);
    assertEquals(
      data.providerLabels.some(([provider]) => provider === "ghost-co"),
      false,
    );
    assertEquals(
      data.providerAliases.some(([, provider]) => provider === "ghost-co"),
      false,
    );
    assertEquals(
      data.providerRouting.some(([provider]) => provider === "ghost-co"),
      false,
    );
  });

  it("rejects a model whose provider the catalog does not list", () => {
    const payload = fakePayload();
    (payload.models as Record<string, unknown>[])[1].provider = "unlisted-co";

    assertThrows(
      () => buildModelCatalogData(payload, OVERLAY),
      Error,
      "not in the provider order",
    );
  });

  /**
   * Model ids the runtime cannot take a provider from. A generated entry
   * carrying one of these is published but unroutable, because
   * `resolveVeryfrontCloudProviderFromModelId` returns undefined for it.
   */
  const UNROUTABLE_MODEL_IDS = [
    "no-slash-at-all",
    "/leading-slash",
    // `normalizeVeryfrontCloudModelId` strips this prefix, leaving no segment.
    "veryfront-cloud/already-prefixed",
    // The runtime requires a lowercase path segment.
    "UPPER/case",
    "under_score/x",
    // Reserved, so a provider segment can never collide with an object member.
    "prototype/x",
    "constructor/x",
    // `parseVeryfrontCloudModelId` needs a non-empty, already-trimmed segment
    // after the provider.
    "openai/",
    "openai/ model",
    "openai/model ",
  ];

  for (const modelId of UNROUTABLE_MODEL_IDS) {
    it(`rejects a model id the runtime cannot route: ${modelId}`, () => {
      const payload = fakePayload();
      (payload.models as Record<string, unknown>[])[1].modelId = modelId;
      assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        'model "riddle-9" modelId',
      );
    });
  }

  it("accepts the model ids the runtime can take a provider from", () => {
    for (
      const modelId of [
        "beta-works-api/other-1",
        "beta.works/riddle-9",
        "a1/b2",
        // Nothing constrains the characters of an upstream id, and nothing
        // here may: these are ordinary upstream shapes.
        "beta-works/family/model:v1",
        "beta-works/ns:model@2026-01-01",
      ]
    ) {
      const payload = fakePayload();
      (payload.models as Record<string, unknown>[])[1].modelId = modelId;
      // The default names this model by its id, so it moves with it.
      payload.defaultModelId = modelId;

      const data = buildModelCatalogData(payload, OVERLAY);

      assertEquals(
        data.chatModels.some((model) => model.modelId === modelId),
        true,
      );
    }
  });

  it("rejects a present capabilities value that is not an object", () => {
    for (const capabilities of ["a string", ["an array"], null, 7]) {
      const payload = fakePayload();
      (payload.models as Record<string, unknown>[])[1].capabilities =
        capabilities;
      assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        'model "riddle-9" capabilities',
      );
    }
  });

  /**
   * Every field the generator reads, with a value of the wrong type. A field
   * the generator consumes must be absent where it is optional, or carry the
   * type it is read as. Nothing consumed may be silently coerced, because a
   * coerced value produces an ordinary-looking removal.
   */
  const WRONG_TYPED_READS: ReadonlyArray<
    readonly [path: string, apply: (payload: Record<string, unknown>) => void]
  > = [
    ["models", (p) => p.models = "not an array"],
    ["models[0]", (p) => (p.models as unknown[])[0] = "not an object"],
    ["providers", (p) => p.providers = "not an array"],
    ["providers[0]", (p) => (p.providers as unknown[])[0] = 7],
    ["defaultModelId", (p) => p.defaultModelId = 7],
    ["id", (p) => (p.models as Record<string, unknown>[])[1].id = 7],
    ["modelId", (p) => (p.models as Record<string, unknown>[])[1].modelId = 7],
    [
      "provider",
      (p) => (p.models as Record<string, unknown>[])[1].provider = 7,
    ],
    ["name", (p) => (p.models as Record<string, unknown>[])[1].name = 7],
    [
      "description",
      (p) => (p.models as Record<string, unknown>[])[1].description = { a: 1 },
    ],
    [
      "providerLabel",
      (p) => (p.models as Record<string, unknown>[])[1].providerLabel = 7,
    ],
    [
      "capabilities",
      (p) => (p.models as Record<string, unknown>[])[1].capabilities = "x",
    ],
    [
      "capabilities.reasoning",
      (p) =>
        ((p.models as Record<string, unknown>[])[1].capabilities as Record<
          string,
          unknown
        >)
          .reasoning = "yes",
    ],
    [
      "capabilities.reasoning_mode",
      (p) =>
        ((p.models as Record<string, unknown>[])[1].capabilities as Record<
          string,
          unknown
        >)
          .reasoning_mode = 7,
    ],
    [
      "capabilities.transport",
      (p) =>
        ((p.models as Record<string, unknown>[])[1].capabilities as Record<
          string,
          unknown
        >)
          .transport = ["responses"],
    ],
  ];

  for (const [path, apply] of WRONG_TYPED_READS) {
    it(`fails when ${path} carries the wrong type`, () => {
      const payload = fakePayload();
      apply(payload);
      assertThrows(() => buildModelCatalogData(payload, OVERLAY), Error);
    });
  }

  it("still generates for unknown keys, vendors, values and extra top-level fields", () => {
    const payload = fakePayload();
    payload.anotherSurpriseTopLevel = { nested: true };
    const models = payload.models as Record<string, unknown>[];
    const capabilities = models[1].capabilities as Record<string, unknown>;
    // An unknown capability key, an unknown transport value, and a vendor this
    // package does not list are all things the platform may legitimately add.
    capabilities.somethingNew = { nested: ["values"] };
    capabilities.transport = "a-transport-from-the-future";

    const data = buildModelCatalogData(payload, OVERLAY);

    assertEquals(data.chatModels.length, 5);
    assertEquals(
      data.modelTransportCapabilities.some(([id]) =>
        id === "beta-works/riddle-9"
      ),
      true,
    );
    // The unknown transport value is dropped, the overlay fact for it remains.
    assertEquals(
      data.modelTransportCapabilities.find(([id]) =>
        id === "beta-works/riddle-9"
      )?.[1],
      { openAIChatReasoningWithFunctionTools: false },
    );
  });

  /**
   * Each row breaks exactly one precondition of a lookup in
   * `src/provider/veryfront-cloud/model-catalog.ts`. The generated data has to
   * satisfy them all, because every one of those lookups resolves by first
   * match or through a Map, so a duplicate makes an entry unreachable rather
   * than reporting itself.
   */
  const BROKEN_INVARIANTS: ReadonlyArray<
    readonly [
      name: string,
      apply: (data: ModelCatalogData) => ModelCatalogData,
      message: string,
    ]
  > = [
    [
      "a published id claimed twice",
      (data) => ({
        ...data,
        chatModels: [...data.chatModels, {
          ...data.chatModels[0],
          modelId: "beta-works/other",
        }],
      }),
      "published id",
    ],
    [
      "a model id claimed twice",
      (data) => ({
        ...data,
        chatModels: [...data.chatModels, {
          ...data.chatModels[0],
          id: "another-id",
        }],
      }),
      "model id",
    ],
    [
      "a provider alias claimed twice",
      (data) => ({
        ...data,
        providerAliases: [...data.providerAliases, ["acme-labs", "beta-works"]],
      }),
      "provider alias",
    ],
    [
      "a transport capability keyed twice",
      (data) => ({
        ...data,
        modelTransportCapabilities: [
          ...data.modelTransportCapabilities,
          ["beta-works/riddle-9", { openAITransport: "responses" }],
        ],
      }),
      "transport capabilities",
    ],
    [
      "a routing entry keyed twice",
      (data) => ({
        ...data,
        providerRouting: [...data.providerRouting, ["acme-labs", {
          surface: "openai",
        }]],
      }),
      "provider routing",
    ],
    [
      "a model whose provider is not in the provider order",
      (data) => ({
        ...data,
        providerOrder: data.providerOrder.filter((p) => p !== "beta-works"),
      }),
      "not in the provider order",
    ],
    [
      "a published id that carries a slash without being the model id",
      (data) => ({
        ...data,
        chatModels: data.chatModels.map((model, index) =>
          index === 0 ? { ...model, id: "acme-labs/mystery" } : model
        ),
      }),
      "never resolves",
    ],
    [
      "a default that names no entry",
      (data) => ({ ...data, defaultModelId: "not-a-published-id" }),
      "default model",
    ],
    [
      "a gateway API version declared twice for one surface",
      (data) => ({
        ...data,
        surfaceGatewayApiVersions: [
          ...data.surfaceGatewayApiVersions,
          ["openai", "v2"],
        ],
      }),
      "gateway API version declared twice",
    ],
    [
      "a routed surface with no gateway API version",
      // Only the surface changes, so every provider keeps its place and this
      // breaks the version rule and nothing else.
      (data) => ({
        ...data,
        providerRouting: data.providerRouting.map(([provider]) =>
          [provider, { surface: "a-new-surface" }] as const
        ),
      }),
      "gateway API version",
    ],
    [
      "a default surface with no gateway API version",
      (data) => ({ ...data, defaultSurface: "a-new-surface" }),
      "gateway API version",
    ],
  ];

  for (const [name, apply, message] of BROKEN_INVARIANTS) {
    it(`rejects generated data with ${name}`, () => {
      const data = buildModelCatalogData(fakePayload(), OVERLAY);
      assertThrows(() => assertCatalogInvariants(apply(data)), Error, message);
    });
  }

  it("accepts the data generated from a well-formed payload", () => {
    const data = buildModelCatalogData(fakePayload(), OVERLAY);

    assertCatalogInvariants(data);
  });

  it("reports an overlay row that no longer refers to anything served", () => {
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      thinkingBudgetTokens: [...OVERLAY.thinkingBudgetTokens, [
        "beta-works/withdrawn",
        256,
      ]],
      entryIds: [...OVERLAY.entryIds, ["beta-works/also-gone", "gone"]],
    };
    const data = buildModelCatalogData(fakePayload(), overlay);

    // A stale row is reported, not fatal: a vendor withdrawing a model must
    // not stop the catalog syncing until someone prunes the overlay.
    assertEquals(findStaleOverlayKeys(data, overlay), [
      'entryIds "beta-works/also-gone"',
      'thinkingBudgetTokens "beta-works/withdrawn"',
    ]);
    // A retained row names a model that is deliberately not served.
    assertEquals(findStaleOverlayKeys(data, OVERLAY), []);
  });

  it("holds only the fields the allowlist names", () => {
    const data: ModelCatalogData = buildModelCatalogData(
      fakePayload(),
      OVERLAY,
    );

    assertEquals(Object.keys(data), [
      "defaultModelId",
      "providerAliases",
      "providerRouting",
      "defaultSurface",
      "gatewayPathPrefix",
      "surfaceGatewayApiVersions",
      "defaultGatewayApiVersion",
      "modelTransportCapabilities",
      "chatModels",
      "providerLabels",
      "providerOrder",
    ]);
    assertEquals([...collectKeys(data.chatModels, new Set())].sort(), [
      "description",
      "id",
      "modelId",
      "name",
      "provider",
      "thinking",
      "thinkingBudgetTokens",
    ]);
  });
});
