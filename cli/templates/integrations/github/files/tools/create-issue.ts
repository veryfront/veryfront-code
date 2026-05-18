import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../../lib/github-client.ts";
import { requireUserIdFromContext } from "../../lib/user-id.ts";

export default tool({
  id: "create-issue",
  description: "Create a new issue in a GitHub repository",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v
        .string()
        .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
      title: v.string().min(1).describe("Issue title"),
      body: v
        .string()
        .optional()
        .describe("Issue body/description (supports Markdown)"),
      labels: v.array(v.string()).optional().describe(
        "Labels to add to the issue",
      ),
      assignees: v
        .array(v.string())
        .optional()
        .describe("GitHub usernames to assign to the issue"),
    })
  )(),
  execute: async ({ repo, title, body, labels, assignees }, context) => {
    const userId = requireUserIdFromContext(context);

    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const issue = await github.createIssue(owner, repoName, {
        title,
        body,
        labels,
        assignees,
      });

      return {
        success: true,
        issue: {
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          state: issue.state,
          labels: issue.labels.map((l: { name: string }) => l.name),
          assignees: issue.assignees.map((a: { login: string }) => a.login),
        },
        message: `Issue #${issue.number} created successfully in ${repo}.`,
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
