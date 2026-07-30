import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "./contracts.ts";
import type { Extension } from "./types.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { EvalReportExporterRegistryName } from "./eval/index.ts";
import type { SchemaValidator } from "./schema/index.ts";
import {
  createBuiltinExtensions,
  createEvalCliBuiltinExtensions,
  createOptionalBuiltinExtension,
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinSchemaValidator,
  OPTIONAL_BUILTIN_EXTENSIONS,
} from "./builtin-extensions.ts";
import { mergeExtensions } from "./discovery.ts";
import { getDeferredExtensionState } from "./deferred-extension.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { ExtensionLoader } from "./loader.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function canonicalizeUnorderedMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalizeUnorderedMetadata)
      .sort((left, right) => {
        const leftJson = JSON.stringify(left) ?? "";
        const rightJson = JSON.stringify(right) ?? "";
        return leftJson.localeCompare(rightJson);
      });
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeUnorderedMetadata(nested)]),
    );
  }

  return value;
}

describe("ensureBuiltinSchemaValidator", () => {
  afterEach(() => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

  it("registers the built-in SchemaValidator before config loading", () => {
    reset();

    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);

    ensureBuiltinSchemaValidator();

    const validator = tryResolve<SchemaValidator>("SchemaValidator");
    assertEquals(typeof validator?.object, "function");
  });

  it("does not replace an existing SchemaValidator", () => {
    const existing = createZodAdapter();
    reset();
    register<SchemaValidator>("SchemaValidator", existing);

    ensureBuiltinSchemaValidator();

    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), existing);
  });
});

describe("ensureBuiltinEvalReportExporterRegistry", () => {
  afterEach(() => {
    reset();
  });

  it("registers the eval report exporter registry for exporter extensions", () => {
    reset();

    assertEquals(
      tryResolve<EvalReportExporterRegistry>(EvalReportExporterRegistryName),
      undefined,
    );

    const registry = ensureBuiltinEvalReportExporterRegistry();

    assertEquals(
      tryResolve<EvalReportExporterRegistry>(EvalReportExporterRegistryName),
      registry,
    );
    assertEquals(registry.list(), []);
  });

  it("does not replace an existing eval report exporter registry", () => {
    reset();
    const existing: EvalReportExporterRegistry = {
      register: () => {},
      unregister: () => {},
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
      list: () => [],
      has: () => false,
      export: () => Promise.resolve([]),
    };
    register(EvalReportExporterRegistryName, existing);

    const registry = ensureBuiltinEvalReportExporterRegistry();

    assertEquals(registry, existing);
  });
});

