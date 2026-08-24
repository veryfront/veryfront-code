import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { findFrontDoorBypasses, spec } from "./check-testing-front-door.ts";

const groupsOf = (source: string) =>
  findFrontDoorBypasses(source, "a.test.ts").map((finding) => finding.group);

describe("findFrontDoorBypasses", () => {
  describe("fetch-assignment", () => {
    it("counts a bare globalThis.fetch assignment", () => {
      const source = [
        "globalThis.fetch = () => Promise.resolve(new Response());",
      ].join("\n");
      assertEquals(groupsOf(source), ["fetch-assignment"]);
    });

    it("counts the restore assignment too", () => {
      const source = [
        "const original = globalThis.fetch;",
        "globalThis.fetch = stub;",
        "globalThis.fetch = original;",
      ].join("\n");
      assertEquals(groupsOf(source), ["fetch-assignment", "fetch-assignment"]);
    });

    it("counts an assignment through a cast", () => {
      const source = [
        "(globalThis as any).fetch = mock;",
      ].join("\n");
      assertEquals(groupsOf(source), ["fetch-assignment"]);
    });

    it("does not count comparisons or reads", () => {
      const source = [
        "if (globalThis.fetch === original) return;",
        "const current = globalThis.fetch;",
        "await globalThis.fetch(url);",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });

    it("does not count assignments to other objects' fetch", () => {
      const source = [
        "options.fetch = stub;",
        "transport.fetch = stub;",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });
  });

  describe("temp-dir", () => {
    it("counts raw Deno.makeTempDir calls, sync included", () => {
      const source = [
        'const dir = await Deno.makeTempDir({ prefix: "t-" });',
        "const sync = Deno.makeTempDirSync();",
      ].join("\n");
      assertEquals(groupsOf(source), ["temp-dir", "temp-dir"]);
    });

    it("does not count the shared helper of the same short name", () => {
      const source = [
        'import { makeTempDir } from "#veryfront/testing/deno-compat.ts";',
        "const dir = await makeTempDir();",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });
  });

  describe("local-helper", () => {
    it("counts function declarations of the shadowing names", () => {
      const source = [
        "function withTempDir(fn: () => void) {}",
        "async function waitFor(condition: () => boolean) {}",
        "function installDomGlobals(dom: JSDOM) {}",
        "function installDom(dom: JSDOM) {}",
      ].join("\n");
      assertEquals(groupsOf(source), [
        "local-helper",
        "local-helper",
        "local-helper",
        "local-helper",
      ]);
    });

    it("counts generic and const arrow declarations", () => {
      const source = [
        "function withTempDir<T>(fn: (dir: string) => T): T {}",
        "const waitFor = async () => {};",
      ].join("\n");
      assertEquals(groupsOf(source), ["local-helper", "local-helper"]);
    });

    it("names the shadowing helper in the message", () => {
      const findings = findFrontDoorBypasses(
        "function installDom(dom: JSDOM) {}",
        "a.test.ts",
      );
      assertEquals(findings[0]?.message.includes("installDom"), true);
    });

    it("does not count imports or destructuring of the same names", () => {
      const source = [
        'import { waitFor } from "#veryfront/testing/deno-compat.ts";',
        "const { withTempDir } = helpers;",
        "await waitFor(() => done);",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });

    it("does not count unrelated names that merely contain a watched one", () => {
      const source = [
        "function waitForServerReady() {}",
        "function installDomLater() {}",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });
  });

  describe("jsdom", () => {
    it("counts each JSDOM construction", () => {
      const source = [
        "const dom = new JSDOM(markup);",
        "const other = new JSDOM(",
        "  otherMarkup,",
        ");",
      ].join("\n");
      assertEquals(groupsOf(source), ["jsdom", "jsdom"]);
    });

    it("exempts a file that wires the DOM through the shared harness", () => {
      const source = [
        'import { installComponentDom } from "../../src/testing/dom-globals.ts";',
        "const dom = new JSDOM(markup);",
        "const restore = installComponentDom(dom);",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });

    it("exempts a construction passed directly to the harness", () => {
      const source = [
        "const restore = installComponentDom(new JSDOM(markup));",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });

    it("exempts a multi-line construction inside the harness call", () => {
      const source = [
        "const restore = installComponentDom(",
        "  new JSDOM(markup),",
        ");",
      ].join("\n");
      assertEquals(groupsOf(source), []);
    });

    it("keeps counting when the harness is absent", () => {
      const source = [
        "const dom = new JSDOM(markup);",
        "globalThis.document = dom.window.document;",
      ].join("\n");
      assertEquals(groupsOf(source), ["jsdom"]);
    });

    it("does not let an unused import exempt a hand-wired DOM", () => {
      const source = [
        'import { installComponentDom } from "../../src/testing/dom-globals.ts";',
        "const dom = new JSDOM(markup);",
        "globalThis.document = dom.window.document;",
      ].join("\n");
      assertEquals(groupsOf(source), ["jsdom"]);
    });

    it("does not let a comment mentioning the harness exempt anything", () => {
      const source = [
        "// wired through installComponentDom elsewhere",
        "const dom = new JSDOM(markup);",
      ].join("\n");
      assertEquals(groupsOf(source), ["jsdom"]);
    });

    it("keeps counting a hand-wired DOM beside a correctly wrapped one", () => {
      const source = [
        "const dom = new JSDOM(markup);",
        "const restore = installComponentDom(dom);",
        "const other = new JSDOM(otherMarkup);",
        "globalThis.document = other.window.document;",
      ].join("\n");
      const findings = findFrontDoorBypasses(source, "a.test.ts");
      assertEquals(
        findings.map((finding) => [finding.group, finding.line]),
        [["jsdom", 3]],
      );
    });
  });

  it("reports the 1-based line of each finding", () => {
    const source = [
      "/**",
      " * header",
      " */",
      "const dom = new JSDOM(markup);",
    ].join("\n");
    assertEquals(
      findFrontDoorBypasses(source, "a.test.ts").map((finding) => finding.line),
      [4],
    );
  });

  it("selects every executable test suffix tests/README.md documents", () => {
    for (
      const file of [
        "src/a.test.ts",
        "src/a.test.tsx",
        "tests/a.test.js",
        "tests/a.test.mjs",
        "tests/a.test.cjs",
        "tests/e2e/a.playwright.ts",
      ]
    ) {
      assertEquals(spec.select(file), true, file);
    }
    for (const file of ["src/a.ts", "src/a.spec.ts", "tests/a.playwright.js"]) {
      assertEquals(spec.select(file), false, file);
    }
  });

  it("ignores spellings inside comments and string literals", () => {
    const source = [
      "// globalThis.fetch = stub;",
      "/* const dir = await Deno.makeTempDir(); */",
      'const sample = "new JSDOM(";',
      "const tpl = `function installDom(`;",
    ].join("\n");
    assertEquals(groupsOf(source), []);
  });
});
