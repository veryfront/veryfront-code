import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { addHMRTimestamps, rewriteBareImports } from "./import-rewriter.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./react-cdn.ts";

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
      assertEquals(
        result,
        `import lodash from "https://esm.sh/lodash?external=react&target=es2022";`,
        "a bare specifier must produce the documented esm.sh URL",
      );
    });

    it("preserves a pinned version when building the esm.sh URL", async () => {
      const code = `import l from "lodash@4.17.21";`;
      const result = await rewriteBareImports(code);
      assertEquals(
        result,
        `import l from "https://esm.sh/lodash@4.17.21?external=react&target=es2022";`,
        "an inline pin must survive into the esm.sh URL so the output stays reproducible",
      );
    });

    it("preserves a pinned version on a subpath import", async () => {
      const result = await rewriteBareImports(`import d from "lodash@4.17.21/debounce";`);
      assertEquals(
        result,
        `import d from "https://esm.sh/lodash@4.17.21/debounce?external=react&target=es2022";`,
        "a pinned subpath import must keep both the pin and the subpath",
      );
    });

    it("preserves a dist-tag version", async () => {
      const result = await rewriteBareImports(`import l from "lodash@next";`);
      assertEquals(
        result,
        `import l from "https://esm.sh/lodash@next?external=react&target=es2022";`,
        "a dist-tag pin must reach esm.sh unchanged",
      );
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
      const reactImportMap = getReactImportMap(DEFAULT_REACT_VERSION);

      const result = await rewriteBareImports(`import React from "react";`);
      assertEquals(
        result,
        `import React from "${reactImportMap.react}";`,
        "react must resolve through the react import map, not the generic esm.sh fallback",
      );
      assertEquals(
        result.includes("external=react"),
        false,
        "react must not be made external to itself",
      );

      const clientResult = await rewriteBareImports(
        `import { createRoot } from "react-dom/client";`,
      );
      assertEquals(
        clientResult,
        `import { createRoot } from "${reactImportMap["react-dom/client"]}";`,
        "react-dom/client must resolve through the react import map too",
      );
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
