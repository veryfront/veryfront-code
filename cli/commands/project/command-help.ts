import { RUNS_COMMANDS } from "./runs.ts";
import type { CommandHelp } from "../../help/types.ts";

export const projectHelp: CommandHelp = {
  name: "project",
  aliases: ["projects"],
  category: "project",
  description: "Manage cloud projects and SDK-backed runs",
  usage: "veryfront project <command> [options]",
  options: [
    {
      flag: "--accept-dispatch",
      description: "Accept a detached dispatch with heartbeat and its execution credential",
    },
    {
      flag: "--ndjson",
      description: "Stream paginated runs items as NDJSON envelopes on stdout",
    },
    {
      flag: "--project, -p <slug>",
      description: "Project slug override (otherwise inferred from env/config)",
    },
    {
      flag: "--force, -f",
      description: "Skip the delete confirmation prompt",
    },
    {
      flag: "--yes, -y",
      description: "Answer the confirmation prompt automatically (for CI)",
    },
    {
      flag: "--json, -j",
      description: "Output machine-readable JSON",
    },
  ],
  examples: [
    "veryfront project runs list --json",
    "veryfront project runs list --ndjson",
    "veryfront project runs get --run-id <RUN_ID> --json",
    "veryfront project runs stream --run-id <RUN_ID> --json",
    "veryfront project runs succeed --run-id <RUN_ID> --idempotency-key <KEY> --body '{\"output\":null}' --json",
    'veryfront project runs fail --run-id <RUN_ID> --idempotency-key <KEY> --body \'{"error":{"code":"TASK_FAILED","message":"Task failed"}}\' --json',
    "veryfront project delete",
    "veryfront project delete my-app --yes",
    "veryfront project delete my-app --force --json",
  ],
  notes: [
    "Subcommands: delete, runs",
    `Runs commands: ${Object.values(RUNS_COMMANDS).join(", ")}`,
    "Runs: supply route identifiers with --run-id, --event-id, --project-reference, --conversation-id, --webhook-definition-id, --eval-id, or --input-request-id.",
    "Runs: heartbeat --accept-dispatch atomically accepts the detached dispatch before execution. A duplicate returns 409.",
    "Runs: --body and --query accept contract JSON; --idempotency-key, --if-match and --last-event-id map to request headers.",
    "Runs: --ndjson follows SDK pagination and writes one success envelope per item to stdout with bounded memory; --output is not supported.",
    "Runs: --all follows SDK pagination; get/create --follow streams events. JSON streams use NDJSON on stdout.",
    "Runs: --credential-file supplies a scoped execution/event-writer token; --credential-mode api-key uses X-API-Key. The configured trusted API endpoint still applies.",
    "Runs: finalize, succeed and fail accept --terminal-token-file for matching execution terminal authority. Ordinary user/API-key calls do not need it.",
    "Deleting a project also removes its environments, releases, files, and uploads",
    "This is the scriptable counterpart to Studio's Settings -> Danger Zone -> Delete Project",
  ],
};
