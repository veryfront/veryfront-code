import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CachePayload } from "./types.ts";
import { cloneCachePayload, parseCachePayload, serializeCachePayload } from "./cache-payload.ts";

function payloadWithNodeMap(): CachePayload {
  const node = { attrs: { className: "title" } };
  return {
    result: {
      html: "<h1>Title</h1>",
      frontmatter: { title: "Title" },
      headings: [{ id: "title", text: "Title", level: 1 }],
      nodeMap: new Map([[1, node]]),
      stream: null,
    },
    nodeMapEntries: [[1, node]],
    storedAt: 1_000,
    expiresAt: 2_000,
  };
}

describe("rendering/cache/cache-payload", () => {
  it("keeps memory snapshots equivalent to serialized snapshots", () => {
    const memory = cloneCachePayload(payloadWithNodeMap());
    const serialized = parseCachePayload(JSON.parse(serializeCachePayload(payloadWithNodeMap())));

    assertEquals(serialized, memory);
    assertEquals(serialized?.result.nodeMap instanceof Map, true);
    assertEquals(
      (serialized?.result.nodeMap?.get(1) as { attrs: { className: string } }).attrs.className,
      "title",
    );
  });

  it("round-trips detached Date values without changing cached frontmatter", () => {
    const payload = payloadWithNodeMap();
    const publicationDate = new Date("2026-07-24T08:30:00.000Z");
    const nestedDate = new Date("2025-01-02T03:04:05.000Z");
    payload.result.frontmatter = {
      date: publicationDate,
      metadata: { nestedDate },
    };

    const memory = cloneCachePayload(payload);
    const serialized = parseCachePayload(
      JSON.parse(serializeCachePayload(payload)),
    );

    assertEquals(memory.result.frontmatter, {
      date: new Date("2026-07-24T08:30:00.000Z"),
      metadata: {
        nestedDate: new Date("2025-01-02T03:04:05.000Z"),
      },
    });
    assertEquals(serialized?.result.frontmatter, memory.result.frontmatter);
    assertEquals(memory.result.frontmatter.date === publicationDate, false);
    assertEquals(
      (memory.result.frontmatter.metadata as { nestedDate: Date }).nestedDate ===
        nestedDate,
      false,
    );
  });

  it("does not confuse user records with cache codec markers", () => {
    const payload = payloadWithNodeMap();
    const markerLikeRecords = ["date", "record", "unknown"].map((tag) => ({
      $veryfrontCacheValue: tag,
      value: "2026-07-24T08:30:00.000Z",
    }));
    (payload.result.frontmatter as Record<string, unknown>).custom = markerLikeRecords;

    const serialized = parseCachePayload(
      JSON.parse(serializeCachePayload(payload)),
    );

    assertEquals(
      (serialized?.result.frontmatter as Record<string, unknown>).custom,
      markerLikeRecords,
    );
  });

  it("continues to read legacy unversioned cache payloads", () => {
    const payload = payloadWithNodeMap();
    const legacyWirePayload = JSON.parse(JSON.stringify({
      ...payload,
      result: {
        ...payload.result,
        nodeMap: undefined,
      },
    }));

    const parsed = parseCachePayload(legacyWirePayload);

    assertEquals(parsed, cloneCachePayload(payload));
  });

  it("rejects sparse JSON-like arrays", () => {
    const payload = payloadWithNodeMap();
    const sparse = new Array(2);
    sparse[1] = "value";
    (payload.result.frontmatter as unknown as Record<string, unknown>).values = sparse;

    assertThrows(() => cloneCachePayload(payload), TypeError, "sparse array");
    assertEquals(parseCachePayload(payload), undefined);
  });

  it("rejects sparse heading arrays", () => {
    const payload = payloadWithNodeMap();
    const sparse = new Array(2);
    sparse[1] = { id: "title", text: "Title", level: 1 };
    payload.result.headings = sparse;

    assertThrows(() => cloneCachePayload(payload), TypeError, "cannot be sparse");
    assertEquals(parseCachePayload(payload), undefined);
  });

  it("rejects conflicting nodeMap representations", () => {
    const payload = payloadWithNodeMap();
    payload.nodeMapEntries = [[1, { attrs: { className: "different" } }]];

    assertThrows(() => cloneCachePayload(payload), TypeError, "conflicts");
    assertEquals(parseCachePayload(payload), undefined);
  });

  it("rejects non-null streams and malformed timestamps", () => {
    const streamPayload = payloadWithNodeMap();
    streamPayload.result.stream = new ReadableStream();
    assertEquals(parseCachePayload(streamPayload), undefined);

    const timestampPayload = payloadWithNodeMap();
    timestampPayload.expiresAt = 999;
    assertEquals(parseCachePayload(timestampPayload), undefined);

    const immortalStale = payloadWithNodeMap();
    immortalStale.expiresAt = undefined;
    immortalStale.staleUntil = 2_000;
    assertEquals(parseCachePayload(immortalStale), undefined);

    const fractionalTimestamp = payloadWithNodeMap();
    fractionalTimestamp.storedAt = 1.5;
    assertEquals(parseCachePayload(fractionalTimestamp), undefined);

    const outOfRangeTimestamp = payloadWithNodeMap();
    outOfRangeTimestamp.storedAt = 8_640_000_000_001;
    assertEquals(parseCachePayload(outOfRangeTimestamp), undefined);
  });

  it("bounds headings and accepts only HTML heading levels", () => {
    for (const level of [0, 7]) {
      const invalidLevel = payloadWithNodeMap();
      invalidLevel.result.headings = [{ id: "heading", text: "Heading", level }];
      assertEquals(parseCachePayload(invalidLevel), undefined);
    }

    const oversizedHeading = payloadWithNodeMap();
    oversizedHeading.result.headings = [{
      id: "heading",
      text: "x".repeat(64 * 1024 + 1),
      level: 1,
    }];
    assertEquals(parseCachePayload(oversizedHeading), undefined);

    const tooManyHeadings = payloadWithNodeMap();
    tooManyHeadings.result.headings = Array.from(
      { length: 10_001 },
      (_, index) => ({ id: `heading-${index}`, text: "Heading", level: 1 }),
    );
    assertEquals(parseCachePayload(tooManyHeadings), undefined);
  });

  it("rejects accessors without executing them", () => {
    let getterCalls = 0;
    const payload = payloadWithNodeMap() as unknown as Record<string, unknown>;
    const result = payload.result as Record<string, unknown>;
    Object.defineProperty(result, "html", {
      enumerable: true,
      get() {
        getterCalls++;
        return "<p>unsafe</p>";
      },
    });

    assertEquals(parseCachePayload(payload), undefined);
    assertEquals(getterCalls, 0);
  });
});
