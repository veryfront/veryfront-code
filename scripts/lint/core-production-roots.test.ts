import { win32 } from "node:path";
import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import { toFileUrl } from "#std/path";
import { BROWSER_SAFE_INTERNAL_ENTRY_POINTS } from "../build/browser-safe-exports.mjs";
import { isPathContained as isProductionPathContained } from "../lib/path-containment.ts";
import {
  assertCanonicalPathEncoding,
  collectConfigurationDependencyEdges,
  CORE_RUNTIME_ENTRYPOINTS,
  type CoreProductionContext,
  type CoreProductionRegistry,
  createImportMapResolver,
  isImportableBuiltin,
  loadCoreProductionRegistry,
  resolveConfigRelativePath,
  resolveImportMapSpecifier,
  resolveImportMapSpecifierWithTrace,
  validateCoreProductionRegistry,
} from "./core-production-roots.ts";

Deno.test("production root containment is separator-agnostic for Windows paths", () => {
  const implementation = {
    relative: win32.relative,
    isAbsolute: win32.isAbsolute,
    separator: win32.sep,
  };
  for (
    const [root, candidate, expected] of [
      [String.raw`C:\repo\src`, String.raw`C:\repo\src`, true],
      [
        String.raw`C:\repo\src`,
        String.raw`C:\repo\src\server\index.ts`,
        true,
      ],
      [String.raw`C:\repo\src`, String.raw`C:\repo\src-other\index.ts`, false],
      [String.raw`C:\repo\src`, String.raw`C:\repo\cli\main.ts`, false],
      [
        String.raw`C:\repo\src`,
        String.raw`D:\repo\src\server\index.ts`,
        false,
      ],
      [
        String.raw`\\server\share\repo\src`,
        String.raw`\\server\share\repo\src\server\index.ts`,
        true,
      ],
      [
        String.raw`\\server\share\repo\src`,
        String.raw`\\other\share\repo\src\server\index.ts`,
        false,
      ],
    ] as const
  ) {
    assertEquals(
      isProductionPathContained(root, candidate, implementation),
      expected,
      candidate,
    );
  }
});

const REQUIRED_ADDITIONAL_RUNTIME_ROOTS = [
  "src/proxy/main.ts",
  "src/security/sandbox/worker-script.ts",
  "src/server/production-server.ts",
];

