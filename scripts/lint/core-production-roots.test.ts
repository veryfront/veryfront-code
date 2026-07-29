import { win32 } from "node:path";
import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import {
  collectConfigurationDependencyEdges,
  type CoreProductionContext,
  type CoreProductionRegistry,
  isImportableBuiltin,
  isPathContained as isProductionPathContained,
  loadCoreProductionRegistry,
  resolveConfigRelativePath,
  resolveImportMapSpecifier,
  validateCoreProductionRegistry,
} from "./core-production-roots.ts";

Deno.test("production root containment is separator-agnostic for Windows paths", () => {
  const root = String.raw`C:\repo\src`;
  const implementation = {
    relative: win32.relative,
    isAbsolute: win32.isAbsolute,
    separator: win32.sep,
  };
  for (
    const [candidate, expected] of [
      [root, true],
      [String.raw`C:\repo\src\server\index.ts`, true],
      [String.raw`C:\repo\src-other\index.ts`, false],
      [String.raw`C:\repo\cli\main.ts`, false],
      [String.raw`D:\repo\src\server\index.ts`, false],
    ] as const
  ) {
    assertEquals(
      isProductionPathContained(root, candidate, implementation),
      expected,
      candidate,
    );
  }
});

const REQUIRED_RUNTIME_ROOTS = [
  "src/config/declarative-evaluator.ts",
  "src/config/declarative-evaluator-worker-entry.ts",
  "src/config/declarative-evaluator-worker-runner.ts",
  "src/index.client.ts",
  "src/proxy/main.ts",
  "src/react/public.ts",
  "src/security/sandbox/worker-script.ts",
  "src/server/production-server.ts",
];

async function writeSource(root: string, path: string): Promise<void> {
  const directory = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(`${root}/${directory}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${path}`, "export {};\n");
}

Deno.test("builtin admission is exact, public, and target-specific", () => {
  const cases: Array<[string, CoreProductionContext["target"], boolean]> = [
    ["node:fs", "node", true],
    ["node:fs/promises", "node", true],
    ["node:path/posix", "deno", true],
    ["node:sys", "node", true],
    ["node:domain", "deno", true],
    ["node:sqlite", "node", false],
    ["node:sqlite", "deno", true],
    ["node:sea", "node", false],
    ["node:inspector/promises", "node", false],
    ["node:test/reporters", "node", true],
    ["node:trace_events", "node", true],
    ["node:trace_events", "deno", false],
    ["node:traceEvents", "node", false],
    ["node:fs", "browser", false],
    ["node:fs", "universal", false],
    ["node:fs/not-a-public-subpath", "node", false],
    ["node:internal/errors", "node", false],
    ["node:_http_agent", "node", false],
    ["node:fs?query", "node", false],
    ["node:FS", "node", false],
    ["fs", "node", false],
    ["jsr:@std/path", "deno", false],
    ["deno:core", "deno", false],
    ["ext:core/mod.js", "deno", false],
    ["npm:fs", "node", false],
    ["https://example.test/mod.ts", "browser", false],
  ];
  for (const [specifier, target, expected] of cases) {
    assertEquals(
      isImportableBuiltin(specifier, target),
      expected,
      `${target}: ${specifier}`,
    );
  }
});

