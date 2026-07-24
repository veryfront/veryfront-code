import { register, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import type { CodeParser } from "./code-parser.ts";

type DefaultParserModule = {
  BabelCodeParser: new () => CodeParser;
};

/**
 * Lazily register the first-party CodeParser implementation when it is
 * available from workspace source or an installed @veryfront/ext package.
 */
export async function ensureDefaultParserContracts(): Promise<void> {
  if (tryResolve("CodeParser")) return;

  try {
    const { BabelCodeParser } = await importFirstPartyExtensionModule<DefaultParserModule>(
      "ext-parser-babel",
      "@veryfront/ext-parser-babel",
    );

    if (!tryResolve("CodeParser")) register("CodeParser", new BabelCodeParser());
  } catch (error) {
    if (
      !isMissingFirstPartyExtensionModule(error, [
        "extensions/ext-parser-babel/src/index",
        "@veryfront/ext-parser-babel",
      ])
    ) {
      throw error;
    }
  }
}
