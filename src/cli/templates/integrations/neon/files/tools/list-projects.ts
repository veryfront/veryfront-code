import { tool } from "veryfront/tool";
import { z } from "zod";
import { listProjects } from "../../lib/neon-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all Neon projects in your account. Returns project details including name, region, PostgreSQL version, and creation date.",
  inputSchema: z.object({}),
  async execute() {
    const projects = await listProjects();

    return projects.map((project) => {
      const settings = project.default_endpoint_settings;

      return {
        id: project.id,
        name: project.name,
        region: project.region_id,
        pgVersion: project.pg_version,
        proxyHost: project.proxy_host,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        cpuUsedSec: project.cpu_used_sec,
        autoscaling: settings
          ? {
              minCu: settings.autoscaling_limit_min_cu,
              maxCu: settings.autoscaling_limit_max_cu,
              suspendTimeout: settings.suspend_timeout_seconds,
            }
          : undefined,
      };
    });
  },
});
