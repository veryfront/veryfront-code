import { tool } from "veryfront/tool";
import { z } from "zod";
import { deleteMeeting } from "../../lib/zoom-client.ts";

export default tool({
  id: "delete-meeting",
  description: "Delete a scheduled Zoom meeting.",
  inputSchema: z.object({
    meetingId: z.union([z.string(), z.number()]).describe("The meeting ID to delete"),
    occurrenceId: z
      .string()
      .optional()
      .describe("The meeting occurrence ID for recurring meetings"),
    scheduleForReminder: z
      .boolean()
      .default(false)
      .describe("Whether to send a reminder email to participants"),
  }),
  async execute({ meetingId, occurrenceId, scheduleForReminder }) {
    await deleteMeeting(meetingId, { occurrenceId, scheduleForReminder });

    return {
      success: true,
      message: `Meeting ${meetingId} deleted successfully`,
    };
  },
});
