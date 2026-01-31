import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatContactName, getContact } from "../../lib/hubspot-client.ts";

export default tool({
  id: "get-contact",
  description:
    "Get detailed information about a specific contact in HubSpot CRM by their contact ID.",
  inputSchema: z.object({
    contactId: z.string().describe("The HubSpot contact ID"),
    properties: z
      .array(z.string())
      .optional()
      .describe(
        "Additional properties to retrieve (e.g., website, city, state, notes)",
      ),
  }),
  async execute({ contactId, properties }) {
    const contact = await getContact(contactId, properties);

    const additionalProperties = properties
      ? Object.fromEntries(
          properties
            .filter((prop) => contact.properties[prop] !== undefined)
            .map((prop) => [prop, contact.properties[prop]]),
        )
      : undefined;

    return {
      id: contact.id,
      name: formatContactName(contact),
      email: contact.properties.email,
      phone: contact.properties.phone,
      company: contact.properties.company,
      jobTitle: contact.properties.jobtitle,
      website: contact.properties.website,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      archived: contact.archived,
      additionalProperties,
      allProperties: contact.properties,
    };
  },
});
