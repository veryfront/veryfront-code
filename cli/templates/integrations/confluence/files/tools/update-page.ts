import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createConfluenceClient } from "../lib/confluence-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

function toStorageContent(
  content: string | undefined,
  formatAsStorage: (text: string) => string,
): string | undefined {
  if (!content || !content.trim()) return undefined;

  const trimmed = content.trim();
  if (trimmed.startsWith("<")) return content;

  return formatAsStorage(content);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

export default tool({
  id: "update-page",
  description:
    "Update the content or title of an existing Confluence page. Requires the current version number.",
  inputSchema: defineSchema((v) =>
    v.object({
      pageId: v.string().describe("The ID of the page to update"),
      title: v
        .string()
        .optional()
        .describe("New title for the page (leave empty to keep current title)"),
      content: v
        .string()
        .optional()
        .describe(
          "New content for the page (can be plain text or Confluence storage format HTML)",
        ),
      versionMessage: v
        .string()
        .optional()
        .describe("Optional message describing the changes made"),
    })
  )(),
  async execute({ pageId, title, content, versionMessage }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createConfluenceClient(userId);
    // v2 PUT /pages/{id} is a full replace — both title and body must be sent on every
    // update. Resolve missing fields from the current page so partial updates work.
    // The schema describes empty values as "keep current", so treat empty/whitespace
    // strings as unset (??-fallback would otherwise let "" overwrite a real title).
    const currentPage = await client.getPage(pageId);
    const storageContent = toStorageContent(content, client.formatAsStorage);
    const currentBody = currentPage.body?.storage?.value ?? "";

    const updatedPage = await client.updatePage(pageId, {
      title: nonEmpty(title) ?? currentPage.title,
      content: storageContent ?? currentBody,
      version: currentPage.version.number + 1,
      versionMessage,
    });

    return {
      id: updatedPage.id,
      title: updatedPage.title,
      type: updatedPage.type ?? "page",
      url: updatedPage._links.webui,
      version: updatedPage.version.number,
      versionMessage: updatedPage.version.message,
    };
  },
});
