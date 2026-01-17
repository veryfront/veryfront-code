import { tool } from "veryfront/tool";
import { z } from "zod";
import { sendEmail } from "../../lib/outlook-client.ts";

export default tool({
  id: "send-email",
  description:
    "Send a new email message. Supports multiple recipients, CC, BCC, and importance levels.",
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1).describe("Email addresses of recipients"),
    subject: z.string().min(1).describe("Email subject line"),
    body: z.string().min(1).describe("Email body content"),
    cc: z.array(z.string().email()).optional().describe("Email addresses to CC"),
    bcc: z.array(z.string().email()).optional().describe("Email addresses to BCC"),
    importance: z.enum(["low", "normal", "high"]).default("normal").describe(
      "Email importance level",
    ),
    bodyType: z.enum(["text", "html"]).default("text").describe("Body content type (text or html)"),
  }),
  async execute({ to, subject, body, cc, bcc, importance, bodyType }) {
    await sendEmail({
      to,
      subject,
      body,
      cc,
      bcc,
      importance,
      bodyType,
    });

    return {
      success: true,
      message: `Email sent successfully to ${to.join(", ")}`,
      recipients: {
        to,
        cc,
        bcc,
      },
    };
  },
});
