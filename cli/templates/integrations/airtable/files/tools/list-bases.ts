import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listBases } from "../../lib/airtable-client.ts";

export default tool({
  id: "list-bases",
  description:
    "List all accessible Airtable bases in the connected account. Returns base IDs, names, and permission levels.",
  inputSchema: defineSchema((v) => v.object({}))(),
  async execute() {
    return listBases();
  },
});
