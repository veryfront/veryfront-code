import { tool } from "veryfront/tool";
import { z } from "zod";
import { updateTask } from "../../lib/clickup-client.ts";

export default tool({
  id: "update-task",
  description: "Update an existing ClickUp task.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to update"),
    name: z.string().optional().describe("New name/title for the task"),
    description: z.string().optional().describe("New description for the task"),
    status: z.string().optional().describe("New status name for the task"),
    priority: z.number().min(1).max(4).optional().describe(
      "Priority level: 1 (urgent), 2 (high), 3 (normal), 4 (low). Use null to remove priority.",
    ),
    dueDate: z.number().optional().describe(
      "Due date in Unix timestamp (milliseconds). Use null to remove due date.",
    ),
    startDate: z.number().optional().describe(
      "Start date in Unix timestamp (milliseconds). Use null to remove start date.",
    ),
    timeEstimate: z.number().optional().describe(
      "Time estimate in milliseconds. Use null to remove time estimate.",
    ),
    addAssignees: z.array(z.number()).optional().describe("Array of user IDs to add as assignees"),
    removeAssignees: z.array(z.number()).optional().describe("Array of user IDs to remove from assignees"),
    archived: z.boolean().optional().describe("Archive or unarchive the task"),
    customTaskIds: z.boolean().default(false).describe(
      "Use custom task IDs instead of internal IDs",
    ),
    teamId: z.string().optional().describe("Team ID (required when using custom task IDs)"),
  }),
  async execute({
    taskId,
    name,
    description,
    status,
    priority,
    dueDate,
    startDate,
    timeEstimate,
    addAssignees,
    removeAssignees,
    archived,
    customTaskIds,
    teamId,
  }) {
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (dueDate !== undefined) updates.dueDate = dueDate;
    if (startDate !== undefined) updates.startDate = startDate;
    if (timeEstimate !== undefined) updates.timeEstimate = timeEstimate;
    if (archived !== undefined) updates.archived = archived;

    if (addAssignees || removeAssignees) {
      updates.assignees = {
        ...(addAssignees && { add: addAssignees }),
        ...(removeAssignees && { rem: removeAssignees }),
      };
    }

    const task = await updateTask(
      taskId,
      updates,
      customTaskIds ? { customTaskIds, teamId } : undefined,
    );

    return {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        status: task.status.status,
        dueDate: task.due_date ? new Date(parseInt(task.due_date)).toISOString() : null,
        priority: task.priority?.priority || "none",
        assignees: task.assignees.map((a) => a.username),
        url: `https://app.clickup.com/t/${task.id}`,
      },
    };
  },
});
