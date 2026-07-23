import type {
  Capability,
  Extension,
  ExtensionContext,
  ExtensionContractMetadata,
  ExtensionFactory,
  ResolvedExtension,
} from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import { EXTENSION_VALIDATION_ERROR, isVeryfrontErrorWithSlug } from "./errors.ts";
import { snapshotResolvedExtensions } from "./extension-snapshot.ts";
import { identifierIssue, MAX_EXTENSION_NAME_LENGTH } from "./identifiers.ts";
import { validateExtension } from "./validation.ts";
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
import extEvalReportMlflow from "../../extensions/ext-eval-report-mlflow/src/index.ts";
import extZod from "../../extensions/ext-schema-zod/src/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

const MAX_BUILTIN_MANIFEST_NODES = 2_048;
const MAX_BUILTIN_MANIFEST_DEPTH = 8;
const MAX_BUILTIN_MANIFEST_ENTRIES = 256;
const MAX_BUILTIN_MANIFEST_STRING_CHARACTERS = 1_048_576;
const MAX_EVAL_EXPORTER_SELECTIONS = 256;
const MAX_EVAL_EXPORTER_ID_LENGTH = 128;

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

const OPTIONAL_BUILTIN_EXTENSION_DEFINITIONS: OptionalBuiltinExtensionDefinition[] = [
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
    contracts: { requires: ["EvalReportExporterRegistry"] },
    evalExporterId: "mlflow",
    factory: extEvalReportMlflow,
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "MLFLOW_ARTIFACTS_URI",
          "MLFLOW_EXPERIMENT_NAME",
          "MLFLOW_RUN_NAME",
          "MLFLOW_TRACKING_PASSWORD",
          "MLFLOW_TRACKING_TOKEN",
          "MLFLOW_TRACKING_URI",
          "MLFLOW_TRACKING_USERNAME",
        ],
      },
    ],
  },
];

export const OPTIONAL_BUILTIN_EXTENSIONS: readonly OptionalBuiltinExtensionDefinition[] = Object
  .freeze(OPTIONAL_BUILTIN_EXTENSION_DEFINITIONS.map(snapshotOptionalBuiltinDefinition));

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

