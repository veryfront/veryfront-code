import "#veryfront/schemas/_test-setup.ts";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { SqliteDatabase } from "./types.ts";

function adaptDatabase(database: DatabaseSync): SqliteDatabase {
  return {
    exec: (sql) => database.exec(sql),
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        get: (...params) => statement.get(...params as SQLInputValue[]),
        run: (...params) => {
          statement.run(...params as SQLInputValue[]);
        },
        all: (...params) => statement.all(...params as SQLInputValue[]),
      };
    },
    close: () => database.close(),
  };
}

describe("SqliteKv real SQLite contract", () => {
  it("rejects persisted values outside the portable contract", async () => {
    const database = new DatabaseSync(":memory:");
    const kv = new SqliteKv(adaptDatabase(database));
    const insert = database.prepare(`
      INSERT INTO kv_store (key, value, versionstamp, created_at, updated_at)
      VALUES (?, ?, 'legacy', 0, 0)
    `);
    insert.run('["malformed"]', JSON.stringify("\ud800"));
    insert.run('["oversized"]', JSON.stringify("x".repeat(61 * 1_024)));
    insert.run('["padded"]', `${" ".repeat(61 * 1_024)}"ok"`);
    insert.run('["escaped"]', `"${"\\u0061".repeat(11_000)}"`);

    try {
      for (const key of [["malformed"], ["oversized"], ["padded"], ["escaped"]]) {
        const error = await assertRejects(() => kv.get(key));
        assert(error instanceof VeryfrontError);
        assertEquals(error.message, "Stored KV value is invalid");
      }

      const listError = await assertRejects(async () => {
        for await (const _entry of kv.list()) {
          // Decoding the provider row triggers contract validation.
        }
      });
      assert(listError instanceof VeryfrontError);
      assertEquals(listError.message, "Stored KV value is invalid");
    } finally {
      kv.close();
    }
  });

  it("uses the primary-key index for prefix range selection", () => {
    const database = new DatabaseSync(":memory:");
    const kv = new SqliteKv(adaptDatabase(database));

    try {
      const plan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT key, value, versionstamp FROM kv_store
        WHERE key >= ? AND key < ?
        ORDER BY key
      `).all('["users",', '["users"]');
      const detail = plan.map((row) => String(row.detail)).join(" ");

      assert(detail.includes("SEARCH kv_store USING INDEX"), detail);
      assertEquals(detail.includes("SCAN kv_store"), false);
    } finally {
      kv.close();
    }
  });

  it("keeps Unicode ordering and version allocation consistent across connections", async () => {
    const databasePath = await Deno.makeTempFile({ prefix: "veryfront-kv-", suffix: ".sqlite" });
    const first = new SqliteKv(adaptDatabase(new DatabaseSync(databasePath)));
    const second = new SqliteKv(adaptDatabase(new DatabaseSync(databasePath)));
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;

    try {
      await first.set(["\u{10000}"], "supplementary");
      await second.set(["\uE000"], "private-use");

      const entries = [];
      for await (const entry of first.list({ limit: 1 })) entries.push(entry);
      const firstVersion = (await first.get(["\u{10000}"])).versionstamp!;
      const secondVersion = (await second.get(["\uE000"])).versionstamp!;

      assertEquals(entries.map((entry) => entry.key), [["\uE000"]]);
      assertEquals(firstVersion < secondVersion, true);
    } finally {
      Date.now = originalNow;
      first.close();
      second.close();
      await Deno.remove(databasePath);
    }
  });
});
