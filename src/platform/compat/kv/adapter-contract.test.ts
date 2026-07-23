import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryKv } from "./memory-adapter.ts";
import { NativeKv, type NativeKvBackend } from "./native-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import { compareEncodedKvKeys } from "./contract.ts";
import { type Kv, KV_PORTABLE_LIMITS, type KvListOptions, type SqliteDatabase } from "./types.ts";

async function collectEntries<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const entries: T[] = [];
  for await (const entry of iterable) entries.push(entry);
  return entries;
}

function createTestDatabase(): SqliteDatabase {
  const store = new Map<string, { value: string; versionstamp?: string }>();
  let metadataVersionstamp: string | undefined;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new Error("Test database is closed: <REDACTED>");
  };

  return {
    exec() {
      ensureOpen();
    },
    prepare(sql: string) {
      ensureOpen();
      return {
        get(...params: unknown[]): unknown {
          ensureOpen();
          if (sql.includes("veryfront_kv_metadata")) {
            const candidate = params[0] as string;
            metadataVersionstamp = metadataVersionstamp && metadataVersionstamp >= candidate
              ? (BigInt(metadataVersionstamp) + 1n).toString().padStart(20, "0")
              : candidate;
            return { value: metadataVersionstamp };
          }
          if (!sql.includes("SELECT")) return undefined;
          const entry = store.get(params[0] as string);
          return entry && { value: entry.value, versionstamp: entry.versionstamp };
        },
        run(...params: unknown[]): void {
          ensureOpen();
          if (sql.includes("INSERT OR REPLACE")) {
            const [key, value, versionstamp] = params as [string, string, string];
            store.set(key, { value, versionstamp });
          } else if (sql.includes("DELETE")) {
            store.delete(params[0] as string);
          }
        },
        all(...params: unknown[]): unknown[] {
          ensureOpen();
          let entries = [...store.entries()];
          let parameterIndex = 0;

          if (sql.includes("substr(key")) {
            parameterIndex++;
            const literalPrefix = params[parameterIndex++] as string;
            entries = entries.filter(([key]) => key.startsWith(literalPrefix));
          }
          if (sql.includes("LIKE")) {
            const pattern = params[parameterIndex++] as string;
            const literalPrefix = pattern.slice(0, -1);
            entries = entries.filter(([key]) => key.startsWith(literalPrefix));
          }
          if (sql.includes("key >=")) {
            const start = params[parameterIndex++] as string;
            entries = entries.filter(([key]) => key >= start);
          }
          if (sql.includes("key <")) {
            const end = params[parameterIndex++] as string;
            entries = entries.filter(([key]) => key < end);
          }

          entries.sort(([left], [right]) => compareEncodedKvKeys(left, right));
          if (sql.includes("DESC")) entries.reverse();
          if (sql.includes("LIMIT")) {
            entries = entries.slice(0, params[parameterIndex] as number);
          }

          return entries.map(([key, entry]) => ({ key, ...entry }));
        },
      };
    },
    close() {
      ensureOpen();
      closed = true;
    },
  };
}

function createNativeBackend(): NativeKvBackend {
  const store = new Map<string, { key: string[]; value: unknown; versionstamp: string }>();
  let version = 0;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new Error("Native test backend is closed: <REDACTED>");
  };

  return {
    async get(key) {
      ensureOpen();
      const entry = store.get(JSON.stringify(key));
      return entry
        ? { key: [...entry.key], value: entry.value, versionstamp: entry.versionstamp }
        : { key: [...key], value: null, versionstamp: null };
    },
    async set(key, value) {
      ensureOpen();
      const stringKey = [...key] as string[];
      const versionstamp = String(++version).padStart(20, "0");
      store.set(JSON.stringify(stringKey), { key: stringKey, value, versionstamp });
      return { ok: true, versionstamp };
    },
    async delete(key) {
      ensureOpen();
      store.delete(JSON.stringify(key));
    },
    async *list() {
      ensureOpen();
      for (const entry of [...store.values()].reverse()) {
        ensureOpen();
        yield { key: [...entry.key], value: entry.value, versionstamp: entry.versionstamp };
      }
    },
    close() {
      ensureOpen();
      closed = true;
    },
  };
}

