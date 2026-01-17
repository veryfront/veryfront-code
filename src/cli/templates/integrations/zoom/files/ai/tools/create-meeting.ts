import { tool } from "veryfront/tool";
import { z } from "zod";
import { createMeeting } from "../../lib/zoom-client.ts";

export default tool({
  id: "create-meeting",
  description: "Create a new Zoom meeting with specified settings.",
  inputSchema: z.object({
    topic: z.string().describe("The topic/title of the meeting"),
    type: z
      .enum(["1", "2", "3", "8"])
      .transform((val) => parseInt(val) as 1 | 2 | 3 | 8)
      .default("2")
      .describe(
        "Meeting type: 1=Instant, 2=Scheduled, 3=Recurring with no fixed time, 8=Recurring with fixed time",
      ),
    startTime: z
      .string()
      .optional()
      .describe("Start time in ISO 8601 format (e.g., 2024-12-07T10:00:00Z)"),
    duration: z
      .number()
      .min(1)
      .optional()
      .describe("Meeting duration in minutes"),
    timezone: z
      .string()
      .optional()
      .describe("Timezone (e.g., America/New_York, Europe/London)"),
    password: z
      .string()
      .optional()
      .describe("Meeting password"),
    agenda: z
      .string()
      .optional()
      .describe("Meeting agenda or description"),
    hostVideo: z
      .boolean()
      .default(true)
      .describe("Start video when host joins"),
    participantVideo: z
      .boolean()
      .default(true)
      .describe("Start video when participants join"),
    joinBeforeHost: z
      .boolean()
      .default(false)
      .describe("Allow participants to join before host"),
    muteUponEntry: z
      .boolean()
      .default(false)
      .describe("Mute participants upon entry"),
    autoRecording: z
      .enum(["local", "cloud", "none"])
      .default("none")
      .describe("Automatic recording setting"),
  }),
  async execute({
    topic,
    type,
    startTime,
    duration,
    timezone,
    password,
    agenda,
    hostVideo,
    participantVideo,
    joinBeforeHost,
    muteUponEntry,
    autoRecording,
  }) {
    const meeting = await createMeeting({
      topic,
      type,
      startTime,
      duration,
      timezone,
      password,
      agenda,
      settings: {
        hostVideo,
        participantVideo,
        joinBeforeHost,
        muteUponEntry,
        autoRecording,
        audio: "both",
      },
    });

    return {
      success: true,
      meeting: {
        id: meeting.id,
        uuid: meeting.uuid,
        topic: meeting.topic,
        startTime: meeting.start_time,
        duration: meeting.duration,
        timezone: meeting.timezone,
        joinUrl: meeting.join_url,
        password: meeting.password,
        hostEmail: meeting.host_email,
      },
    };
  },
});
