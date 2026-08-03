import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RateLimiter } from "./rate-limiter.ts";

function mockSocket(): WebSocket {
  return {} as WebSocket;
}

describe("modules/server/rate-limiter", () => {
  describe("RateLimiter", () => {
    it("should allow first message", () => {
      const limiter = new RateLimiter(5);
      assertEquals(limiter.check(mockSocket()), true);
    });

    it("should allow messages up to limit", () => {
      const limiter = new RateLimiter(3);
      const socket = mockSocket();

      assertEquals(limiter.check(socket), true);
      assertEquals(limiter.check(socket), true);
      assertEquals(limiter.check(socket), true);
    });

    it("should reject messages beyond limit", () => {
      const limiter = new RateLimiter(2);
      const socket = mockSocket();

      limiter.check(socket);
      limiter.check(socket);
      assertEquals(limiter.check(socket), false);
    });

    it("should track different sockets independently", () => {
      const limiter = new RateLimiter(1);
      const s1 = mockSocket();
      const s2 = mockSocket();

      assertEquals(limiter.check(s1), true);
      assertEquals(limiter.check(s1), false);
      assertEquals(limiter.check(s2), true);
    });

    it("should cleanup socket records", () => {
      const limiter = new RateLimiter(1);
      const socket = mockSocket();

      limiter.check(socket);
      assertEquals(limiter.check(socket), false);

      limiter.cleanup(socket);

      assertEquals(limiter.check(socket), true);
    });

    it("rejects invalid message limits", () => {
      for (const maxMessages of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => new RateLimiter(maxMessages),
          RangeError,
          "maxMessages",
        );
      }
    });

    it("rejects invalid window durations", () => {
      for (const windowMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => new RateLimiter(1, { windowMs }),
          RangeError,
          "windowMs",
        );
      }
    });

    it("rejects invalid options with a stable error", () => {
      assertThrows(
        () => new RateLimiter(1, null as never),
        TypeError,
        "options",
      );
    });

    it("fails closed when the clock returns a non-finite value", () => {
      const limiter = new RateLimiter(1, { now: () => Number.NaN });
      assertEquals(limiter.check(mockSocket()), false);
    });

    it("opens a new window at the exact boundary", () => {
      let now = 100;
      const limiter = new RateLimiter(1, {
        windowMs: 10,
        now: () => now,
      });
      const socket = mockSocket();

      assertEquals(limiter.check(socket), true);
      assertEquals(limiter.check(socket), false);
      now = 110;
      assertEquals(limiter.check(socket), true);
    });

    it("recovers safely if an injected clock moves backwards", () => {
      let now = 100;
      const limiter = new RateLimiter(1, {
        windowMs: 10,
        now: () => now,
      });
      const socket = mockSocket();

      assertEquals(limiter.check(socket), true);
      assertEquals(limiter.check(socket), false);
      now = 90;
      assertEquals(limiter.check(socket), true);
    });
  });
});
