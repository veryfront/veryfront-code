import { tool } from "veryfront/ai";
import { z } from "zod";
import { listProjects } from "../../lib/neon-client.ts";

export default tool({
  id: "list-projects",
  description:
    "List all Neon projects in your account. Returns project details including name, region, PostgreSQL version, and creation date.",
  inputSchema: z.object({}),
  async execute() {
    const projects = await listProjects();

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      region: project.region_id,
      pgVersion: project.pg_version,
      proxyHost: project.proxy_host,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      cpuUsedSec: project.cpu_used_sec,
      autoscaling: project.default_endpoint_settings
        ? {
          minCu: project.default_endpoint_settings.autoscaling_limit_min_cu,
          maxCu: project.default_endpoint_settings.autoscaling_limit_max_cu,
          suspendTimeout: project.default_endpoint_settings.suspend_timeout_seconds,
        }
        : undefined,
    }));
  },
});
