import { tool } from "veryfront/tool";
import { z } from "zod";
import { getRetention } from "../../lib/mixpanel-client.ts";

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function averageRetention(retention: Array<{ retention: Array<{ day: number; rate: number }> }>, day: number): string {
  if (retention.length === 0) return "N/A";

  const total = retention.reduce((sum, cohort) => {
    const rate = cohort.retention.find((r) => r.day === day)?.rate ?? 0;
    return sum + rate;
  }, 0);

  return formatRate(total / retention.length);
}

export default tool({
  id: "get-retention",
  description:
    "Analyze user retention cohorts in Mixpanel. Understand how many users return after performing an initial event.",
  inputSchema: z.object({
    from: z.string().describe("Start date in YYYY-MM-DD format (e.g., '2024-01-01')"),
    to: z.string().describe("End date in YYYY-MM-DD format (e.g., '2024-01-31')"),
    event: z.string().describe("The event to analyze retention for (e.g., 'App Opened', 'Sign Up')"),
    retentionType: z
      .enum(["birth", "compounded"])
      .optional()
      .default("birth")
      .describe("Retention type: 'birth' (first time users) or 'compounded' (all users who did the event)"),
  }),
  async execute({ from, to, event, retentionType }): Promise<{
    event: string;
    retentionType: "birth" | "compounded";
    dateRange: { from: string; to: string };
    cohorts: Array<{
      date: string;
      initialCount: number;
      retention: Array<{ day: number; count: number; rate: string }>;
    }>;
    summary: {
      totalCohorts: number;
      averageDay1Retention: string;
      averageDay7Retention: string;
    };
  }> {
    const retention = await getRetention(from, to, event, retentionType);

    return {
      event,
      retentionType,
      dateRange: { from, to },
      cohorts: retention.map((cohort) => ({
        date: cohort.date,
        initialCount: cohort.count,
        retention: cohort.retention.map((r) => ({
          day: r.day,
          count: r.count,
          rate: formatRate(r.rate),
        })),
      })),
      summary: {
        totalCohorts: retention.length,
        averageDay1Retention: averageRetention(retention, 1),
        averageDay7Retention: averageRetention(retention, 7),
      },
    };
  },
});
