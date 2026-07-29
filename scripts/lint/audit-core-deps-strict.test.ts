import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { toFileUrl } from "#std/path";
import { CORE_RUNTIME_ENTRYPOINTS } from "./core-production-roots.ts";
import {
  runStrictCoreDependencyAudit,
  runStrictCoreDependencyAuditCli,
} from "./audit-core-deps-strict.ts";
import {
  collectCoreProductionFiles,
  collectSourceDependencies,
} from "./source-import-collector.ts";

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
  await writeSource(root, "react/react.ts");
  await Deno.writeTextFile(
    `${root}/react/deno.json`,
    JSON.stringify({ name: "@fixture/react", exports: "./react.ts" }),
  );
  await writeSource(root, "browser/studio-bridge/entry.ts");
  await Deno.writeTextFile(
    `${root}/browser/studio-bridge/deno.json`,
    JSON.stringify({
      name: "@fixture/studio-bridge",
      exports: "./entry.ts",
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

Deno.test("strict audit traverses mappings from a Deno loose config", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
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
    await writeSource(root, "src/index.ts", 'import "#mapped";\n');
    await writeSource(root, "src/mapped.ts", 'import "npm:loose-vendor@1";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/mapped.ts" &&
        entry.specifier === "npm:loose-vendor@1"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
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

Deno.test("strict audit rejects every forbidden requested or selected import-map identity", async (context) => {
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
        const selectedAddress = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
          intermediate,
        );
        const requested = selectedAddress ? "#facade" : intermediate;
        if (selectedAddress) {
          config.imports[requested] = intermediate;
        } else {
          config.imports[requested] = "./src/shim.ts";
        }
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(root, "src/shim.ts");
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(requested)};\n`,
        );

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
              specifier: requested,
              resolved: intermediate,
            },
            {
              contextId: "root-node",
              code: expectedCode,
              specifier: requested,
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
    config.imports["fixture/internal"] = "./src/shim.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/shim.ts");
    await writeSource(root, "src/index.ts", 'import "fixture/internal";\n');

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
        const shimPath = testCase.name.endsWith("/")
          ? "./src/shim/"
          : "./src/shim.ts";
        config.imports[testCase.name] = shimPath;
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(
          root,
          testCase.name.endsWith("/") ? "src/shim/index.ts" : "src/shim.ts",
        );
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(testCase.name)};\n`,
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
        const shimPath = testCase.name.endsWith("/")
          ? "./src/shim/"
          : "./src/shim.ts";
        config.imports[testCase.name] = shimPath;
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(
          root,
          testCase.name.endsWith("/") ? "src/shim/index.ts" : "src/shim.ts",
        );
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(testCase.name)};\n`,
        );

        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(
          result.code,
          2,
          `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
        );
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
              specifier: testCase.name,
              resolved: testCase.name,
            },
            {
              contextId: "root-node",
              code: "forbidden-bare-dependency",
              specifier: testCase.name,
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
    assertEquals(
      result.code,
      2,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
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

Deno.test("strict audit treats mixed-case outside file URLs as file identities", async (context) => {
  for (const mode of ["direct", "mapped"] as const) {
    await context.step(mode, async () => {
      const root = await auditFixture();
      const outside = await Deno.makeTempFile({ suffix: ".ts" });
      const outputPath = `${root}/audit.json`;
      try {
        const outsideUrl = toFileUrl(outside).href.replace(/^file:/, "FiLe:") +
          "?flavor=%31#piece-%32";
        const requested = mode === "direct" ? outsideUrl : "#mixed-outside";
        if (mode === "mapped") {
          const config = JSON.parse(
            await Deno.readTextFile(`${root}/deno.json`),
          );
          config.imports[requested] = outsideUrl;
          await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        }
        await writeSource(
          root,
          "src/index.ts",
          `import ${JSON.stringify(requested)};\n`,
        );

        const result = await runAudit([
          "--root",
          root,
          "--output",
          outputPath,
        ]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(
          result.code,
          2,
          `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
        );
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        const issues = report.issues.filter(
          (entry: Record<string, unknown>) =>
            entry.path === "src/index.ts" && entry.specifier === requested,
        );
        assertEquals(
          issues.map((entry: Record<string, unknown>) => ({
            contextId: entry.contextId,
            code: entry.code,
          })),
          [
            { contextId: "root-deno", code: "source-target-escapes-core" },
            { contextId: "root-node", code: "source-target-escapes-core" },
          ],
          JSON.stringify(report.issues, null, 2),
        );
      } finally {
        await Deno.remove(root, { recursive: true });
        await Deno.remove(outside);
      }
    });
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
      const expectedResolved = mode === "raw"
        ? "/src/evil.ts"
        : "file:///src/evil.ts";
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === requested &&
          entry.code === "source-target-escapes-core" &&
          entry.resolved === expectedResolved &&
          (mode === "raw" ||
            (entry.mapping as Record<string, unknown>)?.selectedAddress ===
              "/src/evil.ts")
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
          entry.code ===
            (mode === "configuration"
              ? "forbidden-bare-dependency"
              : "source-target-escapes-core") &&
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
      ? "src/%65vil.test.ts"
      : "./src/%65vil.test.ts";
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      let expectedSpecifier = encoded;
      if (mode === "source") {
        expectedSpecifier = "./%65vil.test.ts";
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
      if (mode === "configuration") {
        await writeSource(root, "src/%65vil.test.ts");
      } else {
        await writeSource(
          root,
          "src/evil.test.ts",
          'import "npm:canonical-encoded-edge@1";\n',
        );
      }

      const result = await runAudit(["--root", root, "--output", outputPath]);
      assertEquals(result.code, 2, `${mode}: ${result.stderr}`);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.code ===
            (mode === "configuration"
              ? "forbidden-bare-dependency"
              : "source-target-escapes-core") &&
          entry.specifier === expectedSpecifier &&
          (mode !== "configuration" ||
            entry.field === "compilerOptions.types")
        ),
        true,
        mode,
      );
      if (mode !== "configuration") {
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === "src/evil.test.ts" &&
            entry.specifier === "npm:canonical-encoded-edge@1"
          ),
          true,
          `${mode}: ${JSON.stringify(report.issues, null, 2)}`,
        );
      }
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
      path: "src/jsx/jsx-runtime.ts",
      configure: (config: Record<string, unknown>) => {
        config.compilerOptions = {
          jsx: "react-jsx",
          jsxImportSource: "#jsx",
        };
        (config.imports as Record<string, string>)["#jsx/jsx-runtime"] =
          "./src/jsx/jsx-runtime.ts";
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
      if (testCase.path === "src/jsx/jsx-runtime.ts") {
        await writeSource(
          root,
          "src/index.client.ts",
          'import "./jsx-consumer.tsx";\n',
        );
        await writeSource(
          root,
          "src/jsx-consumer.tsx",
          "// @ts-nocheck\nexport const view = <div />;\n",
        );
      }

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

Deno.test("strict audit force-includes an excluded local configuration code root", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = { types: ["./src/hidden-config.test.ts"] };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/hidden-config.test.ts",
      'import "npm:hidden-config-terminal@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      result.code,
      2,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.path === "src/hidden-config.test.ts" &&
          entry.specifier === "npm:hidden-config-terminal@1"
        )
        .map((entry: Record<string, unknown>) => entry.contextId),
      [
        "browser-runtime",
        "cli-deno",
        "cli-node",
        "root-deno",
        "root-node",
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit follows decorated configuration code targets with Deno-correlated physical traversal", async (context) => {
  const directCases = [
    ["plain control", ""],
    ["query", "?flavor=1"],
    ["hash", "#piece"],
    ["encoded query", "?flavor=%31"],
    ["encoded hash", "#piece-%31"],
    ["empty query", "?"],
    ["empty hash", "#"],
  ] as const;
  const indirectCases = [
    {
      label: "exact decorated bare key",
      target: "#configured?flavor=%31#piece-%32",
      imports: {
        "#configured?flavor=%31#piece-%32": "./src/configured-types.test.ts",
      },
    },
    {
      label: "decorated bare prefix suffix",
      target: "#configured/configured-types.test.ts?flavor=%31#piece-%32",
      imports: { "#configured/": "./src/" },
    },
    {
      label: "decorated selected address",
      target: "#configured",
      imports: {
        "#configured": "./src/configured-types.test.ts?flavor=%31#piece-%32",
      },
    },
    {
      label: "empty selected address decoration",
      target: "#configured-empty",
      imports: { "#configured-empty": "./src/configured-types.test.ts?" },
    },
  ] as const;
  const cases = [
    ...directCases.map(([label, decoration]) => ({
      label,
      target: `./src/configured-types.test.ts${decoration}`,
      imports: {},
    })),
    ...indirectCases,
  ];
  for (const testCase of cases) {
    await context.step(testCase.label, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        Object.assign(config.imports, testCase.imports);
        config.compilerOptions = { types: [testCase.target] };
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(
          root,
          "src/index.ts",
          "console.log(configuredValue);\n",
        );
        await writeSource(
          root,
          "src/configured-types.test.ts",
          "import \"data:text/javascript,export default 'configured-types'\";\n" +
            "declare global { const configuredValue: string; }\n" +
            "export {};\n",
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
        const runtimeError = new TextDecoder().decode(runtime.stderr);
        assertEquals(runtime.code, 0, runtimeError);
        assertEquals(
          runtimeError.includes("Cannot find name 'configuredValue'"),
          false,
          runtimeError,
        );

        const result = await runAudit([
          "--root",
          root,
          "--output",
          outputPath,
        ]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(
          result.code,
          2,
          `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
        );
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues
            .filter((entry: Record<string, unknown>) =>
              entry.path === "src/configured-types.test.ts" &&
              entry.specifier ===
                "data:text/javascript,export default 'configured-types'"
            )
            .map((entry: Record<string, unknown>) => entry.contextId),
          [
            "browser-runtime",
            "cli-deno",
            "cli-node",
            "root-deno",
            "root-node",
          ],
          JSON.stringify(report.issues, null, 2),
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit follows generated JSX runtime configuration subpaths", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = { jsx: "react-jsx", jsxImportSource: "#jsx" };
    config.imports["#jsx/jsx-runtime"] = "./src/jsx/jsx-runtime.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.client.ts",
      'import "./jsx-consumer.tsx";\n',
    );
    await writeSource(
      root,
      "src/jsx-consumer.tsx",
      "// @ts-nocheck\nexport const view = <div />;\n",
    );
    await writeSource(root, "src/jsx/jsx-runtime.ts", 'import "node:fs";\n');

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
      "./src/scoped/": { "#jsx/": "https://scoped-jsx.test/" },
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
        entry.resolved === "https://scoped-jsx.test/jsx-runtime"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit does not resolve generated JSX runtimes outside reachable importer scopes", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = {
      jsx: "react-jsx",
      jsxImportSource: "#jsx",
    };
    config.imports["#jsx/jsx-runtime"] =
      "https://unused-global-jsx.invalid/runtime.ts";
    config.scopes = {
      "./src/": {
        "#jsx/jsx-runtime": "./src/jsx/jsx-runtime.ts",
      },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      'import "./component.tsx";\n',
    );
    await writeSource(
      root,
      "src/component.tsx",
      "// @ts-nocheck\nexport const component = <div />;\n",
    );
    await writeSource(
      root,
      "src/jsx/jsx-runtime.ts",
      "export function jsx(type: unknown, props: unknown) { " +
        "return { type, props }; }\n" +
        "export const jsxs = jsx;\n" +
        "export const Fragment = Symbol();\n",
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

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      result.code,
      0,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(report.issues, []);
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
      "./src/scoped/": { "#pragma/": "https://pragma-jsx.test/" },
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
        entry.resolved === "https://pragma-jsx.test/jsx-runtime"
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

Deno.test("strict audit parses the baseline once and context-scans target-only closure on demand", async () => {
  const root = await auditFixture();
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["."] = {
      node: "./src/node-only.ts",
      default: "./src/index.ts",
    };
    config.imports["#unused-local"] = "./src/unused-mapping.test.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/node-only.ts",
      'import "./node-transitive.ts";\n',
    );
    await writeSource(root, "src/node-transitive.ts");
    await writeSource(root, "src/orphan.ts");
    await writeSource(
      root,
      "src/unused-mapping.test.ts",
      'import "npm:unused-mapping-terminal@1";\n',
    );

    const rawScans = new Map<string, number>();
    const contextualScans = new Map<string, number>();
    const wrappedCollector = (
      ...args: Parameters<typeof collectSourceDependencies>
    ) => {
      const [file, options] = args;
      const scans = options?.resolveModuleSpecifier
        ? contextualScans
        : rawScans;
      scans.set(file.path, (scans.get(file.path) ?? 0) + 1);
      return collectSourceDependencies(...args);
    };

    const report = await runStrictCoreDependencyAudit(root, {
      collectSourceDependencies: wrappedCollector,
    });
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(rawScans.get("src/node-only.ts"), 1);
    assertEquals(rawScans.get("src/node-transitive.ts"), 1);
    assertEquals(rawScans.get("src/orphan.ts"), 1);
    assertEquals(contextualScans.get("src/node-only.ts"), 1);
    assertEquals(contextualScans.get("src/node-transitive.ts"), 1);
    assertEquals(contextualScans.get("src/orphan.ts"), 2);
    assertEquals(rawScans.has("src/unused-mapping.test.ts"), false);
    assertEquals(contextualScans.has("src/unused-mapping.test.ts"), false);
    assert(
      [...contextualScans.values()].every((count) => count <= 3),
      JSON.stringify([...contextualScans]),
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
        line: 4,
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
        line: 4,
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

Deno.test("strict audit treats unused local container spreads as containment", async (context) => {
  for (
    const [name, content] of [
      [
        "object spread",
        "const original = { load: require };\nconst copy = { ...original };\nvoid copy;\n",
      ],
      [
        "array spread",
        "const original = [require];\nconst copy = [...original];\nvoid copy;\n",
      ],
    ] as const
  ) {
    await context.step(name, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(root, "src/index.ts", content);
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
  for (
    const [name, content] of [
      [
        "object spread escape",
        "const original = { load: require };\nconst copy = { ...original };\nuse(copy);\n",
      ],
      [
        "array spread escape",
        "const original = [require];\nconst copy = [...original];\nuse(copy);\n",
      ],
    ] as const
  ) {
    await context.step(name, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        await writeSource(root, "src/index.ts", content);
        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === "src/index.ts" && entry.line === 3 &&
            entry.code === "unresolved-runtime-loader" &&
            entry.loader === "require-alias"
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

Deno.test("strict audit rejects unsupported deno-config extends as incomplete evidence", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.extends = "./base.json";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await Deno.writeTextFile(
      `${root}/base.json`,
      JSON.stringify({ compilerOptions: { noImplicitAny: false } }),
    );
    await Deno.writeTextFile(
      `${root}/extends-probe.ts`,
      "export function identity(value) { return value; }\n",
    );
    const denoProbe = await new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        `${root}/deno.json`,
        `${root}/extends-probe.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(denoProbe.code, 1);
    assertStringIncludes(new TextDecoder().decode(denoProbe.stderr), "TS7006");

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 3, result.stderr);
    assertEquals(report.evidenceComplete, false);
    assertEquals(
      report.operationalErrors[0]?.code,
      "unsupported-config-extends",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit loads contained relative and file-URL external import maps relative to the map file", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    delete config.imports;
    await Deno.mkdir(`${root}/config`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/config/import-map.json`,
      '{"imports":{"#local":"../src/local.ts","#\\uD83D\\uDE00":"../src/local.ts"}}',
    );
    await writeSource(root, "src/local.ts");
    await writeSource(root, "src/index.ts", 'import "#local";\n');

    for (
      const reference of [
        "./config/import-map.json",
        toFileUrl(`${root}/config/import-map.json`).href,
        toFileUrl(`${root}/config/import-map.json`).href.replace(
          /^file:/,
          "FILE:",
        ),
      ]
    ) {
      config.importMap = reference;
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
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
      assertEquals(
        runtime.code,
        0,
        `${reference}: ${new TextDecoder().decode(runtime.stderr)}`,
      );
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 0, `${reference}: ${result.stderr}`);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(report.issues, []);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit rejects every incomplete external import-map configuration", async () => {
  const cases = [
    "conflict",
    "missing",
    "malformed",
    "escaping",
    "external",
    "symlink",
    "jsonc-comment",
    "jsonc-trailing-comma",
    "jsonc-unquoted-key",
    "jsonc-single-quoted-string",
    "json-lone-high-surrogate",
    "json-lone-low-surrogate",
    "json-number-overflow",
  ] as const;
  const actual: Array<{ label: string; exit: number; code?: string }> = [];
  for (const label of cases) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    let outside: string | undefined;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      if (label !== "conflict") delete config.imports;
      if (label === "external") {
        config.importMap = "https://example.test/import-map.json";
      } else if (label === "escaping") {
        config.importMap = "../outside-import-map.json";
      } else {
        config.importMap = "./config/import-map.json";
      }
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      if (!["missing", "escaping", "external"].includes(label)) {
        await Deno.mkdir(`${root}/config`, { recursive: true });
        if (label === "malformed") {
          await Deno.writeTextFile(`${root}/config/import-map.json`, "{");
        } else if (label === "jsonc-comment") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            '{\n  // External import maps remain strict JSON.\n  "imports": {}\n}\n',
          );
        } else if (label === "jsonc-trailing-comma") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            '{ "imports": {}, }\n',
          );
        } else if (label === "jsonc-unquoted-key") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            "{ imports: {} }\n",
          );
        } else if (label === "jsonc-single-quoted-string") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            `{ "imports": { "#local": '../src/local.ts' } }\n`,
          );
        } else if (label === "json-lone-high-surrogate") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            '{ "imports": { "#\\uD800": "../src/local.ts" } }\n',
          );
        } else if (label === "json-lone-low-surrogate") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            '{ "imports": { "#\\uDC00": "../src/local.ts" } }\n',
          );
        } else if (label === "json-number-overflow") {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            '{ "imports": {}, "integrity": { "probe": 1e400 } }\n',
          );
        } else if (label === "symlink") {
          outside = await Deno.makeTempDir();
          await Deno.writeTextFile(
            `${outside}/import-map.json`,
            JSON.stringify({ imports: {} }),
          );
          await Deno.symlink(
            `${outside}/import-map.json`,
            `${root}/config/import-map.json`,
          );
        } else {
          await Deno.writeTextFile(
            `${root}/config/import-map.json`,
            JSON.stringify({ imports: {} }),
          );
        }
      }

      if (
        [
          "jsonc-comment",
          "jsonc-trailing-comma",
          "jsonc-unquoted-key",
          "jsonc-single-quoted-string",
          "json-lone-high-surrogate",
          "json-lone-low-surrogate",
          "json-number-overflow",
        ].includes(label)
      ) {
        const runtime = await new Deno.Command(Deno.execPath(), {
          args: [
            "check",
            "--reload",
            "--config",
            `${root}/deno.json`,
            `${root}/src/index.ts`,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(
          runtime.code,
          1,
          `${label}: ${new TextDecoder().decode(runtime.stderr)}`,
        );
      }

      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      actual.push({
        label,
        exit: result.code,
        code: report.operationalErrors[0]?.code,
      });
    } finally {
      await Deno.remove(root, { recursive: true });
      if (outside) await Deno.remove(outside, { recursive: true });
    }
  }
  assertEquals(actual, [
    { label: "conflict", exit: 3, code: "conflicting-import-map" },
    { label: "missing", exit: 3, code: "missing-import-map" },
    { label: "malformed", exit: 3, code: "import-map-parse-failure" },
    { label: "escaping", exit: 3, code: "import-map-path-escape" },
    { label: "external", exit: 3, code: "unsupported-import-map-reference" },
    { label: "symlink", exit: 3, code: "import-map-path-escape" },
    {
      label: "jsonc-comment",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "jsonc-trailing-comma",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "jsonc-unquoted-key",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "jsonc-single-quoted-string",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "json-lone-high-surrogate",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "json-lone-low-surrogate",
      exit: 3,
      code: "import-map-parse-failure",
    },
    {
      label: "json-number-overflow",
      exit: 3,
      code: "import-map-parse-failure",
    },
  ]);
});

Deno.test("strict audit rejects external, escaping, encoded, and ambiguous import-map scopes", async () => {
  const cases = ["external", "escaping", "encoded", "ambiguous"] as const;
  const actual: Array<{
    label: string;
    exit: number;
    code?: string;
  }> = [];
  for (const label of cases) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    let outside: string | undefined;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      if (label === "external") {
        config.scopes = {
          "https://example.test/scope/": { "#scope": "./src/a.ts" },
        };
      } else if (label === "escaping") {
        outside = await Deno.makeTempDir();
        config.scopes = {
          [toFileUrl(`${outside}/`).href]: { "#scope": "./src/a.ts" },
        };
      } else if (label === "encoded") {
        config.scopes = {
          "./src/%2e%2e/": { "#scope": "./src/a.ts" },
        };
      } else {
        config.scopes = {
          "./src/": { "#scope": "./src/a.ts" },
          [toFileUrl(`${root}/src/`).href]: { "#scope": "./src/b.ts" },
        };
        await writeSource(root, "src/index.ts", 'import "#scope";\n');
      }
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(root, "src/a.ts");
      await writeSource(root, "src/b.ts");

      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      actual.push({
        label,
        exit: result.code,
        code: report.operationalErrors[0]?.code,
      });
    } finally {
      await Deno.remove(root, { recursive: true });
      if (outside) await Deno.remove(outside, { recursive: true });
    }
  }
  assertEquals(actual, [
    { label: "external", exit: 3, code: "import-map-validation-failure" },
    { label: "escaping", exit: 3, code: "import-map-validation-failure" },
    { label: "encoded", exit: 3, code: "import-map-validation-failure" },
    { label: "ambiguous", exit: 3, code: "binding-resolution-failure" },
  ]);
});

Deno.test("strict audit applies URL-like import-map keys in canonical importer space", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["./src/dep.ts"] =
      "data:text/javascript,export%20default%201";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/dep.ts");
    await writeSource(root, "src/index.ts", 'import "./dep.ts";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.specifier === "./dep.ts"
        )
        .map((entry: Record<string, unknown>) => ({
          contextId: entry.contextId,
          code: entry.code,
          trace: entry.trace,
          terminal: entry.terminal,
        })),
      [
        {
          contextId: "root-deno",
          code: "forbidden-external-dependency",
          trace: ["./dep.ts", "data:text/javascript,export%20default%201"],
          terminal: "data:text/javascript,export%20default%201",
        },
        {
          contextId: "root-node",
          code: "forbidden-external-dependency",
          trace: ["./dep.ts", "data:text/javascript,export%20default%201"],
          terminal: "data:text/javascript,export%20default%201",
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit retains encoded URL-like mapping-key provenance without losing canonical traversal", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.scopes = {
      "./src/": {
        "./src/%65ncoded-key.ts": "./src/selected.test.ts",
      },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      'import "./%65ncoded-key.ts";\n',
    );
    await writeSource(
      root,
      "src/selected.test.ts",
      'import "npm:encoded-key-terminal@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    const provenanceIssues = report.issues.filter(
      (entry: Record<string, unknown>) =>
        (entry.provenanceDecision as Record<string, unknown>)?.field ===
          "sourceKey",
    );
    assertEquals(provenanceIssues.length, 2);
    for (const entry of provenanceIssues) {
      assertEquals(entry.trace, [
        "./%65ncoded-key.ts",
        "./src/encoded-key.ts",
        "./src/selected.test.ts",
      ]);
      assertEquals(entry.mapping, {
        owner: "deno.json",
        base: "./",
        sourceKey: "./src/%65ncoded-key.ts",
        canonicalKey: "./src/%65ncoded-key.ts",
        selectedAddress: "./src/selected.test.ts",
        canonicalTarget: "./src/selected.test.ts",
        sourceScope: "./src/",
        canonicalScope: "./src/",
      });
      assertEquals(entry.provenanceDecision, {
        kind: "noncanonical-path-encoding",
        field: "sourceKey",
        identity: "./src/%65ncoded-key.ts",
      });
    }
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.specifier === "npm:encoded-key-terminal@1"
        )
        .map((entry: Record<string, unknown>) => entry.path),
      ["src/selected.test.ts", "src/selected.test.ts"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit keeps an equal-spelling mapped terminal relative to the map base", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["./src/dep.ts"] = "./dep.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/dep.ts");
    await writeSource(root, "src/index.ts", 'import "./dep.ts";\n');
    await Deno.writeTextFile(
      `${root}/dep.ts`,
      'import "npm:map-base-terminal@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" && entry.specifier === "./dep.ts" &&
        entry.code === "source-target-escapes-core" &&
        entry.resolved === "dep.ts" &&
        (entry.mapping as Record<string, unknown>)?.selectedAddress ===
          "./dep.ts"
      ),
      true,
      JSON.stringify(report.issues, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit canonicalizes a selected prefix suffix before forced traversal", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["#prefix/"] = "./src/prefix/";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      'import "#prefix/%68idden.test.ts";\n',
    );
    await writeSource(
      root,
      "src/prefix/hidden.test.ts",
      'import "npm:canonical-prefix-terminal@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.path === "src/prefix/hidden.test.ts" &&
          entry.specifier === "npm:canonical-prefix-terminal@1"
        )
        .map((entry: Record<string, unknown>) => entry.contextId),
      ["root-deno", "root-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit separates bare-map decorations from encoded paths", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const exactSpecifier = "#exact?flavor=%31#piece-%32";
    const prefixSpecifier = "#prefix/value.test.ts?flavor=%31#piece-%32";
    const encodedPathSpecifier = "#prefix/%76alue.test.ts?flavor=%33#piece-%34";
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports[exactSpecifier] = "./src/bare/exact.test.ts";
    config.imports["#prefix/"] = "./src/bare/";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      `import ${JSON.stringify(exactSpecifier)};\n` +
        `import ${JSON.stringify(prefixSpecifier)};\n` +
        `import ${JSON.stringify(encodedPathSpecifier)};\n`,
    );
    await writeSource(
      root,
      "src/bare/exact.test.ts",
      "import \"data:text/javascript,export default 'bare-exact'\";\n",
    );
    await writeSource(
      root,
      "src/bare/value.test.ts",
      "import \"data:text/javascript,export default 'bare-prefix'\";\n",
    );

    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/src/index.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));

    const result = await runAudit([
      "--root",
      root,
      "--output",
      outputPath,
    ]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    for (const specifier of [exactSpecifier, prefixSpecifier]) {
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === specifier &&
          entry.code === "source-target-escapes-core"
        ),
        false,
        JSON.stringify(report.issues, null, 2),
      );
    }
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" &&
        entry.specifier === encodedPathSpecifier &&
        entry.code === "source-target-escapes-core" &&
        (entry.provenanceDecision as Record<string, unknown>)?.field ===
          "selectedAddress"
      ),
      true,
      JSON.stringify(report.issues, null, 2),
    );
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.path === "src/bare/exact.test.ts" ||
          entry.path === "src/bare/value.test.ts"
        )
        .map((entry: Record<string, unknown>) => ({
          contextId: entry.contextId,
          path: entry.path,
          specifier: entry.specifier,
        })),
      [
        {
          contextId: "root-deno",
          path: "src/bare/exact.test.ts",
          specifier: "data:text/javascript,export default 'bare-exact'",
        },
        {
          contextId: "root-deno",
          path: "src/bare/value.test.ts",
          specifier: "data:text/javascript,export default 'bare-prefix'",
        },
        {
          contextId: "root-node",
          path: "src/bare/exact.test.ts",
          specifier: "data:text/javascript,export default 'bare-exact'",
        },
        {
          contextId: "root-node",
          path: "src/bare/value.test.ts",
          specifier: "data:text/javascript,export default 'bare-prefix'",
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit fails only when an opaque import-map prefix is used", async (context) => {
  for (const used of [false, true]) {
    await context.step(used ? "used" : "unused", async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        config.imports["#opaque/"] = "data:text/javascript,export default 1;/";
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(
          root,
          "src/index.ts",
          used ? 'import "#opaque/value.ts";\n' : "export {};\n",
        );

        const runtime = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--config",
            `${root}/deno.json`,
            `${root}/src/index.ts`,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
        const runtimeError = new TextDecoder().decode(runtime.stderr);
        assertEquals(runtime.code, used ? 1 : 0, runtimeError);
        assertEquals(
          runtimeError.includes(
            "could not be URL-parsed relative to the URL prefix",
          ),
          used,
          runtimeError,
        );

        const result = await runAudit([
          "--root",
          root,
          "--output",
          outputPath,
        ]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, used ? 3 : 0, result.stderr);
        assertEquals(report.evidenceComplete, !used);
        if (used) {
          assertEquals(report.operationalErrors.length, 1);
          assertEquals(
            report.operationalErrors[0]?.code,
            "binding-resolution-failure",
          );
          assertEquals(report.operationalErrors[0]?.path, "src/index.ts");
          assertStringIncludes(
            report.operationalErrors[0]?.message ?? "",
            "import-map prefix suffix could not be URL-parsed relative to import-map prefix target: deno.json: #opaque/: #opaque/value.ts",
          );
        } else {
          assertEquals(report.operationalErrors, []);
        }
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
  await context.step("shadowed by a longer valid prefix", async () => {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      config.imports["#opaque/"] = "data:text/javascript,export default 1;/";
      config.imports["#opaque/safe/"] = "./src/safe/";
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(
        root,
        "src/index.ts",
        'import "#opaque/safe/value.ts";\n',
      );
      await writeSource(root, "src/safe/value.ts");

      const runtime = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          `${root}/deno.json`,
          `${root}/src/index.ts`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        runtime.code,
        0,
        new TextDecoder().decode(runtime.stderr),
      );

      const result = await runAudit([
        "--root",
        root,
        "--output",
        outputPath,
      ]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 0, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(report.issues, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

Deno.test("strict audit traverses decorated local targets with location-stable evidence", async () => {
  const reports: string[] = [];
  for (let fixtureIndex = 0; fixtureIndex < 2; fixtureIndex++) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      config.imports["npm:exact-query-entry@1"] =
        "./src/exact-query.test.ts?flavor=1";
      config.imports["npm:exact-hash-entry@1"] =
        "./src/exact-hash.test.ts#piece";
      config.imports["npm:exact-encoded-query-entry@1"] =
        "./src/exact-encoded-query.test.ts?flavor=%31";
      config.imports["npm:exact-encoded-hash-entry@1"] =
        "./src/exact-encoded-hash.test.ts#piece-%31";
      config.imports["npm:exact-empty-query-entry@1"] =
        "./src/exact-empty-query.test.ts?";
      config.imports["npm:exact-empty-hash-entry@1"] =
        "./src/exact-empty-hash.test.ts#";
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      await writeSource(
        root,
        "src/index.ts",
        'import "npm:exact-query-entry@1";\n' +
          'import "npm:exact-hash-entry@1";\n' +
          'import "npm:exact-encoded-query-entry@1";\n' +
          'import "npm:exact-encoded-hash-entry@1";\n' +
          'import "npm:exact-empty-query-entry@1";\n' +
          'import "npm:exact-empty-hash-entry@1";\n' +
          'import "./direct-query.test.ts?flavor=1";\n' +
          'import "./direct-hash.test.ts#piece";\n' +
          'import "./direct-encoded-query.test.ts?flavor=%31";\n' +
          'import "./direct-encoded-hash.test.ts#piece-%31";\n' +
          'import "./direct-empty-query.test.ts?";\n' +
          'import "./direct-empty-hash.test.ts#";\n',
      );
      const terminals = [
        [
          "src/exact-query.test.ts",
          "data:text/javascript,export default 'exact-query'",
        ],
        [
          "src/exact-hash.test.ts",
          "data:text/javascript,export default 'exact-hash'",
        ],
        [
          "src/direct-query.test.ts",
          "data:text/javascript,export default 'direct-query'",
        ],
        [
          "src/direct-hash.test.ts",
          "data:text/javascript,export default 'direct-hash'",
        ],
        [
          "src/exact-encoded-query.test.ts",
          "data:text/javascript,export default 'exact-encoded-query'",
        ],
        [
          "src/exact-encoded-hash.test.ts",
          "data:text/javascript,export default 'exact-encoded-hash'",
        ],
        [
          "src/direct-encoded-query.test.ts",
          "data:text/javascript,export default 'direct-encoded-query'",
        ],
        [
          "src/direct-encoded-hash.test.ts",
          "data:text/javascript,export default 'direct-encoded-hash'",
        ],
        [
          "src/exact-empty-query.test.ts",
          "data:text/javascript,export default 'exact-empty-query'",
        ],
        [
          "src/exact-empty-hash.test.ts",
          "data:text/javascript,export default 'exact-empty-hash'",
        ],
        [
          "src/direct-empty-query.test.ts",
          "data:text/javascript,export default 'direct-empty-query'",
        ],
        [
          "src/direct-empty-hash.test.ts",
          "data:text/javascript,export default 'direct-empty-hash'",
        ],
      ] as const;
      for (const [path, terminal] of terminals) {
        await writeSource(root, path, `import ${JSON.stringify(terminal)};\n`);
      }

      const runtime = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          `${root}/deno.json`,
          `${root}/src/index.ts`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        runtime.code,
        0,
        new TextDecoder().decode(runtime.stderr),
      );

      const result = await runAudit([
        "--root",
        root,
        "--output",
        outputPath,
      ]);
      const bytes = await Deno.readTextFile(outputPath);
      const report = JSON.parse(bytes);
      assertEquals(result.code, 2, result.stderr);
      assertEquals(report.evidenceComplete, true);
      assertEquals(report.operationalErrors, []);
      assertEquals(bytes.includes(root), false, bytes);
      const compareIssue = (
        left: Record<string, unknown>,
        right: Record<string, unknown>,
      ): number => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      };
      assertEquals(
        report.issues
          .filter((entry: Record<string, unknown>) =>
            terminals.some(([path, terminal]) =>
              entry.path === path && entry.specifier === terminal
            )
          )
          .map((entry: Record<string, unknown>) => ({
            contextId: entry.contextId,
            path: entry.path,
            specifier: entry.specifier,
          }))
          .sort(compareIssue),
        terminals.flatMap(([path, specifier]) =>
          ["root-deno", "root-node"].map((contextId) => ({
            contextId,
            path,
            specifier,
          }))
        ).sort(compareIssue),
      );
      for (
        const [specifier, canonicalTarget] of [
          [
            "npm:exact-query-entry@1",
            "./src/exact-query.test.ts?flavor=1",
          ],
          [
            "npm:exact-hash-entry@1",
            "./src/exact-hash.test.ts#piece",
          ],
          [
            "npm:exact-encoded-query-entry@1",
            "./src/exact-encoded-query.test.ts?flavor=%31",
          ],
          [
            "npm:exact-encoded-hash-entry@1",
            "./src/exact-encoded-hash.test.ts#piece-%31",
          ],
          [
            "npm:exact-empty-query-entry@1",
            "./src/exact-empty-query.test.ts?",
          ],
          [
            "npm:exact-empty-hash-entry@1",
            "./src/exact-empty-hash.test.ts#",
          ],
        ] as const
      ) {
        const entries = report.issues.filter(
          (entry: Record<string, unknown>) => entry.specifier === specifier,
        );
        assertEquals(entries.length, 2, JSON.stringify(report.issues, null, 2));
        for (const entry of entries) {
          assertEquals(entry.trace, [specifier, canonicalTarget]);
          assertEquals(
            (entry.mapping as Record<string, unknown>)?.canonicalTarget,
            canonicalTarget,
          );
        }
      }
      reports.push(bytes);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
  assertEquals(reports[0], reports[1]);
});

Deno.test("strict audit retains raw encoded file-URL evidence while traversing its canonical target", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const repositoryUrl = toFileUrl(`${root}/`).href;
    const encodedPathUrl = `${
      new URL("src/deep/", repositoryUrl).href
    }%2e%2e/encoded-file.test.ts?flavor=%31#piece-%31`;
    const plainPathUrl = new URL(
      "src/plain-file.test.ts?flavor=%31#piece-%31",
      repositoryUrl,
    ).href;
    const mixedCaseEncodedPathUrl = encodedPathUrl.replace(
      /^file:/,
      "FiLe:",
    ).replace("flavor=%31", "flavor=%32");
    const mixedCasePlainPathUrl = plainPathUrl.replace(/^file:/, "FILE:")
      .replace("flavor=%31", "flavor=%32");
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["#mapped-mixed-encoded"] = mixedCaseEncodedPathUrl;
    config.imports["#mapped-mixed-plain"] = mixedCasePlainPathUrl;
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      `import ${JSON.stringify(encodedPathUrl)};\n` +
        `import ${JSON.stringify(plainPathUrl)};\n` +
        `import ${JSON.stringify(mixedCaseEncodedPathUrl)};\n` +
        `import ${JSON.stringify(mixedCasePlainPathUrl)};\n` +
        'import "#mapped-mixed-encoded";\n' +
        'import "#mapped-mixed-plain";\n',
    );
    await writeSource(
      root,
      "src/encoded-file.test.ts",
      "import \"data:text/javascript,export default 'encoded-file'\";\n",
    );
    await writeSource(
      root,
      "src/plain-file.test.ts",
      "import \"data:text/javascript,export default 'plain-file'\";\n",
    );

    const runtime = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${root}/deno.json`,
        `${root}/src/index.ts`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(runtime.code, 0, new TextDecoder().decode(runtime.stderr));

    const result = await runAudit([
      "--root",
      root,
      "--output",
      outputPath,
    ]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    for (
      const [specifier, canonicalTarget] of [
        [
          encodedPathUrl,
          "./src/encoded-file.test.ts?flavor=%31#piece-%31",
        ],
        [
          mixedCaseEncodedPathUrl,
          "./src/encoded-file.test.ts?flavor=%32#piece-%31",
        ],
      ] as const
    ) {
      const encodedIssues = report.issues.filter(
        (entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === specifier &&
          entry.code === "source-target-escapes-core",
      );
      assertEquals(
        encodedIssues.length,
        2,
        JSON.stringify(report.issues, null, 2),
      );
      for (const entry of encodedIssues) {
        assertEquals(entry.hopIdentity, specifier);
        assertEquals(entry.trace, [specifier, canonicalTarget]);
      }
    }
    for (const specifier of [plainPathUrl, mixedCasePlainPathUrl]) {
      assertEquals(
        report.issues.some((entry: Record<string, unknown>) =>
          entry.path === "src/index.ts" && entry.specifier === specifier
        ),
        false,
        JSON.stringify(report.issues, null, 2),
      );
    }
    const mappedEncodedIssues = report.issues.filter(
      (entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" &&
        entry.specifier === "#mapped-mixed-encoded" &&
        entry.code === "source-target-escapes-core",
    );
    assertEquals(
      mappedEncodedIssues.length,
      2,
      JSON.stringify(report.issues, null, 2),
    );
    for (const entry of mappedEncodedIssues) {
      assertEquals(entry.trace, [
        "#mapped-mixed-encoded",
        "./src/encoded-file.test.ts?flavor=%32#piece-%31",
      ]);
      assertEquals(
        (entry.mapping as Record<string, unknown>)?.selectedAddress,
        mixedCaseEncodedPathUrl,
      );
      assertEquals(
        (entry.provenanceDecision as Record<string, unknown>)?.field,
        "selectedAddress",
      );
    }
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" &&
        entry.specifier === "#mapped-mixed-plain"
      ),
      false,
      JSON.stringify(report.issues, null, 2),
    );
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.path === "src/encoded-file.test.ts" ||
          entry.path === "src/plain-file.test.ts"
        )
        .map((entry: Record<string, unknown>) => ({
          contextId: entry.contextId,
          path: entry.path,
          specifier: entry.specifier,
        })),
      [
        {
          contextId: "root-deno",
          path: "src/encoded-file.test.ts",
          specifier: "data:text/javascript,export default 'encoded-file'",
        },
        {
          contextId: "root-deno",
          path: "src/plain-file.test.ts",
          specifier: "data:text/javascript,export default 'plain-file'",
        },
        {
          contextId: "root-node",
          path: "src/encoded-file.test.ts",
          specifier: "data:text/javascript,export default 'encoded-file'",
        },
        {
          contextId: "root-node",
          path: "src/plain-file.test.ts",
          specifier: "data:text/javascript,export default 'plain-file'",
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit traverses the one-hop selected import-map address", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["#facade"] = "./src/a.test.ts";
    config.imports["./src/a.test.ts"] = "./src/b.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/index.ts", 'import "#facade";\n');
    await writeSource(root, "src/a.test.ts", 'import "npm:hidden-edge@1";\n');
    await writeSource(root, "src/b.ts");

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.specifier === "npm:hidden-edge@1"
        )
        .map((entry: Record<string, unknown>) => ({
          contextId: entry.contextId,
          path: entry.path,
          code: entry.code,
        })),
      [
        {
          contextId: "root-deno",
          path: "src/a.test.ts",
          code: "forbidden-external-dependency",
        },
        {
          contextId: "root-node",
          path: "src/a.test.ts",
          code: "forbidden-external-dependency",
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit discovers prefix and scoped selected excluded-name addresses but ignores unused mappings", async (context) => {
  for (const mode of ["prefix", "scoped", "unused"] as const) {
    await context.step(mode, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        const selectedPath = `src/${mode}/hidden.test.ts`;
        const selectedSpecifier = mode === "scoped"
          ? "#scoped/hidden.test.ts"
          : "#hidden/hidden.test.ts";
        if (mode === "scoped") {
          config.scopes = {
            "./src/": { "#scoped/": "./src/scoped/" },
          };
        } else {
          config.imports["#hidden/"] = `./src/${mode}/`;
        }
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        await writeSource(
          root,
          "src/index.ts",
          mode === "unused"
            ? "export {};\n"
            : `import ${JSON.stringify(selectedSpecifier)};\n`,
        );
        await writeSource(
          root,
          selectedPath,
          `import "npm:${mode}-hidden-edge@1";\n`,
        );

        const result = await runAudit(["--root", root, "--output", outputPath]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        assertEquals(result.code, mode === "unused" ? 0 : 2, result.stderr);
        assertEquals(report.evidenceComplete, true);
        assertEquals(report.operationalErrors, []);
        assertEquals(
          report.issues.some((entry: Record<string, unknown>) =>
            entry.path === selectedPath &&
            entry.specifier === `npm:${mode}-hidden-edge@1`
          ),
          mode !== "unused",
          JSON.stringify(report.issues, null, 2),
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit rejects every malformed import-map address before traversal", async () => {
  for (
    const [label, imports] of [
      ["bare target", { "#a": "#b" }],
      ["prefix slash mismatch", { "#x/": "./src/runtime" }],
    ] as const
  ) {
    const root = await auditFixture();
    const outputPath = `${root}/audit.json`;
    try {
      const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
      config.imports = imports;
      await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
      const result = await runAudit(["--root", root, "--output", outputPath]);
      const report = JSON.parse(await Deno.readTextFile(outputPath));
      assertEquals(result.code, 3, `${label}: ${result.stderr}`);
      assertEquals(report.evidenceComplete, false);
      assertEquals(
        report.operationalErrors[0]?.code,
        "import-map-validation-failure",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("strict audit preserves a forbidden request and traverses its selected local address", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["npm:intermediate@1"] = "./src/terminal.ts";
    config.exports["./head"] = "./src/head.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/head.ts", 'import "npm:intermediate@1";\n');
    await writeSource(
      root,
      "src/terminal.ts",
      'import "npm:terminal-edge@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    const intermediate = report.issues.filter(
      (entry: Record<string, unknown>) =>
        entry.resolved === "npm:intermediate@1",
    );
    assertEquals(intermediate.length, 3);
    for (const entry of intermediate) {
      assertEquals(entry.trace, [
        "npm:intermediate@1",
        "./src/terminal.ts",
      ]);
      assertEquals(entry.terminal, "./src/terminal.ts");
      assertEquals(entry.hopIndex, 0);
      assertEquals(entry.hopIdentity, "npm:intermediate@1");
      assertEquals(entry.policyTrace, [
        {
          identity: "npm:intermediate@1",
          code: "forbidden-external-dependency",
        },
        { identity: "./src/terminal.ts", code: null },
      ]);
    }
    assertEquals(
      report.issues
        .filter((entry: Record<string, unknown>) =>
          entry.specifier === "npm:terminal-edge@1"
        )
        .map((entry: Record<string, unknown>) => entry.contextId)
        .sort(),
      ["browser-runtime", "root-deno", "root-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit reports policy provenance for the request and selected address", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["npm:first@1"] = "https://example.test/second.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/index.ts", 'import "npm:first@1";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    const traced = report.issues.filter(
      (entry: Record<string, unknown>) => entry.specifier === "npm:first@1",
    );
    assertEquals(traced.length, 4, JSON.stringify(traced, null, 2));
    for (const contextId of ["root-deno", "root-node"]) {
      const contextIssues = traced.filter(
        (entry: Record<string, unknown>) => entry.contextId === contextId,
      ).sort((left: Record<string, unknown>, right: Record<string, unknown>) =>
        Number(left.hopIndex) - Number(right.hopIndex)
      );
      assertEquals(
        contextIssues.map((entry: Record<string, unknown>) => ({
          code: entry.code,
          hopIndex: entry.hopIndex,
          hopIdentity: entry.hopIdentity,
        })),
        [
          {
            code: "forbidden-external-dependency",
            hopIndex: 0,
            hopIdentity: "npm:first@1",
          },
          {
            code: "forbidden-external-dependency",
            hopIndex: 1,
            hopIdentity: "https://example.test/second.ts",
          },
        ],
      );
      for (const entry of contextIssues) {
        assertEquals(entry.trace, [
          "npm:first@1",
          "https://example.test/second.ts",
        ]);
        assertEquals(entry.terminal, "https://example.test/second.ts");
        assertEquals(entry.policyTrace, [
          {
            identity: "npm:first@1",
            code: "forbidden-external-dependency",
          },
          {
            identity: "https://example.test/second.ts",
            code: "forbidden-external-dependency",
          },
        ]);
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit resolves manifest self subpaths and rejects unexported self subpaths", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["./head"] = {
      browser: "./src/public.browser.ts",
      default: "./src/public.default.ts",
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/public.browser.ts", 'import "node:fs";\n');
    await writeSource(root, "src/public.default.ts");
    await writeSource(root, "src/index.ts", 'import "fixture/head";\n');

    const resolved = await runAudit(["--root", root, "--output", outputPath]);
    const resolvedReport = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(resolved.code, 2, resolved.stderr);
    assertEquals(
      resolvedReport.issues.map((entry: Record<string, unknown>) => ({
        contextId: entry.contextId,
        code: entry.code,
        specifier: entry.specifier,
      })),
      [{
        contextId: "browser-runtime",
        code: "unsupported-or-invalid-builtin",
        specifier: "node:fs",
      }],
    );

    await writeSource(root, "src/index.ts", 'import "fixture/private";\n');
    const unexported = await runAudit(["--root", root, "--output", outputPath]);
    const unexportedReport = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(unexported.code, 2, unexported.stderr);
    assertEquals(
      unexportedReport.issues
        .filter((entry: Record<string, unknown>) =>
          entry.specifier === "fixture/private"
        )
        .every((entry: Record<string, unknown>) =>
          entry.code === "unexported-self-reference" &&
          entry.terminal === "fixture/private"
        ),
      true,
      JSON.stringify(unexportedReport.issues, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit audits every ordered runtime export-array alternative in its target", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["./head"] = {
      browser: ["./src/z-first.ts", "./src/a-later.ts"],
      default: "./src/z-first.ts",
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/z-first.ts");
    await writeSource(root, "src/a-later.ts", 'import "node:fs";\n');

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.contextId === "browser-runtime" &&
        entry.path === "src/a-later.ts" && entry.specifier === "node:fs"
      ),
      true,
      JSON.stringify(report.issues, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit deduplicates complete issue identities after collection", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.compilerOptions = {
      types: ["npm:duplicate-types@1", "npm:duplicate-types@1"],
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(
      report.issues.length,
      5,
      JSON.stringify(report.issues, null, 2),
    );
    assertEquals(
      new Set(report.issues.map((entry: unknown) => JSON.stringify(entry)))
        .size,
      report.issues.length,
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

Deno.test("strict audit keeps logical decorated nodes distinct while parsing one physical source", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["#value"] = "./src/plain.ts";
    config.scopes = {
      "./src/shared.ts?flavor=decorated": {
        "#value": "npm:decorated-scope@1",
      },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      'import "./shared.ts";\nimport "./shared.ts?flavor=decorated";\n',
    );
    await writeSource(root, "src/shared.ts", 'import "#value";\n');
    await writeSource(root, "src/plain.ts");

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      result.code,
      2,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
    assertEquals(report.evidenceComplete, true);
    assertEquals(
      report.issues.filter((entry: Record<string, unknown>) =>
        entry.path === "src/shared.ts" && entry.specifier === "#value" &&
        entry.resolved === "npm:decorated-scope@1"
      ).map((entry: Record<string, unknown>) => entry.contextId),
      ["root-deno", "root-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit resolves production entrypoint requests through one import-map hop", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.imports["./src/index.ts"] = "./src/mapped-entry.ts";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/index.ts");
    await writeSource(
      root,
      "src/mapped-entry.ts",
      'import "npm:mapped-entry@1";\n',
    );

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 2, result.stderr);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/mapped-entry.ts" &&
        entry.specifier === "npm:mapped-entry@1" &&
        entry.contextId === "root-deno"
      ),
      true,
      JSON.stringify(report, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit preserves decorated manifest identity for scope matching", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["."] = "./src/index.ts?entry#root";
    config.imports["#entry"] = "./src/plain.ts";
    config.scopes = {
      "./src/index.ts?entry#root": { "#entry": "npm:decorated-entry@1" },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(root, "src/index.ts", 'import "#entry";\n');
    await writeSource(root, "src/plain.ts");

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      result.code,
      2,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.path === "src/index.ts" && entry.specifier === "#entry" &&
        entry.resolved === "npm:decorated-entry@1"
      ),
      true,
      JSON.stringify(report, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit separates decorated manifest self identities from physical paths", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    config.exports["./decorated"] = "./src/shared.ts?mode=1#self";
    config.imports["#value"] = "./src/plain.ts";
    config.scopes = {
      "./src/shared.ts?mode=1#self": {
        "#value": "./src/scoped.ts",
      },
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await writeSource(
      root,
      "src/index.ts",
      'import "fixture/decorated";\n',
    );
    await writeSource(root, "src/shared.ts", 'import "#value";\n');
    await writeSource(root, "src/plain.ts");
    await writeSource(
      root,
      "src/scoped.ts",
      "import \"data:text/javascript,export default 'decorated-self'\";\n",
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

    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(
      result.code,
      2,
      `${result.stderr}\n${JSON.stringify(report, null, 2)}`,
    );
    assertEquals(report.evidenceComplete, true);
    assertEquals(report.operationalErrors, []);
    assertEquals(
      report.issues.some((entry: Record<string, unknown>) =>
        entry.specifier === "fixture/decorated" &&
        entry.code === "unresolvable-core-source"
      ),
      false,
      JSON.stringify(report.issues, null, 2),
    );
    assertEquals(
      report.issues.filter((entry: Record<string, unknown>) =>
        entry.path === "src/scoped.ts" &&
        entry.specifier ===
          "data:text/javascript,export default 'decorated-self'"
      ).map((entry: Record<string, unknown>) => entry.contextId),
      ["root-deno", "root-node"],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit strips decorations only for external import-map reads", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    delete config.imports;
    config.importMap = "./maps/import-map.json?revision=1#map";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await Deno.mkdir(`${root}/maps`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/maps/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 0, `${result.stderr}\n${JSON.stringify(report)}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("strict audit rejects non-local file authorities at source, types, and importMap boundaries", async (context) => {
  for (const kind of ["source", "types", "importMap"] as const) {
    await context.step(kind, async () => {
      const root = await auditFixture();
      const outputPath = `${root}/audit.json`;
      try {
        const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
        if (kind === "source") {
          await writeSource(
            root,
            "src/index.ts",
            'import "file://example.test/src/evil.ts";\n',
          );
        } else if (kind === "types") {
          config.compilerOptions = {
            types: ["file://example.test/src/evil.ts"],
          };
        } else {
          delete config.imports;
          config.importMap = "file://example.test/import-map.json";
        }
        await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
        const result = await runAudit([
          "--root",
          root,
          "--output",
          outputPath,
        ]);
        const report = JSON.parse(await Deno.readTextFile(outputPath));
        if (kind === "importMap") {
          assertEquals(result.code, 3, result.stderr);
          assertEquals(report.evidenceComplete, false);
        } else {
          assertEquals(result.code, 2, result.stderr);
          assertEquals(
            report.issues.some((entry: Record<string, unknown>) =>
              entry.specifier === "file://example.test/src/evil.ts" &&
              entry.code === "source-target-escapes-core"
            ),
            true,
          );
        }
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
});

Deno.test("strict audit rejects escaped-equivalent duplicate external import-map keys", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
    delete config.imports;
    config.importMap = "./import-map.json";
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(config));
    await Deno.writeTextFile(
      `${root}/import-map.json`,
      '{"imports":{"#value":"./src/index.ts","\\u0023value":"./src/index.ts"}}',
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(result.code, 3, result.stderr);
    assertEquals(report.evidenceComplete, false);
    assertEquals(
      report.operationalErrors.some((entry: Record<string, unknown>) =>
        entry.code === "malformed-import-map" &&
        String(entry.message).includes("duplicate external import-map key")
      ),
      true,
      JSON.stringify(report, null, 2),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
