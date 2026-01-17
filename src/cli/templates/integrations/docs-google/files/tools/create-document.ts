import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDocsClient } from "../../lib/docs-client.ts";

// Default user ID for demo/dev purposes
// In production, get from authenticated session
const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "create-document",
  description:
    "Create a new Google Docs document with optional initial content. Returns the new document ID and URL.",
  inputSchema: z.object({
    title: z
      .string()
      .describe("Title of the new document"),
    content: z
      .string()
      .optional()
      .describe("Optional initial text content to insert into the document"),
  }),
  async execute({ title, content }) {
    const client = createDocsClient(DEFAULT_USER_ID);

    let document;

    if (content) {
      // Create document with content
      document = await client.createDocumentWithContent(title, content);
    } else {
      // Create empty document
      document = await client.createDocument({ title });
    }

    // Get the web view link from Drive
    const documents = await client.listDocuments({ maxResults: 1 });
    const webViewLink = documents.find(d => d.id === document.documentId)?.webViewLink;

    return {
      documentId: document.documentId,
      title: document.title,
      url: webViewLink || `https://docs.google.com/document/d/${document.documentId}/edit`,
      revisionId: document.revisionId,
    };
  },
});
