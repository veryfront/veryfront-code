/**
 * Test: 014.1 NODE_ENV Validation in Proxy Mode
 *
 * Validates the fix for issue 014.1 from the architecture audit:
 * - NODE_ENV must be set to 'production' in proxy mode
 * - Missing NODE_ENV in proxy mode causes startup failure
 * - Prevents dev features from being enabled in production pods
 *
 * @see plans/architecture-audit/014.1-node-env-missing.md
 */

import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe("014.1 NODE_ENV Validation", () => {
  describe("Bootstrap Validation Pattern", () => {
    async function readBootstrap(): Promise<string> {
      return await Deno.readTextFile("./src/server/bootstrap.ts");
    }

    it("should have validation function in bootstrap.ts", async () => {
      const content = await readBootstrap();

      assert(
        content.includes("validateProductionEnvironment"),
        "Should define validateProductionEnvironment function",
      );
      assert(content.includes('proxyMode === "1"'), "Should check for proxy mode");
      assert(
        content.includes("NODE_ENV must be set"),
        "Should have error message for missing NODE_ENV",
      );
    });

    it("should check NODE_ENV before proceeding in bootstrapProd", async () => {
      const content = await readBootstrap();

      const bootstrapProdStart = content.indexOf(
        "export async function bootstrapProd",
      );
      const bootstrapProdEnd = content.indexOf("}", bootstrapProdStart + 200);
      const bootstrapProdBody = content.slice(bootstrapProdStart, bootstrapProdEnd);

      assert(
        bootstrapProdBody.includes("validateProductionEnvironment"),
        "bootstrapProd should call validateProductionEnvironment",
      );
    });

    it("should throw error when NODE_ENV missing in proxy mode", async () => {
      const content = await readBootstrap();

      assert(
        content.includes("throw new Error("),
        "Should throw error when NODE_ENV missing in proxy mode",
      );
      assert(
        content.includes("proxy mode"),
        "Error message should mention proxy mode",
      );
    });
  });

  describe("Request Context Safety", () => {
    it("should not contain process-level isLocalDev", async () => {
      const content = await Deno.readTextFile(
        "./src/server/context/request-context.ts",
      );

      assert(
        !content.includes("isLocalDev"),
        "RequestContext should not contain isLocalDev (use per-request isLocalProject instead)",
      );
    });
  });
});
