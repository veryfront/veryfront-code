import { tool } from "veryfront/tool";
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
    pageNumber: z.number().min(1).default(1).describe("Page number for pagination"),
  }),
  async execute({ type, pageSize, pageNumber }) {
    const meetings = await listMeetings({ type, pageSize, pageNumber });

    return meetings.map(
      ({
        id,
        uuid,
        topic,
        type: meetingType,
        start_time,
        duration,
        timezone,
        agenda,
        join_url,
        password,
        status,
      }) => ({
        id,
        uuid,
        topic,
        type: meetingType,
        startTime: start_time,
        duration,
        timezone,
        agenda,
        joinUrl: join_url,
        password,
        status,
      }),
    );
  },
});
