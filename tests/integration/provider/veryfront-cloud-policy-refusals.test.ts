import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { parseProviderError } from "#veryfront/chat/provider-errors.ts";
import { requestJson } from "#veryfront/provider/runtime-loader/provider-http.ts";
import { createVeryfrontCloudFetch } from "#veryfront/provider/veryfront-cloud/shared.ts";

describe("gateway scoped model refusals", () => {
  afterEach(() => restoreMockFetch());
  for (
    const [code, curated] of [
      ["account-model-denied", "ACCOUNT_MODEL_DENIED"],
      ["policy-model-denied", "MODEL_NOT_PERMITTED"],
      ["key-model-denied", "KEY_MODEL_DENIED"],
    ]
  ) {
    it(`normalizes ${code} from each native envelope without retries or text leakage`, async () => {
      const detail = { model: "openai/model" };
      const envelopes = [
        { error: { code, message: "untrusted diagnostic", veryfront: detail } },
        {
          type: "error",
          error: {
            code,
            type: "permission_error",
            message: "untrusted diagnostic",
            veryfront: detail,
          },
        },
        {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "untrusted diagnostic",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                domain: "veryfront.com",
                reason: code,
              },
            ],
          },
        },
      ];
      for (const envelope of envelopes) {
        for (const status of [403, 503]) {
          let attempts = 0;
          installMockFetch(() => {
            attempts++;
            return Promise.resolve(Response.json(envelope, { status }));
          });
          const fetchImpl = createVeryfrontCloudFetch(
            "vf_synthetic_policy_test",
            "https://api.veryfront.com/ai/v1",
            undefined,
            { neutralRoute: true },
          );
          const error = await assertRejects(() =>
            requestJson({
              url: "https://api.veryfront.com/ai/v1/chat/completions",
              fetchImpl,
              init: { method: "POST", body: JSON.stringify({ model: "openai/model" }) },
              providerLabel: "veryfront-cloud",
              providerKind: "openai",
            })
          );
          const parsed = parseProviderError(error);
          assertEquals(attempts, 1);
          assertEquals(parsed.code, curated);
          assertEquals(parsed.status, 403);
          assertEquals(parsed.message.includes("untrusted"), false);
          restoreMockFetch();
        }
      }
    });
  }
});
