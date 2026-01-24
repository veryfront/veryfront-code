import { tool } from "veryfront/tool";
import { z } from "zod";
import { listMeetings } from "../../lib/webex-client.ts";

export default tool({
  id: "list-meetings",
  description:
    "List scheduled Webex meetings. Can filter by date range and meeting state.",
  inputSchema: z.object({
    max: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of meetings to return"),
    from: z
      .string()
      .optional()
      .describe("Start date in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)"),
    to: z
      .string()
      .optional()
      .describe("End date in ISO 8601 format (e.g., 2024-12-31T23:59:59Z)"),
    state: z
      .enum(["active", "scheduled", "ended", "missed", "inProgress"])
      .optional()
      .describe("Filter by meeting state"),
  }),
  async execute({ max, from, to, state }) {
    const meetings = await listMeetings({ max, from, to, state });

    return meetings.map(
      ({
        id,
        title,
        agenda,
        start,
        end,
        timezone,
        hostEmail,
        hostDisplayName,
        webLink,
        meetingNumber,
        state,
      }) => ({
        id,
        title,
        agenda,
        start,
        end,
        timezone,
        hostEmail,
        hostDisplayName,
        webLink,
        meetingNumber,
        state,
      }),
    );
  },
});
