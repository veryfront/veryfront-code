import { tool } from "veryfront/tool";
import { z } from "zod";
import { createDocsClient, type Request } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "update-document",
  description:
    "Update a Google Docs document using batch requests. Supports inserting text, deleting content, replacing text, and more.",
  inputSchema: z
    .object({
      documentId: z.string().describe("The ID of the document to update"),
      requests: z
        .array(z.any())
        .describe(
          "Array of batch update requests. See Google Docs API documentation for request types: insertText, deleteContentRange, replaceAllText, etc.",
        ),
    })
    .or(
      z.object({
        documentId: z.string().describe("The ID of the document to update"),
        operation: z
          .object({
            type: z
              .enum(["insertText", "deleteContent", "replaceAllText"])
              .describe("Type of operation to perform"),
            insertText: z
              .object({
                text: z.string().describe("Text to insert"),
                index: z.number().describe("Position to insert at (1 = start of document)"),
              })
              .optional()
              .describe("Parameters for insertText operation"),
            deleteContent: z
              .object({
                startIndex: z.number().describe("Start position of content to delete"),
                endIndex: z.number().describe("End position of content to delete"),
              })
              .optional()
              .describe("Parameters for deleteContent operation"),
            replaceAllText: z
              .object({
                searchText: z.string().describe("Text to search for"),
                replaceText: z.string().describe("Text to replace with"),
                matchCase: z.boolean().default(false).describe("Whether to match case"),
              })
              .optional()
              .describe("Parameters for replaceAllText operation"),
          })
          .describe("Simple operation to perform"),
      }),
    ),
  async execute(input): Promise<{
    documentId: string;
    success: true;
    replies: unknown;
    writeControl?: unknown;
  }> {
    const client = createDocsClient(DEFAULT_USER_ID);

    if ("operation" in input) {
      const { documentId, operation } = input;

      if (operation.type === "insertText") {
        const params = operation.insertText;
        if (!params) throw new Error("insertText parameters required");

        const result = await client.insertText(documentId, params.text, params.index);
        return { documentId: result.documentId, success: true, replies: result.replies };
      }

      if (operation.type === "deleteContent") {
        const params = operation.deleteContent;
        if (!params) throw new Error("deleteContent parameters required");

        const result = await client.deleteContent(documentId, params.startIndex, params.endIndex);
        return { documentId: result.documentId, success: true, replies: result.replies };
      }

      if (operation.type === "replaceAllText") {
        const params = operation.replaceAllText;
        if (!params) throw new Error("replaceAllText parameters required");

        const result = await client.replaceAllText(
          documentId,
          params.searchText,
          params.replaceText,
          params.matchCase,
        );
        return { documentId: result.documentId, success: true, replies: result.replies };
      }

      throw new Error(`Unknown operation type: ${operation.type}`);
    }

    const { documentId, requests } = input;
    const result = await client.updateDocument(documentId, requests as Request[]);

    return {
      documentId: result.documentId,
      success: true,
      replies: result.replies,
      writeControl: result.writeControl,
    };
  },
});
