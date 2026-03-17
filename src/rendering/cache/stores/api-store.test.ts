import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { APICacheStore } from "./api-store.ts";

describe("rendering/cache/stores/api-store", () => {
  describe("APICacheStore constructor", () => {
    it("should create with default options", () => {
      const store = new APICacheStore();
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom keyPrefix", () => {
      const store = new APICacheStore({ keyPrefix: "custom" });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom ttlSeconds", () => {
      const store = new APICacheStore({ ttlSeconds: 7200 });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with local cache disabled", () => {
      const store = new APICacheStore({ enableLocalCache: false });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom localMaxEntries", () => {
      const store = new APICacheStore({ localMaxEntries: 50 });
      assertEquals(store instanceof APICacheStore, true);
    });
  });

  describe("operations (without distributed backend)", () => {
    it("should return undefined for missing key", async () => {
      const store = new APICacheStore();
      const result = await store.get("missing-key");
      assertEquals(result, undefined);
    });

    it("should clear without error", async () => {
      const store = new APICacheStore();
      await store.clear();
    });

    it("should destroy without error", async () => {
      const store = new APICacheStore();
      await store.destroy();
    });

    it("should delete without error", async () => {
      const store = new APICacheStore();
      await store.delete("some-key");
    });
  });

  describe("serialize/deserialize round-trip", () => {
    function makePayload(
      overrides: Record<string, unknown> = {},
    ): {
      result: {
        html: string;
        css?: string;
        frontmatter: Record<string, unknown>;
        headings?: Array<{ id: string; text: string; level: number }>;
        nodeMap?: Map<number, unknown>;
        stream: null;
        pageModule?: { slug: string; code: string; type: "mdx" | "component" };
        ssrHash?: string;
      };
      storedAt: number;
      expiresAt?: number;
    } {
      return {
        result: {
          html: "<h1>Test</h1>",
          frontmatter: { title: "Test" },
          headings: [],
          stream: null,
          ...overrides,
        },
        storedAt: Date.now(),
      };
    }

    it("round-trips basic HTML payload", () => {
      const store = new APICacheStore();
      const payload = makePayload();
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.html, "<h1>Test</h1>");
      assertEquals(deserialized.result.frontmatter.title, "Test");
      assertEquals(deserialized.storedAt, payload.storedAt);
    });

    it("round-trips payload with nodeMap", () => {
      const store = new APICacheStore();
      const nodeMap = new Map<number, unknown>([
        [1, { type: "div" }],
        [2, { type: "span" }],
      ]);
      const payload = makePayload({ nodeMap });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.nodeMap instanceof Map, true);
      assertEquals(deserialized.result.nodeMap.size, 2);
      assertEquals(
        (deserialized.result.nodeMap.get(1) as Record<string, string>).type,
        "div",
      );
    });

    it("round-trips payload with ssrHash and css", () => {
      const store = new APICacheStore();
      const payload = makePayload({ ssrHash: "hash123", css: "body{}" });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.ssrHash, "hash123");
      assertEquals(deserialized.result.css, "body{}");
    });

    it("round-trips payload with pageModule", () => {
      const store = new APICacheStore();
      const payload = makePayload({
        pageModule: { slug: "index", code: "export default {}", type: "mdx" as const },
      });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.pageModule.slug, "index");
      assertEquals(deserialized.result.pageModule.type, "mdx");
    });

    it("deserializes stream as null (streams are not cacheable)", () => {
      const store = new APICacheStore();
      const payload = makePayload();
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.stream, null);
    });

    it("preserves expiresAt field", () => {
      const store = new APICacheStore();
      const payload = { ...makePayload(), expiresAt: Date.now() + 60000 };
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.expiresAt, payload.expiresAt);
    });
  });

  describe("local cache operations", () => {
    it("set then get returns value from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: {
          html: "<p>cached</p>",
          frontmatter: {},
          headings: [],
          stream: null,
        },
        storedAt: Date.now(),
      } as any;

      await store.set("local-key", payload);
      const result = await store.get("local-key");
      assertEquals(result?.result.html, "<p>cached</p>");
    });

    it("skips caching when result has a stream", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: {
          html: "<p>stream</p>",
          frontmatter: {},
          headings: [],
          stream: {} as ReadableStream,
        },
        storedAt: Date.now(),
      } as any;

      await store.set("stream-key", payload);
      const result = await store.get("stream-key");
      assertEquals(result, undefined);
    });

    it("delete removes from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("del-key", payload);
      await store.delete("del-key");
      const result = await store.get("del-key");
      assertEquals(result, undefined);
    });

    it("deleteByPrefix removes matching keys from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("proj:page:a", payload);
      await store.set("proj:page:b", payload);
      await store.set("other:page:c", payload);

      const deleted = await store.deleteByPrefix("proj:");
      assertEquals(deleted >= 2, true);

      const a = await store.get("proj:page:a");
      assertEquals(a, undefined);
      const c = await store.get("other:page:c");
      assertEquals(c?.result.html, "<p>x</p>");
    });

    it("clear empties local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("clear-key", payload);
      await store.clear();
      const result = await store.get("clear-key");
      assertEquals(result, undefined);
    });

    it("returns undefined when local cache is disabled", async () => {
      const store = new APICacheStore({ enableLocalCache: false });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("no-local", payload);
      const result = await store.get("no-local");
      assertEquals(result, undefined);
    });
  });
});
