/**
 * Extension discovery tests.
 *
 * Covers pure logic (parse/merge) and filesystem discovery against
 * real tempdir fixtures (scoped packages, symlinks, malformed package.json).
 *
 * @module extensions/discovery.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
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
      name: "@veryfront/ext-tailwind",
      veryfront: { extension: true, capabilities: [{ type: "css" }] },
    });
    assertEquals(result?.isExtension, true);
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
  const pkg: Record<string, unknown> = { name, version: "1.0.0" };
  if (veryfront) pkg.veryfront = veryfront;
  await Deno.writeTextFile(join(dir, "package.json"), JSON.stringify(pkg));
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
      join(tmp, "node_modules", "@veryfront", "ext-tailwind"),
      "@veryfront/ext-tailwind",
      { extension: true },
    );
    const found = await discoverPackageExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0]?.packageName, "@veryfront/ext-tailwind");
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
    assertEquals(found[0], join(tmp, "extensions", "my-ext", "src", "index.ts"));
  });

  it("falls back to index.ts when src/index.ts is absent", async () => {
    const dir = join(tmp, "extensions", "flat-ext");
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "export default {};");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0], join(tmp, "extensions", "flat-ext", "index.ts"));
  });

  it("prefers src/index.ts over index.ts", async () => {
    const dir = join(tmp, "extensions", "both");
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "index.ts"), "root");
    await Deno.writeTextFile(join(dir, "src", "index.ts"), "src");
    const found = await discoverProjectExtensions(tmp);
    assertEquals(found.length, 1);
    assertEquals(found[0], join(dir, "src", "index.ts"));
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
    assertEquals(found.length, 2);
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
});
