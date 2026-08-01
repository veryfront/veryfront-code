import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension discovery tests.
 *
 * Covers pure logic (parse/merge) and filesystem discovery against
 * real tempdir fixtures (scoped packages, symlinks, malformed package.json).
 *
 * @module extensions/discovery.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "@std/path";
import type { Extension, ResolvedExtension } from "./types.ts";
import {
  discoverLocalExtensions,
  discoverPackageExtensions,
  discoverProjectExtensions,
  mergeExtensions,
  parsePackageMetadata,
} from "./discovery.ts";

function stubExtension(overrides: Partial<Extension> = {}): Extension {
  return {
    name: "stub",
    version: "1.0.0",
    capabilities: [],
    ...overrides,
  };
}

describe("parsePackageMetadata()", () => {
  it("should detect extension package", () => {
    const result = parsePackageMetadata({
      name: "@veryfront/ext-css-tailwind",
      veryfront: { extension: true, capabilities: [{ type: "css" }] },
    });
    assertEquals(result?.isExtension, true);
    assertEquals(result?.activation, undefined);
    assertEquals(result?.capabilities.length, 1);
    assertEquals(result?.capabilities[0]?.type, "css");
  });

  it("should return undefined for non-extension package", () => {
    const result = parsePackageMetadata({ name: "lodash" });
    assertEquals(result, undefined);
  });

  it("should return undefined when extension is false", () => {
    const result = parsePackageMetadata({
      name: "some-pkg",
      veryfront: { extension: false },
    });
    assertEquals(result, undefined);
  });

  it("should return undefined when veryfront field is array", () => {
    const result = parsePackageMetadata({ veryfront: [] });
    assertEquals(result, undefined);
  });

  it("should return undefined when veryfront field is null", () => {
    const result = parsePackageMetadata({ veryfront: null });
    assertEquals(result, undefined);
  });

  it("parses explicit activation and rejects unknown activation modes", () => {
    assertEquals(
      parsePackageMetadata({
        veryfront: { extension: true, activation: "auto" },
      })?.activation,
      "auto",
    );
    assertEquals(
      parsePackageMetadata({
        veryfront: { extension: true, activation: "explicit" },
      })?.activation,
      "explicit",
    );
    assertEquals(
      parsePackageMetadata({
        veryfront: { extension: true, activation: "sometimes" },
      }),
      undefined,
    );
  });

  it("rejects hostile metadata without invoking accessors", () => {
    let getterCalls = 0;
    const rootAccessor = Object.defineProperty({}, "veryfront", {
      enumerable: true,
      get() {
        getterCalls++;
        return { extension: true, activation: "auto" };
      },
    });
    const activationAccessor = {
      veryfront: Object.defineProperty({ extension: true }, "activation", {
        enumerable: true,
        get() {
          getterCalls++;
          return "auto";
        },
      }),
    };
    const revocable = Proxy.revocable({
      veryfront: { extension: true, activation: "auto" },
    }, {});
    revocable.revoke();

    assertEquals(parsePackageMetadata(rootAccessor), undefined);
    assertEquals(parsePackageMetadata(activationAccessor), undefined);
    assertEquals(parsePackageMetadata(revocable.proxy), undefined);
    assertEquals(getterCalls, 0);
  });

  it("should filter malformed capability entries", () => {
    const result = parsePackageMetadata({
      veryfront: {
        extension: true,
        capabilities: [
          { type: "css" },
          null,
          42,
          "string",
          [],
          { notAType: "x" },
          { type: "" },
          { type: "valid" },
        ],
      },
    });
    assertEquals(result?.capabilities.length, 2);
    assertEquals(result?.capabilities[0]?.type, "css");
    assertEquals(result?.capabilities[1]?.type, "valid");
  });

  it("should parse contract metadata", () => {
    const result = parsePackageMetadata({
      veryfront: {
        extension: true,
        capabilities: [{ type: "net:outbound", hosts: ["api.example.com"] }],
        contracts: {
          provides: ["CacheStore", ""],
          requires: ["SchemaValidator", 42],
        },
      },
    });

    assertEquals(result?.contracts?.provides, ["CacheStore"]);
    assertEquals(result?.contracts?.requires, ["SchemaValidator"]);
  });

  it("should ignore malformed contract metadata", () => {
    const result = parsePackageMetadata({
      veryfront: {
        extension: true,
        contracts: {
          provides: ["", 42],
          requires: "SchemaValidator",
        },
      },
    });

    assertEquals(result?.contracts, undefined);
  });

  it("should treat non-array capabilities as empty", () => {
    const result = parsePackageMetadata({
      veryfront: { extension: true, capabilities: "not-an-array" },
    });
    assertEquals(result?.capabilities.length, 0);
  });
});

