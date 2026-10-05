import "#veryfront/schemas/_test-setup.ts";
import "./test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import pilotTranscript from "./contracts/pilot-transcript.json" with { type: "json" };
import { parseAgentEvent } from "./index.ts";
import type { AgentEvent } from "./types.ts";

interface PilotFrame {
  readonly profile: "stored" | "live";
  readonly position: string | null;
  readonly event: unknown;
}

function frames(): readonly PilotFrame[] {
  return pilotTranscript.frames as readonly PilotFrame[];
}

describe("events/pilot-transcript", () => {
  it("parses every shared pilot frame", () => {
    const parsed = frames().map((frame) => parseAgentEvent(frame.event));
    assertEquals(parsed.length, 19);
    assertEquals(frames().filter((frame) => frame.profile === "stored").length, 17);
    assertEquals(frames().filter((frame) => frame.profile === "live").length, 2);
  });

  it("keeps live stream signals positionless", () => {
    for (const frame of frames()) {
      assertEquals(frame.position === null, frame.profile === "live");
    }
  });

  it("deduplicates replayed stored events by event identity after reconnect", () => {
    const stored = frames().filter((frame) => frame.profile === "stored");
    const byPosition = new Map(stored.map((frame) => [frame.position, frame]));
    const delivered = pilotTranscript.reconnect.deliveredBeforeDisconnect.map((position) =>
      byPosition.get(position)
    );
    const replayed = pilotTranscript.reconnect.replayedAfterReconnect.map((position) =>
      byPosition.get(position)
    );
    assert(delivered.every((frame) => frame !== undefined));
    assert(replayed.every((frame) => frame !== undefined));
    assertEquals(replayed[0], delivered.at(-1));

    const unique = new Map<string, AgentEvent>();
    for (const frame of [...delivered, ...replayed]) {
      assert(frame);
      const event = parseAgentEvent(frame.event);
      unique.set(`${event.source}\n${event.id}`, event);
    }

    assertEquals(unique.size, stored.length);
    const text = [...unique.values()]
      .filter((event) => event.type === "com.veryfront.message.text.delta.emitted")
      .map((event) => event.data.delta)
      .join("");
    assertEquals(text, pilotTranscript.expected.text.value);

    const lastStoredFrame = stored.at(-1);
    assert(lastStoredFrame);
    const terminal = parseAgentEvent(lastStoredFrame.event);
    assertEquals(lastStoredFrame.position, pilotTranscript.expected.finalSavedPosition);
    assertEquals(terminal.type, "com.veryfront.run.succeeded");
  });

  it("keeps redacted reasoning out of reconstructed text", () => {
    const stored = frames().filter((frame) => frame.profile === "stored");
    const reasoning = stored
      .map((frame) => parseAgentEvent(frame.event))
      .filter((event) => event.type === "com.veryfront.message.reasoning.delta.emitted");
    assert(reasoning.some((event) => event.data.contentRedacted === true));
    const text = reasoning.map((event) => event.data.delta ?? "").join("");
    assertEquals(text, pilotTranscript.expected.reasoning.text);
  });
});
