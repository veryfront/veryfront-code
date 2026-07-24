import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createDocsClient, type Request } from "../lib/docs-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "docs-google-update-document",
  description:
    "Update a Google Docs document with validated insert, delete, or replace operations.",
  inputSchema: defineSchema((v) =>
    v.object({
      documentId: v.string().min(1).describe(
        "The ID of the document to update",
      ),
      operations: v.array(v.union([
        v.object({
          insertText: v.object({
            text: v.string().min(1).describe("Text to insert"),
            index: v.number().int().positive().describe(
              "Position to insert at (1 = start of document)",
            ),
          }),
        }),
        v.object({
          deleteContent: v.object({
            startIndex: v.number().int().positive().describe(
              "Start position of content to delete",
            ),
            endIndex: v.number().int().positive().describe(
              "Exclusive end position of content to delete",
            ),
          }).refine(
            ({ startIndex, endIndex }) => endIndex > startIndex,
            { message: "endIndex must be greater than startIndex" },
          ),
        }),
        v.object({
          replaceAllText: v.object({
            searchText: v.string().min(1).describe("Text to search for"),
            replaceText: v.string().describe("Replacement text"),
            matchCase: v.boolean().default(false).describe(
              "Whether to match case",
            ),
          }),
        }),
      ])).min(1).describe("Validated Google Docs update operations"),
    })
  )(),
  async execute({ documentId, operations }, context): Promise<{
    documentId: string;
    success: true;
    replies: unknown;
    writeControl?: unknown;
  }> {
    const userId = requireUserIdFromContext(context);
    const client = createDocsClient(userId);
    const requests: Request[] = operations.map((operation) => {
      if ("insertText" in operation) {
        return {
          insertText: {
            text: operation.insertText.text,
            location: { index: operation.insertText.index },
          },
        };
      }
      if ("deleteContent" in operation) {
        return {
          deleteContentRange: {
            range: {
              startIndex: operation.deleteContent.startIndex,
              endIndex: operation.deleteContent.endIndex,
            },
          },
        };
      }
      return {
        replaceAllText: {
          containsText: {
            text: operation.replaceAllText.searchText,
            matchCase: operation.replaceAllText.matchCase,
          },
          replaceText: operation.replaceAllText.replaceText,
        },
      };
    });
    const result = await client.updateDocument(documentId, requests);

    return {
      documentId: result.documentId,
      success: true,
      replies: result.replies,
      writeControl: result.writeControl,
    };
  },
});
