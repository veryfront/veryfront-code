import { defineSchema } from "veryfront/schemas";
import { getServiceNowClient } from "../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../lib/token-store.ts";

export default defineTool({
  id: "servicenow-update-incident",
  description: "Update an existing incident in ServiceNow",
  inputSchema: defineSchema((v) => v.object({
    sys_id: v.string().describe("The sys_id of the incident to update"),
    state: v
      .enum(["1", "2", "3", "6", "7"])
      .optional()
      .describe("New state (1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed)"),
    short_description: v.string().optional().describe("Updated short description"),
    description: v.string().optional().describe("Updated description"),
    urgency: v
      .enum(["1", "2", "3"])
      .optional()
      .describe("Updated urgency (1=High, 2=Medium, 3=Low)"),
    impact: v
      .enum(["1", "2", "3"])
      .optional()
      .describe("Updated impact (1=High, 2=Medium, 3=Low)"),
    work_notes: v.string().optional().describe("Add work notes to the incident"),
    close_notes: v.string().optional().describe("Close notes (required when closing)"),
  }))(),
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
      const { sys_id, ...updateData } = input;

      const cleanData = Object.fromEntries(
        Object.entries(updateData).filter(([, value]) => value !== undefined),
      );

      const incident = await client.updateIncident(sys_id, cleanData);

      return {
        success: true,
        number: incident.number,
        sys_id: incident.sys_id,
        state: incident.state,
        updated: incident.sys_updated_on,
        message: `Incident ${incident.number} updated successfully`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to update incident",
      };
    }
  },
});
