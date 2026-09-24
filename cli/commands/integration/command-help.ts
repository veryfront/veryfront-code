import type { CommandHelp } from "../../help/types.ts";
export const integrationHelp: CommandHelp = {
  name: "integration",
  category: "deploy",
  description: "Discover, connect, inspect, and call project integration tools",
  usage: "veryfront integration <list|get|connections|tools|status|connect|call> [name] [options]",
  options: [
    {
      flag: "-p, --project <ref>",
      description: "Project UUID or slug (default: linked/configured project)",
    },
    {
      flag: "-d, --dir <path>",
      description: "Project directory; local modules are never executed",
    },
    {
      flag: "--scope <user|project>",
      description: "Connect/status ownership scope (default: user)",
    },
    {
      flag: "--tool <integration__tool_id>",
      description: "Inspect selected-tool readiness with status; metadata only, no provider call",
    },
    { flag: "--connection <uuid>", description: "Exact visible connection for call or status" },
    {
      flag: "--expected-generation <uuid>",
      description:
        "Require the observed connection generation for call or status --tool; requires --connection and API support",
    },
    { flag: "--args <json>", description: "Native JSON object arguments for one tool call" },
    { flag: "--search <text>", description: "Catalog search or tool-name filter" },
    {
      flag: "--no-browser",
      description: "Return a headless OAuth handoff without waiting or claiming connection",
    },
    {
      flag: "--redirect-uri <uri>",
      description: "Explicit OAuth return URI, required with --no-browser",
    },
    {
      flag: "--timeout <seconds>",
      description: "Local interactive callback wait (default: 300, maximum: 3600)",
    },
    { flag: "-j, --json", description: "Machine-readable envelope; does not disable the browser" },
  ],
  examples: [
    "veryfront integration list --project my-app",
    "veryfront integration connect github",
    "veryfront integration connections github --json",
    "veryfront integration tools github",
    "veryfront integration call github__get_current_user --args '{}' --json",
    "veryfront integration connect github --no-browser --redirect-uri veryfront:callback --json",
  ],
  notes: [
    "Requires an existing platform login or trusted API credential; this command does not launch a second platform login.",
    "Calls run once. No automatic tool replay or execution after connect.",
    "Status and connection inventory describe observed connectivity, not provider permissions or executable readiness.",
    "Non-OAuth integrations return catalog setup requirements for the existing project environment workflow.",
    "expires_at is the one-time browser handoff deadline, not the duration of provider consent. Headless URLs are sensitive and cannot use --output.",
  ],
};
