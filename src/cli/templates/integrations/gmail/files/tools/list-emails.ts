import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient, parseEmailHeaders } from "../../lib/gmail-client.ts";

export default tool({
  id: "list-emails",
  description:
    "List recent emails from Gmail inbox. Returns email subjects, senders, and snippets.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of emails to return"),
    unreadOnly: z.boolean().default(false).describe("Only return unread emails"),
    label: z
      .string()
      .optional()
      .describe("Filter by Gmail label (e.g., 'INBOX', 'IMPORTANT', 'STARRED')"),
  }),
  execute: async ({ maxResults, unreadOnly, label }, context) => {
    const userId = context?.userId ?? "current-user";

    try {
      const gmail = createGmailClient(userId);

      const list = await gmail.listMessages({
        maxResults,
        query: unreadOnly ? "is:unread" : undefined,
        labelIds: label ? [label] : undefined,
      });

      if (!list.messages?.length) {
        return { emails: [], message: "No emails found matching your criteria." };
      }

      const emails = await Promise.all(
        list.messages.map(async ({ id }) => {
          const message = await gmail.getMessage(id, "metadata");
          const headers = parseEmailHeaders(message.payload?.headers ?? []);
          const labelIds = message.labelIds ?? [];

          return {
            id: message.id,
            threadId: message.threadId,
            from: headers.from,
            to: headers.to,
            subject: headers.subject,
            date: headers.date,
            snippet: message.snippet,
            isUnread: labelIds.includes("UNREAD"),
            isStarred: labelIds.includes("STARRED"),
            isImportant: labelIds.includes("IMPORTANT"),
          };
        }),
      );

      return {
        emails,
        count: emails.length,
        message: `Found ${emails.length} email(s).`,
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
