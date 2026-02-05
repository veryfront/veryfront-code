import type { CommandHelp } from "../../help/types.ts";

export const doctorHelp: CommandHelp = {
  name: "doctor",
  description: "Check system requirements and project health",
  usage: "veryfront doctor [options]",
  options: [
    {
      flag: "-s, --strict",
      description: "Treat warnings as errors",
    },
  ],
  examples: ["veryfront doctor", "veryfront doctor --strict"],
};
