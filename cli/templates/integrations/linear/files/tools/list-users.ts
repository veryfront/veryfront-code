import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { listUsers } from "../../lib/linear-client.ts";

export default tool({
  id: "list-users",
  description:
    "List users in the Linear workspace. Use this to find assignee user IDs before assigning issues.",
  inputSchema: defineSchema((v) => v.object({
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of users to return"),
  }))(),
  async execute({ limit }) {
    const users = await listUsers({ limit });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      email: user.email,
      active: user.active,
      avatarUrl: user.avatarUrl,
    }));
  },
});
