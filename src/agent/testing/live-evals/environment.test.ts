import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveLiveEvalEnvironment } from "./environment.ts";

describe("agent testing live eval environment", () => {
  it("falls back to config API URL when shell env is unset", () => {
    assertEquals(resolveLiveEvalEnvironment({ VERYFRONT_TOKEN: "tok" }), {
      endpoint: "http://127.0.0.1:3001/api/ag-ui",
      authToken: "tok",
      apiUrl: "https://api.veryfront.com",
      projectId: undefined,
      branchId: undefined,
      model: undefined,
    });
  });

  it("prefers explicit shell overrides when provided", () => {
    assertEquals(
      resolveLiveEvalEnvironment({
        AG_UI_EVAL_ENDPOINT: "https://endpoint.test/ag-ui",
        VERYFRONT_TOKEN: "tok",
        VERYFRONT_API_URL: "https://api.override.test",
        AG_UI_EVAL_PROJECT_ID: "proj",
        AG_UI_EVAL_BRANCH_ID: "branch",
        AG_UI_EVAL_MODEL: "gpt-test",
      }),
      {
        endpoint: "https://endpoint.test/ag-ui",
        authToken: "tok",
        apiUrl: "https://api.override.test",
        projectId: "proj",
        branchId: "branch",
        model: "gpt-test",
      },
    );
  });
});
