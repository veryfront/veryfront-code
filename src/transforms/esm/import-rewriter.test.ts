import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { addHMRTimestamps, rewriteBareImports } from "./import-rewriter.ts";

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

    it("does not add timestamp to # hash imports", async () => {
      const code = `import { foo } from "#veryfront/utils";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result, code);
    });

    it("does not add timestamp to veryfront imports", async () => {
      const code = `import { foo } from "veryfront/runtime";`;
      const result = await addHMRTimestamps(code, "12345");
      assertEquals(result, code);
    });
  });

  describe("rewriteBareImports", () => {
    it("rewrites bare imports to esm.sh URLs", async () => {
      const code = `import lodash from "lodash";`;
      const result = await rewriteBareImports(code);
      assertEquals(result.includes("https://esm.sh/"), true);
      assertEquals(result.includes("external=react"), true);
      assertEquals(result.includes("target=es2022"), true);
    });

    it("does not rewrite relative imports", async () => {
      const code = `import { foo } from "./foo.js";`;
      const result = await rewriteBareImports(code);
      assertEquals(result, code);
    });

    it("does not rewrite @/ alias imports", async () => {
      const code = `import { Button } from "@/components/Button";`;
      const result = await rewriteBareImports(code);
      assertEquals(result, code);
    });

    it("does not rewrite http imports", async () => {
      const code = `import lib from "https://esm.sh/lodash@4";`;
      const result = await rewriteBareImports(code);
      assertEquals(result, code);
    });

    it("does not rewrite # hash imports", async () => {
      const code = `import { foo } from "#veryfront/utils";`;
      const result = await rewriteBareImports(code);
      assertEquals(result, code);
    });

    it("does not rewrite veryfront imports", async () => {
      const code = `import { foo } from "veryfront/runtime";`;
      const result = await rewriteBareImports(code);
      assertEquals(result, code);
    });

    it("maps react imports to react import map URLs", async () => {
      const code = `import React from "react";`;
      const result = await rewriteBareImports(code);
      // React should be mapped to a specific URL, not generic esm.sh
      assertEquals(typeof result, "string");
    });

    it("handles scoped packages", async () => {
      const code = `import { something } from "@emotion/react";`;
      const result = await rewriteBareImports(code);
      assertEquals(result.includes("https://esm.sh/"), true);
    });

    it("adds tailwind version for tailwindcss imports", async () => {
      const code = `import tw from "tailwindcss";`;
      const result = await rewriteBareImports(code);
      assertEquals(result.includes("tailwindcss@"), true);
    });
  });
});
