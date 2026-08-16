import { deepStrictEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

const utilsUrl = new URL("./test-file-utils.mjs", import.meta.url).href;

const BASE_TREE = [
  "src/a.test.ts",
  "src/nested/b.test.ts",
  "src/nested/deep/c.test.ts",
  "src/not-a-test.ts",
  // Hidden directory: both `rg` (without --hidden) and node:fs glob skip these,
  // so the in-process fallback must too or selection depends on whether
  // ripgrep happens to be installed.
  "src/.fixtures/hidden.test.ts",
  "extra/explicit.test.mjs",
];

const GLOBSTAR_TREE = [
  "src/b.test.ts",
  "src/foo.test.ts",
  "src/foo/a.test.ts",
  "src/foo/deep/d.test.ts",
];

/**
 * Build a throwaway tree, hand it to `run`, then remove it.
 *
 * Teardown is per-test rather than a `node:test` `after` hook: `tests/` is also
 * swept by `deno test` in the integration lane, and Deno's `node:test` shim
 * does not implement `after` — it fails the whole file with an uncaught
 * "Not implemented: test.after". `describe`/`it` are supported in both, which
 * is why the sibling `ensure-npm-links.test.mjs` sticks to them.
 */
function withFixture(relativePaths, run) {
  const root = mkdtempSync(join(tmpdir(), "vf-test-file-utils-"));
  try {
    for (const relative of relativePaths) {
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, "// fixture\n");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Resolve patterns with `rg` guaranteed absent.
 *
 * `rgAvailable` is module-level state latched on the first ENOENT, so each
 * scenario runs in its own child process with an empty PATH instead of trying
 * to reset it in-process. An empty PATH is what makes `spawnSync("rg", ...)`
 * fail with ENOENT, which is the branch this suite is about — and the branch
 * the CI runners actually take.
 */
function runListTestFilesProbe(patterns, cwd) {
  // The probe goes to a real file rather than `-e`. This suite runs in both
  // the Node lane and the Deno integration lane (which sweeps all of `tests/`),
  // and `process.execPath` is whichever runtime is hosting — so a Node-only
  // `--input-type=module -e` invocation fails under Deno with "await is only
  // valid in async functions and the top level bodies of modules".
  const probeDir = mkdtempSync(join(tmpdir(), "vf-test-file-utils-probe-"));
  const probePath = join(probeDir, "probe.mjs");
  writeFileSync(
    probePath,
    `import { listTestFiles } from ${JSON.stringify(utilsUrl)};\n` +
      `process.stdout.write(JSON.stringify(listTestFiles(${JSON.stringify(patterns)}, ${
        JSON.stringify(cwd)
      })));\n`,
  );
  // Deno needs its permissions named; Node takes the script path alone.
  const args = typeof globalThis.Deno === "undefined"
    ? [probePath]
    : ["run", "--allow-read", "--allow-env", "--allow-run", probePath];
  try {
    return spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function listTestFilesWithoutRipgrep(patterns, cwd) {
  const result = runListTestFilesProbe(patterns, cwd);
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

/**
 * `globSync` yields directory entries as well as files (`src/**` includes
 * `src/foo`), while `listTestFiles` only ever returns files. Compare like with
 * like so the reference stays meaningful for directory-matching patterns.
 */
function globFilesSorted(pattern, root) {
  return globSync(pattern, { cwd: root })
    .filter((entry) => statSync(join(root, entry)).isFile())
    .map((entry) => entry.split(sep).join("/"))
    .sort();
}

describe("listTestFiles without ripgrep", () => {
  it("resolves a glob pattern when no other pattern matched", () => {
    withFixture(BASE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root), root),
        [
          "src/a.test.ts",
          "src/nested/b.test.ts",
          "src/nested/deep/c.test.ts",
        ],
      );
    });
  });

  it("resolves a glob pattern alongside an explicit file pattern", () => {
    withFixture(BASE_TREE, (root) => {
      // The regression: the explicit file makes the result set non-empty, so
      // the whole-result-set fallback never fires and the glob silently
      // contributes nothing. Selection collapses to the explicit file alone.
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
  });

  it("resolves a glob pattern alongside a directory pattern", () => {
    withFixture(BASE_TREE, (root) => {
      const files = listTestFilesWithoutRipgrep(["src/**/*.test.ts", "extra"], root);
      deepStrictEqual(relativeSorted(files, root), [
        "extra/explicit.test.mjs",
        "src/a.test.ts",
        "src/nested/b.test.ts",
        "src/nested/deep/c.test.ts",
      ]);
    });
  });

  it("does not invent matches for a glob that matches nothing", () => {
    withFixture(BASE_TREE, (root) => {
      const files = listTestFilesWithoutRipgrep(
        ["does-not-exist/**/*.test.ts", "extra/explicit.test.mjs"],
        root,
      );
      deepStrictEqual(relativeSorted(files, root), ["extra/explicit.test.mjs"]);
    });
  });

  it("keeps a glob's contribution identical with and without an extra pattern", () => {
    withFixture(BASE_TREE, (root) => {
      const globOnly = relativeSorted(
        listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root),
        root,
      );
      const withExtra = relativeSorted(
        listTestFilesWithoutRipgrep(["src/**/*.test.ts", "extra/explicit.test.mjs"], root),
        root,
      ).filter((file) => file.startsWith("src/"));
      deepStrictEqual(withExtra, globOnly);
    });
  });
});

describe("listTestFiles treats ** as a globstar only as a complete segment", () => {
  // Raised in review on #3780. `**` glued to other characters is segment-scoped
  // in both ripgrep and node:fs glob, so the zero-segment translation has to be
  // gated on both boundaries or `src/foo**/` wrongly selects `src/foo.test.ts`.
  for (
    const pattern of [
      "src/foo**/*.test.ts",
      "src/**.test.ts",
      "src/**/*.test.ts",
      "src/**",
      "**/*.test.ts",
      "src/foo/**/*.test.ts",
    ]
  ) {
    it(`resolves ${pattern} the way node:fs glob does`, () => {
      withFixture(GLOBSTAR_TREE, (root) => {
        deepStrictEqual(
          relativeSorted(listTestFilesWithoutRipgrep([pattern], root), root),
          globFilesSorted(pattern, root),
        );
      });
    });
  }
});

describe("listTestFiles matches ripgrep on dot-prefixed entries", () => {
  // `rg` is the oracle for this case, not node:fs glob, because `rg` is what
  // runs when it is installed — the fallback exists to reproduce its
  // selection. Verified directly against rg 14:
  //   rg --files -g "*.test.*" src        -> includes src/.smoke.test.ts
  //   rg --files -g "src/**/*.test.ts"    -> includes src/.smoke.test.ts
  //   rg --files -g "src/**/*.test.ts"    -> OMITS  src/.fixtures/x.test.ts
  // `-g/--glob` "always overrides any other ignore logic", so a dot-prefixed
  // *file* is matched while a hidden *directory* is still pruned. node:fs glob
  // excludes both, so the globSync-pinned suite below cannot cover this.
  const DOTFILE_TREE = [
    "src/a.test.ts",
    "src/.smoke.test.ts",
    "src/.fixtures/skipped.test.ts",
    "src/nested/b.test.ts",
  ];

  it("keeps a dot-prefixed file matched by a glob pattern", () => {
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root), root),
        ["src/.smoke.test.ts", "src/a.test.ts", "src/nested/b.test.ts"],
      );
    });
  });

  it("keeps a dot-prefixed file under a directory pattern", () => {
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesWithoutRipgrep(["src"], root), root),
        ["src/.smoke.test.ts", "src/a.test.ts", "src/nested/b.test.ts"],
      );
    });
  });

  it("matches nothing when the glob's literal prefix is a hidden directory", () => {
    // rg prunes the hidden directory before applying the glob, so this pattern
    // returns no files at all. `walk` starts inside the base, so the per-entry
    // check never sees `.fixtures` — the base itself has to be rejected.
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesWithoutRipgrep(["src/.fixtures/**/*.test.ts"], root), root),
        [],
      );
    });
  });

  it("treats a directory named ..something as hidden, not as a parent path", () => {
    // `relative()` returns `..fixtures` here, which a bare startsWith("..")
    // check reads as "outside cwd" and waves through. rg 15 returns nothing
    // for this pattern.
    withFixture(["..fixtures/a.test.ts", "src/a.test.ts"], (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesWithoutRipgrep(["..fixtures/**/*.test.ts"], root), root),
        [],
      );
    });
  });

  it("still prunes a hidden directory", () => {
    withFixture(DOTFILE_TREE, (root) => {
      const selected = relativeSorted(
        listTestFilesWithoutRipgrep(["src/**/*.test.ts"], root),
        root,
      );
      deepStrictEqual(selected.includes("src/.fixtures/skipped.test.ts"), false);
    });
  });
});