describe("mergeExtensions()", () => {
  it("should give config highest priority", () => {
    const configExt = stubExtension({ name: "shared", version: "2.0.0" });
    const packageExt = stubExtension({ name: "shared", version: "1.0.0" });

    const configResolved: ResolvedExtension[] = [
      { extension: configExt, source: "config", origin: "veryfront.config.ts" },
    ];
    const packageResolved: ResolvedExtension[] = [
      {
        extension: packageExt,
        source: "package",
        origin: "node_modules/@veryfront/ext-shared",
      },
    ];

    const result = mergeExtensions(configResolved, packageResolved, [], []);
    assertEquals(result.length, 1);
    assertEquals(result[0]?.extension.version, "2.0.0");
    assertEquals(result[0]?.source, "config");
  });

  it("should filter disabled extensions", () => {
    const ext = stubExtension({ name: "disabled-ext" });
    const configResolved: ResolvedExtension[] = [
      { extension: ext, source: "config", origin: "veryfront.config.ts" },
    ];

    const result = mergeExtensions(
      configResolved,
      [],
      [],
      [],
      [{ name: "disabled-ext", enabled: false }],
    );
    assertEquals(result.length, 0);
  });

  it("should deduplicate by name keeping highest priority", () => {
    const configExt = stubExtension({ name: "alpha", version: "3.0.0" });
    const packageExt = stubExtension({ name: "alpha", version: "2.0.0" });
    const projectExt = stubExtension({ name: "alpha", version: "1.0.0" });
    const localExt = stubExtension({ name: "beta", version: "1.0.0" });

    const result = mergeExtensions(
      [{ extension: configExt, source: "config", origin: "config" }],
      [{ extension: packageExt, source: "package", origin: "pkg" }],
      [{ extension: projectExt, source: "project", origin: "project" }],
      [{ extension: localExt, source: "local-file", origin: "local" }],
    );
    assertEquals(result.length, 2);
    assertEquals(result[0]?.extension.name, "alpha");
    assertEquals(result[0]?.extension.version, "3.0.0");
    assertEquals(result[1]?.extension.name, "beta");
  });

  it("should return empty for empty inputs", () => {
    assertEquals(mergeExtensions([], [], [], []), []);
  });
});

// ---------------------------------------------------------------------------
// Filesystem discovery fixtures
// ---------------------------------------------------------------------------

async function writePkg(
  dir: string,
  name: string,
  veryfront?: Record<string, unknown>,
): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  const pkg: Record<string, unknown> = {
    name,
    version: "1.0.0",
    exports: "./index.js",
  };
  if (veryfront) pkg.veryfront = veryfront;
  await Deno.writeTextFile(join(dir, "package.json"), JSON.stringify(pkg));
  await Deno.writeTextFile(join(dir, "index.js"), "export default {};");
}

