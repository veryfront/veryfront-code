import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "send-email",
  description:
    "Send a new email message. Supports multiple recipients, CC, BCC, and importance levels.",
  inputSchema: defineSchema((v) =>
    v.object({
      to: v.array(v.string().email()).min(1).describe(
        "Email addresses of recipients",
      ),
      subject: v.string().min(1).describe("Email subject line"),
      body: v.string().min(1).describe("Email body content"),
      cc: v.array(v.string().email()).optional().describe(
        "Email addresses to CC",
      ),
      bcc: v.array(v.string().email()).optional().describe(
        "Email addresses to BCC",
      ),
      importance: v
        .enum(["low", "normal", "high"])
        .default("normal")
        .describe("Email importance level"),
      bodyType: v
        .enum(["text", "html"])
        .default("text")
        .describe("Body content type (text or html)"),
    })
  )(),
  async execute({ to, subject, body, cc, bcc, importance, bodyType }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    await client.sendEmail({
      to,
      subject,
      body,
      cc,
      bcc,
      importance: requireAllowedValue(
        importance,
        ["low", "normal", "high"],
        "importance",
      ),
      bodyType: requireAllowedValue(bodyType, ["text", "html"], "body type"),
    });

    return {
      success: true,
      message: `Email sent successfully to ${to.join(", ")}`,
      recipients: { to, cc, bcc },
    };
  },
});