describe("listTestFiles agrees with the platform glob", () => {
  // `node:fs` globSync is the reference implementation: ripgrep's `-g` returns
  // the same set for these patterns, and pinning against a built-in keeps the
  // assertion deterministic on machines where `rg` is absent.
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
      withFixture(BASE_TREE, (root) => {
        deepStrictEqual(
          relativeSorted(listTestFilesWithoutRipgrep([pattern], root), root),
          globFilesSorted(pattern, root),
        );
      });
    });
  }
});

describe("listTestFiles does not hide a failed traversal", () => {
  // Raised in review on #3780. Catching around the whole walk swallowed errors
  // raised *during* traversal after files had already been collected, so the
  // runner could execute a partial selection and report success — the same
  // silent-omission failure this module is being fixed for.
  it("propagates an unreadable descendant of a directory pattern", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    if (process.platform === "win32") return;
    withFixture(BASE_TREE, (root) => {
      // A *directory* pattern routes through `listWithFallback` from inside
      // `listTestFiles`'s own try. A broad catch there swallowed the rethrow,
      // so the directory's tests were dropped and only the other explicit
      // pattern survived — reported as a clean pass.
      const blocked = join(root, "src", "nested");
      chmodSync(blocked, 0o000);
      try {
        const result = runListTestFilesProbe(["src", "extra/explicit.test.mjs"], root);
        ok(
          result.status !== 0,
          `expected a non-zero exit, got ${result.status} with stdout: ${result.stdout}`,
        );
        ok(
          /EACCES|EPERM/.test(result.stderr),
          `expected a permission error to surface, got: ${result.stderr}`,
        );
      } finally {
        chmodSync(blocked, 0o755);
      }
    });
  });

  it("propagates an unreadable glob base instead of dropping the pattern", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    if (process.platform === "win32") return;
    withFixture(BASE_TREE, (root) => {
      // The glob's base is `src/`, reached through an ancestor we cannot
      // search. `statSync` raises EACCES rather than ENOENT, and treating that
      // as "missing" would drop the whole pattern — leaving an empty selection
      // that the runner reports as a clean pass.
      const gate = join(root, "src");
      chmodSync(gate, 0o000);
      try {
        const result = runListTestFilesProbe(["src/nested/**/*.test.ts"], root);
        ok(
          result.status !== 0,
          `expected a non-zero exit, got ${result.status} with stdout: ${result.stdout}`,
        );
        ok(
          /EACCES|EPERM/.test(result.stderr),
          `expected a permission error to surface, got: ${result.stderr}`,
        );
      } finally {
        chmodSync(gate, 0o755);
      }
    });
  });

  it("propagates an unreadable subdirectory instead of returning a partial set", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      // root ignores the mode bits, so the error cannot be provoked.
      return;
    }
    if (process.platform === "win32") {
      // `chmod 000` does not deny directory traversal on Windows, so the child
      // would succeed and the assertion below would fail for the wrong reason.
      // No CI runner is Windows today; this is for local runs.
      return;
    }
    withFixture(BASE_TREE, (root) => {
      const blocked = join(root, "src", "blocked");
      mkdirSync(blocked, { recursive: true });
      writeFileSync(join(blocked, "hidden.test.ts"), "// fixture\n");
      chmodSync(blocked, 0o000);
      try {
        const result = runListTestFilesProbe(["src/**/*.test.ts"], root);
        ok(
          result.status !== 0,
          `expected a non-zero exit, got ${result.status} with stdout: ${result.stdout}`,
        );
        ok(
          /EACCES|EPERM/.test(result.stderr),
          `expected a permission error to surface, got: ${result.stderr}`,
        );
      } finally {
        // Restore before teardown, or the recursive remove cannot descend.
        chmodSync(blocked, 0o755);
      }
    });
  });
});
