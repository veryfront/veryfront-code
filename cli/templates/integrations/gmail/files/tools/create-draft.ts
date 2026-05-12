import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const getDraftInput = defineSchema((v) => v.object({
  to: v.union([v.string().email(), v.array(v.string().email())]).describe("Email recipient(s)"),
  subject: v.string().min(1).describe("Email subject line"),
  body: v.string().min(1).describe("Email body content"),
  cc: v.union([v.string().email(), v.array(v.string().email())]).optional().describe(
    "CC recipient(s)",
  ),
  bcc: v
    .union([v.string().email(), v.array(v.string().email())])
    .optional()
    .describe("BCC recipient(s)"),
  replyTo: v.string().email().optional().describe("Reply-To address"),
  isHtml: v.boolean().default(false).describe("Whether the body contains HTML"),
  threadId: v.string().optional().describe("Thread ID to draft a reply in"),
}));

export default tool({
  id: "create-draft",
  description: "Create a Gmail draft message.",
  inputSchema: getDraftInput(),
  execute: async (input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const draft = await gmail.createDraft(input);

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
