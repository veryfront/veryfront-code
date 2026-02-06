import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatPhoneNumber, sendWhatsApp } from "../../lib/twilio-client.ts";

export default tool({
  id: "send-whatsapp",
  description:
    "Send a WhatsApp message to a phone number using Twilio. Note: Recipients must have opted in to receive messages.",
  inputSchema: z.object({
    to: z
      .string()
      .describe(
        "Recipient phone number in E.164 format (e.g., +14155552671). The 'whatsapp:' prefix is optional.",
      ),
    body: z.string().min(1).describe("Message text to send"),
    mediaUrl: z
      .array(z.string().url())
      .optional()
      .describe("Optional array of media URLs to send (images, videos, PDFs, etc.)"),
  }),
  execute: async ({ to, body, mediaUrl }) => {
    try {
      const formattedPhone = formatPhoneNumber(to);
      const message = await sendWhatsApp(formattedPhone, body, { mediaUrl });

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
        message: `WhatsApp message sent successfully to ${message.to}. Status: ${message.status}`,
      };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      const message = error.message;

      if (message.includes("not configured")) {
        return {
          error:
            "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
          setupUrl: "https://console.twilio.com/",
        };
      }

      const errorMap: Array<[code: string, result: Record<string, unknown>]> = [
        [
          "63007",
          {
            error:
              "Recipient has not opted in to receive WhatsApp messages. They must send a message to your WhatsApp sandbox first.",
            sandboxUrl: "https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn",
          },
        ],
        ["63016", { error: "WhatsApp message failed: Recipient phone number is not a WhatsApp user." }],
        ["63030", { error: "Message body is required for WhatsApp messages unless media is included." }],
        ["63003", { error: "Message exceeds maximum allowed length for WhatsApp." }],
      ];

      for (const [code, result] of errorMap) {
        if (message.includes(code)) return result;
      }

      throw error;
    }
  },
});
