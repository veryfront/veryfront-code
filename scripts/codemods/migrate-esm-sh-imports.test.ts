import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { parse } from "npm:@babel/parser@7.29.2";
import {
  filterNeedsResolution,
  main,
  mergeEsmShPins,
  migrateEsmShImports,
  parseCliOptions,
  readProjectPackageJson,
} from "./migrate-esm-sh-imports.ts";

// ---------------------------------------------------------------------------
// CLI option parsing
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod accepts the deno task separator", () => {
  assertEquals(parseCliOptions(["--", "--dry-run", "./project"]), {
    projectDir: "./project",
    dryRun: true,
  });
});

Deno.test("esm-sh codemod rejects multiple positional arguments", () => {
  let threw = false;
  try {
    parseCliOptions(["./a", "./b"]);
  } catch {
    threw = true;
  }
  assert(threw);
});

// ---------------------------------------------------------------------------
// No-op cases
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod leaves unrelated imports unchanged", () => {
  const source = 'import { x } from "veryfront/ui";\nexport const v = x;\n';
  const result = migrateEsmShImports(source);
  assertEquals(result, {
    code: source,
    changed: false,
    rewrites: [],
    pins: {},
    needsResolution: [],
    conflicts: [],
  });
});

Deno.test("esm-sh codemod leaves non-esm.sh URLs untouched", () => {
  const source = 'import { x } from "https://cdn.skypack.dev/pkg@1.0.0";\n';
  const result = migrateEsmShImports(source);
  assertEquals(result.changed, false);
});

// ---------------------------------------------------------------------------
// Versioned URL → bare specifier + pin
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod rewrites a versioned esm.sh import to bare + pin", () => {
  const source = 'import { something } from "https://esm.sh/some-pkg@1.2.3";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "some-pkg"');
  assert(!result.code.includes("esm.sh"));
  assertEquals(result.pins, { "some-pkg": "1.2.3" });
  assertEquals(result.needsResolution, []);
  assertEquals(result.rewrites, [{ from: "https://esm.sh/some-pkg@1.2.3", to: "some-pkg" }]);
});

Deno.test("esm-sh codemod rewrites an export-from with a versioned URL", () => {
  const source = 'export { Foo } from "https://esm.sh/lib@2.0.0";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "lib"');
  assertEquals(result.pins, { lib: "2.0.0" });
});

Deno.test("esm-sh codemod rewrites an export-all with a versioned URL", () => {
  const source = 'export * from "https://esm.sh/lib@3.1.0";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "lib"');
  assertEquals(result.pins, { lib: "3.1.0" });
});

// ---------------------------------------------------------------------------
// Unversioned URL → bare specifier + needs-resolution
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod rewrites an unversioned URL to bare and records needs-resolution", () => {
  const source = 'import { something } from "https://esm.sh/some-pkg";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "some-pkg"');
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, ["some-pkg"]);
});

// ---------------------------------------------------------------------------
// Scoped package with subpath and query params
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod handles scoped package with subpath and query params", () => {
  const source =
    'import { Foo } from "https://esm.sh/@scope/pkg@2.0.0/dist/index?external=react&target=es2022";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "@scope/pkg/dist/index"');
  assert(!result.code.includes("?external"));
  assertEquals(result.pins, { "@scope/pkg": "2.0.0" });
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod handles scoped package without version and with subpath", () => {
  const source = 'import type { Bar } from "https://esm.sh/@scope/pkg/types";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "@scope/pkg/types"');
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, ["@scope/pkg"]);
});

Deno.test("esm-sh codemod handles esm.sh build-version prefix (v135/)", () => {
  const source = 'import { x } from "https://esm.sh/v135/zod@3.22.4";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "zod"');
  assertEquals(result.pins, { zod: "3.22.4" });
});

// ---------------------------------------------------------------------------
// Dynamic import()
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod rewrites a dynamic import() specifier", () => {
  const source = `const mod = await import("https://esm.sh/some-pkg@3.0.0");\n`;
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'import("some-pkg")');
  assert(!result.code.includes("esm.sh"));
  assertEquals(result.pins, { "some-pkg": "3.0.0" });
});

