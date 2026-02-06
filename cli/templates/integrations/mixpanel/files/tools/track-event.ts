import { tool } from "veryfront/tool";
import { z } from "zod";
import { trackEvent } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "track-event",
  description:
    "Track a custom event in Mixpanel. Capture user actions, page views, or any custom analytics event with properties.",
  inputSchema: z.object({
    event: z
      .string()
      .describe(
        "Event name (e.g., 'Button Clicked', 'Page Viewed', 'Purchase Completed')",
      ),
    distinctId: z
      .string()
      .describe(
        "Unique identifier for the user or session (e.g., user ID, email, or anonymous ID)",
      ),
    properties: z
      .record(z.unknown())
      .optional()
      .describe(
        "Additional properties to attach to the event (e.g., {product_id: '123', price: 29.99, category: 'electronics'})",
      ),
  }),
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
