import { assertEquals, assertRejects } from "#std/assert";
import { dirname, join } from "#std/path";
import {
  assertSupportedExtensionImportMap,
  createExtensionManifestWorkspaceBudget,
  discoverExtensionManifestPaths,
  ExtensionManifestReadError,
  MAX_EXTENSION_DIRECTORY_ENTRIES,
  MAX_EXTENSION_MANIFEST_BYTES,
  MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES,
  MAX_EXTENSION_MANIFEST_WORKSPACE_FILES,
  readExtensionManifest,
  resolveExtensionManifestEntry,
} from "./extension-manifest-reader.ts";

async function withManifestFixture(
  run: (root: string, manifestPath: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir();
  const manifestPath = "extensions/ext-static/deno.json";
  try {
    await Deno.mkdir(dirname(join(root, manifestPath)), { recursive: true });
    await run(root, manifestPath);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("readExtensionManifest accepts the exact byte limit", async () => {
  await withManifestFixture(async (root, manifestPath) => {
    const prefix = '{"name":"ok"}';
    await Deno.writeTextFile(
      join(root, manifestPath),
      prefix + " ".repeat(MAX_EXTENSION_MANIFEST_BYTES - prefix.length),
    );
    assertEquals(await readExtensionManifest(root, manifestPath), {
      name: "ok",
    });
  });
});

Deno.test("readExtensionManifest rejects one byte over the limit", async () => {
  await withManifestFixture(async (root, manifestPath) => {
    await Deno.writeTextFile(
      join(root, manifestPath),
      " ".repeat(MAX_EXTENSION_MANIFEST_BYTES + 1),
    );
    const error = await assertRejects(
      () => readExtensionManifest(root, manifestPath),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-too-large");
  });
});

Deno.test("readExtensionManifest enforces aggregate workspace budgets", async () => {
  await withManifestFixture(async (root, manifestPath) => {
    await Deno.writeTextFile(join(root, manifestPath), "{}");
    const budget = createExtensionManifestWorkspaceBudget();
    budget.manifestBytes = MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES - 2;
    assertEquals(await readExtensionManifest(root, manifestPath, budget), {});
    assertEquals(budget.manifestBytes, MAX_EXTENSION_MANIFEST_WORKSPACE_BYTES);

    let error = await assertRejects(
      () => readExtensionManifest(root, manifestPath, budget),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-workspace-limit");

    const fileBudget = createExtensionManifestWorkspaceBudget();
    fileBudget.manifestFiles = MAX_EXTENSION_MANIFEST_WORKSPACE_FILES;
    error = await assertRejects(
      () => readExtensionManifest(root, manifestPath, fileBudget),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-workspace-limit");
  });
});

Deno.test("readExtensionManifest rejects malformed JSON and UTF-8", async () => {
  await withManifestFixture(async (root, manifestPath) => {
    await Deno.writeTextFile(join(root, manifestPath), "{");
    let error = await assertRejects(
      () => readExtensionManifest(root, manifestPath),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-invalid-json");

    await Deno.writeFile(join(root, manifestPath), new Uint8Array([0xff]));
    error = await assertRejects(
      () => readExtensionManifest(root, manifestPath),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-invalid-utf8");
  });
});

Deno.test("readExtensionManifest rejects symlinks, missing files, and escapes", async () => {
  await withManifestFixture(async (root, manifestPath) => {
    const target = join(root, "target.json");
    await Deno.writeTextFile(target, "{}");
    await Deno.symlink(target, join(root, manifestPath));
    let error = await assertRejects(
      () => readExtensionManifest(root, manifestPath),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-symlink");

    await Deno.remove(join(root, manifestPath));
    error = await assertRejects(
      () => readExtensionManifest(root, manifestPath),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "manifest-not-found");

    error = await assertRejects(
      () => readExtensionManifest(root, "../outside.json"),
      ExtensionManifestReadError,
    );
    assertEquals(error.code, "invalid-manifest-path");
  });
});

Deno.test("resolveExtensionManifestEntry accepts only supported root export forms", () => {
  assertEquals(
    resolveExtensionManifestEntry("extensions/ext-a/deno.json", {
      exports: "./src/index.ts",
    }),
    "extensions/ext-a/src/index.ts",
  );
  assertEquals(
    resolveExtensionManifestEntry("extensions/ext-a/deno.json", {
      exports: { ".": "./src/runtime.ts", "./subpath": "./src/subpath.ts" },
    }),
    "extensions/ext-a/src/runtime.ts",
  );
  for (
    const exportsValue of [
      undefined,
      null,
      [],
      {},
      { ".": {} },
      "../x.ts",
      "./%2e%2e/runtime.ts",
      "./src\\runtime.ts",
      "./runtime.ts?decoy=.ts",
      "./runtime.ts#decoy.ts",
      "./runtime\u0000.ts",
    ]
  ) {
    const error = (() => {
      try {
        resolveExtensionManifestEntry("extensions/ext-a/deno.json", {
          exports: exportsValue,
        });
      } catch (caught) {
        return caught;
      }
    })();
    assertEquals(error instanceof ExtensionManifestReadError, true);
    assertEquals(
      (error as ExtensionManifestReadError).code,
      "manifest-invalid-entry",
    );
  }
});

Deno.test("assertSupportedExtensionImportMap rejects unsupported remapping", () => {
  assertSupportedExtensionImportMap("extensions/ext-a/deno.json", {});
  assertSupportedExtensionImportMap("extensions/ext-a/deno.json", {
    scopes: {},
    imports: { "vf/contracts": "./src/contracts.ts" },
  });
  for (
    const manifest of [
      { scopes: { "./src/": {} } },
      { importMap: "./import-map.json" },
      { imports: { "./src/a.ts": "./src/b.ts" } },
      { imports: { "vf/": "./src" } },
      { imports: { "vf": "./%2e%2e/runtime.ts" } },
      { imports: { "vf": "./src\\runtime.ts" } },
      { imports: { "vf": "./runtime.ts?decoy=.ts" } },
      { imports: { "vf": "./runtime.ts#decoy.ts" } },
      { imports: { "vf\\runtime": "./src/runtime.ts" } },
    ]
  ) {
    const error = (() => {
      try {
        assertSupportedExtensionImportMap(
          "extensions/ext-a/deno.json",
          manifest,
        );
      } catch (caught) {
        return caught;
      }
    })();
    assertEquals(error instanceof ExtensionManifestReadError, true);
    assertEquals(
      (error as ExtensionManifestReadError).code,
      "manifest-invalid-import-map",
    );
  }
});

Deno.test("discoverExtensionManifestPaths rejects ext-* symlinks and files", async () => {
  const root = await Deno.makeTempDir();
  try {
    const extensionsDir = join(root, "extensions");
    await Deno.mkdir(join(extensionsDir, "ext-valid"), { recursive: true });
    await Deno.writeTextFile(join(extensionsDir, "ext-file"), "not a dir");
    await Deno.mkdir(join(extensionsDir, "target"));
    await Deno.symlink(
      join(extensionsDir, "target"),
      join(extensionsDir, "ext-link"),
    );

    assertEquals(await discoverExtensionManifestPaths(root), {
      manifestPaths: ["extensions/ext-valid/deno.json"],
      issues: [
        {
          manifestPath: "extensions/ext-file/deno.json",
          detail:
            "[extension-entry-not-directory] extension entry must be a directory",
        },
        {
          manifestPath: "extensions/ext-link/deno.json",
          detail:
            "[extension-entry-symlink] extension entry must not be a symlink",
        },
      ],
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("discoverExtensionManifestPaths bounds directory enumeration", async () => {
  const root = await Deno.makeTempDir();
  try {
    const extensionsDir = join(root, "extensions");
    await Deno.mkdir(extensionsDir);
    for (let index = 0; index <= MAX_EXTENSION_DIRECTORY_ENTRIES; index += 1) {
      await Deno.writeTextFile(join(extensionsDir, `entry-${index}`), "");
    }
    const result = await discoverExtensionManifestPaths(root);
    assertEquals(result.manifestPaths, []);
    assertEquals(result.issues, [{
      manifestPath: "extensions",
      detail:
        `[extension-entry-limit] extensions directory exceeds ${MAX_EXTENSION_DIRECTORY_ENTRIES} entries`,
    }]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
