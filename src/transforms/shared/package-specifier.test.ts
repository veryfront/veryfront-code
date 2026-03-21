import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseBarePackageSpecifier } from "./package-specifier.ts";

describe("parseBarePackageSpecifier", () => {
  it("parses unscoped packages with no version", () => {
    assertEquals(parseBarePackageSpecifier("lodash"), {
      packageName: "lodash",
      version: null,
      subpath: null,
    });
  });

  it("parses unscoped packages with version and subpath", () => {
    assertEquals(parseBarePackageSpecifier("lodash@4.17.21/fp"), {
      packageName: "lodash",
      version: "4.17.21",
      subpath: "/fp",
    });
  });

  it("parses scoped packages with version", () => {
    assertEquals(parseBarePackageSpecifier("@tanstack/react-query@5.94.4"), {
      packageName: "@tanstack/react-query",
      version: "5.94.4",
      subpath: null,
    });
  });

  it("parses scoped packages with subpaths", () => {
    assertEquals(parseBarePackageSpecifier("@scope/pkg@1.2.3/runtime"), {
      packageName: "@scope/pkg",
      version: "1.2.3",
      subpath: "/runtime",
    });
  });
});
