/**
 * Doctor command handler
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { doctorCommand } from "./index.ts";
import { showLogo } from "#cli/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const DoctorArgsSchema = z.object({
  strict: z.boolean().default(false),
});

export const parseDoctorArgs = createArgParser(DoctorArgsSchema, {
  strict: { keys: ["strict", "s"], type: "boolean" },
});

export async function handleDoctorCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await doctorCommand(cwd(), parseArgsOrThrow(parseDoctorArgs, "doctor", args));
}
