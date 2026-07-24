import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient } from "../lib/docs-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "docs-google-search-documents",
  description:
    "Search for Google Docs documents by query string. Searches document names and content. Returns matching document IDs, names, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v
        .string()
        .describe(
          "Search query to find documents. Searches in document names and content.",
        ),
      maxResults: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of results to return"),
    })
  )(),
  async execute({ query, maxResults }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDocsClient(userId);
    const documents = await client.searchDocuments(query, maxResults);

    return documents.map((document) => ({
      id: document.id,
      name: document.name,
      url: document.webViewLink,
      createdTime: document.createdTime,
      modifiedTime: document.modifiedTime,
      thumbnail: document.thumbnailLink,
    }));
  },
});
