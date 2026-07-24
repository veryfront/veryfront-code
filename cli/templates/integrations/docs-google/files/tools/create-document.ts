import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient } from "../lib/docs-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "docs-google-create-document",
  description:
    "Create a new Google Docs document with optional initial content. Returns the new document ID and URL.",
  inputSchema: defineSchema((v) =>
    v.object({
      title: v.string().describe("Title of the new document"),
      content: v
        .string()
        .optional()
        .describe("Optional initial text content to insert into the document"),
    })
  )(),
  async execute({ title, content }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDocsClient(userId);

    const document = content
      ? await client.createDocumentWithContent(title, content)
      : await client.createDocument({ title });

    const [docMeta] = await client.listDocuments({ maxResults: 1 });
    const webViewLink = docMeta?.id === document.documentId
      ? docMeta.webViewLink
      : undefined;

    return {
      documentId: document.documentId,
      title: document.title,
      url: webViewLink ??
        `https://docs.google.com/document/d/${document.documentId}/edit`,
      revisionId: document.revisionId,
    };
  },
});
