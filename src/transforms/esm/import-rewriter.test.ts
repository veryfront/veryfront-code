import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { addHMRTimestamps } from "./import-rewriter.ts";

describe("transforms/esm/import-rewriter", () => {
  describe("addHMRTimestamps", () => {
    it("adds timestamp to relative import", async () => {
      const code = `import { foo } from "./utils.js";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result.includes("./utils.js?t=12345"), true);
    });

    it("adds timestamp to parent relative import", async () => {
      const code = `import { bar } from "../lib/helper.js";`;
      const result = await addHMRTimestamps(code, "99999");
      assertEquals(result.includes("../lib/helper.js?t=99999"), true);
    });

    it("adds timestamp to absolute path import", async () => {
      const code = `import { baz } from "/app/utils.js";`;
      const result = await addHMRTimestamps(code, "11111");
      assertEquals(result.includes("/app/utils.js?t=11111"), true);
    });

    it("adds timestamp to @/ alias import", async () => {
      const code = `import { Button } from "@/components/Button";`;
      const result = await addHMRTimestamps(code, "22222");
      assertEquals(result.includes("@/components/Button?t=22222"), true);
    });

    it("does not add timestamp to bare import", async () => {
      const code = `import React from "react";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result, code);
    });

    it("does not add timestamp to http import", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result, code);
    });

    it("does not double-add timestamp", async () => {
      const code = `import { foo } from "./utils.js?t=11111";`;
      const result = await addHMRTimestamps(code, "22222");
      assertEquals(result, code);
    });

    it("handles code with no imports", async () => {
      const code = `const x = 1;`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result, code);
    });

    it("uses & separator when URL already has query params", async () => {
      const code = `import { foo } from "./utils.js?v=1";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result.includes("./utils.js?v=1&t=12345"), true);
    });
  });
});
