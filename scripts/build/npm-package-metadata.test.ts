import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  BROWSER_SAFE_CLIENT_MODULES,
  BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";
import {
  EXTENSION_OWNED_DEPENDENCIES,
  normalizeNpmPackageMetadata,
  removeInternalNpmEntryPointExports,
  ROOT_OPTIONAL_RUNTIME_PEERS,
} from "./npm-package-metadata.ts";
import {
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
  type RootPackageConfig,
} from "./npm-extension-package-metadata.ts";

Deno.test("exports agent skill helpers as a public package subpath", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  assertEquals(exports["./skill"], "./src/skill/index.ts");
  assertEquals(imports["veryfront/skill"], "./src/skill/index.ts");
});

Deno.test("npm package provenance metadata points at veryfront-code", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

  assertStringIncludes(
    source,
    'url: "git+https://github.com/veryfront/veryfront-code.git"',
  );
  assertStringIncludes(
    source,
    'url: "https://github.com/veryfront/veryfront-code/issues"',
  );
  assertEquals(source.includes("github.com/veryfront/veryfront.git"), false);
});

Deno.test("removes build-only entry points from the published npm exports", () => {
  const pkg = {
    exports: {
      ".": { import: "./esm/src/index.js" },
      "./index.client": { import: "./esm/src/index.client.js" },
    } as Record<string, { import: string }>,
  };

  removeInternalNpmEntryPointExports(pkg, ["./index.client"]);

  assertEquals(pkg.exports, {
    ".": { import: "./esm/src/index.js" },
  });
});

Deno.test("fails closed when generated npm exports cannot prove an internal entry", () => {
  assertThrows(
    () => removeInternalNpmEntryPointExports({}, ["./index.client"]),
    Error,
    "missing its exports map",
  );
  assertThrows(
    () =>
      removeInternalNpmEntryPointExports(
        { exports: { ".": { import: "./esm/src/index.js" } } },
        ["./index.client"],
      ),
    Error,
    "missing internal entry point ./index.client",
  );
});

Deno.test("root npm build metadata does not inject extension implementation dependencies", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

  for (const packageName of ["@kreuzberg/node", "better-sqlite3"]) {
    assertEquals(
      source.includes(`"${packageName}"`),
      false,
      `${packageName} belongs to a @veryfront/ext-* package, not root veryfront`,
    );
  }
});

Deno.test("root npm CLI package declares auto-loaded first-party extensions after local install", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");
  const installIndex = source.indexOf(
    "const { code } = await npmInstall.output();",
  );
  for (
    const packageName of [
      "@veryfront/ext-bundler-esbuild",
      "@veryfront/ext-content-mdx",
      "@veryfront/ext-css-tailwind",
      "@veryfront/ext-parser-babel",
    ]
  ) {
    const dependencyAssignment =
      `pkg.dependencies["${packageName}"] = version;`;
    const dependencyIndex = source.indexOf(dependencyAssignment);

    assertStringIncludes(source, dependencyAssignment);
    assertEquals(
      dependencyIndex > installIndex,
      true,
      `${packageName} dependency must be added after build-local npm install so prerelease builds do not require the extension to already be published`,
    );
  }
});

Deno.test("npm publish version bump pins first-party extension dependencies to the publish version", async () => {
  const packageDir = await Deno.makeTempDir();
  const packagePath = `${packageDir}/package.json`;
  const publishVersion = "0.1.1016-rc.123";

  try {
    await Deno.writeTextFile(
      packagePath,
      JSON.stringify(
        {
          name: "veryfront",
          version: "0.1.1016",
          dependencies: {
            veryfront: "^0.1.1016",
            "@veryfront/ext-bundler-esbuild": "0.1.1016",
            "@veryfront/ext-content-mdx": "^0.1.1016",
            "@veryfront/ext-css-tailwind": "^0.1.1016",
            "@veryfront/ext-parser-babel": "^0.1.1016",
            "@veryfront/not-an-extension": "^0.1.1016",
            zod: "4.3.6",
          },
          peerDependencies: {
            veryfront: "^0.1.1016",
          },
        },
        null,
        2,
      ),
    );

    const output = await new Deno.Command("bash", {
      args: [
        "-c",
        [
          "set -euo pipefail",
          'source "$SCRIPT_PATH"',
          'VERSION="$PUBLISH_VERSION" update_package_version "$PACKAGE_DIR"',
        ].join("\n"),
      ],
      env: {
        PACKAGE_DIR: packageDir,
        PUBLISH_VERSION: publishVersion,
        SCRIPT_PATH: `${Deno.cwd()}/scripts/ci/publish-npm-packages.sh`,
      },
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));

    const pkg = JSON.parse(await Deno.readTextFile(packagePath));
    assertEquals(pkg.version, publishVersion);
    assertEquals(pkg.dependencies, {
      veryfront: `^${publishVersion}`,
      "@veryfront/ext-bundler-esbuild": publishVersion,
      "@veryfront/ext-content-mdx": publishVersion,
      "@veryfront/ext-css-tailwind": publishVersion,
      "@veryfront/ext-parser-babel": publishVersion,
      "@veryfront/not-an-extension": "^0.1.1016",
      zod: "4.3.6",
    });
    assertEquals(pkg.peerDependencies, {
      veryfront: `^${publishVersion}`,
    });
  } finally {
    await Deno.remove(packageDir, { recursive: true });
  }
});

