import { tool } from "veryfront/ai";
import { z } from "zod";
import { resolveIssue } from "../../lib/sentry-client.ts";

export default tool({
  id: "resolve-issue",
  description:
    "Mark a Sentry issue as resolved. Use this after you've fixed a bug or determined an issue is no longer relevant.",
  inputSchema: z.object({
    issueId: z.string().describe("The ID of the issue to resolve"),
  }),
  async execute({ issueId }) {
    const issue = await resolveIssue(issueId);

    return {
      success: true,
      issue: {
        id: issue.id,
        shortId: issue.shortId,
        title: issue.title,
        status: issue.status,
        statusDetails: issue.statusDetails,
        permalink: issue.permalink,
      },
      message: `Issue ${issue.shortId} has been marked as resolved.`,
    };
  },
});
