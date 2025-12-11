
import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getServiceNowClient } from "../../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "servicenow-get-incident",
  description:
    "Get details of a specific ServiceNow incident by number (e.g., INC0010001) or sys_id",
  inputSchema: z.object({
    id: z.string().describe("Incident number (INC0010001) or sys_id"),
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
      const incident = await client.getIncident(input.id);

      return {
        number: incident.number,
        sys_id: incident.sys_id,
        short_description: incident.short_description,
        description: incident.description,
        state: incident.state,
        priority: incident.priority,
        urgency: incident.urgency,
        impact: incident.impact,
        category: incident.category,
        subcategory: incident.subcategory,
        assigned_to: typeof incident.assigned_to === "object"
          ? incident.assigned_to.display_value
          : incident.assigned_to,
        caller_id: typeof incident.caller_id === "object"
          ? incident.caller_id.display_value
          : incident.caller_id,
        opened_at: incident.opened_at,
        resolved_at: incident.resolved_at,
        closed_at: incident.closed_at,
        created: incident.sys_created_on,
        updated: incident.sys_updated_on,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to get incident",
      };
    }
  },
});
