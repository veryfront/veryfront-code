import { tool } from "veryfront/tool";
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

    return branches.map(
      ({
        id,
        project_id,
        name,
        current_state,
        pending_state,
        primary,
        default: isDefault,
        protected: isProtected,
        parent_id,
        parent_lsn,
        parent_timestamp,
        logical_size,
        created_at,
        updated_at,
        cpu_used_sec,
        compute_time_sec,
        active_time_sec,
      }) => ({
        id,
        projectId: project_id,
        name,
        currentState: current_state,
        pendingState: pending_state,
        primary,
        default: isDefault,
        protected: isProtected,
        parentId: parent_id,
        parentLsn: parent_lsn,
        parentTimestamp: parent_timestamp,
        logicalSize: logical_size,
        createdAt: created_at,
        updatedAt: updated_at,
        cpuUsedSec: cpu_used_sec,
        computeTimeSec: compute_time_sec,
        activeTimeSec: active_time_sec,
      }),
    );
  },
});
