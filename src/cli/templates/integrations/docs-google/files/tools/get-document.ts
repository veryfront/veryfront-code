import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDocsClient } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "get-document",
  description:
    "Get a Google Docs document's content and metadata. Returns the full document structure including text, formatting, and styles.",
  inputSchema: z.object({
    documentId: z.string().describe("The ID of the document to retrieve"),
    extractTextOnly: z
      .boolean()
      .default(false)
      .describe("If true, only return plain text content without formatting"),
  }),
  async execute({ documentId, extractTextOnly }) {
    const client = createDocsClient(DEFAULT_USER_ID);
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
