import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { resolveUserId } from "../lib/context.ts";

const THREAD_FORMATS = ["full", "metadata", "minimal"] as const;

export default tool({
  id: "gmail-get-thread",
  description: "Get a Gmail thread by ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      threadId: v.string().min(1).describe("Gmail thread ID"),
      format: v.enum(["full", "metadata", "minimal"]).default("full").describe(
        "Thread message format",
      ),
    })
  )(),
  execute: async ({ threadId, format }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.getThread(
        threadId,
        requireAllowedValue(format, THREAD_FORMATS, "format"),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Gmail not connected. Please connect your Gmail account.",
          connectUrl: "/api/auth/gmail",
        };
      }
      throw error;
    }
  },
});
