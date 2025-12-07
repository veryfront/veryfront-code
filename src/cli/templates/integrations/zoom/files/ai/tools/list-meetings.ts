import { tool } from "veryfront/ai";
import { z } from "zod";
import { listMeetings } from "../../lib/zoom-client.ts";

export default tool({
  id: "list-meetings",
  description:
    "List Zoom meetings for the current user. Can filter by meeting type (scheduled, live, upcoming, etc.).",
  inputSchema: z.object({
    type: z
      .enum(["scheduled", "live", "upcoming", "upcoming_meetings", "previous_meetings"])
      .default("scheduled")
      .describe("Type of meetings to list"),
    pageSize: z
      .number()
      .min(1)
      .max(300)
      .default(30)
      .describe("Number of meetings to return per page"),
    pageNumber: z
      .number()
      .min(1)
      .default(1)
      .describe("Page number for pagination"),
  }),
  async execute({ type, pageSize, pageNumber }) {
    const meetings = await listMeetings({
      type,
      pageSize,
      pageNumber,
    });

    return meetings.map((meeting) => ({
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
      status: meeting.status,
    }));
  },
});
