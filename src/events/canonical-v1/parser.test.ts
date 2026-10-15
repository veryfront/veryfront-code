import "../test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  decodeDescendantCursorV1,
  parseDescendantRunReadPageV1,
  parseRunReadPageV1,
  parseStreamMemberV1,
} from "./parser.ts";
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

describe("strict descendant cursor codec", () => {
  const payload = {
    version: 1,
    root_run_id: "run_demo",
    producing_run_id: "run_demo",
    view: "public",
    sort_order: "asc",
    filters_digest: "a".repeat(64),
    event_id: "42",
    store: "agent_run_event",
  };
  const encode = (value: unknown) =>
    "vfd1." +
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  it("validates canonical encoding and preserves explicit profile", async () => {
    const next_cursor = encode(payload);
    assertEquals(await decodeDescendantCursorV1(next_cursor), payload);
    assertEquals(
      (await parseDescendantRunReadPageV1({
        cursor_profile: "run-events-descendants-v1",
        entries: [row],
        next_cursor,
        has_more: true,
      })).next_cursor,
      next_cursor,
    );
  });
  it("rejects malformed, noncanonical, oversized and out of range tokens", async () => {
    const { version, ...rest } = payload;
    for (
      const token of [
        "42",
        "vfd1.A",
        "vfd1." + "a".repeat(2048),
        encode({ ...payload, unknown: true }),
        encode({ ...payload, event_id: "9007199254740992" }),
        encode({ ...payload, event_id: "042" }),
        encode({ ...payload, root_run_id: "invalid/run" }),
        encode({ ...payload, view: "private" }),
        encode({ ...rest, version }),
        encode({ ...payload, store: "unknown" }),
      ]
    ) await assertRejects(() => decodeDescendantCursorV1(token));
  });
});

it("enforces descendant page item bounds and continuation condition after split validation", async () => {
  for (
    const input of [
      {
        cursor_profile: "run-events-descendants-v1",
        entries: [],
        next_cursor: null,
        has_more: true,
      },
      {
        cursor_profile: "run-events-descendants-v1",
        entries: [],
        next_cursor: "vfd1.abc",
        has_more: true,
      },
      {
        cursor_profile: "run-events-descendants-v1",
        entries: [row],
        next_cursor: "vfd1.abc",
        has_more: false,
      },
      {
        cursor_profile: "run-events-descendants-v1",
        entries: Array.from({ length: 101 }, () => row),
        next_cursor: null,
        has_more: false,
      },
      {
        cursor_profile: "run-events-descendants-v1",
        entries: [{ ...row, reason: "invalid" }],
        next_cursor: null,
        has_more: false,
      },
    ]
  ) await assertRejects(() => parseDescendantRunReadPageV1(input));
});
