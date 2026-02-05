/**
 * Doctor command handler
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { doctorCommand } from "./index.ts";
import { showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleDoctorCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await doctorCommand(cwd(), { strict: Boolean(args.strict || args.s) });
}
