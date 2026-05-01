import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const DraftInput = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]).describe("Email recipient(s)"),
  subject: z.string().min(1).describe("Email subject line"),
  body: z.string().min(1).describe("Email body content"),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional().describe(
    "CC recipient(s)",
  ),
  bcc: z
    .union([z.string().email(), z.array(z.string().email())])
    .optional()
    .describe("BCC recipient(s)"),
  replyTo: z.string().email().optional().describe("Reply-To address"),
  isHtml: z.boolean().default(false).describe("Whether the body contains HTML"),
  threadId: z.string().optional().describe("Thread ID to draft a reply in"),
});

export default tool({
  id: "create-draft",
  description: "Create a Gmail draft message.",
  inputSchema: DraftInput,
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
