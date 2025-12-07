/**
 * List ServiceNow Incidents Tool
 */

import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getServiceNowClient } from "../../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "servicenow-list-incidents",
  description:
    "List incidents from ServiceNow with optional filters for state, priority, or search query",
  inputSchema: z.object({
    limit: z.number().optional().describe("Maximum number of incidents to return (default: 20)"),
    state: z.enum(["new", "in_progress", "on_hold", "resolved", "closed"]).optional()
      .describe("Filter by incident state"),
    priority: z.enum(["1", "2", "3", "4", "5"]).optional()
      .describe("Filter by priority (1=Critical, 2=High, 3=Moderate, 4=Low, 5=Planning)"),
    query: z.string().optional().describe("Search query for incident short description"),
  }),
  async execute(input) {
    const connected = await isServiceNowConnected();
    if (!connected) {
      return {
        error: "ServiceNow not connected",
        action: "Please connect ServiceNow via /api/auth/servicenow",
      };
    }

    try {
      const client = getServiceNowClient();

      // Map state names to ServiceNow state values
      const stateMap: Record<string, string> = {
        new: "1",
        in_progress: "2",
        on_hold: "3",
        resolved: "6",
        closed: "7",
      };

      const incidents = await client.listIncidents({
        limit: input.limit,
        state: input.state ? stateMap[input.state] : undefined,
        priority: input.priority,
        query: input.query,
      });

      return {
        count: incidents.length,
        incidents: incidents.map((inc) => ({
          number: inc.number,
          short_description: inc.short_description,
          state: inc.state,
          priority: inc.priority,
          urgency: inc.urgency,
          impact: inc.impact,
          assigned_to: typeof inc.assigned_to === "object"
            ? inc.assigned_to.display_value
            : inc.assigned_to,
          opened_at: inc.opened_at,
          sys_id: inc.sys_id,
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to list incidents",
      };
    }
  },
});
