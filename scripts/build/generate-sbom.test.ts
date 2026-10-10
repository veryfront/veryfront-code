import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl } from "#std/path";
import { vendorComponentsByWorkspaceManifest } from "./vendor-source-components.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  componentsForManifestBoundary,
  componentsFromEsmShImports,
  componentsFromLock,
  componentsFromLockForManifest,
  dependencyIndexForAllManifests,
  dependencySummaryMarkdown,
  sbomOutputsForAllManifests,
  SENSITIVE_DEPENDENCY_BOUNDARIES,
  SUPPORTED_LOCK_VERSIONS,
} from "./generate-sbom.ts";

Deno.test("SBOM sensitivity ratchet owns the explicit Node WebSocket dependencies", () => {
  const boundary = SENSITIVE_DEPENDENCY_BOUNDARIES.find((candidate) =>
    candidate.sourceLocation === "extensions/ext-node-websocket-ws/deno.json"
  );
  assertEquals(boundary?.label, "Node WebSocket transport");
  assertEquals(boundary?.expectedComponents, ["@types/ws", "ws"]);
});

Deno.test("SBOM sensitivity ratchet owns the explicit Redis runtime dependencies", () => {
  const boundary = SENSITIVE_DEPENDENCY_BOUNDARIES.find((candidate) =>
    candidate.sourceLocation === "extensions/ext-redis/deno.json"
  );
  assertEquals(boundary?.label, "Redis distributed runtime");
  assertEquals(boundary?.expectedComponents, ["@redis/client", "redis"]);
});

