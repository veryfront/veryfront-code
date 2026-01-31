import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDocsClient } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "list-documents",
  description:
    "List recent Google Docs documents from Google Drive. Returns document names, IDs, and metadata.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of documents to return"),
    orderBy: z
      .enum(["createdTime", "modifiedTime", "name"])
      .default("modifiedTime")
      .describe("Sort order for results"),
  }),
  async execute({ maxResults, orderBy }) {
    const client = createDocsClient(DEFAULT_USER_ID);
    const documents = await client.listDocuments({ maxResults, orderBy });

    return documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      url: doc.webViewLink,
      createdTime: doc.createdTime,
      modifiedTime: doc.modifiedTime,
      thumbnail: doc.thumbnailLink,
    }));
  },
});
