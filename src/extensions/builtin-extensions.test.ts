import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "./contracts.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { EvalReportExporterRegistryName } from "./eval/index.ts";
import type { Extension } from "./types.ts";
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
import { createZodAdapter } from "@veryfront/ext-schema-zod";
import { ExtensionLoader } from "./loader.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

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

  it("keeps optional candidates deferred until the loader selects them", () => {
    const authCandidate = createBuiltinExtensions().find((entry) =>
      entry.extension.name === "ext-auth-jwt"
    );

    assert(authCandidate);
    assert(getDeferredExtensionState(authCandidate));
  });

  it("ships baseline CSS and Node WebSocket providers as deferred builtins", () => {
    for (const name of ["ext-css-tailwind", "ext-node-websocket-ws"]) {
      const definition = OPTIONAL_BUILTIN_EXTENSIONS.find((entry) => entry.name === name);
      const candidate = createBuiltinExtensions().find((entry) => entry.extension.name === name);

      assert(definition, `${name} must be part of the default runtime composition`);
      assert(candidate, `${name} must have a builtin candidate`);
      assert(getDeferredExtensionState(candidate), `${name} must remain lazy until activation`);
    }
  });

  it("keeps builtin package discovery metadata auto-activated", async () => {
    for (const definition of OPTIONAL_BUILTIN_EXTENSIONS) {
      const manifest = JSON.parse(
        await Deno.readTextFile(
          new URL(
            `../../extensions/${definition.sourceDirectory}/deno.json`,
            import.meta.url,
          ),
        ),
      ) as { veryfront?: { activation?: string } };

      assertEquals(
        manifest.veryfront?.activation ?? "auto",
        "auto",
        `${definition.name} cannot be both a builtin and explicit-only package`,
      );
    }
  });

  it("does not statically import workspace implementation paths", async () => {
    const source = await Deno.readTextFile(new URL("./builtin-extensions.ts", import.meta.url));

    assertEquals(source.includes('from "../../extensions/'), false);
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

  it("does not materialize a builtin hidden by a higher-priority extension", async () => {
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
