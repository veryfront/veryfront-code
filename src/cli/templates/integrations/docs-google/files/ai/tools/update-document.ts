import { tool } from "veryfront/ai";
import { z } from "zod";
import { createDocsClient, type Request } from "../../lib/docs-client.ts";

const DEFAULT_USER_ID = "demo-user";

export default tool({
  id: "update-document",
  description:
    "Update a Google Docs document using batch requests. Supports inserting text, deleting content, replacing text, and more.",
  inputSchema: z.object({
    documentId: z
      .string()
      .describe("The ID of the document to update"),
    requests: z
      .array(z.any())
      .describe(
        "Array of batch update requests. See Google Docs API documentation for request types: insertText, deleteContentRange, replaceAllText, etc.",
      ),
  }).or(
    z.object({
      documentId: z
        .string()
        .describe("The ID of the document to update"),
      operation: z.object({
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
            matchCase: z
              .boolean()
              .default(false)
              .describe("Whether to match case"),
          })
          .optional()
          .describe("Parameters for replaceAllText operation"),
      }).describe("Simple operation to perform"),
    }),
  ),
  async execute(input) {
    const client = createDocsClient(DEFAULT_USER_ID);

    let requests: Request[];

    if ("operation" in input) {
      const { documentId, operation } = input;

      switch (operation.type) {
        case "insertText":
          if (!operation.insertText) {
            throw new Error("insertText parameters required");
          }
          const result = await client.insertText(
            documentId,
            operation.insertText.text,
            operation.insertText.index,
          );
          return {
            documentId: result.documentId,
            success: true,
            replies: result.replies,
          };

        case "deleteContent":
          if (!operation.deleteContent) {
            throw new Error("deleteContent parameters required");
          }
          const deleteResult = await client.deleteContent(
            documentId,
            operation.deleteContent.startIndex,
            operation.deleteContent.endIndex,
          );
          return {
            documentId: deleteResult.documentId,
            success: true,
            replies: deleteResult.replies,
          };

        case "replaceAllText":
          if (!operation.replaceAllText) {
            throw new Error("replaceAllText parameters required");
          }
          const replaceResult = await client.replaceAllText(
            documentId,
            operation.replaceAllText.searchText,
            operation.replaceAllText.replaceText,
            operation.replaceAllText.matchCase,
          );
          return {
            documentId: replaceResult.documentId,
            success: true,
            replies: replaceResult.replies,
          };

        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }
    }

    const { documentId, requests: batchRequests } = input;
    const result = await client.updateDocument(documentId, batchRequests as Request[]);

    return {
      documentId: result.documentId,
      success: true,
      replies: result.replies,
      writeControl: result.writeControl,
    };
  },
});
