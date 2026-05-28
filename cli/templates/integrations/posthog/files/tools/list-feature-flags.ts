import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatDate, getFeatureFlags } from "../../lib/posthog-client.ts";

export default tool({
  id: "list-feature-flags",
  description:
    "List all feature flags in your PostHog project. View flag status, rollout percentages, and configuration.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of feature flags to retrieve"),
  }))(),
  async execute({ limit }) {
    const { results } = await getFeatureFlags({ limit });

    return {
      count: results.length,
      flags: results.map((flag) => {
        const createdBy = flag.created_by
          ? {
              name: flag.created_by.first_name,
              email: flag.created_by.email,
            }
          : null;

        return {
          id: flag.id,
          name: flag.name,
          key: flag.key,
          active: flag.active,
          deleted: flag.deleted,
          isSimpleFlag: flag.is_simple_flag,
          rolloutPercentage: flag.rollout_percentage,
          createdAt: formatDate(flag.created_at),
          createdBy,
          filters: flag.filters,
        };
      }),
    };
  },
});
