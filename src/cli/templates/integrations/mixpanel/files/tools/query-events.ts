import { tool } from "veryfront/tool";
import { z } from "zod";
import { queryEvents, getDateRange } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "query-events",
  description:
    "Query and export event data from Mixpanel. Retrieve events within a date range, optionally filtered by event name.",
  inputSchema: z.object({
    from: z.string().describe(
      "Start date in YYYY-MM-DD format (e.g., '2024-01-01')",
    ),
    to: z.string().describe(
      "End date in YYYY-MM-DD format (e.g., '2024-01-31')",
    ),
    event: z.string().optional().describe(
      "Optional: Filter by specific event name (e.g., 'Page Viewed'). If not provided, returns all events.",
    ),
    limit: z.number().optional().default(100).describe(
      "Maximum number of events to return (defaults to 100)",
    ),
  }),
  async execute({ from, to, event, limit }) {
    const events = await queryEvents(from, to, event);

    // Limit results
    const limitedEvents = events.slice(0, limit);

    return {
      total: events.length,
      returned: limitedEvents.length,
      dateRange: {
        from,
        to,
      },
      eventFilter: event || "all",
      events: limitedEvents.map((e) => ({
        event: e.event,
        properties: e.properties,
      })),
    };
  },
});
