import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient } from "../lib/docs-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const ORDER_BY_VALUES = ["createdTime", "modifiedTime", "name"] as const;

export default tool({
  id: "docs-google-list-documents",
  description:
    "List recent Google Docs documents from Google Drive. Returns document names, IDs, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      maxResults: v
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of documents to return"),
      orderBy: v
        .enum(["createdTime", "modifiedTime", "name"])
        .default("modifiedTime")
        .describe("Sort order for results"),
    })
  )(),
  async execute({ maxResults, orderBy }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDocsClient(userId);
    const documents = await client.listDocuments({
      maxResults,
      orderBy: requireAllowedValue(orderBy, ORDER_BY_VALUES, "orderBy"),
    });

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
