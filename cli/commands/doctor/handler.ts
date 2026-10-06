/**
 * Doctor command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { cwd } from "veryfront/platform";
import { doctorCommand } from "./index.ts";
import { showHeader } from "#cli/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { isJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "#cli/shared/types";

const getDoctorArgsSchema = defineSchema((v) =>
  v.object({
    strict: v.boolean().default(false),
    port: v.number().int().min(1).max(65535).optional(),
  })
);

const DoctorArgsSchema = lazySchema(getDoctorArgsSchema);

export const parseDoctorArgs = createArgParser(DoctorArgsSchema, {
  strict: { keys: ["strict", "s"], type: "boolean" },
  port: { keys: ["port", "p"], type: "number" },
}, { rejectUnknown: true });

export async function handleDoctorCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseDoctorArgs, "doctor", args);
  if (!isJsonMode()) showHeader();
  await doctorCommand(cwd(), opts);
}
