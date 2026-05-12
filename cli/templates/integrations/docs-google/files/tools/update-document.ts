import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient, type Request } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "update-document",
  description:
    "Update a Google Docs document using batch requests. Supports inserting text, deleting content, replacing text, and more.",
  inputSchema: defineSchema((v) => v
    .object({
      documentId: v.string().describe("The ID of the document to update"),
      requests: v
        .array(v.any())
        .describe(
          "Array of batch update requests. See Google Docs API documentation for request types: insertText, deleteContentRange, replaceAllText, etc.",
        ),
    })
    .or(
      v.object({
        documentId: v.string().describe("The ID of the document to update"),
        operation: v
          .object({
            type: v
              .enum(["insertText", "deleteContent", "replaceAllText"])
              .describe("Type of operation to perform"),
            insertText: v
              .object({
                text: v.string().describe("Text to insert"),
                index: v.number().describe("Position to insert at (1 = start of document)"),
              })
              .optional()
              .describe("Parameters for insertText operation"),
            deleteContent: v
              .object({
                startIndex: v.number().describe("Start position of content to delete"),
                endIndex: v.number().describe("End position of content to delete"),
              })
              .optional()
              .describe("Parameters for deleteContent operation"),
            replaceAllText: v
              .object({
                searchText: v.string().describe("Text to search for"),
                replaceText: v.string().describe("Text to replace with"),
                matchCase: v.boolean().default(false).describe("Whether to match case"),
              })
              .optional()
              .describe("Parameters for replaceAllText operation"),
          })
          .describe("Simple operation to perform"),
      }),
    ))(),
  async execute(input): Promise<{
    documentId: string;
    success: true;
    replies: unknown;
    writeControl?: unknown;
  }> {
    const client = createDocsClient(DEFAULT_USER_ID);

    if (!("operation" in input)) {
      const { documentId, requests } = input;
      const result = await client.updateDocument(documentId, requests as Request[]);

      return {
        documentId: result.documentId,
        success: true,
        replies: result.replies,
        writeControl: result.writeControl,
      };
    }

    const { documentId, operation } = input;

    switch (operation.type) {
      case "insertText": {
        const params = operation.insertText;
        if (!params) throw new Error("insertText parameters required");

        const result = await client.insertText(documentId, params.text, params.index);
        return { documentId: result.documentId, success: true, replies: result.replies };
      }

      case "deleteContent": {
        const params = operation.deleteContent;
        if (!params) throw new Error("deleteContent parameters required");

        const result = await client.deleteContent(documentId, params.startIndex, params.endIndex);
        return { documentId: result.documentId, success: true, replies: result.replies };
      }

      case "replaceAllText": {
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

      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  },
});
