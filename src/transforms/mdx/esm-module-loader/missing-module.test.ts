import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildMissingModuleError } from "./missing-module.ts";

describe("transforms/mdx/esm-module-loader/missing-module", () => {
  describe("buildMissingModuleError", () => {
    it("returns an Error instance", () => {
      const err = buildMissingModuleError({ modulePath: "lib/utils.ts" });
      assertEquals(err instanceof Error, true);
    });

    it("sets name to MissingModuleError", () => {
      const err = buildMissingModuleError({ modulePath: "lib/utils.ts" });
      assertEquals(err.name, "MissingModuleError");
    });

    it("includes module path in message", () => {
      const err = buildMissingModuleError({ modulePath: "components/Button.tsx" });
      assertEquals(err.message.includes("components/Button.tsx"), true);
    });

    it("includes importer when provided", () => {
      const err = buildMissingModuleError({
        modulePath: "lib/utils.ts",
        importer: "my-project",
      });
      assertEquals(err.message.includes("my-project"), true);
    });

    it("provides suggestion for lib/utils", () => {
      const err = buildMissingModuleError({
        modulePath: "lib/utils.ts",
      });
      assertEquals(err.message.includes("lib/utils"), true);
      assertEquals(err.message.includes("Suggestion"), true);
    });

    it("provides generic suggestion for non-lib/utils modules", () => {
      const err = buildMissingModuleError({
        modulePath: "components/Button.tsx",
      });
      assertEquals(err.message.includes("Ensure the file exists"), true);
    });

    it("provides lib/utils suggestion without cn", () => {
      const err = buildMissingModuleError({
        modulePath: "lib/utils.ts",
        code: `import { foo } from "@/lib/utils";`,
        importStatement: `import { foo } from "@/lib/utils"`,
      });
      assertEquals(err.message.includes("lib/utils"), true);
    });
  });
});
