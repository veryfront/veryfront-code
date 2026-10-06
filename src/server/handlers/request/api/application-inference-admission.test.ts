import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "#veryfront/types";
import { createHostApplicationInferenceAdmission } from "./application-inference-admission.ts";

const names = ["VERYFRONT_API_INTERNAL_USER", "VERYFRONT_API_INTERNAL_PASS"];
const original = names.map((name) => getEnv(name));
function context(): HandlerContext {
  return {
    projectDir: "/synthetic-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    projectId: "11111111-1111-4111-8111-111111111111",
    projectSlug: "synthetic-project",
    releaseId: "22222222-2222-4222-8222-222222222222",
    environmentName: "production",
    resolvedEnvironment: "production",
  };
}
describe("host application inference admission", () => {
  afterEach(() => {
    names.forEach((name, index) => {
      const value = original[index];
      if (value === undefined) deleteEnv(name);
      else setEnv(name, value);
    });
  });
  it("keeps local model authentication unchanged", () => {
    assertEquals(
      createHostApplicationInferenceAdmission(
        new Request("https://synthetic.example.test/api/ag-ui"),
        { ...context(), isLocalProject: true },
      ),
      undefined,
    );
  });
  it("fails closed when host admission credentials are missing", async () => {
    names.forEach(deleteEnv);
    const admit = createHostApplicationInferenceAdmission(
      new Request("https://synthetic.example.test/api/ag-ui"),
      context(),
    );
    if (!admit) throw new Error("Expected hosted admission");
    await assertRejects(() => admit("assistant"), Error, "admission is unavailable");
  });
  it("rejects an oversized response instead of retaining an unbounded token", async () => {
    setEnv(names[0]!, "synthetic-user");
    setEnv(names[1]!, "synthetic-password");
    await withMockFetch(() => Promise.resolve(new Response("x".repeat(40_001))), async () => {
      const admit = createHostApplicationInferenceAdmission(
        new Request("https://synthetic.example.test/api/ag-ui"),
        context(),
      );
      if (!admit) throw new Error("Expected hosted admission");
      await assertRejects(() => admit("assistant"), Error, "exceeded its limit");
    });
  });
});
