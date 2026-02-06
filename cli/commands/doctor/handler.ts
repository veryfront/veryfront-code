/**
 * Doctor command handler
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { doctorCommand } from "./index.ts";
import { showLogo } from "../../utils/index.ts";
import { createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DoctorArgsSchema = z.object({
  strict: z.boolean().default(false),
});

export const parseDoctorArgs = createArgParser(DoctorArgsSchema, {
  strict: { keys: ["strict", "s"], type: "boolean" },
});

export async function handleDoctorCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseDoctorArgs(args);
  if (!result.success) {
    throw new Error(`Invalid doctor arguments: ${result.error.message}`);
  }
  await doctorCommand(cwd(), result.data);
}
