import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createCalendarClient } from "../lib/calendar-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "calendar-update-event",
  description: "Update an existing Google Calendar event by ID",
  inputSchema: defineSchema((v) =>
    v.object({
      eventId: v.string().min(1).describe("Event ID to update"),
      calendarId: v.string().default("primary").describe("Calendar ID"),
      title: v.string().optional().describe("Updated event title"),
      startTime: v.string().optional().describe(
        "Updated start time in ISO 8601 format",
      ),
      endTime: v.string().optional().describe(
        "Updated end time in ISO 8601 format",
      ),
      description: v.string().optional().describe("Updated event description"),
      location: v.string().optional().describe("Updated event location"),
      attendees: v.array(v.string().email()).optional().describe(
        "Updated attendee email addresses",
      ),
      timeZone: v.string().default("UTC").describe(
        "Time zone for updated start/end values",
      ),
    })
  )(),
  execute: async (
    {
      eventId,
      calendarId,
      title,
      startTime,
      endTime,
      description,
      location,
      attendees,
      timeZone,
    },
    context,
  ) => {
    const userId = requireUserIdFromContext(context);
    const calendar = createCalendarClient(userId);
    const event = await calendar.updateEvent(
      eventId,
      {
        summary: title,
        start: startTime,
        end: endTime,
        description,
        location,
        attendees,
        timeZone,
      },
      calendarId,
    );

    return {
      success: true,
      event: {
        id: event.id,
        title: event.summary,
        start: event.start.dateTime ?? event.start.date,
        end: event.end.dateTime ?? event.end.date,
        url: event.htmlLink,
        location: event.location,
      },
      message: `Event "${event.summary}" updated successfully.`,
    };
  },
});
