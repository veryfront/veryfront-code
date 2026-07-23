import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createConfluenceClient } from "../lib/confluence-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "get-page",
  description:
    "Get the content of a specific Confluence page. Returns the page title, content, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      pageId: v.string().describe("The ID of the Confluence page to retrieve"),
    })
  )(),
  async execute({ pageId }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createConfluenceClient(userId);
    const page = await client.getPageContent(pageId);

    const htmlContent = page.body?.storage?.value ?? page.body?.view?.value ??
      "";
    const content = client.extractPlainText(htmlContent);

    return {
      id: page.id,
      type: page.type ?? "page",
      title: page.title,
      content,
      htmlContent,
      version: page.version.number,
      url: page._links.webui,
      spaceId: page.spaceId,
      parentId: page.parentId,
    };
  },
});
