import { tool } from "veryfront/tool";
import { z } from "zod";
import { getMeeting } from "../../lib/webex-client.ts";

export default tool({
  id: "get-meeting",
  description: "Get detailed information about a specific Webex meeting by its ID.",
  inputSchema: z.object({
    meetingId: z.string().describe("The unique ID of the meeting"),
  }),
  async execute({ meetingId }) {
    const meeting = await getMeeting(meetingId);

    return { ...meeting };
  },
});
