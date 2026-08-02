import type * as React from "react";
import type { MDXComponents } from "#veryfront/types";
import type { MdxBundle } from "./LayoutComponent.tsx";
import { rejectSynchronousMdxWrapper } from "./mdx-wrapper-error.ts";

interface ProviderComponentProps {
  mdxBundle: MdxBundle;
  children: React.ReactNode;
  components?: MDXComponents;
}

export function ProviderComponent(
  _props: ProviderComponentProps,
): React.ReactElement {
  return rejectSynchronousMdxWrapper("provider");
}
