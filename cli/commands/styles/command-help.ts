import type { CommandHelp } from "../../help/types.ts";

export const stylesHelp: CommandHelp = {
  name: "styles",
  hidden: true,
  category: "development",
  description: "Build project CSS artifacts",
  usage: "veryfront styles build-artifact --config <json>",
  options: [
    {
      flag: "--config <json>",
      description:
        "JSON build config with css_pipeline_identity, style_profile_hash, and exactly one branch, environment_name, or release_id selector",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    'veryfront styles build-artifact --config \'{"css_pipeline_identity":"[\\"veryfront.css-pipeline.v1\\",\\"compiler@1\\",\\"optimizer@1\\"]","style_profile_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","branch":"main"}\'',
    'veryfront styles build-artifact --config \'{"css_pipeline_identity":"[\\"veryfront.css-pipeline.v1\\",\\"compiler@1\\",\\"optimizer@1\\"]","style_profile_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","environment_name":"Production"}\'',
  ],
};