const REQUIRED_BROWSER_RUNTIME_ROOTS = Object.values(
  BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
).map((path) => path.replace(/^\.\//, ""));

const REQUIRED_RUNTIME_ROOTS = [
  ...new Set([
    ...REQUIRED_ADDITIONAL_RUNTIME_ROOTS,
    ...REQUIRED_BROWSER_RUNTIME_ROOTS,
  ]),
].sort();

Deno.test("runtime root inventory composes existing browser and supplemental entrypoints", async () => {
  assertEquals(CORE_RUNTIME_ENTRYPOINTS, REQUIRED_RUNTIME_ROOTS);
  for (const path of CORE_RUNTIME_ENTRYPOINTS) {
    const source = await Deno.lstat(path);
    assertEquals(source.isFile && !source.isSymlink, true, path);
  }
});

async function writeSource(root: string, path: string): Promise<void> {
  const directory = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(`${root}/${directory}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${path}`, "export {};\n");
}

async function writeSupplementalProductionPackages(
  root: string,
): Promise<void> {
  await writeSource(root, "react/react.ts");
  await Deno.writeTextFile(
    `${root}/react/deno.json`,
    JSON.stringify({ name: "@fixture/react", exports: "./react.ts" }),
  );
}

async function registryFixture(
  rootConfig: Record<string, unknown>,
): Promise<string> {
  const root = await Deno.makeTempDir();
  for (
    const path of [...REQUIRED_RUNTIME_ROOTS, "src/index.ts", "cli/main.ts"]
  ) {
    await writeSource(root, path);
  }
  await Deno.writeTextFile(
    `${root}/deno.json`,
    JSON.stringify(rootConfig),
  );
  await Deno.writeTextFile(
    `${root}/cli/deno.json`,
    JSON.stringify({ name: "@fixture/cli", exports: "./main.ts" }),
  );
  await writeSupplementalProductionPackages(root);
  return root;
}

Deno.test("registry rejects a declared runtime entrypoint whose source is missing", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: {
      ".": "./src/index.ts",
      "./cli": "./cli/main.ts",
    },
  });
  try {
    const missingPath = REQUIRED_ADDITIONAL_RUNTIME_ROOTS[0];
    await Deno.remove(`${root}/${missingPath}`);
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      `missing production entrypoint: root-node: ${missingPath}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function checkWithDenoConfig(
  root: string,
  entrypoint = "src/index.ts",
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "check",
      "--reload",
      "--config",
      `${root}/deno.json`,
      `${root}/${entrypoint}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function denoConfigWith(member: string): string {
  return `{
    "name": "fixture",
    "exports": {
      ".": "./src/index.ts",
      "./cli": "./cli/main.ts"
    },
    "imports": {},
    ${member}
  }`;
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
    ["NoDe:fs", "node", false],
    ["NoDe:fs", "deno", true],
    ["NODE:fs/promises", "deno", true],
    ["NoDe:FS", "deno", false],
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
    await writeSupplementalProductionPackages(root);

    const registry = await loadCoreProductionRegistry(root);
    assertEquals(
      registry.contexts.map(({ id, target }) => ({ id, target })),
      [
        { id: "root-node", target: "node" },
        { id: "root-deno", target: "deno" },
        { id: "cli-node", target: "node" },
        { id: "cli-deno", target: "deno" },
        { id: "browser-runtime", target: "browser" },
        { id: "react-deno", target: "deno" },
      ],
    );
    const browserInternalPaths = Object.values(
      BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
    ).map((path) => path.replace(/^\.\//, "")).sort();
    assertEquals(
      registry.contexts.find((context) => context.id === "browser-runtime")
        ?.entrypoints.map((entrypoint) => entrypoint.path).filter((path) =>
          REQUIRED_RUNTIME_ROOTS.includes(path)
        ).sort(),
      browserInternalPaths,
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
        {
          manifestPath: "react/deno.json",
          exportName: ".",
          path: "react/react.ts",
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
    await writeSupplementalProductionPackages(root);
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
      await writeSupplementalProductionPackages(root);

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
    await writeSupplementalProductionPackages(root);

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
    await writeSupplementalProductionPackages(root);

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
    packageConfigPaths: ["deno.json"],
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
        manifestClaims: [],
        configs: new Map([["deno.json", {}]]),
      }, []),
    Error,
    "zero eligible production files",
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

Deno.test("JSX dependency synthesis follows the selected Deno mode exactly", () => {
  const cases = [
    {
      mode: "react-jsx",
      expected: [{
        field: "compilerOptions.jsxImportSource.runtime",
        target: "#jsx//jsx-runtime",
      }],
    },
    {
      mode: "react-jsxdev",
      expected: [{
        field: "compilerOptions.jsxImportSource.dev-runtime",
        target: "#jsx//jsx-dev-runtime",
      }],
    },
    { mode: "preserve", expected: [] },
  ] as const;
  for (const { mode, expected } of cases) {
    assertEquals(
      collectConfigurationDependencyEdges("deno.json", {
        compilerOptions: { jsx: mode, jsxImportSource: "#jsx/" },
      }).map(({ field, target }) => ({ field, target })),
      [...expected],
      mode,
    );
  }
});

Deno.test("import maps keep percent-bearing bare keys opaque and reject empty keys", () => {
  const resolver = createImportMapResolver([{
    path: "deno.json",
    imports: { "#opaque%2Fkey": "./src/value.ts" },
  }]);
  assertEquals(
    resolver.resolve("#opaque%2Fkey", "src/index.ts"),
    "./src/value.ts",
  );
  assertThrows(
    () =>
      createImportMapResolver([{
        path: "deno.json",
        imports: { "": "./src/value.ts" },
      }]),
    Error,
    "empty import-map key",
  );
});

Deno.test("file URL conversion rejects non-local authorities", () => {
  for (const authority of ["example.test", "127.0.0.1", "[::1]"]) {
    assertThrows(
      () =>
        resolveConfigRelativePath(
          "/repo",
          "deno.json",
          `file://${authority}/repo/src/index.ts`,
        ),
      Error,
      "must use a local file URL",
    );
    assertThrows(
      () =>
        createImportMapResolver([{
          path: "deno.json",
          repositoryRootUrl: `file://${authority}/repo/`,
          imports: {},
        }]),
      Error,
      "must use a local file URL",
    );
  }
});

Deno.test("import maps use scoped longest matches and reject malformed or equal-precedence mappings", () => {
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
    "invalid import-map target address",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("#runtime/value.ts", [{
        path: "deno.json",
        imports: { "#runtime/": "./src/runtime" },
      }]),
    Error,
    "import-map prefix target must end with /",
  );
  assertThrows(
    () =>
      resolveImportMapSpecifier("#runtime/%2e%2e%2fevil.ts", [{
        path: "deno.json",
        imports: { "#runtime/": "./src/runtime/" },
      }]),
    Error,
    "import-map prefix target backtracks outside its canonical address",
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
  for (
    const decoration of [
      "",
      "?flavor=1",
      "#piece",
      "?flavor=%31",
      "#piece-%31",
      "?",
      "#",
    ]
  ) {
    const target = `./src/configured-types.d.ts${decoration}`;
    assertEquals(
      resolveConfigRelativePath(
        "/repo",
        "deno.json",
        target,
      ),
      "src/configured-types.d.ts",
    );
    assertEquals(
      resolveConfigRelativePath(
        "/repo",
        "deno.json",
        `FILE:///repo/src/configured-types.d.ts${decoration}`,
      ),
      "src/configured-types.d.ts",
    );
    assertEquals(
      createImportMapResolver([{ path: "deno.json", imports: {} }])
        .resolveWithTrace(target, "deno.json"),
      {
        resolved: target,
        trace: [target],
        origin: { kind: "request", base: "importer" },
        localPath: "src/configured-types.d.ts",
      },
    );
  }
});

Deno.test("import-map resolution preserves the request and one selected address", () => {
  const resolution = resolveImportMapSpecifierWithTrace(
    "#facade",
    [{
      path: "deno.json",
      imports: {
        "#facade": "./src/selected.ts",
        "./src/selected.ts": "./src/not-selected.ts",
      },
    }],
    "src/index.ts",
  );

  assertEquals(resolution, {
    resolved: "./src/selected.ts",
    trace: ["#facade", "./src/selected.ts"],
    origin: { kind: "mapping", base: "./" },
    localPath: "src/selected.ts",
    mapping: {
      owner: "deno.json",
      base: "./",
      sourceKey: "#facade",
      canonicalKey: "#facade",
      selectedAddress: "./src/selected.ts",
      canonicalTarget: "./src/selected.ts",
    },
  });
  assertEquals(
    resolveImportMapSpecifier("#facade", [{
      path: "deno.json",
      imports: {
        "#facade": "./src/selected.ts",
        "./src/selected.ts": "./src/not-selected.ts",
      },
    }], "src/index.ts"),
    resolution.resolved,
  );
});

Deno.test("URL-like import-map keys and one-hop targets match Deno", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src`);
    const imports = {
      "./src/dep.ts": "./src/mapped.ts",
      "#facade": "./src/a.test.ts",
      "./src/a.test.ts": "./src/b.ts",
      "#encoded": "./src/%65ncoded.ts",
      "./src/%65ncoded-key.ts": "./src/key-mapped.ts",
      "./src/equal.ts": "./equal.ts",
      "#prefix/": "./src/prefix/",
    };
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ imports }),
    );
    await Deno.writeTextFile(
      `${root}/src/main.ts`,
      'import { marker as relative } from "./dep.ts";\n' +
        'import { marker as facade } from "#facade";\n' +
        'import { marker as encoded } from "#encoded";\n' +
        'import { marker as encodedKey } from "./%65ncoded-key.ts";\n' +
        'import { marker as equal } from "./equal.ts";\n' +
        'import { marker as prefix } from "#prefix/%68idden.ts";\n' +
        "console.log(`${relative}:${facade}:${encoded}:${encodedKey}:${equal}:${prefix}`);\n",
    );
    await Deno.writeTextFile(
      `${root}/src/dep.ts`,
      'export const marker = "local";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/mapped.ts`,
      'export const marker = "mapped";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/a.test.ts`,
      'export const marker = "a";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/b.ts`,
      'export const marker = "b";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/encoded.ts`,
      'export const marker = "encoded";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/encoded-key.ts`,
      'export const marker = "physical-key";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/key-mapped.ts`,
      'export const marker = "mapped-key";\n',
    );
    await Deno.writeTextFile(
      `${root}/src/equal.ts`,
      'export const marker = "importer-relative";\n',
    );
    await Deno.writeTextFile(
      `${root}/equal.ts`,
      'export const marker = "map-relative";\n',
    );
    await Deno.mkdir(`${root}/src/prefix`);
    await Deno.writeTextFile(
      `${root}/src/prefix/hidden.ts`,
      'export const marker = "canonical-prefix";\n',
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/src/main.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    assertEquals(
      new TextDecoder().decode(runtime.stdout),
      "mapped:a:encoded:mapped-key:map-relative:canonical-prefix\n",
    );

    const resolver = createImportMapResolver([{
      path: "deno.json",
      baseUrl: toFileUrl(`${root}/deno.json`).href,
      repositoryRootUrl: toFileUrl(`${root}/`).href,
      imports,
    }]);
    assertEquals(resolver.resolveWithTrace("./dep.ts", "src/main.ts"), {
      resolved: "./src/mapped.ts",
      trace: ["./dep.ts", "./src/mapped.ts"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/mapped.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "./src/dep.ts",
        canonicalKey: "./src/dep.ts",
        selectedAddress: "./src/mapped.ts",
        canonicalTarget: "./src/mapped.ts",
      },
    });
    assertEquals(resolver.resolveWithTrace("#facade", "src/main.ts"), {
      resolved: "./src/a.test.ts",
      trace: ["#facade", "./src/a.test.ts"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/a.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#facade",
        canonicalKey: "#facade",
        selectedAddress: "./src/a.test.ts",
        canonicalTarget: "./src/a.test.ts",
      },
    });
    assertEquals(resolver.resolveWithTrace("#encoded", "src/main.ts"), {
      resolved: "./src/encoded.ts",
      trace: ["#encoded", "./src/encoded.ts"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/encoded.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#encoded",
        canonicalKey: "#encoded",
        selectedAddress: "./src/%65ncoded.ts",
        canonicalTarget: "./src/encoded.ts",
      },
    });
    assertEquals(
      resolver.resolveWithTrace("./%65ncoded-key.ts", "src/main.ts"),
      {
        resolved: "./src/key-mapped.ts",
        trace: [
          "./%65ncoded-key.ts",
          "./src/encoded-key.ts",
          "./src/key-mapped.ts",
        ],
        origin: { kind: "mapping", base: "./" },
        localPath: "src/key-mapped.ts",
        mapping: {
          owner: "deno.json",
          base: "./",
          sourceKey: "./src/%65ncoded-key.ts",
          canonicalKey: "./src/%65ncoded-key.ts",
          selectedAddress: "./src/key-mapped.ts",
          canonicalTarget: "./src/key-mapped.ts",
        },
      },
    );
    assertEquals(
      resolver.resolveWithTrace("./%65ncoded.ts", "src/main.ts"),
      {
        resolved: "./src/encoded.ts",
        trace: ["./%65ncoded.ts", "./src/encoded.ts"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/encoded.ts",
      },
    );
    assertEquals(resolver.resolveWithTrace("./equal.ts", "src/main.ts"), {
      resolved: "./equal.ts",
      trace: ["./equal.ts"],
      origin: { kind: "mapping", base: "./" },
      localPath: "equal.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "./src/equal.ts",
        canonicalKey: "./src/equal.ts",
        selectedAddress: "./equal.ts",
        canonicalTarget: "./equal.ts",
      },
    });
    assertEquals(
      resolver.resolveWithTrace("#prefix/%68idden.ts", "src/main.ts"),
      {
        resolved: "./src/prefix/hidden.ts",
        trace: [
          "#prefix/%68idden.ts",
          "./src/prefix/hidden.ts",
        ],
        origin: { kind: "mapping", base: "./" },
        localPath: "src/prefix/hidden.ts",
        mapping: {
          owner: "deno.json",
          base: "./",
          sourceKey: "#prefix/",
          canonicalKey: "#prefix/",
          selectedAddress: "./src/prefix/%68idden.ts",
          canonicalTarget: "./src/prefix/hidden.ts",
        },
      },
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("decorated file targets match Deno", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src`);
    const imports = {
      "#query": "./src/hidden.test.ts?flavor=1",
      "#hash": "./src/hidden.test.ts#piece",
      "#encoded-query": "./src/hidden.test.ts?flavor=%31",
      "#encoded-hash": "./src/hidden.test.ts#piece-%31",
      "#empty-query": "./src/hidden.test.ts?",
      "#empty-hash": "./src/hidden.test.ts#",
    };
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ imports }),
    );
    await Deno.writeTextFile(
      `${root}/src/hidden.test.ts`,
      "export const moduleUrl = import.meta.url;\n",
    );
    await Deno.writeTextFile(
      `${root}/src/main.ts`,
      'import { moduleUrl as mappedQuery } from "#query";\n' +
        'import { moduleUrl as mappedHash } from "#hash";\n' +
        'import { moduleUrl as mappedEncodedQuery } from "#encoded-query";\n' +
        'import { moduleUrl as mappedEncodedHash } from "#encoded-hash";\n' +
        'import { moduleUrl as mappedEmptyQuery } from "#empty-query";\n' +
        'import { moduleUrl as mappedEmptyHash } from "#empty-hash";\n' +
        'import { moduleUrl as directQuery } from "./hidden.test.ts?direct=1";\n' +
        'import { moduleUrl as directHash } from "./hidden.test.ts#direct";\n' +
        'import { moduleUrl as directEncodedQuery } from "./hidden.test.ts?direct=%31";\n' +
        'import { moduleUrl as directEncodedHash } from "./hidden.test.ts#direct-%31";\n' +
        'import { moduleUrl as directEmptyQuery } from "./hidden.test.ts?";\n' +
        'import { moduleUrl as directEmptyHash } from "./hidden.test.ts#";\n' +
        "console.log(JSON.stringify([mappedQuery, mappedHash, mappedEncodedQuery, mappedEncodedHash, mappedEmptyQuery, mappedEmptyHash, directQuery, directHash, directEncodedQuery, directEncodedHash, directEmptyQuery, directEmptyHash]));\n",
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/src/main.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    const repositoryUrl = toFileUrl(`${root}/`).href;
    assertEquals(
      JSON.parse(new TextDecoder().decode(runtime.stdout)),
      [
        new URL("src/hidden.test.ts?flavor=1", repositoryUrl).href,
        new URL("src/hidden.test.ts#piece", repositoryUrl).href,
        new URL("src/hidden.test.ts?flavor=%31", repositoryUrl).href,
        new URL("src/hidden.test.ts#piece-%31", repositoryUrl).href,
        new URL("src/hidden.test.ts?", repositoryUrl).href,
        new URL("src/hidden.test.ts#", repositoryUrl).href,
        new URL("src/hidden.test.ts?direct=1", repositoryUrl).href,
        new URL("src/hidden.test.ts#direct", repositoryUrl).href,
        new URL("src/hidden.test.ts?direct=%31", repositoryUrl).href,
        new URL("src/hidden.test.ts#direct-%31", repositoryUrl).href,
        new URL("src/hidden.test.ts?", repositoryUrl).href,
        new URL("src/hidden.test.ts#", repositoryUrl).href,
      ],
    );

    const resolver = createImportMapResolver([{
      path: "deno.json",
      baseUrl: toFileUrl(`${root}/deno.json`).href,
      repositoryRootUrl: repositoryUrl,
      imports,
    }]);
    assertEquals(resolver.resolveWithTrace("#query", "src/main.ts"), {
      resolved: "./src/hidden.test.ts?flavor=1",
      trace: ["#query", "./src/hidden.test.ts?flavor=1"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/hidden.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#query",
        canonicalKey: "#query",
        selectedAddress: "./src/hidden.test.ts?flavor=1",
        canonicalTarget: "./src/hidden.test.ts?flavor=1",
      },
    });
    assertEquals(resolver.resolveWithTrace("#hash", "src/main.ts"), {
      resolved: "./src/hidden.test.ts#piece",
      trace: ["#hash", "./src/hidden.test.ts#piece"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/hidden.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#hash",
        canonicalKey: "#hash",
        selectedAddress: "./src/hidden.test.ts#piece",
        canonicalTarget: "./src/hidden.test.ts#piece",
      },
    });
    assertEquals(
      resolver.resolveWithTrace("#encoded-query", "src/main.ts"),
      {
        resolved: "./src/hidden.test.ts?flavor=%31",
        trace: ["#encoded-query", "./src/hidden.test.ts?flavor=%31"],
        origin: { kind: "mapping", base: "./" },
        localPath: "src/hidden.test.ts",
        mapping: {
          owner: "deno.json",
          base: "./",
          sourceKey: "#encoded-query",
          canonicalKey: "#encoded-query",
          selectedAddress: "./src/hidden.test.ts?flavor=%31",
          canonicalTarget: "./src/hidden.test.ts?flavor=%31",
        },
      },
    );
    assertEquals(resolver.resolveWithTrace("#empty-query", "src/main.ts"), {
      resolved: "./src/hidden.test.ts?",
      trace: ["#empty-query", "./src/hidden.test.ts?"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/hidden.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#empty-query",
        canonicalKey: "#empty-query",
        selectedAddress: "./src/hidden.test.ts?",
        canonicalTarget: "./src/hidden.test.ts?",
      },
    });
    assertEquals(resolver.resolveWithTrace("#empty-hash", "src/main.ts"), {
      resolved: "./src/hidden.test.ts#",
      trace: ["#empty-hash", "./src/hidden.test.ts#"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/hidden.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#empty-hash",
        canonicalKey: "#empty-hash",
        selectedAddress: "./src/hidden.test.ts#",
        canonicalTarget: "./src/hidden.test.ts#",
      },
    });
    assertEquals(
      resolver.resolveWithTrace(
        "./hidden.test.ts?direct=1",
        "src/main.ts",
      ),
      {
        resolved: "./hidden.test.ts?direct=1",
        trace: ["./hidden.test.ts?direct=1"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/hidden.test.ts",
      },
    );
    assertEquals(
      resolver.resolveWithTrace("./hidden.test.ts?", "src/main.ts"),
      {
        resolved: "./hidden.test.ts?",
        trace: ["./hidden.test.ts?"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/hidden.test.ts",
      },
    );
    assertEquals(
      resolver.resolveWithTrace("./hidden.test.ts#", "src/main.ts"),
      {
        resolved: "./hidden.test.ts#",
        trace: ["./hidden.test.ts#"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/hidden.test.ts",
      },
    );
    assertEquals(
      resolver.resolveWithTrace("./hidden.test.ts#direct", "src/main.ts"),
      {
        resolved: "./hidden.test.ts#direct",
        trace: ["./hidden.test.ts#direct"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/hidden.test.ts",
      },
    );
    assertEquals(
      resolver.resolveWithTrace(
        "./hidden.test.ts?direct=%31",
        "src/main.ts",
      ),
      {
        resolved: "./hidden.test.ts?direct=%31",
        trace: ["./hidden.test.ts?direct=%31"],
        origin: { kind: "request", base: "importer" },
        localPath: "src/hidden.test.ts",
      },
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("raw encoded file-URL paths retain evidence and canonical traversal", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeSource(
      root,
      "src/evil.test.ts",
    );
    await Deno.writeTextFile(
      `${root}/src/evil.test.ts`,
      "export const moduleUrl = import.meta.url;\n",
    );
    const repositoryUrl = toFileUrl(`${root}/`).href;
    const deepUrl = new URL("src/deep/", repositoryUrl).href;
    const encodedPathUrl = `${deepUrl}%2e%2e/evil.test.ts?flavor=%31#piece-%31`;
    const plainPathUrl = new URL(
      "src/evil.test.ts?plain=%31#plain-%31",
      repositoryUrl,
    ).href;
    const mixedCaseEncodedPathUrl = encodedPathUrl.replace(
      /^file:/,
      "FiLe:",
    ).replace("flavor=%31", "flavor=%32");
    const mixedCasePlainPathUrl = plainPathUrl.replace(/^file:/, "FILE:")
      .replace("plain=%31", "plain=%32");
    await Deno.writeTextFile(
      `${root}/main.ts`,
      `import { moduleUrl as encoded } from ${
        JSON.stringify(encodedPathUrl)
      };\n` +
        `import { moduleUrl as plain } from ${
          JSON.stringify(plainPathUrl)
        };\n` +
        `import { moduleUrl as mixedEncoded } from ${
          JSON.stringify(mixedCaseEncodedPathUrl)
        };\n` +
        `import { moduleUrl as mixedPlain } from ${
          JSON.stringify(mixedCasePlainPathUrl)
        };\n` +
        "console.log(JSON.stringify([encoded, plain, mixedEncoded, mixedPlain]));\n",
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: ["run", `${root}/main.ts`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    assertEquals(
      JSON.parse(new TextDecoder().decode(runtime.stdout)),
      [
        new URL("src/evil.test.ts?flavor=%31#piece-%31", repositoryUrl)
          .href,
        plainPathUrl,
        new URL("src/evil.test.ts?flavor=%32#piece-%31", repositoryUrl)
          .href,
        new URL("src/evil.test.ts?plain=%32#plain-%31", repositoryUrl).href,
      ],
    );

    assertThrows(
      () => assertCanonicalPathEncoding(encodedPathUrl, "source target"),
      Error,
      "contains a percent-encoded path component",
    );
    assertCanonicalPathEncoding(plainPathUrl, "source target");
    assertThrows(
      () =>
        assertCanonicalPathEncoding(mixedCaseEncodedPathUrl, "source target"),
      Error,
      "contains a percent-encoded path component",
    );
    assertCanonicalPathEncoding(mixedCasePlainPathUrl, "source target");
    const resolver = createImportMapResolver([{
      path: "deno.json",
      baseUrl: new URL("deno.json", repositoryUrl).href,
      repositoryRootUrl: repositoryUrl,
      imports: {},
    }]);
    assertEquals(resolver.resolveWithTrace(encodedPathUrl, "src/index.ts"), {
      resolved: "./src/evil.test.ts?flavor=%31#piece-%31",
      trace: [
        encodedPathUrl,
        "./src/evil.test.ts?flavor=%31#piece-%31",
      ],
      origin: { kind: "request", base: "importer" },
      localPath: "src/evil.test.ts",
    });
    assertEquals(resolver.resolveWithTrace(plainPathUrl, "src/index.ts"), {
      resolved: plainPathUrl,
      trace: [plainPathUrl],
      origin: { kind: "request", base: "importer" },
      localPath: "src/evil.test.ts",
    });
    assertEquals(
      resolver.resolveWithTrace(mixedCaseEncodedPathUrl, "src/index.ts"),
      {
        resolved: "./src/evil.test.ts?flavor=%32#piece-%31",
        trace: [
          mixedCaseEncodedPathUrl,
          "./src/evil.test.ts?flavor=%32#piece-%31",
        ],
        origin: { kind: "request", base: "importer" },
        localPath: "src/evil.test.ts",
      },
    );
    assertEquals(
      resolver.resolveWithTrace(mixedCasePlainPathUrl, "src/index.ts"),
      {
        resolved: mixedCasePlainPathUrl,
        trace: [mixedCasePlainPathUrl],
        origin: { kind: "request", base: "importer" },
        localPath: "src/evil.test.ts",
      },
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("bare import-map decorations stay distinct from encoded paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src/bare`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/src/bare/exact.test.ts`,
      "export const moduleUrl = import.meta.url;\n",
    );
    await Deno.writeTextFile(
      `${root}/src/bare/value.test.ts`,
      "export const moduleUrl = import.meta.url;\n",
    );
    const exactSpecifier = "#exact?flavor=%31#piece-%32";
    const prefixSpecifier = "#prefix/value.test.ts?flavor=%31#piece-%32";
    const encodedPathSpecifier = "#prefix/%76alue.test.ts?flavor=%33#piece-%34";
    const imports = {
      [exactSpecifier]: "./src/bare/exact.test.ts",
      "#prefix/": "./src/bare/",
    };
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ imports }),
    );
    await Deno.writeTextFile(
      `${root}/main.ts`,
      `import { moduleUrl as exact } from ${
        JSON.stringify(exactSpecifier)
      };\n` +
        `import { moduleUrl as prefix } from ${
          JSON.stringify(prefixSpecifier)
        };\n` +
        `import { moduleUrl as encodedPath } from ${
          JSON.stringify(encodedPathSpecifier)
        };\n` +
        "console.log(JSON.stringify([exact, prefix, encodedPath]));\n",
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/main.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    const repositoryUrl = toFileUrl(`${root}/`).href;
    assertEquals(
      JSON.parse(new TextDecoder().decode(runtime.stdout)),
      [
        new URL("src/bare/exact.test.ts", repositoryUrl).href,
        new URL(
          "src/bare/value.test.ts?flavor=1#piece-2",
          repositoryUrl,
        ).href,
        new URL(
          "src/bare/value.test.ts?flavor=3#piece-4",
          repositoryUrl,
        ).href,
      ],
    );

    assertCanonicalPathEncoding(exactSpecifier, "source target");
    assertCanonicalPathEncoding(prefixSpecifier, "source target");
    assertThrows(
      () => assertCanonicalPathEncoding(encodedPathSpecifier, "source target"),
      Error,
      "contains a percent-encoded path component",
    );
    const resolver = createImportMapResolver([{
      path: "deno.json",
      baseUrl: new URL("deno.json", repositoryUrl).href,
      repositoryRootUrl: repositoryUrl,
      imports,
    }]);
    assertEquals(resolver.resolveWithTrace(exactSpecifier, "src/index.ts"), {
      resolved: "./src/bare/exact.test.ts",
      trace: [exactSpecifier, "./src/bare/exact.test.ts"],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/bare/exact.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: exactSpecifier,
        canonicalKey: exactSpecifier,
        selectedAddress: "./src/bare/exact.test.ts",
        canonicalTarget: "./src/bare/exact.test.ts",
      },
    });
    assertEquals(resolver.resolveWithTrace(prefixSpecifier, "src/index.ts"), {
      resolved: "./src/bare/value.test.ts?flavor=%31#piece-%32",
      trace: [
        prefixSpecifier,
        "./src/bare/value.test.ts?flavor=%31#piece-%32",
      ],
      origin: { kind: "mapping", base: "./" },
      localPath: "src/bare/value.test.ts",
      mapping: {
        owner: "deno.json",
        base: "./",
        sourceKey: "#prefix/",
        canonicalKey: "#prefix/",
        selectedAddress: "./src/bare/value.test.ts?flavor=%31#piece-%32",
        canonicalTarget: "./src/bare/value.test.ts?flavor=%31#piece-%32",
      },
    });
    assertEquals(
      resolver.resolveWithTrace(encodedPathSpecifier, "src/index.ts"),
      {
        resolved: "./src/bare/value.test.ts?flavor=%33#piece-%34",
        trace: [
          encodedPathSpecifier,
          "./src/bare/value.test.ts?flavor=%33#piece-%34",
        ],
        origin: { kind: "mapping", base: "./" },
        localPath: "src/bare/value.test.ts",
        mapping: {
          owner: "deno.json",
          base: "./",
          sourceKey: "#prefix/",
          canonicalKey: "#prefix/",
          selectedAddress: "./src/bare/%76alue.test.ts?flavor=%33#piece-%34",
          canonicalTarget: "./src/bare/value.test.ts?flavor=%33#piece-%34",
        },
      },
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("used opaque import-map prefixes fail exactly when Deno fails", async () => {
  const root = await Deno.makeTempDir();
  try {
    const imports = {
      "#opaque/": "data:text/javascript,export default 1;/",
      "#opaque/safe/": "./src/safe/",
    };
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ imports }),
    );
    await Deno.writeTextFile(
      `${root}/main.ts`,
      'import "#opaque/value.ts";\n',
    );
    await writeSource(root, "src/safe/value.ts");
    await Deno.writeTextFile(
      `${root}/safe.ts`,
      'import "#opaque/safe/value.ts";\n',
    );
    const shadowedRuntime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/safe.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      shadowedRuntime.code,
      0,
      new TextDecoder().decode(shadowedRuntime.stderr),
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/main.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const runtimeError = new TextDecoder().decode(runtime.stderr);
    assertEquals(runtime.code, 1, runtimeError);
    assertEquals(
      runtimeError.includes(
        "could not be URL-parsed relative to the URL prefix",
      ),
      true,
      runtimeError,
    );

    const resolver = createImportMapResolver([{
      path: "deno.json",
      baseUrl: toFileUrl(`${root}/deno.json`).href,
      repositoryRootUrl: toFileUrl(`${root}/`).href,
      imports,
    }]);
    assertEquals(resolver.resolve("#unused", "main.ts"), "#unused");
    assertEquals(
      resolver.resolveWithTrace("#opaque/safe/value.ts", "safe.ts"),
      {
        resolved: "./src/safe/value.ts",
        trace: ["#opaque/safe/value.ts", "./src/safe/value.ts"],
        origin: { kind: "mapping", base: "./" },
        localPath: "src/safe/value.ts",
        mapping: {
          owner: "deno.json",
          base: "./",
          sourceKey: "#opaque/safe/",
          canonicalKey: "#opaque/safe/",
          selectedAddress: "./src/safe/value.ts",
          canonicalTarget: "./src/safe/value.ts",
        },
      },
    );
    assertThrows(
      () => resolver.resolve("#opaque/value.ts", "main.ts"),
      Error,
      "could not be URL-parsed relative to import-map prefix target",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("compiled import-map resolvers validate every mapping and enumerate each layer once", () => {
  let enumerations = 0;
  const imports = new Proxy(
    {
      "#first": "./src/first.ts",
      "#second": "./src/terminal.ts",
    },
    {
      ownKeys(target) {
        enumerations++;
        return Reflect.ownKeys(target);
      },
    },
  );
  const resolver = createImportMapResolver([{ path: "deno.json", imports }]);
  assertEquals(enumerations, 1);
  assertEquals(resolver.resolve("#first", "src/index.ts"), "./src/first.ts");
  assertEquals(resolver.resolveWithTrace("#first", "src/index.ts"), {
    resolved: "./src/first.ts",
    trace: ["#first", "./src/first.ts"],
    origin: { kind: "mapping", base: "./" },
    localPath: "src/first.ts",
    mapping: {
      owner: "deno.json",
      base: "./",
      sourceKey: "#first",
      canonicalKey: "#first",
      selectedAddress: "./src/first.ts",
      canonicalTarget: "./src/first.ts",
    },
  });
  assertEquals(
    resolver.resolve("#second", "src/index.ts"),
    "./src/terminal.ts",
  );
  assertEquals(enumerations, 1);
  assertThrows(
    () =>
      createImportMapResolver([{
        path: "deno.json",
        imports: {
          "#selected": "./src/selected.ts",
          "#unused-invalid": "file://[",
        },
      }]),
    Error,
    "invalid import-map target",
  );
});

Deno.test("import-map scopes match Deno in canonical file-URL space", async () => {
  const root = await Deno.makeTempDir();
  try {
    await writeSource(root, "src/scoped/value.ts");
    await Deno.writeTextFile(
      `${root}/src/scoped/value.ts`,
      'export const marker = "relative";\n',
    );
    await writeSource(root, "src/deep/runtime/value.ts");
    await Deno.writeTextFile(
      `${root}/src/deep/runtime/value.ts`,
      'export const marker = "file";\n',
    );
    await writeSource(root, "src/deep/probe.ts");
    await Deno.writeTextFile(
      `${root}/src/deep/probe.ts`,
      'import { marker } from "#runtime/value.ts";\nconsole.log(marker);\n',
    );
    const fileScope = toFileUrl(`${root}/src/deep/`).href;
    const config = {
      imports: { "#runtime/": "./src/default/" },
      scopes: {
        "./src/": { "#runtime/": "./src/scoped/" },
        [fileScope]: { "#runtime/": "./src/deep/runtime/" },
      },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/src/deep/probe.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    assertEquals(new TextDecoder().decode(runtime.stdout), "file\n");

    assertEquals(
      resolveImportMapSpecifier(
        "#runtime/value.ts",
        [{
          path: "deno.json",
          baseUrl: toFileUrl(`${root}/deno.json`).href,
          repositoryRootUrl: toFileUrl(`${root}/`).href,
          ...config,
        }],
        "src/deep/probe.ts",
      ),
      "./src/deep/runtime/value.ts",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry retains ordered runtime export-array alternatives and explicit package ownership", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: {
      ".": "./src/index.ts",
      "./head": {
        browser: ["./src/z-first.ts", "./src/a-later.ts"],
        default: "./src/index.ts",
      },
      "./cli": "./cli/main.ts",
    },
  });
  try {
    await writeSource(root, "src/z-first.ts");
    await writeSource(root, "src/a-later.ts");
    const registry = await loadCoreProductionRegistry(root);
    assertEquals(
      registry.manifestClaims
        .filter((claim) =>
          claim.manifestPath === "deno.json" &&
          claim.exportName === "./head" &&
          claim.targets?.includes("browser")
        )
        .sort((left, right) =>
          (left.alternativeIndex ?? 0) - (right.alternativeIndex ?? 0)
        )
        .map(({ path, alternativeIndex }) => ({ path, alternativeIndex })),
      [
        { path: "src/z-first.ts", alternativeIndex: 0 },
        { path: "src/a-later.ts", alternativeIndex: 1 },
      ],
    );
    assertEquals(
      registry.contexts.map(({ id, packageConfigPaths }) => ({
        id,
        packageConfigPaths,
      })),
      [
        { id: "root-node", packageConfigPaths: ["deno.json"] },
        { id: "root-deno", packageConfigPaths: ["deno.json"] },
        { id: "cli-node", packageConfigPaths: ["cli/deno.json"] },
        { id: "cli-deno", packageConfigPaths: ["cli/deno.json"] },
        { id: "browser-runtime", packageConfigPaths: ["deno.json"] },
        { id: "react-deno", packageConfigPaths: ["react/deno.json"] },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry keeps decorated manifest identities separate from physical paths", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts?flavor=prod#entry" },
  });
  try {
    const registry = await loadCoreProductionRegistry(root);
    const claim = registry.manifestClaims.find((entry) =>
      entry.manifestPath === "deno.json" && entry.exportName === "."
    );
    assertEquals(claim?.path, "src/index.ts");
    assertEquals(claim?.identity, "src/index.ts?flavor=prod#entry");
    assertEquals(
      registry.contexts.find((context) => context.id === "root-deno")
        ?.entrypoints.find((entrypoint) => entrypoint.path === "src/index.ts")
        ?.identity,
      "src/index.ts?flavor=prod#entry",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry reads decorated external import maps physically and retains their identity", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: "./src/index.ts",
    importMap: "./maps/import-map.json?revision=1#map",
  });
  try {
    await Deno.mkdir(`${root}/maps`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/maps/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    const registry = await loadCoreProductionRegistry(root);
    assertEquals(
      registry.configs.has("maps/import-map.json?revision=1#map"),
      true,
    );
    assertEquals(
      registry.contexts.find((context) => context.id === "root-deno")
        ?.configPaths,
      ["deno.json", "maps/import-map.json?revision=1#map"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("manifest duplicate detection recognizes escaped-equivalent export keys", async () => {
  const root = await registryFixture({ exports: "./src/index.ts" });
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      '{"exports":{"\\u002e":"./src/index.ts",".":"./src/index.ts"}}',
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "duplicate manifest export key: deno.json: .",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry accepts Deno JSONC without weakening escaped duplicate detection", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        // Deno config files accept line and block comments.
        "name": "fixture",
        "exports": {
          ".": "./src/index.ts",
          "./cli": "./cli/main.ts", /* trailing member */
        },
        "imports": {},
        "lint": {
          "include": ["src/",],
        },
        "tasks": {
          "literal": "echo // not-a-comment /* still-a-string */ ,}",
        },
      }
      `,
    );
    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        `${root}/deno.json`,
        `${root}/src/index.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));

    const registry = await loadCoreProductionRegistry(root);
    assertEquals(registry.configs.get("deno.json")?.tasks, {
      literal: "echo // not-a-comment /* still-a-string */ ,}",
    });

    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        // JSONC normalization must preserve decoded key equality.
        "exports": {
          "\\u002e": "./src/index.ts",
          ".": "./src/index.ts",
        },
      }
      `,
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "duplicate manifest export key: deno.json: .",
    );

    await Deno.writeTextFile(
      `${root}/deno.json`,
      '{ "exports": "./src/index.ts" /* unterminated',
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "manifest-parse-failure: deno.json: unterminated block comment",
    );

    await Deno.writeTextFile(
      `${root}/deno.json`,
      '\uFEFF{ "exports": "./src/index.ts" }',
    );
    const bomRuntime = await new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        `${root}/deno.json`,
        `${root}/src/index.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(bomRuntime.code, 1);
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "manifest-parse-failure: deno.json",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry matches Deno line-comment termination boundaries", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const cases: ReadonlyArray<readonly [string, string, boolean]> = [
    ["line-feed", "\n", true],
    ["carriage-return-line-feed", "\r\n", true],
    ["bare-carriage-return", "\r", false],
    ["line-separator", "\u2028", false],
    ["paragraph-separator", "\u2029", false],
  ];
  try {
    await Deno.writeTextFile(`${root}/src/index.ts`, 'import "#sentinel";\n');
    for (const [label, separator, terminatesComment] of cases) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        `{
          name: "fixture",
          exports: {
            ".": "./src/index.ts",
            "./cli": "./cli/main.ts",
          },
          // comment${separator}          imports: { "#sentinel": "./cli/main.ts" }
        }
        `,
      );

      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(
        runtime.code,
        terminatesComment ? 0 : 1,
        `${label}: ${runtimeError}`,
      );
      if (!terminatesComment) {
        assertEquals(
          runtimeError.includes('Import "#sentinel" not a dependency'),
          true,
          `${label}: ${runtimeError}`,
        );
      }

      const registry = await loadCoreProductionRegistry(root);
      assertEquals(
        Object.hasOwn(registry.configs.get("deno.json")!, "imports"),
        terminatesComment,
        label,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry consumes Deno loose keys and single-quoted import mappings", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  try {
    await Deno.writeTextFile(
      `${root}/src/mapped.ts`,
      "export const marker: 1 = 1;\n",
    );
    await Deno.writeTextFile(
      `${root}/src/index.ts`,
      'import { marker } from "#mapped";\nconst checked: 1 = marker;\n',
    );
    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        name: 'fixture',
        exports: {
          '.': './src/index.ts',
          './cli': './cli/main.ts',
        },
        imports: {
          '#mapped': './src/mapped.ts',
        },
      }`,
    );

    const runtime = await checkWithDenoConfig(root);
    assertEquals(
      runtime.code,
      0,
      new TextDecoder().decode(runtime.stderr),
    );
    const registry = await loadCoreProductionRegistry(root);
    assertEquals(registry.configs.get("deno.json")?.imports, {
      "#mapped": "./src/mapped.ts",
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry matches Deno loose object-key token boundaries", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const accepted = [
    ["ascii", "probe", "probe"],
    ["underscore", "_probe", "_probe"],
    ["prototype-name", "__proto__", "__proto__"],
    ["constructor-name", "constructor", "constructor"],
    ["unicode-letter", "café", "café"],
    ["unicode-word", "é-名", "é-名"],
    ["unicode-number", "٣", "٣"],
    ["hyphen", "probe-name", "probe-name"],
    ["repeated-hyphen", "a--b", "a--b"],
    ["reserved-default", "default", "default"],
    ["reserved-import", "import", "import"],
    ["word-nan", "NaN", "NaN"],
    ["word-infinity", "Infinity", "Infinity"],
    ["word-undefined", "undefined", "undefined"],
    ["keyword-alphanumeric-suffix", "truex", "truex"],
    ["keyword-unicode-number-suffix", "true٣", "true٣"],
    ["comment-before-colon", "probe /* colon */", "probe"],
    ["integer", "1", "1"],
    ["unary-plus", "+1", "+1"],
    ["negative", "-1", "-1"],
    ["decimal", "1.20", "1.20"],
    ["exponent", "1e3", "1e3"],
    ["signed-exponent", "1E-3", "1E-3"],
    ["hex", "0x10", "0x10"],
    ["negative-hex", "-0x10", "-0x10"],
  ] as const;
  const rejected = [
    ["boolean-true", "true"],
    ["boolean-false", "false"],
    ["null", "null"],
    ["keyword-hyphen-suffix", "true-x"],
    ["keyword-underscore-suffix", "false_1"],
    ["null-hyphen-suffix", "null-"],
    ["dollar", "$probe"],
    ["leading-hyphen-word", "-probe"],
    ["digit-word", "1probe"],
    ["leading-dot", ".5"],
    ["trailing-dot", "1."],
    ["leading-zero", "01"],
    ["octal", "0o7"],
    ["binary", "0b10"],
    ["dotted", "probe.name"],
    ["whitespace", "probe name"],
    ["at-sign", "@probe"],
    ["hash", "#probe"],
    ["slash", "probe/name"],
    ["numeric-separator", "1_000"],
    ["escaped-identifier", String.raw`\u0070robe`],
  ] as const;
  try {
    for (const [label, source, expected] of accepted) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"tasks": { ${source}: "echo ok" }`),
      );
      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(runtime.code, 0, `${label}: ${runtimeError}`);
      const registry = await loadCoreProductionRegistry(root);
      const tasks = registry.configs.get("deno.json")?.tasks as Record<
        string,
        unknown
      >;
      assertEquals(
        Object.keys(tasks),
        [expected],
        label,
      );
      assertEquals(Object.getPrototypeOf(tasks), Object.prototype, label);
    }

    for (const [label, source] of rejected) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"tasks": { ${source}: "echo ok" }`),
      );
      const runtime = await checkWithDenoConfig(root);
      assertEquals(runtime.code, 1, label);
      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry matches Deno quoted-string and Unicode escape boundaries", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const accepted = [
    ["single", "'plain'", "plain"],
    ["apostrophe", String.raw`'it\'s'`, "it's"],
    ["raw-double-quote", `'say "hi"'`, 'say "hi"'],
    ["backslash", String.raw`'C:\\tmp'`, String.raw`C:\tmp`],
    ["slash", String.raw`'a\/b'`, "a/b"],
    ["controls", String.raw`'\b\f\n\r\t'`, "\b\f\n\r\t"],
    ["bmp-unicode", String.raw`'\u0061'`, "a"],
    ["unicode-pair-single", String.raw`'\uD83D\uDE00'`, "😀"],
    ["unicode-pair-double", String.raw`"\uD83D\uDE00"`, "😀"],
    ["raw-newline-single", "'line\nbreak'", "line\nbreak"],
    ["raw-newline-double", '"line\nbreak"', "line\nbreak"],
    ["raw-tab", "'tab\tinside'", "tab\tinside"],
    [
      "comment-markers",
      "'// literal /* literal */ , } : {'",
      "// literal /* literal */ , } : {",
    ],
  ] as const;
  const rejected = [
    ["escaped-double-in-single", String.raw`'bad\"escape'`],
    ["hex-escape", String.raw`'\x41'`],
    ["vertical-tab-escape", String.raw`'\v'`],
    ["nul-escape", String.raw`'\0'`],
    ["braced-unicode", String.raw`'\u{0041}'`],
    ["uppercase-unicode", String.raw`'\U0041'`],
    ["identity-escape", String.raw`'\q'`],
    ["line-continuation", "'line\\" + "\n" + "break'"],
    ["lone-high-single", String.raw`'\uD800'`],
    ["lone-low-single", String.raw`'\uDC00'`],
    ["bad-pair-single", String.raw`'\uD800\u0041'`],
    ["lone-high-double", String.raw`"\uD800"`],
    ["lone-low-double", String.raw`"\uDC00"`],
    ["escaped-apostrophe-double", String.raw`"can\'t"`],
    ["unterminated-single", "'unterminated"],
  ] as const;
  try {
    for (const [label, source, expected] of accepted) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"tasks": { "probe": ${source} }`),
      );
      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(runtime.code, 0, `${label}: ${runtimeError}`);
      const registry = await loadCoreProductionRegistry(root);
      assertEquals(
        (registry.configs.get("deno.json")?.tasks as Record<string, unknown>)
          .probe,
        expected,
        label,
      );
    }

    for (const [label, source] of rejected) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"tasks": { "probe": ${source} }`),
      );
      const runtime = await checkWithDenoConfig(root);
      assertEquals(runtime.code, 1, label);
      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry anchors malformed Deno config diagnostics where Deno does", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const cases = [
    ["invalid-escape", String.raw`'\q'`],
    ["lone-high-surrogate", String.raw`'\uD800'`],
    ["invalid-surrogate-pair", String.raw`'\uD800\u0041'`],
    ["unterminated-string", "'unterminated"],
    ["raw-carriage-return", "'raw\r\\q'"],
    ["raw-line-separator", "'raw\u2028\\q'"],
    ["raw-paragraph-separator", "'raw\u2029\\q'"],
  ] as const;
  try {
    for (const [label, source] of cases) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"probe": ${source}`),
      );
      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(runtime.code, 1, `${label}: ${runtimeError}`);
      const match = runtimeError.match(/line (\d+) column (\d+)/);
      assertEquals(match !== null, true, `${label}: ${runtimeError}`);
      const expectedLocation = `line ${match![1]} column ${match![2]}`;
      const localError = await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
      assertEquals(
        localError.message.includes(expectedLocation),
        true,
        `${label}: ${localError.message}; Deno: ${runtimeError}`,
      );
    }

    for (
      const [label, content] of [
        ["unterminated-object", '{"probe": 1'],
        ["unterminated-array", "[1"],
        [
          "invalid-loose-key",
          denoConfigWith('"tasks": { foo.bar: "echo ok" }'),
        ],
        [
          "unterminated-block-comment",
          denoConfigWith('"probe": 1 /* unterminated'),
        ],
      ] as const
    ) {
      await Deno.writeTextFile(`${root}/deno.json`, content);
      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(runtime.code, 1, `${label}: ${runtimeError}`);
      const match = runtimeError.match(/line (\d+) column (\d+)/);
      assertEquals(match !== null, true, `${label}: ${runtimeError}`);
      const expectedLocation = `line ${match![1]} column ${match![2]}`;
      const localError = await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
      assertEquals(
        localError.message.includes(expectedLocation),
        true,
        `${label}: ${localError.message}; Deno: ${runtimeError}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry matches Deno non-JSON number boundaries", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const accepted: ReadonlyArray<readonly [string, string, unknown]> = [
    ["unary-plus", "+80", 80],
    ["plus-fraction", "+0.5", 0.5],
    ["plus-exponent", "+8e1", 80],
    ["hex", "0x50", 80],
    ["upper-hex", "0X50", 80],
    ["plus-hex", "+0x50", 80],
    ["negative-hex", "-0x50", -80],
    ["negative-zero-hex", "-0x0", 0],
    ["leading-zero-hex", "0x00000000000000001", 1],
    ["maximum-i64-hex", "0x7fffffffffffffff", 9223372036854776000],
    ["overflow-i64-hex", "0x8000000000000000", "0x8000000000000000"],
    [
      "negative-overflow-i64-hex",
      "-0x8000000000000000",
      "-0x8000000000000000",
    ],
    ["decimal-overflow", "1e400", "1e400"],
  ];
  const rejected = [
    ["binary", "0b1010"],
    ["octal", "0o12"],
    ["leading-dot", ".5"],
    ["trailing-dot", "80."],
    ["separator", "1_000"],
    ["nan", "NaN"],
    ["infinity", "Infinity"],
    ["plus-infinity", "+Infinity"],
    ["double-sign", "--1"],
    ["bare-plus", "+"],
    ["empty-hex", "0x"],
    ["invalid-hex", "0xG"],
    ["leading-zero", "01"],
    ["word", "undefined"],
  ] as const;
  try {
    for (const [label, source, expected] of accepted) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"probe": ${source}`),
      );
      const runtime = await checkWithDenoConfig(root);
      const runtimeError = new TextDecoder().decode(runtime.stderr);
      assertEquals(runtime.code, 0, `${label}: ${runtimeError}`);
      const registry = await loadCoreProductionRegistry(root);
      assertEquals(registry.configs.get("deno.json")?.probe, expected, label);
    }

    for (const [label, source] of rejected) {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        denoConfigWith(`"probe": ${source}`),
      );
      const runtime = await checkWithDenoConfig(root);
      assertEquals(runtime.code, 1, label);
      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry matches Deno omitted commas and requires complete consumption", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        name: 'fixture'
        exports: {
          '.': './src/index.ts'
          './cli': './cli/main.ts'
        }
        imports: {}
        probe: [1 2 3]
      }`,
    );
    const acceptedRuntime = await checkWithDenoConfig(root);
    assertEquals(
      acceptedRuntime.code,
      0,
      new TextDecoder().decode(acceptedRuntime.stderr),
    );
    const registry = await loadCoreProductionRegistry(root);
    assertEquals(registry.configs.get("deno.json")?.probe, [1, 2, 3]);

    for (
      const [label, content] of [
        ["second-root", `${denoConfigWith('"probe": 1')} {}`],
        ["trailing-word", `${denoConfigWith('"probe": 1')} trailing`],
        ["double-object-comma", denoConfigWith('"probe": { "a": 1,, }')],
        ["double-array-comma", denoConfigWith('"probe": [1,,2]')],
        ["missing-colon", denoConfigWith('"probe" 1')],
        ["bare-word-value", denoConfigWith('"probe": value')],
        ["invalid-token", denoConfigWith('"probe": @value')],
        ["unterminated-array", denoConfigWith('"probe": [1, 2')],
      ] as const
    ) {
      await Deno.writeTextFile(`${root}/deno.json`, content);
      const runtime = await checkWithDenoConfig(root);
      assertEquals(runtime.code, 1, label);
      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        "manifest-parse-failure",
        label,
      );
    }

    await Deno.writeTextFile(
      `${root}/deno.json`,
      '{\n  "exports": "./src/index.ts",\n  "probe": @value\n}\n',
    );
    const locatedRuntime = await checkWithDenoConfig(root);
    const locatedRuntimeError = new TextDecoder().decode(
      locatedRuntime.stderr,
    );
    assertEquals(locatedRuntime.code, 1, locatedRuntimeError);
    assertEquals(
      locatedRuntimeError.includes("line 3 column 12"),
      true,
      locatedRuntimeError,
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "unexpected value token at line 3 column 12",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry parses deeply nested Deno configs without recursive stack growth", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const depth = 2_500;
  const openers = Array.from(
    { length: depth },
    (_, index) => index % 2 === 0 ? "[" : '{"value":',
  );
  const closers = Array.from(
    { length: depth },
    (_, index) => index % 2 === 0 ? "]" : "}",
  ).reverse();
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      denoConfigWith(
        `"probe": ${openers.join("")}0${closers.join("")}`,
      ),
    );
    const runtime = await checkWithDenoConfig(root);
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));

    const registry = await loadCoreProductionRegistry(root);
    let value: unknown = registry.configs.get("deno.json")?.probe;
    for (let index = 0; index < depth; index++) {
      if (index % 2 === 0) {
        assertEquals(Array.isArray(value), true, `array depth ${index}`);
        value = (value as unknown[])[0];
      } else {
        assertEquals(
          value !== null && typeof value === "object" &&
            !Array.isArray(value),
          true,
          `object depth ${index}`,
        );
        value = (value as Record<string, unknown>).value;
      }
    }
    assertEquals(value, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry parses large Deno strings without per-character copies", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  const payload = "x".repeat(1_000_000);
  try {
    await Deno.writeTextFile(
      `${root}/deno.json`,
      denoConfigWith(`"probe": "${payload}"`),
    );
    const runtime = await checkWithDenoConfig(root);
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));

    const registry = await loadCoreProductionRegistry(root);
    assertEquals(registry.configs.get("deno.json")?.probe, payload);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("registry compares decoded duplicate keys across Deno spellings", async () => {
  const root = await registryFixture({
    name: "fixture",
    exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
  });
  try {
    for (
      const [label, member, message] of [
        [
          "bare-and-single",
          `"tasks": { dep: "first", 'dep': "second" }`,
          "duplicate JSON key at tasks.dep",
        ],
        [
          "single-and-unicode",
          String.raw`"tasks": { 'dep': "first", '\u0064ep': "second" }`,
          "duplicate JSON key at tasks.dep",
        ],
        [
          "numeric-and-quoted",
          `"tasks": { 1e3: "first", "1e3": "second" }`,
          "duplicate JSON key at tasks.1e3",
        ],
      ] as const
    ) {
      await Deno.writeTextFile(`${root}/deno.json`, denoConfigWith(member));
      const runtime = await checkWithDenoConfig(root);
      assertEquals(runtime.code, 0, label);
      await assertRejects(
        () => loadCoreProductionRegistry(root),
        Error,
        message,
        label,
      );
    }

    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        name: 'fixture',
        exports: {
          '.': './src/index.ts',
          '\\u002e': './src/index.ts',
        },
      }`,
    );
    const runtime = await checkWithDenoConfig(root);
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "duplicate manifest export key: deno.json: .",
    );

    await Deno.writeTextFile(
      `${root}/deno.json`,
      `{
        name: 'fixture',
        exports: { '.': './src/index.ts' },
        exports: {
          '.': './src/index.ts',
          '\\u002e': './src/index.ts',
        },
      }`,
    );
    const nestedFirstRuntime = await checkWithDenoConfig(root);
    assertEquals(
      nestedFirstRuntime.code,
      0,
      new TextDecoder().decode(nestedFirstRuntime.stderr),
    );
    await assertRejects(
      () => loadCoreProductionRegistry(root),
      Error,
      "duplicate manifest export key: deno.json: .",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scopes distinguish plain and explicitly empty decorated importer identities", () => {
  const resolver = createImportMapResolver([{
    path: "deno.json",
    imports: { "#value": "./src/plain.ts" },
    scopes: {
      "./src/importer.ts?": { "#value": "./src/query.ts" },
      "./src/importer.ts#": { "#value": "./src/hash.ts" },
    },
  }]);
  assertEquals(resolver.resolve("#value", "src/importer.ts"), "./src/plain.ts");
  assertEquals(
    resolver.resolve("#value", "src/importer.ts?"),
    "./src/query.ts",
  );
  assertEquals(
    resolver.resolve("#value", "src/importer.ts#"),
    "./src/hash.ts",
  );
});

Deno.test("live registry claims independently match every production manifest export", async () => {
  const registry = await loadCoreProductionRegistry(".");
  const root = JSON.parse(await Deno.readTextFile("deno.json"));
  const cli = JSON.parse(await Deno.readTextFile("cli/deno.json"));
  const react = JSON.parse(await Deno.readTextFile("react/deno.json"));
  const expected = [
    ...Object.entries(root.exports).map(([exportName, path]) =>
      `deno.json\0${exportName}\0${String(path).replace(/^\.\//, "")}`
    ),
    ...Object.entries(cli.exports).map(([exportName, path]) =>
      `cli/deno.json\0${exportName}\0cli/${String(path).replace(/^\.\//, "")}`
    ),
    ...Object.entries(react.exports).map(([exportName, path]) =>
      `react/deno.json\0${exportName}\0react/${
        String(path).replace(/^\.\//, "")
      }`
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