Deno.test("esm-sh codemod rewrites a dynamic import() nested inside a function", () => {
  const source = `
async function load() {
  const { foo } = await import("https://esm.sh/foo-lib@1.0.0");
  return foo;
}
`;
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'import("foo-lib")');
  assertEquals(result.pins, { "foo-lib": "1.0.0" });
});

// ---------------------------------------------------------------------------
// React specifiers skipped
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod skips react esm.sh imports", () => {
  const source = [
    'import React from "https://esm.sh/react@18.2.0";',
    'import ReactDOM from "https://esm.sh/react-dom@18.2.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertStringIncludes(result.code, "https://esm.sh/react@18.2.0");
  assertStringIncludes(result.code, "https://esm.sh/react-dom@18.2.0");
});

Deno.test("esm-sh codemod skips react while rewriting other packages", () => {
  const source = [
    'import React from "https://esm.sh/react@18.2.0";',
    'import { something } from "https://esm.sh/other-pkg@1.0.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, "https://esm.sh/react@18.2.0");
  assertStringIncludes(result.code, 'from "other-pkg"');
  assertEquals(result.pins, { "other-pkg": "1.0.0" });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod is idempotent: second run produces no changes", () => {
  const source = [
    'import { something } from "https://esm.sh/some-pkg@1.2.3";',
    'import { Foo } from "https://esm.sh/@scope/pkg@2.0.0/dist/index?target=es2022";',
    'export * from "https://esm.sh/lib@3.1.0";',
    "",
  ].join("\n");

  const first = migrateEsmShImports(source);
  assert(first.changed, "first run should produce changes");

  const second = migrateEsmShImports(first.code);
  assertEquals(second.changed, false, "second run must be a no-op");
  assertEquals(second.rewrites, []);
  assertEquals(second.pins, {});
  assertEquals(second.needsResolution, []);
});

Deno.test("esm-sh codemod is idempotent for dynamic imports", () => {
  const source = `const m = await import("https://esm.sh/pkg@4.0.0");\n`;

  const first = migrateEsmShImports(source);
  assert(first.changed);

  const second = migrateEsmShImports(first.code);
  assertEquals(second.changed, false);
});

// ---------------------------------------------------------------------------
// Conflict detection via mergeEsmShPins
// ---------------------------------------------------------------------------

Deno.test("mergeEsmShPins: existing exact pin beats URL-derived version", () => {
  const { updatedDeps, conflicts } = mergeEsmShPins(
    { "some-pkg": "1.0.0" },
    { "some-pkg": "2.0.0" },
  );

  // Existing wins — not overwritten.
  assertEquals(updatedDeps["some-pkg"], "1.0.0");
  assertEquals(conflicts, [{ pkg: "some-pkg", existing: "1.0.0", fromVersion: "2.0.0" }]);
});

Deno.test("mergeEsmShPins: existing range entry beats URL-derived exact version", () => {
  // Policy: never modify user-authored entries, whether exact or a range.
  const { updatedDeps, conflicts } = mergeEsmShPins(
    { "some-pkg": "^1.0.0" },
    { "some-pkg": "1.2.3" },
  );

  // Existing range wins — not overwritten.
  assertEquals(updatedDeps["some-pkg"], "^1.0.0");
  assertEquals(conflicts, [{ pkg: "some-pkg", existing: "^1.0.0", fromVersion: "1.2.3" }]);
});

Deno.test("mergeEsmShPins: new package not in existing deps is added", () => {
  const { updatedDeps, conflicts } = mergeEsmShPins(
    { existing: "0.1.0" },
    { "new-pkg": "3.0.0" },
  );

  assertEquals(updatedDeps["new-pkg"], "3.0.0");
  assertEquals(updatedDeps["existing"], "0.1.0");
  assertEquals(conflicts, []);
});

Deno.test("mergeEsmShPins: matching version in existing deps causes no conflict", () => {
  const { updatedDeps, conflicts } = mergeEsmShPins(
    { "some-pkg": "1.0.0" },
    { "some-pkg": "1.0.0" },
  );

  assertEquals(updatedDeps["some-pkg"], "1.0.0");
  assertEquals(conflicts, []);
});

Deno.test("mergeEsmShPins: empty new pins leaves existing deps unchanged", () => {
  const { updatedDeps, conflicts } = mergeEsmShPins({ "a": "1.0.0" }, {});
  assertEquals(updatedDeps, { "a": "1.0.0" });
  assertEquals(conflicts, []);
});

// ---------------------------------------------------------------------------
// Intra-file version conflicts
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod records an intra-file version conflict instead of silently dropping", () => {
  // Same package imported at two different versions in one file.
  // Both specifiers are rewritten to the same bare form; the first version wins
  // for the pin, and the second is recorded as a conflict.
  const source = [
    'import { a } from "https://esm.sh/pkg@1.0.0";',
    'import { b } from "https://esm.sh/pkg@2.0.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "pkg"');
  assertEquals(result.pins, { pkg: "1.0.0" }); // first version wins
  assertEquals(result.conflicts, [{ pkg: "pkg", existing: "1.0.0", fromVersion: "2.0.0" }]);
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod does not conflict when same package appears at same version twice", () => {
  const source = [
    'import { a } from "https://esm.sh/pkg@1.0.0";',
    'import { b } from "https://esm.sh/pkg@1.0.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertEquals(result.pins, { pkg: "1.0.0" });
  assertEquals(result.conflicts, []);
});

