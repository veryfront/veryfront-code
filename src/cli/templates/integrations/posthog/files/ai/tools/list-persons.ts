import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatDate, listPersons } from "../../lib/posthog-client.ts";

export default tool({
  id: "list-persons",
  description:
    "List persons/users tracked in PostHog. View user properties, distinct IDs, and activity.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(20).describe(
      "Maximum number of persons to retrieve",
    ),
    search: z.string().optional().describe(
      "Search query to filter persons by properties or distinct ID",
    ),
  }),
  async execute({ limit, search }) {
    const response = await listPersons({ limit, search });

    return {
      count: response.results.length,
      persons: response.results.map((person) => ({
        id: person.id,
        uuid: person.uuid,
        name: person.name,
        distinctIds: person.distinct_ids,
        properties: person.properties,
        createdAt: formatDate(person.created_at),
      })),
    };
  },
});
