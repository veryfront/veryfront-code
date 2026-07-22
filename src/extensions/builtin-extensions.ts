import type {
  Capability,
  Extension,
  ExtensionContext,
  ExtensionContractMetadata,
  ExtensionFactory,
  ResolvedExtension,
} from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { createEvalReportExporterRegistry, EvalReportExporterRegistryName } from "./eval/index.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "./first-party-import.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import { OpenAIProvider } from "../../extensions/ext-llm-openai/src/index.ts";
import { AnthropicProvider } from "../../extensions/ext-llm-anthropic/src/index.ts";
import { GoogleProvider } from "../../extensions/ext-llm-google/src/index.ts";
import extEvalReportMlflow, {
  EvalReportMlflowExtensionMetadata,
} from "../../extensions/ext-eval-report-mlflow/src/index.ts";
import extZod from "../../extensions/ext-schema-zod/src/index.ts";
export { ensureBuiltinSchemaValidator } from "./builtin-schema-validator.ts";

type BuiltinLLMProviderDefinition = {
  extensionName: string;
  origin: string;
  provider: () => LLMProvider;
};

export type OptionalBuiltinExtensionDefinition = {
  name: string;
  origin: string;
  sourceDirectory: string;
  contracts?: ExtensionContractMetadata;
  evalExporterId?: string;
  capabilities: Capability[];
  factory?: ExtensionFactory;
};

const BUILTIN_LLM_PROVIDERS: BuiltinLLMProviderDefinition[] = [
  {
    extensionName: "ext-llm-openai",
    origin: "veryfront/ext-llm-openai",
    provider: () => new OpenAIProvider(),
  },
  {
    extensionName: "ext-llm-anthropic",
    origin: "veryfront/ext-llm-anthropic",
    provider: () => new AnthropicProvider(),
  },
  {
    extensionName: "ext-llm-google",
    origin: "veryfront/ext-llm-google",
    provider: () => new GoogleProvider(),
  },
];

