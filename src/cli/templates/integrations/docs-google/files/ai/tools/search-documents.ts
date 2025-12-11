import { tool } from "veryfront/ai";
import { z } from "zod";
import { createDocsClient } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "search-documents",
  description:
    "Search for Google Docs documents by query string. Searches document names and content. Returns matching document IDs, names, and metadata.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query to find documents. Searches in document names and content."),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of results to return"),
  }),
  async execute({ query, maxResults }) {
    const client = createDocsClient(DEFAULT_USER_ID);

    const documents = await client.searchDocuments(query, maxResults);

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
