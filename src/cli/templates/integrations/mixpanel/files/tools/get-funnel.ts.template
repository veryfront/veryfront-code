import { tool } from "veryfront/tool";
import { z } from "zod";
import { calculateFunnelConversionRate, getFunnel } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "get-funnel",
  description:
    "Retrieve funnel analysis data from Mixpanel. Analyze conversion rates and user drop-off at each step of a funnel.",
  inputSchema: z.object({
    funnelId: z
      .number()
      .describe("The numeric ID of the funnel (found in Mixpanel funnel URL or settings)"),
    from: z.string().describe("Start date in YYYY-MM-DD format (e.g., '2024-01-01')"),
    to: z.string().describe("End date in YYYY-MM-DD format (e.g., '2024-01-31')"),
  }),
  async execute({ funnelId, from, to }) {
    const funnel = await getFunnel(funnelId, from, to);
    const overallConversionRate = calculateFunnelConversionRate(funnel);

    return {
      funnelId: funnel.funnel_id,
      name: funnel.name,
      dateRange: { from, to },
      overallConversionRate: `${overallConversionRate.toFixed(2)}%`,
      steps: funnel.steps.map((step, index) => ({
        stepNumber: index + 1,
        event: step.event,
        count: step.count,
        overallConversionRate: `${(step.overall_conv_ratio * 100).toFixed(2)}%`,
        stepConversionRate: `${(step.step_conv_ratio * 100).toFixed(2)}%`,
        averageTime: step.avg_time ? `${(step.avg_time / 60).toFixed(1)} minutes` : "N/A",
      })),
      data: funnel.data,
    };
  },
});
