import { join, toFileUrl } from "#std/path";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runBoundedCommand } from "./bounded-command.ts";
import { buildExtensionPackages } from "./build-npm-extension-packages.ts";
import type {
  ExtensionManifest,
  RootPackageConfig,
} from "./npm-extension-package-metadata.ts";

// Run this smoke with --no-lock: it builds packed extension tarballs and installs
// isolated generated consumers whose dependency graph must be validated
// independently of the repository lockfile.
const LEGACY_PACKAGE = "@veryfront/ext-observability-sentry";
const NODE_PACKAGE = "@veryfront/ext-observability-sentry-node";
const DENO_PACKAGE = "@veryfront/ext-observability-sentry-deno";

// Every subprocess below gets its own deadline. A registry call that hangs must
// fail fast naming itself rather than silently eating the CI job budget: the
// npm steps here normally finish in a few seconds, and the node/deno import
// checks in under a second, so these bounds are orders of magnitude of headroom.
const NPM_COMMAND_TIMEOUT_MS = 240_000;
const RUNTIME_EVAL_TIMEOUT_MS = 120_000;

describe("Sentry runtime package generation", () => {
  it("resolves only matching SDKs and keeps runtime leaves undiscoverable", async () => {
    const rootDir = Deno.cwd();
    const outputRoot = await Deno.makeTempDir();
    const packageRoot = join(outputRoot, "extensions");

    try {
      const rootConfig: RootPackageConfig = {
        workspace: ["./extensions/ext-observability-sentry"],
        exports: {
          "./extensions": "./src/extensions/index.ts",
        },
      };
      const manifest = JSON.parse(
        await Deno.readTextFile("extensions/ext-observability-sentry/deno.json"),
      ) as ExtensionManifest;
      assertEquals(manifest.name, LEGACY_PACKAGE);

      await buildExtensionPackages({
        rootDir,
        outDir: packageRoot,
        rootConfig,
        version: "0.1.985",
        license: "Apache-2.0",
      });

      await assertPackageGraph({
        packageRoot,
        packageDirectory: "ext-observability-sentry",
        packageName: LEGACY_PACKAGE,
        expectedDependencies: {
          "@sentry/deno": "10.68.0",
          "@sentry/node": "10.68.0",
        },
        expectedPeerDependencies: {
          veryfront: "^0.1.985",
        },
        expectedVeryfrontExtension: true,
      });
      await assertPackageGraph({
        packageRoot,
        packageDirectory: "ext-observability-sentry-node",
        packageName: NODE_PACKAGE,
        expectedDependencies: {
          "@sentry/node": "10.68.0",
        },
        forbiddenPackages: ["@sentry/deno", "veryfront"],
        expectedVeryfrontExtension: false,
      });
      await assertPackageGraph({
        packageRoot,
        packageDirectory: "ext-observability-sentry-deno",
        packageName: DENO_PACKAGE,
        expectedDependencies: {
          "@sentry/deno": "10.68.0",
        },
        forbiddenPackages: ["@sentry/node", "veryfront"],
        expectedVeryfrontExtension: false,
      });

      await assertGeneratedSourceDoesNotReference({
        packageRoot,
        packageDirectory: "ext-observability-sentry-node",
        forbiddenText: ["@sentry/deno"],
        forbiddenImportPackages: ["veryfront"],
      });
      await assertGeneratedSourceDoesNotReference({
        packageRoot,
        packageDirectory: "ext-observability-sentry-deno",
        forbiddenText: ["@sentry/node"],
        forbiddenImportPackages: ["veryfront"],
      });
      await assertPackageDeclarationsExportContract({
        packageRoot,
        packageDirectory: "ext-observability-sentry-node",
        expectedDeclaration: "ApplicationErrorContext",
      });
      await assertPackageDeclarationsExportContract({
        packageRoot,
        packageDirectory: "ext-observability-sentry-deno",
        expectedDeclaration: "ApplicationErrorContext",
      });

      await assertIsolatedNodeConsumer({
        packageDir: join(packageRoot, "ext-observability-sentry"),
        packageName: LEGACY_PACKAGE,
        expectedInstalled: ["@sentry/deno", "@sentry/node"],
        forbiddenInstalled: [],
        importStatement:
          `import { createNodeSentryApplicationErrorReporter } from "${LEGACY_PACKAGE}/node"; if (typeof createNodeSentryApplicationErrorReporter !== "function") throw new Error("missing legacy node reporter");`,
      });

      await assertIsolatedDenoConsumer({
        packageDir: join(packageRoot, "ext-observability-sentry"),
        packageName: LEGACY_PACKAGE,
        expectedInstalled: ["@sentry/deno", "@sentry/node"],
        forbiddenInstalled: [],
        importStatement:
          `import { createDenoSentryApplicationErrorReporter } from "${LEGACY_PACKAGE}/deno"; if (typeof createDenoSentryApplicationErrorReporter !== "function") throw new Error("missing legacy deno reporter");`,
      });

      await assertIsolatedNodeConsumer({
        packageDir: join(packageRoot, "ext-observability-sentry-node"),
        packageName: NODE_PACKAGE,
        expectedInstalled: ["@sentry/node"],
        forbiddenInstalled: ["@sentry/deno", "veryfront"],
        importStatement:
          `import { createNodeSentryApplicationErrorReporter } from "${NODE_PACKAGE}"; if (typeof createNodeSentryApplicationErrorReporter !== "function") throw new Error("missing node reporter");`,
      });

      await assertIsolatedDenoConsumer({
        packageDir: join(packageRoot, "ext-observability-sentry-deno"),
        packageName: DENO_PACKAGE,
        expectedInstalled: ["@sentry/deno"],
        forbiddenInstalled: ["@sentry/node", "veryfront"],
        importStatement:
          `import { createDenoSentryApplicationErrorReporter } from "${DENO_PACKAGE}"; if (typeof createDenoSentryApplicationErrorReporter !== "function") throw new Error("missing deno reporter");`,
      });
    } finally {
      await Deno.remove(outputRoot, { recursive: true });
    }
  });
});