describe("componentsFromLock", () => {
  it("emits a CycloneDX library component per npm package, deduplicated", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "npm:zod@4.3.6": "4.3.6" },
      npm: {
        "zod@4.3.6": { integrity: "sha512-aaa", dependencies: [] },
        "fast-deep-equal@3.1.3": { integrity: "sha512-bbb" },
      },
    });

    const components = componentsFromLock(lock);

    assertEquals(components.length, 2);
    const zod = components.find((c) => c.name === "zod")!;
    assertEquals(zod.version, "4.3.6");
    assertEquals(zod.purl, "pkg:npm/zod@4.3.6");
    assertEquals(zod.hashes?.[0], { alg: "SHA-512", content: "aaa" });
  });

  it("strips peer-disambiguator suffix from canonical name@version", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {
        "@mdx-js/mdx@3.1.1_acorn@8.16.0": { integrity: "sha512-x" },
      },
    });
    const c = componentsFromLock(lock)[0];
    assertEquals(c.name, "@mdx-js/mdx");
    assertEquals(c.version, "3.1.1");
    assertEquals(c.purl, "pkg:npm/%40mdx-js/mdx@3.1.1");
  });

  it("deduplicates entries that resolve to the same canonical name@version", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {
        "@opentelemetry/core@2.6.0": { integrity: "sha512-a" },
        "@opentelemetry/core@2.6.0_@opentelemetry+api@1.9.0": {
          integrity: "sha512-a",
        },
      },
    });
    assertEquals(componentsFromLock(lock).length, 1);
  });

  it("includes scoped npm packages with encoded purl", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: { "@opentelemetry/api@1.9.0": { integrity: "sha512-x" } },
    });
    const components = componentsFromLock(lock);
    assertEquals(components[0].purl, "pkg:npm/%40opentelemetry/api@1.9.0");
  });

  it("ignores jsr — not in scope for npm SBOM", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: { "jsr:@std/path@1": "1.0.0" },
      jsr: { "@std/path@1.0.0": {} },
    });
    assertEquals(componentsFromLock(lock).length, 0);
  });

  it("throws on unsupported lock format", () => {
    const lock = JSON.stringify({ version: "999", npm: {} });
    assertThrows(
      () => componentsFromLock(lock),
      Error,
      "Unsupported deno.lock version",
    );
  });

  it("SUPPORTED_LOCK_VERSIONS lists at least the current format", () => {
    assertEquals(SUPPORTED_LOCK_VERSIONS.includes("5"), true);
  });

  it("can emit components for one workspace manifest", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:zod@4.3.6": "4.3.6",
        "npm:bash-tool@1.3.16":
          "1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5",
      },
      npm: {
        "zod@4.3.6": { integrity: "sha512-core", dependencies: [] },
        "bash-tool@1.3.16_ai@6.0.182__zod@3.25.76_just-bash@2.14.5": {
          integrity: "sha512-shell",
          dependencies: [],
        },
      },
      workspace: {
        dependencies: ["npm:zod@4.3.6"],
        members: {
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    assertEquals(
      componentsFromLockForManifest(lock, "deno.json").map((component) =>
        component.name
      ),
      ["zod"],
    );
    assertEquals(
      componentsFromLockForManifest(
        lock,
        "extensions/ext-sandbox-shell-tools/deno.json",
      ).map((component) => component.name),
      ["bash-tool"],
    );
  });

  it("can emit lock and import-map components for one workspace manifest boundary", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
        "npm:tailwindcss@4.2.2": "4.2.2",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
        "tailwindcss@4.2.2": { integrity: "sha512-tailwind", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-css-tailwind": {
            dependencies: ["npm:bash-tool@1.3.16", "npm:tailwindcss@4.2.2"],
          },
        },
      },
    });

    const components = componentsForManifestBoundary(
      lock,
      "extensions/ext-css-tailwind/deno.json",
      {
        manifestImportsByPath: {
          "extensions/ext-css-tailwind/deno.json": {
            tailwindcss: "npm:tailwindcss@4.2.2",
          },
        },
      },
    );

    assertEquals(components.map((component) => component.name), [
      "bash-tool",
      "tailwindcss",
    ]);
  });

  it("emits npm package components from esm.sh import aliases", () => {
    const components = componentsFromEsmShImports({
      "@types/react": "https://esm.sh/@types/react@19.2.14?deps=csstype@3.2.3",
      "react/jsx-runtime":
        "https://esm.sh/react@19.2.4/jsx-runtime?external=react&target=es2022",
      "react": "https://esm.sh/react@19.2.4?target=es2022",
      "std/path": "jsr:@std/path@1.2.3",
    });

    assertEquals(
      components.map((component) => ({
        name: component.name,
        version: component.version,
        purl: component.purl,
      })),
      [
        {
          name: "@types/react",
          version: "19.2.14",
          purl: "pkg:npm/%40types/react@19.2.14",
        },
        {
          name: "csstype",
          version: "3.2.3",
          purl: "pkg:npm/csstype@3.2.3",
        },
        {
          name: "react",
          version: "19.2.4",
          purl: "pkg:npm/react@19.2.4",
        },
      ],
    );
  });

  it("ignores non-exact esm.sh deps query packages", () => {
    const components = componentsFromEsmShImports({
      "main": "https://esm.sh/main@1.0.0?deps=range-only@^1,latest-tag@latest",
    });

    assertEquals(components.map((component) => component.name), ["main"]);
  });

  it("plans an aggregate SBOM plus one SBOM per workspace manifest", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
        "npm:tailwindcss@4.2.2": "4.2.2",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
        "tailwindcss@4.2.2": { integrity: "sha512-tailwind", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-css-tailwind": {
            dependencies: ["npm:tailwindcss@4.2.2"],
          },
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const outputs = sbomOutputsForAllManifests(lock, {
      outputDir: "dist/sbom-0.1.519",
      workspaceMembers: [
        "cli",
        "react",
        "extensions/ext-css-tailwind",
        "extensions/ext-sandbox-shell-tools",
      ],
      manifestImportsByPath: {
        "react/deno.json": {
          react: "https://esm.sh/react@19.2.4?target=es2022",
          "react-dom":
            "https://esm.sh/react-dom@19.2.4?external=react&target=es2022",
          "react/jsx-runtime":
            "https://esm.sh/react@19.2.4/jsx-runtime?deps=csstype@3.2.3&external=react&target=es2022",
        },
        "extensions/ext-css-tailwind/deno.json": {
          tailwindcss: "npm:tailwindcss@4.2.2",
          "tailwindcss/plugin": "npm:tailwindcss@4.2.2/plugin",
        },
      },
    });

    assertEquals(
      outputs.map((output) => output.path),
      [
        "dist/sbom-0.1.519/all.json",
        "dist/sbom-0.1.519/core.json",
        "dist/sbom-0.1.519/cli.json",
        "dist/sbom-0.1.519/react.json",
        "dist/sbom-0.1.519/ext-css-tailwind.json",
        "dist/sbom-0.1.519/ext-sandbox-shell-tools.json",
      ],
    );
    assertEquals(
      outputs.map((output) => output.componentName),
      [
        "veryfront",
        "veryfront:deno.json",
        "veryfront:cli/deno.json",
        "veryfront:react/deno.json",
        "veryfront:extensions/ext-css-tailwind/deno.json",
        "veryfront:extensions/ext-sandbox-shell-tools/deno.json",
      ],
    );
    assertEquals(outputs[0].components.map((component) => component.name), [
      "bash-tool",
      "csstype",
      "react",
      "react-dom",
      "tailwindcss",
    ]);
    assertEquals(outputs[1].components, []);
    assertEquals(outputs[2].components, []);
    assertEquals(outputs[3].components.map((component) => component.name), [
      "csstype",
      "react",
      "react-dom",
    ]);
    assertEquals(outputs[4].components.map((component) => component.name), [
      "tailwindcss",
    ]);
    assertEquals(outputs[5].components.map((component) => component.name), [
      "bash-tool",
    ]);
  });

  it("builds a dependency index grouped by core, cli, react, and extension manifests", () => {
    const lock = JSON.stringify({
      version: "5",
      specifiers: {
        "npm:bash-tool@1.3.16": "1.3.16",
      },
      npm: {
        "bash-tool@1.3.16": { integrity: "sha512-shell", dependencies: [] },
      },
      workspace: {
        dependencies: [],
        members: {
          "extensions/ext-sandbox-shell-tools": {
            dependencies: ["npm:bash-tool@1.3.16"],
          },
        },
      },
    });

    const index = dependencyIndexForAllManifests(lock, {
      workspaceMembers: [
        "cli",
        "react",
        "extensions/ext-sandbox-shell-tools",
      ],
      manifestImportsByPath: {
        "react/deno.json": {
          react: "https://esm.sh/react@19.2.4?target=es2022",
        },
      },
    });

    assertEquals(
      index.manifests.map((manifest) => ({
        sourceLocation: manifest.sourceLocation,
        group: manifest.group,
        componentNames: manifest.components.map((component) => component.name),
      })),
      [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentNames: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentNames: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentNames: ["react"],
        },
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentNames: ["bash-tool"],
        },
      ],
    );
  });

  it("renders a markdown dependency summary with sensitive boundaries highlighted", () => {
    const summary = dependencySummaryMarkdown({
      generatedBy: "generate-sbom",
      manifests: [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentCount: 3,
          components: [
            {
              name: "react",
              version: "19.2.4",
              purl: "pkg:npm/react@19.2.4",
            },
          ],
        },
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentCount: 2,
          components: [
            {
              name: "bash-tool",
              version: "1.3.16",
              purl: "pkg:npm/bash-tool@1.3.16",
            },
          ],
        },
      ],
    });

    assertStringIncludes(
      summary,
      "| Core | `deno.json` | 0 | Third-party free |",
    );
    assertStringIncludes(
      summary,
      "| Extension | `extensions/ext-sandbox-shell-tools/deno.json` | 2 | Sensitive: sandbox execution |",
    );
    assertStringIncludes(
      summary,
      "| Sandbox execution | `extensions/ext-sandbox-shell-tools/deno.json` | 2 | `ai`, `zod` |",
    );
  });
});

