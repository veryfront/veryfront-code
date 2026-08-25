import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withRetryOnTransient } from "./retry.ts";

describe("platform/adapters/fs/veryfront/retry", () => {
  describe("withRetryOnTransient", () => {
    it("should return result on success", async () => {
      const result = await withRetryOnTransient(() => Promise.resolve("ok"), "test");
      assertEquals(result, "ok");
    });

    it("should throw non-transient errors immediately", async () => {
      let callCount = 0;
      await assertRejects(
        () =>
          withRetryOnTransient(() => {
            callCount++;
            const err = new Error("validation failed");
            (err as unknown as { status: number }).status = 400;
            throw err;
          }, "test"),
        Error,
        "validation failed",
      );
      assertEquals(callCount, 1);
    });

    it("should retry once on TypeError with 'fetch' in message", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new TypeError("fetch failed");
        return Promise.resolve("recovered");
      }, "test");
      assertEquals(result, "recovered");
      assertEquals(callCount, 2);
    });

    it("should retry once on 500 status error", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("server error");
          (err as unknown as { status: number }).status = 500;
          throw err;
        }
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
      assertEquals(callCount, 2);
    });

    it("should retry once on ECONNRESET", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new Error("ECONNRESET");
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
      assertEquals(callCount, 2);
    });

    it("should retry once on ECONNREFUSED", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new Error("ECONNREFUSED");
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
    });

    it("should retry once on ETIMEDOUT", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new Error("ETIMEDOUT");
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
    });

    it("should retry once on 'socket hang up'", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new Error("socket hang up");
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
    });

    it("should retry once on 'network' error", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) throw new Error("network error occurred");
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
    });

    it("should throw if transient error persists after retry", async () => {
      await assertRejects(
        () =>
          withRetryOnTransient(() => {
            throw new TypeError("fetch failed");
          }, "test"),
        TypeError,
        "fetch failed",
      );
    });

    it("should not retry 4xx errors", async () => {
      let callCount = 0;
      await assertRejects(
        () =>
          withRetryOnTransient(() => {
            callCount++;
            const err = new Error("not found");
            (err as unknown as { status: number }).status = 404;
            throw err;
          }, "test"),
        Error,
        "not found",
      );
      assertEquals(callCount, 1);
    });

    it("should not retry non-Error values that are not transient", async () => {
      let callCount = 0;
      await assertRejects(
        () =>
          withRetryOnTransient(() => {
            callCount++;
            throw "simple string error";
          }, "test"),
      );
      assertEquals(callCount, 1);
    });

    it("should retry 503 status", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("service unavailable");
          (err as unknown as { status: number }).status = 503;
          throw err;
        }
        return Promise.resolve("ok");
      }, "test");
      assertEquals(result, "ok");
      assertEquals(callCount, 2);
    });

    it("does not retry invalid non-HTTP status values", async () => {
      for (const status of [499.5, 600, Number.POSITIVE_INFINITY]) {
        let callCount = 0;
        await assertRejects(() =>
          withRetryOnTransient(() => {
            callCount++;
            const error = new Error("invalid status");
            (error as Error & { status: number }).status = status;
            throw error;
          }, "test")
        );
        assertEquals(callCount, 1);
      }
    });

    it("contains hostile throwable introspection hooks", async () => {
      let callCount = 0;
      const hostile = new Proxy({}, {
        getOwnPropertyDescriptor(): never {
          throw new Error("descriptor trap");
        },
        get(): never {
          throw new Error("get trap");
        },
      });

      let caught: unknown;
      try {
        await withRetryOnTransient(() => {
          callCount++;
          throw hostile;
        }, "test");
      } catch (error) {
        caught = error;
      }

      assertEquals(callCount, 1);
      assertEquals(caught === hostile, true);
    });

    it("uses own status data without invoking a hostile message accessor", async () => {
      let callCount = 0;
      const result = await withRetryOnTransient(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error("hidden");
          Object.defineProperty(error, "message", {
            get(): never {
              throw new Error("message getter");
            },
          });
          (error as Error & { status: number }).status = 503;
          throw error;
        }
        return Promise.resolve("ok");
      }, "test");

      assertEquals(result, "ok");
      assertEquals(callCount, 2);
    });
  });
});
