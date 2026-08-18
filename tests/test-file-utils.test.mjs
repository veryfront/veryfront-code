import { deepStrictEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
  // Hidden directory: pruned, so a test file inside it is never selected.
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
 * A tree whose `.gitignore` hides one of its own test files.
 *
 * This is the divergence #3784 was opened for: ripgrep honours `.gitignore`
 * and an in-process walk does not, so the same pattern selected two different
 * sets depending on whether `rg` happened to be installed.
 */
const GITIGNORED_TREE = [
  "src/a.test.ts",
  "src/generated/gen.test.ts",
];

/** The single path the stub `rg` prints; it exists in no fixture. */
const STUB_RIPGREP_MATCH = "fabricated-by-stub-ripgrep.test.ts";

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
 * Resolve patterns in a child process with an explicit `PATH`.
 *
 * `PATH` is the whole point of this suite. Selection must not depend on which
 * executables happen to be installed, so every scenario is run in a child whose
 * `PATH` is set deliberately — empty (nothing findable), or a directory holding
 * a stub that would change the answer if it were consulted.
 */
function runListTestFilesProbe(patterns, cwd, { path = "" } = {}) {
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
      env: { ...process.env, PATH: path },
    });
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function listTestFilesInChild(patterns, cwd, options) {
  const result = runListTestFilesProbe(patterns, cwd, options);
  ok(
    result.status === 0,
    `child listTestFiles failed (status ${result.status}): ${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

/**
 * Hand `run` a directory holding an `rg` executable that records every call and
 * answers with a path that exists in no fixture.
 *
 * A selection that consults it is therefore detectable twice over: the marker
 * file appears, and the fabricated path shows up in the result. Unlike an empty
 * `PATH`, this discriminates on machines where ripgrep is genuinely absent, so
 * the assertion means the same thing on a developer laptop and on CI.
 */
function withStubRipgrep(run) {
  const stubDir = mkdtempSync(join(tmpdir(), "vf-test-file-utils-stub-"));
  const markerPath = join(stubDir, "invocations.log");
  const stubPath = join(stubDir, "rg");
  writeFileSync(
    stubPath,
    "#!/bin/sh\n" +
      `printf '%s\\n' "$*" >> ${JSON.stringify(markerPath)}\n` +
      `printf '%s\\n' ${JSON.stringify(STUB_RIPGREP_MATCH)}\n`,
  );
  chmodSync(stubPath, 0o755);
  try {
    run({ stubDir, markerPath });
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
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

describe("listTestFiles resolves patterns in-process, never by subprocess", () => {
  // #3784. `listTestFiles` used to shell out to `rg` and fall back to an
  // in-process walk when it was absent, so which tests ran depended on which
  // binaries were installed. #3780 fixed a run of divergences between the two
  // across six review rounds, most introduced by the fix for the previous one.
  // There is now one implementation, and these tests pin that there is no
  // second one for it to drift from.
  it("does not consult an `rg` on PATH", () => {
    if (process.platform === "win32") return; // no `#!/bin/sh` stub there
    withFixture(BASE_TREE, (root) => {
      withStubRipgrep(({ stubDir, markerPath }) => {
        const withStub = listTestFilesInChild(["src/**/*.test.ts"], root, {
          path: stubDir,
        });
        deepStrictEqual(relativeSorted(withStub, root), [
          "src/a.test.ts",
          "src/nested/b.test.ts",
          "src/nested/deep/c.test.ts",
        ]);
        deepStrictEqual(existsSync(markerPath), false);
      });
    });
  });

  it("selects the same files whether or not an `rg` is on PATH", () => {
    if (process.platform === "win32") return;
    withFixture(BASE_TREE, (root) => {
      withStubRipgrep(({ stubDir }) => {
        deepStrictEqual(
          relativeSorted(
            listTestFilesInChild(["src", "src/**/*.test.ts"], root, { path: stubDir }),
            root,
          ),
          relativeSorted(listTestFilesInChild(["src", "src/**/*.test.ts"], root), root),
        );
      });
    });
  });

  it("selects a gitignored test file, the same as any other", () => {
    withFixture(GITIGNORED_TREE, (root) => {
      writeFileSync(join(root, ".gitignore"), "src/generated/\n");
      // ripgrep only honours `.gitignore` inside a git repository, so the
      // divergence needs a real one to reproduce.
      const init = spawnSync("git", ["init", "-q", "."], { cwd: root, encoding: "utf8" });
      if (init.error || init.status !== 0) return;
      // Resolution walks the filesystem, so an ignore file is just a file.
      // Pinned deliberately: `rg` would have dropped `src/generated/gen.test.ts`
      // here, and that difference is what made selection environment-dependent.
      deepStrictEqual(
        relativeSorted(
          listTestFilesInChild(["src/**/*.test.ts"], root, { path: process.env.PATH ?? "" }),
          root,
        ),
        ["src/a.test.ts", "src/generated/gen.test.ts"],
      );
    });
  });
});

