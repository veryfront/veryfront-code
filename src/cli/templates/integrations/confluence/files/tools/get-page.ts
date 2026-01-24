import { tool } from "veryfront/tool";
import { z } from "zod";
import { extractPlainText, getPageContent } from "../../lib/confluence-client.ts";

export default tool({
  id: "get-page",
  description:
    "Get the content of a specific Confluence page. Returns the page title, content, and metadata.",
  inputSchema: z.object({
    pageId: z.string().describe("The ID of the Confluence page to retrieve"),
  }),
  async execute({ pageId }) {
    const page = await getPageContent(pageId);

    const content = page.body?.storage?.value ?? page.body?.view?.value ?? "";
    const plainTextContent = extractPlainText(content);

    return {
      id: page.id,
      type: page.type,
      title: page.title,
      content: plainTextContent,
      htmlContent: content,
      version: page.version.number,
      url: page._links.webui,
      spaceId: page.spaceId,
      parentId: page.parentId,
    };
  },
});
