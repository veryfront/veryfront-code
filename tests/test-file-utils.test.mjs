import { deepStrictEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const utilsUrl = new URL("./test-file-utils.mjs", import.meta.url).href;
const fixtures = [];

/**
 * The suite exercises the branch taken when `rg` is not on PATH, which is the
 * case on the CI runners. `rgAvailable` is module-level state latched on the
 * first ENOENT, so each scenario runs in its own child process with an empty
 * PATH rather than trying to reset it in-process.
 */
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "vf-test-file-utils-"));
  fixtures.push(root);
  for (
    const relative of [
      "src/a.test.ts",
      "src/nested/b.test.ts",
      "src/nested/deep/c.test.ts",
      "src/not-a-test.ts",
      "extra/explicit.test.mjs",
    ]
  ) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, "// fixture\n");
  }
  return root;
}

function listTestFilesWithoutRipgrep(patterns, cwd) {
  const script = `
    const { listTestFiles } = await import(${JSON.stringify(utilsUrl)});
    const files = listTestFiles(${JSON.stringify(patterns)}, ${JSON.stringify(cwd)});
    process.stdout.write(JSON.stringify(files));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    // An empty PATH is what makes spawnSync("rg", ...) fail with ENOENT, which
    // is the condition this suite is about. Everything else is inherited.
    env: { ...process.env, PATH: "" },
  });
  ok(
    result.status === 0,
    `child listTestFiles failed (status ${result.status}): ${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

function relativeSorted(files, root) {
  return files
    .map((file) => resolve(file).slice(resolve(root).length + 1).split(sep).join("/"))
    .sort();
}

after(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

describe("listTestFiles without ripgrep", () => {
  it("resolves a glob pattern when no other pattern matched", () => {
    const root = createFixture();
    const files = listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root);
    deepStrictEqual(relativeSorted(files, root), [
      "src/a.test.ts",
      "src/nested/b.test.ts",
      "src/nested/deep/c.test.ts",
    ]);
  });

  it("resolves a glob pattern alongside an explicit file pattern", () => {
    const root = createFixture();
    // The regression: the explicit file makes the result set non-empty, so the
    // whole-result-set fallback never fires and the glob silently contributes
    // nothing. Selection collapses to the explicit file alone.
    const files = listTestFilesWithoutRipgrep(
      ["src/**/*.test.ts", "extra/explicit.test.mjs"],
      root,
    );
    deepStrictEqual(relativeSorted(files, root), [
      "extra/explicit.test.mjs",
      "src/a.test.ts",
      "src/nested/b.test.ts",
      "src/nested/deep/c.test.ts",
    ]);
  });

  it("resolves a glob pattern alongside a directory pattern", () => {
    const root = createFixture();
    const files = listTestFilesWithoutRipgrep(["src/**/*.test.ts", "extra"], root);
    deepStrictEqual(relativeSorted(files, root), [
      "extra/explicit.test.mjs",
      "src/a.test.ts",
      "src/nested/b.test.ts",
      "src/nested/deep/c.test.ts",
    ]);
  });

  it("does not invent matches for a glob that matches nothing", () => {
    const root = createFixture();
    const files = listTestFilesWithoutRipgrep(
      ["does-not-exist/**/*.test.ts", "extra/explicit.test.mjs"],
      root,
    );
    deepStrictEqual(relativeSorted(files, root), ["extra/explicit.test.mjs"]);
  });

  it("keeps a glob's contribution identical with and without an extra pattern", () => {
    const root = createFixture();
    const globOnly = relativeSorted(listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root), root);
    const withExtra = relativeSorted(
      listTestFilesWithoutRipgrep(["src/**/*.test.ts", "extra/explicit.test.mjs"], root),
      root,
    ).filter((file) => file.startsWith("src/"));
    deepStrictEqual(withExtra, globOnly);
  });
});

describe("listTestFiles agrees with the platform glob", () => {
  // `node:fs` globSync is the reference implementation here: ripgrep's `-g`
  // returns the same set for these patterns, and pinning against a built-in
  // keeps the assertion deterministic on machines where `rg` is absent.
  for (
    const pattern of [
      "src/**/*.test.ts",
      "src/**/*.test.*",
      "**/*.test.ts",
      "src/*.test.ts",
      "src/nested/**/*.test.ts",
    ]
  ) {
    it(`resolves ${pattern} the way node:fs glob does`, () => {
      const root = createFixture();
      const expected = globSync(pattern, { cwd: root })
        .map((file) => file.split(sep).join("/"))
        .sort();
      deepStrictEqual(relativeSorted(listTestFilesWithoutRipgrep([pattern], root), root), expected);
    });
  }

  it("matches the in-process path, whatever ripgrep availability is here", async () => {
    const root = createFixture();
    const patterns = ["src/**/*.test.ts", "extra/explicit.test.mjs"];
    const { listTestFiles } = await import(
      fileURLToPath(new URL("./test-file-utils.mjs", import.meta.url))
    );
    deepStrictEqual(
      relativeSorted(listTestFiles(patterns, root), root),
      relativeSorted(listTestFilesWithoutRipgrep(patterns, root), root),
    );
  });
});
