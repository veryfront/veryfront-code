import { tool } from "veryfront/tool";
import { z } from "zod";
import { getMessage } from "../../lib/twilio-client.ts";

export default tool({
  id: "get-message",
  description: "Get detailed information about a specific SMS or WhatsApp message by its SID (Message ID)",
  inputSchema: z.object({
    messageSid: z
      .string()
      .describe("The unique Twilio Message SID (starts with 'MM' or 'SM', e.g., MM1234567890abcdef)"),
  }),
  execute: async ({ messageSid }) => {
    try {
      const message = await getMessage(messageSid);

      return {
        success: true,
        message: {
          sid: message.sid,
          accountSid: message.account_sid,
          direction: message.direction,
          from: message.from,
          to: message.to,
          body: message.body,
          status: message.status,
          dateSent: message.date_sent,
          dateCreated: message.date_created,
          dateUpdated: message.date_updated,
          numSegments: message.num_segments,
          numMedia: message.num_media,
          price: message.price ? `${message.price} ${message.price_unit}` : null,
          errorCode: message.error_code,
          errorMessage: message.error_message,
          uri: message.uri,
          messagingServiceSid: message.messaging_service_sid,
        },
        summary: `Message ${message.sid}: ${message.direction} ${message.status} message from ${message.from} to ${message.to}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not configured")) {
          return {
            error: "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
            setupUrl: "https://console.twilio.com/",
          };
        }

        if (error.message.includes("20404")) {
          return {
            error: `Message not found. The SID '${messageSid}' does not exist in your account.`,
          };
        }
      }
      throw error;
    }
  },
});
