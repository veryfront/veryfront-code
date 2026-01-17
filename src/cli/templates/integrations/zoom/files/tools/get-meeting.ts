import { tool } from "veryfront/tool";
import { z } from "zod";
import { getMeeting } from "../../lib/zoom-client.ts";

export default tool({
  id: "get-meeting",
  description: "Get detailed information about a specific Zoom meeting by its ID.",
  inputSchema: z.object({
    meetingId: z
      .union([z.string(), z.number()])
      .describe("The meeting ID or UUID"),
  }),
  async execute({ meetingId }) {
    const meeting = await getMeeting(meetingId);

    return {
      id: meeting.id,
      uuid: meeting.uuid,
      topic: meeting.topic,
      type: meeting.type,
      startTime: meeting.start_time,
      duration: meeting.duration,
      timezone: meeting.timezone,
      agenda: meeting.agenda,
      joinUrl: meeting.join_url,
      password: meeting.password,
      hostId: meeting.host_id,
      hostEmail: meeting.host_email,
      status: meeting.status,
      createdAt: meeting.created_at,
      settings: meeting.settings
        ? {
            hostVideo: meeting.settings.host_video,
            participantVideo: meeting.settings.participant_video,
            joinBeforeHost: meeting.settings.join_before_host,
            muteUponEntry: meeting.settings.mute_upon_entry,
            watermark: meeting.settings.watermark,
            audio: meeting.settings.audio,
            autoRecording: meeting.settings.auto_recording,
          }
        : undefined,
    };
  },
});
