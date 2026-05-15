import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { evaluateRuntimeConfidenceEnv } from "./preflight.ts";

describe("agent testing runtime confidence preflight", () => {
  it("fails when both required values are missing", () => {
    assertEquals(evaluateRuntimeConfidenceEnv({}, "https://api.example.test"), {
      ok: false,
      resolvedApiUrl: "https://api.example.test",
      messages: [
        "Resolved VERYFRONT_API_URL: https://api.example.test",
        "BLOCKER: VERYFRONT_TOKEN is missing",
        "BLOCKER: AG_UI_EVAL_PROJECT_ID is missing",
        "Runtime-confidence preflight: FAIL",
      ],
    });
  });

  it("passes when both required values are present", () => {
    assertEquals(
      evaluateRuntimeConfidenceEnv(
        {
          VERYFRONT_TOKEN: "tok",
          AG_UI_EVAL_PROJECT_ID: "proj",
        },
        "https://api.example.test",
      ),
      {
        ok: true,
        resolvedApiUrl: "https://api.example.test",
        messages: [
          "Resolved VERYFRONT_API_URL: https://api.example.test",
          "Runtime-confidence preflight: PASS",
        ],
      },
    );
  });
});
