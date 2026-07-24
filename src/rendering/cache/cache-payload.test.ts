import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CachePayload } from "./types.ts";
import {
  cloneCachePayload,
  parseCachePayload,
  parseSerializedCachePayload,
  serializeCachePayload,
} from "./cache-payload.ts";

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

  it("rehydrates only declared Dates in arrays and node-map values", () => {
    const payload = payloadWithNodeMap();
    const intentionalIsoString = "2026-07-24T08:30:00.000Z";
    payload.result.frontmatter = {
      values: [
        intentionalIsoString,
        new Date("2025-01-02T03:04:05.000Z"),
      ],
    };
    payload.result.nodeMap = new Map([[
      1,
      {
        createdAt: new Date("2024-02-03T04:05:06.000Z"),
        label: intentionalIsoString,
      },
    ]]);
    payload.nodeMapEntries = Array.from(payload.result.nodeMap.entries());

    const parsed = parseCachePayload(
      JSON.parse(serializeCachePayload(payload)),
    );

    assertEquals(parsed?.result.frontmatter, {
      values: [
        intentionalIsoString,
        new Date("2025-01-02T03:04:05.000Z"),
      ],
    });
    assertEquals(parsed?.result.nodeMap?.get(1), {
      createdAt: new Date("2024-02-03T04:05:06.000Z"),
      label: intentionalIsoString,
    });
    assertEquals(parsed?.nodeMapEntries?.[0]?.[1], parsed?.result.nodeMap?.get(1));
  });

  it("round-trips Dates for every accepted safe-integer node ID", () => {
    const payload = payloadWithNodeMap();
    payload.result.nodeMap = new Map([[
      -1,
      { createdAt: new Date("2024-02-03T04:05:06.000Z") },
    ]]);
    payload.nodeMapEntries = Array.from(payload.result.nodeMap.entries());

    const parsed = parseSerializedCachePayload(serializeCachePayload(payload));

    assertEquals(parsed?.result.nodeMap?.get(-1), {
      createdAt: new Date("2024-02-03T04:05:06.000Z"),
    });
  });

  it("writes payloads that origin/main Redis and API readers can consume", () => {
    const payload = payloadWithNodeMap();
    payload.result.frontmatter = {
      date: new Date("2026-07-24T08:30:00.000Z"),
    };

    const raw = serializeCachePayload(payload);
    const wire = JSON.parse(raw) as Record<string, unknown>;
    const redisPayload = JSON.parse(raw) as CachePayload;
    const apiResult = (wire.result ?? {}) as Record<string, unknown>;
    const apiPayload: CachePayload = {
      result: {
        html: apiResult.html as string,
        css: apiResult.css as string | undefined,
        frontmatter: apiResult.frontmatter as CachePayload["result"]["frontmatter"],
        headings: apiResult.headings as CachePayload["result"]["headings"],
        nodeMap: Array.isArray(apiResult.nodeMapEntries)
          ? new Map(apiResult.nodeMapEntries as Array<[number, unknown]>)
          : undefined,
        stream: null,
        pageModule: apiResult.pageModule as CachePayload["result"]["pageModule"],
        ssrHash: apiResult.ssrHash as string | undefined,
      },
      storedAt: wire.storedAt as number,
      expiresAt: wire.expiresAt as number | undefined,
      staleUntil: wire.staleUntil as number | undefined,
    };

    assertEquals(wire.$veryfrontCachePayload, undefined);
    assertEquals(redisPayload.result.html, payload.result.html);
    assertEquals(redisPayload.result.frontmatter, {
      date: "2026-07-24T08:30:00.000Z",
    });
    assertEquals(redisPayload.nodeMapEntries, payload.nodeMapEntries);
    assertEquals(apiPayload.result.frontmatter, redisPayload.result.frontmatter);
    assertEquals(apiPayload.result.nodeMap, payload.result.nodeMap);
    assertEquals(
      parseCachePayload(wire)?.result.frontmatter,
      payload.result.frontmatter,
    );
  });

  it("does not confuse user records with cache codec markers", () => {
    const payload = payloadWithNodeMap();
    const markerLikeRecords = ["date", "record", "unknown"].map((tag) => ({
      $veryfrontCacheValue: tag,
      value: "2026-07-24T08:30:00.000Z",
    }));
    (payload.result.frontmatter as Record<string, unknown>).custom = {
      $veryfrontCacheCodec: {
        version: 1,
        datePaths: [["frontmatter", "date"]],
      },
      markerLikeRecords,
    };

    const serialized = parseCachePayload(
      JSON.parse(serializeCachePayload(payload)),
    );

    assertEquals(
      (serialized?.result.frontmatter as Record<string, unknown>).custom,
      {
        $veryfrontCacheCodec: {
          version: 1,
          datePaths: [["frontmatter", "date"]],
        },
        markerLikeRecords,
      },
    );
  });

  it("supports Date values under arbitrary own data-property names", () => {
    const payload = payloadWithNodeMap();
    const special = Object.create(null) as Record<string, Date>;
    Object.defineProperty(special, "__proto__", {
      value: new Date("2026-07-24T08:30:00.000Z"),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    payload.result.frontmatter = { special };

    const parsed = parseCachePayload(
      JSON.parse(serializeCachePayload(payload)),
    );
    const parsedSpecial = parsed?.result.frontmatter.special as Record<string, unknown>;

    assertEquals(Object.hasOwn(parsedSpecial, "__proto__"), true);
    assertEquals(
      parsedSpecial.__proto__,
      new Date("2026-07-24T08:30:00.000Z"),
    );
    assertEquals(({} as { polluted?: unknown }).polluted, undefined);
  });

  it("continues to read the previous tagged envelope format", () => {
    const previousEnvelope = {
      $veryfrontCachePayload: 1,
      value: {
        result: {
          html: "<p>cached</p>",
          frontmatter: {
            date: {
              $veryfrontCacheValue: "date",
              value: "2026-07-24T08:30:00.000Z",
            },
          },
          stream: null,
        },
        storedAt: 1_000,
        expiresAt: 2_000,
      },
    };

    assertEquals(parseCachePayload(previousEnvelope)?.result.frontmatter, {
      date: new Date("2026-07-24T08:30:00.000Z"),
    });
  });

  it("continues to read exact origin/main Redis payloads", () => {
    const payload = payloadWithNodeMap();
    const legacyWirePayload = JSON.parse(JSON.stringify(payload));

    const parsed = parseCachePayload(legacyWirePayload);

    assertEquals(parsed, cloneCachePayload(payload));
  });

  it("continues to read exact origin/main API payloads", () => {
    const payload = payloadWithNodeMap();
    const legacyWirePayload = {
      result: {
        html: payload.result.html,
        css: payload.result.css,
        frontmatter: payload.result.frontmatter,
        headings: payload.result.headings,
        nodeMapEntries: payload.nodeMapEntries,
        pageModule: payload.result.pageModule,
        ssrHash: payload.result.ssrHash,
      },
      storedAt: payload.storedAt,
      expiresAt: payload.expiresAt,
      staleUntil: payload.staleUntil,
    };

    assertEquals(
      parseCachePayload(JSON.parse(JSON.stringify(legacyWirePayload))),
      cloneCachePayload(payload),
    );
  });

  it("rejects malformed Date codec paths without mutating prototypes", () => {
    const payload = payloadWithNodeMap();
    payload.result.frontmatter = {
      date: new Date("2026-07-24T08:30:00.000Z"),
    };
    const wire = JSON.parse(serializeCachePayload(payload)) as Record<string, unknown>;
    const codec = wire.$veryfrontCacheCodec as {
      version: number;
      datePaths: Array<Array<string | number>>;
    };
    codec.datePaths[0] = ["frontmatter", "__proto__", "polluted"];

    assertEquals(parseCachePayload(wire), undefined);
    assertEquals(({} as { polluted?: unknown }).polluted, undefined);
  });

  it("rejects duplicate Date codec paths", () => {
    const payload = payloadWithNodeMap();
    payload.result.frontmatter = {
      date: new Date("2026-07-24T08:30:00.000Z"),
    };
    const wire = JSON.parse(serializeCachePayload(payload)) as Record<string, unknown>;
    const codec = wire.$veryfrontCacheCodec as {
      version: number;
      datePaths: Array<Array<string | number>>;
    };
    codec.datePaths.push(codec.datePaths[0]!.slice());

    assertEquals(parseCachePayload(wire), undefined);
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

  it("rejects malformed serialized payloads", () => {
    assertEquals(parseSerializedCachePayload("{not-json"), undefined);
  });
});
