import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { verifyOperatorRunTerminalToken } from "./auth.ts";

Deno.test("operator terminal verifier rejects an unsigned capability", async () => {
  assertEquals(
    await verifyOperatorRunTerminalToken({
      token: "header.payload.signature",
      projectId: "10000000-1000-4000-8000-100000000005",
      runId: "run_ordinary_root",
    }),
    false,
  );
});
