import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "gmail-update-draft",
  description: "Replace the content of a Gmail draft.",
  inputSchema: defineSchema((v) =>
    v.object({
      draftId: v.string().min(1).describe("Gmail draft ID"),
      to: v.union([v.string().email(), v.array(v.string().email())]).describe(
        "Email recipient(s)",
      ),
      subject: v.string().min(1).describe("Email subject line"),
      body: v.string().min(1).describe("Email body content"),
      cc: v
        .union([v.string().email(), v.array(v.string().email())])
        .optional()
        .describe("CC recipient(s)"),
      bcc: v
        .union([v.string().email(), v.array(v.string().email())])
        .optional()
        .describe("BCC recipient(s)"),
      replyTo: v.string().email().optional().describe("Reply-To address"),
      isHtml: v.boolean().default(false).describe(
        "Whether the body contains HTML",
      ),
      threadId: v.string().optional().describe(
        "Thread ID to keep the draft in",
      ),
    })
  )(),
  execute: async ({ draftId, ...input }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const draft = await gmail.updateDraft(draftId, input);

      return {
        success: true,
        draft,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Gmail not connected. Please connect your Gmail account.",
          connectUrl: "/api/auth/gmail",
        };
      }
      throw error;
    }
  },
});
