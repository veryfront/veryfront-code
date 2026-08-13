/**
 * The child-agent stream contract: the identity a card header renders from, and
 * how live events fold into the one durable snapshot part.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendInvokeAgentStreamSnapshot,
  buildInvokeAgentStreamDataEvent,
  getInvokeAgentStreamEvents,
  getInvokeAgentStreamIdentity,
  INVOKE_AGENT_STREAM_EVENT_NAME,
  parseInvokeAgentStreamValue,
} from "./invoke-agent-stream.ts";

const identity = {
  agentName: "Intake Bot",
  avatarUrl: "https://cdn.example.com/agents/case-ingest.png",
};

function liveValue(
  event: Record<string, unknown> & { type: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    toolCallId: "tool-invoke-agent",
    agentId: "case-ingest",
    ...identity,
    ...overrides,
    event,
  };
}

describe("invoke-agent-stream identity", () => {
  it("reads the identity from a live value", () => {
    const value = liveValue({ type: "reasoning-delta", delta: "Thinking." });
    assertEquals(getInvokeAgentStreamIdentity(value), identity);
  });

  it("reads the identity from a compact snapshot", () => {
    const snapshot = { ...identity, toolCallId: "t", agentId: "a", events: [] };
    assertEquals(getInvokeAgentStreamIdentity(snapshot), identity);
  });

  it("returns an empty identity for non-records and for missing or non-string fields", () => {
    const empty = { agentName: undefined, avatarUrl: undefined };
    assertEquals(getInvokeAgentStreamIdentity(null), {});
    assertEquals(getInvokeAgentStreamIdentity([1, 2]), {});
    assertEquals(getInvokeAgentStreamIdentity("nope"), {});
    assertEquals(getInvokeAgentStreamIdentity({ toolCallId: "t" }), empty);
    assertEquals(getInvokeAgentStreamIdentity({ agentName: 7, avatarUrl: {} }), empty);
  });

  it("carries the identity through build and parse", () => {
    const event = { type: "text-delta", delta: "Working." };
    const built = buildInvokeAgentStreamDataEvent(liveValue(event));
    assertEquals(built.type, INVOKE_AGENT_STREAM_EVENT_NAME);
    assertEquals(built.name, INVOKE_AGENT_STREAM_EVENT_NAME);

    const parsed = parseInvokeAgentStreamValue(built.value);
    assertEquals(parsed?.agentName, identity.agentName);
    assertEquals(parsed?.avatarUrl, identity.avatarUrl);
    assertEquals(parsed?.event, event);
  });

  it("omits identity fields that are absent or the wrong type", () => {
    const parsed = parseInvokeAgentStreamValue({
      toolCallId: "t",
      agentId: "a",
      agentName: 42,
      event: { type: "text-delta", delta: "hi" },
    });
    assertEquals(Object.hasOwn(parsed ?? {}, "agentName"), false);
    assertEquals(Object.hasOwn(parsed ?? {}, "avatarUrl"), false);
  });
});

describe("appendInvokeAgentStreamSnapshot", () => {
  it("keeps the identity once the runtime stops repeating it", () => {
    const first = liveValue({ type: "reasoning-delta", id: "r", delta: "A" });
    const second = liveValue({ type: "text-delta", delta: "B" }, {
      agentName: undefined,
      avatarUrl: undefined,
    });

    const snapshot = appendInvokeAgentStreamSnapshot(
      { ...first, events: [first.event] },
      second,
    );

    assertEquals(snapshot?.agentName, identity.agentName);
    assertEquals(snapshot?.avatarUrl, identity.avatarUrl);
    assertEquals(snapshot?.events.length, 2);
  });

  it("lets a later value update the identity", () => {
    const first = liveValue({ type: "text-delta", delta: "A" }, { agentName: undefined });
    const second = liveValue({ type: "text-delta", delta: "B" }, { agentName: "Renamed" });

    const snapshot = appendInvokeAgentStreamSnapshot(
      { ...first, events: [first.event] },
      second,
    );

    assertEquals(snapshot?.agentName, "Renamed");
  });

  it("merges consecutive deltas of the same stream", () => {
    const first = liveValue({ type: "text-delta", delta: "Hello " });
    const second = liveValue({ type: "text-delta", delta: "world" });

    const snapshot = appendInvokeAgentStreamSnapshot(
      { ...first, events: [first.event] },
      second,
    );

    assertEquals(snapshot?.events, [{ type: "text-delta", delta: "Hello world" }]);
  });

  it("refuses to fold an event from another tool call", () => {
    const first = liveValue({ type: "text-delta", delta: "A" });
    const other = liveValue({ type: "text-delta", delta: "B" }, { toolCallId: "other" });

    assertEquals(
      appendInvokeAgentStreamSnapshot({ ...first, events: [first.event] }, other),
      null,
    );
  });

  it("reads events from both a live value and a snapshot", () => {
    const event = { type: "text-delta", delta: "A" };
    assertEquals(getInvokeAgentStreamEvents(liveValue(event)), [event]);
    assertEquals(getInvokeAgentStreamEvents({ events: [event, { nope: true }] }), [event]);
    assertEquals(getInvokeAgentStreamEvents(null), []);
  });
});