export const OPTIONAL_BUILTIN_EXTENSIONS: OptionalBuiltinExtensionDefinition[] = [
  {
    name: "ext-auth-jwt",
    origin: "veryfront/ext-auth-jwt",
    sourceDirectory: "ext-auth-jwt",
    contracts: { provides: ["AuthProvider"] },
    capabilities: [{ type: "net:outbound", hosts: ["*"] }],
  },
  {
    name: "ext-observability-opentelemetry",
    origin: "veryfront/ext-observability-opentelemetry",
    sourceDirectory: "ext-observability-opentelemetry",
    contracts: { provides: ["TracingExporter", "NodeTelemetryProvider"] },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
          "OTEL_EXPORTER_OTLP_LLMOBS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_HEADERS",
          "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
          "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
          "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
          "OTEL_RESOURCE_ATTRIBUTES",
          "OTEL_SERVICE_NAME",
          "OTEL_SERVICE_VERSION",
          "OTEL_DEPLOYMENT_ENVIRONMENT",
          "DD_SERVICE",
          "DD_VERSION",
          "DD_ENV",
          "DD_API_KEY",
          "DATADOG_OTLP_API_KEY",
          "DD_LLMOBS_ENABLED",
          "DD_LLMOBS_ML_APP",
          "DD_LLMOBS_OTLP_ENDPOINT",
          "OTEL_LLMOBS_ENABLED",
          "VERYFRONT_VERSION",
          "RELEASE_VERSION",
          "APP_ENVIRONMENT",
          "VERYFRONT_ENVIRONMENT",
          "NODE_ENV",
          "OTEL_TRACES_ENABLED",
          "OTEL_METRICS_ENABLED",
          "OTEL_LOGS_ENABLED",
          "OTEL_TRACES_EXPORTER",
          "OTEL_METRICS_EXPORTER",
          "OTEL_LOGS_EXPORTER",
          "OTEL_METRIC_EXPORT_INTERVAL",
          "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE",
        ],
      },
    ],
  },
  {
    name: "ext-bundler-esbuild",
    origin: "veryfront/ext-bundler-esbuild",
    sourceDirectory: "ext-bundler-esbuild",
    contracts: { provides: ["Bundler", "ModuleLexer"] },
    capabilities: [],
  },
  {
    name: "ext-parser-babel",
    origin: "veryfront/ext-parser-babel",
    sourceDirectory: "ext-parser-babel",
    contracts: { provides: ["CodeParser"] },
    capabilities: [],
  },
  {
    name: "ext-content-mdx",
    origin: "veryfront/ext-content-mdx",
    sourceDirectory: "ext-content-mdx",
    contracts: { provides: ["ContentProcessor"] },
    capabilities: [],
  },
  {
    name: "ext-css-tailwind",
    origin: "veryfront/ext-css-tailwind",
    sourceDirectory: "ext-css-tailwind",
    contracts: { provides: ["CSSProcessor"] },
    capabilities: [{ type: "net:outbound", hosts: ["esm.sh"] }],
  },
  {
    name: "ext-document-kreuzberg",
    origin: "veryfront/ext-document-kreuzberg",
    sourceDirectory: "ext-document-kreuzberg",
    contracts: { provides: ["DocumentExtractor"] },
    capabilities: [{ type: "fs:read" }],
  },
  {
    name: "ext-db-sqlite",
    origin: "veryfront/ext-db-sqlite",
    sourceDirectory: "ext-db-sqlite",
    contracts: { provides: ["SqliteStore"] },
    capabilities: [{ type: "fs:read" }, { type: "fs:write" }],
  },
  {
    name: "ext-sandbox-shell-tools",
    origin: "veryfront/ext-sandbox-shell-tools",
    sourceDirectory: "ext-sandbox-shell-tools",
    contracts: { provides: ["SandboxShellToolsProvider"] },
    capabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
  },
  {
    name: "ext-eval-report-mlflow",
    origin: "veryfront/ext-eval-report-mlflow",
    sourceDirectory: "ext-eval-report-mlflow",
    contracts: EvalReportMlflowExtensionMetadata.contracts,
    evalExporterId: "mlflow",
    factory: extEvalReportMlflow,
    capabilities: EvalReportMlflowExtensionMetadata.capabilities,
  },
];

function getOrCreateLLMProviderRegistry(): LLMProviderRegistry {
  const existing = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
  if (existing) return existing;

  const registry = createLLMProviderRegistry();
  register(LLMProviderRegistryName, registry);
  return registry;
}

export function ensureBuiltinEvalReportExporterRegistry(): EvalReportExporterRegistry {
  const existing = tryResolve<EvalReportExporterRegistry>(
    EvalReportExporterRegistryName,
  );
  if (existing) return existing;

  const registry = createEvalReportExporterRegistry();
  register(EvalReportExporterRegistryName, registry);
  return registry;
}

function registerBuiltinLLMProvider(
  registry: LLMProviderRegistry,
  provider: LLMProvider,
): boolean {
  if (registry.has(provider.id)) return false;
  registry.register(provider);
  return true;
}

export function ensureBuiltinLLMProviders(): LLMProviderRegistry {
  const registry = getOrCreateLLMProviderRegistry();
  for (const definition of BUILTIN_LLM_PROVIDERS) {
    registerBuiltinLLMProvider(registry, definition.provider());
  }
  return registry;
}

function createBuiltinLLMProviderExtension(
  definition: BuiltinLLMProviderDefinition,
): ResolvedExtension {
  const provider = definition.provider();
  let didRegister = false;

  return {
    source: "builtin",
    origin: definition.origin,
    extension: {
      name: definition.extensionName,
      version: "0.1.0",
      contracts: {
        requires: [LLMProviderRegistryName],
      },
      capabilities: [],
      setup(ctx) {
        const registry = ctx.require<LLMProviderRegistry>(
          LLMProviderRegistryName,
        );
        didRegister = registerBuiltinLLMProvider(registry, provider);
        if (didRegister) {
          ctx.logger.info(
            `[${definition.extensionName}] ${provider.id} provider registered`,
          );
        }
      },
      teardown() {
        if (didRegister) {
          const registry = tryResolve<LLMProviderRegistry>(
            LLMProviderRegistryName,
          );
          registry?.unregister(provider.id);
          didRegister = false;
        }
      },
    },
  };
}