Deno.test("npm publish orders extensions before the root package", async () => {
  const packageRoot = await Deno.makeTempDir();

  try {
    await Deno.mkdir(`${packageRoot}/npm/extensions/ext-zeta`, {
      recursive: true,
    });
    await Deno.mkdir(`${packageRoot}/npm/extensions/ext-alpha`, {
      recursive: true,
    });

    const output = await new Deno.Command("bash", {
      args: ["-c", 'source "$SCRIPT_PATH"\npackage_dirs'],
      cwd: packageRoot,
      env: {
        SCRIPT_PATH: `${Deno.cwd()}/scripts/ci/publish-npm-packages.sh`,
      },
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim().split("\n"),
      [
        "npm/extensions/ext-alpha",
        "npm/extensions/ext-zeta",
        "npm",
      ],
    );
  } finally {
    await Deno.remove(packageRoot, { recursive: true });
  }
});

Deno.test("npm publish skips extension packages marked publish false", async () => {
  const packageRoot = await Deno.makeTempDir();

  try {
    await Deno.mkdir(`${packageRoot}/extensions/ext-alpha`, {
      recursive: true,
    });
    await Deno.mkdir(`${packageRoot}/extensions/ext-private`, {
      recursive: true,
    });
    await Deno.mkdir(`${packageRoot}/npm/extensions/ext-alpha`, {
      recursive: true,
    });
    await Deno.mkdir(`${packageRoot}/npm/extensions/ext-private`, {
      recursive: true,
    });

    await Deno.writeTextFile(
      `${packageRoot}/deno.json`,
      JSON.stringify({
        workspace: [
          "./extensions/ext-alpha",
          "./extensions/ext-private",
        ],
      }),
    );
    await Deno.writeTextFile(
      `${packageRoot}/extensions/ext-alpha/deno.json`,
      JSON.stringify({
        name: "@veryfront/ext-alpha",
        veryfront: { extension: true },
      }),
    );
    await Deno.writeTextFile(
      `${packageRoot}/extensions/ext-private/deno.json`,
      JSON.stringify({
        name: "@veryfront/ext-private",
        veryfront: { extension: true, npm: { publish: false } },
      }),
    );
    await Deno.writeTextFile(
      `${packageRoot}/npm/extensions/ext-alpha/package.json`,
      JSON.stringify({
        name: "@veryfront/ext-alpha",
        veryfront: { extension: true },
      }),
    );
    await Deno.writeTextFile(
      `${packageRoot}/npm/extensions/ext-private/package.json`,
      JSON.stringify({
        name: "@veryfront/ext-private",
        veryfront: { extension: true, npm: { publish: false } },
      }),
    );

    const output = await new Deno.Command("bash", {
      args: [
        "-c",
        'source "$SCRIPT_PATH"\npackage_names_from_workspace\npackage_dirs',
      ],
      cwd: packageRoot,
      env: {
        SCRIPT_PATH: `${Deno.cwd()}/scripts/ci/publish-npm-packages.sh`,
      },
      stderr: "piped",
      stdout: "piped",
    }).output();

    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(
      new TextDecoder().decode(output.stdout).trim().split("\n"),
      [
        "veryfront",
        "@veryfront/ext-alpha",
        "npm/extensions/ext-alpha",
        "npm",
      ],
    );
    assertStringIncludes(
      new TextDecoder().decode(output.stderr),
      "@veryfront/ext-private is marked veryfront.npm.publish=false",
    );
  } finally {
    await Deno.remove(packageRoot, { recursive: true });
  }
});

// Extensions whose implementations are statically imported by
// src/extensions/builtin-extensions.ts and therefore ship inside the root
// npm package. Their dependencies must stay in root; every other workspace
// extension's dependencies must be stripped via EXTENSION_OWNED_DEPENDENCIES.
const ROOT_BUNDLED_EXTENSIONS = new Set([
  "ext-schema-zod",
  "ext-llm-openai",
  "ext-llm-anthropic",
  "ext-llm-google",
  "ext-eval-report-mlflow",
]);

Deno.test("EXTENSION_OWNED_DEPENDENCIES stays in sync with extension manifests", async () => {
  const denoConfig = JSON.parse(
    await Deno.readTextFile("deno.json"),
  ) as RootPackageConfig;
  const owned = new Set<string>(EXTENSION_OWNED_DEPENDENCIES);
  const optionalPeers = new Set<string>(ROOT_OPTIONAL_RUNTIME_PEERS);

  const manifestPaths = firstPartyExtensionManifestPaths(denoConfig);
  assertEquals(
    manifestPaths.length > 0,
    true,
    "expected workspace extension manifests",
  );

  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(
      await Deno.readTextFile(manifestPath),
    ) as ExtensionManifest;
    const extensionDirectory = manifestPath.split("/")[1];
    const dependencies = Object.keys(manifestDependencies(manifest));

    if (ROOT_BUNDLED_EXTENSIONS.has(extensionDirectory)) {
      for (const dependency of dependencies) {
        assertEquals(
          owned.has(dependency),
          false,
          `${dependency} is required by root-bundled ${extensionDirectory} and must not be stripped from the root veryfront package`,
        );
      }
      continue;
    }

    for (const dependency of dependencies) {
      assertEquals(
        owned.has(dependency) || optionalPeers.has(dependency),
        true,
        `${dependency} (declared by ${manifestPath}) must be added to EXTENSION_OWNED_DEPENDENCIES so it does not leak into root veryfront npm installs`,
      );
    }
  }
});

