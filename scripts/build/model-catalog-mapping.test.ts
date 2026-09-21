import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildModelCatalogData,
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
          { models: [], providers: ["acme-labs"] },
          OVERLAY,
        ),
      Error,
      "lists no model",
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

    const unlabelled = {
      ...fakePayload(),
      providers: ["acme-labs", "beta-works", "ghost-co"],
    };
    assertThrows(
      () => buildModelCatalogData(unlabelled, OVERLAY),
      Error,
      'provider "ghost-co" has no model',
    );
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
