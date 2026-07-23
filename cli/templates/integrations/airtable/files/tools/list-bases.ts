import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createAirtableClient } from "../lib/airtable-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-bases",
  description:
    "List all accessible Airtable bases in the connected account. Returns base IDs, names, and permission levels.",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute(_input, context) {
    const userId = requireUserIdFromContext(context);
    const client = createAirtableClient(userId);
    return client.listBases();
  },
});
