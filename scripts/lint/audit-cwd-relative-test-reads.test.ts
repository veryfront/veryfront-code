import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findOffenders } from "./audit-cwd-relative-test-reads.ts";

describe("audit-cwd-relative-test-reads", () => {
  it("flags a cwd-relative read at module scope", () => {
    const source = `
const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
Deno.test("x", () => {});
`;
    const offenders = findOffenders(source, "a.test.ts");

    assertEquals(offenders.length, 1);
    assertEquals(offenders[0]?.path, ".github/workflows/cicd.yml");
    assertEquals(offenders[0]?.call, "readTextFile");
    assertEquals(offenders[0]?.line, 2);
  });

  it("allows the same read inside a test body", () => {
    // By the time a test body runs the module has loaded, so a throw is a
    // normal test failure rather than an uncaught module error that fails the
    // whole shard.
    const source = `
Deno.test("x", async () => {
  const workflow = await Deno.readTextFile(".github/workflows/cicd.yml");
});
`;
    assertEquals(findOffenders(source, "a.test.ts"), []);
  });

  it("allows a read resolved from import.meta.url", () => {
    // The prescribed fix must not trip the rule that prescribes it.
    const source = `
const repoRoot = new URL("../../", import.meta.url);
const workflow = await Deno.readTextFile(new URL("deno.json", repoRoot));
`;
    assertEquals(findOffenders(source, "a.test.ts"), []);
  });

  it("allows absolute and url paths", () => {
    const source = `
const a = await Deno.readTextFile("/etc/hosts");
const b = await Deno.readTextFile("file:///tmp/x");
`;
    assertEquals(findOffenders(source, "a.test.ts"), []);
  });

  it("ignores matches inside line, block, and doc comments", () => {
    const source = `
// const bad = await Deno.readTextFile("deno.json");
/* const alsoBad = await Deno.readTextFile("deno.json"); */
/**
 * const docBad = await Deno.readTextFile("deno.json");
 */
`;
    assertEquals(findOffenders(source, "a.test.ts"), []);
  });

  it("flags a module-scope read that follows a closed test block", () => {
    // Depth must return to zero after a test body, or every offender after the
    // first test in a file would be missed.
    const source = `
Deno.test("first", () => {
  const ok = 1;
});
const late = await Deno.readTextFile("deno.json");
`;
    const offenders = findOffenders(source, "a.test.ts");

    assertEquals(offenders.length, 1);
    assertEquals(offenders[0]?.path, "deno.json");
  });

  it("covers the sync and directory read variants", () => {
    const source = `
const a = Deno.readTextFileSync("deno.json");
const b = Deno.readDir("src");
`;
    assertEquals(findOffenders(source, "a.test.ts").length, 2);
  });
});
