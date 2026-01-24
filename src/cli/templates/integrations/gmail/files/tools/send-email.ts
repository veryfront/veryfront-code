import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../../lib/gmail-client.ts";

function formatRecipients(value?: string | string[]): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(", ") : value;
}

export default tool({
  id: "send-email",
  description: "Send an email via Gmail. Can send to multiple recipients with CC and BCC support.",
  inputSchema: z.object({
    to: z.union([z.string().email(), z.array(z.string().email())]).describe("Email recipient(s)"),
    subject: z.string().min(1).describe("Email subject line"),
    body: z.string().min(1).describe("Email body content"),
    cc: z
      .union([z.string().email(), z.array(z.string().email())])
      .optional()
      .describe("CC recipient(s)"),
    bcc: z
      .union([z.string().email(), z.array(z.string().email())])
      .optional()
      .describe("BCC recipient(s)"),
    isHtml: z.boolean().default(false).describe("Whether the body contains HTML"),
  }),
  execute: async ({ to, subject, body, cc, bcc, isHtml }, context) => {
    const userId = context?.userId ?? "current-user";

    try {
      const gmail = createGmailClient(userId);

      const result = await gmail.sendEmail({
        to,
        subject,
        body,
        cc,
        bcc,
        isHtml,
      });

      const toFormatted = formatRecipients(to)!;

      return {
        success: true,
        messageId: result.id,
        threadId: result.threadId,
        message: `Email sent successfully to ${toFormatted}.`,
        details: {
          to: toFormatted,
          subject,
          cc: formatRecipients(cc),
          bcc: formatRecipients(bcc),
        },
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
