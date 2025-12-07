import { tool } from "veryfront/ai";
import { z } from "zod";
import { updateMeeting } from "../../lib/zoom-client.ts";

export default tool({
  id: "update-meeting",
  description: "Update an existing Zoom meeting with new settings.",
  inputSchema: z.object({
    meetingId: z
      .union([z.string(), z.number()])
      .describe("The meeting ID to update"),
    topic: z
      .string()
      .optional()
      .describe("The new topic/title of the meeting"),
    type: z
      .enum(["1", "2", "3", "8"])
      .transform((val) => parseInt(val) as 1 | 2 | 3 | 8)
      .optional()
      .describe(
        "Meeting type: 1=Instant, 2=Scheduled, 3=Recurring with no fixed time, 8=Recurring with fixed time",
      ),
    startTime: z
      .string()
      .optional()
      .describe("New start time in ISO 8601 format"),
    duration: z
      .number()
      .min(1)
      .optional()
      .describe("New meeting duration in minutes"),
    timezone: z
      .string()
      .optional()
      .describe("New timezone"),
    password: z
      .string()
      .optional()
      .describe("New meeting password"),
    agenda: z
      .string()
      .optional()
      .describe("New meeting agenda or description"),
    hostVideo: z
      .boolean()
      .optional()
      .describe("Start video when host joins"),
    participantVideo: z
      .boolean()
      .optional()
      .describe("Start video when participants join"),
    joinBeforeHost: z
      .boolean()
      .optional()
      .describe("Allow participants to join before host"),
    muteUponEntry: z
      .boolean()
      .optional()
      .describe("Mute participants upon entry"),
    autoRecording: z
      .enum(["local", "cloud", "none"])
      .optional()
      .describe("Automatic recording setting"),
  }),
  async execute({
    meetingId,
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
    const settings =
      hostVideo !== undefined ||
      participantVideo !== undefined ||
      joinBeforeHost !== undefined ||
      muteUponEntry !== undefined ||
      autoRecording !== undefined
        ? {
            hostVideo,
            participantVideo,
            joinBeforeHost,
            muteUponEntry,
            autoRecording,
          }
        : undefined;

    await updateMeeting(meetingId, {
      topic,
      type,
      startTime,
      duration,
      timezone,
      password,
      agenda,
      settings,
    });

    return {
      success: true,
      message: `Meeting ${meetingId} updated successfully`,
    };
  },
});
