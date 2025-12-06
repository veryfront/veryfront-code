import { tool } from "veryfront/ai";
import { z } from "zod";
import { createGmailClient, parseEmailHeaders } from "../../lib/gmail-client.ts";

export default tool({
  id: "search-emails",
  description:
    "Search emails using Gmail's search syntax. Supports queries like 'from:person@email.com', 'subject:meeting', 'after:2024/01/01', etc.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "Search query using Gmail search syntax (e.g., 'from:boss@company.com subject:urgent')",
      ),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return"),
  }),
  execute: async ({ query, maxResults }, context) => {
    const userId = context?.userId as string | undefined;
    if (!userId) {
      return {
        error: "User not authenticated. Please log in first.",
      };
    }

    try {
      const gmail = createGmailClient(userId);

      const list = await gmail.listMessages({
        query,
        maxResults,
      });

      if (!list.messages || list.messages.length === 0) {
        return {
          emails: [],
          query,
          message: `No emails found matching: "${query}"`,
          searchTips: [
            "from:email@example.com - Search by sender",
            "to:email@example.com - Search by recipient",
            "subject:keywords - Search in subject",
            "after:YYYY/MM/DD - Emails after date",
            "before:YYYY/MM/DD - Emails before date",
            "is:unread - Unread emails only",
            "has:attachment - Emails with attachments",
          ],
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
            labels: message.labelIds,
          };
        }),
      );

      return {
        emails,
        query,
        count: emails.length,
        message: `Found ${emails.length} email(s) matching: "${query}"`,
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
