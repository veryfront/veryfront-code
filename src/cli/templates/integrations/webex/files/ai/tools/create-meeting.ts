import { tool } from "veryfront/tool";
import { z } from "zod";
import { createMeeting } from "../../lib/webex-client.ts";

export default tool({
  id: "create-meeting",
  description: "Schedule a new Webex meeting with specified details.",
  inputSchema: z.object({
    title: z.string().describe("Title of the meeting"),
    agenda: z.string().optional().describe("Meeting agenda or description"),
    start: z.string().describe(
      "Start date and time in ISO 8601 format (e.g., 2024-01-15T14:00:00Z)",
    ),
    end: z.string().describe(
      "End date and time in ISO 8601 format (e.g., 2024-01-15T15:00:00Z)",
    ),
    timezone: z.string().default("UTC").describe(
      "Timezone for the meeting (e.g., America/New_York, Europe/London)",
    ),
    enabledAutoRecordMeeting: z.boolean().default(false).describe(
      "Automatically record the meeting",
    ),
    allowAnyUserToBeCoHost: z.boolean().default(false).describe(
      "Allow any user to be a co-host",
    ),
    invitees: z.array(
      z.object({
        email: z.string().email().describe("Email address of the invitee"),
        displayName: z.string().optional().describe("Display name of the invitee"),
        coHost: z.boolean().default(false).describe("Make this invitee a co-host"),
      }),
    ).optional().describe("List of invitees to the meeting"),
  }),
  async execute({
    title,
    agenda,
    start,
    end,
    timezone,
    enabledAutoRecordMeeting,
    allowAnyUserToBeCoHost,
    invitees,
  }) {
    const meeting = await createMeeting({
      title,
      agenda,
      start,
      end,
      timezone,
      enabledAutoRecordMeeting,
      allowAnyUserToBeCoHost,
      invitees,
    });

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
      meetingNumber: meeting.meetingNumber,
      message: `Meeting "${meeting.title}" created successfully. Join URL: ${meeting.webLink}`,
    };
  },
});
