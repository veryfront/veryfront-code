import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveDurableRunCanaryEnvironment } from "./environment.ts";

describe("agent testing durable run canary environment", () => {
  it("falls back to config API URL and default flags", () => {
    assertEquals(resolveDurableRunCanaryEnvironment({ VERYFRONT_TOKEN: "tok" }), {
      apiUrl: "https://api.veryfront.com",
      authToken: "tok",
      projectId: "",
      requestTimeoutMs: 240000,
      keepSuccessfulEvidence: false,
    });
  });

  it("respects explicit overrides", () => {
    assertEquals(
      resolveDurableRunCanaryEnvironment({
        VERYFRONT_API_URL: "https://api.override.test",
        VERYFRONT_TOKEN: "tok",
        AG_UI_EVAL_PROJECT_ID: "proj",
        DURABLE_CANARY_TIMEOUT_MS: "123",
        DURABLE_CANARY_KEEP_SUCCESS: "1",
      }),
      {
        apiUrl: "https://api.override.test",
        authToken: "tok",
        projectId: "proj",
        requestTimeoutMs: 123,
        keepSuccessfulEvidence: true,
      },
    );
  });
});
