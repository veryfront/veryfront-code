import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatAsStorage, getPage, updatePage } from "../../lib/confluence-client.ts";

export default tool({
  id: "update-page",
  description:
    "Update the content or title of an existing Confluence page. Requires the current version number.",
  inputSchema: z.object({
    pageId: z.string().describe("The ID of the page to update"),
    title: z.string().optional().describe(
      "New title for the page (leave empty to keep current title)",
    ),
    content: z.string().optional().describe(
      "New content for the page (can be plain text or Confluence storage format HTML)",
    ),
    versionMessage: z.string().optional().describe("Optional message describing the changes made"),
  }),
  async execute({ pageId, title, content, versionMessage }) {
    // Get current page to retrieve version number
    const currentPage = await getPage(pageId, ["version"]);

    // Format content if provided
    let storageContent: string | undefined;
    if (content) {
      storageContent = content.trim().startsWith("<") ? content : formatAsStorage(content);
    }

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
