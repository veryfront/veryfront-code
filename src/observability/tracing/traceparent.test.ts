import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatTraceparent, parseTraceparent } from "./traceparent.ts";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

describe("traceparent", () => {
  it("round-trips a span context", () => {
    const encoded = formatTraceparent({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 });
    assertEquals(encoded, `00-${TRACE_ID}-${SPAN_ID}-01`);
    assertEquals(parseTraceparent(encoded), {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
    });
  });

  it("refuses to encode the placeholder context a no-op tracer returns", () => {
    // Persisting this would produce a link that resolves to no span at all.
    assertEquals(
      formatTraceparent({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }),
      undefined,
    );
    assertEquals(formatTraceparent(undefined), undefined);
  });

  it("returns undefined rather than throwing on anything unparseable", () => {
    // A corrupted or hand-edited run record costs the link and nothing else.
    for (
      const value of [
        undefined,
        "",
        "not-a-traceparent",
        `00-${TRACE_ID}-${SPAN_ID}`,
        `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`,
        `00-${"0".repeat(32)}-${SPAN_ID}-01`,
        `00-${TRACE_ID}-${"0".repeat(16)}-01`,
        `ff-${TRACE_ID}-${SPAN_ID}-01`,
      ]
    ) {
      assertEquals(parseTraceparent(value), undefined, `expected ${value} to be rejected`);
    }
  });

  it("accepts a future version's extra fields instead of dropping the link", () => {
    const parsed = parseTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-something-else`);
    assertEquals(parsed?.traceId, TRACE_ID);
    assertEquals(parsed?.spanId, SPAN_ID);
  });
});
