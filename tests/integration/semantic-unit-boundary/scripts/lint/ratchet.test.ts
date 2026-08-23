/**
 * Integration tests for the ratchet engine's effectful half: the repository
 * walk with its ignore policy and loud missing-root failure, the end-to-end
 * `runRatchet` contract for every baseline kind (regression, improvement,
 * --print-baseline, --update), and cwd-independent root resolution proven
 * from a subprocess. These build throwaway repos on disk and spawn Deno, so
 * they live at the integration boundary; the engine's pure functions are
 * unit-tested next to it in scripts/lint/ratchet.test.ts.
 */

import { assertEquals, assertMatch, assertRejects } from "#std/assert";
import { afterEach, beforeEach, describe, it } from "#std/testing/bdd";
import { fromFileUrl } from "#std/path";
import {
  type Finding,
  findLineMatches,
  isSourceFile,
  isTestFile,
  MissingScanRoot,
  ParseFailure,
  type RatchetSpec,
  runRatchet,
  walkRepo,
} from "../../../../../scripts/lint/ratchet.ts";

const TEST_DENO_JSON = JSON.stringify({
  test: { include: ["src/", "tests/"] },
  lint: {
    include: ["src/**/*.ts", "src/**/*.tsx", "cli/**/*.ts"],
    exclude: ["dist/", "src/vendor/"],
  },
});

