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
    unreadOnly: z
      .boolean()
      .default(false)
      .describe("Only return unread emails"),
    label: z
      .string()
      .optional()
      .describe("Filter by Gmail label (e.g., 'INBOX', 'IMPORTANT', 'STARRED')"),
  }),
  execute: async ({ maxResults, unreadOnly, label }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const gmail = createGmailClient(userId);

      let query = "";
      if (unreadOnly) {
        query = "is:unread";
      }

      const labelIds = label ? [label] : undefined;

      const list = await gmail.listMessages({
        maxResults,
        query: query || undefined,
        labelIds,
      });

      if (!list.messages || list.messages.length === 0) {
        return {
          emails: [],
          message: "No emails found matching your criteria.",
        };
      }

      // Fetch metadata for each email
      const emails = await Promise.all(
        list.messages.map(async (m: { id: string }) => {
          const message = await gmail.getMessage(m.id, "metadata");
          const headers = parseEmailHeaders(message.payload?.headers || []);

          return {
            id: message.id,
            threadId: message.threadId,
            from: headers.from,
            to: headers.to,
            subject: headers.subject,
            date: headers.date,
            snippet: message.snippet,
            isUnread: message.labelIds?.includes("UNREAD") || false,
            isStarred: message.labelIds?.includes("STARRED") || false,
            isImportant: message.labelIds?.includes("IMPORTANT") || false,
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