it("generate-sbom CLI rejects --lock without a value as a usage error", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "scripts/build/generate-sbom.ts",
      "--lock",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  const stderr = new TextDecoder().decode(result.stderr);

  assertEquals(result.code, 2);
  assertStringIncludes(stderr, "--lock requires a non-empty path");
  assertStringIncludes(stderr, "Usage:");
});

async function vendorSourceFixture() {
  const root = await makeTempDir({ prefix: "vendor-source-inventory-" });
  const member = "extensions/ext-fixture";
  await Deno.mkdir(root + "/" + member + "/vendor", { recursive: true });
  const source = "export const marker = 1;\n";
  await Deno.writeTextFile(root + "/" + member + "/vendor/memory.js", source);
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const inventory = {
    components: [{
      name: "fixture-memory",
      version: "1.0.0-memory.1",
      source: "vendor/memory.js",
      sha256,
      license: "MIT",
      upstream: {
        name: "fixture",
        version: "1.0.0",
        source: "lib/index.js",
        sha256: "a".repeat(64),
        url: "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz",
      },
    }],
  };
  const save = () =>
    Deno.writeTextFile(
      root + "/" + member + "/vendor-sources.json",
      JSON.stringify(inventory),
    );
  await save();
  return { root, member, inventory, save };
}