async function assertRejectsWithSlug(
  operation: () => Promise<unknown>,
  slug: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof VeryfrontError, "Expected a typed Veryfront error");
  assertEquals(caught.slug, slug);
}

const adapters: Array<[string, () => Kv]> = [
  ["MemoryKv", () => new MemoryKv()],
  ["NativeKv", () => new NativeKv(createNativeBackend())],
  ["SqliteKv", () => new SqliteKv(createTestDatabase())],
];

for (const [adapterName, createAdapter] of adapters) {
  describe(`${adapterName} contract`, () => {
    it("matches prefixes by complete key parts and excludes the prefix key", async () => {
      const kv = createAdapter();
      await kv.set(["users"], "prefix");
      await kv.set(["users", "1"], "alice");
      await kv.set(["users", "nested", "2"], "bob");
      await kv.set(["users-archive", "1"], "carol");

      const entries = await collectEntries(kv.list({ prefix: ["users"] }));

      assertEquals(entries.map((entry) => entry.key), [
        ["users", "1"],
        ["users", "nested", "2"],
      ]);
      kv.close();
    });

    it("applies a limit after structured prefix filtering", async () => {
      const kv = createAdapter();
      await kv.set(["a"], "prefix");
      await kv.set(["a", "1"], "descendant");

      const entries = await collectEntries(
        kv.list({ prefix: ["a"], limit: 1, reverse: true }),
      );

      assertEquals(entries.map((entry) => entry.key), [["a", "1"]]);
      kv.close();
    });

    it("treats a zero limit as an empty result", async () => {
      const kv = createAdapter();
      await kv.set(["a"], 1);

      assertEquals(await collectEntries(kv.list({ limit: 0 })), []);
      kv.close();
    });

    it("fails explicitly instead of buffering more entries than the configured scan bound", async () => {
      const kv = createAdapter();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      await assertRejectsWithSlug(
        () => collectEntries(kv.list({ maxScanEntries: 2 })),
        "platform-error",
      );
      kv.close();
    });

    it("rejects result limits larger than the configured scan bound", async () => {
      const kv = createAdapter();
      await assertRejectsWithSlug(
        () => collectEntries(kv.list({ limit: 3, maxScanEntries: 2 })),
        "invalid-argument",
      );
      kv.close();
    });

    for (const invalidMaxScanEntries of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`rejects the invalid list scan bound ${String(invalidMaxScanEntries)}`, async () => {
        const kv = createAdapter();
        await assertRejectsWithSlug(
          () => collectEntries(kv.list({ maxScanEntries: invalidMaxScanEntries })),
          "invalid-argument",
        );
        kv.close();
      });
    }

    it("treats an empty prefix as every non-empty stored key", async () => {
      const kv = createAdapter();
      await kv.set(["a"], 1);
      await kv.set(["b", "1"], 2);

      const entries = await collectEntries(kv.list({ prefix: [] }));

      assertEquals(entries.map((entry) => entry.key), [["a"], ["b", "1"]]);
      kv.close();
    });

    it("uses UTF-8 key ordering consistently with durable and native stores", async () => {
      const kv = createAdapter();
      await kv.set(["\u{10000}"], "supplementary");
      await kv.set(["\uE000"], "private-use");

      const entries = await collectEntries(kv.list({ limit: 1 }));

      assertEquals(entries.map((entry) => entry.key), [["\uE000"]]);
      kv.close();
    });

    for (const invalidLimit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`rejects the invalid list limit ${String(invalidLimit)}`, async () => {
        const kv = createAdapter();
        await assertRejectsWithSlug(
          () => collectEntries(kv.list({ limit: invalidLimit })),
          "invalid-argument",
        );
        kv.close();
      });
    }

    it("stores and returns independent JSON-compatible values", async () => {
      const kv = createAdapter();
      const input = { nested: { count: 1 } };
      await kv.set(["value"], input);
      input.nested.count = 2;

      const first = await kv.get<typeof input>(["value"]);
      assertEquals(first.value, { nested: { count: 1 } });
      first.value!.nested.count = 3;

      const listed = await collectEntries(kv.list<typeof input>());
      const listedEntry = listed[0]!;
      assertEquals(listedEntry.value, { nested: { count: 1 } });
      listedEntry.value.nested.count = 4;

      assertEquals((await kv.get<typeof input>(["value"])).value, {
        nested: { count: 1 },
      });
      kv.close();
    });

    it("rejects values outside the persisted JSON codec", async () => {
      const kv = createAdapter();
      await assertRejectsWithSlug(
        () => kv.set(["unsupported"], undefined),
        "invalid-argument",
      );
      kv.close();
    });

    it("rejects values that JSON serialization would silently change", async () => {
      const kv = createAdapter();
      const sparse: unknown[] = [];
      sparse.length = 1;
      const lossyValues: unknown[] = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -0,
        new Map([["key", "value"]]),
        new Date(0),
        { keep: 1, drop: undefined },
        sparse,
      ];

      for (const value of lossyValues) {
        await assertRejectsWithSlug(
          () => kv.set(["lossy"], value),
          "invalid-argument",
        );
      }
      kv.close();
    });

    it("rejects accessors without invoking them and rejects cyclic values", async () => {
      const kv = createAdapter();
      let getterCalls = 0;
      const accessor = Object.defineProperty({}, "private", {
        enumerable: true,
        get() {
          getterCalls++;
          return "PRIVATE_GETTER_VALUE";
        },
      });
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      await assertRejectsWithSlug(() => kv.set(["accessor"], accessor), "invalid-argument");
      await assertRejectsWithSlug(() => kv.set(["cyclic"], cyclic), "invalid-argument");

      assertEquals(getterCalls, 0);
      kv.close();
    });

    it("enforces portable key and value size bounds before backend access", async () => {
      const kv = createAdapter();
      const oversizedKey = ["x".repeat(2_047)];
      const tooManyParts = Array<string>(1_025).fill("");
      const oversizedValue = "x".repeat(61 * 1_024);

      await assertRejectsWithSlug(() => kv.get(oversizedKey), "invalid-argument");
      await assertRejectsWithSlug(() => kv.set(tooManyParts, "value"), "invalid-argument");
      await assertRejectsWithSlug(
        () => kv.set(["oversized"], oversizedValue),
        "invalid-argument",
      );
      await assertRejectsWithSlug(
        () => collectEntries(kv.list({ prefix: oversizedKey })),
        "invalid-argument",
      );
      kv.close();
    });

    it("accepts portable keys and values near the shared limits", async () => {
      const kv = createAdapter();
      const key = ["x".repeat(2_000)];
      const value = "x".repeat(59 * 1_024);

      await kv.set(key, value);

      assertEquals((await kv.get<string>(key)).value, value);
      kv.close();
    });

    it("creates unique increasing versionstamps within one millisecond", async () => {
      const kv = createAdapter();
      const originalNow = Date.now;
      Date.now = () => 1_700_000_000_000;

      try {
        await kv.set(["version"], 1);
        const first = (await kv.get(["version"])).versionstamp!;
        await kv.set(["version"], 2);
        const second = (await kv.get(["version"])).versionstamp!;

        assert(first < second, "Expected the second versionstamp to increase");
      } finally {
        Date.now = originalNow;
        kv.close();
      }
    });

    for (const operation of ["get", "set", "delete"] as const) {
      it(`rejects malformed keys passed to ${operation}`, async () => {
        const kv = createAdapter();
        const invalidKey = ["valid", 1] as unknown as string[];
        const invoke = operation === "get"
          ? () => kv.get(invalidKey)
          : operation === "set"
          ? () => kv.set(invalidKey, "value")
          : () => kv.delete(invalidKey);

        await assertRejectsWithSlug(invoke, "invalid-argument");
        kv.close();
      });
    }

    it("rejects empty keys", async () => {
      const kv = createAdapter();
      await assertRejectsWithSlug(() => kv.get([]), "invalid-argument");
      kv.close();
    });

    it("rejects unpaired UTF-16 surrogates on every key surface", async () => {
      const kv = createAdapter();
      const malformed = ["\uD800"];

      await assertRejectsWithSlug(() => kv.get(malformed), "invalid-argument");
      await assertRejectsWithSlug(() => kv.set(malformed, "value"), "invalid-argument");
      await assertRejectsWithSlug(() => kv.delete(malformed), "invalid-argument");
      for (
        const options of [
          { prefix: malformed },
          { start: malformed },
          { end: malformed },
        ]
      ) {
        await assertRejectsWithSlug(
          () => collectEntries(kv.list(options)),
          "invalid-argument",
        );
      }
      kv.close();
    });

    it("rejects an unreadable key container with a typed error", async () => {
      const kv = createAdapter();
      const key = Proxy.revocable<string[]>([], {});
      key.revoke();

      await assertRejectsWithSlug(() => kv.get(key.proxy), "invalid-argument");
      kv.close();
    });

    it("treats equal bounds as an empty range", async () => {
      const kv = createAdapter();
      await kv.set(["a"], 1);

      assertEquals(
        await collectEntries(kv.list({ start: ["a"], end: ["a"] })),
        [],
      );
      kv.close();
    });

    const malformedSelectors: Array<[string, KvListOptions]> = [
      ["non-array prefix", { prefix: "a" as unknown as string[] }],
      ["non-string prefix part", { prefix: ["a", 1] as unknown as string[] }],
      ["non-array start", { start: "a" as unknown as string[] }],
      ["non-array end", { end: "z" as unknown as string[] }],
      ["non-boolean reverse", { reverse: "yes" as unknown as boolean }],
      ["reversed bounds", { start: ["z"], end: ["a"] }],
    ];

    for (const [caseName, selector] of malformedSelectors) {
      it(`rejects a malformed selector with ${caseName}`, async () => {
        const kv = createAdapter();
        await assertRejectsWithSlug(
          () => collectEntries(kv.list(selector)),
          "invalid-argument",
        );
        kv.close();
      });
    }

    it("rejects unreadable list options with a typed error", async () => {
      const kv = createAdapter();
      const options = Proxy.revocable<KvListOptions>({}, {});
      options.revoke();

      await assertRejectsWithSlug(
        () => collectEntries(kv.list(options.proxy)),
        "invalid-argument",
      );
      kv.close();
    });

    it("rejects operations after close with a stable typed error", async () => {
      const kv = createAdapter();
      const iterator = kv.list();
      kv.close();

      await assertRejectsWithSlug(() => kv.get(["key"]), "platform-error");
      await assertRejectsWithSlug(() => kv.set(["key"], "value"), "platform-error");
      await assertRejectsWithSlug(() => kv.delete(["key"]), "platform-error");
      await assertRejectsWithSlug(() => collectEntries(iterator), "platform-error");
    });

    it("allows close to be called more than once", () => {
      const kv = createAdapter();
      kv.close();
      kv.close();
    });
  });
}

describe("KV portable list bounds", () => {
  it("publishes a finite safe default and a finite configurable ceiling", () => {
    assertEquals(KV_PORTABLE_LIMITS.defaultListScanEntries, 1_000);
    assertEquals(KV_PORTABLE_LIMITS.maxListScanEntries, 10_000);
  });
});
