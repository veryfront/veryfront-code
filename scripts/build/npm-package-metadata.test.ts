import { assertEquals, assertStringIncludes, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  BROWSER_SAFE_CLIENT_MODULES,
  BROWSER_SAFE_EXPORTS,
} from "./browser-safe-exports.mjs";
import {
  deriveExtensionDependencyOwnership,
  type ExtensionDependencyOwnership,
  loadExtensionDependencyOwnership,
  normalizeNpmPackageMetadata,
  NpmPackageOwnershipError,
  removeInternalNpmEntryPointExports,
  repositoryExtensionDependencyOwnership,
} from "./npm-package-metadata.ts";
import {
  type ExtensionManifest,
  firstPartyExtensionManifestPaths,
  manifestDependencies,
  type RootPackageConfig,
} from "./npm-extension-package-metadata.ts";
import { assertNoBundledReactDomClientShim } from "./npm-react-shims.ts";

Deno.test("exports agent skill helpers as a public package subpath", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  assertEquals(exports["./skill"], "./src/skill/index.ts");
  assertEquals(imports["veryfront/skill"], "./src/skill/index.ts");
});

Deno.test("keeps platform infrastructure import-mapped but package-private", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const exports = denoConfig.exports as Record<string, string>;
  const imports = denoConfig.imports as Record<string, string>;

  assertEquals(imports["veryfront/platform"], "./src/platform/index.ts");
  assertEquals(imports["#veryfront/platform"], "./src/platform/index.ts");
  assertEquals(exports["./platform"], undefined);
  assertEquals(
    Object.values(exports).includes("./src/platform/index.ts"),
    false,
  );
});

