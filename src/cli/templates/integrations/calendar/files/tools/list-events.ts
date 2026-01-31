import { tool } from "veryfront/tool";
import { z } from "zod";
import { createCalendarClient } from "../../lib/calendar-client.ts";

type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status: string;
  htmlLink: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
};

export default tool({
  id: "list-events",
  description: "List upcoming calendar events. By default shows events from now onwards.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Maximum number of events to return"),
    daysAhead: z.number().min(1).max(30).default(7).describe("Number of days to look ahead"),
    todayOnly: z.boolean().default(false).describe("Only show events for today"),
  }),
  execute: async ({ maxResults, daysAhead, todayOnly }, context) => {
    const userId = context?.userId ?? "current-user";

    try {
      const calendar = createCalendarClient(userId);

      const events = todayOnly
        ? ((await calendar.getTodayEvents()) as CalendarEvent[])
        : ((await calendar.listEvents({
            maxResults,
            timeMin: new Date(),
            timeMax: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000),
          })) as CalendarEvent[]);

      return {
        events: events.map((event) => ({
          id: event.id,
          title: event.summary,
          description: event.description ?? null,
          location: event.location ?? null,
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          isAllDay: !event.start.dateTime,
          status: event.status,
          url: event.htmlLink,
          attendees:
            event.attendees?.map((a) => ({
              email: a.email,
              name: a.displayName,
              status: a.responseStatus,
            })) ?? [],
        })),
        count: events.length,
        message: todayOnly
          ? `Found ${events.length} event(s) for today.`
          : `Found ${events.length} event(s) in the next ${daysAhead} days.`,
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
