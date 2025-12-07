import { tool } from "veryfront/ai";
import { z } from "zod";
import { sendMessage } from "../../lib/webex-client.ts";

export default tool({
  id: "send-message",
  description:
    "Send a text or markdown message to a Webex room/space or directly to a person.",
  inputSchema: z.object({
    roomId: z.string().optional().describe(
      "Room ID to send the message to (use this OR toPersonEmail)",
    ),
    toPersonEmail: z.string().email().optional().describe(
      "Email address to send a direct message (use this OR roomId)",
    ),
    text: z.string().optional().describe(
      "Plain text message content (use this OR markdown)",
    ),
    markdown: z.string().optional().describe(
      "Markdown formatted message content (use this OR text)",
    ),
  }).refine(
    (data) => data.roomId || data.toPersonEmail,
    {
      message: "Must specify either roomId or toPersonEmail",
    },
  ).refine(
    (data) => data.text || data.markdown,
    {
      message: "Must specify either text or markdown",
    },
  ),
  async execute({ roomId, toPersonEmail, text, markdown }) {
    const message = await sendMessage({
      roomId,
      toPersonEmail,
      text,
      markdown,
    });

    return {
      id: message.id,
      roomId: message.roomId,
      text: message.text,
      markdown: message.markdown,
      personEmail: message.personEmail,
      created: message.created,
      message: `Message sent successfully to ${roomId ? `room ${roomId}` : toPersonEmail}`,
    };
  },
});
