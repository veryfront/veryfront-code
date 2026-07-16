import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import {
  buildToolsActivatedEvent,
  buildToolsActivationRejectedEvent,
  hydrateToolDiscoveryFromEvents,
} from "./tool-discovery-events.ts";
import type { RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";

describe("tool discovery events", () => {
  describe("buildToolsActivatedEvent", () => {
    it("produces a CUSTOM event with name tools_activated", () => {
      const event = buildToolsActivatedEvent(["read_file", "write_file"]);
      assertEquals(event.type, "CUSTOM");
      assertEquals(event.name, "tools_activated");
      assertEquals((event.value as { names: string[] }).names, ["read_file", "write_file"]);
    });
  });

  describe("buildToolsActivationRejectedEvent", () => {
    it("produces a CUSTOM event with name tools_activation_rejected", () => {
      const event = buildToolsActivationRejectedEvent(
        ["bad_tool"],
        { bad_tool: "unknown_tool" },
      );
      assertEquals(event.type, "CUSTOM");
      assertEquals(event.name, "tools_activation_rejected");
      const value = event.value as { names: string[]; reasons: Record<string, string> };
      assertEquals(value.names, ["bad_tool"]);
      assertEquals(value.reasons["bad_tool"], "unknown_tool");
    });
  });

  describe("hydrateToolDiscoveryFromEvents", () => {
    it("populates activatedRemoteToolNames from tools_activated events", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        buildToolsActivatedEvent(["read_file", "write_file"]) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames?.has("read_file"), true);
      assertEquals(context.activatedRemoteToolNames?.has("write_file"), true);
    });

    it("merges multiple activation events", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        buildToolsActivatedEvent(["read_file"]) as ConversationRunEvent,
        buildToolsActivatedEvent(["write_file"]) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames?.has("read_file"), true);
      assertEquals(context.activatedRemoteToolNames?.has("write_file"), true);
    });

    it("ignores non-CUSTOM events", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        { type: "TOOL_CALL_RESULT", toolCallId: "tc-1", content: "ok", role: "tool" },
        buildToolsActivatedEvent(["read_file"]) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames?.size, 1);
    });

    it("ignores CUSTOM events with unknown names", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        { type: "CUSTOM", name: "other_event", value: { names: ["read_file"] } },
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames, undefined);
    });

    it("ignores tools_activation_rejected events (rejected tools stay inactive)", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        buildToolsActivationRejectedEvent(
          ["bad_tool"],
          { bad_tool: "unknown_tool" },
        ) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames, undefined);
    });

    it("handles a realistic resume sequence (activation followed by rejection)", () => {
      const context: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        buildToolsActivatedEvent(["read_file"]) as ConversationRunEvent,
        buildToolsActivationRejectedEvent(
          ["bad_tool"],
          { bad_tool: "unknown_tool" },
        ) as ConversationRunEvent,
        buildToolsActivatedEvent(["write_file"]) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, context);

      assertEquals(context.activatedRemoteToolNames?.has("read_file"), true);
      assertEquals(context.activatedRemoteToolNames?.has("write_file"), true);
      assertEquals(context.activatedRemoteToolNames?.has("bad_tool"), false);
    });

    it("does not leak state across separate context objects", () => {
      const contextA: RuntimeToolDiscoveryContext = {};
      const contextB: RuntimeToolDiscoveryContext = {};
      const events: ConversationRunEvent[] = [
        buildToolsActivatedEvent(["read_file"]) as ConversationRunEvent,
      ];

      hydrateToolDiscoveryFromEvents(events, contextA);
      // contextB was not passed to hydrate

      assertEquals(contextA.activatedRemoteToolNames?.has("read_file"), true);
      assertEquals(contextB.activatedRemoteToolNames, undefined);
    });
  });
});