describe("normalizeNpmPackageMetadata", () => {
  it("removes source files from the published npm file list", () => {
    const pkg = normalizeNpmPackageMetadata({
      files: ["esm", "script", "src", "bin", "README.md"],
    });

    assertEquals(pkg.files, ["esm", "script", "bin", "README.md"]);
  });

  it("keeps opt-in feature packages out of automatic npm installs", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        "@kreuzberg/node": "^4.4.2",
        "@kreuzberg/wasm": "4.5.2",
        "@opentelemetry/api": "1.9.1",
        "@opentelemetry/exporter-metrics-otlp-http": "0.219.0",
        "@opentelemetry/sdk-metrics": "2.8.0",
        "@opentelemetry/sdk-node": "0.218.0",
        "zod": "4.3.6",
      },
      optionalDependencies: {
        "@huggingface/transformers": "^4.2.0",
      },
    });

    assertEquals(pkg.dependencies, { zod: "4.3.6" });
    assertEquals(pkg.optionalDependencies, undefined);
    assertEquals(pkg.peerDependencies, {
      "@huggingface/transformers": "^4.2.0",
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@huggingface/transformers": { optional: true },
    });
  });

  it("keeps sandbox shell extension packages out of automatic npm installs", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        "bash-tool": "1.3.16",
        "just-bash": "2.14.5",
        zod: "4.3.6",
      },
    });

    assertEquals(pkg.dependencies, { zod: "4.3.6" });
    assertEquals(pkg.optionalDependencies, undefined);
    assertEquals(pkg.peerDependencies, {
      "@huggingface/transformers": "^4.2.0",
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@huggingface/transformers": { optional: true },
    });
  });

  it("declares opaque optional runtime peers even when dnt cannot trace them", () => {
    // The @huggingface/transformers import is opaque (invisible to dnt), so the
    // generated package.json never contains it; the optional peer must still be
    // declared or npm consumers get no installable remedy for local AI models.
    const pkg = normalizeNpmPackageMetadata({
      dependencies: { zod: "4.3.6" },
    });

    assertEquals(pkg.peerDependencies?.["@huggingface/transformers"], "^4.2.0");
    assertEquals(pkg.peerDependenciesMeta?.["@huggingface/transformers"], {
      optional: true,
    });
  });

  it("keeps first-party extension implementation packages out of root npm metadata", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        "@babel/parser": "^7.29.2",
        "@mdx-js/mdx": "^3.1.1",
        "@types/hast": "^3.0.3",
        esbuild: "^0.28.1",
        jose: "^5.9.6",
        redis: "^5.11.0",
        tailwindcss: "^4.2.2",
        unified: "^11.0.5",
        zod: "4.3.6",
      },
    });

    assertEquals(pkg.dependencies, { zod: "4.3.6" });
    assertEquals(pkg.peerDependencies, {
      "@huggingface/transformers": "^4.2.0",
      redis: "^5.11.0",
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@huggingface/transformers": { optional: true },
      redis: { optional: true },
    });
  });

  it("removes stale direct AI SDK metadata from automatic npm installs", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        ai: "^6.0.0",
        zod: "4.3.6",
      },
    });

    assertEquals(pkg.dependencies, { zod: "4.3.6" });
    assertEquals(pkg.peerDependencies, {
      "@huggingface/transformers": "^4.2.0",
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@huggingface/transformers": { optional: true },
    });
  });

  it("removes stale npm-only type dev dependencies", () => {
    const pkg = normalizeNpmPackageMetadata({
      devDependencies: {
        "@types/better-sqlite3": "^7.6.0",
        "@types/mime-types": "^2.1.0",
        "@types/ws": "^8.5.0",
        "@types/node": "^20.9.0",
      },
    });

    assertEquals(pkg.devDependencies, { "@types/node": "20.9.0" });
  });

  it("pins automatic npm dependency ranges while preserving peer compatibility ranges", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        "@types/react": "^19.2.14",
        "@deno/shim-deno": "~0.18.0",
        zod: "4.3.6",
      },
      optionalDependencies: {
        "just-bash": "^2.14.5",
      },
      devDependencies: {
        "@types/node": "^20.9.0",
      },
      peerDependencies: {
        react: "^19.0.0",
      },
    });

    assertEquals(pkg.dependencies, {
      "@types/react": "19.2.14",
      "@deno/shim-deno": "0.18.0",
      zod: "4.3.6",
    });
    assertEquals(pkg.optionalDependencies, undefined);
    assertEquals(pkg.devDependencies, {
      "@types/node": "20.9.0",
    });
    assertEquals(pkg.peerDependencies, {
      "@huggingface/transformers": "^4.2.0",
      react: "^19.0.0",
    });
    assertEquals(pkg.overrides, {
      protobufjs: "8.6.5",
    });
  });
});

