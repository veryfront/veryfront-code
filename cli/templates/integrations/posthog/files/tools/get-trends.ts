import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getTrends } from "../../lib/posthog-client.ts";

export default tool({
  id: "get-trends",
  description:
    "Retrieve event trends and analytics data from PostHog. Analyze how events are trending over time.",
  inputSchema: defineSchema((v) => v.object({
    events: v
      .array(
        v.object({
          id: v
            .string()
            .describe("Event ID or name (e.g., '$pageview', 'button_clicked')"),
          name: v.string().optional().describe("Display name for the event"),
          type: v.string().optional().default("events").describe("Event type"),
        }),
      )
      .optional()
      .describe("List of events to analyze (defaults to $pageview)"),
    dateFrom: v
      .string()
      .optional()
      .default("-7d")
      .describe("Start date in ISO format or relative (e.g., '-7d', '-30d')"),
    dateTo: v
      .string()
      .optional()
      .default("now")
      .describe("End date in ISO format or relative (e.g., 'now', '-1d')"),
    interval: v
      .enum(["hour", "day", "week", "month"])
      .optional()
      .default("day")
      .describe("Time interval for aggregation"),
  }))(),
  async execute({ events, dateFrom, dateTo, interval }) {
    return getTrends({
      events,
      date_from: dateFrom,
      date_to: dateTo,
      interval,
    });
  },
});
