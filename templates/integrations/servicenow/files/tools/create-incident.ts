import { defineSchema } from "veryfront/schemas";
import { getServiceNowClient } from "../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../lib/token-store.ts";

export default defineTool({
  id: "servicenow-create-incident",
  description: "Create a new incident in ServiceNow",
  inputSchema: defineSchema((v) => v.object({
    short_description: v.string().describe("Brief description of the incident"),
    description: v.string().optional().describe("Detailed description of the incident"),
    urgency: v
      .enum(["1", "2", "3"])
      .optional()
      .describe("Urgency level (1=High, 2=Medium, 3=Low)"),
    impact: v
      .enum(["1", "2", "3"])
      .optional()
      .describe("Impact level (1=High, 2=Medium, 3=Low)"),
    category: v.string().optional().describe("Incident category"),
    subcategory: v.string().optional().describe("Incident subcategory"),
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
      const incident = await client.createIncident(input);

      return {
        success: true,
        number: incident.number,
        sys_id: incident.sys_id,
        short_description: incident.short_description,
        state: incident.state,
        priority: incident.priority,
        message: `Incident ${incident.number} created successfully`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to create incident",
      };
    }
  },
});
