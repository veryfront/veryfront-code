import { tool } from "veryfront/ai";
import { z } from "zod";
import { listBases } from "../../lib/airtable-client.ts";

export default tool({
  id: "list-bases",
  description:
    "List all accessible Airtable bases in the connected account. Returns base IDs, names, and permission levels.",
  inputSchema: z.object({}),
  async execute() {
    const bases = await listBases();

    return bases.map((base) => ({
      id: base.id,
      name: base.name,
      permissionLevel: base.permissionLevel,
    }));
  },
});
