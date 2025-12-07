import { tool } from "veryfront/ai";
import { z } from "zod";
import { listCalls, formatPhoneNumber } from "../../lib/twilio-client.ts";

export default tool({
  id: "list-calls",
  description: "List recent phone calls from your Twilio account. Supports filtering by recipient, sender, status, and date.",
  inputSchema: z.object({
    to: z
      .string()
      .optional()
      .describe("Filter by recipient phone number in E.164 format (e.g., +14155552671)"),
    from: z
      .string()
      .optional()
      .describe("Filter by sender phone number in E.164 format (e.g., +14155552671)"),
    status: z
      .enum([
        "queued",
        "ringing",
        "in-progress",
        "completed",
        "busy",
        "failed",
        "no-answer",
        "canceled",
      ])
      .optional()
      .describe("Filter by call status"),
    startTime: z
      .string()
      .optional()
      .describe("Filter by start time in YYYY-MM-DD format (e.g., 2024-01-15)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of calls to return (default: 20, max: 100)"),
  }),
  execute: async ({ to, from, status, startTime, limit }) => {
    try {
      const options: {
        to?: string;
        from?: string;
        status?: "queued" | "ringing" | "in-progress" | "completed" | "busy" | "failed" | "no-answer" | "canceled";
        startTime?: string;
        limit?: number;
      } = {};

      if (to) {
        options.to = formatPhoneNumber(to);
      }

      if (from) {
        options.from = formatPhoneNumber(from);
      }

      if (status) {
        options.status = status;
      }

      if (startTime) {
        options.startTime = startTime;
      }

      if (limit) {
        options.limit = limit;
      }

      const calls = await listCalls(options);

      if (calls.length === 0) {
        return {
          success: true,
          count: 0,
          calls: [],
          message: "No calls found matching the criteria.",
        };
      }

      // Format calls for better readability
      const formattedCalls = calls.map((call) => ({
        sid: call.sid,
        direction: call.direction,
        from: call.from,
        to: call.to,
        status: call.status,
        startTime: call.start_time,
        endTime: call.end_time,
        duration: call.duration ? `${call.duration} seconds` : null,
        dateCreated: call.date_created,
        dateUpdated: call.date_updated,
        price: call.price ? `${call.price} ${call.price_unit}` : null,
        answeredBy: call.answered_by,
      }));

      // Calculate statistics
      const totalDuration = calls.reduce((sum, call) => {
        return sum + (call.duration ? parseInt(call.duration, 10) : 0);
      }, 0);

      const statusCounts = calls.reduce((acc, call) => {
        acc[call.status] = (acc[call.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        success: true,
        count: calls.length,
        calls: formattedCalls,
        statistics: {
          totalCalls: calls.length,
          totalDuration: `${totalDuration} seconds (${Math.round(totalDuration / 60)} minutes)`,
          statusBreakdown: statusCounts,
        },
        message: `Found ${calls.length} call${calls.length === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not configured")) {
        return {
          error: "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
          setupUrl: "https://console.twilio.com/",
        };
      }
      throw error;
    }
  },
});
