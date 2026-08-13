import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#std/path";
import {
  auditRepoMetaProperties,
  findBuildUnsafeMetaProperties,
  ParseFailure,
} from "./dnt-meta-property-safety.ts";

describe("DNT meta-property safety", () => {
  describe("findBuildUnsafeMetaProperties", () => {
    it("reports new.target, which DNT rewrites into the import.meta ponyfill", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "class Base extends Error {",
          "  constructor() {",
          "    super();",
          "    this.name = new.target.name;",
          "  }",
          "}",
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses.length, 1);
      assertEquals(uses[0]?.line, 4);
      assertEquals(uses[0]?.expression, "new.target");
    });

    it("accepts this.constructor, which survives the transform", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "class Base extends Error {",
          "  constructor() {",
          "    super();",
          "    this.name = this.constructor.name;",
          "  }",
          "}",
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("ignores new.target spelled inside comments and strings", () => {
      const uses = findBuildUnsafeMetaProperties(
        [
          "// never use new.target here",
          'const hint = "new.target is rewritten by DNT";',
        ].join("\n"),
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("leaves import.meta alone — the ponyfill is correct for it", () => {
      const uses = findBuildUnsafeMetaProperties(
        "export const here = import.meta.url;",
        "example.ts",
      );

      assertEquals(uses, []);
    });

    it("fails closed when a file cannot be parsed", () => {
      assertThrows(
        () => findBuildUnsafeMetaProperties("class {{{", "broken.ts"),
        ParseFailure,
      );
    });
  });

  it("finds no new.target anywhere in the shipped sources", async () => {
    const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
    const { uses, parseFailures } = await auditRepoMetaProperties(repoRoot);

    assertEquals(parseFailures, []);
    assertEquals(
      uses.map((use) => `${use.file}:${use.line}`),
      [],
      "DNT rewrites new.target into the import.meta ponyfill, so these are " +
        "silently broken in the published npm package. Use this.constructor.",
    );
  });
});
