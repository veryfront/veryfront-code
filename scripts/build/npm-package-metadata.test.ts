import { STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES } from "#veryfront/extensions/first-party-defaults.ts";
import {
  assertEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BROWSER_SAFE_CLIENT_MODULES,
  BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";
import {
  EXTENSION_OWNED_DEPENDENCIES,
  normalizeNpmPackageMetadata,
  ROOT_OPTIONAL_RUNTIME_PEERS,
} from "./npm-package-metadata.ts";
import {
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
  type RootPackageConfig,
} from "./npm-extension-package-metadata.ts";

const repoRoot = new URL("../../", import.meta.url);

it("exports agent skill helpers as a public package subpath", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  assertEquals(exports["./skill"], "./src/skill/index.ts");
  assertEquals(imports["veryfront/skill"], "./src/skill/index.ts");
});

it("exports the UI adapter contract as a public package subpath", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;
  const contract = "./src/react/components/ui/adapter/contract.ts";

  assertEquals(exports["./ui/adapter"], contract);
  assertEquals(imports["veryfront/ui/adapter"], contract);
});

it("exports CLI framework dependencies as public package subpaths", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  for (
    const [subpath, source] of [
      ["utils/logger", "./src/utils/logger/index.ts"],
      ["release-assets", "./src/release-assets/index.ts"],
    ] as const
  ) {
    assertEquals(exports[`./${subpath}`], source);
    assertEquals(imports[`veryfront/${subpath}`], source);
  }
});

it("exports cross-runtime platform tooling as public package subpaths", async () => {
  const denoConfig = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", repoRoot)),
  );
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  for (
    const [subpath, source] of [
      ["platform", "./src/platform/index.ts"],
      ["platform/path", "./src/platform/compat/path/index.ts"],
    ] as const
  ) {
    assertEquals(exports[`./${subpath}`], source);
    assertEquals(imports[`veryfront/${subpath}`], source);
  }
});

it("keeps host environment controls outside public platform exports", async () => {
  const [denoConfig, tsconfig] = await Promise.all([
    Deno.readTextFile(new URL("deno.json", repoRoot)).then(JSON.parse),
    Deno.readTextFile(new URL("tsconfig.json", repoRoot)).then(JSON.parse),
  ]);
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;
  const paths = tsconfig.compilerOptions.paths as Record<string, string[]>;
  const publicEnvModule = "./src/platform/env.ts";

  assertEquals(exports["./platform/env"], publicEnvModule);
  assertEquals(imports["veryfront/platform/env"], publicEnvModule);
  assertEquals(paths["veryfront/platform/env"], [publicEnvModule]);

  const [platformBarrel, platformEnv] = await Promise.all([
    Deno.readTextFile(new URL("src/platform/index.ts", repoRoot)),
    import(new URL(publicEnvModule, repoRoot).href),
  ]);

  for (
    const internalExport of [
      "getEnvOverlayStorage",
      "getHostEnv",
      "getTrustedProjectEnvSnapshot",
      "registerTrustedProjectEnvSnapshot",
    ]
  ) {
    assertEquals(platformBarrel.includes(internalExport), false);
    assertEquals(internalExport in platformEnv, false);
  }
});

it("keeps process-wide Sentry controls internal", async () => {
  const denoConfig = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", repoRoot)),
  );
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  assertEquals(exports["./observability/sentry"], undefined);
  assertEquals(imports["veryfront/observability/sentry"], undefined);

  // The public observability barrel must not re-export the process-wide
  // reporter mutators either; they would let tenant code redirect framework
  // error payloads.
  const barrel = await Deno.readTextFile(
    new URL("src/observability/index.ts", repoRoot),
  );
  assertEquals(barrel.includes("initializeApplicationErrorReporter"), false);
  assertEquals(barrel.includes("setApplicationErrorReporter"), false);

  // The public agent barrel must not export the node runtime-infrastructure
  // factories: their initializeApplicationErrors() publishes a reporter
  // selected by caller-supplied env into the same process-wide singleton.
  // Type re-exports stay allowed; only the factory values are internal.
  const agentBarrel = await Deno.readTextFile(
    new URL("src/agent/index.ts", repoRoot),
  );
  assertEquals(
    agentBarrel.includes("createNodeAgentServiceRuntimeInfrastructure"),
    false,
  );
  assertEquals(
    agentBarrel.includes("createNodeHostedAgentServiceRuntimeInfrastructure"),
    false,
  );
});

