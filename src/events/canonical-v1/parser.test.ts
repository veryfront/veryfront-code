import "../test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { parseRunReadPageV1, parseStreamMemberV1 } from "./parser.ts";
import type { LegacyMemberV1 } from "./types.ts";
const row: LegacyMemberV1 = {
  kind: "legacy",
  reason: "unknown_type",
  legacy: { event_type: "old\nsource", payload: { message: "authorized" } },
  metadata: {
    event_id: 42,
    run_id: "run_demo",
    storage: "persisted",
    view: "public",
    recorded_at: null,
    event_class: null,
    is_error: null,
    span_id: null,
    turn_id: null,
    unrecoverable_fields: [],
  },
};
describe("canonical-v1 compatibility read decoding", () => {
  it("validates large mixed pages within each member's serialization budget", async () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      ...row,
      legacy: { ...row.legacy, payload: { message: "x".repeat(900_000) } },
      metadata: { ...row.metadata, event_id: index + 1 },
    }));
    const page = await parseRunReadPageV1({ entries, next_cursor: "5", has_more: true });
    assertEquals(page.entries.length, 5);
    assertEquals(page.entries[4], entries[4]);
  });
  it("retains page shape, member budgets and accessor rejection", async () => {
    for (
      const input of [
        { entries: Array.from({ length: 101 }, () => row), next_cursor: null, has_more: false },
        { entries: [row], next_cursor: null, has_more: false, unknown: true },
        {
          entries: [{ ...row, legacy: { ...row.legacy, payload: "x".repeat(1_100_000) } }],
          next_cursor: null,
          has_more: false,
        },
        { entries: [row, { ...row, reason: "invalid" }], next_cursor: null, has_more: false },
      ]
    ) await assertRejects(() => parseRunReadPageV1(input), TypeError);
    let calls = 0;
    const input = { next_cursor: null, has_more: false };
    Object.defineProperty(input, "entries", {
      enumerable: true,
      get() {
        calls++;
        return [row];
      },
    });
    await assertRejects(() => parseRunReadPageV1(input), TypeError);
    assertEquals(calls, 0);
  });
  it("retains arbitrary source spelling and caller-visible payload", async () => {
    const page = await parseRunReadPageV1({ entries: [row], next_cursor: "42", has_more: true });
    assertEquals(page.entries[0], row);
  });
  it("rejects a cursor from a scanned row instead of the last returned row", async () => {
    await assertRejects(
      () => parseRunReadPageV1({ entries: [row], next_cursor: "43", has_more: true }),
      TypeError,
    );
  });
  it("rejects unsafe IDs and derived members in durable streams", async () => {
    await assertRejects(
      () =>
        parseRunReadPageV1({
          entries: [{ ...row, metadata: { ...row.metadata, event_id: 9007199254740992 } }],
          next_cursor: null,
          has_more: false,
        }),
      TypeError,
    );
    await assertRejects(
      () =>
        parseStreamMemberV1({
          ...row,
          reason: "derived_history",
          metadata: { ...row.metadata, storage: "derived" },
        }),
      TypeError,
    );
  });
});

import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import { registerEventSchemaValidator } from "../schema-validator.ts";
import { parseEventDiscoveryV1 } from "./parser.ts";
it("caches decoders and recompiles after validator registration changes", async () => {
  for (let generation = 0; generation < 2; generation++) {
    const adapter = createZodAdapter();
    const compile = adapter.compileJsonSchema;
    if (!compile) throw new Error("Fixture validator needs JSON Schema compilation");
    let compilations = 0;
    registerEventSchemaValidator({
      ...adapter,
      compileJsonSchema(schema) {
        compilations++;
        return compile(schema);
      },
    });
    for (let read = 0; read < 5; read++) {
      await parseEventDiscoveryV1({ version: "1", revision: "1.0-draft.8", events: [] });
    }
    assertEquals(compilations, 1);
  }
  registerEventSchemaValidator(createZodAdapter());
});

import { parseEventErrorV1 } from "./parser.ts";
it("rejects forbidden CloudEvents characters in structured errors", async () => {
  for (const field of ["code", "message"]) {
    await assertRejects(
      () => parseEventErrorV1({ code: "UNAVAILABLE", message: "Try again", [field]: "bad\nvalue" }),
      TypeError,
    );
  }
});
