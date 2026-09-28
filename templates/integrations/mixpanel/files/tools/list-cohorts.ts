import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listCohorts } from "../lib/mixpanel-client.ts";

export default tool({
  id: "mixpanel-list-cohorts",
  description:
    "List all user cohorts defined in your Mixpanel project. Cohorts are saved user segments based on properties or behaviors.",
  inputSchema: defineSchema((v) => v.object({
    includeHidden: v
      .boolean()
      .optional()
      .default(false)
      .describe("Include hidden cohorts in the results (defaults to false)"),
  }))(),
  async execute({ includeHidden }) {
    const allCohorts = await listCohorts();
    const cohorts = includeHidden
      ? allCohorts
      : allCohorts.filter((c) => c.is_visible);

    const totalUsers = cohorts.reduce((sum, c) => sum + c.count, 0);

    if (cohorts.length === 0) {
      return {
        total: 0,
        cohorts: [],
        summary: {
          totalUsers: 0,
          largestCohort: "N/A",
          smallestCohort: "N/A",
        },
      };
    }

    const bySize = [...cohorts].sort((a, b) => a.count - b.count);
    const smallest = bySize[0];
    const largest = bySize.at(-1);

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
        totalUsers,
        largestCohort: largest?.name ?? "N/A",
        smallestCohort: smallest?.name ?? "N/A",
      },
    };
  },
});
