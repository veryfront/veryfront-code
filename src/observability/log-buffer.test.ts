import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { interceptConsole, LogBuffer } from "./log-buffer.ts";

describe("observability/log-buffer", () => {
  describe("LogBuffer", () => {
    it("should append log entries", () => {
      const buf = new LogBuffer();
      buf.info("hello", "test");
      assertEquals(buf.count, 1);
    });

    it("should assign unique IDs", () => {
      const buf = new LogBuffer();
      const a = buf.info("a");
      const b = buf.info("b");
      assertEquals(a.id !== b.id, true);
    });

    it("redacts credential-like keys from entry data (#1989)", () => {
      const buf = new LogBuffer();
      const seen: Record<string, unknown>[] = [];
      buf.subscribe((entry) => {
        if (entry.data) seen.push(entry.data);
      });

      const entry = buf.info("request", "server", { userId: "u-1", apiKey: "sk-secret" });

      assertEquals(entry.data?.apiKey, "[REDACTED]");
      assertEquals(entry.data?.userId, "u-1");
      // Subscribers (incl. the file writer) only ever see the redacted copy.
      const subscriberData = seen[0];
      assertExists(subscriberData);
      assertEquals(subscriberData.apiKey, "[REDACTED]");
      assertEquals(JSON.stringify(entry).includes("sk-secret"), false);
    });

    it("redacts object args captured via interceptConsole (#1989)", () => {
      const buf = new LogBuffer();
      const restore = interceptConsole(buf);
      try {
        console.error("auth attempt", { apiKey: "sk-secret", userId: "u-1" });
      } finally {
        restore();
      }

      const entry = buf.tail(1)[0];
      assertExists(entry);
      const message = entry.message;
      assertEquals(message.includes("sk-secret"), false);
      assertEquals(message.includes("[REDACTED]"), true);
      assertEquals(message.includes("u-1"), true);
    });

    it("should support all log levels", () => {
      const buf = new LogBuffer();
      buf.debug("d");
      buf.info("i");
      buf.warn("w");
      buf.error("e");

      assertEquals(buf.count, 4);

      const counts = buf.countByLevel();
      assertEquals(counts.debug, 1);
      assertEquals(counts.info, 1);
      assertEquals(counts.warn, 1);
      assertEquals(counts.error, 1);
    });

    it("should enforce maxSize", () => {
      const buf = new LogBuffer({ maxSize: 3 });
      buf.info("1");
      buf.info("2");
      buf.info("3");
      buf.info("4");

      assertEquals(buf.count, 3);

      const first = buf.getAll()[0];
      assertExists(first);
      assertEquals(first.message, "2");
    });

    it("rejects unsafe buffer bounds", () => {
      for (const maxSize of [0, -1, Number.POSITIVE_INFINITY, 100_001]) {
        assertThrows(() => new LogBuffer({ maxSize }));
      }
    });

    it("does not expose mutable buffered entries", () => {
      const buf = new LogBuffer();
      const appended = buf.info("original", "test", { nested: { value: "original" } });
      appended.message = "changed";
      (appended.data?.nested as { value: string }).value = "changed";

      const [stored] = buf.getAll();
      assertExists(stored);
      assertEquals(stored.message, "original");
      assertEquals((stored.data?.nested as { value: string }).value, "original");

      stored.message = "changed again";
      assertEquals(buf.getAll()[0]?.message, "original");
    });

    it("redacts credential text and normalizes line breaks", () => {
      const buf = new LogBuffer();
      const entry = buf.info("request\nAuthorization: Bearer secret-value");

      assertEquals(entry.message.includes("secret-value"), false);
      assertEquals(entry.message.includes("\n"), false);
      assertEquals(entry.message.includes("[REDACTED]"), true);
    });

    it("stores only declared fields from runtime inputs", () => {
      const buf = new LogBuffer();
      const entry = buf.append(
        {
          level: "info",
          message: "safe",
          source: "test",
          password: "private-value",
        } as unknown as Parameters<LogBuffer["append"]>[0],
      );

      assertEquals(JSON.stringify(entry).includes("private-value"), false);
      assertEquals(Object.hasOwn(entry, "password"), false);
    });

    it("should query by level", () => {
      const buf = new LogBuffer();
      buf.info("a");
      buf.error("b");
      buf.info("c");

      const [first] = buf.query({ level: "error" });
      assertExists(first);
      assertEquals(first.message, "b");
    });

    it("should query by source", () => {
      const buf = new LogBuffer();
      buf.info("a", "src1");
      buf.info("b", "src2");

      const results = buf.query({ source: "src1" });
      assertEquals(results.length, 1);
    });

    it("should query by string pattern", () => {
      const buf = new LogBuffer();
      buf.info("hello world");
      buf.info("goodbye");

      const results = buf.query({ pattern: "hello" });
      assertEquals(results.length, 1);
    });

    it("should query by regex pattern", () => {
      const buf = new LogBuffer();
      buf.info("error: something failed");
      buf.info("ok");

      const results = buf.query({ pattern: /error/i });
      assertEquals(results.length, 1);
    });

    it("keeps stateful regular expression filters deterministic", () => {
      const buf = new LogBuffer();
      buf.info("error");
      const pattern = /error/g;
      pattern.lastIndex = 2;

      assertEquals(buf.query({ pattern }).length, 1);
      assertEquals(buf.query({ pattern }).length, 1);
      assertEquals(pattern.lastIndex, 2);
    });

    it("should query with limit", () => {
      const buf = new LogBuffer();
      buf.info("1");
      buf.info("2");
      buf.info("3");

      const [first, second] = buf.query({ limit: 2 });
      assertExists(first);
      assertExists(second);
      assertEquals(first.message, "2");
    });

    it("should tail entries", () => {
      const buf = new LogBuffer();
      buf.info("1");
      buf.info("2");
      buf.info("3");

      const [first, second] = buf.tail(2);
      assertExists(first);
      assertExists(second);
      assertEquals(first.message, "2");
    });

    it("rejects invalid read limits", () => {
      const buf = new LogBuffer();
      assertThrows(() => buf.query({ limit: -1 }));
      assertThrows(() => buf.tail(Number.NaN));
    });

    it("should clear entries", () => {
      const buf = new LogBuffer();
      buf.info("a");
      buf.clear();
      assertEquals(buf.count, 0);
    });

    it("should notify subscribers", () => {
      const buf = new LogBuffer();
      const received: string[] = [];
      const unsub = buf.subscribe((entry) => received.push(entry.message));

      buf.info("test");
      assertEquals(received, ["test"]);

      unsub();
      buf.info("after unsub");
      assertEquals(received.length, 1);
    });

    it("should format entries", () => {
      const buf = new LogBuffer();
      buf.info("hello", "myapp");

      const formatted = buf.format();
      assertEquals(formatted.includes("INFO"), true);
      assertEquals(formatted.includes("myapp"), true);
      assertEquals(formatted.includes("hello"), true);
    });

    it("does not overwrite a console method replaced after interception", () => {
      const buf = new LogBuffer();
      const originalInfo = console.info;
      const restore = interceptConsole(buf);
      const replacement = () => {};
      console.info = replacement;

      try {
        restore();
        assertEquals(console.info, replacement);
      } finally {
        console.info = originalInfo;
      }
    });

    it("deactivates nested console interceptors restored out of order", () => {
      const originalInfo = console.info;
      console.info = () => {};
      const first = new LogBuffer();
      const second = new LogBuffer();
      const restoreFirst = interceptConsole(first);
      const restoreSecond = interceptConsole(second);

      try {
        restoreFirst();
        console.info("first message");
        assertEquals(first.count, 0);
        assertEquals(second.count, 1);

        restoreSecond();
        console.info("second message");
        assertEquals(first.count, 0);
        assertEquals(second.count, 1);
      } finally {
        restoreSecond();
        restoreFirst();
        console.info = originalInfo;
      }
    });
  });
});