export function createOptionalBuiltinExtension(
  definition: OptionalBuiltinExtensionDefinition,
): ResolvedExtension {
  let loaded: Extension | undefined;

  return {
    source: "builtin",
    origin: definition.origin,
    extension: {
      name: definition.name,
      version: "0.1.0",
      contracts: definition.contracts,
      capabilities: definition.capabilities,
      async setup(ctx) {
        const extension = await loadOptionalBuiltinExtension(definition, ctx);
        if (!extension) return;

        loaded = extension;
        for (
          const [contract, impl] of Object.entries(extension.provides ?? {})
        ) {
          ctx.provide(contract, impl);
        }
        await extension.setup?.(ctx);
      },
      async teardown() {
        await loaded?.teardown?.();
        loaded = undefined;
      },
    },
  };
}

async function loadOptionalBuiltinExtension(
  definition: OptionalBuiltinExtensionDefinition,
  ctx: ExtensionContext,
): Promise<Extension | undefined> {
  try {
    const factory = definition.factory ?? await importOptionalBuiltinFactory(
      definition.sourceDirectory,
      getFirstPartyExtensionPackageName(definition),
    );
    return factory();
  } catch (error) {
    if (!isMissingOptionalBuiltinImplementation(error, definition)) {
      throw error;
    }
    ctx.logger.debug(
      `Builtin extension "${definition.name}" is not available from the root package; install ${
        getFirstPartyExtensionPackageName(definition)
      } to enable it.`,
    );
    return undefined;
  }
}

async function importOptionalBuiltinFactory(
  sourceDirectory: string,
  packageName: string,
): Promise<ExtensionFactory> {
  const mod = await importFirstPartyExtensionModule<{
    default?: unknown;
  }>(sourceDirectory, packageName);
  if (typeof mod.default !== "function") {
    throw new Error(
      `Builtin extension "${sourceDirectory}" has no default factory export`,
    );
  }
  return mod.default as ExtensionFactory;
}

function isMissingOptionalBuiltinImplementation(
  error: unknown,
  definition: OptionalBuiltinExtensionDefinition,
): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    `extensions/${definition.sourceDirectory}/src/index`,
    getFirstPartyExtensionPackageName(definition),
  ]);
}

function getFirstPartyExtensionPackageName(
  definition: OptionalBuiltinExtensionDefinition,
): string {
  return definition.origin.replace("veryfront/", "@veryfront/");
}

export function createBuiltinExtensions(): ResolvedExtension[] {
  return [
    // ext-schema-zod registers SchemaValidator. Listed FIRST so any subsequent
    // builtin whose setup() builds schemas via defineSchema() finds the
    // contract resolved.
    {
      source: "builtin",
      origin: "veryfront/ext-schema-zod",
      extension: extZod(),
    },
    ...OPTIONAL_BUILTIN_EXTENSIONS.map(createOptionalBuiltinExtension),
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}

export function createEvalCliBuiltinExtensions(
  selectedExporterIds: string[] = [],
): ResolvedExtension[] {
  const selected = new Set(selectedExporterIds);
  const exporterExtensions = OPTIONAL_BUILTIN_EXTENSIONS.filter((definition) =>
    definition.contracts?.requires?.includes(EvalReportExporterRegistryName) &&
    definition.evalExporterId !== undefined &&
    selected.has(definition.evalExporterId)
  );

  return [
    {
      source: "builtin",
      origin: "veryfront/ext-schema-zod",
      extension: extZod(),
    },
    ...exporterExtensions.map(createOptionalBuiltinExtension),
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}
