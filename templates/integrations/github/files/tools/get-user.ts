import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "github-get-user",
  description: "Get a GitHub user profile by username",
  inputSchema: defineSchema((v) =>
    v.object({
      username: v.string().describe("GitHub username/login to look up"),
    })
  )(),
  execute: async ({ username }, context) => {
    const userId = requireUserIdFromContext(context);

    try {
      const github = createGitHubClient(userId);
      const result = await github.getUserByUsername(username);

      return {
        user: {
          login: result.login,
          id: result.id,
          name: result.name ?? null,
          type: result.type,
          url: result.html_url,
          avatarUrl: result.avatar_url,
          company: result.company ?? null,
          blog: result.blog || null,
          location: result.location ?? null,
          email: result.email ?? null,
          bio: result.bio ?? null,
          twitterUsername: result.twitter_username ?? null,
          publicRepos: result.public_repos,
          followers: result.followers,
          following: result.following,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
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