Deno.test("vendored source custody appears in selected, aggregate and dependency-index outputs", async () => {
  const f = await vendorSourceFixture();
  try {
    const sources = await vendorComponentsByWorkspaceManifest(
      [f.member],
      f.root,
    );
    const manifest = f.member + "/deno.json";
    const component = sources[manifest]![0]!;
    assertEquals(component.hashes, [{
      alg: "SHA-256",
      content: f.inventory.components[0]!.sha256,
    }]);
    assertEquals(component.licenses, [{ license: { id: "MIT" } }]);
    assertEquals(component.pedigree?.ancestors[0]?.name, "fixture");
    const lock = JSON.stringify({
      version: "5",
      specifiers: {},
      npm: {},
      workspace: { members: { [f.member]: { dependencies: [] } } },
    });
    const options = {
      workspaceMembers: [f.member],
      vendorComponentsByManifest: sources,
    };
    assertEquals(componentsForManifestBoundary(lock, manifest, options), [
      component,
    ]);
    const outputs = sbomOutputsForAllManifests(lock, {
      ...options,
      outputDir: "out",
    });
    assertEquals(
      outputs.find((output) => output.path === "out/all.json")?.components,
      [component],
    );
    assertEquals(
      dependencyIndexForAllManifests(lock, options).manifests.find((item) =>
        item.sourceLocation === manifest
      )?.components[0]?.purl,
      component.purl,
    );
    assertEquals(
      componentsForManifestBoundary(
        lock,
        "extensions/other/deno.json",
        options,
      ),
      [],
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("vendored source inventory fails closed for altered bytes and escaping paths", async () => {
  const f = await vendorSourceFixture();
  try {
    await Deno.writeTextFile(
      f.root + "/" + f.member + "/vendor/memory.js",
      "export const marker = 2;\n",
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "digest mismatch",
    );
    f.inventory.components[0]!.source = "../outside.js";
    await f.save();
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "path",
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest(["../outside"], f.root),
      TypeError,
      "workspace path",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("missing optional inventory is allowed; malformed present inventory cannot disappear", async () => {
  const f = await vendorSourceFixture();
  try {
    const path = f.root + "/" + f.member + "/vendor-sources.json";
    await Deno.remove(path);
    assertEquals(
      await vendorComponentsByWorkspaceManifest([f.member], f.root),
      {},
    );
    await Deno.writeTextFile(path, '{"components":[], "unexpected":true}');
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "fields",
    );
    await Deno.writeTextFile(path, "{");
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      SyntaxError,
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("vendored source inventories reject dangling inventory and escaping code symlinks", async () => {
  const f = await vendorSourceFixture();
  const outside = await makeTempDir({ prefix: "vendor-source-outside-" });
  try {
    const inventoryPath = f.root + "/" + f.member + "/vendor-sources.json";
    await Deno.remove(inventoryPath);
    await Deno.symlink(f.root + "/missing-inventory.json", inventoryPath);
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      Deno.errors.NotFound,
    );
    await Deno.remove(inventoryPath);
    await f.save();
    const sourcePath = f.root + "/" + f.member + "/vendor/memory.js";
    await Deno.writeTextFile(
      outside + "/memory.js",
      await Deno.readTextFile(sourcePath),
    );
    await Deno.remove(sourcePath);
    await Deno.symlink(outside + "/memory.js", sourcePath);
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member], f.root),
      TypeError,
      "escapes its workspace",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("different code cannot share a vendored component identity across workspace SBOMs", async () => {
  const f = await vendorSourceFixture();
  try {
    const second = "extensions/ext-second";
    await Deno.mkdir(f.root + "/" + second + "/vendor", { recursive: true });
    const changed = "export const marker = 3;\n";
    await Deno.writeTextFile(
      f.root + "/" + second + "/vendor/memory.js",
      changed,
    );
    const inventory = structuredClone(f.inventory);
    inventory.components[0]!.sha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(changed),
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await Deno.writeTextFile(
      f.root + "/" + second + "/vendor-sources.json",
      JSON.stringify(inventory),
    );
    await assertRejects(
      () => vendorComponentsByWorkspaceManifest([f.member, second], f.root),
      TypeError,
      "Conflicting",
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("lock-only artifact CLI excludes unrelated workspace source; selected source still fails closed", async () => {
  const f = await vendorSourceFixture();
  try {
    await Deno.writeTextFile(
      f.root + "/deno.json",
      JSON.stringify({
        name: "artifact-fixture",
        version: "1.0.0",
        workspace: ["./" + f.member],
      }),
    );
    await Deno.writeTextFile(
      f.root + "/selected.lock",
      JSON.stringify({
        version: "5",
        specifiers: {},
        npm: { "selected-runtime@1.2.3": { integrity: "sha512-aaa" } },
      }),
    );
    const script = fromFileUrl(new URL("./generate-sbom.ts", import.meta.url));
    const config = fromFileUrl(new URL("../test.deno.json", import.meta.url));
    const run = async (extra: string[], output: string) => {
      return await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--frozen",
          "--config",
          config,
          "--allow-read",
          "--allow-write",
          script,
          "--lock",
          "selected.lock",
          "--output",
          output,
          ...extra,
        ],
        cwd: f.root,
        stdout: "piped",
        stderr: "piped",
      }).output();
    };
    let result = await run([], "lock-only.json");
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const output = JSON.parse(
      await Deno.readTextFile(f.root + "/lock-only.json"),
    );
    assertEquals(
      output.components.map((component: { name: string }) => component.name),
      ["selected-runtime"],
    );
    await Deno.writeTextFile(
      f.root + "/" + f.member + "/vendor/memory.js",
      "changed",
    );
    result = await run([], "lock-only-again.json");
    assertEquals(
      result.code,
      0,
      "An unrelated source inventory cannot alter a lock-only artifact",
    );
    result = await run(
      ["--manifest", f.member + "/deno.json"],
      "selected-source.json",
    );
    assertEquals(result.code, 1);
    assertStringIncludes(
      new TextDecoder().decode(result.stderr),
      "digest mismatch",
    );
    await assertRejects(
      () => Deno.stat(f.root + "/selected-source.json"),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});
