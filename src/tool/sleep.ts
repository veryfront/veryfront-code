import { z } from "zod";
import { tool } from "./factory.ts";

export const DEFAULT_SLEEP_TOOL_MAX_SECONDS = 60;

export type SleepToolWait = (milliseconds: number) => Promise<void> | void;

export type CreateSleepToolOptions = {
  maxSeconds?: number;
  wait?: SleepToolWait;
};

const defaultSleepToolWait: SleepToolWait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function createSleepToolInputSchema(maxSeconds: number) {
  return z.object({
    seconds: z.number().min(1).max(maxSeconds).describe(
      `Number of seconds to wait (1-${maxSeconds})`,
    ),
  });
}

export type SleepToolInput = z.infer<ReturnType<typeof createSleepToolInputSchema>>;

export type SleepToolOutput = {
  sleptFor: number;
  message: string;
};

export function createSleepTool(options: CreateSleepToolOptions = {}) {
  const maxSeconds = options.maxSeconds ?? DEFAULT_SLEEP_TOOL_MAX_SECONDS;
  const wait = options.wait ?? defaultSleepToolWait;

  return tool<SleepToolInput, SleepToolOutput>({
    id: "sleep",
    description:
      `Wait for a specified number of seconds before continuing. Use this when a task needs to pause execution, such as waiting for an external process to complete or adding a delay between operations. Maximum sleep time is ${maxSeconds} seconds.`,
    inputSchema: createSleepToolInputSchema(maxSeconds),
    execute: async ({ seconds }) => {
      const clampedSeconds = Math.min(Math.max(1, seconds), maxSeconds);
      await wait(clampedSeconds * 1000);
      return {
        sleptFor: clampedSeconds,
        message: `Waited for ${clampedSeconds} second${clampedSeconds === 1 ? "" : "s"}`,
      };
    },
  });
}

export const sleepTool = createSleepTool();
