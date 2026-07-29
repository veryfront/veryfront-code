import type {
  HtmlHeadLocationResult,
  HTMLHeadLocator,
  MaxHTMLHeadParseBytes,
} from "veryfront/extensions/parser";
import { utf8LengthWithinLimit } from "./utf8-limit.ts";

export const PARSER_MAX_HTML_HEAD_PARSE_BYTES = 8_388_608 satisfies MaxHTMLHeadParseBytes;

const CONSERVATIVE_LOCATION = {
  ok: true,
  placement: {
    contentStart: 0,
    importMapInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    endInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    importMapPreludeEndOffset: 0,
    moduleResolutionOrdering: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    authoredImportMapState: {
      status: "invalid",
      reason: "unusable-element",
    },
    hasLocatedStartTag: false,
    hasLocatedEndTag: false,
  },
} as const satisfies HtmlHeadLocationResult;

export class Parse5HTMLHeadLocator implements HTMLHeadLocator {
  locate(html: string): HtmlHeadLocationResult {
    if (!utf8LengthWithinLimit(html, PARSER_MAX_HTML_HEAD_PARSE_BYTES).ok) {
      return { ok: false, reason: "input-too-large" };
    }

    return CONSERVATIVE_LOCATION;
  }
}