describe("discoverPackageExtensions()", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-disc-pkg-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("returns empty when node_modules is missing", async () => {
    assertEquals(await discoverPackageExtensions(tmp), []);
  });

  it("finds a top-level extension package", async () => {
    await writePkg(join(tmp, "node_modules", "ext-a"), "ext-a", {
      extension: true,
      capabilities: [{ type: "bundler" }],
    });
    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "ext-a");
    assertEquals(found[0]?.metadata.capabilities[0]?.type, "bundler");
    assertEquals(
      found[0]?.importTarget,
      await Deno.realPath(join(tmp, "node_modules", "ext-a", "index.js")),
    );
  });

  it("returns package hits in stable lexical order", async () => {
    await writePkg(join(tmp, "node_modules", "z-last"), "z-last", {
      extension: true,
    });
    await writePkg(join(tmp, "node_modules", "a-first"), "a-first", {
      extension: true,
    });

    assertEquals(
      (await discoverPackageExtensions(tmp)).map((entry) => entry.packageName),
      ["a-first", "z-last"],
    );
  });

  it("skips packages without veryfront.extension", async () => {
    await writePkg(join(tmp, "node_modules", "lodash"), "lodash");
    await writePkg(join(tmp, "node_modules", "ext-a"), "ext-a", {
      extension: true,
    });
    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "ext-a");
  });

  it("finds scoped packages under @scope/", async () => {
    await writePkg(
      join(tmp, "node_modules", "@veryfront", "ext-css-tailwind"),
      "@veryfront/ext-css-tailwind",
      { extension: true },
    );
    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "@veryfront/ext-css-tailwind");
  });

  it("finds symlinked packages (pnpm layout)", async () => {
    // Real package lives outside node_modules; a symlink points to it.
    const realPkg = join(tmp, ".store", "ext-pnpm@1.0.0");
    await writePkg(realPkg, "ext-pnpm", { extension: true });
    await Deno.mkdir(join(tmp, "node_modules"), { recursive: true });
    await Deno.symlink(realPkg, join(tmp, "node_modules", "ext-pnpm"));

    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "ext-pnpm");
  });

  it("surfaces package-owner permission failures instead of silently skipping them", async () => {
    const nodeModules = join(tmp, "node_modules");
    const restrictedPackage = join(tmp, "restricted", "ext-denied");
    const lexicalPackage = join(nodeModules, "ext-denied");
    await writePkg(restrictedPackage, "ext-denied", { extension: true });
    await Deno.mkdir(nodeModules, { recursive: true });
    await Deno.symlink(restrictedPackage, lexicalPackage);

    const repositoryRoot = Deno.cwd();
    const childPath = join(nodeModules, "permission-child.ts");
    const discoveryUrl = new URL("./discovery.ts", import.meta.url).href;
    await Deno.writeTextFile(
      childPath,
      `import { discoverPackageExtensions } from ${JSON.stringify(discoveryUrl)};
try {
  await discoverPackageExtensions(Deno.args[0]);
  Deno.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("owning directory could not be verified securely")) {
    console.error(message);
    Deno.exit(3);
  }
  console.log("surfaced-owner-failure");
}`,
    );

    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--config",
        join(repositoryRoot, "deno.json"),
        `--allow-read=${repositoryRoot},${nodeModules}`,
        childPath,
        tmp,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "surfaced-owner-failure");
  });

  it("finds symlinked scoped packages (pnpm scoped layout)", async () => {
    const realPkg = join(tmp, ".store", "ext-scoped@1.0.0");
    await writePkg(realPkg, "@veryfront/ext-scoped", { extension: true });
    await Deno.mkdir(join(tmp, "node_modules", "@veryfront"), {
      recursive: true,
    });
    await Deno.symlink(
      realPkg,
      join(tmp, "node_modules", "@veryfront", "ext-scoped"),
    );

    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "@veryfront/ext-scoped");
  });

  it("rejects extension packages whose manifest identity or entrypoint escapes", async () => {
    const mismatched = join(tmp, "node_modules", "ext-mismatched");
    await writePkg(mismatched, "ext-decoy", { extension: true });
    await assertRejects(
      () => discoverPackageExtensions(tmp),
      TypeError,
      "unsafe import target",
    );
    await Deno.remove(mismatched, { recursive: true });

    const escaping = join(tmp, "node_modules", "ext-escaping");
    await writePkg(escaping, "ext-escaping", { extension: true });
    await Deno.writeTextFile(
      join(escaping, "package.json"),
      JSON.stringify({
        name: "ext-escaping",
        exports: "../outside.js",
        veryfront: { extension: true },
      }),
    );
    await assertRejects(
      () => discoverPackageExtensions(tmp),
      TypeError,
      "unsafe import target",
    );
  });

  it("ignores inert explicit packages before resolving an invalid entrypoint", async () => {
    const explicit = join(tmp, "node_modules", "ext-explicit-invalid");
    await Deno.mkdir(explicit, { recursive: true });
    await Deno.writeTextFile(
      join(explicit, "package.json"),
      JSON.stringify({
        name: "ext-explicit-invalid",
        exports: "../outside.js",
        veryfront: { extension: true, activation: "explicit" },
      }),
    );
    await writePkg(join(tmp, "node_modules", "ext-ok"), "ext-ok", {
      extension: true,
    });

    assertEquals(
      (await discoverPackageExtensions(tmp)).map((entry) => entry.packageName),
      ["ext-ok"],
    );
  });

  it("ignores extension packages whose manifest is a symbolic link", async () => {
    const pkgDir = join(tmp, "node_modules", "ext-linked-manifest");
    await Deno.mkdir(pkgDir, { recursive: true });
    await Deno.writeTextFile(join(pkgDir, "index.js"), "export default {};");
    const target = join(tmp, "linked-package.json");
    await Deno.writeTextFile(
      target,
      JSON.stringify({
        name: "ext-linked-manifest",
        exports: "./index.js",
        veryfront: { extension: true },
      }),
    );
    await Deno.symlink(target, join(pkgDir, "package.json"));

    assertEquals(await discoverPackageExtensions(tmp), []);
  });

  it("tolerates malformed package.json", async () => {
    const pkgDir = join(tmp, "node_modules", "ext-broken");
    await Deno.mkdir(pkgDir, { recursive: true });
    await Deno.writeTextFile(join(pkgDir, "package.json"), "{not valid json");

    await writePkg(join(tmp, "node_modules", "ext-ok"), "ext-ok", {
      extension: true,
    });

    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "ext-ok");
  });

  it("ignores oversized and invalid UTF-8 package manifests", async () => {
    const oversized = join(tmp, "node_modules", "ext-oversized");
    const invalidUtf8 = join(tmp, "node_modules", "ext-invalid-utf8");
    await Deno.mkdir(oversized, { recursive: true });
    await Deno.mkdir(invalidUtf8, { recursive: true });
    await Deno.writeTextFile(
      join(oversized, "package.json"),
      "x".repeat(256 * 1_024 + 1),
    );
    await Deno.writeFile(
      join(invalidUtf8, "package.json"),
      new Uint8Array([0xc3, 0x28]),
    );
    await writePkg(join(tmp, "node_modules", "ext-ok"), "ext-ok", {
      extension: true,
    });

    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.map((entry) => entry.packageName), ["ext-ok"]);
  });

  it("tolerates packages missing package.json", async () => {
    await Deno.mkdir(join(tmp, "node_modules", "empty-dir"), {
      recursive: true,
    });
    await writePkg(join(tmp, "node_modules", "ext-ok"), "ext-ok", {
      extension: true,
    });
    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
  });
});

