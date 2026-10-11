import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { installArrayWriteProbe } from "#veryfront/security/http/credential-probes.test-helpers.ts";
import { runWithVeryfrontCloudModelCallCapture } from "#veryfront/provider/veryfront-cloud/context.ts";
import { createVeryfrontCloudFetch } from "#veryfront/provider/veryfront-cloud/shared.ts";

describe("cloud capture-ID credential boundary", () => {
  for (const trigger of ["getter", "coercion"] as const) {
    for (const field of ["modelCallId", "eventId"] as const) {
      it(`ignores forged capture ${field} ${trigger} while adding the bearer`, async () => {
        const bearer = "vf_capture_id_bearer_7a41";
        const wrappedFetch = createVeryfrontCloudFetch(bearer, "https://93.184.216.34/ai/v1");
        const receipt = {
          eventId: "9007199254740993",
          projectId: "11111111-1111-4111-8111-111111111111",
          runId: "22222222-2222-4222-8222-222222222222",
          modelCallId: "33333333-3333-4333-8333-333333333333",
        };
        const originalGetStore = AsyncLocalStorage.prototype.getStore;
        let probe: ReturnType<typeof installArrayWriteProbe> | undefined;
        let transportCalls = 0;
        let setterSawBearer = false;
        let sentAuthorization: string | null = null;
        let sentModelCallId: string | null = null;
        let sentEventId: string | null = null;
        try {
          await withMockFetch(
            (input, init) => {
              const request = new Request(input, init);
              transportCalls++;
              sentAuthorization = request.headers.get("authorization");
              sentModelCallId = request.headers.get("x-veryfront-model-call-id");
              sentEventId = request.headers.get("x-veryfront-model-call-capture-event-id");
              return Promise.resolve(new Response(null, { status: 204 }));
            },
            () =>
              runWithVeryfrontCloudModelCallCapture(
                { receipt, assertActive() {} },
                () => {
                  const liveReceipt = { ...receipt };
                  Object.defineProperty(liveReceipt, field, {
                    get() {
                      const armProbe = () => {
                        if (!probe) {
                          probe = installArrayWriteProbe("Array.prototype index");
                          for (let index = 0; index < 8; index++) {
                            Object.defineProperty(Array.prototype, String(index), {
                              configurable: true,
                              get: () => undefined,
                              set(this: unknown[], value: unknown) {
                                Object.defineProperty(this, String(index), {
                                  configurable: true,
                                  enumerable: true,
                                  writable: true,
                                  value,
                                });
                                // Appending an ID exposes the existing header list
                                // through the setter's receiver, not just its value.
                                for (let entryIndex = 0; entryIndex < this.length; entryIndex++) {
                                  const entry = this[entryIndex];
                                  if (Array.isArray(entry) && entry[1] === `Bearer ${bearer}`) {
                                    setterSawBearer = true;
                                  }
                                }
                              },
                            });
                          }
                        }
                      };
                      if (trigger === "getter") {
                        armProbe();
                        return "forged-capture-id";
                      }
                      return {
                        toString() {
                          armProbe();
                          return "forged-capture-id";
                        },
                      };
                    },
                  });
                  AsyncLocalStorage.prototype.getStore = function () {
                    const store = Reflect.apply(originalGetStore, this, []);
                    return store && typeof store === "object" && "receipt" in store
                      ? { assertActive() {}, receipt: liveReceipt }
                      : store;
                  };
                  return wrappedFetch("https://93.184.216.34/ai/v1/chat/completions", {
                    method: "POST",
                    body: '{"model":"gpt-test"}',
                  });
                },
              ),
          );
        } finally {
          AsyncLocalStorage.prototype.getStore = originalGetStore;
          probe?.restore();
        }
        assertEquals(transportCalls, 1);
        assertEquals(sentAuthorization, `Bearer ${bearer}`);
        assertEquals(sentModelCallId, receipt.modelCallId);
        assertEquals(sentEventId, receipt.eventId);
        assertEquals(setterSawBearer, false, "Capture getters must not expose the bearer");
        assertEquals(probe?.saw(bearer) ?? false, false);
      });
    }
  }
});
