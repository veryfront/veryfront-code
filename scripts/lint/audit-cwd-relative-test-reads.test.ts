import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  callbackCountsByFile,
  compareCallbackBaseline,
  findCwdRelativeReads,
  parseBaseline,
  ParseFailure,
  toRepoRelative,
} from "./audit-cwd-relative-test-reads.ts";

const scopesOf = (source: string) =>
  findCwdRelativeReads(source, "a.test.ts").map((read) => read.scope);

describe("findCwdRelativeReads", () => {
  it("reports a cwd-relative read at module scope", () => {
    const source = `
const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
Deno.test("x", () => {});
`;
    const reads = findCwdRelativeReads(source, "a.test.ts");

    assertEquals(reads.length, 1);
    assertEquals(reads[0]?.path, ".github/workflows/cicd.yml");
    assertEquals(reads[0]?.call, "Deno.readTextFile");
    assertEquals(reads[0]?.line, 2);
    assertEquals(reads[0]?.scope, "module");
  });

  it("reports a multiline call the line-based matcher could not see", () => {
    // `deno fmt` breaks longer calls across lines, so the path never shares a
    // line with the callee. A regex over single lines misses this entirely and
    // a module-scope offender walks straight through the CI gate.
    const source = `
const workflow = await Deno.readTextFile(
  ".github/workflows/cicd.yml",
);
`;
    const reads = findCwdRelativeReads(source, "a.test.ts");

    assertEquals(reads.length, 1);
    assertEquals(reads[0]?.scope, "module");
    assertEquals(reads[0]?.path, ".github/workflows/cicd.yml");
  });

  it("reports a read in a top-level object initializer as module scope", () => {
    // Delimiter depth is not execution scope: this sits at depth > 0 but still
    // runs during module evaluation, so a throw is still an uncaught module
    // error that fails the whole shard.
    const source = `
const fixtures = {
  workflow: await Deno.readTextFile("deno.json"),
};
`;
    const reads = findCwdRelativeReads(source, "a.test.ts");

    assertEquals(reads.length, 1);
    assertEquals(reads[0]?.scope, "module");
  });

  it("reports a read in a class static block as module scope", () => {
    const source = `
class Fixtures {
  static source = "";
  static { Deno.readTextFileSync("deno.json"); }
}
`;
    assertEquals(scopesOf(source), ["module"]);
  });

  it("reports a read in a directly invoked function expression as module scope", () => {
    // An IIFE is a function node, but it runs during module evaluation, so a
    // throw inside it is still an uncaught module error. Treating it as a
    // deferred callback would let the baseline tier absorb a shard-killer.
    const source = `
const workflow = (() => Deno.readTextFileSync("deno.json"))();
`;
    assertEquals(scopesOf(source), ["module"]);
  });

  it("reports a read in an async IIFE as module scope", () => {
    const source = `
await (async function () {
  await Deno.readTextFile("deno.json");
})();
`;
    assertEquals(scopesOf(source), ["module"]);
  });

  it("keeps a callback passed to a directly invoked function deferred", () => {
    // The IIFE itself runs now; a function it merely receives does not.
    const source = `
(() => {
  Deno.test("x", async () => {
    await Deno.readTextFile("deno.json");
  });
})();
`;
    assertEquals(scopesOf(source), ["callback"]);
  });

  it("classifies a read in an inline single-line test callback as callback scope", () => {
    // The old depth counter matched before updating the line's depth, so this
    // was reported as a module-scope offender it never was.
    const source = `
Deno.test("x", () => { Deno.readTextFileSync("deno.json"); });
`;
    assertEquals(scopesOf(source), ["callback"]);
  });

  it("classifies a read in a multiline test body as callback scope", () => {
    // Still racy — a sibling isolate can hold withCwd while this body runs —
    // but the throw is one legible failing test rather than a dead module, so
    // it belongs in the baseline tier rather than the hard-failure tier.
    const source = `
Deno.test("x", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
});
`;
    assertEquals(scopesOf(source), ["callback"]);
  });

  it("reports module and callback reads from the same file separately", () => {
    const source = `
const early = await Deno.readTextFile("deno.json");
Deno.test("x", async () => {
  await Deno.readTextFile("deno.lock");
});
const late = await Deno.readTextFile("import_map.json");
`;
    assertEquals(scopesOf(source), ["module", "callback", "module"]);
  });

  it("allows a read resolved from import.meta.url", () => {
    // The prescribed fix must not trip the rule that prescribes it.
    const source = `
const repoRoot = new URL("../../", import.meta.url);
const workflow = await Deno.readTextFile(new URL("deno.json", repoRoot));
`;
    assertEquals(findCwdRelativeReads(source, "a.test.ts"), []);
  });

  it("allows absolute and url paths", () => {
    const source = `
const a = await Deno.readTextFile("/etc/hosts");
const b = await Deno.readTextFile("file:///tmp/x");
`;
    assertEquals(findCwdRelativeReads(source, "a.test.ts"), []);
  });

  it("ignores matches inside line, block, and doc comments", () => {
    const source = `
// const bad = await Deno.readTextFile("deno.json");
/* const alsoBad = await Deno.readTextFile("deno.json"); */
/**
 * const docBad = await Deno.readTextFile("deno.json");
 */
`;
    assertEquals(findCwdRelativeReads(source, "a.test.ts"), []);
  });

  it("ignores reads spelled inside string literals", () => {
    const source = `
const sample = 'await Deno.readTextFile("deno.json")';
`;
    assertEquals(findCwdRelativeReads(source, "a.test.ts"), []);
  });

  it("covers the sync and directory read variants", () => {
    const source = `
const a = Deno.readTextFileSync("deno.json");
const b = Deno.readDir("src");
`;
    assertEquals(scopesOf(source), ["module", "module"]);
  });

  it("watches the runtime-neutral compat reader that src tests are pushed towards", () => {
    // Tests under src/ avoid the Deno global, so the compat module is where the
    // next offender would appear. Same race, so same rule.
    const source = `
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
const workflow = await readTextFile("deno.json");
`;
    const reads = findCwdRelativeReads(source, "a.test.ts");

    assertEquals(reads.length, 1);
    assertEquals(reads[0]?.call, "readTextFile");
    assertEquals(reads[0]?.scope, "module");
  });

  it("watches a namespace import of the compat reader", () => {
    const source = `
import * as fs from "#veryfront/platform/compat/fs.ts";
const workflow = await fs.readTextFile("deno.json");
`;
    assertEquals(scopesOf(source), ["module"]);
  });

  it("leaves a local helper that merely shares a name alone", () => {
    // Matching on the import binding rather than the identifier keeps unrelated
    // helpers out of the report.
    const source = `
const readTextFile = (path: string) => path;
const value = readTextFile("deno.json");
`;
    assertEquals(findCwdRelativeReads(source, "a.test.ts"), []);
  });

  it("fails closed when a file cannot be parsed", () => {
    assertThrows(
      () => findCwdRelativeReads("const = ;", "a.test.ts"),
      ParseFailure,
    );
  });
});