describe("discoverProjectExtensions()", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-disc-proj-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("returns empty when extensions dir is missing", async () => {
    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("finds src/index.ts", async () => {
    const dir = join(tmp, "extensions", "my-ext", "src");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "export default {};");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(
      found[0],
      await Deno.realPath(join(tmp, "extensions", "my-ext", "src", "index.ts")),
    );
  });

  it("falls back to index.ts when src/index.ts is absent", async () => {
    const dir = join(tmp, "extensions", "flat-ext");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "export default {};");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(
      found[0],
      await Deno.realPath(join(tmp, "extensions", "flat-ext", "index.ts")),
    );
  });

  it("prefers src/index.ts over index.ts", async () => {
    const dir = join(tmp, "extensions", "both");
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "root");
    await Deno.writeTextFile(join(dir, "src", "index.ts"), "src");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0], await Deno.realPath(join(dir, "src", "index.ts")));
  });

  it("skips extension dirs with no index", async () => {
    const dir = join(tmp, "extensions", "empty-ext");
    await Deno.mkdir(dir, { recursive: true });
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found, []);
  });

  it("skips non-directory entries in extensions/", async () => {
    await Deno.mkdir(join(tmp, "extensions"), { recursive: true });
    await Deno.writeTextFile(join(tmp, "extensions", "README.md"), "x");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found, []);
  });

  it("returns project entry points in stable lexical order", async () => {
    for (const name of ["z-last", "a-first"]) {
      const dir = join(tmp, "extensions", name);
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "index.ts"), "export default {};");
    }

    assertEquals(await discoverProjectExtensions(tmp), [
      await Deno.realPath(join(tmp, "extensions", "a-first", "index.ts")),
      await Deno.realPath(join(tmp, "extensions", "z-last", "index.ts")),
    ]);
  });

  it("does not discover project extensions whose manifest requires explicit activation", async () => {
    const dir = join(tmp, "extensions", "explicit-only");
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "src", "index.ts"),
      "throw new Error('must not import');",
    );
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        veryfront: { extension: true, activation: "explicit" },
      }),
    );

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("uses the stricter activation when Deno and npm manifests coexist", async () => {
    const dir = join(tmp, "extensions", "dual-manifest");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({ veryfront: { extension: true, activation: "auto" } }),
    );
    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({ veryfront: { extension: true, activation: "explicit" } }),
    );

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("honors explicit activation from JSONC comments and trailing commas", async () => {
    const dir = join(tmp, "extensions", "jsonc-explicit");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
    await Deno.writeTextFile(
      join(dir, "deno.jsonc"),
      `{
        // Deno accepts comments and trailing commas in deno.jsonc.
        "veryfront": {
          "extension": true,
          "activation": "explicit",
        },
      }`,
    );

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("uses Deno JSONC grammar for deno.json as well as deno.jsonc", async () => {
    const dir = join(tmp, "extensions", "json-explicit");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      `{
        // Deno accepts JSONC syntax in deno.json too.
        "veryfront": {
          "activation": "explicit",
        },
      }`,
    );

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("uses strictest-wins for every manifest carrying the explicit declaration", async () => {
    const manifestNames = ["deno.json", "deno.jsonc", "package.json"] as const;
    for (const explicitManifest of manifestNames) {
      const dir = join(tmp, "extensions", `strict-${explicitManifest.replace(".", "-")}`);
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
      for (const manifestName of manifestNames) {
        await Deno.writeTextFile(
          join(dir, manifestName),
          JSON.stringify({
            veryfront: {
              activation: manifestName === explicitManifest ? "explicit" : "auto",
            },
          }),
        );
      }
    }

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("uses the strictest activation across JSON, JSONC, and npm manifests", async () => {
    const dir = join(tmp, "extensions", "three-manifests");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({ veryfront: { extension: true, activation: "auto" } }),
    );
    await Deno.writeTextFile(
      join(dir, "deno.jsonc"),
      '{ "veryfront": { "extension": true, "activation": "explicit", }, }',
    );
    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({ veryfront: { extension: true, activation: "auto" } }),
    );

    assertEquals(await discoverProjectExtensions(tmp), []);
  });

  it("fails closed on malformed JSONC activation metadata", async () => {
    const dir = join(tmp, "extensions", "malformed-jsonc");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
    await Deno.writeTextFile(
      join(dir, "deno.jsonc"),
      '{ "veryfront": { /* unterminated',
    );

    await assertRejects(
      () => discoverProjectExtensions(tmp),
      Error,
      "Failed to parse JSONC extension manifest",
    );
  });

  it("rejects entrypoint symlinks that escape into an explicit sibling", async () => {
    const explicitDir = join(tmp, "extensions", "explicit-target");
    const directDir = join(tmp, "extensions", "auto-direct");
    const intermediateDir = join(tmp, "extensions", "auto-intermediate");
    await Deno.mkdir(join(explicitDir, "src"), { recursive: true });
    await Deno.mkdir(directDir, { recursive: true });
    await Deno.mkdir(intermediateDir, { recursive: true });
    await Deno.writeTextFile(
      join(explicitDir, "src", "index.ts"),
      "throw new Error('explicit sibling must not import');",
    );
    await Deno.writeTextFile(
      join(explicitDir, "deno.json"),
      JSON.stringify({
        veryfront: { extension: true, activation: "explicit" },
      }),
    );
    await Deno.symlink(
      join(explicitDir, "src", "index.ts"),
      join(directDir, "index.ts"),
    );
    await Deno.symlink(join(explicitDir, "src"), join(intermediateDir, "src"));

    await assertRejects(
      () => discoverProjectExtensions(tmp),
      TypeError,
      "not a safe regular file within its extension directory",
    );
    await Deno.remove(directDir, { recursive: true });
    await assertRejects(
      () => discoverProjectExtensions(tmp),
      TypeError,
      "not a safe regular file within its extension directory",
    );
  });

  it("fails closed with diagnostics on malformed project activation metadata", async () => {
    for (
      const [name, manifest] of [
        ["malformed-json", "{not-json"],
        [
          "unknown-mode",
          JSON.stringify({
            veryfront: { extension: true, activation: "sometimes" },
          }),
        ],
      ] as const
    ) {
      const dir = join(tmp, "extensions", name);
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
      await Deno.writeTextFile(join(dir, "deno.json"), manifest);
    }

    await assertRejects(
      () => discoverProjectExtensions(tmp),
      Error,
      "Failed to parse JSONC extension manifest",
    );
    await Deno.remove(join(tmp, "extensions", "malformed-json"), {
      recursive: true,
    });
    await assertRejects(
      () => discoverProjectExtensions(tmp),
      TypeError,
      "invalid veryfront.activation mode",
    );
  });

  it("rejects present malformed veryfront metadata instead of activating it", async () => {
    for (
      const [name, veryfront] of [
        ["null-metadata", null],
        ["string-metadata", "explicit"],
        ["numeric-metadata", 1],
        ["array-metadata", [{ activation: "explicit" }]],
      ] as const
    ) {
      const dir = join(tmp, "extensions", name);
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
      await Deno.writeTextFile(
        join(dir, "deno.json"),
        JSON.stringify({ veryfront }),
      );

      await assertRejects(
        () => discoverProjectExtensions(tmp),
        TypeError,
        "invalid veryfront metadata; expected an object",
      );
      await Deno.remove(dir, { recursive: true });
    }
  });

  it("rejects oversized, invalid UTF-8, and symlinked project manifests", async () => {
    const makeEntry = async (name: string): Promise<string> => {
      const dir = join(tmp, "extensions", name);
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "index.ts"), "throw new Error('must not import');");
      return dir;
    };

    const oversized = await makeEntry("oversized");
    await Deno.writeTextFile(
      join(oversized, "deno.json"),
      "x".repeat(256 * 1_024 + 1),
    );
    await assertRejects(
      () => discoverProjectExtensions(tmp),
      Error,
      "exceeds 262144 bytes",
    );
    await Deno.remove(oversized, { recursive: true });

    const invalidUtf8 = await makeEntry("invalid-utf8");
    await Deno.writeFile(join(invalidUtf8, "deno.json"), new Uint8Array([0xc3, 0x28]));
    await assertRejects(
      () => discoverProjectExtensions(tmp),
      Error,
      "Failed to parse JSONC extension manifest",
    );
    await Deno.remove(invalidUtf8, { recursive: true });

    const symlinked = await makeEntry("symlinked");
    const manifestTarget = join(tmp, "manifest-target.json");
    await Deno.writeTextFile(
      manifestTarget,
      JSON.stringify({ veryfront: { extension: true, activation: "auto" } }),
    );
    await Deno.symlink(manifestTarget, join(symlinked, "deno.json"));
    await assertRejects(
      () => discoverProjectExtensions(tmp),
      Error,
      "symbolic link",
    );
  });
});

