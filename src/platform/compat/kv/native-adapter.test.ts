import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NativeKv, type NativeKvBackend, type NativeKvBackendEntry } from "./native-adapter.ts";

function createReadBackend(
  entries: NativeKvBackendEntry[],
  onList: (
    selector: { prefix: readonly unknown[] },
    options?: { reverse?: boolean; limit?: number },
  ) => void = () => {},
  onVisit: () => void = () => {},
): NativeKvBackend {
  return {
    get: (key) => Promise.resolve({ key, value: null, versionstamp: null }),
    set: () => Promise.resolve({ ok: true, versionstamp: "1" }),
    delete: () => Promise.resolve(),
    async *list(selector, options) {
      onList(selector, options);
      for (const entry of entries) {
        const prefix = selector.prefix;
        const matches = entry.key.length > prefix.length &&
          prefix.every((part, index) => entry.key[index] === part);
        if (!matches) continue;
        onVisit();
        yield entry;
      }
    },
    close() {},
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("NativeKv list planning", () => {
  it("pushes a structural prefix into the native backend", async () => {
    const entries: NativeKvBackendEntry[] = Array.from({ length: 1_000 }, (_, index) => ({
      key: ["irrelevant", String(index)],
      value: index,
      versionstamp: String(index + 1),
    }));
    entries.push({ key: ["target", "only"], value: "found", versionstamp: "1001" });
    let selector: { prefix: readonly unknown[] } | undefined;
    let visits = 0;
    const kv = new NativeKv(createReadBackend(
      entries,
      (value) => selector = value,
      () => visits++,
    ));

    const result = await collect(kv.list({ prefix: ["target"], limit: 1 }));

    assertEquals(selector, { prefix: ["target"] });
    assertEquals(visits, 1);
    assertEquals(result.map((entry) => entry.key), [["target", "only"]]);
    kv.close();
  });

  it("does not open a native iterator for a zero limit", async () => {
    let listCalls = 0;
    const kv = new NativeKv(createReadBackend([], () => listCalls++));

    assertEquals(await collect(kv.list({ limit: 0 })), []);
    assertEquals(listCalls, 0);
    kv.close();
  });

  it("keeps the requested best entries when provider order differs", async () => {
    const entries: NativeKvBackendEntry[] = Array.from({ length: 100 }, (_, index) => ({
      key: ["items", String(99 - index).padStart(3, "0")],
      value: index,
      versionstamp: String(index + 1),
    }));
    const kv = new NativeKv(createReadBackend(entries));

    const result = await collect(kv.list({ prefix: ["items"], limit: 2 }));

    assertEquals(result.map((entry) => entry.key), [
      ["items", "000"],
      ["items", "001"],
    ]);
    kv.close();
  });

  it("decodes values only after the final top-k entries are selected", async () => {
    for (
      const [reverse, discardedKey, retainedKeys] of [
        [false, "999", ["000", "001"]],
        [true, "000", ["999", "998"]],
      ] as const
    ) {
      const entries: NativeKvBackendEntry[] = [
        {
          key: ["items", discardedKey],
          value: Symbol("invalid discarded value"),
          versionstamp: "1",
        },
        ...retainedKeys.map((key, index) => ({
          key: ["items", key],
          value: key,
          versionstamp: String(index + 2),
        })),
      ];
      const kv = new NativeKv(createReadBackend(entries));

      const result = await collect(kv.list({ prefix: ["items"], limit: 2, reverse }));

      assertEquals(
        result.map((entry) => entry.key),
        retainedKeys.map((key) => ["items", key]),
      );
      assertEquals(result.map((entry) => entry.value), [...retainedKeys]);
      kv.close();
    }
  });

  it("matches bounded top-k order without asking the provider to limit its scan", async () => {
    const entryCount = 257;
    const start = 50;
    const end = 240;
    const limit = 17;

    for (const reverse of [false, true]) {
      const decodeCounts = Array<number>(entryCount).fill(0);
      const entries = Array.from({ length: entryCount }, (_, encounterIndex) => {
        const keyIndex = encounterIndex * 73 % entryCount;
        const value = new Proxy({ keyIndex }, {
          ownKeys(target) {
            decodeCounts[keyIndex] = decodeCounts[keyIndex]! + 1;
            return Reflect.ownKeys(target);
          },
        });
        return {
          key: ["items", String(keyIndex).padStart(3, "0")],
          value,
          versionstamp: String(encounterIndex + 1),
        };
      });
      let providerOptions: { reverse?: boolean; limit?: number } | undefined;
      let visits = 0;
      const kv = new NativeKv(createReadBackend(
        entries,
        (_selector, options) => providerOptions = options,
        () => visits++,
      ));

      const result = await collect(kv.list({
        prefix: ["items"],
        start: ["items", String(start).padStart(3, "0")],
        end: ["items", String(end).padStart(3, "0")],
        limit,
        reverse,
      }));

      const expectedIndexes = Array.from({ length: end - start }, (_, index) => start + index);
      if (reverse) expectedIndexes.reverse();
      const retainedIndexes = expectedIndexes.slice(0, limit);
      assertEquals(
        result.map((entry) => entry.key),
        retainedIndexes.map((index) => ["items", String(index).padStart(3, "0")]),
      );
      assertEquals(providerOptions, undefined);
      assertEquals(visits, entryCount);
      assertEquals(
        decodeCounts,
        decodeCounts.map((_count, index) => retainedIndexes.includes(index) ? 1 : 0),
      );
      kv.close();
    }
  });

  it("preserves stable duplicate-key selection at the top-k boundary", async () => {
    const cases = [
      {
        reverse: false,
        limit: 2,
        entries: [
          { key: ["items", "b"], value: "first b", versionstamp: "1" },
          { key: ["items", "b"], value: "second b", versionstamp: "2" },
          { key: ["items", "a"], value: "a", versionstamp: "3" },
        ],
        expectedValues: ["a", "first b"],
      },
      {
        reverse: true,
        limit: 1,
        entries: [
          { key: ["items", "a"], value: "first a", versionstamp: "1" },
          { key: ["items", "a"], value: "second a", versionstamp: "2" },
          { key: ["items", "a"], value: "third a", versionstamp: "3" },
        ],
        expectedValues: ["third a"],
      },
    ] satisfies Array<{
      reverse: boolean;
      limit: number;
      entries: NativeKvBackendEntry[];
      expectedValues: string[];
    }>;

    for (const testCase of cases) {
      const kv = new NativeKv(createReadBackend(testCase.entries));

      const result = await collect(kv.list({
        prefix: ["items"],
        limit: testCase.limit,
        reverse: testCase.reverse,
      }));

      assertEquals(result.map((entry) => entry.value), testCase.expectedValues);
      kv.close();
    }
  });

  it("sanitizes a malformed value when it belongs to the selected result", async () => {
    const kv = new NativeKv(createReadBackend([{
      key: ["items", "000"],
      value: Symbol("PRIVATE_SELECTED_VALUE"),
      versionstamp: "1",
    }]));

    const error = await assertRejects(() => collect(kv.list({ limit: 1 })));

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.message, "Native KV operation failed");
    assertEquals(JSON.stringify(error).includes("PRIVATE_SELECTED_VALUE"), false);
    kv.close();
  });
});

describe("NativeKv provider boundary", () => {
  it("remains closed when the provider close operation fails", async () => {
    const backend = createReadBackend([]);
    let closeCalls = 0;
    backend.close = () => {
      closeCalls++;
      throw new Error("PRIVATE_CLOSE_FAILURE");
    };
    const kv = new NativeKv(backend);

    assertThrows(() => kv.close(), VeryfrontError, "Native KV operation failed");
    const readError = await assertRejects(() => kv.get(["requested"]));
    kv.close();

    assertInstanceOf(readError, VeryfrontError);
    assertEquals(readError.message, "KV store is closed");
    assertEquals(closeCalls, 1);
  });

  for (
    const [caseName, result] of [
      ["a missing versionstamp", { key: ["requested"], value: null }],
      [
        "a value paired with a null versionstamp",
        { key: ["requested"], value: "PRIVATE_PROVIDER_VALUE", versionstamp: null },
      ],
      [
        "a mismatched response key",
        { key: ["different"], value: "PRIVATE_PROVIDER_VALUE", versionstamp: "1" },
      ],
    ] as const
  ) {
    it(`rejects ${caseName} as a sanitized provider failure`, async () => {
      const backend = createReadBackend([]);
      backend.get = () => Promise.resolve(result as never);
      const kv = new NativeKv(backend);

      const error = await assertRejects(() => kv.get(["requested"]));

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "platform-error");
      assertEquals(JSON.stringify(error).includes("PRIVATE_PROVIDER_VALUE"), false);
      kv.close();
    });
  }

  for (
    const [caseName, result] of [
      ["a missing commit result", undefined],
      ["an unsuccessful commit result", { ok: false }],
      ["a commit without a versionstamp", { ok: true }],
    ] as const
  ) {
    it(`rejects ${caseName} instead of reporting a successful write`, async () => {
      const backend = createReadBackend([]);
      backend.set = () => Promise.resolve(result as never);
      const kv = new NativeKv(backend);

      const error = await assertRejects(() => kv.set(["requested"], "value"));

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "platform-error");
      kv.close();
    });
  }
});