describe("callbackCountsByFile", () => {
  it("counts callback reads per file and ignores module-scope ones", () => {
    const reads = findCwdRelativeReads(
      `
const early = await Deno.readTextFile("deno.json");
Deno.test("x", async () => {
  await Deno.readTextFile("deno.lock");
  await Deno.readTextFile("import_map.json");
});
`,
      "a.test.ts",
    );

    assertEquals(callbackCountsByFile(reads), { "a.test.ts": 2 });
  });
});

describe("compareCallbackBaseline", () => {
  it("passes when every file matches its recorded count", () => {
    assertEquals(
      compareCallbackBaseline({ "a.test.ts": 2 }, { "a.test.ts": 2 }),
      { regressions: [], improvements: [] },
    );
  });

  it("fails when an already-baselined file grows a new racy read", () => {
    // Gating only the set of files would let existing offenders accumulate
    // freely — the ratchet has to hold the count.
    assertEquals(
      compareCallbackBaseline({ "a.test.ts": 3 }, { "a.test.ts": 2 })
        .regressions,
      ["a.test.ts: 2 -> 3"],
    );
  });

  it("fails when a file not in the baseline gains a racy read", () => {
    assertEquals(
      compareCallbackBaseline({ "b.test.ts": 1 }, {}).regressions,
      ["b.test.ts: 0 -> 1"],
    );
  });

  it("reports a shrinking count as an improvement, not a failure", () => {
    const comparison = compareCallbackBaseline({ "a.test.ts": 1 }, {
      "a.test.ts": 2,
    });

    assertEquals(comparison.regressions, []);
    assertEquals(comparison.improvements, ["a.test.ts: 2 -> 1"]);
  });

  it("reports a fully fixed file as an improvement", () => {
    assertEquals(
      compareCallbackBaseline({}, { "a.test.ts": 2 }).improvements,
      ["a.test.ts: 2 -> 0"],
    );
  });
});

describe("toRepoRelative", () => {
  it("strips the repo root", () => {
    assertEquals(
      toRepoRelative("/repo/src/a.test.ts", "/repo/"),
      "src/a.test.ts",
    );
  });

  it("reports posix separators so the baseline is portable", () => {
    // The baseline is committed and compared by key, so a Windows checkout must
    // produce the same keys a Linux one does.
    assertEquals(
      toRepoRelative("C:\\repo\\src\\a.test.ts", "C:\\repo\\"),
      "src/a.test.ts",
    );
  });
});

describe("parseBaseline", () => {
  it("accepts a file-to-count record", () => {
    assertEquals(parseBaseline({ "a.test.ts": 2 }, "b.json"), {
      "a.test.ts": 2,
    });
  });

  it("rejects a shape that is not a file-to-count record", () => {
    assertThrows(() => parseBaseline(["a.test.ts"], "b.json"), Error);
    assertThrows(() => parseBaseline({ "a.test.ts": 0 }, "b.json"), Error);
    assertThrows(() => parseBaseline({ "a.test.ts": "2" }, "b.json"), Error);
  });
});
