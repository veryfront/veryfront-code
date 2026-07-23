import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { interceptConsole, LogBuffer } from "./log-buffer.ts";

describe("observability/log-buffer", () => {
  describe("LogBuffer", () => {
    it("should reject invalid maxSize values", () => {
      assertThrows(() => new LogBuffer({ maxSize: -1 }), RangeError, "maxSize");
      assertThrows(() => new LogBuffer({ maxSize: Number.NaN }), RangeError, "maxSize");
    });

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

    it("redacts credentials embedded in log message URLs", () => {
      const buf = new LogBuffer();

      const entry = buf.error(
        "request failed: https://user:password@example.test/path?access_token=secret",
      );

      assertEquals(entry.message.includes("password"), false);
      assertEquals(entry.message.includes("secret"), false);
      assertEquals(entry.message.includes("[REDACTED]"), true);
    });

    it("does not expose retained entries to caller or subscriber mutation", () => {
      const buf = new LogBuffer();
      buf.subscribe((entry) => {
        entry.message = "subscriber mutation";
        if (entry.data) entry.data.value = "subscriber mutation";
      });

      const returned = buf.info("original", "test", { value: "original" });
      returned.message = "caller mutation";
      if (returned.data) returned.data.value = "caller mutation";

      const retained = buf.getAll()[0];
      assertExists(retained);
      assertEquals(retained.message, "original");
      assertEquals(retained.data?.value, "original");

      retained.message = "query mutation";
      assertEquals(buf.getAll()[0]?.message, "original");
    });

    it("detaches Date and URL values across returned and retained snapshots", () => {
      const buf = new LogBuffer();
      const date = new Date("2025-01-02T03:04:05.000Z");
      const url = new URL("https://user:password@example.test/path?token=secret");

      const returned = buf.info("structured", "test", { date, url });
      const returnedDate = returned.data?.date as Date;
      const returnedUrl = returned.data?.url as URL;
      returnedDate.setUTCFullYear(2030);
      returnedUrl.pathname = "/mutated";

      const retained = buf.getAll()[0]?.data;
      assertEquals((retained?.date as Date).getUTCFullYear(), 2025);
      assertEquals((retained?.url as URL).pathname, "/path");
      assertEquals((retained?.url as URL).href.includes("secret"), false);
      assertEquals(date.getUTCFullYear(), 2025);
      assertEquals(url.pathname, "/path");
    });

    it("redacts object args captured via interceptConsole (#1989)", () => {
      const buf = new LogBuffer();
      const restore = interceptConsole(buf);
      try {
        console.error("auth attempt", { apiKey: "sk-secret", userId: "u-1" });
      } finally {
        restore();
      }

      const captured = buf.tail(1)[0];
      assertExists(captured);
      const message = captured.message;
      assertEquals(message.includes("sk-secret"), false);
      assertEquals(message.includes("[REDACTED]"), true);
      assertEquals(message.includes("u-1"), true);
    });

    it("restores nested console interceptions by identity without resurrecting stale layers", () => {
      const original = console.log;
      const firstBuffer = new LogBuffer();
      const secondBuffer = new LogBuffer();
      const restoreFirst = interceptConsole(firstBuffer, "first");
      const restoreSecond = interceptConsole(secondBuffer, "second");

      try {
        restoreFirst();
        console.log("captured once");

        assertEquals(firstBuffer.count, 0);
        assertEquals(secondBuffer.count, 1);

        restoreSecond();
        restoreSecond();
        restoreFirst();
        assertStrictEquals(console.log, original);
      } finally {
        console.log = original;
      }
    });

    it("does not overwrite a console method replaced by another owner", () => {
      const original = console.log;
      const restore = interceptConsole(new LogBuffer());
      const external = () => {};
      console.log = external;

      try {
        restore();
        assertStrictEquals(console.log, external);
      } finally {
        console.log = original;
      }
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

    it("should query deterministically with stateful regex patterns", () => {
      const buf = new LogBuffer();
      buf.info("error one");
      buf.info("error two");

      assertEquals(buf.query({ pattern: /error/g }).length, 2);
      assertEquals(buf.query({ pattern: /error/g }).length, 2);
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

    it("should return no entries for a zero limit or tail count", () => {
      const buf = new LogBuffer();
      buf.info("1");

      assertEquals(buf.query({ limit: 0 }), []);
      assertEquals(buf.tail(0), []);
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
  });
});
