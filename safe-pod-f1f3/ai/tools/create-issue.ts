import { tool } from "veryfront/ai";
import { z } from "zod";
import { createGitHubClient } from "../../lib/github-client.ts";

export default tool({
  id: "create-issue",
  description: "Create a new issue in a GitHub repository",
  inputSchema: z.object({
    repo: z
      .string()
      .describe("Repository in format 'owner/repo' (e.g., 'facebook/react')"),
    title: z
      .string()
      .min(1)
      .describe("Issue title"),
    body: z
      .string()
      .optional()
      .describe("Issue body/description (supports Markdown)"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Labels to add to the issue"),
    assignees: z
      .array(z.string())
      .optional()
      .describe("GitHub usernames to assign to the issue"),
  }),
  execute: async ({ repo, title, body, labels, assignees }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return {
        error: "Invalid repository format. Use 'owner/repo' format.",
      };
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
