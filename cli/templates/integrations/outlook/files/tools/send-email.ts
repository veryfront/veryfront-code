import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { sendEmail } from "../../lib/outlook-client.ts";

export default tool({
  id: "send-email",
  description:
    "Send a new email message. Supports multiple recipients, CC, BCC, and importance levels.",
  inputSchema: defineSchema((v) => v.object({
    to: v.array(v.string().email()).min(1).describe("Email addresses of recipients"),
    subject: v.string().min(1).describe("Email subject line"),
    body: v.string().min(1).describe("Email body content"),
    cc: v.array(v.string().email()).optional().describe("Email addresses to CC"),
    bcc: v.array(v.string().email()).optional().describe("Email addresses to BCC"),
    importance: v
      .enum(["low", "normal", "high"])
      .default("normal")
      .describe("Email importance level"),
    bodyType: v
      .enum(["text", "html"])
      .default("text")
      .describe("Body content type (text or html)"),
  }))(),
  async execute({ to, subject, body, cc, bcc, importance, bodyType }) {
    await sendEmail({ to, subject, body, cc, bcc, importance, bodyType });

    return {
      success: true,
      message: `Email sent successfully to ${to.join(", ")}`,
      recipients: { to, cc, bcc },
    };
  },
});
