import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listBases } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "airtable-list-bases",
  description:
    "List all accessible Airtable bases in the connected account. Returns base IDs, names, and permission levels.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    return listBases(userId);
  },
});
