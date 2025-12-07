import { tool } from "veryfront/ai";
import { z } from "zod";
import { listCohorts } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "list-cohorts",
  description:
    "List all user cohorts defined in your Mixpanel project. Cohorts are saved user segments based on properties or behaviors.",
  inputSchema: z.object({
    includeHidden: z.boolean().optional().default(false).describe(
      "Include hidden cohorts in the results (defaults to false)",
    ),
  }),
  async execute({ includeHidden }) {
    const allCohorts = await listCohorts();

    // Filter by visibility if needed
    const cohorts = includeHidden
      ? allCohorts
      : allCohorts.filter((c) => c.is_visible);

    return {
      total: cohorts.length,
      cohorts: cohorts.map((cohort) => ({
        id: cohort.id,
        name: cohort.name,
        description: cohort.description,
        count: cohort.count,
        created: cohort.created,
        isVisible: cohort.is_visible,
        projectId: cohort.project_id,
      })),
      summary: {
        totalUsers: cohorts.reduce((sum, c) => sum + c.count, 0),
        largestCohort: cohorts.length > 0
          ? cohorts.reduce((max, c) => (c.count > max.count ? c : max))
            .name
          : "N/A",
        smallestCohort: cohorts.length > 0
          ? cohorts.reduce((min, c) => (c.count < min.count ? c : min))
            .name
          : "N/A",
      },
    };
  },
});
