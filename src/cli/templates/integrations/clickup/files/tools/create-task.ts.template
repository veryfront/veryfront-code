import { tool } from "veryfront/tool";
import { z } from "zod";
import { createTask } from "../../lib/clickup-client.ts";

export default tool({
  id: "create-task",
  description: "Create a new task in a ClickUp list.",
  inputSchema: z.object({
    listId: z.string().describe("The ID of the list to create the task in"),
    name: z.string().describe("The name/title of the task"),
    description: z.string().optional().describe("Description or details for the task"),
    assignees: z.array(z.number()).optional().describe("Array of user IDs to assign the task to"),
    tags: z.array(z.string()).optional().describe("Array of tag names to add to the task"),
    status: z.string().optional().describe("Status name for the task"),
    priority: z
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe("Priority level: 1 (urgent), 2 (high), 3 (normal), 4 (low)"),
    dueDate: z.number().optional().describe("Due date in Unix timestamp (milliseconds)"),
    startDate: z.number().optional().describe("Start date in Unix timestamp (milliseconds)"),
    timeEstimate: z.number().optional().describe("Time estimate in milliseconds"),
    notifyAll: z.boolean().default(false).describe("Notify all assignees when task is created"),
  }),
  async execute(input) {
    const task = await createTask(input);

    return {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        status: task.status.status,
        dueDate: task.due_date ? new Date(Number(task.due_date)).toISOString() : null,
        priority: task.priority?.priority ?? "none",
        assignees: task.assignees.map((a) => a.username),
        list: task.list.name,
        url: `https://app.clickup.com/t/${task.id}`,
      },
    };
  },
});
