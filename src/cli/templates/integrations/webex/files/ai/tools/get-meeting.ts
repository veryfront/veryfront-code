import { tool } from "veryfront/ai";
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

    return {
      id: meeting.id,
      title: meeting.title,
      agenda: meeting.agenda,
      start: meeting.start,
      end: meeting.end,
      timezone: meeting.timezone,
      hostEmail: meeting.hostEmail,
      hostDisplayName: meeting.hostDisplayName,
      webLink: meeting.webLink,
      sipAddress: meeting.sipAddress,
      meetingNumber: meeting.meetingNumber,
      state: meeting.state,
      enabledAutoRecordMeeting: meeting.enabledAutoRecordMeeting,
      allowAnyUserToBeCoHost: meeting.allowAnyUserToBeCoHost,
    };
  },
});
