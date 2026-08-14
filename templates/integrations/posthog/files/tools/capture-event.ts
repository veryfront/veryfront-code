import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { captureEvent } from "../lib/posthog-client.ts";

export default tool({
  id: "posthog-capture-event",
  description:
    "Track a custom event in PostHog. Capture user actions, page views, or any custom analytics event.",
  inputSchema: defineSchema((v) => v.object({
    event: v.string().describe("Event name (e.g., 'button_clicked', 'page_viewed')"),
    distinctId: v.string().describe("Unique identifier for the user or session"),
    properties: v
      .record(v.string(), v.unknown())
      .optional()
      .describe("Additional properties to attach to the event"),
    timestamp: v
      .string()
      .optional()
      .describe("Event timestamp in ISO format (defaults to current time)"),
  }))(),
  async execute({ event, distinctId, properties, timestamp }) {
    const result = await captureEvent({
      event,
      distinct_id: distinctId,
      properties,
      timestamp,
    });

    const success = result.status === 1 || result.status === 200;

    return {
      success,
      event: {
        name: event,
        distinctId,
        properties,
        timestamp: timestamp ?? new Date().toISOString(),
      },
    };
  },
});
