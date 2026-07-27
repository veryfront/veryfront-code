import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { getTimeoutFromEnv, timeout } from "./timeout.ts";

function makeCtx(url = "http://localhost/api/data"): { request: Request } {
  return { request: new Request(url) };
}

function makeSlowNext(delayMs = 200): {
  next: () => Promise<Response>;
  clear: () => void;
} {
  let timerId: ReturnType<typeof setTimeout> | undefined;

  return {
    next: () =>
      new Promise<Response>((resolve) => {
        timerId = setTimeout(() => resolve(new Response("late")), delayMs);
      }),
    clear: () => {
      if (timerId !== undefined) clearTimeout(timerId);
    },
  };
}

describe("middleware/builtin/timeout", () => {
  describe("timeout", () => {
    it("should pass through fast requests", async () => {
      const mw = timeout({ timeoutMs: 1000 });
      const res = await mw(makeCtx(), () => Promise.resolve(new Response("ok")));
      assertEquals(res?.status, 200);
    });

    it("should return 504 for slow requests", async () => {
      const mw = timeout({ timeoutMs: 10 });
      const slow = makeSlowNext();
      const res = await mw(makeCtx(), slow.next);
      assertEquals(res?.status, 504);
      assertEquals(res?.headers.get("Cache-Control"), "no-store");
      slow.clear();
    });

    it("should exclude health check paths", async () => {
      const mw = timeout({ timeoutMs: 5000 });
      const res = await mw(
        makeCtx("http://localhost/healthz"),
        () => Promise.resolve(new Response("healthy")),
      );
      assertEquals(await res?.text(), "healthy");
    });

    it("should exclude readyz path by default", async () => {
      const mw = timeout({ timeoutMs: 5000 });
      const res = await mw(
        makeCtx("http://localhost/readyz"),
        () => Promise.resolve(new Response("ready")),
      );
      assertEquals(await res?.text(), "ready");
    });

    it("should use custom message", async () => {
      const mw = timeout({ timeoutMs: 10, message: "Too slow" });
      const slow = makeSlowNext();
      const res = await mw(makeCtx(), slow.next);
      const body = await res?.json();
      assertEquals(body.error, "Too slow");
      slow.clear();
    });

    it("should use custom exclude paths", async () => {
      const mw = timeout({ timeoutMs: 5000, exclude: ["/custom"] });
      const res = await mw(
        makeCtx("http://localhost/custom"),
        () => Promise.resolve(new Response("ok")),
      );
      assertEquals(await res?.text(), "ok");
    });

    it("should exclude nested paths for configured prefixes", async () => {
      const mw = timeout({ timeoutMs: 5000, exclude: ["/custom"] });
      const res = await mw(
        makeCtx("http://localhost/custom/deep/path"),
        () => Promise.resolve(new Response("ok")),
      );
      assertEquals(await res?.text(), "ok");
    });

    it("should not exclude paths that only share a textual prefix", async () => {
      const mw = timeout({ timeoutMs: 10, exclude: ["/healthz"] });
      const slow = makeSlowNext();
      const res = await mw(makeCtx("http://localhost/healthz-private"), slow.next);

      assertEquals(res?.status, 504);
      slow.clear();
    });

    it("should snapshot excluded paths at middleware creation", async () => {
      const exclude = ["/custom"];
      const mw = timeout({ timeoutMs: 5000, exclude });
      exclude[0] = "/changed";

      const res = await mw(
        makeCtx("http://localhost/custom/deep"),
        () => Promise.resolve(new Response("ok")),
      );

      assertEquals(await res?.text(), "ok");
    });

    it("should reject invalid timeout and exclusion configuration", () => {
      for (
        const timeoutMs of [
          -1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_TIMER_DELAY_MS + 1,
        ]
      ) {
        assertThrows(() => timeout({ timeoutMs }), RangeError);
      }

      assertThrows(
        () => timeout({ exclude: ["healthz"] }),
        TypeError,
        "absolute path",
      );
      assertThrows(
        () => timeout({ exclude: ["/healthz?probe=1"] }),
        TypeError,
        "query",
      );
    });

    it("should propagate non-timeout errors", async () => {
      const mw = timeout({ timeoutMs: 1000 });
      let caught: Error | undefined;

      try {
        await mw(makeCtx(), () => Promise.reject(new Error("boom")));
      } catch (e) {
        caught = e as Error;
      }

      assertEquals(caught?.message, "boom");
    });
  });

  describe("getTimeoutFromEnv", () => {
    it("should return default when env has no timeout", () => {
      assertEquals(getTimeoutFromEnv({ requestTimeoutMs: undefined } as never), 75000);
    });

    it("should return env value when set", () => {
      assertEquals(getTimeoutFromEnv({ requestTimeoutMs: 30000 } as never), 30000);
    });

    it("should reject invalid configured environment values", () => {
      for (
        const requestTimeoutMs of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_TIMER_DELAY_MS + 1,
        ]
      ) {
        assertThrows(
          () => getTimeoutFromEnv({ requestTimeoutMs } as never),
          RangeError,
        );
      }
    });
  });
});