export function ensureBuiltinSchemaValidator(): void {
  if (tryResolve("SchemaValidator") === undefined) {
    register("SchemaValidator", createZodAdapter());
  }
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
  const manifest = snapshotOptionalBuiltinDefinition(definition);
  let loaded: Extension | undefined;

  return {
    source: "builtin",
    origin: manifest.origin,
    extension: {
      name: manifest.name,
      version: "0.1.0",
      contracts: manifest.contracts,
      capabilities: manifest.capabilities,
      async setup(ctx) {
        const extension = await loadOptionalBuiltinExtension(manifest, ctx);
        if (!extension) return;

        loaded = extension;
        for (
          const [contract, impl] of Object.entries(extension.provides ?? {})
        ) {
          ctx.provide(contract, impl);
        }
        await extension.setup?.(ctx);
      },
      async teardown(context) {
        const extension = loaded;
        loaded = undefined;
        await extension?.teardown?.(context);
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
    const extension = snapshotResolvedExtensions([{
      extension: factory(),
      source: "builtin",
      origin: definition.origin,
    }])[0]!.extension;
    validateOptionalBuiltinResult(definition, extension);
    return extension;
  } catch (error) {
    if (isMissingOptionalBuiltinImplementation(error, definition)) {
      ctx.logger.debug(
        `Builtin extension "${definition.name}" is not available from the root package; install ${
          getFirstPartyExtensionPackageName(definition)
        } to enable it.`,
      );
      return undefined;
    }
    if (isVeryfrontErrorWithSlug(error, "extension-validation")) throw error;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Builtin extension "${definition.name}" failed during initialization`,
    });
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

function snapshotOptionalBuiltinDefinition(
  value: OptionalBuiltinExtensionDefinition,
): OptionalBuiltinExtensionDefinition {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }
  if (value === null || typeof value !== "object" || isArray) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }
  let capabilities: unknown;
  let contracts: unknown;
  let evalExporterId: unknown;
  let factory: unknown;
  let name: unknown;
  let origin: unknown;
  let sourceDirectory: unknown;
  try {
    capabilities = Reflect.get(value, "capabilities");
    contracts = Reflect.get(value, "contracts");
    evalExporterId = Reflect.get(value, "evalExporterId");
    factory = Reflect.get(value, "factory");
    name = Reflect.get(value, "name");
    origin = Reflect.get(value, "origin");
    sourceDirectory = Reflect.get(value, "sourceDirectory");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }

  if (
    typeof name !== "string" || identifierIssue(name, MAX_EXTENSION_NAME_LENGTH) !== undefined ||
    typeof sourceDirectory !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/.test(sourceDirectory) ||
    name !== sourceDirectory || origin !== `veryfront/${sourceDirectory}` ||
    (factory !== undefined && typeof factory !== "function") ||
    (evalExporterId !== undefined &&
      identifierIssue(evalExporterId, MAX_EVAL_EXPORTER_ID_LENGTH) !== undefined)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }

  const issues = validateExtension({
    name,
    version: "0.1.0",
    capabilities,
    contracts,
  });
  if (issues.length > 0) {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }

  return Object.freeze({
    name,
    origin: origin as string,
    sourceDirectory,
    contracts: contracts === undefined
      ? undefined
      : snapshotManifestValue(contracts) as ExtensionContractMetadata,
    evalExporterId: evalExporterId as string | undefined,
    capabilities: snapshotManifestValue(capabilities) as Capability[],
    factory: factory as ExtensionFactory | undefined,
  });
}

function snapshotManifestValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringCharacters = 0;

  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > MAX_BUILTIN_MANIFEST_NODES || depth > MAX_BUILTIN_MANIFEST_DEPTH) {
      throw new TypeError();
    }
    if (
      current === null || typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    ) {
      return current;
    }
    if (typeof current === "string") {
      stringCharacters += current.length;
      if (stringCharacters > MAX_BUILTIN_MANIFEST_STRING_CHARACTERS) throw new TypeError();
      return current;
    }
    if (typeof current !== "object" || seen.has(current)) throw new TypeError();
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        const length = Reflect.get(current, "length");
        if (
          typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
          length > MAX_BUILTIN_MANIFEST_ENTRIES
        ) throw new TypeError();
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          if (!Object.hasOwn(current, index)) throw new TypeError();
          result.push(visit(Reflect.get(current, index), depth + 1));
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
      const keys = Object.keys(current).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      );
      if (keys.length > MAX_BUILTIN_MANIFEST_ENTRIES) throw new TypeError();
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        stringCharacters += key.length;
        if (stringCharacters > MAX_BUILTIN_MANIFEST_STRING_CHARACTERS) throw new TypeError();
        Object.defineProperty(result, key, {
          enumerable: true,
          value: visit(Reflect.get(current, key), depth + 1),
        });
      }
      return Object.freeze(result);
    } finally {
      seen.delete(current);
    }
  };

  try {
    return visit(value, 0);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({ message: "Optional builtin definition is invalid" });
  }
}

function validateOptionalBuiltinResult(
  definition: OptionalBuiltinExtensionDefinition,
  value: unknown,
): asserts value is Extension {
  const issues = validateExtension(value);
  if (issues.length > 0) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Optional builtin factory returned an invalid extension",
    });
  }
  const extension = value as Extension;
  const declaredProvides = new Set(definition.contracts?.provides ?? []);
  const actualProvides = new Set([
    ...Object.keys(extension.provides ?? {}),
    ...(extension.contracts?.provides ?? []),
  ]);
  const declaredRequires = new Set(definition.contracts?.requires ?? []);
  const actualRequires = new Set(extension.contracts?.requires ?? []);
  if (
    extension.name !== definition.name || extension.extends !== undefined ||
    !setsEqual(declaredProvides, actualProvides) ||
    !setsEqual(declaredRequires, actualRequires) ||
    !manifestValuesEqual(definition.capabilities, extension.capabilities)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Optional builtin extension does not match its manifest",
    });
  }
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function manifestValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(snapshotManifestValue(left)) ===
      JSON.stringify(snapshotManifestValue(right));
  } catch {
    return false;
  }
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
  let exporterSelections: unknown[];
  try {
    if (!Array.isArray(selectedExporterIds)) throw new TypeError();
    const length = Reflect.get(selectedExporterIds, "length");
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_EVAL_EXPORTER_SELECTIONS
    ) throw new TypeError();
    exporterSelections = [];
    for (let index = 0; index < length; index++) {
      exporterSelections.push(Reflect.get(selectedExporterIds, index));
    }
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        `Selected eval exporter ids must be an array with at most ${MAX_EVAL_EXPORTER_SELECTIONS} entries`,
    });
  }
  const selected = new Set<string>();
  for (const exporterId of exporterSelections) {
    if (
      typeof exporterId !== "string" ||
      identifierIssue(exporterId, MAX_EVAL_EXPORTER_ID_LENGTH) !== undefined
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Selected eval exporter ids are invalid",
      });
    }
    selected.add(exporterId);
  }
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