async function assertPackageGraph(input: {
  packageRoot: string;
  packageDirectory: string;
  packageName: string;
  expectedDependencies: Record<string, string>;
  expectedPeerDependencies?: Record<string, string>;
  forbiddenPackages?: string[];
  expectedVeryfrontExtension: boolean;
}): Promise<void> {
  const packageJsonPath = join(
    input.packageRoot,
    input.packageDirectory,
    "package.json",
  );
  const pkg = JSON.parse(await Deno.readTextFile(packageJsonPath)) as {
    name: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    veryfront?: {
      extension?: boolean;
    };
  };

  assertEquals(pkg.name, input.packageName);
  assertEquals(pkg.dependencies ?? {}, input.expectedDependencies);
  assertEquals(
    pkg.peerDependencies ?? {},
    input.expectedPeerDependencies ?? {},
  );
  for (const packageName of input.forbiddenPackages ?? []) {
    assertEquals(packageName in (pkg.dependencies ?? {}), false);
    assertEquals(packageName in (pkg.peerDependencies ?? {}), false);
  }
  if (input.expectedVeryfrontExtension) {
    assertEquals(pkg.veryfront?.extension, true);
  } else {
    assertEquals("veryfront" in pkg, false);
  }
}

async function assertPackageDeclarationsExportContract(input: {
  packageRoot: string;
  packageDirectory: string;
  expectedDeclaration: string;
}): Promise<void> {
  const packageDir = join(input.packageRoot, input.packageDirectory);
  const pkg = JSON.parse(
    await Deno.readTextFile(join(packageDir, "package.json")),
  ) as {
    types?: string;
  };
  if (!pkg.types) {
    throw new Error(`${input.packageDirectory} must declare types`);
  }

  const declarations = await Deno.readTextFile(join(packageDir, pkg.types));
  assertStringIncludes(declarations, input.expectedDeclaration);
  assertStringIncludes(declarations, "./application-error-contract");
}

async function assertGeneratedSourceDoesNotReference(input: {
  packageRoot: string;
  packageDirectory: string;
  forbiddenText: string[];
  forbiddenImportPackages?: string[];
}): Promise<void> {
  const esmRoot = join(input.packageRoot, input.packageDirectory, "esm");
  for await (const filePath of walkFiles(esmRoot)) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".d.ts")) continue;
    const text = await Deno.readTextFile(filePath);
    for (const forbiddenText of input.forbiddenText) {
      assertEquals(
        text.includes(forbiddenText),
        false,
        `${filePath} must not reference ${forbiddenText}`,
      );
    }
    for (const packageName of input.forbiddenImportPackages ?? []) {
      assertEquals(
        generatedSourceImportsPackage(text, packageName),
        false,
        `${filePath} must not import ${packageName}`,
      );
    }
  }
}

function generatedSourceImportsPackage(
  source: string,
  packageName: string,
): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`(?:from\s+|import\s*\(\s*|import\s+)["']${escaped}(?:["'/]|$)`,
  ).test(source);
}

