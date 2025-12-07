import { tool } from "veryfront/ai";
import { z } from "zod";
import { listSpaces } from "../../lib/confluence-client.ts";

export default tool({
  id: "list-spaces",
  description: "List all accessible Confluence spaces. Returns space keys, names, and links.",
  inputSchema: z.object({
    type: z.enum(["global", "personal", "all"]).default("all").describe(
      "Type of spaces to list (global, personal, or all)",
    ),
    limit: z.number().min(1).max(100).default(25).describe("Maximum number of spaces to return"),
  }),
  async execute({ type, limit }) {
    const spaceType = type === "all" ? undefined : type;

    const spaces = await listSpaces({
      type: spaceType,
      limit,
    });

    return spaces.map((space) => ({
      id: space.id,
      key: space.key,
      name: space.name,
      type: space.type,
      status: space.status,
      url: space._links.webui,
    }));
  },
});
