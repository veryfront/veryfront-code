import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTrends } from "../../lib/posthog-client.ts";

export default tool({
  id: "get-trends",
  description:
    "Retrieve event trends and analytics data from PostHog. Analyze how events are trending over time.",
  inputSchema: z.object({
    events: z
      .array(
        z.object({
          id: z
            .string()
            .describe("Event ID or name (e.g., '$pageview', 'button_clicked')"),
          name: z.string().optional().describe("Display name for the event"),
          type: z.string().optional().default("events").describe("Event type"),
        }),
      )
      .optional()
      .describe("List of events to analyze (defaults to $pageview)"),
    dateFrom: z
      .string()
      .optional()
      .default("-7d")
      .describe("Start date in ISO format or relative (e.g., '-7d', '-30d')"),
    dateTo: z
      .string()
      .optional()
      .default("now")
      .describe("End date in ISO format or relative (e.g., 'now', '-1d')"),
    interval: z
      .enum(["hour", "day", "week", "month"])
      .optional()
      .default("day")
      .describe("Time interval for aggregation"),
  }),
  async execute({ events, dateFrom, dateTo, interval }) {
    return getTrends({
      events,
      date_from: dateFrom,
      date_to: dateTo,
      interval,
    });
  },
});