describe("npm supply-chain policy", () => {
  it("exports Studio AG-UI package entrypoints", async () => {
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const exports = denoConfig.exports as Record<string, string>;

    assertEquals(exports["./chat/ag-ui"], "./src/chat/ag-ui.ts");
    assertEquals(exports["./chat/protocol"], "./src/chat/protocol.ts");
  });

  it("exports agent-service evals without legacy agent testing", async () => {
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const exports = denoConfig.exports as Record<string, string>;
    const imports = denoConfig.imports as Record<string, string>;

    assertEquals(
      exports["./eval/agent-service"],
      "./src/eval/agent-service.ts",
    );
    assertEquals(
      imports["veryfront/eval/agent-service"],
      "./src/eval/agent-service.ts",
    );
    assertEquals(exports["./agent/testing"], undefined);
    assertEquals(imports["veryfront/agent/testing"], undefined);
  });

  it("keeps browser-safe export patches aligned to public exports", async () => {
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const exports = denoConfig.exports as Record<string, string>;

    for (const exportPath of BROWSER_SAFE_EXPORTS) {
      assertEquals(
        typeof exports[exportPath],
        "string",
        `${exportPath} must exist in deno.json exports before the npm build patches it`,
      );
    }
  });

  it("lazy-loads auto-enabled sandbox shell dependencies for npm CLI startup", async () => {
    const source = await Deno.readTextFile(
      "extensions/ext-sandbox-shell-tools/src/index.ts",
    );

    assertEquals(source.includes('import("bash-tool")'), true);
    assertEquals(source.includes('from "bash-tool"'), false);
  });

  it("keeps CLI startup off first-party extension package imports", async () => {
    const source = await Deno.readTextFile("cli/main.ts");

    assertEquals(source.includes("@veryfront/ext-"), false);
    assertEquals(source.includes("importFirstPartyExtensionModule"), false);
  });

  it("packs and exercises auto-loaded extensions in npm install smoke tests", async () => {
    const source = await Deno.readTextFile("scripts/test/npm-install-smoke.sh");
    const autoLoadedExtensions = [
      "ext-bundler-esbuild",
      "ext-content-mdx",
      "ext-css-tailwind",
      "ext-parser-babel",
    ];

    for (const extensionName of autoLoadedExtensions) {
      const tarballName = `veryfront-${extensionName}-*.tgz`;

      assertStringIncludes(
        source,
        `npm/extensions/${extensionName}`,
      );
      assertStringIncludes(
        source,
        tarballName,
      );
    }

    assertStringIncludes(source, "CodeParser was not registered");
    assertStringIncludes(source, "app/page.tsx");
  });

  it("loads CLI command handlers after global routing decisions", async () => {
    const source = await Deno.readTextFile("cli/router.ts");

    assertEquals(/import\s+\{[^}]*handle[A-Za-z]+Command/.test(source), false);
    assertStringIncludes(source, 'await import("./commands/build/handler.ts")');
    assertEquals(
      source.indexOf("if (args.version || args.v)") <
        source.indexOf("await ensureCliSchemaValidator()"),
      true,
    );
  });

  it("keeps root runtime entrypoints off optional extension source imports", async () => {
    const runtimeFiles = [
      "cli/main.ts",
      "cli/shared/default-contracts.ts",
      "cli/shared/ensure-content-processor.ts",
      "cli/commands/knowledge/parser.ts",
      "src/agent/hosted/veryfront-cloud-agent-service.ts",
      "src/agent/service/auth.ts",
      "src/html/styles-builder/tailwind-compiler-cache.ts",
      "src/internal-agents/run-stream.ts",
      "src/proxy/main.ts",
      "src/testing/init.ts",
    ];
    const optionalExtensions = [
      "ext-auth-jwt",
      "ext-bundler-esbuild",
      "ext-content-mdx",
      "ext-css-tailwind",
      "ext-db-sqlite",
      "ext-document-kreuzberg",
      "ext-eval-report-mlflow",
      "ext-observability-opentelemetry",
      "ext-parser-babel",
      "ext-sandbox-shell-tools",
    ];

    for (const file of runtimeFiles) {
      const source = await Deno.readTextFile(file);
      for (const extensionName of optionalExtensions) {
        assertEquals(
          source.includes(`extensions/${extensionName}/src/`),
          false,
          `${file} must load ${extensionName} through @veryfront/${extensionName}`,
        );
      }
    }
  });

  it("lazy-loads OpenTelemetry dependencies for npm CLI startup", async () => {
    const source = await Deno.readTextFile(
      "extensions/ext-observability-opentelemetry/src/index.ts",
    );
    const optionalOpenTelemetryPackages = [
      "@opentelemetry/api",
      "@opentelemetry/auto-instrumentations-node",
      "@opentelemetry/context-async-hooks",
      "@opentelemetry/core",
      "@opentelemetry/exporter-metrics-otlp-http",
      "@opentelemetry/exporter-trace-otlp-http",
      "@opentelemetry/resources",
      "@opentelemetry/sdk-metrics",
      "@opentelemetry/sdk-node",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/semantic-conventions",
    ];

    for (const packageName of optionalOpenTelemetryPackages) {
      assertEquals(
        source.includes(`import("${packageName}")`),
        true,
        `${packageName} must be loaded only when OpenTelemetry is enabled`,
      );
      assertEquals(
        source.includes(`from "${packageName}"`),
        false,
        `${packageName} must not be a value import at CLI startup`,
      );
    }
  });

  it("keeps workflow React hooks off the broad errors barrel", async () => {
    const hookSources = [
      "src/workflow/react/use-approval.ts",
      "src/workflow/react/use-workflow.ts",
      "src/workflow/react/use-workflow-list.ts",
      "src/workflow/react/use-workflow-start.ts",
    ];

    for (const path of hookSources) {
      const source = await Deno.readTextFile(path);
      assertEquals(
        source.includes('from "#veryfront/errors"'),
        false,
        `${path} must not import the browser-unsafe errors barrel`,
      );
      assertStringIncludes(source, "#veryfront/errors/error-registry.ts");
    }
  });

  it("keeps workflow React hooks in the browser-safe npm patch set", () => {
    assertEquals(BROWSER_SAFE_EXPORTS.includes("./workflow"), false);
    assertEquals(
      BROWSER_SAFE_CLIENT_MODULES.includes("src/workflow/react/index.js"),
      true,
    );
    assertEquals(
      BROWSER_SAFE_CLIENT_MODULES.includes(
        "src/workflow/react/use-workflow-start.js",
      ),
      true,
    );
  });

  it("normalizes dnt interval shims for browser-safe client modules", async () => {
    const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

    assertStringIncludes(
      source,
      'replaceAll("dntShim.setInterval", "globalThis.setInterval")',
    );
    assertStringIncludes(
      source,
      'replaceAll("dntShim.clearInterval", "globalThis.clearInterval")',
    );
  });

  it("uses native Node timers so root imports can release background intervals", async () => {
    const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

    assertStringIncludes(source, "timers: false");
    assertEquals(source.includes("timers: true"), false);
    assertStringIncludes(source, 'VF_DISABLE_LRU_INTERVAL: "0"');
    assertStringIncludes(source, "await verifyNpmRootImportLifecycle();");
  });

  it("keeps npm CLI agent workflow paths off the DNT Deno shim in real Deno", async () => {
    const generatedFiles = [
      "npm/esm/cli/commands/mcp/handler.js",
      "npm/esm/cli/commands/lint/handler.js",
      "npm/esm/cli/commands/test/handler.js",
      "npm/esm/cli/commands/serve/split-mode.js",
      "npm/esm/cli/shared/animation.js",
      "npm/esm/cli/utils/write-run-result.js",
      "npm/esm/src/platform/compat/stdin.js",
      "npm/esm/src/platform/compat/process/lifecycle.js",
    ];

    for (const path of generatedFiles) {
      const source = await Deno.readTextFile(path);
      assertEquals(
        source.includes("dntShim.Deno.addSignalListener"),
        false,
        `${path} must use real globalThis.Deno for signal handlers`,
      );
      assertEquals(
        source.includes("dntShim.Deno.stdin"),
        false,
        `${path} must use real globalThis.Deno for stdin`,
      );
      assertEquals(
        source.includes("dntShim.Deno.stdout"),
        false,
        `${path} must use real globalThis.Deno for stdout`,
      );
      assertEquals(
        source.includes("dntShim.Deno.Command"),
        false,
        `${path} must use real globalThis.Deno or platform runCommand for subprocesses`,
      );
      assertEquals(
        source.includes("dntShim.Deno.env"),
        false,
        `${path} must use platform env helpers`,
      );
      assertEquals(
        source.includes("dntShim.Deno.connect"),
        false,
        `${path} must use real globalThis.Deno for TCP readiness checks`,
      );
    }
  });
});

