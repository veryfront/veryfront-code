import { tool } from "veryfront/tool";
import { z } from "zod";
import { createCalendarClient } from "../../lib/calendar-client.ts";

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
  execute: async ({ durationMinutes, daysToSearch, workingHoursOnly }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const calendar = createCalendarClient(userId);

      const now = new Date();
      const searchEnd = new Date();
      searchEnd.setDate(searchEnd.getDate() + (daysToSearch ?? 7));

      type FreeSlot = { start: Date; end: Date };
      const freeSlots = (await calendar.findFreeSlots({
        timeMin: now,
        timeMax: searchEnd,
        durationMinutes: durationMinutes ?? 60,
      })) as FreeSlot[];

      // Filter to working hours if requested
      let filteredSlots = freeSlots;
      if (workingHoursOnly) {
        filteredSlots = freeSlots.filter((slot: FreeSlot) => {
          const startHour = slot.start.getHours();
          const endHour = slot.end.getHours();
          return startHour >= 9 && endHour <= 18;
        });
      }

      // Format slots for display
      const formattedSlots = filteredSlots.slice(0, 10).map((slot: FreeSlot) => {
        const duration = Math.round(
          (slot.end.getTime() - slot.start.getTime()) / (1000 * 60),
        );
        return {
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          durationMinutes: duration,
          date: slot.start.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          timeRange: `${
            slot.start.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
          } - ${
            slot.end.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
          }`,
        };
      });

      return {
        freeSlots: formattedSlots,
        count: formattedSlots.length,
        searchCriteria: {
          durationMinutes,
          daysToSearch,
          workingHoursOnly,
        },
        message: formattedSlots.length > 0
          ? `Found ${formattedSlots.length} available slot(s) of ${durationMinutes} minutes or more.`
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
