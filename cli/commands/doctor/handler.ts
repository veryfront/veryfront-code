/**
 * Doctor command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { cwd } from "veryfront/platform";
import { doctorCommand } from "./index.ts";
import { showLogo } from "#cli/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getDoctorArgsSchema = defineSchema((v) =>
  v.object({
    strict: v.boolean().default(false),
    port: v.number().optional(),
  })
);

const DoctorArgsSchema = lazySchema(getDoctorArgsSchema);

export const parseDoctorArgs = createArgParser(DoctorArgsSchema, {
  strict: { keys: ["strict", "s"], type: "boolean" },
  port: { keys: ["port", "p"], type: "number" },
});

export async function handleDoctorCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await doctorCommand(cwd(), parseArgsOrThrow(parseDoctorArgs, "doctor", args));
}
