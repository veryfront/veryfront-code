import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { toFileUrl } from "#std/path";
import { CORE_RUNTIME_ENTRYPOINTS } from "./core-production-roots.ts";
import { runStrictCoreDependencyAuditCli } from "./audit-core-deps-strict.ts";
import { collectCoreProductionFiles } from "./source-import-collector.ts";

Deno.test("core dependency collection visits a production file below a real root", async () => {
  const root = await Deno.makeTempDir();
  const previousDirectory = Deno.cwd();
  try {
    await Deno.mkdir(`${root}/src`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/src/example.ts`,
      "export const value = 1;\n",
    );

    Deno.chdir(root);
    const result = await collectCoreProductionFiles(".", {
      requiredRoots: ["src"],
    });

    assertEquals(result.visitedFileCount, 1);
    assertEquals(result.files.map((file) => file.path), ["src/example.ts"]);
  } finally {
    Deno.chdir(previousDirectory);
    await Deno.remove(root, { recursive: true });
  }
});

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function writeSource(
  root: string,
  path: string,
  content = "export {};\n",
): Promise<void> {
  const directory = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(`${root}/${directory}`, { recursive: true });
  await Deno.writeTextFile(`${root}/${path}`, content);
}

async function auditFixture(): Promise<string> {
  const root = await Deno.makeTempDir();
  for (
    const path of [...CORE_RUNTIME_ENTRYPOINTS, "src/index.ts", "cli/main.ts"]
  ) {
    await writeSource(root, path);
  }
  await Deno.writeTextFile(
    `${root}/deno.json`,
    JSON.stringify({
      name: "fixture",
      exports: { ".": "./src/index.ts", "./cli": "./cli/main.ts" },
      imports: { "#unused-dev-only": "npm:unused-dev-only@1" },
    }),
  );
  await Deno.writeTextFile(
    `${root}/cli/deno.json`,
    JSON.stringify({
      name: "@fixture/cli",
      exports: { ".": "./main.ts" },
      imports: {},
    }),
  );
  return root;
}

async function runAudit(
  args: string[],
  env?: Record<string, string>,
): Promise<CommandResult> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config=scripts/test.deno.json",
      "--frozen",
      "--allow-read",
      "--allow-write",
      "scripts/lint/audit-core-deps-strict.ts",
      ...args,
    ],
    cwd: Deno.cwd(),
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

Deno.test("strict audit CLI exits 0 and atomically writes deterministic complete JSON", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await Deno.writeTextFile(outputPath, "old report\n");
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 0, result.stderr);
    const bytes = await Deno.readTextFile(outputPath);
    const report = JSON.parse(bytes);
    assertEquals(bytes, `${JSON.stringify(report, null, 2)}\n`);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(report.issues, []);
    assert(report.examined.roots > 0);
    assert(report.examined.files > 0);
    assertEquals(
      (await Array.fromAsync(Deno.readDir(root))).some((entry) =>
        entry.name.includes(".tmp")
      ),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit CLI exits 2 only for complete policy evidence", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await writeSource(root, "src/index.ts", 'import "npm:forbidden@1";\n');
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assert(report.issues.length > 0);
    assertEquals(
      report.issues.some((issue: { specifier?: string }) =>
        issue.specifier === "npm:forbidden@1"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit reports config-only and reachable mapped vendor provenance", async () => {
  for (const kind of ["config", "types", "mapped"] as const) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      if (kind === "config") {
        config.dependencies = { "config-only": "npm:config-only@1" };
      } else if (kind === "types") {
        config.compilerOptions = { types: ["npm:hidden-types@1"] };
      } else {
        config.imports["#vendor"] = "npm:reachable-vendor@1";
        await writeSource(root, "src/index.ts", 'import "#vendor";\n');
      }
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, result.stderr);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      if (kind === "config") {
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === "deno.json" && entry.field === "dependencies" &&
            entry.specifier === "config-only"
          ),
          true,
        );
      } else if (kind === "types") {
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === "deno.json" &&
            entry.field === "compilerOptions.types" &&
            entry.resolved === "npm:hidden-types@1"
          ),
          true,
        );
      } else {
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.specifier === "#vendor" &&
            entry.resolved === "npm:reachable-vendor@1"
          ),
          true,
        );
      }
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.specifier === "#unused-dev-only"
        ),
        false,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit rejects intrinsically forbidden originals before import-map aliases", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  const originals = [
    "@veryfront/ext-shadow",
    "npm:evil@1",
    "jsr:@evil/pkg@1",
    "https://evil.test/mod.ts",
    "data:text/javascript,export default 1",
    "blob:https://evil.test/id",
    "deno:evil",
    "ext:evil/mod.js",
    "node:not_a_real_builtin",
  ];
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    for (const original of originals) {
      config.imports[original] = "./src/shim.ts";
    }
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/shim.ts");
    await writeSource(
      root,
      "src/index.ts",
      originals.map((specifier) => `import ${JSON.stringify(specifier)};`).join(
        "\n",
      ),
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    for (const original of originals) {
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === original
        ),
        true,
        original,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit rejects every forbidden identity in an import-map chain", async (context) => {
  const cases = [
    ["npm:evil@1", "forbidden-external-dependency"],
    ["jsr:@evil/pkg@1", "forbidden-external-dependency"],
    ["https://evil.test/mod.ts", "forbidden-external-dependency"],
    ["@veryfront/ext-shadow", "forbidden-extension-dependency"],
    ["node:not_a_real_builtin", "unsupported-or-invalid-builtin"],
    ["file:///definitely/outside/core.ts", "source-target-escapes-core"],
    ["react", "forbidden-bare-dependency"],
  ] as const;

  for (const [intermediate, expectedCode] of cases) {
    await context.step(intermediate, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        config.imports["#facade"] = intermediate;
        config.imports[intermediate] = "./src/shim.ts";
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(root, "src/shim.ts");
        await writeSource(root, "src/index.ts", 'import "#facade";\n');

        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, `${intermediate}: ${result.stderr}`);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.map((issue: Record<string, unknown>) => ({
            contextId: issue.contextId,
            code: issue.code,
            specifier: issue.specifier,
            resolved: issue.resolved,
          })),
          [
            {
              contextId: "root-deno",
              code: expectedCode,
              specifier: "#facade",
              resolved: intermediate,
            },
            {
              contextId: "root-node",
              code: expectedCode,
              specifier: "#facade",
              resolved: intermediate,
            },
          ],
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit derives allowed bare self identities from owned manifests", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["#facade"] = "fixture/internal";
    config.imports["fixture/internal"] = "./src/shim.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/shim.ts");
    await writeSource(root, "src/index.ts", 'import "#facade";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 0, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(report.issues, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit accepts npm-compatible manifest package names as self identities", async (context) => {
  const cases = [
    { label: "unscoped", name: "fixture" },
    { label: "scoped with underscore-prefixed package", name: "@fixture/_cli" },
    { label: "214-character unscoped boundary", name: "a".repeat(214) },
    {
      label: "214-character scoped boundary",
      name: `@s/${"a".repeat(211)}`,
    },
  ] as const;

  for (const testCase of cases) {
    await context.step(testCase.label, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        config.name = testCase.name;
        config.imports["#self"] = testCase.name;
        config.imports[testCase.name] = "./src/shim.ts";
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(root, "src/shim.ts");
        await writeSource(root, "src/index.ts", 'import "#self";\n');

        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 0, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(report.issues, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit rejects malformed manifest package names as self identities", async (context) => {
  const cases = [
    { label: "215-character unscoped name", name: "a".repeat(215) },
    {
      label: "215-character scoped name",
      name: `@s/${"a".repeat(212)}`,
    },
    { label: "scope without package", name: "@fixture" },
    { label: "empty scope", name: "@/cli" },
    { label: "empty scoped package", name: "@fixture/" },
    { label: "extra scoped slash", name: "@fixture/cli/extra" },
    { label: "unscoped slash", name: "fixture/cli" },
    { label: "scope traversal", name: "@../cli" },
    { label: "package traversal", name: "@fixture/.." },
    { label: "embedded traversal", name: "fixture/../cli" },
    { label: "backslash", name: String.raw`fixture\cli` },
    { label: "scoped backslash", name: String.raw`@fixture\cli` },
    { label: "uppercase", name: "Fixture" },
    { label: "underscore-prefixed unscoped name", name: "_fixture" },
    { label: "period-prefixed unscoped name", name: ".fixture" },
  ] as const;

  for (const testCase of cases) {
    await context.step(testCase.label, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        config.name = testCase.name;
        config.imports["#self"] = testCase.name;
        config.imports[testCase.name] = "./src/shim.ts";
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(root, "src/shim.ts");
        await writeSource(root, "src/index.ts", 'import "#self";\n');

        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.map((issue: Record<string, unknown>) => ({
            contextId: issue.contextId,
            code: issue.code,
            specifier: issue.specifier,
            resolved: issue.resolved,
          })),
          [
            {
              contextId: "root-deno",
              code: "forbidden-bare-dependency",
              specifier: "#self",
              resolved: testCase.name,
            },
            {
              contextId: "root-node",
              code: "forbidden-bare-dependency",
              specifier: "#self",
              resolved: testCase.name,
            },
          ],
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit rejects a bare third-party identity even when mapped directly to core", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports.react = "./src/shim.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/shim.ts");
    await writeSource(root, "src/index.ts", 'import "react";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(
      report.issues.map((issue: Record<string, unknown>) => ({
        contextId: issue.contextId,
        code: issue.code,
        specifier: issue.specifier,
        resolved: issue.resolved,
      })),
      [
        {
          contextId: "root-deno",
          code: "forbidden-bare-dependency",
          specifier: "react",
          resolved: "react",
        },
        {
          contextId: "root-node",
          code: "forbidden-bare-dependency",
          specifier: "react",
          resolved: "react",
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit rejects an outside file URL before import-map aliasing", async () => {
  const root = await auditFixture();
  const outside = await Deno.makeTempFile({ suffix: ".ts" });
  const outputPath = `${root}/audit.json`;
  try {
    const original = toFileUrl(outside).href;
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports[original] = "./src/shim.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/shim.ts");
    await writeSource(
      root,
      "src/index.ts",
      `import ${JSON.stringify(original)};\n`,
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" && entry.specifier === original &&
        entry.code === "source-target-escapes-core"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside);
  }
});

Deno.test("strict audit rejects raw and mapped absolute filesystem imports", async () => {
  for (const mode of ["raw", "mapped"] as const) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      if (mode === "mapped") config.imports["#absolute"] = "/src/evil.ts";
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(root, "src/evil.ts");
      const requested = mode === "raw" ? "/src/evil.ts" : "#absolute";
      await writeSource(
        root,
        "src/index.ts",
        `import ${JSON.stringify(requested)};\n`,
      );

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${mode}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === requested &&
          entry.code === "source-target-escapes-core" &&
          entry.resolved === "/src/evil.ts"
        ),
        true,
        mode,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit rejects URL-encoded traversal in source, import-map, and configuration paths", async () => {
  for (const mode of ["source", "import-map", "configuration"] as const) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    const encoded = mode === "configuration"
      ? "src/%2e%2e%2fextensions/evil.ts"
      : "./src/%2e%2e%2fextensions/evil.ts";
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      let expectedSpecifier = encoded;
      if (mode === "source") {
        expectedSpecifier = "./%2e%2e%2fextensions/evil.ts";
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(expectedSpecifier)};\n`,
        );
      } else if (mode === "import-map") {
        expectedSpecifier = "#encoded-escape";
        config.imports[expectedSpecifier] = encoded;
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(expectedSpecifier)};\n`,
        );
      } else {
        config.compilerOptions = { types: [encoded] };
      }
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(root, "src/%2e%2e%2fextensions/evil.ts");

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${mode}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.code === "source-target-escapes-core" &&
          entry.specifier === expectedSpecifier &&
          (mode !== "configuration" ||
            entry.field === "compilerOptions.types")
        ),
        true,
        mode,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit rejects arbitrary percent-encoded source, import-map, and configuration path components", async () => {
  for (const mode of ["source", "import-map", "configuration"] as const) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    const encoded = mode === "configuration"
      ? "src/%65vil.ts"
      : "./src/%65vil.ts";
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      let expectedSpecifier = encoded;
      if (mode === "source") {
        expectedSpecifier = "./%65vil.ts";
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(expectedSpecifier)};\n`,
        );
      } else if (mode === "import-map") {
        expectedSpecifier = "#encoded-component";
        config.imports[expectedSpecifier] = encoded;
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(expectedSpecifier)};\n`,
        );
      } else {
        config.compilerOptions = { types: [encoded] };
      }
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(root, "src/%65vil.ts");

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${mode}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.code === "source-target-escapes-core" &&
          entry.specifier === expectedSpecifier &&
          (mode !== "configuration" ||
            entry.field === "compilerOptions.types")
        ),
        true,
        mode,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit inventories conditional type exports with config provenance", async () => {
  for (
    const [target, expectedCode] of [
      ["npm:@evil/types/index.d.ts", "forbidden-external-dependency"],
      ["../escaped/types.d.ts", "source-target-escapes-core"],
    ] as const
  ) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      config.exports["."] = { types: target, default: "./src/index.ts" };
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${target}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.code === expectedCode && entry.path === "deno.json" &&
          entry.field === "exports.types" && entry.specifier === "." &&
          entry.resolved === target
        ),
        true,
        target,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit traverses root ./cli type exports under CLI ownership and scoped maps", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const rootConfig = JSON.parse(
      await Deno.readTextFile(`${root}/deno.json`),
    );
    rootConfig.exports["./cli"] = {
      types: "./cli/types.ts",
      default: "./cli/main.ts",
    };
    rootConfig.imports["#type-dep"] = "./src/clean-type-dep.ts";
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify(rootConfig),
    );
    const cliConfig = JSON.parse(
      await Deno.readTextFile(`${root}/cli/deno.json`),
    );
    cliConfig.scopes = {
      "./": { "#type-dep": "npm:cli-type-escape@1" },
    };
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify(cliConfig),
    );
    await writeSource(root, "src/clean-type-dep.ts");
    await writeSource(root, "cli/types.ts", 'import "#type-dep";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    const typeIssues = report.issues.filter((entry: Record<string, unknown>) =>
      entry.path === "cli/types.ts" && entry.specifier === "#type-dep" &&
      entry.resolved === "npm:cli-type-escape@1"
    );
    assertEquals(
      typeIssues.map((entry: Record<string, unknown>) => entry.contextId),
      ["cli-deno", "cli-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit derives CLI ownership for type-only root exports", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const rootConfig = JSON.parse(
      await Deno.readTextFile(`${root}/deno.json`),
    );
    rootConfig.exports["./cli-types"] = {
      types: "./cli/types.ts",
      default: null,
    };
    rootConfig.imports["#type-dep"] = "./src/clean-type-dep.ts";
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify(rootConfig),
    );
    const cliConfig = JSON.parse(
      await Deno.readTextFile(`${root}/cli/deno.json`),
    );
    cliConfig.scopes = {
      "./": { "#type-dep": "npm:cli-type-escape@1" },
    };
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify(cliConfig),
    );
    await writeSource(root, "src/clean-type-dep.ts");
    await writeSource(root, "cli/types.ts", 'import "#type-dep";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    const typeIssues = report.issues.filter((entry: Record<string, unknown>) =>
      entry.path === "cli/types.ts" && entry.specifier === "#type-dep" &&
      entry.resolved === "npm:cli-type-escape@1"
    );
    assertEquals(
      typeIssues.map((entry: Record<string, unknown>) => entry.contextId),
      ["cli-deno", "cli-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit unions runtime claims with type-target ownership for mixed CLI exports", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const rootConfig = JSON.parse(
      await Deno.readTextFile(`${root}/deno.json`),
    );
    rootConfig.exports["./cli-mixed"] = {
      types: "./cli/types.ts",
      node: "./cli/main.ts",
      default: null,
    };
    rootConfig.imports["#type-dep"] = "./src/clean-type-dep.ts";
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify(rootConfig),
    );
    const cliConfig = JSON.parse(
      await Deno.readTextFile(`${root}/cli/deno.json`),
    );
    cliConfig.scopes = {
      "./": { "#type-dep": "npm:cli-type-escape@1" },
    };
    await Deno.writeTextFile(
      `${root}/cli/deno.json`,
      JSON.stringify(cliConfig),
    );
    await writeSource(root, "src/clean-type-dep.ts");
    await writeSource(root, "cli/types.ts", 'import "#type-dep";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    const typeIssues = report.issues.filter((entry: Record<string, unknown>) =>
      entry.path === "cli/types.ts" && entry.specifier === "#type-dep" &&
      entry.resolved === "npm:cli-type-escape@1"
    );
    assertEquals(
      typeIssues.map((entry: Record<string, unknown>) => entry.contextId),
      ["cli-deno", "cli-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit follows local configuration targets in applicable contexts", async () => {
  const cases = [
    {
      path: "src/jsx-runtime.ts",
      configure: (config: Record<string, unknown>) => {
        config.compilerOptions = { jsxImportSource: "./src/jsx-runtime.ts" };
      },
      builtin: "node:fs",
      expectedContext: "browser-runtime",
    },
    {
      path: "src/type-runtime.ts",
      configure: (config: Record<string, unknown>) => {
        config.compilerOptions = { types: ["./src/type-runtime.ts"] };
      },
      builtin: "node:fs",
      expectedContext: "browser-runtime",
    },
    {
      path: "src/browser-runtime.ts",
      configure: (config: Record<string, unknown>) => {
        config.browser = "./src/browser-runtime.ts";
      },
      builtin: "node:fs",
      expectedContext: "browser-runtime",
    },
    {
      path: "src/main-runtime.ts",
      configure: (config: Record<string, unknown>) => {
        config.main = "./src/main-runtime.ts";
      },
      builtin: "node:sqlite",
      expectedContext: "root-node",
    },
  ];

  for (const testCase of cases) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      testCase.configure(config);
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(
        root,
        testCase.path,
        `import ${JSON.stringify(testCase.builtin)};\n`,
      );

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${testCase.path}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      const descendantIssues = report.issues.filter((
        entry: Record<string, unknown>,
      ) =>
        entry.path === testCase.path && entry.specifier === testCase.builtin
      );
      assertEquals(
        descendantIssues.some((entry: Record<string, unknown>) =>
          entry.contextId === testCase.expectedContext
        ),
        true,
        testCase.path,
      );
      if (testCase.expectedContext === "root-node") {
        assertEquals(
          descendantIssues.map((entry: Record<string, unknown>) =>
            entry.contextId
          ),
          ["root-node"],
        );
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit follows generated JSX runtime configuration subpaths", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = { jsxImportSource: "#jsx" };
    config.imports["#jsx"] = "./src/jsx-base.ts";
    config.imports["#jsx/"] = "./src/jsx/";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/jsx-base.ts");
    await writeSource(root, "src/jsx/jsx-runtime.ts", 'import "node:fs";\n');
    await writeSource(root, "src/jsx/jsx-dev-runtime.ts");

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "browser-runtime" &&
        entry.path === "src/jsx/jsx-runtime.ts" && entry.specifier === "node:fs"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit resolves configured JSX runtimes from each reachable JSX importer's scope", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = {
      jsx: "react-jsx",
      jsxImportSource: "#jsx",
    };
    config.imports["#jsx"] = "./src/jsx-base.ts";
    config.imports["#jsx/"] = "./src/jsx/";
    config.scopes = {
      "./src/scoped/": { "#jsx/": "npm:scoped-jsx@1/" },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/jsx-base.ts");
    await writeSource(root, "src/jsx/jsx-runtime.ts");
    await writeSource(root, "src/jsx/jsx-dev-runtime.ts");
    await writeSource(
      root,
      "src/index.ts",
      'import "./scoped/component.tsx";\n',
    );
    await writeSource(
      root,
      "src/scoped/component.tsx",
      "export const component = <div />;\n",
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/scoped/component.tsx" &&
        entry.field === "compilerOptions.jsxImportSource.runtime" &&
        entry.specifier === "#jsx/jsx-runtime" &&
        entry.resolved === "npm:scoped-jsx@1/jsx-runtime"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit uses a file-level JSX import-source override at the pragma location", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = {
      jsx: "react-jsx",
      jsxImportSource: "#jsx",
    };
    config.imports["#jsx"] = "./src/jsx-base.ts";
    config.imports["#jsx/"] = "./src/jsx/";
    config.imports["#pragma"] = "./src/pragma-base.ts";
    config.imports["#pragma/"] = "./src/pragma/";
    config.scopes = {
      "./src/scoped/": { "#pragma/": "npm:pragma-jsx@1/" },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    for (
      const path of [
        "src/jsx-base.ts",
        "src/jsx/jsx-runtime.ts",
        "src/jsx/jsx-dev-runtime.ts",
        "src/pragma-base.ts",
        "src/pragma/jsx-runtime.ts",
        "src/pragma/jsx-dev-runtime.ts",
      ]
    ) {
      await writeSource(root, path);
    }
    await writeSource(
      root,
      "src/index.ts",
      'import "./scoped/component.tsx";\n',
    );
    await writeSource(
      root,
      "src/scoped/component.tsx",
      "/** @jsxImportSource #pragma */\nexport const component = <div />;\n",
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/scoped/component.tsx" && entry.line === 1 &&
        entry.loader === "@jsxImportSource.runtime" &&
        entry.specifier === "#pragma/jsx-runtime" &&
        entry.resolved === "npm:pragma-jsx@1/jsx-runtime"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit falls through an unresolved nested export condition", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["./head"] = {
      browser: { node: "./src/never.ts" },
      default: "./src/head.ts",
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/never.ts");
    await writeSource(root, "src/head.ts", 'import "node:fs";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "browser-runtime" && entry.path === "src/head.ts" &&
        entry.specifier === "node:fs"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit keeps conditional target closure separate and audits only global orphans by assignment", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["."] = {
      node: "./src/node-only.ts",
      default: "./src/index.ts",
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/node-only.ts",
      'import "./node-transitive.ts";\n',
    );
    await writeSource(
      root,
      "src/node-transitive.ts",
      'import "node:trace_events";\n',
    );
    await writeSource(root, "src/orphan.ts", 'import "node:trace_events";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "root-deno" &&
        entry.path === "src/node-transitive.ts"
      ),
      false,
    );
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "root-deno" && entry.path === "src/orphan.ts" &&
        entry.specifier === "node:trace_events"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit uses contextual import maps for loader API provenance", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["."] = { node: "./src/index.ts", default: "./src/clean.ts" };
    config.imports["#worker-api"] = "node:worker_threads";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/clean.ts");
    await writeSource(
      root,
      "src/index.ts",
      'import { Worker as WorkerAlias } from "#worker-api";\nnew WorkerAlias(workerTarget);\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "root-node" && entry.path === "src/index.ts" &&
        entry.code === "unresolved-runtime-loader" &&
        entry.loader === "node:worker_threads.Worker"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit fails closed for generic loader provenance escapes", async (context) => {
  const cases = [
    {
      name: "ordinary parameter injection",
      content: [
        'function use(load: (specifier: string) => unknown) { load("npm:param-injection@1"); }',
        "use(require);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "named function return",
      content: [
        "function loader() { return require; }",
        "const load = loader();",
        'load("npm:named-return@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "nested member assignment",
      content: [
        "const box = { inner: {} as Record<string, unknown> };",
        "box.inner.load = require;",
        'box.inner.load("npm:nested-member@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "class static field alias",
      content: [
        "class Loaders { static load = require; }",
        'Loaders.load("npm:class-static@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "computed service worker method",
      content: [
        'const target = "npm:computed-service-worker@1";',
        'navigator.serviceWorker["reg" + "ister"](target);',
      ].join("\n"),
      expected: {
        code: "forbidden-external-dependency",
        loader: "navigator.serviceWorker.register",
        specifier: "npm:computed-service-worker@1",
      },
    },
    {
      name: "createRequire call",
      content: [
        'import { createRequire } from "node:module";',
        "const load = createRequire.call(null, import.meta.url);",
        'load("npm:create-require-call@1");',
      ].join("\n"),
      expected: {
        code: "forbidden-external-dependency",
        loader: "require",
        specifier: "npm:create-require-call@1",
      },
    },
    {
      name: "parameter injection through apply",
      content: [
        'function use(load: (specifier: string) => unknown) { load("npm:param-apply@1"); }',
        "use.apply(null, [require]);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "createRequire apply",
      content: [
        'import { createRequire } from "node:module";',
        "const load = createRequire.apply(null, [import.meta.url]);",
        'load("npm:create-require-apply@1");',
      ].join("\n"),
      expected: {
        code: "forbidden-external-dependency",
        loader: "require",
        specifier: "npm:create-require-apply@1",
      },
    },
    {
      name: "computed constant nested member",
      content: [
        'const INNER = "inner";',
        'const LOAD = "load";',
        "const box = { inner: {} as Record<string, unknown> };",
        "box[INNER][LOAD] = require;",
        'box[INNER][LOAD]("npm:computed-member@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "concise named function return",
      content: [
        "const factory = () => require;",
        "const load = factory();",
        'load("npm:concise-return@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "nested conditional return inside iife",
      content: [
        "const load = (() => {",
        "  if (enabled) { return require; }",
        "  return undefined;",
        "})();",
        'load("npm:nested-iife-return@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect apply parameter injection",
      content: [
        "function use(load: unknown) { return load; }",
        "Reflect.apply(use, null, [require]);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect construct parameter injection",
      content: [
        "class Use { constructor(load: unknown) { void load; } }",
        "Reflect.construct(Use, [require]);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "constant template computed service worker method",
      content: [
        'const METHOD_SUFFIX = "ister";',
        'const target = "npm:template-service-worker@1";',
        "navigator.serviceWorker[\`reg\${METHOD_SUFFIX}\`](target);",
      ].join("\n"),
      expected: {
        code: "forbidden-external-dependency",
        loader: "navigator.serviceWorker.register",
        specifier: "npm:template-service-worker@1",
      },
    },
    {
      name: "exported loader",
      content: "export const load = require;",
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "yielded loader",
      content: "function* loaders() { yield require; }",
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "aliased loader container",
      content: [
        "const loaders = { load: require };",
        "const alias = loaders;",
        'alias.load("npm:aliased-container@1");',
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "exported aliased loader container",
      content: [
        "const loaders = { load: require };",
        "export { loaders };",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "returned aliased loader container",
      content: [
        "function expose() {",
        "  const loaders = { load: require };",
        "  return loaders;",
        "}",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "returned global loader namespace",
      content: "function expose() { return globalThis; }",
      expected: {
        code: "unresolved-runtime-loader",
        loader: "runtime-loader-alias",
      },
    },
    {
      name: "apply with aliased argument container",
      content: [
        "function use(load: unknown) { return load; }",
        "const values = [require];",
        "const alias = values;",
        "use.apply(null, alias);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "instance field loader",
      content: "class Loaders { load = require; }",
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "constructor parameter injection",
      content: [
        "class Use { constructor(load: unknown) { void load; } }",
        "new Use(require);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "call parameter injection",
      content: [
        "function use(load: unknown) { return load; }",
        "use.call(null, require);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
      },
    },
    {
      name: "reflect apply createRequire",
      content: [
        'import { createRequire } from "node:module";',
        "const load = Reflect.apply(createRequire, null, [import.meta.url]);",
        'load("npm:reflect-create-require@1");',
      ].join("\n"),
      expected: {
        code: "forbidden-external-dependency",
        loader: "require",
        specifier: "npm:reflect-create-require@1",
      },
    },
    {
      name: "reflect construct worker",
      content: 'Reflect.construct(Worker, ["npm:reflect-construct-worker@1"]);',
      expected: {
        code: "forbidden-external-dependency",
        loader: "Worker",
        specifier: "npm:reflect-construct-worker@1",
      },
    },
    {
      name: "reverse alias member store",
      content: [
        "const original: Record<string, unknown> = {};",
        "const alias = original;",
        "alias.load = require;",
        "original.load(target);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 3,
      },
    },
    {
      name: "escaped original after alias store",
      content: [
        "const original: Record<string, unknown> = {};",
        "const alias = original;",
        "alias.load = require;",
        "use(original);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 3,
      },
    },
    {
      name: "object spread",
      content: [
        "const original = { load: require };",
        "const copy = { ...original };",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 2,
      },
    },
    {
      name: "array spread",
      content: [
        "const original = [require];",
        "const copy = [...original];",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 2,
      },
    },
    {
      name: "constant computed object key",
      content: [
        'const LOAD = "load";',
        "const original = { [LOAD]: require };",
        "original.load(target);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "require-alias",
        line: 3,
      },
    },
    {
      name: "unknown computed namespace call",
      content: [
        'import * as moduleApi from "node:module";',
        "moduleApi[method](target);",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "runtime-loader-alias",
        line: 2,
      },
    },
    {
      name: "unknown computed namespace read",
      content: [
        'import * as moduleApi from "node:module";',
        "const maybeLoad = moduleApi[method];",
      ].join("\n"),
      expected: {
        code: "unresolved-runtime-loader",
        loader: "runtime-loader-alias",
        line: 2,
      },
    },
  ] as const;

  for (const testCase of cases) {
    await context.step(testCase.name, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(root, "src/index.ts", `${testCase.content}\n`);
        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === "src/index.ts" &&
            entry.code === testCase.expected.code &&
            entry.loader === testCase.expected.loader &&
            (!("line" in testCase.expected) ||
              entry.line === testCase.expected.line) &&
            (!("specifier" in testCase.expected) ||
              entry.specifier === testCase.expected.specifier)
          ),
          true,
          JSON.stringify(report.issues, null, 2),
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit gives normalized loader-returning IIFEs one stable issue per context", async (context) => {
  const cases = [
    ["direct", "(() => require)()(target);"],
    ["call", "(() => require).call(null)(target);"],
    ["apply", "(() => require).apply(null, [])(target);"],
    ["Reflect.apply", "Reflect.apply(() => require, null, [])(target);"],
    [
      "Reflect.construct",
      "Reflect.construct(function () { return require; }, [])(target);",
    ],
  ] as const;

  for (const [name, source] of cases) {
    await context.step(name, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(root, "src/index.ts", `${source}\n`);
        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        const unresolved = report.issues.filter(
          (entry: Record<string, unknown>) =>
            entry.path === "src/index.ts" &&
            entry.code === "unresolved-runtime-loader" &&
            entry.loader === "require-alias",
        );
        assertEquals(
          unresolved.map((entry: Record<string, unknown>) => ({
            contextId: entry.contextId,
            line: entry.line,
            column: entry.column,
          })),
          [
            { contextId: "root-deno", line: 1, column: 1 },
            { contextId: "root-node", line: 1, column: 1 },
          ],
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit fails closed when a higher-order invocation receiver carries a loader", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await writeSource(
      root,
      "src/index.ts",
      'require.call.call(require, null, "npm:receiver-hidden@1");\n',
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues.map((issue: Record<string, unknown>) => ({
        contextId: issue.contextId,
        code: issue.code,
        loader: issue.loader,
        specifier: issue.specifier,
      })),
      [
        {
          contextId: "root-deno",
          code: "unresolved-runtime-loader",
          loader: "require-alias",
          specifier: undefined,
        },
        {
          contextId: "root-node",
          code: "unresolved-runtime-loader",
          loader: "require-alias",
          specifier: undefined,
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit does not classify pure computed namespace writes as reads", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await writeSource(
      root,
      "src/index.ts",
      "globalThis[key] = 1;\ndelete globalThis[key];\n",
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 0, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(report.issues, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit distinguishes raw import promises from awaited namespaces", async (context) => {
  await context.step("raw static import promises stay clean", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        [
          "await Promise.all([",
          '  import("node:module"),',
          '  import("node:fs"),',
          '  import("node:path"),',
          "]);",
        ].join("\n"),
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 0, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(report.issues, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  await context.step("computed import promise stays fail-closed", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        "await Promise.all([import(target)]);\n",
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 2, result.stderr);
      assertEquals(
        report.issues.map((issue: Record<string, unknown>) => ({
          contextId: issue.contextId,
          code: issue.code,
          loader: issue.loader,
        })),
        [
          {
            contextId: "root-deno",
            code: "unresolved-runtime-loader",
            loader: "import",
          },
          {
            contextId: "root-node",
            code: "unresolved-runtime-loader",
            loader: "import",
          },
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  await context.step(
    "unawaited Promise.all destructuring stays a promise",
    async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(
          root,
          "src/index.ts",
          [
            "const [{ createRequire }] = Promise.all([",
            '  import("node:module"),',
            "]);",
            "const impossibleLoad = createRequire(import.meta.url);",
            'impossibleLoad("npm:not-actually-callable@1");',
          ].join("\n"),
        );
        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 0, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(report.issues, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    },
  );

  await context.step("awaited namespace keeps exact provenance", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        'const moduleApi = await import("node:module");\nmoduleApi.register("npm:awaited-register@1");\n',
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 2, result.stderr);
      assertEquals(
        report.issues.map((issue: Record<string, unknown>) => ({
          contextId: issue.contextId,
          code: issue.code,
          loader: issue.loader,
          specifier: issue.specifier,
        })),
        [
          {
            contextId: "root-deno",
            code: "forbidden-external-dependency",
            loader: "module.register",
            specifier: "npm:awaited-register@1",
          },
          {
            contextId: "root-node",
            code: "forbidden-external-dependency",
            loader: "module.register",
            specifier: "npm:awaited-register@1",
          },
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("strict audit rejects dependencies loaded through stored import promises", async (context) => {
  await context.step(
    "stored aliases retain exact loader provenance",
    async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(
          root,
          "src/index.ts",
          [
            'const pending = import("node:module");',
            "const alias = pending;",
            "const moduleApi = await alias;",
            'moduleApi.register("npm:stored-register@1");',
            "const batched = Promise.all([",
            '  import("node:module"),',
            "]);",
            "const batchedAlias = batched;",
            "const [batchedApi] = await batchedAlias;",
            'batchedApi.register("jsr:@vendor/stored-register@1");',
          ].join("\n"),
        );
        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.map((issue: Record<string, unknown>) => ({
            contextId: issue.contextId,
            code: issue.code,
            line: issue.line,
            loader: issue.loader,
            specifier: issue.specifier,
          })),
          [
            {
              contextId: "root-deno",
              code: "forbidden-external-dependency",
              line: 4,
              loader: "module.register",
              specifier: "npm:stored-register@1",
            },
            {
              contextId: "root-deno",
              code: "forbidden-external-dependency",
              line: 10,
              loader: "module.register",
              specifier: "jsr:@vendor/stored-register@1",
            },
            {
              contextId: "root-node",
              code: "forbidden-external-dependency",
              line: 4,
              loader: "module.register",
              specifier: "npm:stored-register@1",
            },
            {
              contextId: "root-node",
              code: "forbidden-external-dependency",
              line: 10,
              loader: "module.register",
              specifier: "jsr:@vendor/stored-register@1",
            },
          ],
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    },
  );

  await context.step("raw stored promises are not namespaces", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        [
          'const pending = import("node:module");',
          "const alias = pending;",
          "alias.register(notCallable);",
          "const batched = Promise.all([pending]);",
          "const [notANamespace] = batched;",
          "notANamespace.register(stillNotCallable);",
        ].join("\n"),
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 0, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(report.issues, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  await context.step("unmodeled promise boundaries fail closed", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        'Promise.resolve(import("node:module"));\n',
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 2, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(
        report.issues.map((issue: Record<string, unknown>) => ({
          contextId: issue.contextId,
          code: issue.code,
          loader: issue.loader,
          specifier: issue.specifier,
        })),
        [
          {
            contextId: "root-deno",
            code: "unresolved-runtime-loader",
            loader: "runtime-loader-alias",
            specifier: undefined,
          },
          {
            contextId: "root-node",
            code: "unresolved-runtime-loader",
            loader: "runtime-loader-alias",
            specifier: undefined,
          },
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("strict audit walks transparent wrappers before classifying namespace writes", async (context) => {
  await context.step("wrapped pure writes stay clean", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        [
          "(globalThis[key] as any) = 1;",
          "globalThis[key]! = 1;",
          "delete (globalThis[key] as any);",
        ].join("\n"),
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 0, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(report.issues, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  await context.step("wrapped reads stay fail-closed", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await writeSource(
        root,
        "src/index.ts",
        "(globalThis[key] as any) += 1;\n(globalThis[key] as any) != null;\n",
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 2, result.stderr);
      assertEquals(
        report.issues.map((issue: Record<string, unknown>) => ({
          contextId: issue.contextId,
          code: issue.code,
          line: issue.line,
          loader: issue.loader,
        })),
        [
          {
            contextId: "root-deno",
            code: "unresolved-runtime-loader",
            line: 1,
            loader: "runtime-loader-alias",
          },
          {
            contextId: "root-deno",
            code: "unresolved-runtime-loader",
            line: 2,
            loader: "runtime-loader-alias",
          },
          {
            contextId: "root-node",
            code: "unresolved-runtime-loader",
            line: 1,
            loader: "runtime-loader-alias",
          },
          {
            contextId: "root-node",
            code: "unresolved-runtime-loader",
            line: 2,
            loader: "runtime-loader-alias",
          },
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("strict audit treats import-map expansion cycles as operational exit 3", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["loop/"] = "loop/x/";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/index.ts", 'import "loop/value.ts";\n');
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 3, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, false);
    assertStringIncludes(
      report.operationalErrors[0].message,
      "import-map alias cycle",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit force-includes manifest exports with test-like filenames", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["."] = "./src/hidden.test.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/hidden.test.ts",
      'import "npm:exported-test-edge@1";\n',
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, true);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/hidden.test.ts" &&
        entry.specifier === "npm:exported-test-edge@1"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit CLI exits 3 with incomplete evidence for parser and manifest failures", async () => {
  for (const failure of ["parser", "manifest"] as const) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      if (failure === "parser") {
        await writeSource(root, "src/index.ts", "import {");
      } else await Deno.remove(`${root}/cli/deno.json`);
      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 3, `${failure}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(report.evidenceComplete, false);
      assert(report.operationalErrors.length > 0);
      assertEquals(Array.isArray(report.issues), true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit monotonically joins alternating loader facts into policy issues", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await writeSource(
      root,
      "src/index.ts",
      [
        "let load = require;",
        "load = Worker;",
        "load = require;",
        "load(target);",
        "const box = { load: require };",
        "box.load = Worker;",
        "box.load = require;",
        "box.load(memberTarget);",
      ].join("\n"),
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 2, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues.filter((issue: Record<string, unknown>) =>
        issue.path === "src/index.ts" &&
        issue.code === "unresolved-runtime-loader" &&
        issue.loader === "runtime-loader-alias"
      ).length >= 2,
      true,
      JSON.stringify(report.issues, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit CLI treats missing output and report-write failure as exit 3", async () => {
  const root = await auditFixture();
  try {
    const missingOutput = await runAudit(["--root", root]);
    assertEquals(missingOutput.code, 3, missingOutput.stderr);
    assertStringIncludes(
      missingOutput.stderr,
      "missing required --output <path>",
    );

    const outputDirectory = `${root}/occupied-output`;
    await Deno.mkdir(outputDirectory);
    const failedWrite = await runAudit([
      "--root",
      root,
      "--output",
      outputDirectory,
    ]);
    assertEquals(failedWrite.code, 3);
    assertStringIncludes(failedWrite.stderr, "report-write-failure");
    const names = (await Array.fromAsync(Deno.readDir(root))).map((entry) =>
      entry.name
    );
    assertEquals(
      names.some((name) =>
        name.startsWith(".occupied-output.") && name.endsWith(".tmp")
      ),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit CLI writes an incomplete report for malformed arguments when output is recoverable", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const result = await runAudit([
      "--root",
      root,
      "--output",
      outputPath,
      "--bogus",
    ]);
    assertEquals(result.code, 3);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, false);
    assertEquals(report.issues, []);
    assertStringIncludes(
      report.operationalErrors[0].message,
      "unknown argument: --bogus",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit report bytes are independent of process locale", async () => {
  const root = await auditFixture();
  const cOutput = `${root}/audit-c.json`;
  const swedishOutput = `${root}/audit-swedish.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.dependencies = {
      "zulu-dependency": "npm:zulu@1",
      "ä-dependency": "npm:umlaut@1",
      "å-dependency": "npm:ring@1",
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));

    const cResult = await runAudit(
      ["--root", root, "--output", cOutput],
      { LC_ALL: "C", LANG: "C" },
    );
    const swedishResult = await runAudit(
      ["--root", root, "--output", swedishOutput],
      { LC_ALL: "sv_SE.UTF-8", LANG: "sv_SE.UTF-8" },
    );
    assertEquals(cResult.code, 2, cResult.stderr);
    assertEquals(swedishResult.code, 2, swedishResult.stderr);
    assertEquals(
      await Deno.readTextFile(cOutput),
      await Deno.readTextFile(swedishOutput),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit operational reports are stable across repository locations", async () => {
  const reports: string[] = [];
  for (let index = 0; index < 2; index++) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      await Deno.remove(`${root}/src`, { recursive: true });
      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 3, result.stderr);
      reports.push(await Deno.readTextFile(outputPath));
      const report = JSON.parse(reports[index]);
      assertEquals(report.evidenceComplete, false);
      assertEquals(report.operationalErrors, [{
        code: "missing-production-root",
        message: "missing production root: src",
        path: "src",
      }]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
  assertEquals(reports[0], reports[1]);
});

Deno.test("strict audit normalizes structured collector error locations", async () => {
  const errors: string[] = [];
  for (let index = 0; index < 2; index++) {
    const root = await auditFixture();
    const sourcePath = `${root}/src/index.ts`;
    const outputPath = `${root}/audit.json`;
    try {
      await Deno.chmod(sourcePath, 0o000);
      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 3, result.stderr);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(report.evidenceComplete, false);
      assertEquals(report.operationalErrors.length, 1);
      assertEquals(report.operationalErrors[0].code, "read-failure");
      assertEquals(report.operationalErrors[0].path, "src/index.ts");
      assertEquals(report.operationalErrors[0].message.includes(root), false);
      errors.push(JSON.stringify(report.operationalErrors));
    } finally {
      await Deno.chmod(sourcePath, 0o600).catch(() => {});
      await Deno.remove(root, { recursive: true });
    }
  }
  assertEquals(errors[0], errors[1]);
});

Deno.test("core dependency collection rejects an empty production root", async () => {
  const root = await Deno.makeTempDir();
  const previousDirectory = Deno.cwd();
  try {
    await Deno.mkdir(`${root}/src`);
    Deno.chdir(root);
    await assertRejects(
      () => collectCoreProductionFiles(".", { requiredRoots: ["src"] }),
      Error,
      "Core dependency audit found zero eligible production files",
    );
  } finally {
    Deno.chdir(previousDirectory);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit CLI writes incomplete atomic evidence and exits 3 for zero eligible files", async () => {
  const root = await auditFixture();
  const previousDirectory = Deno.cwd();
  try {
    await Deno.mkdir(`${root}/empty`);
    await Deno.writeTextFile(`${root}/audit.json`, "stale report\n");
    Deno.chdir(root);

    const code = await runStrictCoreDependencyAuditCli(
      ["--root", ".", "--output", "audit.json"],
      {
        collectProductionFiles: () =>
          collectCoreProductionFiles(".", { requiredRoots: ["empty"] }),
      },
    );

    assertEquals(code, 3);
    const report = JSON.parse(await Deno.readTextFile("audit.json"));
    assertEquals(report.evidenceComplete, false);
    assertEquals(report.issues, []);
    assertEquals(report.examined.files, 0);
    assertEquals(
      report.operationalErrors.some((error: Record<string, unknown>) =>
        error.code === "traversal-failure" &&
        String(error.message).includes(
          "Core dependency audit found zero eligible production files",
        )
      ),
      true,
      JSON.stringify(report.operationalErrors, null, 2),
    );
    const names = (await Array.fromAsync(Deno.readDir("."))).map((entry) =>
      entry.name
    );
    assertEquals(
      names.some((name) =>
        name.startsWith(".audit.json.") && name.endsWith(".tmp")
      ),
      false,
    );
  } finally {
    Deno.chdir(previousDirectory);
    await Deno.remove(root, { recursive: true });
  }
});
