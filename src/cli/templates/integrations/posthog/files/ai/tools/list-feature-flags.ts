import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatDate, getFeatureFlags } from "../../lib/posthog-client.ts";

export default tool({
  id: "list-feature-flags",
  description:
    "List all feature flags in your PostHog project. View flag status, rollout percentages, and configuration.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(20).describe(
      "Maximum number of feature flags to retrieve",
    ),
  }),
  async execute({ limit }) {
    const response = await getFeatureFlags({ limit });

    return {
      count: response.results.length,
      flags: response.results.map((flag) => ({
        id: flag.id,
        name: flag.name,
        key: flag.key,
        active: flag.active,
        deleted: flag.deleted,
        isSimpleFlag: flag.is_simple_flag,
        rolloutPercentage: flag.rollout_percentage,
        createdAt: formatDate(flag.created_at),
        createdBy: flag.created_by
          ? {
            name: flag.created_by.first_name,
            email: flag.created_by.email,
          }
          : null,
        filters: flag.filters,
      })),
    };
  },
});