describe("npm generated integration artifacts", () => {
  it("builds npm from regenerated integration metadata", async () => {
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
    const buildNpmTask = denoConfig.tasks?.["build:npm"];

    assertEquals(typeof buildNpmTask, "string");
    assertEquals(
      buildNpmTask.indexOf("scripts/build/generate-integrations-module.ts") <
        buildNpmTask.indexOf("scripts/build/build-npm-dnt.ts"),
      true,
    );
  });

  it("ships the client root barrel without publishing an import subpath", async () => {
    const pkg = JSON.parse(await Deno.readTextFile("npm/package.json"));
    assertEquals(pkg.exports["./index.client"], undefined);

    for (const path of [
      "npm/esm/src/index.client.js",
      "npm/esm/src/index.client.d.ts",
    ]) {
      const source = await Deno.readTextFile(path);
      assertEquals(source.includes("_dnt.polyfills"), false);
      assertEquals(source.includes("_dnt.shims"), false);
    }
  });

  it("keeps the active Jira JQL search endpoint in the npm source artifact", async () => {
    const source = await Deno.readTextFile("src/integrations/_data.ts");
    const urls = [...source.matchAll(/"url":\s*"([^"]+)"/g)].map((match) =>
      match[1]
    );

    assertEquals(
      urls.includes(
        "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search/jql",
      ),
      true,
    );
    assertStringIncludes(source, '"nextPageToken"');
    assertEquals(
      urls.includes(
        "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search",
      ),
      false,
    );
  });

  it("publishes README banner assets and NOTICE with the npm package", async () => {
    const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

    assertStringIncludes(
      source,
      'await Deno.copyFile("./assets/banner.svg", "./npm/assets/banner.svg");',
    );
    assertStringIncludes(
      source,
      'await Deno.copyFile("./NOTICE", "./npm/NOTICE");',
    );
    assertStringIncludes(
      source,
      'pkg.files = ["esm", "script", "bin", "assets", "tsconfig.json", "LICENSE", "NOTICE", "README.md"];',
    );
  });
});
