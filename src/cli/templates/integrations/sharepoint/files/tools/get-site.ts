import { tool } from "veryfront/tool";
import { z } from "zod";
import { getSite, listDrives } from "../../lib/sharepoint-client.ts";

export default tool({
  id: "get-site",
  description:
    "Get detailed information about a specific SharePoint site including its document libraries (drives).",
  inputSchema: z.object({
    siteId: z.string().describe("The ID of the SharePoint site to retrieve"),
    includeDrives: z.boolean().default(true).describe(
      "Whether to include the list of document libraries in the response",
    ),
  }),
  async execute({ siteId, includeDrives }) {
    const site = await getSite(siteId);

    const result: Record<string, unknown> = {
      id: site.id,
      name: site.displayName || site.name,
      description: site.description,
      url: site.webUrl,
      hostname: site.siteCollection?.hostname,
      created: site.createdDateTime,
      lastModified: site.lastModifiedDateTime,
    };

    if (includeDrives) {
      const drives = await listDrives(siteId);
      result.documentLibraries = drives.map((drive) => ({
        id: drive.id,
        name: drive.name,
        description: drive.description,
        type: drive.driveType,
        url: drive.webUrl,
        quota: drive.quota
          ? {
            total: drive.quota.total,
            used: drive.quota.used,
            remaining: drive.quota.remaining,
            percentUsed: drive.quota.total > 0
              ? Math.round((drive.quota.used / drive.quota.total) * 100)
              : 0,
          }
          : undefined,
      }));
    }

    return result;
  },
});
