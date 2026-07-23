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
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { EvalReportMlflowExtensionMetadata } from "../../extensions/ext-eval-report-mlflow/src/index.ts";
import { ExtensionLoader } from "./loader.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const noopExtensionContext = {
  get: () => undefined,
  require: () => {
    throw new Error("not used");
  },
  provide: () => {},
  config: {},
  logger: noopLogger,
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
  it("declares the built-in AuthProvider extension contract", () => {
    const authExtension = createBuiltinExtensions().find((entry) =>
      entry.extension.name === "ext-auth-jwt"
    );

    assertEquals(authExtension?.extension.contracts?.provides?.includes("AuthProvider"), true);
  });

  it("declares the OpenTelemetry observability extension contracts", () => {
    const otelExtension = createBuiltinExtensions().find((entry) =>
      entry.extension.name === "ext-observability-opentelemetry"
    );

    assertEquals(otelExtension?.extension.contracts?.provides?.includes("TracingExporter"), true);
    assertEquals(
      otelExtension?.extension.contracts?.provides?.includes("NodeTelemetryProvider"),
      true,
    );
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
  });

  it("skips unavailable optional built-in implementations", async () => {
    const extension = createOptionalBuiltinExtension({
      name: "ext-missing",
      origin: "veryfront/ext-missing",
      sourceDirectory: "ext-missing",
      contracts: { provides: ["MissingContract"] },
      capabilities: [],
    }).extension;

    const logs: string[] = [];
    await extension.setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
      provide: () => {
        throw new Error("should not provide when implementation is missing");
      },
      config: {},
      logger: {
        debug: (message) => logs.push(message),
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    assertEquals(logs.some((message) => message.includes("ext-missing")), true);
  });

  it("rejects an invalid optional built-in factory result", async () => {
    const extension = createOptionalBuiltinExtension({
      name: "ext-invalid",
      origin: "veryfront/ext-invalid",
      sourceDirectory: "ext-invalid",
      capabilities: [],
      factory: () => null as unknown as Extension,
    }).extension;

    await assertRejects(
      () => Promise.resolve(extension.setup?.(noopExtensionContext)),
      Error,
      "returned an invalid extension",
    );
  });

  it("tears down a successful optional implementation only once", async () => {
    let teardownCount = 0;
    const extension = createOptionalBuiltinExtension({
      name: "ext-success",
      origin: "veryfront/ext-success",
      sourceDirectory: "ext-success",
      capabilities: [],
      factory: () => ({
        name: "success-implementation",
        version: "1.0.0",
        capabilities: [],
        teardown() {
          teardownCount++;
        },
      }),
    }).extension;

    await extension.setup?.(noopExtensionContext);
    await extension.teardown?.();
    await extension.teardown?.();

    assertEquals(teardownCount, 1);
  });

  it("tears down a rejected optional implementation only once", async () => {
    let teardownCount = 0;
    const extension = createOptionalBuiltinExtension({
      name: "ext-rejection",
      origin: "veryfront/ext-rejection",
      sourceDirectory: "ext-rejection",
      capabilities: [],
      factory: () => ({
        name: "rejection-implementation",
        version: "1.0.0",
        capabilities: [],
        setup() {
          throw new Error("setup rejected");
        },
        teardown() {
          teardownCount++;
        },
      }),
    }).extension;

    await assertRejects(
      () => Promise.resolve(extension.setup?.(noopExtensionContext)),
      Error,
      "setup rejected",
    );
    await extension.teardown?.();
    await extension.teardown?.();

    assertEquals(teardownCount, 1);
  });

  it("retains an optional implementation until a failed teardown is retried", async () => {
    let teardownCount = 0;
    const extension = createOptionalBuiltinExtension({
      name: "ext-retryable-cleanup",
      origin: "veryfront/ext-retryable-cleanup",
      sourceDirectory: "ext-retryable-cleanup",
      capabilities: [],
      factory: () => ({
        name: "retryable-cleanup-implementation",
        version: "1.0.0",
        capabilities: [],
        teardown() {
          teardownCount++;
          if (teardownCount === 1) throw new Error("transient optional teardown failure");
        },
      }),
    }).extension;

    await extension.setup?.(noopExtensionContext);
    await assertRejects(
      () => Promise.resolve(extension.teardown?.()),
      Error,
      "transient optional teardown failure",
    );
    await extension.teardown?.();
    await extension.teardown?.();

    assertEquals(teardownCount, 2);
  });

  it("retains a timed-out implementation until cleanup precedes replacement", async () => {
    const setupStarted = Promise.withResolvers<void>();
    const releaseSetup = Promise.withResolvers<void>();
    let resourceOpen = false;
    let teardownCount = 0;
    let replacementStarted = false;
    let replacementSawOpenResource = false;
    const wrapped = createOptionalBuiltinExtension({
      name: "ext-late-cleanup",
      origin: "veryfront/ext-late-cleanup",
      sourceDirectory: "ext-late-cleanup",
      capabilities: [],
      factory: () => ({
        name: "late-cleanup-implementation",
        version: "1.0.0",
        capabilities: [],
        async setup() {
          setupStarted.resolve();
          await releaseSetup.promise;
          resourceOpen = true;
        },
        teardown() {
          teardownCount++;
          resourceOpen = false;
        },
      }),
    });
    const replacement = {
      source: "config" as const,
      origin: "replacement",
      extension: {
        name: "replacement",
        version: "1.0.0",
        capabilities: [],
        setup() {
          replacementStarted = true;
          replacementSawOpenResource = resourceOpen;
        },
      },
    };
    const loader = new ExtensionLoader(noopLogger);
    const timedOut = loader.setupAll([wrapped], {}, { setupTimeoutMs: 20 });

    await setupStarted.promise;
    await assertRejects(() => timedOut, Error, "ext-late-cleanup");
    assertEquals(resourceOpen, false);
    assertEquals(teardownCount, 0);

    const manualTeardown = Promise.resolve(wrapped.extension.teardown?.());
    await Promise.resolve();
    assertEquals(teardownCount, 0);

    const replacementSetup = loader.setupAll([replacement], {});
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(replacementStarted, false);

    releaseSetup.resolve();
    await Promise.all([manualTeardown, replacementSetup]);

    assertEquals(resourceOpen, false);
    assertEquals(teardownCount, 1);
    assertEquals(replacementStarted, true);
    assertEquals(replacementSawOpenResource, false);

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
    const builtinMetadata = {
      contracts: mlflow.contracts,
      capabilities: mlflow.capabilities,
    };
    const manifestMetadata = {
      contracts: manifest.veryfront.contracts,
      capabilities: manifest.veryfront.capabilities,
    };

    assertEquals(
      canonicalizeUnorderedMetadata(builtinMetadata),
      canonicalizeUnorderedMetadata(EvalReportMlflowExtensionMetadata),
    );
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
