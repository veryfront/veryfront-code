import { tool } from "veryfront/tool";
import { z } from "zod";
import { sendSMS, formatPhoneNumber } from "../../lib/twilio-client.ts";

export default tool({
  id: "send-sms",
  description: "Send an SMS text message to a phone number using Twilio",
  inputSchema: z.object({
    to: z
      .string()
      .describe("Recipient phone number in E.164 format (e.g., +14155552671) or 10-digit US format"),
    body: z
      .string()
      .min(1)
      .max(1600)
      .describe("Message text to send (max 1600 characters)"),
    mediaUrl: z
      .array(z.string().url())
      .optional()
      .describe("Optional array of media URLs to send as MMS (images, videos, etc.)"),
  }),
  execute: async ({ to, body, mediaUrl }) => {
    try {
      // Format phone number to E.164 if needed
      const formattedPhone = formatPhoneNumber(to);

      const message = await sendSMS(formattedPhone, body, {
        mediaUrl,
      });

      return {
        success: true,
        messageSid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        body: message.body,
        numSegments: message.num_segments,
        price: message.price,
        priceUnit: message.price_unit,
        message: `SMS sent successfully to ${message.to}. Status: ${message.status}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        // Check for common errors
        if (error.message.includes("not configured")) {
          return {
            error: "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
            setupUrl: "https://console.twilio.com/",
          };
        }

        // Twilio API errors
        if (error.message.includes("21211")) {
          return {
            error: `Invalid phone number: ${to}. Please use E.164 format (e.g., +14155552671).`,
          };
        }

        if (error.message.includes("21608")) {
          return {
            error: `Unverified number. Trial accounts can only send to verified numbers. Verify at: https://console.twilio.com/us1/develop/phone-numbers/manage/verified`,
          };
        }

        if (error.message.includes("21610")) {
          return {
            error: `Unverified 'To' number. This number must be verified before you can send messages to it during trial.`,
          };
        }
      }
      throw error;
    }
  },
});
