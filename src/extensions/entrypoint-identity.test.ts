import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isAbsolute, join, resolve } from "#veryfront/compat/path";
import {
  bindExtensionEntrypoint,
  canonicalizeExtensionEntrypoint,
  captureExtensionOwner,
  revalidateBoundExtensionEntrypoint,
  selectPackageImportEntrypoint,
} from "./entrypoint-identity.ts";

describe("selectPackageImportEntrypoint()", () => {
  it("selects the standard root export forms", () => {
    assertEquals(
      selectPackageImportEntrypoint("ext-string", {
        name: "ext-string",
        exports: "./src/index.ts",
      }),
      "./src/index.ts",
    );
    assertEquals(
      selectPackageImportEntrypoint("@scope/ext-map", {
        name: "@scope/ext-map",
        exports: { ".": "./dist/index.js", "./feature": "./dist/feature.js" },
      }),
      "./dist/index.js",
    );
  });

  it("uses deno, import, and default conditional exports in that order", () => {
    assertEquals(
      selectPackageImportEntrypoint("ext-conditions", {
        name: "ext-conditions",
        exports: {
          default: "./default.js",
          import: "./import.js",
          deno: "./deno.ts",
        },
      }),
      "./deno.ts",
    );
    assertEquals(
      selectPackageImportEntrypoint("ext-import", {
        name: "ext-import",
        exports: { ".": { default: "./default.js", import: "./import.js" } },
      }),
      "./import.js",
    );
    assertEquals(
      selectPackageImportEntrypoint("ext-default", {
        name: "ext-default",
        exports: { node: "./node.js", default: "./default.js" },
      }),
      "./default.js",
    );
  });

  it("supports deterministic nested preferred conditions", () => {
    assertEquals(
      selectPackageImportEntrypoint("ext-nested", {
        name: "ext-nested",
        exports: {
          deno: {
            import: "./deno-import.ts",
            default: "./deno-default.ts",
          },
          default: "./default.js",
        },
      }),
      "./deno-import.ts",
    );
  });

  it("falls back through module, main, then a deterministic index", () => {
    assertEquals(
      selectPackageImportEntrypoint("ext-module", {
        name: "ext-module",
        module: "dist/module.js",
        main: "dist/main.cjs",
      }),
      "dist/module.js",
    );
    assertEquals(
      selectPackageImportEntrypoint("ext-main", {
        name: "ext-main",
        main: "./dist/main.cjs",
      }),
      "./dist/main.cjs",
    );
    assertEquals(
      selectPackageImportEntrypoint("ext-index", { name: "ext-index" }),
      "./index.js",
    );
  });

  it("requires the manifest name to match the discovered lexical package", () => {
    assertThrows(
      () =>
        selectPackageImportEntrypoint("@scope/discovered", {
          name: "@scope/substituted",
          exports: "./index.js",
        }),
      Error,
      "does not match discovered package",
    );
    assertThrows(
      () =>
        selectPackageImportEntrypoint(
          "ext-inherited",
          Object.create({
            name: "ext-inherited",
            exports: "./index.js",
          }),
        ),
      Error,
      "must be an own string data property",
    );
  });

  it("never invokes manifest or conditional export accessors", () => {
    let manifestGetterCalls = 0;
    const manifest = { exports: "./index.js" } as Record<string, unknown>;
    Object.defineProperty(manifest, "name", {
      enumerable: true,
      get() {
        manifestGetterCalls++;
        return "ext-accessor";
      },
    });
    assertThrows(
      () => selectPackageImportEntrypoint("ext-accessor", manifest),
      Error,
      "must be an own data property",
    );
    assertEquals(manifestGetterCalls, 0);

    let conditionGetterCalls = 0;
    const conditions: Record<string, unknown> = { default: "./default.js" };
    Object.defineProperty(conditions, "deno", {
      enumerable: true,
      get() {
        conditionGetterCalls++;
        return "./deno.ts";
      },
    });
    assertThrows(
      () =>
        selectPackageImportEntrypoint("ext-condition-accessor", {
          name: "ext-condition-accessor",
          exports: conditions,
        }),
      Error,
      "must be an own data property",
    );
    assertEquals(conditionGetterCalls, 0);
  });

  it("rejects arrays, pattern-only maps, and unsupported conditions", () => {
    const invalidExports: unknown[] = [
      ["./first.js", "./second.js"],
      { ".": ["./first.js", "./second.js"] },
      { "./*": "./dist/*.js" },
      { "./feature": "./dist/feature.js" },
      { node: "./node.js", browser: "./browser.js" },
      { ".": "./index.js", default: "./default.js" },
    ];

    for (const exportsValue of invalidExports) {
      assertThrows(
        () =>
          selectPackageImportEntrypoint("ext-invalid-exports", {
            name: "ext-invalid-exports",
            exports: exportsValue,
          }),
        Error,
      );
    }
  });

  it("rejects absolute, URL, traversal, alias, and pattern targets", () => {
    const invalidTargets = [
      "/tmp/extension.ts",
      "C:/extensions/extension.ts",
      "file:///tmp/extension.ts",
      "https://example.com/extension.ts",
      "./../outside.ts",
      "./src/../../outside.ts",
      "#extension-entry",
      "./src/*.ts",
    ];

    for (const target of invalidTargets) {
      assertThrows(
        () =>
          selectPackageImportEntrypoint("ext-invalid-target", {
            name: "ext-invalid-target",
            exports: target,
          }),
        Error,
      );
    }
  });

  it("does not bypass an invalid higher-precedence field", () => {
    assertThrows(
      () =>
        selectPackageImportEntrypoint("ext-invalid-module", {
          name: "ext-invalid-module",
          module: "../outside.js",
          main: "./safe.js",
        }),
      Error,
      "must not traverse",
    );
  });
});

