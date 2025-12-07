import { tool } from "veryfront/ai";
import { z } from "zod";
import { captureEvent } from "../../lib/posthog-client.ts";

export default tool({
  id: "capture-event",
  description:
    "Track a custom event in PostHog. Capture user actions, page views, or any custom analytics event.",
  inputSchema: z.object({
    event: z.string().describe("Event name (e.g., 'button_clicked', 'page_viewed')"),
    distinctId: z.string().describe("Unique identifier for the user or session"),
    properties: z.record(z.unknown()).optional().describe(
      "Additional properties to attach to the event",
    ),
    timestamp: z.string().optional().describe(
      "Event timestamp in ISO format (defaults to current time)",
    ),
  }),
  async execute({ event, distinctId, properties, timestamp }) {
    const result = await captureEvent({
      event,
      distinct_id: distinctId,
      properties,
      timestamp,
    });

    return {
      success: result.status === 1 || result.status === 200,
      event: {
        name: event,
        distinctId,
        properties,
        timestamp: timestamp || new Date().toISOString(),
      },
    };
  },
});
