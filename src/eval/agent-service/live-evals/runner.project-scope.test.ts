import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLiveEvalCaseSupport, type LiveEvalCase } from "./runner.ts";

function completedResponse(): Response {
  return new Response(
    'data: {"type":"RUN_STARTED","runId":"scope-run"}\n\n' +
      'data: {"type":"RUN_FINISHED","runId":"scope-run"}\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("live eval project scope", () => {
  for (const requireProject of [undefined, false, true]) {
    it(`preserves the configured project when requireProject is ${requireProject}`, async () => {
      let forwardedProps: unknown;
      const support = createLiveEvalCaseSupport({
        endpoint: "http://127.0.0.1:4311/api/ag-ui",
        apiUrl: "https://api.example.test",
        authToken: "fixture",
        projectId: "11111111-1111-4111-8111-111111111111",
        branchId: null,
        model: null,
        requestTimeoutMs: 1000,
        progressLogIntervalMs: 1000,
        enableLlmJudge: false,
        log: () => {},
        fetch: (_url, init) => {
          const body: unknown = JSON.parse(String(init?.body));
          if (typeof body === "object" && body !== null && "forwardedProps" in body) {
            forwardedProps = body.forwardedProps;
          }
          return Promise.resolve(completedResponse());
        },
      });
      const testCase: LiveEvalCase = {
        id: "read-only-managed-inference",
        label: "Read-only managed inference",
        prompt: "Reply with OK",
        ...(requireProject === undefined ? {} : { requireProject }),
        verify: () => null,
      };
      const result = await support.runEval(testCase, "framework");
      assertEquals(result.status, "pass");
      assertEquals(forwardedProps, {
        veryfront: { projectId: "11111111-1111-4111-8111-111111111111" },
      });
    });
  }
});
