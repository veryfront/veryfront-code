import { tool } from "veryfront/tool";
import { z } from "zod";
import { listRooms } from "../../lib/webex-client.ts";

export default tool({
  id: "list-rooms",
  description:
    "List Webex spaces/rooms. Can filter by type (direct messages or group spaces).",
  inputSchema: z.object({
    max: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of rooms to return"),
    type: z
      .enum(["direct", "group"])
      .optional()
      .describe(
        "Filter by room type: 'direct' for 1:1 conversations, 'group' for team spaces",
      ),
    sortBy: z
      .enum(["id", "lastactivity", "created"])
      .default("lastactivity")
      .describe("Sort rooms by id, lastactivity, or created date"),
  }),
  async execute({ max, type, sortBy }) {
    const rooms = await listRooms({ max, type, sortBy });

    return rooms.map(
      ({ id, title, type, isLocked, lastActivity, created }) => ({
        id,
        title,
        type,
        isLocked,
        lastActivity,
        created,
      }),
    );
  },
});
