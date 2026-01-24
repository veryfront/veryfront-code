import { z } from "zod";
import { getServiceNowClient } from "../../lib/servicenow-client.ts";
import { isServiceNowConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "servicenow-create-incident",
  description: "Create a new incident in ServiceNow",
  inputSchema: z.object({
    short_description: z.string().describe("Brief description of the incident"),
    description: z.string().optional().describe("Detailed description of the incident"),
    urgency: z
      .enum(["1", "2", "3"])
      .optional()
      .describe("Urgency level (1=High, 2=Medium, 3=Low)"),
    impact: z
      .enum(["1", "2", "3"])
      .optional()
      .describe("Impact level (1=High, 2=Medium, 3=Low)"),
    category: z.string().optional().describe("Incident category"),
    subcategory: z.string().optional().describe("Incident subcategory"),
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
