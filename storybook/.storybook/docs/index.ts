// Veryfront docs kit — single-page component docs in the Studio format:
// a DocsPage layout wrapper -> DocsHero -> stacked DocsSections with
// Preview/Code examples -> DocsComposition tree -> DocsPropsTable API table.
//
// Stories import from this barrel:  from '../../.storybook/docs'
export { DocsArrowLink } from "./DocsArrowLink";
export { DocsCode } from "./DocsCode";
export { DocsComposition } from "./DocsComposition";
export { DocsExample } from "./DocsExample";
export { DocsExampleAuto, extractSource } from "./DocsExampleAuto";
export { DocsHero } from "./DocsHero";
// The Studio *layout wrapper* DocsPage — the one consumers compose pages with.
// (The autodocs-template page used by preview.tsx lives in ./DocsPage.tsx as
// DocsAutodocsPage and is intentionally not re-exported here.)
export { DocsPage } from "./DocsLayout";
export { DocsPropsTable } from "./DocsPropsTable";
export { DocsSection } from "./DocsSection";
export { DocsSurface, type DocsSurfaceProps } from "./DocsSurface";
export {
  DocsBlockquote,
  DocsCodeInline,
  DocsH2,
  DocsH3,
  DocsH4,
  DocsHr,
  DocsLi,
  DocsOl,
  DocsP,
  docsMarkdownComponents,
  DocsStrong,
  DocsTable,
  DocsTbody,
  DocsTd,
  DocsTh,
  DocsThead,
  DocsTr,
  DocsUl,
  renderInlineCode,
} from "./markdown";
export { composeJsx, formatArgsProps, resolveArgsSpread } from "./composeJsx";
export {
  transformStorySource,
  transformVeryfrontStorySource,
} from "./transformStorySource";
