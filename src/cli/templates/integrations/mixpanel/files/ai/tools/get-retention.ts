import { tool } from "veryfront/ai";
import { z } from "zod";
import { getRetention } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "get-retention",
  description:
    "Analyze user retention cohorts in Mixpanel. Understand how many users return after performing an initial event.",
  inputSchema: z.object({
    from: z.string().describe(
      "Start date in YYYY-MM-DD format (e.g., '2024-01-01')",
    ),
    to: z.string().describe(
      "End date in YYYY-MM-DD format (e.g., '2024-01-31')",
    ),
    event: z.string().describe(
      "The event to analyze retention for (e.g., 'App Opened', 'Sign Up')",
    ),
    retentionType: z.enum(["birth", "compounded"]).optional().default("birth")
      .describe(
        "Retention type: 'birth' (first time users) or 'compounded' (all users who did the event)",
      ),
  }),
  async execute({ from, to, event, retentionType }) {
    const retention = await getRetention(from, to, event, retentionType);

    return {
      event,
      retentionType,
      dateRange: {
        from,
        to,
      },
      cohorts: retention.map((cohort) => ({
        date: cohort.date,
        initialCount: cohort.count,
        retention: cohort.retention.map((r) => ({
          day: r.day,
          count: r.count,
          rate: `${(r.rate * 100).toFixed(2)}%`,
        })),
      })),
      summary: {
        totalCohorts: retention.length,
        averageDay1Retention: retention.length > 0
          ? `${(
            retention.reduce((sum, c) => {
              const day1 = c.retention.find((r) => r.day === 1);
              return sum + (day1 ? day1.rate : 0);
            }, 0) / retention.length * 100
          ).toFixed(2)}%`
          : "N/A",
        averageDay7Retention: retention.length > 0
          ? `${(
            retention.reduce((sum, c) => {
              const day7 = c.retention.find((r) => r.day === 7);
              return sum + (day7 ? day7.rate : 0);
            }, 0) / retention.length * 100
          ).toFixed(2)}%`
          : "N/A",
      },
    };
  },
});