Deno.test("exports CLI framework dependencies as public package subpaths", async () => {
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

type GeneratedPackageMetadata = Parameters<
  typeof normalizeNpmPackageMetadata
>[0];

function extensionManifest(
  name: string,
  imports: Record<string, string> = {},
): Record<string, unknown> {
  return {
    name,
    version: "1.2.3",
    exports: "./src/index.ts",
    veryfront: { extension: true },
    imports,
  };
}

function fixtureOwnership(): ExtensionDependencyOwnership {
  return deriveExtensionDependencyOwnership([{
    manifestPath: "extensions/ext-alpha/deno.json",
    manifest: extensionManifest("@veryfront/ext-alpha", {
      alpha: "npm:package-alpha@1.2.3",
    }),
  }]);
}

function assertOwnershipError(
  callback: () => unknown,
  code: NpmPackageOwnershipError["code"],
): NpmPackageOwnershipError {
  const error = assertThrows(callback, NpmPackageOwnershipError);
  assertEquals(error.code, code);
  return error;
}

Deno.test("derives the complete extension dependency inventory from workspace manifests", async () => {
  const denoConfig = JSON.parse(
    await Deno.readTextFile("deno.json"),
  ) as RootPackageConfig;
  const ownership = repositoryExtensionDependencyOwnership();
  const manifestPaths = firstPartyExtensionManifestPaths(denoConfig);

  assertEquals(manifestPaths.length > 0, true);
  assertEquals(Object.getPrototypeOf(ownership.packages), null);
  assertEquals(Object.isFrozen(ownership), true);
  assertEquals(Object.isFrozen(ownership.packages), true);
  assertEquals(
    Object.keys(ownership.packages),
    Object.keys(ownership.packages).toSorted(),
  );

  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(
      await Deno.readTextFile(manifestPath),
    ) as ExtensionManifest;
    for (
      const [dependencyName, version] of Object.entries(
        manifestDependencies(manifest),
      )
    ) {
      const owner = ownership.packages[dependencyName]?.find((candidate) =>
        candidate.manifestPath === manifestPath
      );
      assertEquals(owner, {
        extensionName: manifest.name,
        manifestPath,
        version,
      });
      assertEquals(Object.isFrozen(owner), true);
    }
  }
});

describe("extension dependency ownership", () => {
  it("is deterministic and accepts multiple owners of one exact version", () => {
    const sources = [{
      manifestPath: "extensions/ext-zeta/deno.json",
      manifest: extensionManifest("@veryfront/ext-zeta", {
        zeta: "npm:package-zeta@2.0.0/subpath",
        shared: "npm:package-shared@3.4.5",
      }),
    }, {
      manifestPath: "extensions/ext-alpha/deno.json",
      manifest: extensionManifest("@veryfront/ext-alpha", {
        alpha: "https://esm.sh/package-alpha@1.2.3?target=deno",
        shared: "npm:package-shared@3.4.5",
      }),
    }];

    const forward = deriveExtensionDependencyOwnership(sources);
    const reverse = deriveExtensionDependencyOwnership(sources.toReversed());

    assertEquals(JSON.stringify(forward), JSON.stringify(reverse));
    assertEquals(Object.keys(forward.packages), [
      "package-alpha",
      "package-shared",
      "package-zeta",
    ]);
    assertEquals(forward.packages["package-shared"], [{
      extensionName: "@veryfront/ext-alpha",
      manifestPath: "extensions/ext-alpha/deno.json",
      version: "3.4.5",
    }, {
      extensionName: "@veryfront/ext-zeta",
      manifestPath: "extensions/ext-zeta/deno.json",
      version: "3.4.5",
    }]);
  });

  it("keeps independently versioned extension dependencies isolated", () => {
    const ownership = deriveExtensionDependencyOwnership([{
      manifestPath: "extensions/ext-alpha/deno.json",
      manifest: extensionManifest("@veryfront/ext-alpha", {
        dependency: "npm:package-shared@1.0.0",
      }),
    }, {
      manifestPath: "extensions/ext-zeta/deno.json",
      manifest: extensionManifest("@veryfront/ext-zeta", {
        dependency: "npm:package-shared@2.0.0",
      }),
    }]);

    assertEquals(ownership.packages["package-shared"], [{
      extensionName: "@veryfront/ext-alpha",
      manifestPath: "extensions/ext-alpha/deno.json",
      version: "1.0.0",
    }, {
      extensionName: "@veryfront/ext-zeta",
      manifestPath: "extensions/ext-zeta/deno.json",
      version: "2.0.0",
    }]);
  });

  it("fails closed on conflicting aliases inside one extension manifest", () => {
    assertOwnershipError(
      () =>
        deriveExtensionDependencyOwnership([{
          manifestPath: "extensions/ext-alpha/deno.json",
          manifest: extensionManifest("@veryfront/ext-alpha", {
            first: "npm:package-shared@1.0.0",
            second: "npm:package-shared@2.0.0/subpath",
          }),
        }]),
      "conflicting-extension-dependency-version",
    );
  });

  it("fails closed on duplicate extension identities", () => {
    assertOwnershipError(
      () =>
        deriveExtensionDependencyOwnership([{
          manifestPath: "extensions/ext-alpha/deno.json",
          manifest: extensionManifest("@veryfront/ext-duplicate"),
        }, {
          manifestPath: "extensions/ext-zeta/deno.json",
          manifest: extensionManifest("@veryfront/ext-duplicate"),
        }]),
      "duplicate-extension-identity",
    );
  });

  for (
    const [description, manifest] of [
      [
        "a non-exact extension version",
        { ...extensionManifest("@veryfront/ext-alpha"), version: "^1.2.3" },
      ],
      [
        "a non-first-party extension identity",
        extensionManifest("package-alpha"),
      ],
      [
        "an npm target without a version",
        extensionManifest("@veryfront/ext-alpha", {
          dependency: "npm:package-alpha",
        }),
      ],
      [
        "a non-exact dependency version",
        extensionManifest("@veryfront/ext-alpha", {
          dependency: "npm:package-alpha@^1.2.3",
        }),
      ],
      [
        "an export that escapes its package",
        {
          ...extensionManifest("@veryfront/ext-alpha"),
          exports: "../src/index.ts",
        },
      ],
      [
        "an exports map without its root entry point",
        {
          ...extensionManifest("@veryfront/ext-alpha"),
          exports: { "./feature": "./src/feature.ts" },
        },
      ],
    ] as const
  ) {
    it(`rejects ${description}`, () => {
      assertOwnershipError(
        () =>
          deriveExtensionDependencyOwnership([{
            manifestPath: "extensions/ext-alpha/deno.json",
            manifest,
          }]),
        "invalid-extension-manifest",
      );
    });
  }

  it("does not invoke accessors while rejecting hostile manifests", () => {
    let getterInvoked = false;
    const manifest = extensionManifest("@veryfront/ext-alpha");
    Object.defineProperty(manifest, "name", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "@veryfront/ext-alpha";
      },
    });

    assertOwnershipError(
      () =>
        deriveExtensionDependencyOwnership([{
          manifestPath: "extensions/ext-alpha/deno.json",
          manifest,
        }]),
      "invalid-extension-manifest",
    );
    assertEquals(getterInvoked, false);
  });

  it("rejects duplicate workspace entries before reading manifests", async () => {
    const root = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${root}/deno.json`,
        JSON.stringify({
          workspace: ["./extensions/ext-alpha", "./extensions/EXT-ALPHA"],
        }),
      );
      assertOwnershipError(
        () => loadExtensionDependencyOwnership(new URL(`file://${root}/`)),
        "duplicate-workspace-entry",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

describe("normalizeNpmPackageMetadata", () => {
  const ownership = fixtureOwnership();

  it("removes source files and pins only automatic dependency ranges", () => {
    const pkg = normalizeNpmPackageMetadata({
      files: ["esm", "script", "src", "/src", "bin", "README.md"],
      dependencies: { "package-core": "^1.0.0" },
      optionalDependencies: { "package-optional": "~2.0.0" },
      devDependencies: { "package-development": "^3.0.0" },
      peerDependencies: { "package-peer": "^4.0.0" },
      overrides: { "package-transitive": "~5.0.0" },
    }, ownership);

    assertEquals(pkg.files, ["esm", "script", "bin", "README.md"]);
    assertEquals(pkg.dependencies, { "package-core": "1.0.0" });
    assertEquals(pkg.optionalDependencies, { "package-optional": "2.0.0" });
    assertEquals(pkg.devDependencies, { "package-development": "3.0.0" });
    assertEquals(pkg.peerDependencies, { "package-peer": "^4.0.0" });
    assertEquals(pkg.overrides, { "package-transitive": "~5.0.0" });
  });

  for (
    const [section, createPackage] of [
      ["dependencies", () => ({ dependencies: { "package-alpha": "1.2.3" } })],
      [
        "optionalDependencies",
        () => ({ optionalDependencies: { "package-alpha": "1.2.3" } }),
      ],
      [
        "peerDependencies",
        () => ({ peerDependencies: { "package-alpha": "^1.2.3" } }),
      ],
      [
        "peerDependenciesMeta",
        () => ({
          peerDependenciesMeta: { "package-alpha": { optional: true } },
        }),
      ],
      [
        "devDependencies",
        () => ({ devDependencies: { "package-alpha": "1.2.3" } }),
      ],
      ["overrides", () => ({ overrides: { "package-alpha": "1.2.3" } })],
    ] satisfies readonly [string, () => GeneratedPackageMetadata][]
  ) {
    it(`fails closed when ${section} claims an extension-owned package`, () => {
      const error = assertOwnershipError(
        () => normalizeNpmPackageMetadata(createPackage(), ownership),
        "root-extension-dependency-collision",
      );
      assertStringIncludes(error.location, `package.json.${section}`);
      assertStringIncludes(error.message, "extensions/ext-alpha/deno.json");
    });
  }

  it("does not partially mutate metadata when ownership validation fails", () => {
    const pkg = {
      files: ["esm", "src"],
      dependencies: {
        "package-alpha": "^1.2.3",
        "package-core": "^4.5.6",
      },
    };
    const before = structuredClone(pkg);

    assertOwnershipError(
      () => normalizeNpmPackageMetadata(pkg, ownership),
      "root-extension-dependency-collision",
    );
    assertEquals(pkg, before);
  });

  it("detects extension-owned packages hidden behind npm aliases", () => {
    const error = assertOwnershipError(
      () =>
        normalizeNpmPackageMetadata({
          dependencies: {
            "package-alias": "npm:package-alpha@^1.2.3",
          },
        }, ownership),
      "root-extension-dependency-collision",
    );
    assertStringIncludes(error.message, "npm alias package-alias");
  });

  it("detects extension-owned packages in version-qualified overrides", () => {
    const error = assertOwnershipError(
      () =>
        normalizeNpmPackageMetadata({
          overrides: {
            "package-alpha@^1.0.0": "1.2.3",
          },
        }, ownership),
      "root-extension-dependency-collision",
    );
    assertStringIncludes(error.message, "package-alpha");
  });

  it("rejects nested override records instead of overlooking their dependencies", () => {
    assertOwnershipError(
      () =>
        normalizeNpmPackageMetadata({
          overrides: {
            parent: { "package-alpha": "1.2.3" },
          } as unknown as Record<string, string>,
        }, ownership),
      "invalid-generated-package-metadata",
    );
  });

  it("rejects malformed generated dependency records", () => {
    assertOwnershipError(
      () =>
        normalizeNpmPackageMetadata({
          dependencies: {
            "package-core": 42,
          } as unknown as Record<string, string>,
        }, ownership),
      "invalid-generated-package-metadata",
    );
  });

  it("uses the repository-derived inventory by default", () => {
    const dependencyName = Object.keys(
      repositoryExtensionDependencyOwnership().packages,
    )[0];
    if (dependencyName === undefined) {
      throw new Error("expected at least one extension-owned dependency");
    }

    assertOwnershipError(
      () =>
        normalizeNpmPackageMetadata({
          dependencies: { [dependencyName]: "0.0.0" },
        }),
      "root-extension-dependency-collision",
    );
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
    assertStringIncludes(source, "@veryfront/ext-parser-babel/parser-only");
    assertStringIncludes(
      source,
      "veryfront/esm/src/config/declarative-evaluator.js",
    );
    assertStringIncludes(
      source,
      "veryfront/esm/src/config/declarative-evaluator-worker-runner.js",
    );
    assertStringIncludes(
      source,
      "evaluatePreparedDeclarativeConfigInWorker",
    );
    for (
      const workerContract of [
        "forbidden-capability",
        "worker-aborted",
        "worker-unavailable",
        "worker-timeout",
        "assertNoLeakage",
      ]
    ) {
      assertStringIncludes(source, workerContract);
    }
    assertStringIncludes(source, 'node --version)" = "v18.18.0"');
    assertStringIncludes(source, "*/@babel/generator");
    assertStringIncludes(source, "*/@babel/traverse");
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
      "ext-observability-sentry",
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

  it("verifies proxy streaming bodies against the built npm artifact in Node", async () => {
    const source = await Deno.readTextFile("scripts/build/build-npm-dnt.ts");

    assertStringIncludes(source, "await verifyNpmProxyStreamingPortability();");
    assertStringIncludes(source, "./esm/src/proxy/handler.js");
    assertStringIncludes(source, "./esm/src/proxy/outbound-request.js");
    assertStringIncludes(
      source,
      "outboundBody = await new Request(input, init).text()",
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

  it("ships the client root barrel without publishing an import subpath", async () => {
    const pkg = JSON.parse(await Deno.readTextFile("npm/package.json"));
    assertEquals(pkg.exports["./index.client"], undefined);

    for (
      const path of [
        "npm/esm/src/index.client.js",
        "npm/esm/src/index.client.d.ts",
      ]
    ) {
      const source = await Deno.readTextFile(path);
      assertEquals(source.includes("_dnt.polyfills"), false);
      assertEquals(source.includes("_dnt.shims"), false);
    }
  });

  it("emits the declarative worker boundary without publishing import subpaths", async () => {
    const pkg = JSON.parse(await Deno.readTextFile("npm/package.json"));
    for (
      const moduleName of [
        "declarative-evaluator",
        "declarative-evaluator-worker-entry",
        "declarative-evaluator-worker-runner",
      ]
    ) {
      assertEquals(pkg.exports[`./config/${moduleName}`], undefined);
      await Deno.stat(`npm/esm/src/config/${moduleName}.js`);
      await Deno.stat(`npm/esm/src/config/${moduleName}.d.ts`);
    }

    const workerEntry = await Deno.readTextFile(
      "npm/esm/src/config/declarative-evaluator-worker-entry.js",
    );
    assertStringIncludes(
      workerEntry,
      "@veryfront/ext-parser-babel/parser-only",
    );
    assertEquals(workerEntry.includes("extensions/ext-parser-babel"), false);
  });

  it("does not publish the Deno-only react-dom client shim", () => {
    assertNoBundledReactDomClientShim("npm/esm");
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
