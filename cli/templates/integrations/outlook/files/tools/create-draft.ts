import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "create-draft",
  description:
    "Create an Outlook email draft for human approval. This does not send the message.",
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
      replyTo: v.array(v.string().email()).optional().describe(
        "Reply-to addresses",
      ),
      importance: v
        .enum(["low", "normal", "high"])
        .default("normal")
        .describe("Email importance level"),
      bodyType: v
        .enum(["text", "html"])
        .default("text")
        .describe("Body content type"),
      categories: v.array(v.string()).optional().describe(
        "Outlook category names",
      ),
    })
  )(),
  async execute(
    { to, subject, body, cc, bcc, replyTo, importance, bodyType, categories },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const draft = await client.createDraft({
      to,
      subject,
      body,
      cc,
      bcc,
      replyTo,
      importance: requireAllowedValue(
        importance,
        ["low", "normal", "high"],
        "importance",
      ),
      bodyType: requireAllowedValue(bodyType, ["text", "html"], "body type"),
      categories,
    });

    return {
      draft: {
        id: draft.id,
        thread_id: draft.conversationId,
        subject: draft.subject,
        to: client.summarizeContacts(draft.toRecipients),
        preview: draft.bodyPreview,
        webLink: draft.webLink,
        isDraft: true,
      },
    };
  },
});