async function assertIsolatedNodeConsumer(input: {
  packageDir: string;
  packageName: string;
  expectedInstalled: string[];
  forbiddenInstalled: string[];
  importStatement: string;
}): Promise<void> {
  const consumerDir = await createConsumerPackage(
    input.packageName,
    input.packageDir,
  );
  try {
    await runCommand({
      command: "npm",
      args: ["install", "--ignore-scripts", "--legacy-peer-deps"],
      cwd: consumerDir,
      timeoutMs: NPM_COMMAND_TIMEOUT_MS,
    });
    await assertInstalledPackages(
      consumerDir,
      input.expectedInstalled,
      input.forbiddenInstalled,
    );
    await runCommand({
      command: "node",
      args: ["--input-type=module", "--eval", input.importStatement],
      cwd: consumerDir,
      timeoutMs: RUNTIME_EVAL_TIMEOUT_MS,
    });
  } finally {
    await Deno.remove(consumerDir, { recursive: true });
  }
}

async function assertIsolatedDenoConsumer(input: {
  packageDir: string;
  packageName: string;
  expectedInstalled: string[];
  forbiddenInstalled: string[];
  importStatement: string;
}): Promise<void> {
  const consumerDir = await createConsumerPackage(
    input.packageName,
    input.packageDir,
  );
  try {
    await Deno.writeTextFile(
      join(consumerDir, "deno.json"),
      JSON.stringify({ nodeModulesDir: "manual" }, null, 2),
    );
    await runCommand({
      command: "npm",
      args: ["install", "--ignore-scripts", "--legacy-peer-deps"],
      cwd: consumerDir,
      timeoutMs: NPM_COMMAND_TIMEOUT_MS,
    });
    await assertInstalledPackages(
      consumerDir,
      input.expectedInstalled,
      input.forbiddenInstalled,
    );
    await runCommand({
      command: "deno",
      args: ["eval", input.importStatement],
      cwd: consumerDir,
      env: { DENO_NO_PACKAGE_JSON: "0" },
      timeoutMs: RUNTIME_EVAL_TIMEOUT_MS,
    });
  } finally {
    await Deno.remove(consumerDir, { recursive: true });
  }
}

async function createConsumerPackage(
  packageName: string,
  packageDir: string,
): Promise<string> {
  const consumerDir = await Deno.makeTempDir();
  const packDir = join(consumerDir, "packs");
  await Deno.mkdir(packDir);
  const packOutput = await runBoundedCommand({
    command: "npm",
    args: ["pack", packageDir, "--pack-destination", packDir, "--json"],
    timeoutMs: NPM_COMMAND_TIMEOUT_MS,
  });
  if (packOutput.code !== 0) {
    throw new Error(
      `npm pack failed with ${packOutput.code}\n${packOutput.stdout}\n${packOutput.stderr}`,
    );
  }
  const packResult = JSON.parse(packOutput.stdout) as Array<{
    filename: string;
  }>;
  const tarball = packResult[0]?.filename;
  if (!tarball) throw new Error("npm pack did not return a tarball filename");

  await Deno.writeTextFile(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "sentry-runtime-consumer",
        type: "module",
        private: true,
        dependencies: {
          [packageName]: toFileUrl(join(packDir, tarball)).href,
        },
      },
      null,
      2,
    ),
  );
  return consumerDir;
}

async function assertInstalledPackages(
  consumerDir: string,
  expectedPackages: string[],
  forbiddenPackages: string[],
): Promise<void> {
  for (const packageName of expectedPackages) {
    assertEquals(
      await packageJsonExists(consumerDir, packageName),
      true,
      `${packageName} should be installed`,
    );
  }
  for (const packageName of forbiddenPackages) {
    assertEquals(
      await packageJsonExists(consumerDir, packageName),
      false,
      `${packageName} should not be installed`,
    );
  }
}

async function packageJsonExists(
  consumerDir: string,
  packageName: string,
): Promise<boolean> {
  try {
    await Deno.stat(
      join(consumerDir, "node_modules", packageName, "package.json"),
    );
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
}): Promise<void> {
  const output = await runBoundedCommand(input);
  if (output.code === 0) return;

  throw new Error(
    `${input.command} ${input.args.join(" ")} failed with ${output.code}\n${output.stdout}\n${output.stderr}`,
  );
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(root)) {
    const path = join(root, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(path);
      continue;
    }
    if (entry.isFile) yield path;
  }
}
