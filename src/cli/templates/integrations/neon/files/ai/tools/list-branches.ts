import { tool } from "veryfront/ai";
import { z } from "zod";
import { listBranches } from "../../lib/neon-client.ts";

export default tool({
  id: "list-branches",
  description:
    "List all branches for a specific Neon project. Branches are isolated database environments that can be created from any point in time.",
  inputSchema: z.object({
    projectId: z.string().describe("The ID of the Neon project"),
  }),
  async execute({ projectId }) {
    const branches = await listBranches(projectId);

    return branches.map((branch) => ({
      id: branch.id,
      projectId: branch.project_id,
      name: branch.name,
      currentState: branch.current_state,
      pendingState: branch.pending_state,
      primary: branch.primary,
      default: branch.default,
      protected: branch.protected,
      parentId: branch.parent_id,
      parentLsn: branch.parent_lsn,
      parentTimestamp: branch.parent_timestamp,
      logicalSize: branch.logical_size,
      createdAt: branch.created_at,
      updatedAt: branch.updated_at,
      cpuUsedSec: branch.cpu_used_sec,
      computeTimeSec: branch.compute_time_sec,
      activeTimeSec: branch.active_time_sec,
    }));
  },
});
