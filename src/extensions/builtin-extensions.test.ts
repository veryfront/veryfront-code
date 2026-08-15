import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "./contracts.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { EvalReportExporterRegistryName } from "./eval/index.ts";
import type { Extension } from "./types.ts";
import type { SchemaValidator } from "./schema/index.ts";
import {
  createBuiltinExtensions,
  createDeferredBuiltinExtension,
  createEvalCliBuiltinExtensions,
  DEFERRED_BUILTIN_EXTENSIONS,
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinSchemaValidator,
} from "./builtin-extensions.ts";
import { mergeExtensions } from "./discovery.ts";
import { getDeferredExtensionState } from "./deferred-extension.ts";
import { FIRST_PARTY_EXTENSION_POLICIES } from "./first-party-defaults.ts";
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
  async function loadDeferredBuiltin(name: string): Promise<Extension> {
    const candidate = createBuiltinExtensions().find((entry) => entry.extension.name === name);
    assert(candidate);
    const deferred = getDeferredExtensionState(candidate);
    assert(deferred);
    const extension = await deferred.load(noopLogger);
    assert(extension);
    return extension;
  }

  it("uses the loaded AuthProvider extension contract as runtime metadata", async () => {
    const authExtension = await loadDeferredBuiltin("ext-auth-jwt");

    assertEquals(
      Object.hasOwn(authExtension.provides ?? {}, "AuthProvider") ||
        authExtension.contracts?.provides?.includes("AuthProvider"),
      true,
    );
  });

  it("uses the loaded OpenTelemetry contracts as runtime metadata", async () => {
    const otelExtension = await loadDeferredBuiltin(
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

  it("loads the generic HTTP eval exporter as a deferred builtin", async () => {
    const httpExtension = await loadDeferredBuiltin("ext-eval-report-http");

    assertEquals(
      httpExtension.contracts?.requires?.includes(EvalReportExporterRegistryName),
      true,
    );
  });

  it("keeps candidates deferred until the loader selects them", () => {
    const authCandidate = createBuiltinExtensions().find((entry) =>
      entry.extension.name === "ext-auth-jwt"
    );

    assert(authCandidate);
    assert(getDeferredExtensionState(authCandidate));
  });

  it("ships baseline CSS and Node WebSocket providers as deferred builtins", () => {
    for (const name of ["ext-css-tailwind", "ext-node-websocket-ws"]) {
      const definition = DEFERRED_BUILTIN_EXTENSIONS.find((entry) => entry.name === name);
      const candidate = createBuiltinExtensions().find((entry) => entry.extension.name === name);

      assert(definition, `${name} must be part of the default runtime composition`);
      assert(candidate, `${name} must have a builtin candidate`);
      assert(getDeferredExtensionState(candidate), `${name} must remain lazy until activation`);
    }
  });

  it("keeps builtin package discovery metadata auto-activated", async () => {
    for (const definition of DEFERRED_BUILTIN_EXTENSIONS) {
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

  it("classifies every first-party extension exactly once", async () => {
    const extensionDirectories: string[] = [];
    for await (const entry of Deno.readDir(new URL("../../extensions", import.meta.url))) {
      if (!entry.isDirectory || !entry.name.startsWith("ext-")) continue;
      try {
        await Deno.stat(
          new URL(`../../extensions/${entry.name}/deno.json`, import.meta.url),
        );
        extensionDirectories.push(entry.name);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }

    const policyDirectories = FIRST_PARTY_EXTENSION_POLICIES.map((policy) =>
      policy.sourceDirectory
    );
    assertEquals(
      [...new Set(policyDirectories)].sort(),
      extensionDirectories.sort(),
      "the activation policy must classify every first-party extension once",
    );
    assertEquals(
      new Set(FIRST_PARTY_EXTENSION_POLICIES.map((policy) => policy.name)).size,
      FIRST_PARTY_EXTENSION_POLICIES.length,
      "first-party extension names must be unique",
    );
  });

  it("keeps discovery activation aligned with first-party selection policy", async () => {
    for (const policy of FIRST_PARTY_EXTENSION_POLICIES) {
      const manifest = JSON.parse(
        await Deno.readTextFile(
          new URL(
            `../../extensions/${policy.sourceDirectory}/deno.json`,
            import.meta.url,
          ),
        ),
      ) as { veryfront?: { activation?: string } };
      const activation = manifest.veryfront?.activation ?? "auto";
      const expected = policy.selection === "explicit" ||
          policy.selection === "service-conditional"
        ? "explicit"
        : "auto";

      assertEquals(
        activation,
        expected,
        `${policy.name} manifest activation must match ${policy.selection}`,
      );
      if (policy.rootNpm) {
        assertEquals(
          policy.selection,
          "builtin-deferred",
          `${policy.name} cannot be a root npm dependency without builtin selection`,
        );
      }
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

  it("skips unavailable package-backed deferred implementations", async () => {
    const candidate = createDeferredBuiltinExtension({
      name: "ext-missing",
      origin: "veryfront/ext-missing",
      sourceDirectory: "ext-missing",
      availability: "package",
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

  it("rejects an invalid root-bundled deferred factory result", async () => {
    const candidate = createDeferredBuiltinExtension({
      name: "ext-invalid",
      origin: "veryfront/ext-invalid",
      sourceDirectory: "ext-invalid",
      availability: "root-bundled",
      factory: () => null as unknown as Extension,
    });

    await assertRejects(
      () => getDeferredExtensionState(candidate)!.load(noopLogger),
      Error,
      "returned an invalid extension",
    );
  });

  it("rejects deferred factory identity drift", async () => {
    const candidate = createDeferredBuiltinExtension({
      name: "ext-expected",
      origin: "veryfront/ext-expected",
      sourceDirectory: "ext-expected",
      availability: "root-bundled",
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
    const deferred = createDeferredBuiltinExtension({
      name: "ext-overridden",
      origin: "veryfront/ext-overridden",
      sourceDirectory: "ext-overridden",
      availability: "root-bundled",
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

  it("declares eval CLI selectors for deferred exporter builtins", () => {
    const http = DEFERRED_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-http"
    );
    const mlflow = DEFERRED_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-mlflow"
    );

    assertEquals(http?.evalExporterSelection, { kind: "any-selected" });
    assertEquals(mlflow?.evalExporterSelection, { kind: "id", id: "mlflow" });
  });

  it("distinguishes deferred activation from implementation availability", () => {
    const http = DEFERRED_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-http"
    );
    const mlflow = DEFERRED_BUILTIN_EXTENSIONS.find((definition) =>
      definition.name === "ext-eval-report-mlflow"
    );

    assertEquals(http?.availability, "package");
    assertEquals(mlflow?.availability, "root-bundled");
  });

  it("builds a minimal eval CLI builtin set for selected eval exporters", () => {
    const names = createEvalCliBuiltinExtensions(["http", "mlflow"]).map((entry) =>
      entry.extension.name
    );

    assertEquals(names.includes("ext-schema-zod"), true);
    assertEquals(names.includes("ext-eval-report-http"), true);
    assertEquals(names.includes("ext-eval-report-mlflow"), true);
    assertEquals(names.includes("ext-auth-jwt"), false);
    assertEquals(names.includes("ext-observability-opentelemetry"), false);
  });

  it("does not load deferred eval exporter builtins when no exporters are selected", () => {
    const names = createEvalCliBuiltinExtensions([]).map((entry) => entry.extension.name);

    assertEquals(names.includes("ext-eval-report-http"), false);
    assertEquals(names.includes("ext-eval-report-mlflow"), false);
    assertEquals(names.includes("ext-auth-jwt"), false);
  });

  it("loads the configurable HTTP exporter for custom selected ids", () => {
    const names = createEvalCliBuiltinExtensions(["internal-gateway"]).map((entry) =>
      entry.extension.name
    );

    assertEquals(names.includes("ext-eval-report-http"), true);
    assertEquals(names.includes("ext-eval-report-mlflow"), false);
  });
});
