import "../test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { parseRunReadMemberV1, parseRunReadPageV1, parseStreamMemberV1 } from "./parser.ts";
import type { CanonicalMemberV1, TransientMemberV1 } from "./types.ts";

function durable(source: string, runId = "run_test"): CanonicalMemberV1 {
  return {
    kind: "canonical",
    event: {
      specversion: "1.0",
      vfversion: "1",
      id: "1",
      source,
      subject: runId,
      runid: runId,
      runkind: "agent",
      type: "com.veryfront.message.text.delta.emitted",
      datacontenttype: "application/json",
      dataschema: "urn:veryfront:events:1:data:message.text.delta.emitted:public",
      data: {
        type: "com.veryfront.message.text.delta.emitted",
        messageId: "message1",
        delta: "hello",
      },
      recordedat: "2026-10-12T00:00:00Z",
    },
    metadata: {
      event_id: 1,
      run_id: runId,
      storage: "persisted",
      view: "public",
      recorded_at: "2026-10-12T00:00:00Z",
      event_class: null,
      is_error: false,
      span_id: null,
      turn_id: null,
      unrecoverable_fields: [],
    },
  };
}
function transient(source: string): TransientMemberV1 {
  return {
    kind: "transient",
    view: "public",
    event: {
      specversion: "1.0",
      vfversion: "1",
      id: "live:1",
      source,
      subject: "run_test",
      runid: "run_test",
      runkind: "agent",
      time: "2026-10-12T00:00:00Z",
      type: "com.veryfront.stream.heartbeat.emitted",
      datacontenttype: "application/json",
      dataschema: "urn:veryfront:events:1:data:stream.heartbeat.emitted:public",
      data: { type: "com.veryfront.stream.heartbeat.emitted", runId: "run_test", lastEventId: 1 },
    },
  };
}

describe("canonical-v1 physical-store producing sources", () => {
  it("preserves configured store bases across individual, page and stream reads", async () => {
    for (
      const base of [
        "https://events.test.invalid",
        "https://events.test.invalid/store-unit",
        "https://events.test.invalid/stores/store-1",
      ]
    ) {
      const member = durable(`${base}/runs/run_test`);
      assertEquals(await parseRunReadMemberV1(member), member);
      const page = { entries: [member], next_cursor: null, has_more: false };
      assertEquals(await parseRunReadPageV1(page), page);
      assertEquals(await parseStreamMemberV1(member), member);
      const live = transient(`${base}/runs/run_test/streams/stream-1`);
      assertEquals(await parseStreamMemberV1(live), live);
    }
  });
  it("matches the producing run as one exactly encoded path component", async () => {
    const runId = "run/with space";
    const member = durable(
      `https://events.test.invalid/stores/store-1/runs/${encodeURIComponent(runId)}`,
      runId,
    );
    assertEquals(await parseRunReadMemberV1(member), member);
    for (
      const suffix of [
        "run/with%20space",
        "run%2fwith%20space",
        "run%252Fwith%20space",
        "other",
        "run%2Fwith%20space/extra",
      ]
    ) {
      await assertRejects(
        () =>
          parseRunReadMemberV1(
            durable(`https://events.test.invalid/stores/store-1/runs/${suffix}`, runId),
          ),
        TypeError,
      );
    }
  });
  it("rejects unsafe store bases and unrelated or aliased run paths", async () => {
    for (
      const source of [
        "http://events.test.invalid/store-unit/runs/run_test",
        "https://user:password@events.test.invalid/store-unit/runs/run_test",
        "https://events.test.invalid/store-unit/runs/run_test?view=public",
        "https://events.test.invalid/store-unit/runs/run_test#alias",
        "https://events.test.invalid/store-unit/runs/wrong",
        "https://events.test.invalid/store-unit/runs/run_test/extra",
        "https://events.test.invalid/store-unit/runs/%72un_test",
        "https://events.test.invalid/store-unit/../runs/run_test",
        "https://events.test.invalid/store-unit/%2e%2e/runs/run_test",
        "https://events.test.invalid/store-unit//runs/run_test",
        "https://events.test.invalid/store-unit\\runs/run_test",
        "https://events.test.invalid/store%2Funit/runs/run_test",
        "https://events.test.invalid/store%ZZ/runs/run_test",
      ]
    ) {
      await assertRejects(() => parseRunReadMemberV1(durable(source)), TypeError);
    }
    for (
      const suffix of [
        "other/streams/stream-1",
        "run_test/streams/",
        "run_test/streams/stream-1/extra",
      ]
    ) {
      await assertRejects(
        () =>
          parseStreamMemberV1(transient(`https://events.test.invalid/store-unit/runs/${suffix}`)),
        TypeError,
      );
    }
  });
});
