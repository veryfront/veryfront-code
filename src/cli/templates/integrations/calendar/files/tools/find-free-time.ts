import { tool } from "veryfront/tool";
import { z } from "zod";
import { createCalendarClient } from "../../lib/calendar-client.ts";

type FreeSlot = { start: Date; end: Date };

export default tool({
  id: "find-free-time",
  description: "Find available time slots in the calendar for scheduling",
  inputSchema: z.object({
    durationMinutes: z
      .number()
      .min(15)
      .max(480)
      .default(60)
      .describe("Duration needed in minutes"),
    daysToSearch: z
      .number()
      .min(1)
      .max(14)
      .default(7)
      .describe("Number of days to search ahead"),
    workingHoursOnly: z
      .boolean()
      .default(true)
      .describe("Only show slots during working hours (9 AM - 6 PM)"),
  }),
  execute: async (
    { durationMinutes, daysToSearch, workingHoursOnly },
    context,
  ): Promise<unknown> => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = context?.userId ?? "current-user";

    try {
      const calendar = createCalendarClient(userId);

      const now = new Date();
      const searchEnd = new Date();
      searchEnd.setDate(searchEnd.getDate() + daysToSearch);

      const freeSlots = (await calendar.findFreeSlots({
        timeMin: now,
        timeMax: searchEnd,
        durationMinutes,
      })) as FreeSlot[];

      const slots = workingHoursOnly
        ? freeSlots.filter(({ start, end }) => {
            const startHour = start.getHours();
            const endHour = end.getHours();
            return startHour >= 9 && endHour <= 18;
          })
        : freeSlots;

      const formattedSlots = slots.slice(0, 10).map(({ start, end }) => {
        const duration = Math.round((end.getTime() - start.getTime()) / 60000);

        return {
          start: start.toISOString(),
          end: end.toISOString(),
          durationMinutes: duration,
          date: start.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          timeRange: `${start.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })} - ${end.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}`,
        };
      });

      const count = formattedSlots.length;

      return {
        freeSlots: formattedSlots,
        count,
        searchCriteria: {
          durationMinutes,
          daysToSearch,
          workingHoursOnly,
        },
        message:
          count > 0
            ? `Found ${count} available slot(s) of ${durationMinutes} minutes or more.`
            : `No free slots of ${durationMinutes} minutes found in the next ${daysToSearch} days.`,
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