describe("listTestFiles glob resolution", () => {
  it("resolves a glob pattern when no other pattern matched", () => {
    withFixture(BASE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/**/*.test.ts"], root), root),
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
      // The #3780 regression: the explicit file made the result set non-empty,
      // so the whole-result-set fallback never fired and the glob silently
      // contributed nothing. Selection collapsed to the explicit file alone.
      const files = listTestFilesInChild(
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
      const files = listTestFilesInChild(["src/**/*.test.ts", "extra"], root);
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
      const files = listTestFilesInChild(
        ["does-not-exist/**/*.test.ts", "extra/explicit.test.mjs"],
        root,
      );
      deepStrictEqual(relativeSorted(files, root), ["extra/explicit.test.mjs"]);
    });
  });

  it("keeps a glob's contribution identical with and without an extra pattern", () => {
    withFixture(BASE_TREE, (root) => {
      const globOnly = relativeSorted(
        listTestFilesInChild(["src/**/*.test.ts"], root),
        root,
      );
      const withExtra = relativeSorted(
        listTestFilesInChild(["src/**/*.test.ts", "extra/explicit.test.mjs"], root),
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
          relativeSorted(listTestFilesInChild([pattern], root), root),
          globFilesSorted(pattern, root),
        );
      });
    });
  }
});

describe("listTestFiles on dot-prefixed entries", () => {
  // Dot-prefixed *files* are selected; hidden *directories* are pruned. These
  // came from the `rg` behaviour this module used to have to reproduce, and
  // they are kept unchanged so removing `rg` in #3784 alters no selection.
  // Against rg 14/15, which is where they came from:
  //   rg --files -g "*.test.*" src        -> includes src/.smoke.test.ts
  //   rg --files -g "src/**/*.test.ts"    -> includes src/.smoke.test.ts
  //   rg --files -g "src/**/*.test.ts"    -> OMITS  src/.fixtures/x.test.ts
  // `node:fs` glob excludes both, so the globSync-pinned suite below cannot
  // cover this case — which is also why globSync is not a drop-in replacement.
  const DOTFILE_TREE = [
    "src/a.test.ts",
    "src/.smoke.test.ts",
    "src/.fixtures/skipped.test.ts",
    "src/nested/b.test.ts",
  ];

  it("keeps a dot-prefixed file matched by a glob pattern", () => {
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/**/*.test.ts"], root), root),
        ["src/.smoke.test.ts", "src/a.test.ts", "src/nested/b.test.ts"],
      );
    });
  });

  it("keeps a dot-prefixed file under a directory pattern", () => {
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src"], root), root),
        ["src/.smoke.test.ts", "src/a.test.ts", "src/nested/b.test.ts"],
      );
    });
  });

  it("matches nothing when the glob's literal prefix is a hidden directory", () => {
    // The hidden directory is pruned before the glob is applied, so this
    // pattern returns no files at all. `walk` starts inside the base, so the
    // per-entry check never sees `.fixtures` — the base itself has to be
    // rejected. Matches `rg -g 'src/.fixtures/**/*.test.ts'`.
    withFixture(DOTFILE_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/.fixtures/**/*.test.ts"], root), root),
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
        relativeSorted(listTestFilesInChild(["..fixtures/**/*.test.ts"], root), root),
        [],
      );
    });
  });

  it("still prunes a hidden directory", () => {
    withFixture(DOTFILE_TREE, (root) => {
      const selected = relativeSorted(
        listTestFilesInChild(["src/**/*.test.ts"], root),
        root,
      );
      deepStrictEqual(selected.includes("src/.fixtures/skipped.test.ts"), false);
    });
  });
});

