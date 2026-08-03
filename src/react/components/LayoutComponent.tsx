import type React from "react";
import type { MdxBundle, MDXComponents, PageContext as TypedPageContext } from "#veryfront/types";
import { rejectSynchronousMdxWrapper } from "./mdx-wrapper-error.ts";

export type { MdxBundle } from "#veryfront/types";

interface LayoutComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
  pageContext?: TypedPageContext;
}

export function LayoutComponent(
  _props: LayoutComponentProps,
): React.ReactElement {
  return rejectSynchronousMdxWrapper("layout");
}
