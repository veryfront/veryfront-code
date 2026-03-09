import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasHttpImports } from "./http-bundler.ts";

describe("transforms/esm/http-bundler", () => {
  describe("hasHttpImports", () => {
    it("returns true for code with https import", () => {
      assertEquals(hasHttpImports(`import React from "https://esm.sh/react@18";`), true);
    });

    it("returns true for code with http import", () => {
      assertEquals(hasHttpImports(`import lib from "http://cdn.com/lib.js";`), true);
    });

    it("returns true for single-quoted https import", () => {
      assertEquals(hasHttpImports(`import React from 'https://esm.sh/react@18';`), true);
    });

    it("returns false for code with no http imports", () => {
      assertEquals(hasHttpImports(`import React from "react";`), false);
    });

    it("returns false for empty string", () => {
      assertEquals(hasHttpImports(""), false);
    });

    it("returns false for http URL not in quotes", () => {
      assertEquals(hasHttpImports("// https://esm.sh/react"), false);
    });

    it("returns true for dynamic import with http URL", () => {
      assertEquals(hasHttpImports(`const m = import("https://esm.sh/react");`), true);
    });
  });
});
