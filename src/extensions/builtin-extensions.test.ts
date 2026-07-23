import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "./contracts.ts";
import type { EvalReportExporterRegistry } from "./eval/index.ts";
import { EvalReportExporterRegistryName } from "./eval/index.ts";
import type { SchemaValidator } from "./schema/index.ts";
import type { Extension } from "./types.ts";
import {
  createBuiltinExtensions,
  createEvalCliBuiltinExtensions,
  createOptionalBuiltinExtension,
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinSchemaValidator,
  OPTIONAL_BUILTIN_EXTENSIONS,
} from "./builtin-extensions.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

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
  it("validates and snapshots optional builtin definitions at creation", () => {
    const definition = {
      name: "ext-snapshotted",
      origin: "veryfront/ext-snapshotted",
      sourceDirectory: "ext-snapshotted",
      contracts: { provides: ["SnapshotContract"] },
      capabilities: [],
      factory: () => ({
        name: "ext-snapshotted",
        version: "1.0.0",
        capabilities: [],
        provides: { SnapshotContract: { ok: true } },
      }),
    };
    const resolved = createOptionalBuiltinExtension(definition);
    definition.name = "mutated";

    assertEquals(resolved.extension.name, "ext-snapshotted");
    assertThrows(
      () =>
        createOptionalBuiltinExtension({
          ...definition,
          name: "../unsafe",
          origin: "veryfront/../unsafe",
          sourceDirectory: "../unsafe",
        }),
      Error,
      "definition is invalid",
    );

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertThrows(
      () => createOptionalBuiltinExtension(revoked.proxy as typeof definition),
      Error,
      "definition is invalid",
    );
  });

  it("rejects invalid or mismatched optional factory results without leaking failures", async () => {
    const context = {
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
      provide: () => {},
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
    const canary = "private-optional-factory";
    const throwing = createOptionalBuiltinExtension({
      name: "ext-throwing",
      origin: "veryfront/ext-throwing",
      sourceDirectory: "ext-throwing",
      capabilities: [],
      factory: () => {
        throw new Error(canary);
      },
    }).extension;
    const failure = await assertRejects(() => Promise.resolve(throwing.setup?.(context)));
    assertEquals(String(failure).includes(canary), false);

    const revokedFailure = Proxy.revocable({}, {});
    revokedFailure.revoke();
    const hostile = createOptionalBuiltinExtension({
      name: "ext-hostile-failure",
      origin: "veryfront/ext-hostile-failure",
      sourceDirectory: "ext-hostile-failure",
      capabilities: [],
      factory: () => {
        throw revokedFailure.proxy;
      },
    }).extension;
    const containedFailure = await assertRejects(() => Promise.resolve(hostile.setup?.(context)));
    assertEquals(String(containedFailure).includes("revoked"), false);

    let nameReads = 0;
    const statefulResult = {
      version: "1.0.0",
      capabilities: [],
    } as Record<string, unknown>;
    Object.defineProperty(statefulResult, "name", {
      enumerable: true,
      get() {
        nameReads += 1;
        if (nameReads > 1) throw new Error("private-second-builtin-name-read");
        return "ext-stateful";
      },
    });
    const stateful = createOptionalBuiltinExtension({
      name: "ext-stateful",
      origin: "veryfront/ext-stateful",
      sourceDirectory: "ext-stateful",
      capabilities: [],
      factory: () => statefulResult as unknown as Extension,
    }).extension;
    await stateful.setup?.(context);
    assertEquals(nameReads, 1);

    const mismatched = createOptionalBuiltinExtension({
      name: "ext-declared",
      origin: "veryfront/ext-declared",
      sourceDirectory: "ext-declared",
      contracts: { provides: ["DeclaredContract"] },
      capabilities: [],
      factory: () => ({
        name: "ext-other",
        version: "1.0.0",
        capabilities: [],
        provides: { UndeclaredContract: {} },
      }),
    }).extension;
    await assertRejects(
      () => Promise.resolve(mismatched.setup?.(context)),
      Error,
      "does not match its manifest",
    );
  });

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

  it("rejects unsafe eval exporter selections", () => {
    assertThrows(
      () => createEvalCliBuiltinExtensions(["unsafe\nexporter"]),
      Error,
      "exporter ids",
    );
  });

  it("contains hostile eval exporter selection arrays", () => {
    const canary = "private-exporter-selection";
    const selections = new Proxy(["mlflow"], {
      get(target, property, receiver) {
        if (property === "0") throw new Error(canary);
        return Reflect.get(target, property, receiver);
      },
    });

    let error: unknown;
    try {
      createEvalCliBuiltinExtensions(selections);
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof Error, true);
    assertEquals(String(error).includes("exporter ids"), true);
    assertEquals(String(error).includes(canary), false);
  });

  it("forwards teardown context and clears failed optional implementations", async () => {
    const phases: string[] = [];
    const controller = new AbortController();
    const context = Object.freeze({ signal: controller.signal, phase: "rollback" as const });
    const extension = createOptionalBuiltinExtension({
      name: "ext-lifecycle",
      origin: "veryfront/ext-lifecycle",
      sourceDirectory: "ext-lifecycle",
      capabilities: [],
      factory: () => ({
        name: "ext-lifecycle",
        version: "1.0.0",
        capabilities: [],
        teardown(received) {
          phases.push(received?.phase ?? "missing");
          throw new Error("teardown failed");
        },
      }),
    }).extension;
    const setupContext = {
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
      provide: () => {},
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    await extension.setup?.(setupContext);
    await assertRejects(() => Promise.resolve(extension.teardown?.(context)));
    await extension.teardown?.(context);

    assertEquals(phases, ["rollback"]);
  });
});
