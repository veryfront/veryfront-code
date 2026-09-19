import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectEmbeddedNpmConstraints,
  collectEmbeddedNpmPackages,
} from "./generate-embedded-npm-packages.ts";

const LOCK = JSON.stringify({
  version: "5",
  specifiers: {
    "npm:yaml@2.9.0": "2.9.0",
    "npm:playwright@*": "1.60.0",
    "npm:playwright@1.59.0": "1.59.0",
    "npm:@scope/pkg@^1.2.0": "1.4.0",
    "npm:constructor@1.0.0": "1.0.0",
    // A dist-tag may contain an underscore; only a package key's peer suffix
    // (`react-dom@19.2.0_react@19.2.0`) is cut at one.
    "npm:tagged@release_candidate": "3.0.0",
    "jsr:@std/path@1": "1.1.4",
  },
  npm: {
    "yaml@2.9.0": {},
    "playwright@1.59.0": {},
    "playwright@1.60.0": {},
    "@scope/pkg@1.4.0": {},
    "constructor@1.0.0": {},
    "ms@2.1.3": {},
    "react-dom@19.2.0_react@19.2.0": {},
    "tagged@3.0.0": {},
  },
});

describe("generate-embedded-npm-packages", () => {
  it("groups every carried version by name", () => {
    assertEquals(collectEmbeddedNpmPackages(LOCK), {
      yaml: ["2.9.0"],
      playwright: ["1.59.0", "1.60.0"],
      "@scope/pkg": ["1.4.0"],
      constructor: ["1.0.0"],
      ms: ["2.1.3"],
      "react-dom": ["19.2.0"],
      tagged: ["3.0.0"],
    });
  });

  it("keeps only the npm constraints an import can use", () => {
    // `ms` is carried only transitively, so no import constraint names it.
    assertEquals(collectEmbeddedNpmConstraints(LOCK), {
      yaml: ["2.9.0"],
      playwright: ["*", "1.59.0"],
      "@scope/pkg": ["^1.2.0"],
      constructor: ["1.0.0"],
      tagged: ["release_candidate"],
    });
  });

  it("treats a package named after an Object.prototype key as an ordinary entry", () => {
    const packages = collectEmbeddedNpmPackages(LOCK);
    assertEquals(Object.hasOwn(packages, "constructor"), true);
    const name: string = "constructor";
    assertEquals(packages[name], ["1.0.0"]);
    assertEquals(Object.getPrototypeOf(packages), Object.prototype);
  });
});
