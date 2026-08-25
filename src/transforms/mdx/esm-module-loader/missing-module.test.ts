import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { buildMissingModuleError } from "./missing-module.ts";

describe("transforms/mdx/esm-module-loader/missing-module", () => {
  describe("buildMissingModuleError", () => {
    it("returns the registered MODULE_NOT_FOUND error", () => {
      const err = buildMissingModuleError({ modulePath: "lib/utils.ts" });
      assertEquals(err instanceof Error, true);
      assertEquals(
        err instanceof VeryfrontError,
        true,
        "missing-module errors must be registry VeryfrontErrors",
      );
      assertEquals(
        (err as VeryfrontError).slug,
        "module-not-found",
        "a missing module is classified with the module-not-found slug",
      );
      assertEquals(
        (err as VeryfrontError).status,
        404,
        "a missing module maps to HTTP 404",
      );
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
        importStatement: `from "@/lib/utils"`,
      });
      assertStringIncludes(
        err.message,
        "Suggestion: Add lib/utils.ts or update the import path.",
        "non-cn lib/utils imports must get the generic add-file advice",
      );
      assertStringIncludes(
        err.message,
        "Missing exports: foo.",
        "named imports must be listed in the error",
      );
    });

    it("provides the cn-specific lib/utils suggestion", () => {
      const err = buildMissingModuleError({
        modulePath: "lib/utils.ts",
        code: `import { cn } from "@/lib/utils";`,
        importStatement: `from "@/lib/utils"`,
      });
      assertStringIncludes(
        err.message,
        "Suggestion: Add lib/utils.ts exporting `cn`, or remove the `cn` import.",
        "a cn import must get the cn-specific advice",
      );
      assertStringIncludes(
        err.message,
        "Missing exports: cn.",
        "named imports must be listed in the error",
      );
    });
  });
});
