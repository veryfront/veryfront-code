import { assert, assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { makeTempDir } from "#veryfront/testing/deno-compat";
import { parse } from "npm:@babel/parser@7.29.2";
import { stat as statNativeFile } from "node:fs/promises";
import {
  assertPathInsideProject,
  filterNeedsResolution,
  main,
  mergeEsmShPins,
  migrateEsmShImports,
  parseCliOptions,
  readProjectPackageJson,
  writeTextFileInsideProject,
} from "./migrate-esm-sh-imports.ts";

// ---------------------------------------------------------------------------
// CLI option parsing
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod accepts the deno task separator", () => {
  assertEquals(parseCliOptions(["--", "--dry-run", "./project"]), {
    projectDir: "./project",
    dryRun: true,
    failOnConflict: false,
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

Deno.test("esm-sh codemod does not request resolution when the same file provides a pin", () => {
  const source = [
    'import { a } from "https://esm.sh/some-pkg";',
    'import { b } from "https://esm.sh/some-pkg@1.2.3/subpath";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.pins, { "some-pkg": "1.2.3" });
  assertEquals(result.needsResolution, []);
});

// ---------------------------------------------------------------------------
// Scoped package with subpath
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod handles a scoped package with a subpath", () => {
  const source = 'import { Foo } from "https://esm.sh/@scope/pkg@2.0.0/dist/index";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "@scope/pkg/dist/index"');
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

Deno.test("esm-sh codemod handles esm.sh stable prefix", () => {
  const source = 'import { x } from "https://esm.sh/stable/zod@3.22.4/lib/index.js";\n';
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "zod/lib/index.js"');
  assertEquals(result.pins, { zod: "3.22.4" });
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod skips stable-prefixed react imports", () => {
  const source = 'import React from "https://esm.sh/stable/react@18.3.1/index.js";\n';
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertEquals(result.code, source);
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, []);
});

// ---------------------------------------------------------------------------
// Unsafe URL forms
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod leaves behavior-changing query options untouched", () => {
  const source = [
    'import worker from "https://esm.sh/pkg@1.2.3?worker";',
    'import raw from "https://esm.sh/pkg@1.2.3?raw";',
    'import aliased from "https://esm.sh/pkg@1.2.3?alias=react:preact/compat";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertEquals(result.code, source);
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod leaves non-npm esm.sh registries untouched", () => {
  const source = [
    'import gh from "https://esm.sh/gh/owner/repository@1.2.3";',
    'import github from "https://esm.sh/github.com/owner/repository@1.2.3";',
    'import jsr from "https://esm.sh/jsr/@scope/pkg@1.2.3";',
    'import preview from "https://esm.sh/pr/tinylibs/tinybench/tinybench@a832a55";',
    'import previewAlias from "https://esm.sh/pkg.pr.new/tinylibs/tinybench@a832a55";',
    'import nodeShim from "https://esm.sh/node/fs.mjs";',
    'import embedded from "https://esm.sh/embed/tsx.ts";',
    'import tsx from "https://esm.sh/tsx";',
    'import run from "https://esm.sh/run";',
    'import installer from "https://esm.sh/install";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertEquals(result.code, source);
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod lets Babel safely quote rewritten subpaths", () => {
  const source = String.raw`import value from 'https://esm.sh/pkg@1.2.3/foo\'bar';` + "\n";
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, `"pkg/foo'bar"`);
  assertEquals(result.pins, { pkg: "1.2.3" });
  // The transformed source must remain valid JavaScript.
  parse(result.code, { sourceType: "module" });
});

Deno.test("esm-sh codemod leaves non-canonical npm subpaths untouched", () => {
  const source = [
    'import parent from "https://esm.sh/pkg@1.2.3/../evil";',
    'import current from "https://esm.sh/pkg@1.2.3/./feature";',
    'import empty from "https://esm.sh/pkg@1.2.3/feature//nested";',
    'import colon from "https://esm.sh/pkg@1.2.3/feature:mode";',
    'import backslash from "https://esm.sh/pkg@1.2.3\\\\feature";',
    'import control from "https://esm.sh/pkg@1.2.3/feature\\u0001";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertEquals(result.code, source);
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod leaves tags, partial versions, and ranges untouched", () => {
  const source = [
    'import tagged from "https://esm.sh/pkg@next";',
    'import major from "https://esm.sh/pkg@4";',
    'import minor from "https://esm.sh/pkg@4.2";',
    'import ranged from "https://esm.sh/pkg@^4.2.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assertEquals(result.changed, false);
  assertEquals(result.code, source);
  assertEquals(result.pins, {});
  assertEquals(result.needsResolution, []);
});

Deno.test("esm-sh codemod accepts exact prerelease and build SemVer pins", () => {
  const source = [
    'import prerelease from "https://esm.sh/pkg-a@1.2.3-rc.1";',
    'import build from "https://esm.sh/pkg-b@2.0.0+build.7";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertEquals(result.pins, {
    "pkg-a": "1.2.3-rc.1",
    "pkg-b": "2.0.0+build.7",
  });
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

  // Existing wins, not overwritten.
  assertEquals(updatedDeps["some-pkg"], "1.0.0");
  assertEquals(conflicts, [{ pkg: "some-pkg", existing: "1.0.0", fromVersion: "2.0.0" }]);
});

Deno.test("mergeEsmShPins: existing range entry beats URL-derived exact version", () => {
  // Policy: never modify user-authored entries, whether exact or a range.
  const { updatedDeps, conflicts } = mergeEsmShPins(
    { "some-pkg": "^1.0.0" },
    { "some-pkg": "1.2.3" },
  );

  // Existing range wins, not overwritten.
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

Deno.test("mergeEsmShPins: new pins are inserted in sorted key order", () => {
  const { updatedDeps } = mergeEsmShPins(
    { "zod": "3.23.8", "axios": "1.7.0" },
    { "lodash": "4.17.21", "chalk": "5.3.0" },
  );
  assertEquals(Object.keys(updatedDeps), ["axios", "chalk", "lodash", "zod"]);
});

Deno.test("mergeEsmShPins: no insertion preserves the existing key order", () => {
  // An idempotent re-run must not rewrite package.json just to re-order keys.
  const { updatedDeps } = mergeEsmShPins(
    { "zod": "3.23.8", "axios": "1.7.0" },
    { "zod": "3.23.8" },
  );
  assertEquals(Object.keys(updatedDeps), ["zod", "axios"]);
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
  assertEquals(result.conflicts, [{
    pkg: "pkg",
    existing: "1.0.0",
    fromVersion: "2.0.0",
    specifier: "https://esm.sh/pkg@2.0.0",
  }]);
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
  // Verify the output is still syntactically valid: parse must not throw.
  parse(result.code, { sourceType: "module", plugins: ["typescript", "jsx"] });
});

// ---------------------------------------------------------------------------
// readProjectPackageJson
// ---------------------------------------------------------------------------

Deno.test("readProjectPackageJson returns null parseError when file is absent", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await readProjectPackageJson(`${dir}/package.json`, await Deno.realPath(dir));
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

    // Must NOT return null. A read error is not "file absent".
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

Deno.test("manifest writes remain bound to the file identity that was read", async () => {
  const project = await makeTempDir();
  const pkgPath = `${project}/package.json`;
  try {
    await Deno.writeTextFile(pkgPath, '{"dependencies":{}}\n');
    const projectRoot = await Deno.realPath(project);
    const result = await readProjectPackageJson(pkgPath, projectRoot);
    assert(result.fileIdentity, "a guarded manifest read must return its file identity");

    await Deno.writeTextFile(`${project}/replacement.json`, '{"name":"replacement"}\n');
    await Deno.rename(`${project}/replacement.json`, pkgPath);

    const error = await assertRejects(
      () =>
        writeTextFileInsideProject(pkgPath, projectRoot, '{"name":"codemod"}\n', {
          expectedIdentity: result.fileIdentity,
        }),
      Error,
    );
    assertStringIncludes(error.message, "changed after being read");
    assertEquals(await Deno.readTextFile(pkgPath), '{"name":"replacement"}\n');
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("guarded manifest read errors do not expose resolved paths", async () => {
  const project = await makeTempDir();
  const outside = await makeTempDir();
  const pkgPath = `${project}/package.json`;
  try {
    await Deno.writeTextFile(`${outside}/victim.json`, "{}\n");
    await Deno.symlink(`${outside}/victim.json`, pkgPath);

    const result = await readProjectPackageJson(pkgPath, await Deno.realPath(project));

    assert(result.parseError);
    assertStringIncludes(result.parseError, "could not be read safely");
    assert(!result.parseError.includes(project));
    assert(!result.parseError.includes(outside));
  } finally {
    await Deno.remove(project, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("readProjectPackageJson collects declarations from other dependency fields", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({
        dependencies: { "some-lib": "1.0.0" },
        devDependencies: { "dev-lib": "2.0.0" },
        peerDependencies: { "peer-lib": "^3.0.0" },
      }),
    );
    const result = await readProjectPackageJson(`${dir}/package.json`);
    assertEquals(result.parseError, null);
    assertEquals(result.otherFieldDeps["dev-lib"], {
      field: "devDependencies",
      version: "2.0.0",
    });
    assertEquals(result.otherFieldDeps["peer-lib"], {
      field: "peerDependencies",
      version: "^3.0.0",
    });
    // `dependencies` entries belong to existingDeps, not otherFieldDeps.
    assertEquals(Object.hasOwn(result.otherFieldDeps, "some-lib"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readProjectPackageJson returns parseError for malformed devDependencies", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: {}, devDependencies: [] }),
    );
    const result = await readProjectPackageJson(`${dir}/package.json`);
    assert(result.parseError !== null, "malformed devDependencies must abort");
    assertStringIncludes(result.parseError, "devDependencies");
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
// main() integration: abort on corrupt/unreadable package.json
// ---------------------------------------------------------------------------

Deno.test("source parse errors identify the file that could not be migrated", async () => {
  const dir = await Deno.makeTempDir();
  const srcPath = `${dir}/broken.ts`;
  try {
    await Deno.writeTextFile(srcPath, "import {");
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({ name: "test", dependencies: {} }) + "\n",
    );

    let thrown: unknown;
    try {
      await main(["--", dir]);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error, "main() should surface the parse failure");
    assertStringIncludes(thrown.message, srcPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(
  "corrupt package.json aborts run: source files are not modified",
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
      // Source file must be untouched. Rewriting it would discard the pin.
      assertEquals(await Deno.readTextFile(srcPath), original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "invalid package.json shapes abort without modifying source or manifest",
  async (testContext) => {
    const cases = [
      { name: "array root", manifest: "[]\n" },
      { name: "null root", manifest: "null\n" },
      { name: "array dependencies", manifest: '{"dependencies":[]}\n' },
      {
        name: "non-string dependency value",
        manifest: '{"dependencies":{"lodash":{"version":"4.17.21"}}}\n',
      },
    ];

    for (const testCase of cases) {
      await testContext.step(testCase.name, async () => {
        const dir = await Deno.makeTempDir();
        const source = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
        try {
          await Deno.writeTextFile(`${dir}/app.ts`, source);
          await Deno.writeTextFile(`${dir}/package.json`, testCase.manifest);

          let thrown: unknown;
          try {
            await main(["--", dir]);
          } catch (error) {
            thrown = error;
          }

          assert(thrown instanceof Error, "main() should reject an invalid package.json shape");
          assertStringIncludes(thrown.message, "package.json");
          assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
          assertEquals(await Deno.readTextFile(`${dir}/package.json`), testCase.manifest);
        } finally {
          await Deno.remove(dir, { recursive: true });
        }
      });
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

// ---------------------------------------------------------------------------
// main() integration: symlinked paths must never be followed
// ---------------------------------------------------------------------------

Deno.test(
  "package.json symlink pointing outside the project aborts without writing through the link",
  async () => {
    const project = await makeTempDir();
    const outside = await makeTempDir();
    const source = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    const outsideContent = JSON.stringify({ name: "victim", dependencies: {} }) + "\n";
    try {
      await Deno.writeTextFile(`${project}/app.ts`, source);
      await Deno.writeTextFile(`${outside}/victim.json`, outsideContent);
      await Deno.symlink(`${outside}/victim.json`, `${project}/package.json`);

      let thrown: unknown;
      try {
        await main(["--", project]);
      } catch (error) {
        thrown = error;
      }

      assert(thrown instanceof Error, "main() should refuse a symlinked package.json");
      assertStringIncludes(thrown.message, "symlink");
      // The file outside the project must be untouched, and no source file may
      // have been rewritten without a recorded pin.
      assertEquals(await Deno.readTextFile(`${outside}/victim.json`), outsideContent);
      assertEquals(await Deno.readTextFile(`${project}/app.ts`), source);
    } finally {
      await Deno.remove(project, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);

Deno.test(
  "dangling package.json symlink aborts instead of creating the target file",
  async () => {
    const project = await makeTempDir();
    const outside = await makeTempDir();
    const source = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    const target = `${outside}/planted.json`;
    try {
      await Deno.writeTextFile(`${project}/app.ts`, source);
      // Dangling symlink: lstat succeeds and reports isSymlink, the target
      // does not exist.  Without the guard, readTextFile reports NotFound
      // (treated as an absent manifest) and the write phase would then CREATE
      // the target outside the project.
      await Deno.symlink(target, `${project}/package.json`);

      let thrown: unknown;
      try {
        await main(["--", project]);
      } catch (error) {
        thrown = error;
      }

      assert(thrown instanceof Error, "main() should refuse a dangling package.json symlink");
      assertStringIncludes(thrown.message, "symlink");
      let targetCreated = true;
      try {
        await Deno.lstat(target);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) targetCreated = false;
      }
      assert(!targetCreated, "the symlink target outside the project must not be created");
      assertEquals(await Deno.readTextFile(`${project}/app.ts`), source);
    } finally {
      await Deno.remove(project, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);

Deno.test(
  "symlinked source files and directories are not collected or rewritten",
  async () => {
    const project = await makeTempDir();
    const outside = await makeTempDir();
    const outsideSource = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    try {
      await Deno.writeTextFile(`${outside}/victim.ts`, outsideSource);
      await Deno.mkdir(`${outside}/victim-dir`);
      await Deno.writeTextFile(`${outside}/victim-dir/nested.ts`, outsideSource);
      await Deno.writeTextFile(
        `${project}/package.json`,
        JSON.stringify({ name: "test", dependencies: {} }) + "\n",
      );
      await Deno.symlink(`${outside}/victim.ts`, `${project}/linked.ts`);
      await Deno.symlink(`${outside}/victim-dir`, `${project}/linked-dir`);

      await main(["--", project]);

      // Files reachable only through symlinks must keep their esm.sh URLs.
      assertEquals(await Deno.readTextFile(`${outside}/victim.ts`), outsideSource);
      assertEquals(await Deno.readTextFile(`${outside}/victim-dir/nested.ts`), outsideSource);
    } finally {
      await Deno.remove(project, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);

Deno.test("assertPathInsideProject rejects an out-of-project real path", async () => {
  const project = await makeTempDir();
  const outside = await makeTempDir();
  try {
    const projectRoot = await Deno.realPath(project);
    await Deno.writeTextFile(`${outside}/file.txt`, "x");

    let thrown: unknown;
    try {
      await assertPathInsideProject(`${outside}/file.txt`, projectRoot);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error, "a path outside the project root must be rejected");

    // A regular file directly under the resolved root passes.
    await Deno.writeTextFile(`${project}/inside.txt`, "x");
    await assertPathInsideProject(`${project}/inside.txt`, projectRoot);

    // A missing file is rejected unless explicitly allowed.
    let missingThrown = false;
    try {
      await assertPathInsideProject(`${project}/missing.txt`, projectRoot);
    } catch {
      missingThrown = true;
    }
    assert(missingThrown, "a missing file must be rejected by default");
    await assertPathInsideProject(`${project}/missing.txt`, projectRoot, {
      allowMissing: true,
    });
  } finally {
    await Deno.remove(project, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test(
  "assertPathInsideProject rejects a missing file whose parent escapes the project",
  async () => {
    const project = await makeTempDir();
    const outside = await makeTempDir();
    try {
      const projectRoot = await Deno.realPath(project);
      // Intermediate symlink: the leaf does not exist, so lstat reports
      // NotFound, but creating it would write into `outside`.
      await Deno.symlink(outside, `${project}/linked-dir`);

      let thrown: unknown;
      try {
        await assertPathInsideProject(`${project}/linked-dir/package.json`, projectRoot, {
          allowMissing: true,
        });
      } catch (error) {
        thrown = error;
      }
      assert(
        thrown instanceof Error,
        "a missing path reached through a symlinked parent must be rejected",
      );
    } finally {
      await Deno.remove(project, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
);

Deno.test(
  "assertPathInsideProject accepts children of a root that already ends in a separator",
  async () => {
    const separator = Deno.build.os === "windows" ? "\\" : "/";
    const project = await makeTempDir();
    try {
      const projectRoot = await Deno.realPath(project);
      await Deno.writeTextFile(`${project}/inside.txt`, "x");
      // A filesystem root such as "/" or a drive root already carries the
      // separator. Doubling it would reject every real child.
      await assertPathInsideProject(`${project}/inside.txt`, projectRoot + separator);
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  },
);

Deno.test("project writes stay bound to the file opened before a path swap", async () => {
  if (Deno.build.os === "windows") return;

  const project = await makeTempDir();
  const outside = await makeTempDir();
  const target = `${project}/app.ts`;
  const originalEntry = `${project}/app.original.ts`;
  const outsideFile = `${outside}/outside.ts`;
  const originalTruncate = Deno.FsFile.prototype.truncate;
  let swapped = false;
  try {
    await Deno.writeTextFile(target, "original");
    await Deno.writeTextFile(outsideFile, "outside");

    Deno.FsFile.prototype.truncate = async function (len?: number): Promise<void> {
      if (!swapped) {
        swapped = true;
        await Deno.rename(target, originalEntry);
        await Deno.symlink(outsideFile, target);
      }
      await Reflect.apply(originalTruncate, this, [len]);
    };

    await writeTextFileInsideProject(target, await Deno.realPath(project), "updated");

    assertEquals(await Deno.readTextFile(outsideFile), "outside");
    assertEquals(await Deno.readTextFile(originalEntry), "updated");
  } finally {
    Deno.FsFile.prototype.truncate = originalTruncate;
    await Deno.remove(project, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("project writes support regular files on Windows", async () => {
  if (Deno.build.os !== "windows") return;

  const project = await makeTempDir();
  const target = `${project}/app.ts`;
  try {
    await Deno.writeTextFile(target, "original");
    await writeTextFileInsideProject(target, await Deno.realPath(project), "updated");
    assertEquals(await Deno.readTextFile(target), "updated");
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("project writes refuse to create a missing manifest", async () => {
  const project = await makeTempDir();
  const target = `${project}/package.json`;
  try {
    let thrown: unknown;
    try {
      await writeTextFileInsideProject(target, await Deno.realPath(project), "{}\n", {
        allowMissing: true,
      });
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error);
    assertStringIncludes(thrown.message, "Create package.json");
    await assertRejects(() => Deno.lstat(target), Deno.errors.NotFound);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

Deno.test("project writes reject a file replaced after its source was read", async () => {
  const project = await makeTempDir();
  const target = `${project}/app.ts`;
  const replacement = `${project}/replacement.ts`;
  try {
    const projectRoot = await Deno.realPath(project);
    await Deno.writeTextFile(target, "original");
    const identity = await statNativeFile(target, { bigint: true });
    await Deno.writeTextFile(replacement, "replacement");
    await Deno.rename(replacement, target);

    await assertRejects(
      () =>
        writeTextFileInsideProject(target, projectRoot, "updated", {
          expectedIdentity: {
            device: String(identity.dev),
            inode: String(identity.ino),
          },
        }),
      Error,
      "changed after being read",
    );
    assertEquals(await Deno.readTextFile(target), "replacement");
  } finally {
    await Deno.remove(project, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// main() integration: version conflicts are preflighted
// ---------------------------------------------------------------------------

Deno.test(
  "report paths keep the project directory spelling the caller passed",
  async () => {
    // Traversal and writes use the resolved root, but the report must echo the
    // caller's project argument instead of substituting the resolved path.
    // A symlinked project directory makes the two differ on every platform,
    // the same way a relative argument such as "." does.
    const parent = await makeTempDir();
    const real = `${parent}/real`;
    const link = `${parent}/link`;
    try {
      await Deno.mkdir(real);
      await Deno.writeTextFile(
        `${real}/app.ts`,
        'import { x } from "https://esm.sh/lodash@4.17.21";\n',
      );
      await Deno.writeTextFile(
        `${real}/package.json`,
        JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n",
      );
      await Deno.symlink(real, link);

      let report: { rewrites: Array<{ file: string }> } | undefined;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
      };
      try {
        await main(["--", link]);
      } finally {
        console.log = origLog;
      }

      assert(report !== undefined, "main() must print a JSON report");
      assertEquals(report.rewrites.map((rewrite) => rewrite.file), [`${link}/app.ts`]);
    } finally {
      await Deno.remove(parent, { recursive: true });
    }
  },
);

Deno.test(
  "POSIX report paths preserve literal backslashes in file names",
  async () => {
    if (Deno.build.os === "windows") return;

    const project = await makeTempDir();
    const sourceName = "foo\\bar.ts";
    try {
      await Deno.writeTextFile(
        `${project}/${sourceName}`,
        'import { x } from "https://esm.sh/lodash@4.17.21";\n',
      );
      await Deno.writeTextFile(
        `${project}/package.json`,
        JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n",
      );

      let report: { rewrites: Array<{ file: string }> } | undefined;
      const originalLog = console.log.bind(console);
      console.log = (message: string) => {
        try {
          report = JSON.parse(message);
        } catch { /* ignore non-JSON lines */ }
      };
      try {
        await main(["--", project]);
      } finally {
        console.log = originalLog;
      }

      assert(report !== undefined);
      assertEquals(report.rewrites.map((rewrite) => rewrite.file), [
        `${project}/${sourceName}`,
      ]);
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  },
);

Deno.test(
  "intra-file version conflict leaves source and package.json unchanged",
  async () => {
    // Same package at two different versions in one file: an intra-file conflict.
    // The migration completes, but the conflicting package is left untouched so
    // the codemod cannot collapse two incompatible URLs to one bare specifier.
    const dir = await Deno.makeTempDir();
    const source = [
      'import first from "https://esm.sh/pkg@1.0.0";',
      'import second from "https://esm.sh/pkg@2.0.0";',
      "",
    ].join("\n");
    const manifest = JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      await main(["--", dir]);

      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "cross-file version conflict skips both package rewrites and reports the conflicting file",
  async () => {
    // Two files import the same package at different versions. The run completes,
    // but neither URL is collapsed to a bare specifier and no arbitrary version
    // is pinned.
    const dir = await Deno.makeTempDir();
    const firstSource = 'import first from "https://esm.sh/pkg@1.0.0";\n';
    const secondSource = 'import second from "https://esm.sh/pkg@2.0.0";\n';
    const manifest = JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/first.ts`, firstSource);
      await Deno.writeTextFile(`${dir}/second.ts`, secondSource);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let report: unknown;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
        origLog(msg);
      };
      try {
        await main(["--", dir]);
      } finally {
        console.log = origLog;
      }

      assertEquals(await Deno.readTextFile(`${dir}/first.ts`), firstSource);
      assertEquals(await Deno.readTextFile(`${dir}/second.ts`), secondSource);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
      // Conflict entry carries file path and original URL.
      const conflicts = (report as { conflicts: unknown[] }).conflicts;
      assert(conflicts.length >= 1, "expected at least one conflict entry");
      const c = conflicts[0] as {
        pkg: string;
        existing: string;
        fromVersion: string;
        file: string;
        specifier: string;
      };
      assertEquals(c.pkg, "pkg");
      assertEquals(c.existing, "1.0.0");
      assertEquals(c.fromVersion, "2.0.0");
      assertStringIncludes(c.file, "second.ts");
      assertEquals(c.specifier, "https://esm.sh/pkg@2.0.0");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "devDependencies version disagreement is a conflict: source and manifest unchanged",
  async () => {
    // A URL-derived pin that disagrees with a devDependencies declaration must
    // not be added to `dependencies` - that would leave two disagreeing
    // declarations for one package.
    const dir = await Deno.makeTempDir();
    const source = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    const manifest = JSON.stringify(
      { name: "test", dependencies: {}, devDependencies: { lodash: "4.17.20" } },
      null,
      2,
    ) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let report: unknown;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
        origLog(msg);
      };
      try {
        await main(["--", dir]);
      } finally {
        console.log = origLog;
      }

      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
      const conflicts = (report as { conflicts: unknown[] }).conflicts;
      assertEquals(conflicts.length, 1);
      const c = conflicts[0] as {
        pkg: string;
        existing: string;
        fromVersion: string;
        specifier: string;
      };
      assertEquals(c.pkg, "lodash");
      assertEquals(c.existing, "4.17.20 (devDependencies)");
      assertEquals(c.fromVersion, "4.17.21");
      assertEquals(c.specifier, "https://esm.sh/lodash@4.17.21");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "matching devDependencies version is not a conflict: pin lands in dependencies",
  async () => {
    // The runtime import justifies a `dependencies` entry; an agreeing
    // devDependencies declaration is not a disagreement.
    const dir = await Deno.makeTempDir();
    const source = 'import { x } from "https://esm.sh/lodash@4.17.21";\n';
    const manifest = JSON.stringify(
      { name: "test", dependencies: {}, devDependencies: { lodash: "4.17.21" } },
      null,
      2,
    ) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      await main(["--", dir]);

      const src = await Deno.readTextFile(`${dir}/app.ts`);
      assertStringIncludes(src, 'from "lodash"');
      const pkg = JSON.parse(await Deno.readTextFile(`${dir}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      assertEquals(pkg.dependencies?.lodash, "4.17.21");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "package.json range conflict leaves its import untouched and reports the conflict",
  async () => {
    // A project has "lodash": "^4.17.0" in package.json and imports
    // https://esm.sh/lodash@4.17.21. The URL and existing range are both kept
    // because the codemod cannot prove that they resolve to equivalent code.
    const dir = await Deno.makeTempDir();
    const source = 'import value from "https://esm.sh/lodash@4.17.21";\n';
    const manifest = JSON.stringify(
      { name: "test", dependencies: { lodash: "^4.17.0" } },
      null,
      2,
    ) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let report: unknown;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
        origLog(msg);
      };
      try {
        await main(["--", dir]);
      } finally {
        console.log = origLog;
      }

      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
      // Conflict entry is in the report with file and specifier.
      const conflicts = (report as { conflicts: unknown[] }).conflicts;
      assert(conflicts.length >= 1, "expected at least one conflict entry");
      const c = conflicts[0] as {
        pkg: string;
        existing: string;
        fromVersion: string;
        file: string;
        specifier: string;
      };
      assertEquals(c.pkg, "lodash");
      assertEquals(c.existing, "^4.17.0");
      assertEquals(c.fromVersion, "4.17.21");
      assertStringIncludes(c.file, "app.ts");
      assertEquals(c.specifier, "https://esm.sh/lodash@4.17.21");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "mixed versioned+unversioned imports: conflict specifier points at the versioned URL",
  async () => {
    // A file imports the same package both without and with a version.  The
    // unversioned import may appear first in the source, so a plain .find()
    // on result.rewrites would pick "https://esm.sh/lodash" as the specifier,
    // a URL that has nothing to do with the version conflict.  pickSpecifier()
    // must prefer the rewrite whose URL carries the conflicting version.
    const dir = await Deno.makeTempDir();
    const source = [
      'import a from "https://esm.sh/lodash";',
      'import b from "https://esm.sh/lodash@4.17.21";',
      "",
    ].join("\n");
    const manifest = JSON.stringify(
      { name: "test", dependencies: { lodash: "^4.17.0" } },
      null,
      2,
    ) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let report: unknown;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
        origLog(msg);
      };
      try {
        await main(["--", dir]);
      } finally {
        console.log = origLog;
      }

      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
      // Conflict entry must reference the VERSIONED URL, not "https://esm.sh/lodash".
      const conflicts = (report as { conflicts: unknown[] }).conflicts;
      assert(conflicts.length >= 1, "expected at least one conflict entry");
      const c = conflicts[0] as {
        pkg: string;
        existing: string;
        fromVersion: string;
        file: string;
        specifier: string;
      };
      assertEquals(c.pkg, "lodash");
      assertEquals(c.fromVersion, "4.17.21");
      assertStringIncludes(c.file, "app.ts");
      assertEquals(
        c.specifier,
        "https://esm.sh/lodash@4.17.21",
        "specifier must point at the versioned URL, not the unversioned one",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "unversioned subpath containing version text does not mask conflict specifier",
  async () => {
    const dir = await Deno.makeTempDir();
    const source = [
      'import a from "https://esm.sh/lodash/subpath@4.17.21";',
      'import b from "https://esm.sh/lodash@4.17.21";',
      "",
    ].join("\n");
    const manifest = JSON.stringify(
      { name: "test", dependencies: { lodash: "^4.17.0" } },
      null,
      2,
    ) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let report: unknown;
      const origLog = console.log.bind(console);
      console.log = (msg: string) => {
        try {
          report = JSON.parse(msg);
        } catch { /* ignore non-JSON lines */ }
        origLog(msg);
      };
      try {
        await main(["--", dir]);
      } finally {
        console.log = origLog;
      }

      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
      const conflicts = (report as { conflicts: unknown[] }).conflicts;
      assert(conflicts.length >= 1, "expected at least one conflict entry");
      const c = conflicts[0] as {
        pkg: string;
        existing: string;
        fromVersion: string;
        file: string;
        specifier: string;
      };
      assertEquals(c.pkg, "lodash");
      assertEquals(c.existing, "^4.17.0");
      assertEquals(c.fromVersion, "4.17.21");
      assertStringIncludes(c.file, "app.ts");
      assertEquals(c.specifier, "https://esm.sh/lodash@4.17.21");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "default conflict handling still migrates independent packages",
  async () => {
    const dir = await Deno.makeTempDir();
    const source = [
      'import first from "https://esm.sh/pkg@1.0.0";',
      'import second from "https://esm.sh/pkg@2.0.0";',
      'import safe from "https://esm.sh/safe-pkg@3.0.0";',
      "",
    ].join("\n");
    const manifest = JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      await main(["--", dir]);

      const written = await Deno.readTextFile(`${dir}/app.ts`);
      assertStringIncludes(written, '"https://esm.sh/pkg@1.0.0"');
      assertStringIncludes(written, '"https://esm.sh/pkg@2.0.0"');
      assertStringIncludes(written, 'from "safe-pkg"');

      const packageJson = JSON.parse(await Deno.readTextFile(`${dir}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      assertEquals(packageJson.dependencies, { "safe-pkg": "3.0.0" });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "--fail-on-conflict exits before any source or package.json write",
  async () => {
    const dir = await Deno.makeTempDir();
    const source = [
      'import first from "https://esm.sh/pkg@1.0.0";',
      'import second from "https://esm.sh/pkg@2.0.0";',
      'import safe from "https://esm.sh/safe-pkg@3.0.0";',
      "",
    ].join("\n");
    const manifest = JSON.stringify({ name: "test", dependencies: {} }, null, 2) + "\n";
    try {
      await Deno.writeTextFile(`${dir}/app.ts`, source);
      await Deno.writeTextFile(`${dir}/package.json`, manifest);

      let thrown: unknown;
      try {
        await main(["--", "--fail-on-conflict", dir]);
      } catch (error) {
        thrown = error;
      }

      assert(thrown instanceof Error, "strict conflict mode should fail");
      assertStringIncludes(thrown.message, "version conflict");
      assertEquals(await Deno.readTextFile(`${dir}/app.ts`), source);
      assertEquals(await Deno.readTextFile(`${dir}/package.json`), manifest);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Prototype-key collision safety (Fix 1)
// ---------------------------------------------------------------------------

Deno.test("esm-sh codemod handles a package name that collides with Object.prototype key", () => {
  // "hasOwnProperty", "toString", "constructor" etc. are inherited from
  // Object.prototype.  The `in` operator would report them as present on any
  // plain object, causing a spurious conflict even on first encounter.
  // With Object.hasOwn and a null-prototype pins map, the first version seen
  // is recorded correctly and no conflict is raised.
  const source = [
    'import { x } from "https://esm.sh/hasOwnProperty@1.0.0";',
    'import { y } from "https://esm.sh/toString@2.0.0";',
    "",
  ].join("\n");
  const result = migrateEsmShImports(source);

  assert(result.changed);
  assertStringIncludes(result.code, 'from "hasOwnProperty"');
  assertStringIncludes(result.code, 'from "toString"');
  assertEquals(result.pins, { hasOwnProperty: "1.0.0", toString: "2.0.0" });
  // No spurious conflict: these are first-time pins, not duplicates.
  assertEquals(result.conflicts, []);
});

Deno.test('mergeEsmShPins: package named "__proto__" is stored as own property, no prototype pollution', () => {
  // If updatedDeps is a regular object, `updatedDeps["__proto__"] = version`
  // triggers the inherited setter and mutates the object's prototype instead
  // of creating an own property.  With a null-prototype object the key is
  // stored as a plain own property.
  //
  // NOTE: { "__proto__": "1.0.0" } in an object literal is NOT an own property
  // JS interprets __proto__ as a prototype setter, so Object.entries returns
  // nothing. Object.fromEntries uses own-property creation semantics, so
  // "__proto__" remains ordinary enumerable data without invoking the legacy
  // prototype setter.
  const newPins = Object.fromEntries([["__proto__", "1.0.0"]]);
  const { updatedDeps, conflicts } = mergeEsmShPins({}, newPins);

  // The version must be stored and retrievable.
  assert(Object.hasOwn(updatedDeps, "__proto__"), '"__proto__" must be an own property');
  assertEquals(
    (updatedDeps as Record<string, string>)["__proto__"],
    "1.0.0",
  );
  // Object.prototype must be completely unaffected.
  assertEquals(typeof ({} as Record<string, unknown>)["missingKey"], "undefined");
  assertEquals(conflicts, []);
});

// ---------------------------------------------------------------------------
// Non-top-level import declaration (Fix 2)
// ---------------------------------------------------------------------------

Deno.test(
  "esm-sh codemod rewrites an import declaration in a non-top-level position",
  () => {
    // allowImportExportEverywhere lets the parser accept import declarations
    // inside blocks.  The single-pass walkAst must find and rewrite them.
    const source = [
      "if (DEV) {",
      '  import { debug } from "https://esm.sh/debug-pkg@4.3.4";',
      "}",
      "",
    ].join("\n");
    const result = migrateEsmShImports(source);

    assert(result.changed, "non-top-level import must be rewritten");
    assertStringIncludes(result.code, 'from "debug-pkg"');
    assert(!result.code.includes("esm.sh"));
    assertEquals(result.pins, { "debug-pkg": "4.3.4" });
    assertEquals(result.needsResolution, []);
  },
);
