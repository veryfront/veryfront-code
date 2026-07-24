import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createCalendarClient } from "../lib/calendar-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "calendar-delete-event",
  description: "Delete a Google Calendar event by ID",
  inputSchema: defineSchema((v) =>
    v.object({
      eventId: v.string().min(1).describe("Event ID to delete"),
      calendarId: v.string().default("primary").describe("Calendar ID"),
    })
  )(),
  execute: async ({ eventId, calendarId }, context) => {
    const userId = requireUserIdFromContext(context);
    const calendar = createCalendarClient(userId);
    await calendar.deleteEvent(eventId, calendarId);

    return {
      success: true,
      eventId,
      message: `Event ${eventId} deleted successfully.`,
    };
  },
});
