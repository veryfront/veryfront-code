import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listSites } from "../../lib/sharepoint-client.ts";

export default tool({
  id: "list-sites",
  description:
    "List all SharePoint sites the user has access to. Returns site names, URLs, and IDs.",
  inputSchema: defineSchema((v) => v.object({
    search: v
      .string()
      .optional()
      .describe("Optional search query to filter sites by name or description"),
    limit: v
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of sites to return"),
  }))(),
  async execute({ search, limit }) {
    const sites = await listSites({ search, limit });

    return sites.map((site) => ({
      id: site.id,
      name: site.displayName ?? site.name,
      description: site.description,
      url: site.webUrl,
      hostname: site.siteCollection?.hostname,
      created: site.createdDateTime,
      lastModified: site.lastModifiedDateTime,
    }));
  },
});
