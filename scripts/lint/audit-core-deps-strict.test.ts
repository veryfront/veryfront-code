import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#std/assert";
import { toFileUrl } from "#std/path";
import { CORE_RUNTIME_ENTRYPOINTS } from "./core-production-roots.ts";
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

Deno.test("strict audit treats binding convergence exhaustion as operational exit 3", async () => {
  const root = await auditFixture();
  const outputPath = `${root}/audit.json`;
  try {
    await writeSource(
      root,
      "src/index.ts",
      "let load = require;\nload = Worker;\n",
    );
    const result = await runAudit(["--root", root, "--output", outputPath]);
    assertEquals(result.code, 3, result.stderr);
    const report = JSON.parse(await Deno.readTextFile(outputPath));
    assertEquals(report.evidenceComplete, false);
    assertEquals(report.issues, []);
    assertEquals(
      report.operationalErrors.some((error: Record<string, unknown>) =>
        error.code === "binding-resolution-failure" &&
        error.path === "src/index.ts" &&
        String(error.message).includes(
          "loader provenance binding analysis did not converge",
        )
      ),
      true,
      JSON.stringify(report.operationalErrors, null, 2),
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
