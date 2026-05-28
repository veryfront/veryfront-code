import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { trackEvent } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "track-event",
  description:
    "Track a custom event in Mixpanel. Capture user actions, page views, or any custom analytics event with properties.",
  inputSchema: defineSchema((v) => v.object({
    event: v
      .string()
      .describe(
        "Event name (e.g., 'Button Clicked', 'Page Viewed', 'Purchase Completed')",
      ),
    distinctId: v
      .string()
      .describe(
        "Unique identifier for the user or session (e.g., user ID, email, or anonymous ID)",
      ),
    properties: v
      .record(v.string(), v.unknown())
      .optional()
      .describe(
        "Additional properties to attach to the event (e.g., {product_id: '123', price: 29.99, category: 'electronics'})",
      ),
  }))(),
  async execute({ event, distinctId, properties }) {
    const eventProperties = properties ?? {};
    const result = await trackEvent(event, eventProperties, distinctId);

    if (result.status !== 1) {
      return { success: false, error: result.error ?? "Failed to track event" };
    }

    return {
      success: true,
      event: {
        name: event,
        distinctId,
        properties: eventProperties,
        timestamp: new Date().toISOString(),
      },
      message: "Event tracked successfully",
    };
  },
});
