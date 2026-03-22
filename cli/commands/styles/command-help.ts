import type { CommandHelp } from "../../help/types.ts";

export const stylesHelp: CommandHelp = {
  name: "styles",
  description: "Build project CSS artifacts",
  usage: "veryfront styles build-artifact --config <json>",
  options: [
    {
      flag: "--config <json>",
      description: "JSON build config with exactly one selector and an optional style_profile_hash",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    'veryfront styles build-artifact --config \'{"branch":"main"}\'',
    'veryfront styles build-artifact --config \'{"style_profile_hash":"profile-1","environment_name":"Production"}\'',
  ],
};