it("npm package provenance metadata points at veryfront-code", async () => {
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

it("root npm build metadata does not inject extension implementation dependencies", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

  for (const packageName of ["@kreuzberg/node", "better-sqlite3"]) {
    assertEquals(
      source.includes(`"${packageName}"`),
      false,
      `${packageName} belongs to a @veryfront/ext-* package, not root veryfront`,
    );
  }
});

it("standard npm extension policy covers baseline app and developer features", () => {
  assertEquals([...STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES], [
    "ext-bundler-esbuild",
    "ext-content-mdx",
    "ext-css-tailwind",
    "ext-dev-ui-react",
    "ext-node-websocket-ws",
    "ext-parser-babel",
    "ext-yaml",
  ]);
});

it("root npm CLI package declares standard extensions after local install", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");
  const installIndex = source.indexOf(
    "const { code } = await npmInstall.output();",
  );
  const dependencyLoop =
    "for (const extensionDirectory of STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES)";
  const dependencyIndex = source.indexOf(dependencyLoop);

  assertStringIncludes(source, dependencyLoop);
  assertStringIncludes(
    source,
    "pkg.dependencies[`@veryfront/${extensionDirectory}`] = version;",
  );
  assertEquals(
    dependencyIndex > installIndex,
    true,
    "standard extension dependencies must be added after the build-local npm install",
  );
});

it("npm lifecycle probe installs auto-loaded extensions in a real consumer layout", async () => {
  const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

  assertStringIncludes(source, '"--install-links"');
  assertStringIncludes(source, 'const agent = await import("veryfront/agent")');
  assertStringIncludes(source, "agent.parseRuntimeSkillMetadata(");
  assertStringIncludes(
    source,
    "...STANDARD_ROOT_NPM_EXTENSION_DIRECTORIES.map",
  );
  assertStringIncludes(
    source,
    "Deno.realPath(`./npm/extensions/${extensionDirectory}`)",
  );
});

