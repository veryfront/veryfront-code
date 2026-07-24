import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLinearClient } from "../lib/linear-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "linear-list-users",
  description:
    "List users in the Linear workspace. Use this to find assignee user IDs before assigning issues.",
  inputSchema: defineSchema((v) =>
    v.object({
      limit: v
        .number()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of users to return"),
    })
  )(),
  async execute({ limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createLinearClient(userId);
    const users = await client.listUsers({ limit });

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
