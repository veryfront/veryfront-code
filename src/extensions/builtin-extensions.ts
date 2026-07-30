import type { Extension, ExtensionFactory, ExtensionLogger, ResolvedExtension } from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import { EXTENSION_VALIDATION_ERROR } from "./errors.ts";
import { validateExtension } from "./validation.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { createEvalReportExporterRegistry, EvalReportExporterRegistryName } from "./eval/index.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "./first-party-import.ts";
import { createDeferredResolvedExtension } from "./deferred-extension.ts";
import { captureRegistrationId } from "./runtime-validation.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import { OpenAIProvider } from "../../extensions/ext-llm-openai/src/index.ts";
import { AnthropicProvider } from "../../extensions/ext-llm-anthropic/src/index.ts";
import { GoogleProvider } from "../../extensions/ext-llm-google/src/index.ts";
import extEvalReportMlflow from "../../extensions/ext-eval-report-mlflow/src/index.ts";
import extZod from "../../extensions/ext-schema-zod/src/index.ts";
export { ensureBuiltinSchemaValidator } from "./builtin-schema-validator.ts";

type BuiltinLLMProviderDefinition = {
  extensionName: string;
  origin: string;
  provider: () => LLMProvider;
};

export type OptionalBuiltinExtensionDefinition = {
  readonly name: string;
  readonly origin: string;
  readonly sourceDirectory: string;
  readonly evalExporterId?: string;
  readonly factory?: ExtensionFactory;
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

export const OPTIONAL_BUILTIN_EXTENSIONS = Object.freeze(
  ([
    {
      name: "ext-auth-jwt",
      origin: "veryfront/ext-auth-jwt",
      sourceDirectory: "ext-auth-jwt",
    },
    {
      name: "ext-observability-opentelemetry",
      origin: "veryfront/ext-observability-opentelemetry",
      sourceDirectory: "ext-observability-opentelemetry",
    },
    {
      name: "ext-bundler-esbuild",
      origin: "veryfront/ext-bundler-esbuild",
      sourceDirectory: "ext-bundler-esbuild",
    },
    {
      name: "ext-parser-babel",
      origin: "veryfront/ext-parser-babel",
      sourceDirectory: "ext-parser-babel",
    },
    {
      name: "ext-content-mdx",
      origin: "veryfront/ext-content-mdx",
      sourceDirectory: "ext-content-mdx",
    },
    {
      name: "ext-document-kreuzberg",
      origin: "veryfront/ext-document-kreuzberg",
      sourceDirectory: "ext-document-kreuzberg",
    },
    {
      name: "ext-db-sqlite",
      origin: "veryfront/ext-db-sqlite",
      sourceDirectory: "ext-db-sqlite",
    },
    {
      name: "ext-sandbox-shell-tools",
      origin: "veryfront/ext-sandbox-shell-tools",
      sourceDirectory: "ext-sandbox-shell-tools",
    },
    {
      name: "ext-yaml",
      origin: "veryfront/ext-yaml",
      sourceDirectory: "ext-yaml",
    },
    {
      name: "ext-eval-report-mlflow",
      origin: "veryfront/ext-eval-report-mlflow",
      sourceDirectory: "ext-eval-report-mlflow",
      evalExporterId: "mlflow",
      factory: extEvalReportMlflow,
    },
  ] satisfies OptionalBuiltinExtensionDefinition[]).map((definition) => Object.freeze(definition)),
);

function getOrCreateLLMProviderRegistry(): LLMProviderRegistry {
  const existing = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
  if (existing !== undefined) return existing;

  const registry = createLLMProviderRegistry();
  register(LLMProviderRegistryName, registry);
  return registry;
}

export function ensureBuiltinEvalReportExporterRegistry(): EvalReportExporterRegistry {
  const existing = tryResolve<EvalReportExporterRegistry>(
    EvalReportExporterRegistryName,
  );
  if (existing !== undefined) return existing;

  const registry = createEvalReportExporterRegistry();
  register(EvalReportExporterRegistryName, registry);
  return registry;
}

function registerBuiltinLLMProvider(
  registry: LLMProviderRegistry,
  provider: LLMProvider,
  providerId: string,
): boolean {
  if (registry.has(providerId)) return false;
  registry.register(provider);
  return registry.get(providerId) === provider;
}

export function ensureBuiltinLLMProviders(): LLMProviderRegistry {
  const registry = getOrCreateLLMProviderRegistry();
  for (const definition of BUILTIN_LLM_PROVIDERS) {
    const provider = definition.provider();
    const providerId = captureRegistrationId(provider, "LLMProvider");
    registerBuiltinLLMProvider(registry, provider, providerId);
  }
  return registry;
}

function createBuiltinLLMProviderExtension(
  definition: BuiltinLLMProviderDefinition,
): ResolvedExtension {
  const provider = definition.provider();
  const providerId = captureRegistrationId(provider, "LLMProvider");
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
        didRegister = registerBuiltinLLMProvider(
          registry,
          provider,
          providerId,
        );
        if (didRegister) {
          ctx.logger.debug(
            `[${definition.extensionName}] ${providerId} provider registered`,
          );
        }
      },
      teardown() {
        if (didRegister) {
          const registry = tryResolve<LLMProviderRegistry>(
            LLMProviderRegistryName,
          );
          registry?.unregister(providerId);
          didRegister = false;
        }
      },
    },
  };
}

export function createOptionalBuiltinExtension(
  definition: OptionalBuiltinExtensionDefinition,
): ResolvedExtension {
  const capturedDefinition = Object.freeze({ ...definition });
  return createDeferredResolvedExtension({
    name: capturedDefinition.name,
    source: "builtin",
    origin: capturedDefinition.origin,
    load: (logger) => loadOptionalBuiltinExtension(capturedDefinition, logger),
  });
}

async function loadOptionalBuiltinExtension(
  definition: OptionalBuiltinExtensionDefinition,
  logger: ExtensionLogger,
): Promise<Extension | undefined> {
  const configuredFactory = definition.factory;
  try {
    const factory = configuredFactory ?? await importOptionalBuiltinFactory(
      definition.sourceDirectory,
      getFirstPartyExtensionPackageName(definition),
    );
    const factoryResult = (factory as () => unknown)();
    const issues = validateExtension(factoryResult);
    if (issues.length > 0) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail: `Optional builtin factory for "${definition.name}" returned an invalid extension: ${
          issues.join("; ")
        }`,
      });
    }
    const extension = factoryResult as Extension;
    if (extension.name !== definition.name) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail:
          `Optional builtin factory for "${definition.name}" returned extension "${extension.name}"`,
      });
    }
    return extension;
  } catch (error) {
    if (
      configuredFactory !== undefined ||
      !isMissingOptionalBuiltinImplementation(error, definition)
    ) {
      throw error;
    }
    logger.debug(
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
