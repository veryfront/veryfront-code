/** Stable runtime identifier for the HTML head locator extension contract. */
export const HTMLHeadLocatorName = "HTMLHeadLocator" as const;

/** Maximum UTF-8 input size accepted by HTML head locator implementations. */
export const MAX_HTML_HEAD_PARSE_BYTES = 8_388_608 as const;

/** Literal type shared by implementations that enforce the parse-size limit. */
export type MaxHTMLHeadParseBytes = typeof MAX_HTML_HEAD_PARSE_BYTES;

/** A source offset at which generated head content can safely be inserted. */
export type HtmlHeadInsertionPoint =
  | { readonly status: "available"; readonly offset: number }
  | {
    readonly status: "unavailable";
    readonly reason: "unsafe-insertion-state";
  };

/** Ordering information for module-resolution consumers in the document head. */
export type HtmlModuleResolutionOrdering =
  | { readonly status: "known"; readonly firstConsumerStartOffset?: number }
  | {
    readonly status: "unavailable";
    readonly reason: "unsafe-insertion-state";
  };

/** State of import maps authored in the parsed document. */
export type AuthoredImportMapState =
  | { readonly status: "absent" }
  | {
    readonly status: "valid";
    readonly count: number;
    readonly lastProcessingEndOffset: number;
  }
  | {
    readonly status: "invalid";
    readonly reason:
      | "unusable-element"
      | "invalid-json"
      | "invalid-shape"
      | "input-too-complex";
  };

/** Syntax-aware insertion placement derived from a parsed HTML document. */
export interface HtmlHeadPlacement {
  readonly contentStart: number;
  readonly importMapInsertion: HtmlHeadInsertionPoint;
  readonly endInsertion: HtmlHeadInsertionPoint;
  readonly importMapPreludeEndOffset: number;
  readonly moduleResolutionOrdering: HtmlModuleResolutionOrdering;
  readonly firstBodyOrFramesetSourceOffset?: number;
  readonly authoredImportMapState: AuthoredImportMapState;
  readonly hasLocatedStartTag: boolean;
  readonly hasLocatedEndTag: boolean;
}

/** Result of locating safe HTML head insertion positions. */
export type HtmlHeadLocationResult =
  | { readonly ok: true; readonly placement: HtmlHeadPlacement }
  | {
    readonly ok: false;
    readonly reason: "input-too-large" | "input-too-complex";
  };

/** Dependency-free contract implemented by HTML parser extensions. */
export interface HTMLHeadLocator {
  locate(html: string): HtmlHeadLocationResult;
}
