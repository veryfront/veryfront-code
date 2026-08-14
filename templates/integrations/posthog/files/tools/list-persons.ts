import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatDate, listPersons } from "../lib/posthog-client.ts";

export default tool({
  id: "posthog-list-persons",
  description:
    "List persons/users tracked in PostHog. View user properties, distinct IDs, and activity.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of persons to retrieve"),
    search: v
      .string()
      .optional()
      .describe("Search query to filter persons by properties or distinct ID"),
  }))(),
  async execute({ limit, search }) {
    const { results } = await listPersons({ limit, search });

    return {
      count: results.length,
      persons: results.map((person) => ({
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
