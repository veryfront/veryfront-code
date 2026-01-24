/**
 * Get ServiceNow Incident Tool
 */

import { z } from "zod";
import { getServiceNowClient } from "../../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../../lib/token-store.ts";

function getDisplayValue(value: unknown): unknown {
  if (value && typeof value === "object" && "display_value" in value) {
    return (value as { display_value: unknown }).display_value;
  }
  return value;
}

export default defineTool({
  id: "servicenow-get-incident",
  description:
    "Get details of a specific ServiceNow incident by number (e.g., INC0010001) or sys_id",
  inputSchema: z.object({
    id: z.string().describe("Incident number (INC0010001) or sys_id"),
  }),
  async execute(input) {
    if (!(await isServiceNowConnected())) {
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
        assigned_to: getDisplayValue(incident.assigned_to),
        caller_id: getDisplayValue(incident.caller_id),
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