describe("listTestFiles supports bracket character classes", () => {
  // `hasGlob` counts `[` as a glob character, but `globToRegex` escaped the
  // brackets — so every bracket pattern matched nothing. That is worse than a
  // wrong match: an empty selection is a test run that passes without running
  // anything. Verified against rg 15, which returns a.test.ts and b.test.ts
  // for `src/[ab].test.ts` and b/c for the negated form.
  const CLASS_TREE = ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"];

  it("matches a positive class the way ripgrep does", () => {
    withFixture(CLASS_TREE, (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/[ab].test.ts"], root), root),
        ["src/a.test.ts", "src/b.test.ts"],
      );
    });
  });

  it("matches a negated class in both spellings", () => {
    withFixture(CLASS_TREE, (root) => {
      const expected = ["src/b.test.ts", "src/c.test.ts"];
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/[!a].test.ts"], root), root),
        expected,
      );
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/[^a].test.ts"], root), root),
        expected,
      );
    });
  });

  it("never lets a class match a path separator", () => {
    withFixture(["src/nested/a.test.ts", "src/a.test.ts"], (root) => {
      // `[a-z/]` must not let the class span a segment boundary.
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/[a-z].test.ts"], root), root),
        ["src/a.test.ts"],
      );
    });
  });

  it("treats an unterminated bracket as a literal", () => {
    withFixture(["src/[a.test.ts"], (root) => {
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/[a.test.ts"], root), root),
        ["src/[a.test.ts"],
      );
    });
  });
});

describe("listTestFiles resolves the pattern shapes consumers actually pass", () => {
  // Found by an acceptance audit after #3784 landed. Each of these selected
  // ZERO files while ripgrep 15.2.0 returned real matches. Zero is the
  // dangerous answer: `tests/node/run-tests.mjs` turns an empty selection into
  // `process.exit(0)`, so the command reports success having run nothing —
  // the silent-green failure mode this module exists to prevent.
  const TREE = [
    "src/a.test.ts",
    "src/b.test.ts",
    "src/nested/c.test.ts",
    "src/routes/[id]/r.test.ts",
  ];

  it("matches a bare basename glob at any depth", () => {
    // `rg --files -g '*.test.ts'` matches the BASENAME at any depth. Anchoring
    // a slash-free pattern to the root instead made it match nothing at all.
    withFixture(TREE, (root) => {
      deepStrictEqual(relativeSorted(listTestFilesInChild(["*.test.ts"], root), root), [
        "src/a.test.ts",
        "src/b.test.ts",
        "src/nested/c.test.ts",
        "src/routes/[id]/r.test.ts",
      ]);
    });
  });

  it("still anchors a pattern that contains a separator", () => {
    // The basename rule must not leak into rooted patterns: `src/*.test.ts` is
    // depth-1 under src/, not "any a.test.ts anywhere".
    withFixture(TREE, (root) => {
      deepStrictEqual(relativeSorted(listTestFilesInChild(["src/*.test.ts"], root), root), [
        "src/a.test.ts",
        "src/b.test.ts",
      ]);
    });
  });

  it("expands brace alternation", () => {
    withFixture(TREE, (root) => {
      deepStrictEqual(relativeSorted(listTestFilesInChild(["src/{a,b}.test.ts"], root), root), [
        "src/a.test.ts",
        "src/b.test.ts",
      ]);
      deepStrictEqual(
        relativeSorted(listTestFilesInChild(["src/{a,nested/c}.test.ts"], root), root),
        ["src/a.test.ts", "src/nested/c.test.ts"],
      );
    });
  });

  it("treats a directory that exists as a literal path, brackets and all", () => {
    // `src/routes/[id]` is a real directory in this repo's shape
    // (src/discovery/__fixtures__/.../[userId]/). `hasGlob` classified it as a
    // character class, so it could never match the directory literally named
    // `[id]`. An existing path wins over a glob reading of the same string.
    withFixture(TREE, (root) => {
      deepStrictEqual(relativeSorted(listTestFilesInChild(["src/routes/[id]"], root), root), [
        "src/routes/[id]/r.test.ts",
      ]);
    });
  });

  it("keeps bracket classes working when the path does not exist", () => {
    withFixture(TREE, (root) => {
      deepStrictEqual(relativeSorted(listTestFilesInChild(["src/[ab].test.ts"], root), root), [
        "src/a.test.ts",
        "src/b.test.ts",
      ]);
    });
  });
});

describe("listTestFiles agrees with the platform glob", () => {
  // `node:fs` globSync is a cross-check, not the implementation: it agrees on
  // the pattern shapes the consumers actually pass, so pinning against it
  // catches drift in `globToRegex` without adding a second resolver. It is not
  // used to resolve, because Node, Deno and Bun disagree on `src/**` and on
  // dot-prefixed entries, and all three load this module (#3784).
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
          relativeSorted(listTestFilesInChild([pattern], root), root),
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
      // A *directory* pattern routes through the in-process walk from inside
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
