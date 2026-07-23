import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGitHubClient } from "../lib/github-client.ts";
import { optionalAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

const ISSUE_STATES = ["open", "closed"] as const;

export default tool({
  id: "update-issue",
  description: "Update, close, or reopen a GitHub issue",
  inputSchema: defineSchema((v) =>
    v.object({
      repo: v.string().describe("Repository in format 'owner/repo'"),
      issueNumber: v.number().int().positive().describe("Issue number"),
      title: v.string().optional().describe("Updated issue title"),
      body: v.string().optional().describe("Updated issue body"),
      state: v.enum(["open", "closed"]).optional().describe("Issue state"),
      labels: v.array(v.string()).optional().describe(
        "Replacement label names",
      ),
      assignees: v.array(v.string()).optional().describe(
        "Replacement assignee usernames",
      ),
    })
  )(),
  execute: async (
    { repo, issueNumber, title, body, state, labels, assignees },
    context,
  ) => {
    const userId = requireUserIdFromContext(context);
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { error: "Invalid repository format. Use 'owner/repo' format." };
    }

    try {
      const github = createGitHubClient(userId);
      const issue = await github.updateIssue(owner, repoName, issueNumber, {
        title,
        body,
        state: optionalAllowedValue(state, ISSUE_STATES, "state"),
        labels,
        assignees,
      });
      return {
        success: true,
        issue: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.html_url,
          labels: issue.labels.map((label: { name: string }) => label.name),
          assignees: issue.assignees.map((assignee: { login: string }) =>
            assignee.login
          ),
        },
        message: `Issue #${issue.number} updated successfully in ${repo}.`,
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
