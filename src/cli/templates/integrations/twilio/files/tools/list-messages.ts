import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatPhoneNumber, listMessages } from "../../lib/twilio-client.ts";

export default tool({
  id: "list-messages",
  description:
    "List recent SMS and WhatsApp messages from your Twilio account. Supports filtering by recipient, sender, and date.",
  inputSchema: z.object({
    to: z
      .string()
      .optional()
      .describe("Filter by recipient phone number in E.164 format (e.g., +14155552671)"),
    from: z
      .string()
      .optional()
      .describe("Filter by sender phone number in E.164 format (e.g., +14155552671)"),
    dateSent: z
      .string()
      .optional()
      .describe("Filter by date sent in YYYY-MM-DD format (e.g., 2024-01-15)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of messages to return (default: 20, max: 100)"),
  }),
  execute: async ({ to, from, dateSent, limit }) => {
    try {
      const options: { to?: string; from?: string; dateSent?: string; limit?: number } = {
        to: to ? formatPhoneNumber(to) : undefined,
        from: from ? formatPhoneNumber(from) : undefined,
        dateSent,
        limit,
      };

      const messages = await listMessages(options);

      if (messages.length === 0) {
        return {
          success: true,
          count: 0,
          messages: [],
          message: "No messages found matching the criteria.",
        };
      }

      const formattedMessages = messages.map((msg) => ({
        sid: msg.sid,
        direction: msg.direction,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        status: msg.status,
        dateSent: msg.date_sent,
        dateCreated: msg.date_created,
        numSegments: msg.num_segments,
        numMedia: msg.num_media,
        price: msg.price ? `${msg.price} ${msg.price_unit}` : null,
        errorCode: msg.error_code,
        errorMessage: msg.error_message,
      }));

      return {
        success: true,
        count: messages.length,
        messages: formattedMessages,
        message: `Found ${messages.length} message${messages.length === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not configured")) {
        return {
          error:
            "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
          setupUrl: "https://console.twilio.com/",
        };
      }
      throw error;
    }
  },
});