it("npm publish version bump pins first-party extension dependencies to the publish version", async () => {
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
            "@veryfront/ext-node-websocket-ws": "^0.1.1016",
            "@veryfront/ext-parser-babel": "^0.1.1016",
            "@veryfront/ext-yaml": "^0.1.1016",
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
      "@veryfront/ext-node-websocket-ws": publishVersion,
      "@veryfront/ext-parser-babel": publishVersion,
      "@veryfront/ext-yaml": publishVersion,
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

// @veryfront/ext-content-mdx is published as an optional *peer* of the root
// package. RC builds publish every package under a -rc.N version, so if the
// bump skips peerDependencies the root package ships pointing at a version that
// was never published and the optional peer can never be installed.
it("npm publish version bump pins first-party extension peers to the publish version", async () => {
  const packageDir = await Deno.makeTempDir();
  const packagePath = `${packageDir}/package.json`;
  const publishVersion = "0.1.1240-rc.7";

  try {
    await Deno.writeTextFile(
      packagePath,
      JSON.stringify(
        {
          name: "veryfront",
          version: "0.1.1240",
          dependencies: {
            "@veryfront/ext-css-tailwind": "0.1.1240",
          },
          peerDependencies: {
            "@veryfront/ext-content-mdx": "0.1.1240",
            "@huggingface/transformers": "^4.2.0",
            react: "^19.0.0",
          },
          peerDependenciesMeta: {
            "@veryfront/ext-content-mdx": { optional: true },
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
    assertEquals(pkg.peerDependencies, {
      "@veryfront/ext-content-mdx": publishVersion,
      // Third-party optional peers keep their compatibility ranges.
      "@huggingface/transformers": "^4.2.0",
      react: "^19.0.0",
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@veryfront/ext-content-mdx": { optional: true },
    });
  } finally {
    await Deno.remove(packageDir, { recursive: true });
  }
});

it("npm publish orders extensions before the root package", async () => {
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

it("npm publish skips extension packages marked publish false", async () => {
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

// The framework and ext-dev-ui-react both consume the application's React
// generation. These remain root dependencies so npm resolves one React graph
// instead of treating the extension's use as private implementation detail.
const ROOT_SHARED_EXTENSION_DEPENDENCIES = new Set(["react", "react-dom"]);

it("EXTENSION_OWNED_DEPENDENCIES stays in sync with extension manifests", async () => {
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
        owned.has(dependency) || optionalPeers.has(dependency) ||
          ROOT_SHARED_EXTENSION_DEPENDENCIES.has(dependency),
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

  // veryfront@0.1.1239 listed @veryfront/ext-content-mdx under runtime
  // `dependencies`, which drags @mdx-js/mdx -> @types/mdx@2.0.14 into every
  // consumer's node_modules/@types. That file references the *global* JSX
  // namespace, which @types/react@19 no longer declares, so `npm install
  // veryfront` broke a previously-clean `tsc --noEmit` in projects that do not
  // set skipLibCheck. Nothing in the four TS2503 errors names Veryfront.
  //
  // `optionalDependencies` does NOT fix this: npm installs optional
  // dependencies by default and only tolerates their *failure*. Verified with
  // npm 11.12.1 — a package.json whose sole entry is
  // `optionalDependencies: { "@mdx-js/mdx": "3.1.1" }` still produces
  // node_modules/@types/mdx and still fails `tsc --noEmit` with the same four
  // errors. Only an optional peer keeps the package out of the tree, which is
  // the mechanism ROOT_OPTIONAL_RUNTIME_PEERS already uses.
  it("keeps the MDX content extension out of automatic npm installs", () => {
    const pkg = normalizeNpmPackageMetadata({
      dependencies: {
        "@veryfront/ext-bundler-esbuild": "0.1.1239",
        "@veryfront/ext-content-mdx": "0.1.1239",
        "@veryfront/ext-css-tailwind": "0.1.1239",
        zod: "4.3.6",
      },
    });

    assertEquals(pkg.dependencies, {
      "@veryfront/ext-bundler-esbuild": "0.1.1239",
      "@veryfront/ext-css-tailwind": "0.1.1239",
      zod: "4.3.6",
    });
    // An optionalDependency would still be installed, so the move has to land
    // on peerDependencies + peerDependenciesMeta.optional.
    assertEquals(pkg.optionalDependencies, undefined);
    assertEquals(
      pkg.peerDependencies?.["@veryfront/ext-content-mdx"],
      "0.1.1239",
    );
    assertEquals(pkg.peerDependenciesMeta?.["@veryfront/ext-content-mdx"], {
      optional: true,
    });
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
        "@sentry/deno": "10.68.0",
        "brace-expansion": "5.0.9",
        "gaxios": "7.2.0",
        "gcp-metadata": "8.1.2",
        "protobufjs": "7.6.5",
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
    });
    assertEquals(pkg.peerDependenciesMeta, {
      "@huggingface/transformers": { optional: true },
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
    assertStringIncludes(source, "--allow-run=tar");
    const autoLoadedExtensions = [
      "ext-bundler-esbuild",
      "ext-content-mdx",
      "ext-css-tailwind",
      "ext-dev-ui-react",
      "ext-node-websocket-ws",
      "ext-parser-babel",
      "ext-yaml",
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
    assertStringIncludes(source, "getDeferredExtensionState(resolved)");
    assertStringIncludes(source, "await deferred.load(logger)");
    assertStringIncludes(source, "deno eval --node-modules-dir=auto");
    assertStringIncludes(
      source,
      "Deno could not load the packed bundler extension",
    );
    assertStringIncludes(source, "app/page.tsx");
    assertStringIncludes(source, "materializeScaffold");
    assertStringIncludes(source, "template: 'ai-agent'");
    assertStringIncludes(source, "published ai-agent starter");
    assertStringIncludes(source, "dev --port");
    assertStringIncludes(source, ">Assistant</title>");
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
      "ext-node-websocket-ws",
      "ext-db-sqlite",
      "ext-document-kreuzberg",
      "ext-eval-report-mlflow",
      "ext-observability-opentelemetry",
      "ext-observability-sentry",
      "ext-parser-babel",
      "ext-yaml",
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
    const rootSource = await Deno.readTextFile(
      new URL("build-npm-dnt.ts", import.meta.url),
    );
    const extensionSource = await Deno.readTextFile(
      new URL("build-npm-extension-packages.ts", import.meta.url),
    );

    assertEquals(rootSource.includes("timers:"), false);
    assertEquals(extensionSource.includes("timers:"), false);
    assertStringIncludes(rootSource, 'VF_DISABLE_LRU_INTERVAL: "0"');
    assertStringIncludes(rootSource, "await verifyNpmRootImportLifecycle();");
  });

  it("exercises the root-bundled MLflow exporter in the npm lifecycle probe", async () => {
    const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

    assertStringIncludes(source, 'createEvalCliBuiltinExtensions(["mlflow"])');
    assertStringIncludes(source, "getDeferredExtensionState(resolved)");
    assertStringIncludes(source, "await deferred.load(logger)");
    assertStringIncludes(source, 'registry.has("mlflow")');
    assertStringIncludes(
      source,
      'MLFLOW_TRACKING_URI: "http://127.0.0.1:5000"',
    );
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
