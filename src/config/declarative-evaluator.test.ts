import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PROJECT_ENV_SNAPSHOT_LIMITS } from "#veryfront/platform/compat/process/project-env-contract.ts";
import {
  createPreparedDeclarativeConfigWorkerPayload,
  DECLARATIVE_CONFIG_LIMITS,
  type DeclarativeConfigErrorCode,
  type DeclarativeConfigErrorReason,
  DeclarativeConfigEvaluationError,
  evaluateDeclarativeConfig,
  evaluateDeclarativeConfigWithParser,
  prepareDeclarativeConfigContext,
} from "./declarative-evaluator.ts";

const DEFAULT_OPTIONS = Object.freeze({
  environmentName: "production",
  environment: Object.freeze({ NODE_ENV: "production" }),
});

async function assertEvaluationError(
  source: string,
  code: DeclarativeConfigErrorCode,
  reason: DeclarativeConfigErrorReason,
  overrides: Readonly<{
    environmentName?: string;
    environment?: unknown;
  }> = {},
): Promise<DeclarativeConfigEvaluationError> {
  const error = await assertRejects(
    () =>
      evaluateDeclarativeConfig({
        source,
        environmentName: overrides.environmentName ??
          DEFAULT_OPTIONS.environmentName,
        environment: overrides.environment ?? DEFAULT_OPTIONS.environment,
      }),
    DeclarativeConfigEvaluationError,
  ) as DeclarativeConfigEvaluationError;
  assertEquals(error.code, code);
  assertEquals(error.reason, reason);
  return error;
}

function repeatedList(value: string, count: number): string {
  return new Array<string>(count).fill(value).join(",");
}

async function runPermissionlessWorker(source: string): Promise<unknown> {
  const workerUrl = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const workerOptions: WorkerOptions & {
    deno: { permissions: "none" };
  } = {
    type: "module",
    deno: { permissions: "none" },
  };
  const worker = new Worker(workerUrl, workerOptions);

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Permissionless evaluator Worker timed out"));
      }, 5_000);
      worker.onmessage = (event: MessageEvent<unknown>) => {
        clearTimeout(timeout);
        resolve(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        clearTimeout(timeout);
        reject(new Error(`Permissionless evaluator Worker failed: ${event.message}`));
      };
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  }
}

