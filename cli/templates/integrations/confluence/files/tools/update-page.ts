import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatAsStorage, getPage, updatePage } from "../../lib/confluence-client.ts";

function toStorageContent(content?: string): string | undefined {
  if (!content) return undefined;

  const trimmed = content.trim();
  if (trimmed.startsWith("<")) return content;

  return formatAsStorage(content);
}

export default tool({
  id: "update-page",
  description:
    "Update the content or title of an existing Confluence page. Requires the current version number.",
  inputSchema: defineSchema((v) => v.object({
    pageId: v.string().describe("The ID of the page to update"),
    title: v
      .string()
      .optional()
      .describe("New title for the page (leave empty to keep current title)"),
    content: v
      .string()
      .optional()
      .describe("New content for the page (can be plain text or Confluence storage format HTML)"),
    versionMessage: v
      .string()
      .optional()
      .describe("Optional message describing the changes made"),
  }))(),
  async execute({ pageId, title, content, versionMessage }) {
    const currentPage = await getPage(pageId, ["version"]);
    const storageContent = toStorageContent(content);

    const updatedPage = await updatePage(pageId, {
      title,
      content: storageContent,
      version: currentPage.version.number + 1,
      versionMessage,
    });

    return {
      id: updatedPage.id,
      title: updatedPage.title,
      type: updatedPage.type,
      url: updatedPage._links.webui,
      version: updatedPage.version.number,
      versionMessage: updatedPage.version.message,
    };
  },
});