// ---------------------------------------------------------------------------
// Mixed scenarios
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod handles multiple imports in one file", () => {
  const source = [
    'import { a } from "https://esm.sh/pkg-a@1.0.0";',
    'import { b } from "https://esm.sh/pkg-b";',
    'import { c } from "https://esm.sh/@org/pkg-c@5.0.0/sub";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "pkg-a"');
  assertStringIncludes(result.code, 'from "pkg-b"');
  assertStringIncludes(result.code, 'from "@org/pkg-c/sub"');
  assertEquals(result.pins, { "pkg-a": "1.0.0", "@org/pkg-c": "5.0.0" });
  assertEquals(result.needsResolution, ["pkg-b"]);
  assertEquals(result.rewrites.length, 3);
});

Deno.test("esm-sh codemod keeps a static import URL untouched alongside a dynamic one", () => {
  const source = `
import { x } from "https://esm.sh/pkg@1.0.0";
const y = import("https://esm.sh/pkg@1.0.0");
`;
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assert(!result.code.includes("esm.sh"));
  assertEquals(result.rewrites.length, 2);
  assertEquals(result.pins, { pkg: "1.0.0" });
});

Deno.test("esm-sh codemod output is valid parseable TypeScript/JSX", () => {
  const source = [
    'import { a } from "https://esm.sh/pkg-a@1.0.0";',
    'import { Foo } from "https://esm.sh/@scope/pkg@2.0.0/dist?target=es2022";',
    'export * from "https://esm.sh/lib@3.0.0";',
    'const mod = await import("https://esm.sh/lazy@4.0.0");',
    "export const value = <Foo />;",
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  // Verify the output is still syntactically valid — parse must not throw.
  parse(result.code, { sourceType: "module", plugins: ["typescript", "jsx"] });
});

// ---------------------------------------------------------------------------
// readProjectPackageJson
// ---------------------------------------------------------------------------

Deno.test("readProjectPackageJson returns null parseError when file is absent", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await readProjectPackageJson(`${dir}/package.json`);
    assertEquals(result.parseError, null);
    assertEquals(result.existingDeps, {});
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readProjectPackageJson returns parseError for corrupt JSON, leaving file intact", async () => {
  const dir = await Deno.makeTempDir();
  const pkgPath = `${dir}/package.json`;
  const corrupt = "{ not valid json }";
  try {
    await Deno.writeTextFile(pkgPath, corrupt);
    const result = await readProjectPackageJson(pkgPath);

    assert(result.parseError !== null, "expected a parseError");
    assertStringIncludes(result.parseError!, "could not be parsed");
    // The file must remain untouched.
    assertEquals(await Deno.readTextFile(pkgPath), corrupt);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readProjectPackageJson returns parseError for unreadable file, not null", async () => {
  const dir = await Deno.makeTempDir();
  const pkgPath = `${dir}/package.json`;
  try {
    await Deno.writeTextFile(pkgPath, '{"dependencies":{}}');
    await Deno.chmod(pkgPath, 0o000);

    // Verify the chmod actually restricted access; on root-privilege environments
    // it may not, so skip rather than produce a false failure.
    let isUnreadable = false;
    try {
      const f = await Deno.open(pkgPath, { read: true });
      f.close();
    } catch {
      isUnreadable = true;
    }
    if (!isUnreadable) return;

    const result = await readProjectPackageJson(pkgPath);

    // Must NOT return null — a read error is not "file absent".
    assert(result.parseError !== null, "expected non-null parseError for unreadable file");
    assertStringIncludes(result.parseError!, "could not be read");
    assertEquals(result.existingDeps, {});
  } finally {
    // Restore permissions so the temp dir can be cleaned up.
    try {
      await Deno.chmod(pkgPath, 0o644);
    } catch { /* ignore */ }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readProjectPackageJson extracts dependencies from a valid file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { "some-lib": "1.0.0" } }),
    );
    const result = await readProjectPackageJson(`${dir}/package.json`);
    assertEquals(result.parseError, null);
    assertEquals(result.existingDeps, { "some-lib": "1.0.0" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// filterNeedsResolution
// ---------------------------------------------------------------------------

Deno.test("filterNeedsResolution removes packages that are already pinned", () => {
  const result = filterNeedsResolution(["pkg-a", "pkg-b", "pkg-c"], {
    "pkg-a": "1.0.0",
  });
  // pkg-a is pinned; only pkg-b and pkg-c need resolution.
  assertEquals(result, ["pkg-b", "pkg-c"]);
});

Deno.test("filterNeedsResolution returns all when no packages are pinned", () => {
  assertEquals(filterNeedsResolution(["b", "a"], {}), ["a", "b"]);
});

Deno.test("filterNeedsResolution: package pinned in one file not in needsResolution for another", () => {
  // Simulate: file-1 imports pkg@1.0.0 (versioned), file-2 imports pkg (unversioned).
  // After aggregation allPins has pkg, so pkg must NOT appear in needsResolution.
  const allNeedsResolution = new Set(["pkg", "other-pkg"]);
  const allPins = { pkg: "1.0.0" };
  const result = filterNeedsResolution(allNeedsResolution, allPins);
  assertEquals(result, ["other-pkg"]);
});

// ---------------------------------------------------------------------------
// main() integration — abort on corrupt/unreadable package.json
// ---------------------------------------------------------------------------

Deno.test(
  "corrupt package.json aborts run — source files are not modified",
  async () => {
    const dir = await Deno.makeTempDir();
    const srcPath = `${dir}/app.ts`;
    const pkgPath = `${dir}/package.json`;
    const original = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    try {
      await Deno.writeTextFile(srcPath, original);
      await Deno.writeTextFile(pkgPath, "{ not valid json }");

      let threw = false;
      try {
        await main(["--", dir]);
      } catch {
        threw = true;
      }

      assert(threw, "main() should have thrown due to corrupt package.json");
      // Source file must be untouched — rewriting it would discard the pin.
      assertEquals(await Deno.readTextFile(srcPath), original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "happy path: package.json written before source files, both updated",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${dir}/app.ts`,
        'import { x } from "https://esm.sh/lodash@4.17.21";\n',
      );
      await Deno.writeTextFile(
        `${dir}/package.json`,
        JSON.stringify({ name: "test", dependencies: {} }) + "\n",
      );

      await main(["--", dir]);

      // Source file should be rewritten to a bare specifier.
      const src = await Deno.readTextFile(`${dir}/app.ts`);
      assertStringIncludes(src, 'from "lodash"');
      assert(!src.includes("esm.sh"));

      // package.json should record the pin.
      const pkg = JSON.parse(await Deno.readTextFile(`${dir}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      assertEquals(pkg.dependencies?.lodash, "4.17.21");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
