import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });
});