describe("discoverLocalExtensions()", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-disc-local-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("returns empty for missing dir", async () => {
    assertEquals(
      await discoverLocalExtensions(join(tmp, "does-not-exist")),
      [],
    );
  });

  it("finds *.extension.ts files", async () => {
    await Deno.writeTextFile(join(tmp, "foo.extension.ts"), "x");
    await Deno.writeTextFile(join(tmp, "bar.extension.ts"), "x");
    const found = await discoverLocalExtensions(tmp);
    assertEquals(found, [
      join(tmp, "bar.extension.ts"),
      join(tmp, "foo.extension.ts"),
    ]);
  });

  it("ignores non-matching files", async () => {
    await Deno.writeTextFile(join(tmp, "index.ts"), "x");
    await Deno.writeTextFile(join(tmp, "foo.test.ts"), "x");
    await Deno.writeTextFile(join(tmp, "my.extension.ts"), "x");
    const found = await discoverLocalExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0], join(tmp, "my.extension.ts"));
  });

  it("ignores directories even if they match the pattern", async () => {
    await Deno.mkdir(join(tmp, "weird.extension.ts"), { recursive: true });
    await Deno.writeTextFile(join(tmp, "real.extension.ts"), "x");
    const found = await discoverLocalExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0], join(tmp, "real.extension.ts"));
  });

  it("ignores symlinked local extensions", async () => {
    const explicit = join(tmp, "extensions", "explicit", "index.ts");
    await Deno.mkdir(join(tmp, "extensions", "explicit"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      explicit,
      "throw new Error('explicit target must not import');",
    );
    await Deno.symlink(explicit, join(tmp, "alias.extension.ts"));

    assertEquals(await discoverLocalExtensions(tmp), []);
  });
});
