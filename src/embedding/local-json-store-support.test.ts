import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLocalJsonStoreUnsupportedDetail } from "./local-json-store-support.ts";

describe("local JSON RAG store support", () => {
  it("diagnoses unsupported Deno and Bun Windows persistence explicitly", () => {
    for (const runtime of ["deno", "bun"] as const) {
      const detail = getLocalJsonStoreUnsupportedDetail(runtime, "windows");
      assertEquals(detail?.includes(`${runtime === "deno" ? "Deno" : "Bun"} for Windows`), true);
      assertEquals(detail?.includes("verified file-snapshot reads"), true);
      assertEquals(detail?.includes("Use Node.js on Windows"), true);
      assertEquals(detail?.includes("veryfront-cloud"), true);
    }
  });

  it("does not reject supported runtime and operating-system pairs", () => {
    assertEquals(getLocalJsonStoreUnsupportedDetail("node", "windows"), null);
    assertEquals(getLocalJsonStoreUnsupportedDetail("deno", "linux"), null);
    assertEquals(getLocalJsonStoreUnsupportedDetail("bun", "darwin"), null);
  });
});