/** A throwaway repo root with a trailing separator, like `REPO_ROOT`. */
async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ratchet-" });
  const root = `${dir}/`;
  await Deno.writeTextFile(`${root}deno.json`, TEST_DENO_JSON);
  for (const [relative, content] of Object.entries(files)) {
    const path = `${root}${relative}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  return root;
}

/** Findings for every line containing `TODO`. */
const todoScan = (source: string, file: string): Finding[] =>
  findLineMatches(source, file, /TODO/g, "todo");

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("walkRepo", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRepo({
      "src/a.test.ts": "",
      "src/b.ts": "",
      "src/nested/c.test.tsx": "",
      "src/node_modules/d.test.ts": "",
      "src/.omc/e.test.ts": "",
      "src/dist/f.test.ts": "",
      "src/coverage/g.test.ts": "",
      "src/vendor/h.ts": "",
      "tests/i.test.mjs": "",
      "cli/j.ts": "",
      "scripts/k.test.ts": "",
    });
  });

  afterEach(async () => {
    await Deno.remove(root, { recursive: true });
  });

  it("walks the deno.json test roots, applies the ignore policy, and sorts", async () => {
    const files = await walkRepo({
      scope: "test",
      select: isTestFile,
      repoRoot: root,
    });
    assertEquals(files.map((f) => f.relative), [
      "src/a.test.ts",
      "src/nested/c.test.tsx",
      "tests/i.test.mjs",
    ]);
    assertEquals(files[0]?.path, `${root}src/a.test.ts`);
  });

  it("walks the deno.json lint roots minus lint.exclude prefixes", async () => {
    const files = await walkRepo({
      scope: "lint",
      select: isSourceFile,
      repoRoot: root,
    });
    assertEquals(files.map((f) => f.relative), ["cli/j.ts", "src/b.ts"]);
  });

  it("accepts explicit roots and excludes", async () => {
    const files = await walkRepo({
      scope: { roots: ["src", "scripts"], excludes: ["src/nested/"] },
      select: isTestFile,
      repoRoot: root,
    });
    assertEquals(files.map((f) => f.relative), [
      "scripts/k.test.ts",
      "src/a.test.ts",
    ]);
  });

  it("fails loudly on a root that does not exist instead of scanning nothing", async () => {
    // The old scripts swallowed NotFound here and reported `0/N ok` from any
    // cwd that happened not to contain a `src` directory.
    await assertRejects(
      () =>
        walkRepo({
          scope: { roots: ["missing"] },
          select: () => true,
          repoRoot: root,
        }),
      MissingScanRoot,
      'Scan root "missing" does not exist',
    );
  });
});

describe("runRatchet", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRepo({
      "src/a.test.ts": "TODO\nok\nTODO",
      "src/b.test.ts": "TODO",
      "src/c.ts": "TODO",
      // Every declared root must exist, or the run is a configuration error.
      "tests/keep.txt": "",
    });
  });

  afterEach(async () => {
    await Deno.remove(root, { recursive: true });
  });

  const perFile = (overrides: Partial<RatchetSpec> = {}): RatchetSpec => ({
    label: "Todos",
    task: "lint:todos",
    scope: "test",
    select: isTestFile,
    scan: todoScan,
    baseline: { kind: "per-file", path: "todos.json" },
    advice: "Do the thing.",
    ...overrides,
  });

  it("passes and summarises when every key matches the baseline", async () => {
    await Deno.writeTextFile(
      `${root}todos.json`,
      '{"src/a.test.ts": 2, "src/b.test.ts": 1}',
    );
    const { stdout, stderr, io } = capture();
    assertEquals(await runRatchet(perFile(), { repoRoot: root, ...io }), 0);
    assertEquals(stderr, []);
    assertEquals(stdout, ["Todos baseline ok: 3 baselined across 2 file(s)."]);
  });

  it("fails on growth of a listed key and lists the offenders with file:line", async () => {
    await Deno.writeTextFile(
      `${root}todos.json`,
      '{"src/a.test.ts": 1, "src/b.test.ts": 1}',
    );
    const { stderr, io } = capture();
    assertEquals(await runRatchet(perFile(), { repoRoot: root, ...io }), 1);
    const text = stderr.join("\n");
    assertMatch(
      text,
      /Todos above the baseline:\n {2}src\/a\.test\.ts: 1 -> 2/,
    );
    assertMatch(
      text,
      /src\/a\.test\.ts:1 {2}todo\n {2}src\/a\.test\.ts:3 {2}todo/,
    );
    assertEquals(
      text.includes("src/b.test.ts:1"),
      false,
      "unchanged keys are not listed",
    );
    assertMatch(text, /Do the thing\.\nDo not raise todos\.json/);
  });

  it("fails on a key the baseline never listed", async () => {
    await Deno.writeTextFile(`${root}todos.json`, '{"src/a.test.ts": 2}');
    const { stderr, io } = capture();
    assertEquals(await runRatchet(perFile(), { repoRoot: root, ...io }), 1);
    assertMatch(stderr.join("\n"), /src\/b\.test\.ts: 0 -> 1/);
  });

  it("passes on improvement and prints how to lock in the new baseline", async () => {
    await Deno.writeTextFile(
      `${root}todos.json`,
      '{"src/a.test.ts": 2, "src/b.test.ts": 5}',
    );
    const { stdout, stderr, io } = capture();
    assertEquals(await runRatchet(perFile(), { repoRoot: root, ...io }), 0);
    assertEquals(stderr, []);
    assertEquals(stdout, [
      "Todos debt decreased:",
      "  src/b.test.ts: 5 -> 1",
      "Regenerate todos.json with `deno task lint:todos:update` to lock in the improvement.",
    ]);
  });

  it("prints the baseline the tree would lock in with --print-baseline", async () => {
    const { stdout, io } = capture();
    const code = await runRatchet(perFile(), {
      repoRoot: root,
      args: ["--print-baseline"],
      ...io,
    });
    assertEquals(code, 0);
    assertEquals(JSON.parse(stdout.join("\n")), {
      "src/a.test.ts": 2,
      "src/b.test.ts": 1,
    });
  });

  it("writes a JSON baseline with --update and warns when it raised a key", async () => {
    await Deno.writeTextFile(`${root}todos.json`, '{"src/a.test.ts": 1}');
    const { stderr, io } = capture();
    assertEquals(
      await runRatchet(perFile(), {
        repoRoot: root,
        args: ["--update"],
        ...io,
      }),
      0,
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${root}todos.json`)),
      { "src/a.test.ts": 2, "src/b.test.ts": 1 },
    );
    assertMatch(stderr.join("\n"), /2 key\(s\) were raised/);
  });

  it("fails with a configuration error when the baseline file is missing", async () => {
    const { stderr, io } = capture();
    assertEquals(await runRatchet(perFile(), { repoRoot: root, ...io }), 2);
    assertMatch(
      stderr.join("\n"),
      /todos\.json is missing — run with --update/,
    );
  });

  it("fails with a configuration error when a scan root is missing", async () => {
    const { stderr, io } = capture();
    const code = await runRatchet(perFile({ scope: { roots: ["nope"] } }), {
      repoRoot: root,
      ...io,
    });
    assertEquals(code, 2);
    assertMatch(stderr.join("\n"), /Scan root "nope" does not exist/);
  });

  it("rejects unknown flags", async () => {
    const { stderr, io } = capture();
    assertEquals(
      await runRatchet(perFile(), { repoRoot: root, args: ["--bogus"], ...io }),
      2,
    );
    assertMatch(stderr.join("\n"), /Unknown argument\(s\): --bogus/);
  });

  it("groups per-group-file keys by the finding's group", async () => {
    const spec = perFile({
      scan: (source, file) =>
        todoScan(source, file).map((f) => ({
          ...f,
          group: file.includes("a.") ? "ra" : "rb",
        })),
      baseline: { kind: "per-group-file", path: "todos.json" },
    });
    const { stdout, io } = capture();
    await runRatchet(spec, {
      repoRoot: root,
      args: ["--print-baseline"],
      ...io,
    });
    assertEquals(JSON.parse(stdout.join("\n")), {
      ra: { "src/a.test.ts": 2 },
      rb: { "src/b.test.ts": 1 },
    });
  });

  it("treats a blocking finding as a failure whatever the baseline says", async () => {
    await Deno.writeTextFile(
      `${root}todos.json`,
      '{"src/a.test.ts": 2, "src/b.test.ts": 1}',
    );
    const spec = perFile({
      scan: (source, file) => todoScan(source, file).map((f) => ({ ...f, blocking: f.line === 3 })),
      blockingTitle: "Never allowed:",
    });
    const { stderr, io } = capture();
    assertEquals(await runRatchet(spec, { repoRoot: root, ...io }), 1);
    assertMatch(
      stderr.join("\n"),
      /Never allowed:\n {2}src\/a\.test\.ts:3 {2}todo/,
    );
  });

  it("fails closed when a matcher cannot parse a file", async () => {
    await Deno.writeTextFile(`${root}todos.json`, "{}");
    const spec = perFile({
      scan: (_source, file) => {
        throw new ParseFailure(file, new Error("Unexpected token"));
      },
    });
    const { stderr, io } = capture();
    assertEquals(await runRatchet(spec, { repoRoot: root, ...io }), 1);
    assertMatch(
      stderr.join("\n"),
      /could not be parsed:\n {2}src\/a\.test\.ts: Unexpected token/,
    );
    assertEquals(
      await runRatchet(spec, { repoRoot: root, args: ["--update"], ...io }),
      1,
    );
  });

  describe("zero baseline", () => {
    const zero = (): RatchetSpec =>
      perFile({
        label: "Todos",
        baseline: { kind: "zero" },
        select: (p) => p.endsWith("c.ts"),
      });

    it("passes only when nothing is found", async () => {
      const { stdout, io } = capture();
      const clean = zero();
      clean.select = () => false;
      assertEquals(await runRatchet(clean, { repoRoot: root, ...io }), 0);
      assertEquals(stdout, ["Todos: none found."]);
    });

    it("fails and lists every finding otherwise", async () => {
      const { stderr, io } = capture();
      assertEquals(await runRatchet(zero(), { repoRoot: root, ...io }), 1);
      assertMatch(
        stderr.join("\n"),
        /Todos: 1 found \(none allowed\):\n {2}src\/c\.ts:1 {2}todo/,
      );
    });

    it("has nothing to print or update", async () => {
      const { io } = capture();
      assertEquals(
        await runRatchet(zero(), {
          repoRoot: root,
          args: ["--print-baseline"],
          ...io,
        }),
        2,
      );
      assertEquals(
        await runRatchet(zero(), { repoRoot: root, args: ["--update"], ...io }),
        2,
      );
    });
  });

  describe("total baseline", () => {
    let modulePath: string;

    beforeEach(async () => {
      modulePath = `${root}scripts/lint/todos.ts`;
      await Deno.mkdir(`${root}scripts/lint`, { recursive: true });
      await Deno.writeTextFile(modulePath, "export const TODO_BASELINE = 3;\n");
    });

    const total = (value: number): RatchetSpec =>
      perFile({
        baseline: {
          kind: "total",
          value,
          constant: "TODO_BASELINE",
          module: new URL(`file://${modulePath}`).href,
        },
      });

    it("passes at the baseline", async () => {
      const { stdout, io } = capture();
      assertEquals(await runRatchet(total(3), { repoRoot: root, ...io }), 0);
      assertEquals(stdout, ["Todos baseline ok: 3/3."]);
    });

    it("fails above it, listing every finding", async () => {
      const { stderr, io } = capture();
      assertEquals(await runRatchet(total(2), { repoRoot: root, ...io }), 1);
      const text = stderr.join("\n");
      assertMatch(text, /Todos 3 exceed baseline 2:/);
      assertMatch(text, /src\/a\.test\.ts:1 {2}todo/);
      assertMatch(text, /src\/b\.test\.ts:1 {2}todo/);
      assertMatch(text, /Do not raise scripts\/lint\/todos\.ts/);
    });

    it("names the constant to lower on improvement", async () => {
      const { stdout, io } = capture();
      assertEquals(await runRatchet(total(5), { repoRoot: root, ...io }), 0);
      assertEquals(stdout, [
        "Todos debt decreased:",
        "  total: 5 -> 3",
        "Lower TODO_BASELINE to 3 in scripts/lint/todos.ts to lock it in " +
        "(`deno task lint:todos:update` does it for you).",
      ]);
    });

    it("prints a bare integer with --print-baseline", async () => {
      const { stdout, io } = capture();
      await runRatchet(total(5), {
        repoRoot: root,
        args: ["--print-baseline"],
        ...io,
      });
      assertEquals(stdout, ["3"]);
    });

    it("rewrites the inline constant with --update", async () => {
      const { stdout, io } = capture();
      assertEquals(
        await runRatchet(total(5), {
          repoRoot: root,
          args: ["--update"],
          ...io,
        }),
        0,
      );
      assertEquals(
        await Deno.readTextFile(modulePath),
        "export const TODO_BASELINE = 3;\n",
      );
      assertEquals(stdout, [
        "Todos: set TODO_BASELINE = 3 in scripts/lint/todos.ts.",
      ]);
    });

    it("refuses to guess when the constant is not declared exactly once", async () => {
      await Deno.writeTextFile(modulePath, "const TODO_BASELINE = 3;\n");
      const { stderr, io } = capture();
      assertEquals(
        await runRatchet(total(5), {
          repoRoot: root,
          args: ["--update"],
          ...io,
        }),
        2,
      );
      assertMatch(stderr.join("\n"), /Set TODO_BASELINE to 3 by hand/);
    });
  });
});

describe("root resolution", () => {
  it("scans the repository from any cwd, never the process cwd", async () => {
    // Run a real ratchet with its cwd set to an empty temp directory. The old
    // scripts passed bare "src" to Deno.readDir, swallowed NotFound, and
    // printed `baseline ok: 0/N` from exactly this situation.
    const script = fromFileUrl(
      new URL("../../../../../scripts/lint/check-sanitizer-baseline.ts", import.meta.url),
    );
    const config = fromFileUrl(
      new URL("../../../../../scripts/test.deno.json", import.meta.url),
    );
    const cwd = await Deno.makeTempDir({ prefix: "ratchet-cwd-" });
    try {
      const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-read", `--config=${config}`, script],
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const out = new TextDecoder().decode(stdout);
      const err = new TextDecoder().decode(stderr);
      assertEquals(code, 0, `${out}\n${err}`);
      const match = out.match(/baseline ok: (\d+)\/(\d+)\./);
      assertEquals(match !== null, true, out);
      assertEquals(Number(match?.[1]) > 0, true, "scanned nothing");
      assertEquals(match?.[1], match?.[2]);
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  });
});
