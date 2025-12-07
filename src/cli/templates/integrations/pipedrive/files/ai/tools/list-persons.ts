import { tool } from "veryfront/ai";
import { z } from "zod";
import { listPersons } from "../../lib/pipedrive-client.ts";

export default tool({
  id: "list-persons",
  description:
    "List contacts/persons from Pipedrive. Can optionally search by name or email.",
  inputSchema: z.object({
    searchTerm: z.string().optional().describe("Search term to filter persons by name or email"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of persons to return"),
  }),
  async execute({ searchTerm, limit }) {
    const persons = await listPersons({
      searchTerm,
      limit,
    });

    return persons.map((person) => ({
      id: person.id,
      name: person.name,
      firstName: person.first_name,
      lastName: person.last_name,
      email: person.email?.[0]?.value || null,
      phone: person.phone?.[0]?.value || null,
      orgId: person.org_id,
      orgName: person.org_name,
      ownerName: person.owner_name,
      addTime: person.add_time,
      updateTime: person.update_time,
    }));
  },
});