describe("canonicalizeExtensionEntrypoint()", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await Deno.makeTempDir({ prefix: "vf-entrypoint-identity-" });
  });

  afterEach(async () => {
    await Deno.remove(temporaryDirectory, { recursive: true });
  });

  it("returns the canonical absolute regular-file target", async () => {
    const owner = join(temporaryDirectory, "extension");
    const entrypoint = join(owner, "src", "index.ts");
    await Deno.mkdir(join(owner, "src"), { recursive: true });
    await Deno.writeTextFile(entrypoint, "export default {};\n");

    const canonical = await canonicalizeExtensionEntrypoint(owner, "./src/index.ts");

    assertEquals(canonical, await Deno.realPath(entrypoint));
    assertEquals(isAbsolute(canonical), true);
    assertEquals(
      await canonicalizeExtensionEntrypoint(owner, entrypoint),
      canonical,
    );
  });

  it("accepts a contained symlink but captures its target identity", async () => {
    const owner = join(temporaryDirectory, "extension");
    const first = join(owner, "first.ts");
    const second = join(owner, "second.ts");
    const link = join(owner, "index.ts");
    await Deno.mkdir(owner, { recursive: true });
    await Deno.writeTextFile(first, "export const value = 1;\n");
    await Deno.writeTextFile(second, "export const value = 2;\n");
    await Deno.symlink(first, link);

    const captured = await canonicalizeExtensionEntrypoint(owner, "./index.ts");
    await Deno.remove(link);
    await Deno.symlink(second, link);

    assertEquals(captured, await Deno.realPath(first));
    assertEquals(captured === await Deno.realPath(link), false);
  });

  it("supports a symlinked package owner while returning its physical entrypoint", async () => {
    const physicalOwner = join(temporaryDirectory, ".store", "ext-pkg");
    const lexicalOwner = join(temporaryDirectory, "node_modules", "ext-pkg");
    const entrypoint = join(physicalOwner, "index.ts");
    await Deno.mkdir(physicalOwner, { recursive: true });
    await Deno.mkdir(join(temporaryDirectory, "node_modules"), { recursive: true });
    await Deno.writeTextFile(entrypoint, "export default {};\n");
    await Deno.symlink(physicalOwner, lexicalOwner);

    assertEquals(
      await canonicalizeExtensionEntrypoint(lexicalOwner, "./index.ts"),
      await Deno.realPath(entrypoint),
    );
  });

  it("rejects a direct symlink that escapes the owning directory", async () => {
    const owner = join(temporaryDirectory, "extension");
    const outside = join(temporaryDirectory, "outside.ts");
    const link = join(owner, "index.ts");
    await Deno.mkdir(owner, { recursive: true });
    await Deno.writeTextFile(outside, "export default {};\n");
    await Deno.symlink(outside, link);

    await assertRejects(
      () => canonicalizeExtensionEntrypoint(owner, "./index.ts"),
      Error,
      "physically outside",
    );
  });

  it("rejects an intermediate symlink that escapes the owning directory", async () => {
    const owner = join(temporaryDirectory, "extension");
    const outsideDirectory = join(temporaryDirectory, "outside");
    await Deno.mkdir(owner, { recursive: true });
    await Deno.mkdir(outsideDirectory, { recursive: true });
    await Deno.writeTextFile(join(outsideDirectory, "index.ts"), "export default {};\n");
    await Deno.symlink(outsideDirectory, join(owner, "linked-directory"));

    await assertRejects(
      () =>
        canonicalizeExtensionEntrypoint(
          owner,
          "./linked-directory/index.ts",
        ),
      Error,
      "physically outside",
    );
  });

  it("rejects traversal and prefix-sibling targets lexically", async () => {
    const owner = join(temporaryDirectory, "extension");
    const sibling = join(temporaryDirectory, "extension-evil");
    await Deno.mkdir(owner, { recursive: true });
    await Deno.mkdir(sibling, { recursive: true });
    await Deno.writeTextFile(join(sibling, "index.ts"), "export default {};\n");

    await assertRejects(
      () => canonicalizeExtensionEntrypoint(owner, "../extension-evil/index.ts"),
      Error,
      "lexically outside",
    );
    await assertRejects(
      () => canonicalizeExtensionEntrypoint(owner, join(sibling, "index.ts")),
      Error,
      "lexically outside",
    );
  });

  it("rejects directories and other non-regular filesystem entries", async () => {
    const owner = join(temporaryDirectory, "extension");
    const directoryTarget = join(owner, "entrypoint");
    await Deno.mkdir(directoryTarget, { recursive: true });

    await assertRejects(
      () => canonicalizeExtensionEntrypoint(owner, directoryTarget),
      Error,
      "not a regular file",
    );

    const virtualOwner = resolve(temporaryDirectory, "virtual-owner");
    const fifoLikeTarget = resolve(virtualOwner, "entrypoint.pipe");
    await assertRejects(
      () =>
        canonicalizeExtensionEntrypoint(
          virtualOwner,
          fifoLikeTarget,
          {
            realPath: (path) => Promise.resolve(path),
            stat: (path) =>
              Promise.resolve({
                isDirectory: path === virtualOwner,
                isFile: false,
                dev: 1,
                ino: path === virtualOwner ? 1 : 2,
              }),
          },
        ),
      Error,
      "not a regular file",
    );
  });

  it("returns an absolute path that cannot be reinterpreted as an import-map alias", async () => {
    const owner = join(temporaryDirectory, "extension");
    const entrypoint = join(owner, "entrypoint.ts");
    await Deno.mkdir(owner, { recursive: true });
    await Deno.writeTextFile(entrypoint, "export default {};\n");

    const captured = await canonicalizeExtensionEntrypoint(owner, "./entrypoint.ts");

    assertEquals(captured.startsWith("#"), false);
    assertEquals(isAbsolute(captured), true);
    assertEquals(captured, await Deno.realPath(entrypoint));
  });
});

