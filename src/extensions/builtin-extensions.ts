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
import {
  FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES,
  type FirstPartyEvalExporterSelection,
} from "./first-party-defaults.ts";
import { OpenAIProvider } from "@veryfront/ext-llm-openai";
import { AnthropicProvider } from "@veryfront/ext-llm-anthropic";
import { GoogleProvider } from "@veryfront/ext-llm-google";
import { OnnxProvider } from "@veryfront/ext-llm-onnx";
import extEvalReportMlflow from "@veryfront/ext-eval-report-mlflow";
import extZod from "@veryfront/ext-schema-zod";
export { ensureBuiltinSchemaValidator } from "./builtin-schema-validator.ts";

type BuiltinLLMProviderDefinition = {
  extensionName: string;
  origin: string;
  provider: () => LLMProvider;
};

type DeferredBuiltinExtensionBase = {
  readonly name: string;
  readonly origin: string;
  readonly sourceDirectory: string;
  readonly evalExporterSelection?: FirstPartyEvalExporterSelection;
};

export type DeferredBuiltinExtensionDefinition =
  & DeferredBuiltinExtensionBase
  & (
    | { readonly availability: "package"; readonly factory?: never }
    | { readonly availability: "root-bundled"; readonly factory: ExtensionFactory }
  );

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
  {
    extensionName: "ext-llm-onnx",
    origin: "veryfront/ext-llm-onnx",
    provider: () => new OnnxProvider(),
  },
];

export const DEFERRED_BUILTIN_EXTENSIONS = Object.freeze(
  FIRST_PARTY_DEFERRED_BUILTIN_EXTENSION_POLICIES.map(
    (policy): DeferredBuiltinExtensionDefinition => {
      const definition = {
        name: policy.name,
        origin: `veryfront/${policy.sourceDirectory}`,
        sourceDirectory: policy.sourceDirectory,
        ...(policy.evalExporterSelection
          ? { evalExporterSelection: policy.evalExporterSelection }
          : {}),
      } satisfies DeferredBuiltinExtensionBase;

      if (policy.name === "ext-eval-report-mlflow") {
        return Object.freeze({
          ...definition,
          // MLflow is deliberately shipped inside the root npm package rather
          // than published as a standalone extension package.
          availability: "root-bundled",
          factory: extEvalReportMlflow,
        });
      }

      return Object.freeze({ ...definition, availability: "package" });
    },
  ),
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
        didRegister = registerBuiltinLLMProvider(registry, provider, providerId);
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

export function createDeferredBuiltinExtension(
  definition: DeferredBuiltinExtensionDefinition,
): ResolvedExtension {
  const capturedDefinition = Object.freeze({ ...definition });
  return createDeferredResolvedExtension({
    name: capturedDefinition.name,
    source: "builtin",
    origin: capturedDefinition.origin,
    load: (logger) => loadDeferredBuiltinExtension(capturedDefinition, logger),
  });
}

async function loadDeferredBuiltinExtension(
  definition: DeferredBuiltinExtensionDefinition,
  logger: ExtensionLogger,
): Promise<Extension | undefined> {
  try {
    const factory = definition.availability === "root-bundled"
      ? definition.factory
      : await importDeferredBuiltinFactory(
        definition.sourceDirectory,
        getFirstPartyExtensionPackageName(definition),
      );
    const factoryResult = (factory as () => unknown)();
    const issues = validateExtension(factoryResult);
    if (issues.length > 0) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail: `Deferred builtin factory for "${definition.name}" returned an invalid extension: ${
          issues.join("; ")
        }`,
      });
    }
    const extension = factoryResult as Extension;
    if (extension.name !== definition.name) {
      throw EXTENSION_VALIDATION_ERROR.create({
        detail:
          `Deferred builtin factory for "${definition.name}" returned extension "${extension.name}"`,
      });
    }
    return extension;
  } catch (error) {
    if (
      definition.availability === "root-bundled" ||
      !isMissingDeferredBuiltinImplementation(error, definition)
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

async function importDeferredBuiltinFactory(
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

function isMissingDeferredBuiltinImplementation(
  error: unknown,
  definition: DeferredBuiltinExtensionDefinition,
): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    `extensions/${definition.sourceDirectory}/src/index`,
    getFirstPartyExtensionPackageName(definition),
  ]);
}

function getFirstPartyExtensionPackageName(
  definition: DeferredBuiltinExtensionDefinition,
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
    ...DEFERRED_BUILTIN_EXTENSIONS.map(createDeferredBuiltinExtension),
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}

export function createEvalCliBuiltinExtensions(
  selectedExporterIds: string[] = [],
): ResolvedExtension[] {
  const selected = new Set(selectedExporterIds);
  const exporterExtensions = DEFERRED_BUILTIN_EXTENSIONS.filter((definition) => {
    const selection = definition.evalExporterSelection;
    if (!selection) return false;
    return selection.kind === "any-selected" ? selected.size > 0 : selected.has(selection.id);
  });

  return [
    {
      source: "builtin",
      origin: "veryfront/ext-schema-zod",
      extension: extZod(),
    },
    ...exporterExtensions.map(createDeferredBuiltinExtension),
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}
