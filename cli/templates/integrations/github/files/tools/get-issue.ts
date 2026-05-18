import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../../lib/github-client.ts";

export default tool({
  id: "get-issue",
  description: "Get details of a GitHub issue",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v.string().describe("Repository in format 'owner/repo'"),
      issueNumber: v.number().int().positive().describe("Issue number"),
    })
  )(),
  execute: async ({ repo, issueNumber }, context) => {
    const userId = context?.userId ?? "current-user";
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    const github = createGitHubClient(userId);
    const issue = await github.getIssue(owner, repoName, issueNumber);
    return {
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        url: issue.html_url,
        author: issue.user.login,
        labels: issue.labels.map((label: { name: string }) => label.name),
        assignees: issue.assignees.map((assignee: { login: string }) =>
          assignee.login
        ),
        updatedAt: issue.updated_at,
      },
    };
  },
});
