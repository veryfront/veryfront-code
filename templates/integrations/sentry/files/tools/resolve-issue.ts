import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { resolveIssue } from "../lib/sentry-client.ts";

export default tool({
  id: "sentry-resolve-issue",
  description:
    "Mark a Sentry issue as resolved. Use this after you've fixed a bug or determined an issue is no longer relevant.",
  inputSchema: defineSchema((v) => v.object({
    issueId: v.string().describe("The ID of the issue to resolve"),
  }))(),
  async execute({ issueId }) {
    const issue = await resolveIssue(issueId);

    return {
      success: true,
      issue,
      message: `Issue ${issue.shortId} has been marked as resolved.`,
    };
  },
});
