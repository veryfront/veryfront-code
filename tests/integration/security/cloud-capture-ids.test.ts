import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { installArrayWriteProbe } from "#veryfront/security/http/credential-probes.test-helpers.ts";
import { runWithVeryfrontCloudModelCallCapture } from "#veryfront/provider/veryfront-cloud/context.ts";
import { createVeryfrontCloudFetch } from "#veryfront/provider/veryfront-cloud/shared.ts";

describe("cloud capture-ID credential boundary", () => {
  for (const trigger of ["getter", "coercion"] as const) {
    for (const field of ["modelCallId", "eventId"] as const) {
      it(`reads capture ${field} ${trigger} before the bearer joins the headers`, async () => {
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
        try {
          await withMockFetch(
            () => {
              transportCalls++;
              return Promise.resolve(new Response(null, { status: 204 }));
            },
            () =>
              assertRejects(
                async () =>
                  await runWithVeryfrontCloudModelCallCapture(
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
                                    for (
                                      let entryIndex = 0;
                                      entryIndex < this.length;
                                      entryIndex++
                                    ) {
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
                            return receipt[field];
                          }
                          return {
                            toString() {
                              armProbe();
                              return receipt[field];
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
                TypeError,
                "Refused a credential-bearing request",
              ),
          );
        } finally {
          AsyncLocalStorage.prototype.getStore = originalGetStore;
          probe?.restore();
        }
        assertEquals(transportCalls, 0);
        assertEquals(setterSawBearer, false, "Capture getters must not expose the bearer");
        assertEquals(probe?.saw(bearer), false);
      });
    }
  }
});
