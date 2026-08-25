import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "github-get-current-user",
  description: "Get the authenticated GitHub user identity",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: async (_input, context) => {
    const userId = requireUserIdFromContext(context);

    try {
      const github = createGitHubClient(userId);
      const user = await github.getUser();

      return {
        user: {
          id: user.id,
          nodeId: user.node_id,
          login: user.login,
          name: user.name ?? null,
          email: user.email ?? null,
          url: user.html_url,
          avatarUrl: user.avatar_url,
          type: user.type,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "GitHub not connected. Please connect your GitHub account.",
          connectUrl: "/api/auth/github",
        };
      }
      throw error;
    }
  },
});