describe("evaluateDeclarativeConfig", () => {
  it("evaluates a representative documented configuration as a frozen snapshot", async () => {
    const snapshot = await evaluateDeclarativeConfig({
      source: `
import { defineConfig } from "veryfront";

export default defineConfig({
  title: "My App",
  description: "A production app",
  router: "app",
  directories: {
    app: "app",
    components: ["components", "ui"],
  },
  build: {
    outDir: "dist",
    trailingSlash: false,
    ssg: true,
  },
  security: {
    remoteHosts: ["https://esm.sh"],
  },
});
`,
      environmentName: "production",
      environment: {},
    });

    assertEquals(snapshot, {
      build: { outDir: "dist", ssg: true, trailingSlash: false },
      description: "A production app",
      directories: {
        app: "app",
        components: ["components", "ui"],
      },
      router: "app",
      security: { remoteHosts: ["https://esm.sh"] },
      title: "My App",
    });
    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(Object.getPrototypeOf(snapshot.build), null);
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.build), true);
    assertEquals(Object.isFrozen(snapshot.directories), true);
    assertEquals(
      Object.isFrozen(
        (snapshot.directories as { components: readonly string[] }).components,
      ),
      true,
    );
    assertThrows(
      () => Object.defineProperty(snapshot, "title", { value: "mutated" }),
      TypeError,
    );
  });

  it("loads the parser-only evaluator graph in a permissionless Deno Worker", async () => {
    const evaluatorUrl = new URL(
      "./declarative-evaluator.ts",
      import.meta.url,
    ).href;
    const parserUrl = new URL(
      "../../extensions/ext-parser-babel/src/parser-only.ts",
      import.meta.url,
    ).href;
    const result = await runPermissionlessWorker(`
      import { evaluateDeclarativeConfigWithParser } from ${JSON.stringify(evaluatorUrl)};
      import { BabelParseOnlyParser } from ${JSON.stringify(parserUrl)};

      const snapshot = await evaluateDeclarativeConfigWithParser({
        source: 'import { getEnv } from "veryfront"; export default { title: getEnv("TENANT") ?? "missing", nested: { enabled: true } };',
        environmentName: "production",
        environment: { TENANT: "isolated" },
      }, new BabelParseOnlyParser());
      async function isDenied(operation) {
        try {
          await operation();
          return false;
        } catch (error) {
          return error instanceof Deno.errors.NotCapable;
        }
      }
      globalThis.postMessage({
        snapshotSummary: {
          title: snapshot.title,
          nestedEnabled: snapshot.nested.enabled,
        },
        snapshotInvariants: {
          rootNullPrototype: Object.getPrototypeOf(snapshot) === null,
          rootFrozen: Object.isFrozen(snapshot),
          nestedNullPrototype: Object.getPrototypeOf(snapshot.nested) === null,
          nestedFrozen: Object.isFrozen(snapshot.nested),
        },
        deniedCapabilities: {
          env: await isDenied(() => Deno.env.get("SECRET")),
          read: await isDenied(() => Deno.readTextFile(${JSON.stringify(evaluatorUrl)})),
          net: await isDenied(() => fetch("http://127.0.0.1:9/")),
        },
      });
    `);

    assertEquals(result, {
      snapshotSummary: {
        title: "isolated",
        nestedEnabled: true,
      },
      snapshotInvariants: {
        rootNullPrototype: true,
        rootFrozen: true,
        nestedNullPrototype: true,
        nestedFrozen: true,
      },
      deniedCapabilities: {
        env: true,
        read: true,
        net: true,
      },
    });
  });

  it("keeps the evaluator and parser-only runtime graph free of full Babel tooling", async () => {
    const entrypoints = [
      new URL("./declarative-evaluator.ts", import.meta.url).href,
      new URL(
        "../../extensions/ext-parser-babel/src/parser-only.ts",
        import.meta.url,
      ).href,
    ];
    const outputs = await Promise.all(
      entrypoints.map((entrypoint) =>
        new Deno.Command(Deno.execPath(), {
          args: ["info", "--json", entrypoint],
          stdout: "piped",
          stderr: "piped",
        }).output()
      ),
    );
    let graph = "";
    const reachableNpmNames = new Set<string>();
    for (const output of outputs) {
      assertEquals(
        output.success,
        true,
        new TextDecoder().decode(output.stderr),
      );
      const info = JSON.parse(new TextDecoder().decode(output.stdout)) as {
        modules?: Array<{
          kind?: string;
          specifier?: string;
          npmPackage?: string;
        }>;
        npmPackages?: Record<
          string,
          {
            name?: string;
            dependencies?: string[];
          }
        >;
      };
      graph += (info.modules ?? [])
        .map((module) => module.specifier ?? "")
        .join("\n");
      const packages = info.npmPackages ?? {};
      const pending = (info.modules ?? [])
        .filter((module) => module.kind === "npm")
        .flatMap((module) => typeof module.npmPackage === "string" ? [module.npmPackage] : []);
      const visited = new Set<string>();
      while (pending.length > 0) {
        const packageId = pending.pop()!;
        if (visited.has(packageId)) continue;
        visited.add(packageId);
        const packageInfo = packages[packageId];
        if (!packageInfo) continue;
        if (typeof packageInfo.name === "string") {
          reachableNpmNames.add(packageInfo.name);
        }
        for (const dependency of packageInfo.dependencies ?? []) {
          pending.push(dependency);
        }
      }
    }
    assertEquals(graph.includes("@babel/traverse"), false);
    assertEquals(graph.includes("@babel/generator"), false);
    assertEquals(/(?:^|[/+:])debug@/m.test(graph), false);
    assertEquals(reachableNpmNames.has("@babel/parser"), true);
    assertEquals(reachableNpmNames.has("@babel/traverse"), false);
    assertEquals(reachableNpmNames.has("@babel/generator"), false);
    assertEquals(reachableNpmNames.has("debug"), false);
  });

  it("supports helper aliases, safe spreads, environment branching, templates, and TS wrappers", async () => {
    const snapshot = await evaluateDeclarativeConfig({
      source: `
import {
  defineConfig as config,
  defineConfigWithEnv as byEnvironment,
  getEnv as tenantEnv,
  mergeConfigs as merge,
  type VeryfrontConfig,
} from "veryfront";

interface LocalConfig { title: string }
type RouterMode = "app" | "pages";
const router = "app" as const;
const baseDirectories = ["app"];
	const base = {
	  router,
	  description: "Very" + "front",
	  build: { outDir: "dist", ssg: 1 + 1 === 2 && !false },
} satisfies VeryfrontConfig;
const selected = byEnvironment((environment) => ({
	  title: environment === "production"
	    ? \`Production-\${tenantEnv("REGION") ?? "unknown"}\`
	    : "Development",
	  region: tenantEnv("deployment.region") ?? "missing",
	  featureFlag: tenantEnv("feature-flag") ?? "off",
  dev: { port: 3000 + 2 },
}));
const extraDirectories = ["components"];

export default config(merge(
  base,
  selected,
  { directories: [...baseDirectories, ...extraDirectories] },
) as const);
`,
      environmentName: "production",
      environment: {
        REGION: "eu",
        "deployment.region": "eu-west",
        "feature-flag": "on",
      },
    });

    assertEquals(snapshot, {
      build: { outDir: "dist", ssg: true },
      description: "Veryfront",
      dev: { port: 3002 },
      directories: ["app", "components"],
      featureFlag: "on",
      region: "eu-west",
      router: "app",
      title: "Production-eu",
    });
  });

  it("never falls through to host state and isolates concurrent tenant maps", async () => {
    const source = `
import { defineConfig, getEnv } from "veryfront";
export default defineConfig({
  title: getEnv("TENANT_NAME") ?? "missing",
  description: getEnv("HOST_ONLY") ?? "not-visible",
});
`;
    const [first, second, empty] = await Promise.all([
      evaluateDeclarativeConfig({
        source,
        environmentName: "production",
        environment: { TENANT_NAME: "first" },
      }),
      evaluateDeclarativeConfig({
        source,
        environmentName: "production",
        environment: { TENANT_NAME: "second" },
      }),
      evaluateDeclarativeConfig({
        source,
        environmentName: "production",
        environment: {},
      }),
    ]);

    assertEquals(first, { description: "not-visible", title: "first" });
    assertEquals(second, { description: "not-visible", title: "second" });
    assertEquals(empty, { description: "not-visible", title: "missing" });
  });

  it("descriptor-validates tenant environment without invoking getters", async () => {
    let getterCalls = 0;
    const environment = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(environment, "SECRET", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "host-secret";
      },
    });

    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-accessor",
      { environment },
    );
    assertEquals(getterCalls, 0);

    const inherited = Object.create({ SECRET: "inherited" });
    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-prototype",
      { environment: inherited },
    );
  });

  it("rejects every non-bare, side-effect, default, namespace, and attributed import", async () => {
    const sources = [
      'import value from "veryfront"; export default {};',
      'import * as vf from "veryfront"; export default {};',
      'import "veryfront"; export default {};',
      'import { defineConfig } from "./local.ts"; export default {};',
      'import type { Local } from "./local.ts"; export default {};',
      'import { defineConfig } from "node:fs"; export default {};',
      'import { defineConfig } from "https://example.com/config.ts"; export default {};',
      'import { defineConfig } from "veryfront" with { type: "json" }; export default {};',
    ];
    for (const source of sources) {
      const error = await assertRejects(
        () =>
          evaluateDeclarativeConfig({
            source,
            environmentName: "production",
            environment: {},
          }),
        DeclarativeConfigEvaluationError,
      ) as DeclarativeConfigEvaluationError;
      assertEquals(
        error.code === "unsupported-syntax" ||
          error.code === "syntax-error",
        true,
      );
    }
  });

  it("rejects host capabilities and inactive side effects without executing them", async () => {
    const marker = "__veryfrontDeclarativeEvaluatorSideEffect";
    const host = globalThis as Record<string, unknown>;
    const previousMarker = Object.getOwnPropertyDescriptor(host, marker);
    Object.defineProperty(host, marker, {
      value: 0,
      writable: true,
      configurable: true,
    });
    try {
      const sources = [
        `const hidden = false && globalThis.${marker}++; export default {};`,
        'const hidden = true ? null : import("./evil.ts"); export default {};',
        "const hidden = false && process.exit(1); export default {};",
        `const hidden = false || eval("globalThis.${marker} = 1"); export default {};`,
        'const hidden = Deno.env.get("SECRET"); export default {};',
        'const hidden = require("node:fs"); export default {};',
        'const hidden = Function("return process")(); export default {};',
      ];
      for (const source of sources) {
        await assertRejects(
          () =>
            evaluateDeclarativeConfig({
              source,
              environmentName: "production",
              environment: {},
            }),
          DeclarativeConfigEvaluationError,
        );
      }
      assertEquals(host[marker], 0);
    } finally {
      if (previousMarker) Object.defineProperty(host, marker, previousMarker);
      else delete host[marker];
    }
  });

  it("validates the complete program before evaluating any earlier declaration", async () => {
    const error = await assertEvaluationError(
      `const wouldFailDuringEvaluation = 1 / 0;
const laterForbidden = process.env;
export default {};`,
      "forbidden-capability",
      "unsupported-call",
    );
    assertEquals(error.phase, "validate");
    assertEquals(error.location?.line, 2);
  });

  it("rejects executable CORS, middleware, extension, and getter values", async () => {
    const marker = "__veryfrontDeclarativeGetterSideEffect";
    const host = globalThis as Record<string, unknown>;
    const previousMarker = Object.getOwnPropertyDescriptor(host, marker);
    Object.defineProperty(host, marker, {
      value: 0,
      writable: true,
      configurable: true,
    });
    const sources = [
      `export default { security: { cors: { origin: (origin) => origin === "safe" } } };`,
      `export default { middleware: { custom: [function middleware() {}] } };`,
      `export default { extensions: [extensionFactory()] };`,
      `export default { get title() { globalThis.${marker} = 1; return "x"; } };`,
      `export default { method() { return "x"; } };`,
    ];
    try {
      for (const source of sources) {
        await assertRejects(
          () =>
            evaluateDeclarativeConfig({
              source,
              environmentName: "production",
              environment: {},
            }),
          DeclarativeConfigEvaluationError,
        );
      }
      assertEquals(host[marker], 0);
    } finally {
      if (previousMarker) Object.defineProperty(host, marker, previousMarker);
      else delete host[marker];
    }
  });

  it("enforces the hosted plain-data profile after evaluation", async () => {
    const accepted = await evaluateDeclarativeConfig({
      source: `export default {
        extensions: [
          { name: "disabled-extension", enabled: false },
          { name: "@scope/disabled-extension", enabled: false },
          { name: "plugins/internal/disabled", enabled: false },
        ],
        middleware: { custom: [] },
        security: {
          cors: {
            origin: ["https://one.example", "https://two.example"],
          },
        },
      };`,
      environmentName: "production",
      environment: {},
    });
    assertEquals(accepted, {
      extensions: [
        { enabled: false, name: "disabled-extension" },
        { enabled: false, name: "@scope/disabled-extension" },
        { enabled: false, name: "plugins/internal/disabled" },
      ],
      middleware: { custom: [] },
      security: {
        cors: {
          origin: ["https://one.example", "https://two.example"],
        },
      },
    });

    for (
      const source of [
        `export default { extensions: ["plain-data"] };`,
        `export default { extensions: [{ name: "materialized", version: "1", capabilities: [] }] };`,
        `export default { extensions: [{ name: "disabled", enabled: false, extra: true }] };`,
      ]
    ) {
      await assertEvaluationError(
        source,
        "unsupported-hosted-feature",
        "hosted-extensions",
      );
    }

    for (
      const name of [
        "",
        " leading-space",
        "trailing-space ",
        "line\nbreak",
        "nul\0byte",
        "unit\u001fseparator",
        "delete\u007fcontrol",
      ]
    ) {
      await assertEvaluationError(
        `export default { extensions: [{ name: ${JSON.stringify(name)}, enabled: false }] };`,
        "unsupported-hosted-feature",
        "hosted-extensions",
      );
    }

    for (
      const source of [
        `export default { middleware: { custom: ["plain-data"] } };`,
        `export default { middleware: { custom: [{}] } };`,
        `export default { middleware: { custom: "not-an-array" } };`,
      ]
    ) {
      await assertEvaluationError(
        source,
        "unsupported-hosted-feature",
        "hosted-custom-middleware",
      );
    }

    for (
      const source of [
        `export default { security: { cors: { origin: {} } } };`,
        `export default { security: { cors: { origin: [] } } };`,
        `export default { security: { cors: { origin: ["ok", 1] } } };`,
        `export default { security: { cors: { origin: " leading-space" } } };`,
        `export default { security: { cors: { origin: ${JSON.stringify("line\nbreak")} } } };`,
        `export default { security: { cors: { origin: "snowman-☃" } } };`,
        `export default { security: { cors: { origin: [${repeatedList('"x"', 65)}] } } };`,
        `export default { security: { cors: { origin: [${
          repeatedList(JSON.stringify("a".repeat(2_048)), 5)
        }] } } };`,
        `export default { security: { cors: { origin: "${"a".repeat(2_049)}" } } };`,
      ]
    ) {
      await assertEvaluationError(
        source,
        "unsupported-hosted-feature",
        "hosted-cors-origin",
      );
    }
  });

  it("rejects pollution keys, duplicate normalized keys, and shared aliases", async () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      await assertEvaluationError(
        `export default { ${JSON.stringify(key)}: true };`,
        "forbidden-capability",
        "dangerous-key",
      );
    }
    await assertEvaluationError(
      `export default { 1: "numeric", "1": "string" };`,
      "invalid-result",
      "duplicate-key",
    );
    await assertEvaluationError(
      `const shared = { enabled: true }; export default { first: shared, second: shared };`,
      "invalid-result",
      "result-not-snapshot-safe",
    );
  });

  it("rejects mutation, loops, classes, new/member calls, runtime TS, and dynamic values", async () => {
    const sources = [
      "let value = 1; export default {};",
      "var value = 1; export default {};",
      "const value = 1; value = 2; export default {};",
      "const value = 1; value++; export default {};",
      "for (;;) { break; } export default {};",
      "while (false) {} export default {};",
      "class Config {} export default {};",
      "enum Mode { App } export default {};",
      "namespace Runtime {} export default {};",
      "export default new Date();",
      "const value = {}; export default value.toString();",
      "export default (() => ({}))();",
      "export default /pattern/;",
      "export default 1n;",
      "export default [1,,2];",
      "export default await Promise.resolve({});",
      "const { value } = { value: 1 }; export default {};",
    ];
    for (const source of sources) {
      await assertRejects(
        () =>
          evaluateDeclarativeConfig({
            source,
            environmentName: "production",
            environment: {},
          }),
        DeclarativeConfigEvaluationError,
      );
    }
  });

  it("enforces one default export and reports stable source locations", async () => {
    await assertEvaluationError(
      'import type { VeryfrontConfig } from "veryfront"; const config = {};',
      "invalid-result",
      "missing-default-export",
    );
    await assertEvaluationError(
      "export const config = {}; export default config;",
      "unsupported-syntax",
      "unsupported-export",
    );

    const duplicate = await assertEvaluationError(
      "export default {}; export default {};",
      "invalid-result",
      "duplicate-default-export",
    );
    assertEquals(duplicate.phase, "validate");

    const located = await assertEvaluationError(
      `import { defineConfig } from "veryfront";
const safe = {};
export default process.env;`,
      "forbidden-capability",
      "unsupported-call",
    );
    assertEquals(located.location?.line, 3);
    assertEquals(located.location?.fileName, "veryfront.config.ts");
  });

  it("counts every ECMAScript line terminator in source locations", async () => {
    for (
      const [name, terminator] of [
        ["LF", "\n"],
        ["CRLF", "\r\n"],
        ["CR", "\r"],
        ["LINE SEPARATOR", "\u2028"],
        ["PARAGRAPH SEPARATOR", "\u2029"],
      ] as const
    ) {
      const error = await assertEvaluationError(
        `${terminator}export default process.env;`,
        "forbidden-capability",
        "unsupported-call",
      );
      assertEquals(error.location?.line, 2, name);
      assertEquals(error.location?.column, 15, name);
      assertEquals(error.location?.offset, terminator.length + 15, name);
    }
  });

  it("rejects invalid helper use and expression-bodied factory violations", async () => {
    const sources = [
      `import { defineConfig } from "veryfront"; export default defineConfig();`,
      `import { defineConfig } from "veryfront"; export default defineConfig({}, {});`,
      `import { getEnv } from "veryfront"; export default { value: getEnv(1) };`,
      `import { getEnv } from "veryfront"; const key = "VALUE"; export default { value: getEnv(key) };`,
      'import { getEnv } from "veryfront"; export default { value: getEnv(`VALUE`) };',
      `import { mergeConfigs } from "veryfront"; export default mergeConfigs(1);`,
      `import { defineConfigWithEnv } from "veryfront"; export default defineConfigWithEnv((env) => { return { title: env }; });`,
      `import { defineConfigWithEnv } from "veryfront"; export default defineConfigWithEnv(({ name }) => ({ title: name }));`,
      `import { defineConfigWithEnv } from "veryfront"; export default defineConfigWithEnv(async (env) => ({ title: env }));`,
      `import { defineConfig } from "veryfront"; const helper = defineConfig; export default {};`,
      `const value = {}; export default value();`,
    ];
    for (const source of sources) {
      await assertRejects(
        () =>
          evaluateDeclarativeConfig({
            source,
            environmentName: "production",
            environment: {},
          }),
        DeclarativeConfigEvaluationError,
      );
    }
  });

  it("allows only homogeneous numeric or string addition", async () => {
    assertEquals(
      await evaluateDeclarativeConfig({
        source: `export default { numeric: 20 + 22, text: "Very" + "front" };`,
        environmentName: "production",
        environment: {},
      }),
      { numeric: 42, text: "Veryfront" },
    );
    await assertEvaluationError(
      `export default { title: "port-" + 3000 };`,
      "evaluation-type-error",
      "operand-type",
    );
  });

  it("rejects cross-runtime nondeterministic exponentiation", async () => {
    const error = await assertEvaluationError(
      "export default { value: 78.50374 ** 7 };",
      "unsupported-syntax",
      "unsupported-expression",
    );
    assertEquals(error.phase, "validate");
  });

  it("requires a plain record result and rejects unresolved environment sentinels", async () => {
    await assertEvaluationError(
      "export default [];",
      "invalid-result",
      "result-not-record",
    );
    await assertEvaluationError(
      `import { getEnv } from "veryfront"; export default { title: getEnv("MISSING") };`,
      "invalid-result",
      "result-not-snapshot-safe",
      { environment: {} },
    );
    await assertEvaluationError(
      'import { getEnv } from "veryfront"; export default { title: `${getEnv("MISSING")}` };',
      "invalid-result",
      "result-not-snapshot-safe",
      { environment: {} },
    );
  });

  it("enforces source, statement, import, binding, and AST limits", async () => {
    await assertEvaluationError(
      " ".repeat(DECLARATIVE_CONFIG_LIMITS.maxSourceBytes + 1),
      "source-too-large",
      "source-bytes",
    );
    await assertEvaluationError(
      "é".repeat(Math.floor(DECLARATIVE_CONFIG_LIMITS.maxSourceBytes / 2) + 1),
      "source-too-large",
      "source-bytes",
    );

    const declarations = new Array<string>();
    for (
      let index = 0;
      index < DECLARATIVE_CONFIG_LIMITS.maxTopLevelStatements;
      index += 1
    ) {
      declarations.push(`type T${index} = string;`);
    }
    await assertEvaluationError(
      `${declarations.join("")} export default {};`,
      "resource-limit-exceeded",
      "statement-count",
    );

    await assertEvaluationError(
      `import type { A } from "veryfront";
       import type { B } from "veryfront";
       export default {};`,
      "resource-limit-exceeded",
      "unsupported-import",
    );

    const typeImports = new Array<string>();
    for (
      let index = 0;
      index <= DECLARATIVE_CONFIG_LIMITS.maxImportSpecifiers;
      index += 1
    ) {
      typeImports.push(`T${index}`);
    }
    await assertEvaluationError(
      `import type { ${typeImports.join(",")} } from "veryfront"; export default {};`,
      "resource-limit-exceeded",
      "arguments",
    );

    const bindings = new Array<string>();
    for (
      let index = 0;
      index <= DECLARATIVE_CONFIG_LIMITS.maxBindings;
      index += 1
    ) {
      bindings.push(`const value${index} = ${index};`);
    }
    await assertEvaluationError(
      `${bindings.join("")} export default {};`,
      "resource-limit-exceeded",
      "binding-count",
    );

    await assertEvaluationError(
      `export default [${repeatedList("0", DECLARATIVE_CONFIG_LIMITS.maxAstNodes)}];`,
      "resource-limit-exceeded",
      "ast-nodes",
    );
  });

  it("enforces validation depth, evaluation depth, and evaluation-step limits", async () => {
    const validationNested = `${"[".repeat(DECLARATIVE_CONFIG_LIMITS.maxValidationDepth + 1)}null${
      "]".repeat(DECLARATIVE_CONFIG_LIMITS.maxValidationDepth + 1)
    }`;
    await assertEvaluationError(
      `export default ${validationNested};`,
      "resource-limit-exceeded",
      "evaluation-depth",
    );

    const evaluationNested = `${"[".repeat(DECLARATIVE_CONFIG_LIMITS.maxEvaluationDepth + 1)}null${
      "]".repeat(DECLARATIVE_CONFIG_LIMITS.maxEvaluationDepth + 1)
    }`;
    await assertEvaluationError(
      `export default ${evaluationNested};`,
      "resource-limit-exceeded",
      "evaluation-depth",
    );

    const fields = repeatedList(
      "x: 1",
      DECLARATIVE_CONFIG_LIMITS.maxObjectProperties,
    ).replaceAll("x: 1", (_match, offset) => `x${offset}: 1`);
    const stepHeavy = `
      const first = { ${fields} };
      const second = { ${fields} };
      export default { ...first, ...second };
    `;
    await assertEvaluationError(
      stepHeavy,
      "resource-limit-exceeded",
      "evaluation-steps",
    );
  });

  it("enforces argument, spread, object, array, key, and template limits", async () => {
    const argumentsList = repeatedList(
      "{}",
      DECLARATIVE_CONFIG_LIMITS.maxArguments + 1,
    );
    await assertEvaluationError(
      `import { mergeConfigs } from "veryfront"; export default mergeConfigs(${argumentsList});`,
      "resource-limit-exceeded",
      "arguments",
    );

    const emptySpreads = repeatedList(
      "...base",
      DECLARATIVE_CONFIG_LIMITS.maxSpreadOperations + 1,
    );
    await assertEvaluationError(
      `const base = {}; export default { ${emptySpreads} };`,
      "resource-limit-exceeded",
      "spread-operations",
    );

    const baseFields = new Array<string>();
    for (
      let index = 0;
      index < DECLARATIVE_CONFIG_LIMITS.maxObjectProperties;
      index += 1
    ) {
      baseFields.push(`key${index}: ${index}`);
    }
    await assertEvaluationError(
      `const base = { ${baseFields.join(",")} };
       export default { ...base, ...base, ...base };`,
      "resource-limit-exceeded",
      "spread-copies",
    );

    await assertEvaluationError(
      `export default { ${
        repeatedList(
          "value: 1",
          DECLARATIVE_CONFIG_LIMITS.maxObjectProperties + 1,
        )
      } };`,
      "resource-limit-exceeded",
      "object-properties",
    );

    await assertEvaluationError(
      `export default [${repeatedList("0", DECLARATIVE_CONFIG_LIMITS.maxArrayElements + 1)}];`,
      "resource-limit-exceeded",
      "array-elements",
    );

    const longKey = "k".repeat(
      DECLARATIVE_CONFIG_LIMITS.maxObjectKeyLength + 1,
    );
    await assertEvaluationError(
      `export default { ${JSON.stringify(longKey)}: true };`,
      "resource-limit-exceeded",
      "object-key",
    );

    const substitutions = repeatedList(
      "${value}",
      DECLARATIVE_CONFIG_LIMITS.maxTemplateExpressions + 1,
    );
    await assertEvaluationError(
      `const value = "x"; export default { title: \`${substitutions}\` };`,
      "resource-limit-exceeded",
      "template-expressions",
    );
  });

  it("enforces intermediate-string and tenant-environment limits", async () => {
    const stringFields = new Array<string>();
    for (let index = 0; index < 65; index += 1) {
      stringFields.push(`key${index}: getEnv("BIG")`);
    }
    await assertEvaluationError(
      `import { getEnv } from "veryfront"; export default { ${stringFields.join(",")} };`,
      "resource-limit-exceeded",
      "intermediate-string",
      {
        environment: {
          BIG: "v".repeat(16_384),
        },
      },
    );

    const longestEnvironmentName = "e".repeat(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentNameLength,
    );
    assertEquals(
      await evaluateDeclarativeConfig({
        source:
          `import { defineConfigWithEnv } from "veryfront"; export default defineConfigWithEnv((name) => ({ title: name }));`,
        environmentName: longestEnvironmentName,
        environment: {},
      }),
      { title: longestEnvironmentName },
    );
    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-name",
      {
        environmentName: "e".repeat(
          DECLARATIVE_CONFIG_LIMITS.maxEnvironmentNameLength + 1,
        ),
      },
    );

    const tooManyEntries = Object.create(null) as Record<string, string>;
    for (
      let index = 0;
      index <= DECLARATIVE_CONFIG_LIMITS.maxEnvironmentEntries;
      index += 1
    ) {
      tooManyEntries[`KEY_${index}`] = "value";
    }
    await assertEvaluationError(
      "export default {};",
      "resource-limit-exceeded",
      "environment-entries",
      { environment: tooManyEntries },
    );

    const longEnvironmentKey = Object.create(null) as Record<string, string>;
    longEnvironmentKey[
      `K${"E".repeat(DECLARATIVE_CONFIG_LIMITS.maxEnvironmentKeyLength)}`
    ] = "value";
    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-key",
      { environment: longEnvironmentKey },
    );

    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-value",
      {
        environment: {
          VALUE: "v".repeat(
            DECLARATIVE_CONFIG_LIMITS.maxEnvironmentValueLength + 1,
          ),
        },
      },
    );

    for (const key of ["bad\u0000key", "bad=key"]) {
      const invalidEnvironment = Object.create(null) as Record<string, string>;
      Object.defineProperty(invalidEnvironment, key, {
        value: "value",
        enumerable: true,
      });
      await assertEvaluationError(
        "export default {};",
        "input-invalid",
        "environment-key",
        { environment: invalidEnvironment },
      );
    }

    await assertEvaluationError(
      "export default {};",
      "input-invalid",
      "environment-value",
      { environment: { VALUE: "bad\u0000value" } },
    );

    const formerlyDangerousEnvironment = Object.create(null) as Record<string, string>;
    for (const key of ["__proto__", "constructor", "prototype"]) {
      Object.defineProperty(formerlyDangerousEnvironment, key, {
        value: key,
        enumerable: true,
      });
    }
    assertEquals(
      await evaluateDeclarativeConfig({
        source: `import { getEnv } from "veryfront"; export default {
          first: getEnv("__proto__"),
          second: getEnv("constructor"),
          third: getEnv("prototype"),
        };`,
        environmentName: "production",
        environment: formerlyDangerousEnvironment,
      }),
      {
        first: "__proto__",
        second: "constructor",
        third: "prototype",
      },
    );

    const byteHeavyEnvironment = Object.create(null) as Record<string, string>;
    byteHeavyEnvironment.FIRST = "v".repeat(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentBytes / 2,
    );
    byteHeavyEnvironment.SECOND = "v".repeat(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentBytes / 2,
    );
    await assertEvaluationError(
      "export default {};",
      "resource-limit-exceeded",
      "environment-bytes",
      { environment: byteHeavyEnvironment },
    );
  });

  it("prepares opaque, stable, insertion-order-independent context identities", async () => {
    const firstEnvironment = Object.create(null) as Record<string, string>;
    firstEnvironment.SECRET = "tenant-secret";
    firstEnvironment.REGION = "eu";
    const secondEnvironment = Object.create(null) as Record<string, string>;
    secondEnvironment.REGION = "eu";
    secondEnvironment.SECRET = "tenant-secret";

    const first = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: firstEnvironment,
    });
    const repeated = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: firstEnvironment,
    });
    const reordered = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: secondEnvironment,
    });
    const changedName = await prepareDeclarativeConfigContext({
      environmentName: "preview",
      environment: firstEnvironment,
    });
    const changedValue = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: { REGION: "us", SECRET: "tenant-secret" },
    });
    const framedLeft = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: { a: "bc" },
    });
    const framedRight = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: { ab: "c" },
    });
    const surrogateLeft = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: { VALUE: "\ud800" },
    });
    const surrogateRight = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment: { VALUE: "\ud801" },
    });

    assertEquals(first.cacheFingerprint, repeated.cacheFingerprint);
    assertEquals(first.cacheFingerprint, reordered.cacheFingerprint);
    assertNotEquals(first.cacheFingerprint, changedName.cacheFingerprint);
    assertNotEquals(first.cacheFingerprint, changedValue.cacheFingerprint);
    assertNotEquals(framedLeft.cacheFingerprint, framedRight.cacheFingerprint);
    assertNotEquals(
      surrogateLeft.cacheFingerprint,
      surrogateRight.cacheFingerprint,
    );
    assertMatch(first.cacheFingerprint, /^ctx1:[0-9a-f]{64}$/);
    assertEquals(Object.getPrototypeOf(first), null);
    assertEquals(Object.isFrozen(first), true);
    assertEquals(Reflect.ownKeys(first), ["cacheFingerprint"]);
    assertEquals(JSON.stringify(first).includes("tenant-secret"), false);
  });

  it("reuses a prepared snapshot without re-reading the original environment", async () => {
    const environment = { TENANT: "original" };
    const preparedContext = await prepareDeclarativeConfigContext({
      environmentName: "production",
      environment,
    });
    environment.TENANT = "mutated";

    const source = `import { getEnv } from "veryfront";
      export default { title: getEnv("TENANT") ?? "missing" };`;
    const [first, second] = await Promise.all([
      evaluateDeclarativeConfig({ source, preparedContext }),
      evaluateDeclarativeConfig({ source, preparedContext }),
    ]);
    assertEquals(first, { title: "original" });
    assertEquals(second, { title: "original" });

    const workerPayload = createPreparedDeclarativeConfigWorkerPayload(
      source,
      preparedContext,
    );
    assertEquals(
      workerPayload.cacheFingerprint,
      preparedContext.cacheFingerprint,
    );
    assertEquals(workerPayload.policyVersion, "hosted-declarative-config-v1");
    assertEquals(Object.getPrototypeOf(workerPayload), null);
    assertEquals(Object.isFrozen(workerPayload), true);
    assertEquals(Object.isFrozen(workerPayload.evaluationOptions), true);
    assertEquals(
      await evaluateDeclarativeConfig(workerPayload.evaluationOptions),
      { title: "original" },
    );

    const forged = Object.freeze({
      cacheFingerprint: preparedContext.cacheFingerprint,
    });
    const forgedError = await assertRejects(
      () => evaluateDeclarativeConfig({ source, preparedContext: forged }),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(forgedError.code, "input-invalid");
    assertEquals(forgedError.reason, "prepared-context");

    const ambiguousError = await assertRejects(
      () =>
        evaluateDeclarativeConfig({
          source,
          preparedContext,
          environmentName: "production",
          environment: {},
        } as never),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(ambiguousError.code, "input-invalid");
    assertEquals(ambiguousError.reason, "prepared-context");
  });

  it("rejects environment getters during preparation without invoking them", async () => {
    let getterCalls = 0;
    const environment = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(environment, "SECRET", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "not-read";
      },
    });
    const error = await assertRejects(
      () =>
        prepareDeclarativeConfigContext({
          environmentName: "production",
          environment,
        }),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.code, "input-invalid");
    assertEquals(error.reason, "environment-accessor");
    assertEquals(getterCalls, 0);
  });

  it("captures evaluation option data descriptors without invoking getters", async () => {
    for (
      const key of [
        "source",
        "environmentName",
        "environment",
        "preparedContext",
      ] as const
    ) {
      let getterCalls = 0;
      const options: Record<string, unknown> = {
        source: "export default {};",
        environmentName: "production",
        environment: {},
      };
      if (key === "preparedContext") {
        delete options.environmentName;
        delete options.environment;
      }
      Object.defineProperty(options, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          return undefined;
        },
      });

      const error = await assertRejects(
        () => evaluateDeclarativeConfig(options as never),
        DeclarativeConfigEvaluationError,
      ) as DeclarativeConfigEvaluationError;
      assertEquals(error.code, "input-invalid", key);
      assertEquals(error.reason, "options-accessor", key);
      assertEquals(getterCalls, 0, key);
    }
  });

  it("hardens preparation options and normalizes reflection failures", async () => {
    let getterCalls = 0;
    const accessorOptions = {
      environmentName: "production",
      environment: {},
    };
    Object.defineProperty(accessorOptions, "environment", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    const accessorError = await assertRejects(
      () => prepareDeclarativeConfigContext(accessorOptions),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(accessorError.reason, "options-accessor");
    assertEquals(getterCalls, 0);

    const nonEnumerable = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, "source", {
      value: "export default {};",
      enumerable: false,
    });
    Object.defineProperty(nonEnumerable, "environmentName", {
      value: "production",
      enumerable: true,
    });
    Object.defineProperty(nonEnumerable, "environment", {
      value: {},
      enumerable: true,
    });
    const nonEnumerableError = await assertRejects(
      () => evaluateDeclarativeConfig(nonEnumerable as never),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(nonEnumerableError.reason, "options-accessor");

    const trapped = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("not exposed");
      },
    });
    const trapError = await assertRejects(
      () => evaluateDeclarativeConfig(trapped as never),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(trapError.reason, "options-prototype");

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const revokedError = await assertRejects(
      () => evaluateDeclarativeConfig(proxy as never),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(revokedError.reason, "options-prototype");
  });

  it("descriptor-validates the injected worker parser without invoking getters", async () => {
    let getterCalls = 0;
    const parser = {};
    Object.defineProperty(parser, "parse", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return () => ({});
      },
    });
    const error = await assertRejects(
      () =>
        evaluateDeclarativeConfigWithParser(
          {
            source: "export default {};",
            environmentName: "production",
            environment: {},
          },
          parser,
        ),
      DeclarativeConfigEvaluationError,
    ) as DeclarativeConfigEvaluationError;
    assertEquals(error.code, "parser-contract-violation");
    assertEquals(error.reason, "parser-shape");
    assertEquals(getterCalls, 0);
  });

  it("normalizes malformed injected parser results", async () => {
    for (
      const malformedResult of [
        null,
        new Proxy({}, {
          getOwnPropertyDescriptor() {
            throw new Error("not exposed");
          },
        }),
      ]
    ) {
      const error = await assertRejects(
        () =>
          evaluateDeclarativeConfigWithParser(
            {
              source: "export default {};",
              environmentName: "production",
              environment: {},
            },
            {
              parse: async () => malformedResult,
            },
          ),
        DeclarativeConfigEvaluationError,
      ) as DeclarativeConfigEvaluationError;
      assertEquals(error.code, "parser-contract-violation");
      assertEquals(error.phase, "validate");
      assertEquals(error.reason, "ast-shape");
    }
  });

  it("imports without global SubtleCrypto and fails closed when Web Crypto is absent", async () => {
    const evaluatorUrl = new URL(
      "./declarative-evaluator.ts?crypto-unavailable-test",
      import.meta.url,
    ).href;
    const result = await runPermissionlessWorker(`
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });
      const { prepareDeclarativeConfigContext } = await import(${JSON.stringify(evaluatorUrl)});
      try {
        await prepareDeclarativeConfigContext({
          environmentName: "production",
          environment: {},
        });
        globalThis.postMessage({ accepted: true });
      } catch (error) {
        globalThis.postMessage({
          accepted: false,
          name: error?.name,
          code: error?.code,
          phase: error?.phase,
          reason: error?.reason,
          retryable: error?.retryable,
        });
      }
    `);
    assertEquals(result, {
      accepted: false,
      name: "DeclarativeConfigEvaluationError",
      code: "evaluator-unavailable",
      phase: "input",
      reason: "crypto-unavailable",
      retryable: true,
    });
  });

  it("maps every tenant environment limit to the platform contract", () => {
    assertEquals(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentEntries,
      PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries,
    );
    assertEquals(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentKeyLength,
      PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars,
    );
    assertEquals(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentValueLength,
      PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars,
    );
    assertEquals(
      DECLARATIVE_CONFIG_LIMITS.maxEnvironmentBytes,
      PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes,
    );
  });

  it("keeps the evaluator security policy immutable", () => {
    assertEquals(Object.isFrozen(DECLARATIVE_CONFIG_LIMITS), true);
    assertThrows(
      () =>
        Object.defineProperty(DECLARATIVE_CONFIG_LIMITS, "maxSourceBytes", {
          value: Number.MAX_SAFE_INTEGER,
        }),
      TypeError,
    );
  });
});
