import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LogBuffer } from "./log-buffer.ts";

describe("cli/mcp/log-buffer", () => {
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
      const errors = buf.query({ level: "error" });
      assertEquals(errors.length, 1);
      const first = errors[0];
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

    it("should query with limit", () => {
      const buf = new LogBuffer();
      buf.info("1");
      buf.info("2");
      buf.info("3");
      const results = buf.query({ limit: 2 });
      assertEquals(results.length, 2);
      const first = results[0];
      assertExists(first);
      assertEquals(first.message, "2");
    });

    it("should tail entries", () => {
      const buf = new LogBuffer();
      buf.info("1");
      buf.info("2");
      buf.info("3");
      const tail = buf.tail(2);
      assertEquals(tail.length, 2);
      const first = tail[0];
      assertExists(first);
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
