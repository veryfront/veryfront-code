import type { CommandHelp } from "../../help/types.ts";

export const projectHelp: CommandHelp = {
  name: "project",
  aliases: ["projects"],
  category: "project",
  description: "Delete a cloud project and everything it owns",
  usage: "veryfront project <command> [options]",
  options: [
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
    "veryfront project delete",
    "veryfront project delete my-app --yes",
    "veryfront project delete my-app --force --json",
  ],
  notes: [
    "Subcommands: delete",
    "Deleting a project also removes its environments, releases, files, and uploads",
    "This is the scriptable counterpart to Studio's Settings -> Danger Zone -> Delete Project",
  ],
};
