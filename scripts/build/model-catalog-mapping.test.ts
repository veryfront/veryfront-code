import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCatalogInvariants,
  assertOverlayInvariants,
  buildModelCatalogData,
  compareCodePoints,
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
  // Keyed by the CANONICAL id: mystery-1 is served as `acme-labs-api/mystery-1`
  // (an alias prefix), so these rows also prove the lookup normalizes the key.
  entryIds: [["acme-labs/mystery-1", "mystery"]],
  thinkingBudgetTokens: [
    ["acme-labs/mystery-1", 4096],
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
  retainedProviderAliases: [],
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

  it("emits the adaptive thinking mode only for a provider on the Anthropic surface", () => {
    // The runtime reads `anthropicThinkingMode` only when it builds Anthropic
    // provider options; on another surface the flag would suppress the
    // generic reasoning option and leave the model without thinking at all.
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      providerRouting: [
        ["acme-labs", { surface: "anthropic", native: true }],
        ["beta-works", { surface: "openai" }],
      ],
    };
    const onAnthropic = buildModelCatalogData(fakePayload(), overlay);
    // Keyed by the canonical provider, not by the alias the model is
    // published under: the package resolves the prefix to the canonical
    // provider before it looks the transport facts up.
    assertEquals(
      new Map(onAnthropic.modelTransportCapabilities).get(
        "acme-labs/mystery-1",
      ),
      { anthropicThinkingMode: "adaptive" },
    );
    const onOpenAI = buildModelCatalogData(fakePayload(), OVERLAY);
    assertEquals(
      new Map(onOpenAI.modelTransportCapabilities).get("acme-labs/mystery-1"),
      undefined,
    );
  });

  it("carries the served transport facts and the overlay facts, and drops unknown values", () => {
    const data = buildModelCatalogData(fakePayload(), OVERLAY);

    assertEquals(data.modelTransportCapabilities, [
      // Retained first: the catalog stopped serving it, the package still
      // resolves it. A retained entry for a served model is ignored.
      ["acme-labs/gone-0", { anthropicThinkingMode: "adaptive" }],
      // `mystery-1` reports an adaptive reasoning mode, but acme-labs routes
      // over the OpenAI surface, where that fact has no reading; see the
      // Anthropic-surface case below for the entry it contributes there.
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
      "providers[0]",
      "providers[1]",
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
      // The order precedes the labels: the label table is typed by the
      // providers the order lists.
      "VERYFRONT_CLOUD_PROVIDER_ORDER",
      "VERYFRONT_CLOUD_PROVIDER_LABELS",
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
      "models[1] is missing",
    );

    // A present value of the wrong type says so, rather than being reported
    // as absent or quietly coerced.
    // The platform declares the display label required, so an absent one is a
    // broken payload. Treating it as optional would let a missing label look
    // like a missing provider and drop models that are still listed.
    const unlabelledModel = fakePayload();
    delete (unlabelledModel.models as Record<string, unknown>[])[1]
      .providerLabel;
    assertThrows(
      () => buildModelCatalogData(unlabelledModel, OVERLAY),
      Error,
      "models[1] is missing providerLabel",
    );

    const untyped = fakePayload();
    (untyped.models as Record<string, unknown>[])[2].modelId = 42;
    assertThrows(
      () => buildModelCatalogData(untyped, OVERLAY),
      Error,
      "models[2] modelId must be a string, not a number",
    );
  });

  it("rejects a listed provider that serves no model", () => {
    // The platform derives its provider list from the models it serves, so
    // this state cannot come from a correct payload.
    const payload = {
      ...fakePayload(),
      providers: ["acme-labs", "beta-works", "ghost-co"],
    };

    assertThrows(
      () => buildModelCatalogData(payload, OVERLAY),
      Error,
      "listed provider serves no model: providers[2]",
    );
  });

  // The served provider is not only routed through: it is rendered as a key of
  // the generated provider tables. `__proto__` is the sharp case -- as a key of
  // an object literal it sets the prototype instead of adding an entry, so the
  // row would vanish from the built table rather than fail.
  const UNUSABLE_PROVIDERS = [
    "__proto__",
    "constructor",
    "toString",
    "prototype",
    "veryfront-cloud",
    "Acme-Labs",
    "acme labs",
    "acme_labs",
  ];

  for (const provider of UNUSABLE_PROVIDERS) {
    it(`rejects a served provider the generated tables cannot carry: "${provider}"`, () => {
      const payload = fakePayload();
      (payload.models as Record<string, unknown>[])[1].provider = provider;

      assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        "models[1] provider",
      );
    });

    it(`rejects a listed provider the generated tables cannot carry: "${provider}"`, () => {
      const payload = {
        ...fakePayload(),
        providers: ["acme-labs", "beta-works", provider],
      };

      assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        "providers[2]",
      );
    });
  }

  it("names a refused entry by position, never by a served value", () => {
    // These messages reach the terminal. A payload that is valid JSON but
    // carries a malformed entry must not get the entry's own values echoed
    // back: the value that just failed validation is exactly the one not to
    // print, and the id beside it is served data too.
    const sentinel = "SERVED-VALUE-MUST-NOT-PRINT";
    const cases: ReadonlyArray<(model: Record<string, unknown>) => void> = [
      (model) => {
        model.id = sentinel;
        delete model.modelId;
      },
      (model) => model.modelId = `${sentinel}-no-slash`,
      (model) => model.modelId = `${sentinel.toUpperCase()}/x`,
      (model) => model.provider = sentinel,
      (model) => model.capabilities = sentinel,
    ];
    for (const apply of cases) {
      const payload = fakePayload();
      apply((payload.models as Record<string, unknown>[])[1]);
      const error = assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        "models[1]",
      ) as Error;
      assertEquals(error.message.includes(sentinel), false);
      assertEquals(error.message.includes(sentinel.toUpperCase()), false);
    }

    const listed = {
      ...fakePayload(),
      providers: ["acme-labs", "beta-works", sentinel],
    };
    const listedError = assertThrows(
      () => buildModelCatalogData(listed, OVERLAY),
      Error,
      "providers[2]",
    ) as Error;
    assertEquals(listedError.message.includes(sentinel), false);

    const unservedDefault = {
      ...fakePayload(),
      defaultModelId: `beta-works/${sentinel}`,
    };
    const defaultError = assertThrows(
      () => buildModelCatalogData(unservedDefault, OVERLAY),
      Error,
      "the default model is not one of the served models",
    ) as Error;
    assertEquals(defaultError.message.includes(sentinel), false);
  });

  it("rejects a served provider that is empty before it reaches the shape rule", () => {
    // The allowlist requires the field, so an empty name is named as missing
    // rather than reported as the wrong shape.
    const payload = fakePayload();
    (payload.models as Record<string, unknown>[])[1].provider = "";

    assertThrows(
      () => buildModelCatalogData(payload, OVERLAY),
      Error,
      "models[1] is missing provider",
    );
  });

  it("rejects an overlay thinking budget the runtime would ignore", () => {
    // The runtime reads a budget only when it is a positive safe integer, so
    // anything else is generated, published and then never applied.
    for (
      const budget of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]
    ) {
      assertThrows(
        () =>
          assertOverlayInvariants({
            ...OVERLAY,
            thinkingBudgetTokens: [["acme-labs/mystery-1", budget]],
          }),
        Error,
        "which the runtime ignores",
      );
    }
  });

  it("accepts the overlay thinking budgets the runtime applies", () => {
    assertOverlayInvariants({
      ...OVERLAY,
      thinkingBudgetTokens: [["acme-labs/mystery-1", 1]],
    });
  });

  it("rejects models of one provider that disagree about its display label", () => {
    const payload = fakePayload();
    (payload.models as Record<string, unknown>[])[2].providerLabel =
      "Beta Works Ltd";

    assertThrows(
      () => buildModelCatalogData(payload, OVERLAY),
      Error,
      "conflicting display labels",
    );
  });

  it("rejects gateway path components the runtime would interpolate into a wrong URL", () => {
    for (
      const prefix of [
        "",
        "/ai/gateway",
        "ai/gateway/",
        "ai//gateway",
        "ai/../gateway",
        "ai gateway",
        // `URL.pathname` turns the backslash into a slash: two segments.
        "ai\\gateway",
        // `URL.pathname` decodes and then removes the dot segment.
        "ai/%2e%2e/gateway",
        // `URL.pathname` rewrites these to `%3F` / `%23`; a route with them
        // would target an endpoint that does not exist.
        "ai/gateway?x",
        "ai#gateway",
        "ai/gätewäy",
      ]
    ) {
      assertThrows(
        () =>
          assertOverlayInvariants({ ...OVERLAY, gatewayPathPrefix: prefix }),
        Error,
        "overlay gatewayPathPrefix",
      );
    }
    for (
      const version of [
        "",
        "v1/",
        "v1/beta",
        " v1",
        "v1\\beta",
        "%2E%2e",
        "v%31",
        "v1?beta",
        "v1#beta",
      ]
    ) {
      assertThrows(
        () =>
          assertOverlayInvariants({
            ...OVERLAY,
            surfaceGatewayApiVersions: [["openai", version], [
              "anthropic",
              "v1",
            ]],
          }),
        Error,
        "overlay gateway API version for openai",
      );
      assertThrows(
        () =>
          assertOverlayInvariants({
            ...OVERLAY,
            defaultGatewayApiVersion: version,
          }),
        Error,
        "overlay gateway API version for (default)",
      );
    }
    // The real overlay and the fixture pass.
    assertOverlayInvariants(OVERLAY);
  });

  it("rejects two entries that the runtime would resolve to one model", () => {
    // `google/foo` and `google-ai-studio/foo` with provider `google` differ as
    // raw ids but the runtime normalises the alias and sends both to the same
    // model; publishing both offers one model twice.
    const payload = fakePayload();
    const models = payload.models as Record<string, unknown>[];
    const twin = JSON.parse(JSON.stringify(models[0])) as Record<
      string,
      unknown
    >;
    twin.id = `${models[0]!.id as string}-twin`;
    twin.modelId = `${models[0]!.provider as string}/${
      (models[0]!.modelId as string).split("/")[1]
    }`;
    payload.models = [...models, twin];

    // With the overlay's published id for this canonical model, the twin would
    // trip the published-id invariant first; without it, the collision alone.
    assertThrows(
      () => buildModelCatalogData(payload, { ...OVERLAY, entryIds: [] }),
      Error,
      "collapse to one runtime model",
    );
  });

  it("rejects an overlay table that declares a key twice", () => {
    for (
      const overlay of [
        {
          ...OVERLAY,
          entryIds: [...OVERLAY.entryIds, ["acme-labs/mystery-1", "other"]],
        },
        {
          ...OVERLAY,
          thinkingBudgetTokens: [...OVERLAY.thinkingBudgetTokens, [
            "beta-works/plain-3",
            8,
          ]],
        },
        {
          ...OVERLAY,
          providerRouting: [...OVERLAY.providerRouting, ["acme-labs", {
            surface: "openai",
          }]],
        },
        {
          ...OVERLAY,
          retainedProviderAliases: [["acme", "acme-labs"], [
            "acme",
            "acme-labs",
          ]],
        },
      ] as ModelCatalogOverlay[]
    ) {
      assertThrows(
        () => buildModelCatalogData(fakePayload(), overlay),
        Error,
        "declares a key twice",
      );
    }
  });

  it("rejects an overlay that publishes one id for several models", () => {
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      entryIds: [...OVERLAY.entryIds, ["beta-works/riddle-9", "mystery"]],
    };

    assertThrows(
      () => buildModelCatalogData(fakePayload(), overlay),
      Error,
      "publishes one id for several models",
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
        "models[1] modelId",
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

  it("keeps a provider's routing when only a retained model of it remains", () => {
    // The catalog stops serving every acme-labs model. The overlay still
    // retains acme-labs/gone-0's transport row, so that model still resolves —
    // and must keep resolving on its own surface, not the default one.
    const payload = fakePayload();
    const models = (payload.models as Record<string, unknown>[]).filter(
      (model) => model.provider !== "acme-labs",
    );
    payload.models = models;
    payload.providers = (payload.providers as string[]).filter(
      (provider) => provider !== "acme-labs",
    );
    payload.defaultModelId = models[0]!.modelId;

    const data = buildModelCatalogData(payload, OVERLAY);

    assertEquals(data.providerOrder.includes("acme-labs"), false);
    assertEquals(
      data.modelTransportCapabilities.some(([id]) => id === "acme-labs/gone-0"),
      true,
    );
    const routing = new Map(data.providerRouting);
    assertEquals(routing.get("acme-labs"), { surface: "openai", native: true });
    // Served providers keep their position; the retained one follows.
    assertEquals(
      data.providerRouting.map(([provider]) => provider),
      [...data.providerOrder, "acme-labs"],
    );
  });

  it("keeps an alias the overlay retains after the catalog stops spelling it", () => {
    // Today the catalog serves mystery-1 as `acme-labs-api/mystery-1`, which
    // implies the alias. Once every acme-labs model is served under the
    // canonical prefix, the derivation has nothing to read — but callers who
    // send `acme-labs-api/...` are a contract, so the overlay keeps the row.
    const payload = fakePayload();
    for (const model of payload.models as Record<string, unknown>[]) {
      if (model.provider !== "acme-labs") continue;
      model.modelId = (model.modelId as string).replace(
        /^acme-labs-api\//,
        "acme-labs/",
      );
    }
    const withoutRetention = buildModelCatalogData(payload, OVERLAY);
    assertEquals(
      withoutRetention.providerAliases.some(([alias]) =>
        alias === "acme-labs-api"
      ),
      false,
    );

    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      retainedProviderAliases: [["acme-labs-api", "acme-labs"], [
        "acme",
        "acme-labs",
      ]],
    };
    const data = buildModelCatalogData(payload, overlay);
    // One sorted group per provider, the provider's own row first.
    assertEquals(
      data.providerAliases.filter(([, provider]) => provider === "acme-labs"),
      [["acme-labs", "acme-labs"], ["acme", "acme-labs"], [
        "acme-labs-api",
        "acme-labs",
      ]],
    );
    // A retained alias the catalog still spells is not listed twice.
    const same = buildModelCatalogData(fakePayload(), overlay);
    assertEquals(
      same.providerAliases.filter(([alias]) => alias === "acme-labs-api")
        .length,
      1,
    );
  });

  it("refuses a retained alias outside the served-alias shape", () => {
    // The runtime reads the alias map before its own shape and reserved-name
    // checks, so a malformed or reserved alias here would make ids it refuses
    // on purpose resolve.
    for (const alias of ["", "Acme Labs", "veryfront-cloud", "__proto__"]) {
      const overlay: ModelCatalogOverlay = {
        ...OVERLAY,
        retainedProviderAliases: [[alias, "acme-labs"]],
      };
      assertThrows(
        () => buildModelCatalogData(fakePayload(), overlay),
        Error,
        `overlay retainedProviderAliases alias "${alias}"`,
      );
    }
  });

  it("refuses a served model whose provider segment names another provider", () => {
    // The same shadowing through the derived path: `beta-works/x` served with
    // provider acme-labs would make every beta-works id resolve as acme-labs,
    // and so would a prefix naming a provider only the overlay routes.
    const sentinel = "served-value-must-not-print";
    for (
      const [prefix, overlay] of [
        ["beta-works", OVERLAY],
        ["gamma", {
          ...OVERLAY,
          providerRouting: [...OVERLAY.providerRouting, ["gamma", {
            surface: "anthropic",
          }]],
        }],
      ] as const
    ) {
      const payload = fakePayload();
      const model = (payload.models as Record<string, unknown>[])[0]!;
      model.modelId = `${prefix}/${sentinel}`;
      const error = assertThrows(
        () => buildModelCatalogData(payload, overlay),
        Error,
        "models[0] carries a provider segment that names another provider",
      ) as Error;
      assertEquals(error.message.includes(sentinel), false);
      assertEquals(error.message.includes(prefix), false);
    }
  });

  it("refuses a retained alias that names another provider", () => {
    // The runtime reads the alias map before accepting a provider as written,
    // so `["beta-works", "acme-labs"]` would send every beta-works id to
    // acme-labs — and a provider only the overlay routes is a provider too.
    for (
      const overlay of [
        { ...OVERLAY, retainedProviderAliases: [["beta-works", "acme-labs"]] },
        {
          ...OVERLAY,
          providerRouting: [...OVERLAY.providerRouting, ["gamma", {
            surface: "anthropic",
          }]],
          retainedProviderAliases: [["gamma", "acme-labs"]],
        },
      ] as ModelCatalogOverlay[]
    ) {
      assertThrows(
        () => buildModelCatalogData(fakePayload(), overlay),
        Error,
        "names a provider of its own",
      );
    }
  });

  it("keeps a retained alias for a provider the catalog lists no chat model for", () => {
    // Like a routing row, an alias is about the ids the runtime accepts, not
    // about the chat list: ids of the provider the runtime resolves without a
    // chat entry still go through it. Such rows follow the served groups, in
    // overlay order; the provider itself gets no label or display-order row.
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      providerRouting: [...OVERLAY.providerRouting, ["gamma", {
        surface: "anthropic",
      }]],
      retainedProviderAliases: [["gamma-api", "gamma"], ["gamma", "gamma"], [
        "acme",
        "acme-labs",
      ]],
    };
    const data = buildModelCatalogData(fakePayload(), overlay);
    const aliases = data.providerAliases.map(([alias]) => alias);
    assertEquals(aliases.indexOf("acme") < aliases.indexOf("gamma-api"), true);
    assertEquals(new Map(data.providerAliases).get("gamma-api"), "gamma");
    // The provider's own name is not an alias row for an unserved provider.
    assertEquals(aliases.includes("gamma"), false);
    assertEquals(data.providerOrder.includes("gamma"), false);
    assertEquals(
      data.providerLabels.some(([provider]) => provider === "gamma"),
      false,
    );
    assertEquals(new Map(data.providerRouting).get("gamma"), {
      surface: "anthropic",
    });
  });

  it("keeps a provider's routing with no chat model and no transport row of it left", () => {
    // Routing is a fact about the provider's gateway surface. A model id the
    // runtime resolves without a chat entry or a transport row — an embedding
    // model, say — still routes through the row, so the row cannot depend on
    // either being present. The catalog drops acme-labs entirely and the
    // overlay retains nothing of it: the routing row stays, in overlay order.
    const payload = fakePayload();
    const models = (payload.models as Record<string, unknown>[]).filter(
      (model) => model.provider !== "acme-labs",
    );
    payload.models = models;
    payload.providers = (payload.providers as string[]).filter(
      (provider) => provider !== "acme-labs",
    );
    payload.defaultModelId = models[0]!.modelId;
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      retainedTransportCapabilities: OVERLAY.retainedTransportCapabilities
        .filter(([id]) => !id.startsWith("acme-labs/")),
      providerRouting: [
        ...OVERLAY.providerRouting,
        ["embed-only", { surface: "anthropic" }],
      ],
    };

    const data = buildModelCatalogData(payload, overlay);

    assertEquals(data.providerOrder.includes("acme-labs"), false);
    assertEquals(
      data.modelTransportCapabilities.some(([id]) =>
        id.startsWith("acme-labs/")
      ),
      false,
    );
    const routing = new Map(data.providerRouting);
    assertEquals(routing.get("acme-labs"), { surface: "openai", native: true });
    assertEquals(routing.get("embed-only"), { surface: "anthropic" });
    assertEquals(
      data.providerRouting.map(([provider]) => provider),
      [...data.providerOrder, "acme-labs", "embed-only"],
    );
  });

  it("keeps the function-tool reasoning flag even for a non-reasoning model", () => {
    // Unlike a thinking budget or a reasoning mode, this flag is not a claim
    // that the model reasons. It says that WHEN reasoning is applied on the
    // Chat transport, function tools must suppress it, and the consumers of
    // that fact resolve reasoning from the caller's request and a model-id
    // default, never from this catalog's reasoning flag. Dropping it for a
    // model served as non-reasoning would therefore stop suppressing reasoning
    // in exactly the case the overlay exists to cover, and would also let the
    // recorded call context disagree with the request that was built.
    const overlay: ModelCatalogOverlay = {
      ...OVERLAY,
      // `plain-3` is served with `reasoning: false`.
      openAIChatReasoningWithFunctionTools: [
        ...OVERLAY.openAIChatReasoningWithFunctionTools,
        ["beta-works/plain-3", false],
      ],
    };

    const data = buildModelCatalogData(fakePayload(), overlay);
    const entry = data.modelTransportCapabilities.find(([id]) =>
      id === "beta-works/plain-3"
    )?.[1];

    assertEquals(entry, { openAIChatReasoningWithFunctionTools: false });
    // The facts that DO claim the model reasons are still dropped for it.
    assertEquals(entry?.anthropicThinkingMode, undefined);
    assertEquals(
      data.chatModels.find((model) => model.id === "plain-3")
        ?.thinkingBudgetTokens,
      undefined,
    );
  });

  it("rejects a present capabilities value that is not an object", () => {
    for (const capabilities of ["a string", ["an array"], null, 7]) {
      const payload = fakePayload();
      (payload.models as Record<string, unknown>[])[1].capabilities =
        capabilities;
      assertThrows(
        () => buildModelCatalogData(payload, OVERLAY),
        Error,
        "models[1] capabilities",
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
      "a published id that is empty",
      (data) => ({
        ...data,
        chatModels: [
          { ...data.chatModels[0], id: "" },
          ...data.chatModels.slice(1),
        ],
      }),
      "published id is empty",
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

  it("names broken invariants by position, never by a served value", () => {
    // These run after parsing succeeded, on well-typed data whose values are
    // the platform's own. A duplicate must be reported as where it is, not as
    // what it says.
    const sentinel = "served-value-must-not-print";
    const data = buildModelCatalogData(fakePayload(), OVERLAY);
    const twice = {
      ...data,
      chatModels: [
        ...data.chatModels,
        {
          ...data.chatModels[1]!,
          id: sentinel,
          modelId: data.chatModels[1]!.modelId,
        },
      ],
    };
    const error = assertThrows(
      () => assertCatalogInvariants(twice),
      Error,
      `chatModels[1] and chatModels[${data.chatModels.length}]`,
    ) as Error;
    assertEquals(error.message.includes(sentinel), false);

    const unlisted = {
      ...data,
      chatModels: [
        { ...data.chatModels[0]!, provider: sentinel },
        ...data.chatModels.slice(1),
      ],
      providerRouting: [
        ...data.providerRouting,
        [sentinel, { surface: "openai" }] as const,
      ],
    };
    const orderError = assertThrows(
      () => assertCatalogInvariants(unlisted),
      Error,
      "not in the provider order, so these models are never listed: chatModels[0]",
    ) as Error;
    assertEquals(orderError.message.includes(sentinel), false);

    const noDefault = { ...data, defaultModelId: sentinel };
    const defaultError = assertThrows(
      () => assertCatalogInvariants(noDefault),
      Error,
      "the default model names 0 entries",
    ) as Error;
    assertEquals(defaultError.message.includes(sentinel), false);
  });

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
    assertEquals(
      [...collectKeys(data.chatModels, new Set())].sort(compareCodePoints),
      [
        "description",
        "id",
        "modelId",
        "name",
        "provider",
        "thinking",
        "thinkingBudgetTokens",
      ],
    );
  });
});