describe("createBuiltinExtensions", () => {
  async function loadOptionalBuiltin(name: string): Promise<Extension> {
    const candidate = createBuiltinExtensions().find((entry) => entry.extension.name === name);
    assert(candidate);
    const deferred = getDeferredExtensionState(candidate);
    assert(deferred);
    const extension = await deferred.load(noopLogger);
    assert(extension);
    return extension;
  }

  it("uses the loaded AuthProvider extension contract as runtime metadata", async () => {
    const authExtension = await loadOptionalBuiltin("ext-auth-jwt");

    assertEquals(
      Object.hasOwn(authExtension.provides ?? {}, "AuthProvider") ||
        authExtension.contracts?.provides?.includes("AuthProvider"),
      true,
    );
  });

  it("uses the loaded OpenTelemetry contracts as runtime metadata", async () => {
    const otelExtension = await loadOptionalBuiltin(
      "ext-observability-opentelemetry",
    );

    assertEquals(
      otelExtension.contracts?.provides?.includes("TracingExporter"),
      true,
    );
    assertEquals(
      otelExtension.contracts?.provides?.includes("NodeTelemetryProvider"),
      true,
    );
  });

  it("loads the offline Dev UI provider through the deferred extension boundary", async () => {
    const devUiExtension = await loadOptionalBuiltin("ext-dev-ui-react");

    assertEquals(
      devUiExtension.contracts?.provides?.includes("DevUiAssetProvider"),
      true,
    );
    assertEquals(devUiExtension.capabilities, []);
  });

  it("loads Skill YAML parsing through the deferred extension boundary", async () => {
    const skillYamlExtension = await loadOptionalBuiltin("ext-yaml");

    assertEquals(
      skillYamlExtension.contracts?.provides?.includes(
        "SkillDocumentParserProvider",
      ),
      true,
    );
    assertEquals(skillYamlExtension.capabilities, []);
  });

  it("keeps optional candidates deferred until the loader selects them", () => {
    const authCandidate = createBuiltinExtensions().find((entry) =>
      entry.extension.name === "ext-auth-jwt"
    );

    assert(authCandidate);
    assert(getDeferredExtensionState(authCandidate));
  });

  it("never auto-loads the explicit Node WebSocket implementation", async () => {
    const source = await Deno.readTextFile(new URL("./builtin-extensions.ts", import.meta.url));
    assertEquals(source.includes("ext-node-websocket-ws"), false);
    assertEquals(
      OPTIONAL_BUILTIN_EXTENSIONS.some((definition) => definition.name === "ext-node-websocket-ws"),
      false,
    );
  });

  it("captures optional definitions before deferred loading", async () => {
    const definition = {
      name: "ext-captured",
      origin: "veryfront/ext-captured",
      sourceDirectory: "ext-captured",
      factory: () => ({
        name: "ext-captured",
        version: "1.0.0",
        capabilities: [],
      }),
    };
    const candidate = createOptionalBuiltinExtension(definition);
    definition.name = "ext-mutated";
    definition.factory = () => {
      throw new Error("mutated factory must not run");
    };

    const extension = await getDeferredExtensionState(candidate)!.load(noopLogger);

    assertEquals(extension?.name, "ext-captured");
  });

  it("does not statically import optional implementation extensions", async () => {
    const source = await Deno.readTextFile(new URL("./builtin-extensions.ts", import.meta.url));

    assertEquals(source.includes('from "../../extensions/ext-auth-jwt/src/index.ts"'), false);
    assertEquals(
      source.includes('from "../../extensions/ext-bundler-esbuild/src/index.ts"'),
      false,
    );
    assertEquals(source.includes('from "../../extensions/ext-content-mdx/src/index.ts"'), false);
    assertEquals(
      source.includes('from "../../extensions/ext-sandbox-shell-tools/src/index.ts"'),
      false,
    );
    assertEquals(
      source.includes("ext-studio-capture-html2canvas"),
      false,
    );
    assertEquals(
      OPTIONAL_BUILTIN_EXTENSIONS.some((definition) =>
        definition.name === "ext-studio-capture-html2canvas"
      ),
      false,
    );
  });

  it("skips unavailable optional built-in implementations", async () => {
    const candidate = createOptionalBuiltinExtension({
      name: "ext-missing",
      origin: "veryfront/ext-missing",
      sourceDirectory: "ext-missing",
    });

    const logs: string[] = [];
    const deferred = getDeferredExtensionState(candidate);
    assert(deferred);
    const loaded = await deferred.load({
      debug: (message) => logs.push(message),
      info: () => {},
      warn: () => {},
      error: () => {},
    });

    assertEquals(loaded, undefined);
    assertEquals(logs.some((message) => message.includes("ext-missing")), true);
  });

  it("rejects an invalid optional built-in factory result", async () => {
    const candidate = createOptionalBuiltinExtension({
      name: "ext-invalid",
      origin: "veryfront/ext-invalid",
      sourceDirectory: "ext-invalid",
      factory: () => null as unknown as Extension,
    });

    await assertRejects(
      () => getDeferredExtensionState(candidate)!.load(noopLogger),
      Error,
      "returned an invalid extension",
    );
  });

  it("rejects optional factory identity drift", async () => {
    const candidate = createOptionalBuiltinExtension({
      name: "ext-expected",
      origin: "veryfront/ext-expected",
      sourceDirectory: "ext-expected",
      factory: () => ({
        name: "ext-unexpected",
        version: "1.0.0",
        capabilities: [],
      }),
    });

    await assertRejects(
      () => getDeferredExtensionState(candidate)!.load(noopLogger),
      Error,
      'returned extension "ext-unexpected"',
    );
  });

  it("does not materialize an optional builtin hidden by a higher-priority extension", async () => {
    let factoryCalls = 0;
    const deferred = createOptionalBuiltinExtension({
      name: "ext-overridden",
      origin: "veryfront/ext-overridden",
      sourceDirectory: "ext-overridden",
      factory: () => {
        factoryCalls++;
        return {
          name: "ext-overridden",
          version: "1.0.0",
          capabilities: [],
        };
      },
    });
    const explicit: Extension = {
      name: "ext-overridden",
      version: "2.0.0",
      capabilities: [],
    };
    const merged = mergeExtensions(
      [{ extension: explicit, source: "config", origin: "config" }],
      [],
      [],
      [],
      undefined,
      [deferred],
    );
    const loader = new ExtensionLoader(noopLogger);

    await loader.setupAll(merged, {});

    assertEquals(factoryCalls, 0);
    await loader.teardownAll();
  });

  it("declares explicit eval exporter ids for optional exporter builtins", () => {
    const mlflow = OPTIONAL_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-mlflow"
    );

    assertEquals(mlflow?.evalExporterId, "mlflow");
  });

  it("keeps MLflow builtin metadata in parity with its factory and manifest", async () => {
    const mlflow = OPTIONAL_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-mlflow"
    );
    assert(mlflow);

    const manifest = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../extensions/ext-eval-report-mlflow/deno.json",
          import.meta.url,
        ),
      ),
    ) as {
      veryfront: {
        contracts: unknown;
        capabilities: unknown;
      };
    };
    const candidate = createOptionalBuiltinExtension(mlflow);
    const extension = await getDeferredExtensionState(candidate)!.load(noopLogger);
    assert(extension);
    const builtinMetadata = {
      contracts: extension.contracts,
      capabilities: extension.capabilities,
    };
    const manifestMetadata = {
      contracts: manifest.veryfront.contracts,
      capabilities: manifest.veryfront.capabilities,
    };

    assertEquals(
      canonicalizeUnorderedMetadata(builtinMetadata),
      canonicalizeUnorderedMetadata(manifestMetadata),
    );
  });

  it("builds a minimal eval CLI builtin set for selected eval exporters", () => {
    const names = createEvalCliBuiltinExtensions(["mlflow"]).map((entry) => entry.extension.name);

    assertEquals(names.includes("ext-schema-zod"), true);
    assertEquals(names.includes("ext-eval-report-mlflow"), true);
    assertEquals(names.includes("ext-auth-jwt"), false);
    assertEquals(names.includes("ext-observability-opentelemetry"), false);
  });

  it("does not load optional eval exporter builtins when no exporters are selected", () => {
    const names = createEvalCliBuiltinExtensions([]).map((entry) => entry.extension.name);

    assertEquals(names.includes("ext-eval-report-mlflow"), false);
    assertEquals(names.includes("ext-auth-jwt"), false);
  });
});
