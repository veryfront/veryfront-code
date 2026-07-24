import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createConfluenceClient } from "../lib/confluence-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "confluence-list-spaces",
  description:
    "List all accessible Confluence spaces. Returns space keys, names, and links.",
  inputSchema: defineSchema((v) =>
    v.object({
      type: v
        .enum(["global", "personal", "all"])
        .default("all")
        .describe("Type of spaces to list (global, personal, or all)"),
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(25)
        .describe("Maximum number of spaces to return"),
    })
  )(),
  async execute({ type, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createConfluenceClient(userId);
    const spaces = await client.listSpaces({
      type: type === "all"
        ? undefined
        : requireAllowedValue(type, ["global", "personal"], "space type"),
      limit,
    });

    return spaces.map(({ id, key, name, type, status, _links }) => ({
      id,
      key,
      name,
      type,
      status,
      url: _links.webui,
    }));
  },
});