describe("bound extension entrypoints", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await Deno.makeTempDir({ prefix: "vf-bound-entrypoint-" });
  });

  afterEach(async () => {
    await Deno.remove(temporaryDirectory, { recursive: true });
  });

  it("rejects a package owner symlink retargeted after owner capture", async () => {
    const firstOwner = join(temporaryDirectory, "store", "first");
    const secondOwner = join(temporaryDirectory, "store", "second");
    const lexicalOwner = join(temporaryDirectory, "node_modules", "ext-race");
    await Deno.mkdir(firstOwner, { recursive: true });
    await Deno.mkdir(secondOwner, { recursive: true });
    await Deno.mkdir(join(temporaryDirectory, "node_modules"), { recursive: true });
    await Deno.writeTextFile(join(firstOwner, "index.js"), "export default 'first';\n");
    await Deno.writeTextFile(join(secondOwner, "index.js"), "export default 'second';\n");
    await Deno.symlink(firstOwner, lexicalOwner);

    const owner = await captureExtensionOwner(lexicalOwner);
    await Deno.remove(lexicalOwner);
    await Deno.symlink(secondOwner, lexicalOwner);

    await assertRejects(
      () => bindExtensionEntrypoint(owner, "./index.js"),
      Error,
      "mapping changed",
    );
  });

  it("rejects a project owner replaced after capture", async () => {
    const extensionsRoot = join(temporaryDirectory, "extensions");
    const ownerPath = join(extensionsRoot, "ext-race");
    const displacedOwner = join(temporaryDirectory, "displaced-owner");
    await Deno.mkdir(ownerPath, { recursive: true });
    await Deno.writeTextFile(join(ownerPath, "index.ts"), "export default 'first';\n");

    const parent = await captureExtensionOwner(extensionsRoot);
    const owner = await captureExtensionOwner(ownerPath, { parent });
    await Deno.rename(ownerPath, displacedOwner);
    await Deno.mkdir(ownerPath, { recursive: true });
    await Deno.writeTextFile(join(ownerPath, "index.ts"), "export default 'second';\n");

    await assertRejects(
      () => bindExtensionEntrypoint(owner, "./index.ts"),
      Error,
      "identity changed",
    );
  });

  it("requires project owners to remain direct children of the captured extensions root", async () => {
    const extensionsRoot = join(temporaryDirectory, "extensions");
    const nestedOwner = join(extensionsRoot, "group", "ext-nested");
    await Deno.mkdir(nestedOwner, { recursive: true });

    const parent = await captureExtensionOwner(extensionsRoot);
    await assertRejects(
      () => captureExtensionOwner(nestedOwner, { parent }),
      Error,
      "direct child",
    );
  });

  it("fails deterministically for unavailable or invalid filesystem identities", async () => {
    const ownerPath = resolve(temporaryDirectory, "identity-unavailable");
    for (
      const identity of [
        { dev: null, ino: null },
        { dev: -1, ino: 1 },
        { dev: 1n, ino: -1n },
      ] as const
    ) {
      await assertRejects(
        () =>
          captureExtensionOwner(ownerPath, {
            operations: {
              realPath: (path) => Promise.resolve(path),
              stat: () =>
                Promise.resolve({
                  isDirectory: true,
                  isFile: false,
                  ...identity,
                }),
            },
          }),
        Error,
        "no stable filesystem identity",
      );
    }
  });

  it("detects target replacement before import revalidation", async () => {
    const ownerPath = join(temporaryDirectory, "extension");
    const targetPath = join(ownerPath, "index.ts");
    await Deno.mkdir(ownerPath, { recursive: true });
    await Deno.writeTextFile(targetPath, "export default 'first';\n");

    const owner = await captureExtensionOwner(ownerPath);
    const binding = await bindExtensionEntrypoint(owner, "./index.ts");
    await Deno.rename(targetPath, join(ownerPath, "first.ts"));
    await Deno.writeTextFile(targetPath, "export default 'second';\n");

    await assertRejects(
      () => revalidateBoundExtensionEntrypoint(binding),
      Error,
      "target identity changed",
    );
  });
});
