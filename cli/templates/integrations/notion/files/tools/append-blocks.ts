import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createNotionClient } from "../lib/notion-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "notion-append-blocks",
  description: "Append child blocks to a Notion page or block.",
  inputSchema: defineSchema((v) =>
    v.object({
      blockId: v.string().describe(
        "The page or block ID to append children to",
      ),
      children: v.array(v.record(v.string(), v.unknown())).describe(
        "Notion block objects to append",
      ),
      after: v.string().optional().describe(
        "Optional existing child block ID after which to append",
      ),
    })
  )(),
  async execute({ blockId, children, after }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createNotionClient(userId);
    const blocks = await client.appendBlocks({ blockId, children, after });

    return blocks.map((block) => ({
      id: block.id,
      type: block.type,
      block,
    }));
  },
});
