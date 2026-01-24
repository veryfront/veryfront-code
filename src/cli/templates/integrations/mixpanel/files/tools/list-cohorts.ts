import { tool } from "veryfront/tool";
import { z } from "zod";
import { listCohorts } from "../../lib/mixpanel-client.ts";

export default tool({
  id: "list-cohorts",
  description:
    "List all user cohorts defined in your Mixpanel project. Cohorts are saved user segments based on properties or behaviors.",
  inputSchema: z.object({
    includeHidden: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include hidden cohorts in the results (defaults to false)"),
  }),
  async execute({ includeHidden }) {
    const allCohorts = await listCohorts();
    const cohorts = includeHidden
      ? allCohorts
      : allCohorts.filter((c) => c.is_visible);

    const totalUsers = cohorts.reduce((sum, c) => sum + c.count, 0);

    let largestCohort = "N/A";
    let smallestCohort = "N/A";

    if (cohorts.length > 0) {
      let largest = cohorts[0];
      let smallest = cohorts[0];

      for (const c of cohorts) {
        if (c.count > largest.count) largest = c;
        if (c.count < smallest.count) smallest = c;
      }

      largestCohort = largest.name;
      smallestCohort = smallest.name;
    }

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
        largestCohort,
        smallestCohort,
      },
    };
  },
});