Deno.test("registry preserves export claims and assigns Node, Deno, browser, CLI, and testing targets", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (
      const path of [
        ...REQUIRED_RUNTIME_ROOTS,
        "src/index.ts",
        "src/react/components/Head.browser.tsx",
        "src/react/components/Head.deno.tsx",
        "src/react/components/Head.node.tsx",
        "src/testing/bdd.ts",
        "cli/main.ts",
      ]
    ) await writeSource(root, path);
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        exports: {
          ".": "./src/index.ts",
          "./alias": "./src/index.ts",
          "./head": {
            browser: "./src/react/components/Head.browser.tsx",
            deno: "./src/react/components/Head.deno.tsx",
            node: "./src/react/components/Head.node.tsx",
          },
          "./testing/bdd": "./src/testing/bdd.ts",
          "./cli": "./cli/main.ts",
        },
      }),
    );
    await Deno.mkdir(`${root}/cli`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify({ exports: { ".": "./main.ts" } }),
    );

    const registry = await loadCoreProductionRegistry(root);
    assertEquals(
      registry.contexts.map(({ id, target }) => ({ id, target })),
      [
        { id: "root-node", target: "node" },
        { id: "root-deno", target: "deno" },
        { id: "cli-node", target: "node" },
        { id: "cli-deno", target: "deno" },
        { id: "browser-runtime", target: "browser" },
      ],
    );
    assertEquals(
      registry.manifestClaims.map(({ manifestPath, exportName, path }) => ({
        manifestPath,
        exportName,
        path,
      })),
      [
        { manifestPath: "cli/deno.json", exportName: ".", path: "cli/main.ts" },
        { manifestPath: "deno.json", exportName: ".", path: "src/index.ts" },
        {
          manifestPath: "deno.json",
          exportName: "./alias",
          path: "src/index.ts",
        },
        { manifestPath: "deno.json", exportName: "./cli", path: "cli/main.ts" },
        {
          manifestPath: "deno.json",
          exportName: "./head",
          path: "src/react/components/Head.browser.tsx",
        },
        {
          manifestPath: "deno.json",
          exportName: "./head",
          path: "src/react/components/Head.deno.tsx",
        },
        {
          manifestPath: "deno.json",
          exportName: "./head",
          path: "src/react/components/Head.node.tsx",
        },
        {
          manifestPath: "deno.json",
          exportName: "./testing/bdd",
          path: "src/testing/bdd.ts",
        },
      ],
    );
    const testingTargets = registry.contexts
      .filter((context) =>
        context.entrypoints.some((entrypoint) =>
          entrypoint.path === "src/testing/bdd.ts"
        )
      )
      .map((context) => context.target);
    assertEquals(testingTargets, ["node", "deno"]);
    for (
      const [target, path] of [
        ["node", "src/react/components/Head.node.tsx"],
        ["deno", "src/react/components/Head.deno.tsx"],
        ["browser", "src/react/components/Head.browser.tsx"],
      ] as const
    ) {
      assertEquals(
        registry.contexts.find((context) => context.target === target)
          ?.entrypoints.some(
            (entrypoint) => entrypoint.path === path,
          ),
        true,
      );
      assertEquals(
        registry.contexts.filter((context) => context.target !== target).some((
          context,
        ) =>
          context.entrypoints.some((entrypoint) => entrypoint.path === path)
        ),
        false,
      );
    }
    const rootNodeIndex = registry.contexts[0].entrypoints.find((entrypoint) =>
      entrypoint.path === "src/index.ts"
    );
    assertEquals(
      rootNodeIndex?.manifestClaims.map((claim) => claim.exportName),
      [".", "./alias"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry rejects duplicate export keys, unknown conditions, and symlink ancestor escapes", async () => {
  const makeRoot = async (exports: string): Promise<string> => {
    const root = await Deno.makeTempDir();
    for (
      const path of [...REQUIRED_RUNTIME_ROOTS, "src/index.ts", "cli/main.ts"]
    ) {
      await writeSource(root, path);
    }
    await Deno.writeTextFile(`${root}/deno.json`, `{ "exports": ${exports} }`);
    await Deno.mkdir(`${root}/cli`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      '{"exports":{".":"./main.ts"}}',
    );
    return root;
  };

  const duplicateRoot = await makeRoot(
    '{".":"./src/index.ts",".":"./src/index.ts"}',
  );
  try {
    await assertRejects(
      () => loadCoreProductionRegistry(duplicateRoot),
      Error,
      "duplicate manifest export key: deno.json: .",
    );
  } finally {
    await Deno.remove(duplicateRoot, { recursive: true });
  }

  const conditionRoot = await makeRoot(
    '{".":{"default":"./src/index.ts","mystery":"./src/index.ts"}}',
  );
  try {
    await assertRejects(
      () => loadCoreProductionRegistry(conditionRoot),
      Error,
      "unknown manifest export condition: deno.json: .: mystery",
    );
  } finally {
    await Deno.remove(conditionRoot, { recursive: true });
  }

  const unsupportedRoot = await makeRoot('{".":"./README.md"}');
  try {
    await assertRejects(
      () => loadCoreProductionRegistry(unsupportedRoot),
      Error,
      "manifest export is not a supported code target: deno.json: .: ./README.md",
    );
  } finally {
    await Deno.remove(unsupportedRoot, { recursive: true });
  }

  const emptyCliRoot = await makeRoot('{".":"./src/index.ts"}');
  try {
    await Deno.writeTextFile(`${emptyCliRoot}/cli/deno.json`, '{"exports":{}}');
    await assertRejects(
      () => loadCoreProductionRegistry(emptyCliRoot),
      Error,
      "core manifest exposes zero production entrypoints: cli/deno.json",
    );
  } finally {
    await Deno.remove(emptyCliRoot, { recursive: true });
  }

  const fallbackRoot = await makeRoot(
    '{".":{"node":"./src/index.ts","default":"./src/default.ts"}}',
  );
  try {
    await writeSource(fallbackRoot, "src/default.ts");
    const registry = await loadCoreProductionRegistry(fallbackRoot);
    assertEquals(
      registry.contexts.find((context) => context.id === "root-node")
        ?.entrypoints.some(
          (entrypoint) => entrypoint.path === "src/default.ts",
        ),
      false,
    );
    assertEquals(
      registry.contexts.find((context) => context.id === "root-deno")
        ?.entrypoints.some(
          (entrypoint) => entrypoint.path === "src/default.ts",
        ),
      true,
    );
  } finally {
    await Deno.remove(fallbackRoot, { recursive: true });
  }

  const escapeRoot = await makeRoot('{".":"./src/link/escaped.ts"}');
  const outside = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${outside}/escaped.ts`, "export {};\n");
    await Deno.symlink(outside, `${escapeRoot}/src/link`);
    await assertRejects(
      () => loadCoreProductionRegistry(escapeRoot),
      Error,
      "production entrypoint escapes registered root",
    );
  } finally {
    await Deno.remove(escapeRoot, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("registry rejects percent-encoded path components before recording manifest claims", async () => {
  for (
    const target of [
      "./src/%2e%2e/extensions/evil.ts",
      "./src/%2E%2E%2fextensions/evil.ts",
      "./src/%252e%252e%255cextensions/evil.ts",
      "./src/%65vil.ts",
    ]
  ) {
    const root = await Deno.makeTempDir();
    try {
      for (
        const path of [
          ...REQUIRED_RUNTIME_ROOTS,
          target.replace(/^\.\//, ""),
          "cli/main.ts",
        ]
      ) {
        await writeSource(root, path);
      }
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({ exports: { ".": target } }),
      );
      await Deno.writeTextFile(
        `${root}/cli/deno.json`,
        JSON.stringify({ exports: { ".": "./main.ts" } }),
      );

      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest export",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("registry validates URL encoding in shadowed conditional branches before claims", async () => {
  const root = await Deno.makeTempDir();
  const encoded = "./src/%2e%2e/extensions/evil.ts";
  try {
    for (
      const path of [
        ...REQUIRED_RUNTIME_ROOTS,
        "src/index.ts",
        encoded.replace(/^\.\//, ""),
        "cli/main.ts",
      ]
    ) {
      await writeSource(root, path);
    }
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        exports: { ".": { default: "./src/index.ts", node: encoded } },
      }),
    );
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify({ exports: { ".": "./main.ts" } }),
    );

    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "manifest export",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry unions CommonJS and ESM Node conditional export branches", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (
      const path of [
        ...REQUIRED_RUNTIME_ROOTS,
        "src/cjs.ts",
        "src/node.ts",
        "src/default.ts",
        "cli/main.ts",
      ]
    ) {
      await writeSource(root, path);
    }
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        exports: {
          ".": {
            require: "./src/cjs.ts",
            node: "./src/node.ts",
            default: "./src/default.ts",
          },
        },
      }),
    );
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify({ exports: { ".": "./main.ts" } }),
    );

    const registry = await loadCoreProductionRegistry(root);
    const rootNodePaths = registry.contexts
      .find((context) => context.id === "root-node")!
      .entrypoints.map((entrypoint) => entrypoint.path);
    assertEquals(rootNodePaths.includes("src/cjs.ts"), true);
    assertEquals(rootNodePaths.includes("src/node.ts"), true);
    assertEquals(rootNodePaths.includes("src/default.ts"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry rejects missing manifests, duplicates, stale claims, and unassigned eligible files", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ exports: "." }),
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "missing-manifest: cli/deno.json",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }

  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [],
        manifestClaims: [],
        configs: new Map(),
      }),
    Error,
    "empty core production context registry",
  );
  const context: CoreProductionContext = {
    id: "same",
    target: "node",
    entrypoints: [{ id: "root", path: "src/index.ts", manifestClaims: [] }],
    assignedSource: [{ pathPrefix: "src/" }],
    configPaths: ["deno.json"],
    manifestPaths: ["deno.json"],
  };
  const duplicate: CoreProductionRegistry = {
    contexts: [context, { ...context }],
    manifestClaims: [],
    configs: new Map([["deno.json", {}]]),
  };
  assertThrows(
    () => validateCoreProductionRegistry(duplicate),
    Error,
    "duplicate core production context id: same",
  );
  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [{ ...context, assignedSource: [] }],
        manifestClaims: [],
        configs: new Map([["deno.json", {}]]),
      }, ["src/orphan.ts"]),
    Error,
    "eligible production file has no context ownership: src/orphan.ts",
  );
  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [context],
        manifestClaims: [{
          manifestPath: "deno.json",
          exportName: "./missing",
          path: "src/missing.ts",
        }],
        configs: new Map([["deno.json", {}]]),
      }),
    Error,
    "unassigned manifest export claim: deno.json: ./missing",
  );

  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [{
          ...context,
          entrypoints: [
            { id: "first", path: "src/index.ts", manifestClaims: [] },
            { id: "second", path: "src/index.ts", manifestClaims: [] },
          ],
        }],
        manifestClaims: [],
        configs: new Map([["deno.json", {}]]),
      }),
    Error,
    "duplicate entrypoint path: same: src/index.ts",
  );

  const browserClaim = {
    manifestPath: "deno.json",
    exportName: ".",
    path: "src/browser.ts",
    targets: ["browser" as const],
  };
  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [{
          ...context,
          entrypoints: [{
            id: "wrong-path",
            path: "src/index.ts",
            manifestClaims: [browserClaim],
          }],
        }],
        manifestClaims: [browserClaim],
        configs: new Map([["deno.json", {}]]),
      }),
    Error,
    "manifest claim path does not match entrypoint",
  );
  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [{
          ...context,
          entrypoints: [{
            id: "wrong-target",
            path: "src/browser.ts",
            manifestClaims: [browserClaim],
          }],
        }],
        manifestClaims: [browserClaim],
        configs: new Map([["deno.json", {}]]),
      }),
    Error,
    "manifest claim target is incompatible with context",
  );
  assertThrows(
    () =>
      validateCoreProductionRegistry({
        contexts: [{
          ...context,
          entrypoints: [{
            id: "metadata-drift",
            path: "src/browser.ts",
            manifestClaims: [{ ...browserClaim, targets: ["node"] }],
          }],
        }],
        manifestClaims: [browserClaim],
        configs: new Map([["deno.json", {}]]),
      }),
    Error,
    "manifest claim metadata differs from registry",
  );
});

Deno.test("configuration export edges preserve conditional type provenance and order", () => {
  assertEquals(
    collectConfigurationDependencyEdges("deno.json", {
      exports: {
        ".": {
          types: ["./src/first.d.ts", "npm:@evil/types/index.d.ts"],
          browser: {
            types: "../escaped/browser.d.ts",
            default: "./src/browser.ts",
          },
          default: "./src/index.ts",
        },
      },
    }).map(({ field, specifier, target }) => ({ field, specifier, target })),
    [
      { field: "exports.types", specifier: ".", target: "./src/first.d.ts" },
      {
        field: "exports.types",
        specifier: ".",
        target: "npm:@evil/types/index.d.ts",
      },
      {
        field: "exports.browser.types",
        specifier: ".",
        target: "../escaped/browser.d.ts",
      },
      {
        field: "exports.browser.default",
        specifier: ".",
        target: "./src/browser.ts",
      },
      { field: "exports.default", specifier: ".", target: "./src/index.ts" },
    ],
  );
});

Deno.test("configuration edges retain requested names and targets for every code-bearing field", () => {
  const edges = collectConfigurationDependencyEdges("deno.json", {
    imports: { "#runtime": "./src/runtime.ts" },
    scopes: { "./src/": { "#scoped": "npm:scoped@1" } },
    exports: { ".": "./src/index.ts" },
    dependencies: { dep: "npm:dep@1" },
    peerDependencies: { peer: "^1" },
    optionalDependencies: { optional: "https://example.test/mod.ts" },
    bundledDependencies: ["bundled"],
    main: "./dist/index.js",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    bin: { veryfront: "./dist/cli.js" },
    packageRoots: ["packages/other"],
    workspace: ["./cli", "./extensions/ext-one"],
    compilerOptions: {
      jsxImportSource: "npm:react@19",
      jsxImportSourceTypes: "npm:@types/react@19",
      types: ["npm:@types/node@24"],
    },
  });
  assertEquals(
    edges.map(({ field, specifier, target }) => ({ field, specifier, target })),
    [
      { field: "imports", specifier: "#runtime", target: "./src/runtime.ts" },
      { field: "scopes../src/", specifier: "#scoped", target: "npm:scoped@1" },
      { field: "exports", specifier: ".", target: "./src/index.ts" },
      { field: "dependencies", specifier: "dep", target: "npm:dep@1" },
      { field: "peerDependencies", specifier: "peer", target: "^1" },
      {
        field: "optionalDependencies",
        specifier: "optional",
        target: "https://example.test/mod.ts",
      },
      { field: "bundledDependencies", specifier: "bundled", target: "bundled" },
      { field: "main", specifier: "main", target: "./dist/index.js" },
      { field: "module", specifier: "module", target: "./dist/index.mjs" },
      { field: "types", specifier: "types", target: "./dist/index.d.ts" },
      { field: "bin", specifier: "veryfront", target: "./dist/cli.js" },
      {
        field: "packageRoots",
        specifier: "packages/other",
        target: "packages/other",
      },
      { field: "workspace", specifier: "./cli", target: "./cli" },
      {
        field: "workspace",
        specifier: "./extensions/ext-one",
        target: "./extensions/ext-one",
      },
      {
        field: "compilerOptions.jsxImportSource",
        specifier: "npm:react@19",
        target: "npm:react@19",
      },
      {
        field: "compilerOptions.jsxImportSource.runtime",
        specifier: "npm:react@19/jsx-runtime",
        target: "npm:react@19/jsx-runtime",
      },
      {
        field: "compilerOptions.jsxImportSource.dev-runtime",
        specifier: "npm:react@19/jsx-dev-runtime",
        target: "npm:react@19/jsx-dev-runtime",
      },
      {
        field: "compilerOptions.jsxImportSourceTypes",
        specifier: "npm:@types/react@19",
        target: "npm:@types/react@19",
      },
      {
        field: "compilerOptions.jsxImportSourceTypes.runtime",
        specifier: "npm:@types/react@19/jsx-runtime",
        target: "npm:@types/react@19/jsx-runtime",
      },
      {
        field: "compilerOptions.jsxImportSourceTypes.dev-runtime",
        specifier: "npm:@types/react@19/jsx-dev-runtime",
        target: "npm:@types/react@19/jsx-dev-runtime",
      },
      {
        field: "compilerOptions.types",
        specifier: "npm:@types/node@24",
        target: "npm:@types/node@24",
      },
    ],
  );
});

Deno.test("configuration edge enumeration fails closed on malformed code-bearing fields", () => {
  for (
    const config of [
      { imports: [] },
      { scopes: { "./src/": 42 } },
      { dependencies: "npm:dep@1" },
      { compilerOptions: { types: "npm:@types/node" } },
    ]
  ) {
    assertThrows(
      () => collectConfigurationDependencyEdges("deno.json", config),
      Error,
      "malformed configuration dependency field",
    );
  }
  assertEquals(
    collectConfigurationDependencyEdges("package.json", {
      exports: "./src/index.ts",
      browser: { "./server.ts": "./browser.ts" },
    }).map(({ field, specifier, target }) => ({ field, specifier, target })),
    [
      { field: "exports", specifier: ".", target: "./src/index.ts" },
      { field: "browser", specifier: "./server.ts", target: "./browser.ts" },
    ],
  );
});

Deno.test("import maps use scoped longest matches and reject cycles or equal-precedence ambiguity", () => {
  const layers = [{
    path: "deno.json",
    imports: { "#": "./src/", "#runtime/": "./src/runtime/" },
    scopes: { "./src/server/": { "#runtime/": "./src/server/runtime/" } },
  }];
  assertEquals(
    resolveImportMapSpecifier("#runtime/nested.ts", layers, "src/client.ts"),
    "./src/runtime/nested.ts",
  );
  assertEquals(
    resolveImportMapSpecifier(
      "#runtime/nested.ts",
      layers,
      "src/server/index.ts",
    ),
    "./src/server/runtime/nested.ts",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("#a", [{
        path: "deno.json",
        imports: { "#a": "#b", "#b": "#a" },
      }]),
    Error,
    "import-map alias cycle: #a -> #b -> #a",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("loop/value.ts", [{
        path: "deno.json",
        imports: { "loop/": "loop/x/" },
      }]),
    Error,
    "import-map alias cycle",
  );
  assertEquals(
    resolveConfigRelativePath(
      "/repo",
      "cli/deno.json",
      resolveImportMapSpecifier("#x", [{
        path: "cli/deno.json",
        imports: { "#x": "./shared/x.ts" },
      }]),
    ),
    "cli/shared/x.ts",
  );
  assertThrows(
    () => resolveConfigRelativePath("/repo", "deno.json", "/outside/evil.ts"),
    Error,
    "absolute configuration paths are not permitted",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("#runtime", [
        { path: "deno.json", imports: { "#runtime": "./src/a.ts" } },
        { path: "cli/deno.json", imports: { "#runtime": "./cli/a.ts" } },
      ]),
    Error,
    "ambiguous import-map match for #runtime",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("#same", [
        { path: "deno.json", imports: { "#same": "./same.ts" } },
        { path: "cli/deno.json", imports: { "#same": "./same.ts" } },
      ]),
    Error,
    "ambiguous import-map match for #same",
  );
  assertThrows(
    () => resolveConfigRelativePath("/repo", "deno.json", "../outside.ts"),
    Error,
    "configuration target escapes repository root",
  );
  assertThrows(
    () =>
      resolveConfigRelativePath("/repo", "deno.json", "file:///tmp/outside.ts"),
    Error,
    "file URL escapes repository root",
  );
});

Deno.test("live registry claims independently match every root and CLI export", async () => {
  const registry = await loadCoreProductionRegistry(".");
  const root = JSON.parse(await Deno.readTextFile("deno.json"));
  const cli = JSON.parse(await Deno.readTextFile("cli/deno.json"));
  const expected = [
    ...Object.entries(root.exports).map(([exportName, path]) =>
      `deno.json\0${exportName}\0${String(path).replace(/^\.\//, "")}`
    ),
    ...Object.entries(cli.exports).map(([exportName, path]) =>
      `cli/deno.json\0${exportName}\0cli/${String(path).replace(/^\.\//, "")}`
    ),
  ].sort();
  const actual = registry.manifestClaims.map((claim) =>
    `${claim.manifestPath}\0${claim.exportName}\0${claim.path}`
  ).sort();
  assertEquals(actual, expected);
  for (
    const path of [
      "src/testing/index.ts",
      "src/testing/assert.ts",
      "src/testing/bdd.ts",
    ]
  ) {
    assertEquals(
      registry.contexts.filter((context) =>
        context.entrypoints.some((entrypoint) => entrypoint.path === path)
      ).map((context) => context.target),
      ["node", "deno"],
    );
  }
  assertEquals(
    registry.contexts.some((context) =>
      context.entrypoints.some((entrypoint) =>
        entrypoint.path.startsWith("extensions/")
      )
    ),
    false,
  );
  const workspaceEdges = collectConfigurationDependencyEdges("deno.json", root)
    .filter((edge) => edge.field === "workspace");
  assertEquals(workspaceEdges.length, root.workspace.length);
});
