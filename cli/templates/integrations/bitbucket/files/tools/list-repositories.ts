import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createBitbucketClient } from "../../lib/bitbucket-client.ts";

type BitbucketRepo = {
  name: string;
  full_name: string;
  description: string | null;
  is_private: boolean;
  mainbranch: { name: string } | null;
  language: string;
  updated_on: string;
  created_on: string;
  links: { html: { href: string } };
  owner: { username: string; display_name: string };
};

export default tool({
  id: "list-repositories",
  description: "List Bitbucket repositories for the authenticated user",
  inputSchema: defineSchema((v) => v.object({
    role: v
      .enum(["owner", "contributor", "member"])
      .optional()
      .describe("Filter repositories by role"),
    limit: v
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of repositories to return"),
  }))(),
  execute: async ({ role, limit }, context) => {
    const userId = context?.userId ?? "current-user";

    try {
      const bitbucket = createBitbucketClient(userId);
      const repos = await bitbucket.listRepositories({ role, perPage: limit });

      return {
        repositories: repos.map((repo: BitbucketRepo) => ({
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description ?? null,
          isPrivate: repo.is_private,
          mainBranch: repo.mainbranch?.name ?? null,
          language: repo.language,
          url: repo.links.html.href,
          owner: {
            username: repo.owner.username,
            displayName: repo.owner.display_name,
          },
          updatedOn: repo.updated_on,
          createdOn: repo.created_on,
        })),
        count: repos.length,
        message: `Found ${repos.length} repository(s).`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Bitbucket not connected. Please connect your Bitbucket account.",
          connectUrl: "/api/auth/bitbucket",
        };
      }
      throw error;
    }
  },
});
