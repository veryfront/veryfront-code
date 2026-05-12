import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createCalendarClient } from "../../lib/calendar-client.ts";

export default tool({
  id: "create-event",
  description: "Create a new event in Google Calendar",
  inputSchema: defineSchema((v) => v.object({
    title: v.string().min(1).describe("Event title"),
    startTime: v
      .string()
      .describe("Start time in ISO 8601 format (e.g., '2024-01-15T09:00:00')"),
    endTime: v
      .string()
      .describe("End time in ISO 8601 format (e.g., '2024-01-15T10:00:00')"),
    description: v.string().optional().describe("Event description"),
    location: v.string().optional().describe("Event location"),
    attendees: v
      .array(v.string().email())
      .optional()
      .describe("Email addresses of attendees to invite"),
    timeZone: v
      .string()
      .default("UTC")
      .describe("Time zone for the event (e.g., 'America/New_York')"),
  }))(),
  execute: async (
    { title, startTime, endTime, description, location, attendees, timeZone },
    context,
  ) => {
    const userId = context?.userId ?? "current-user";

    try {
      const calendar = createCalendarClient(userId);
      const event = await calendar.createEvent({
        summary: title,
        start: startTime,
        end: endTime,
        description,
        location,
        attendees,
        timeZone,
      });

      return {
        success: true,
        event: {
          id: event.id,
          title: event.summary,
          start: event.start.dateTime ?? event.start.date,
          end: event.end.dateTime ?? event.end.date,
          url: event.htmlLink,
          location: event.location,
          attendees: event.attendees?.map((a: { email: string }) => a.email) ?? [],
        },
        message: `Event "${title}" created successfully.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Calendar not connected. Please connect your Google Calendar.",
          connectUrl: "/api/auth/calendar",
        };
      }
      throw error;
    }
  },
});
