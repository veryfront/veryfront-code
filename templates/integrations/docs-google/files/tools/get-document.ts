import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient } from "../lib/docs-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "docs-google-get-document",
  description:
    "Get a Google Docs document's content and metadata. Returns the full document structure including text, formatting, and styles.",
  inputSchema: defineSchema((v) =>
    v.object({
      documentId: v.string().describe("The ID of the document to retrieve"),
      extractTextOnly: v
        .boolean()
        .default(false)
        .describe("If true, only return plain text content without formatting"),
    })
  )(),
  async execute({ documentId, extractTextOnly }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createDocsClient(userId);
    const document = await client.getDocument(documentId);

    const { documentId: id, title, revisionId } = document;

    if (extractTextOnly) {
      return {
        documentId: id,
        title,
        revisionId,
        text: client.extractText(document),
      };
    }

    return {
      documentId: id,
      title,
      revisionId,
      body: document.body,
      documentStyle: document.documentStyle,
    };
  },
});
