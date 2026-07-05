import LinkTo from "@storybook/addon-links/react";
import type * as React from "react";
import { ArrowRight } from "./icons";
import { cn } from "./cn";

type Size = "sm" | "md";

interface DocsArrowLinkBaseProps {
  /** Link label shown before the arrow. */
  children: React.ReactNode;
  /** `'sm'` (text-sm — inline next to headings) or `'md'` (text-base — hero/section). Defaults to `'md'`. */
  size?: Size;
  className?: string;
}

interface DocsArrowLinkInternalProps extends DocsArrowLinkBaseProps {
  /** Storybook story `kind` (kebab-case title path). e.g. `veryfront-ui-chat` */
  kind: string;
  /** Storybook story id within that kind. Defaults to `docs`. */
  story?: string;
  href?: never;
}

interface DocsArrowLinkExternalProps extends DocsArrowLinkBaseProps {
  /** External URL — opens in a new tab. */
  href: string;
  kind?: never;
  story?: never;
}

type DocsArrowLinkProps =
  | DocsArrowLinkInternalProps
  | DocsArrowLinkExternalProps;

const sizeClasses: Record<Size, string> = {
  sm: "text-sm",
  md: "text-base",
};

const iconSizeClasses: Record<Size, string> = {
  sm: "size-3",
  md: "size-3.5",
};

/**
 * Inline arrow link used across docs pages — heading aside, prose sentence,
 * hero list. Supports both Storybook internal links (via `kind` + `story`)
 * and external URLs (via `href`).
 *
 * @example Internal — links to another Storybook story
 * <DocsArrowLink kind="veryfront-ui-chat" story="demo">View chat</DocsArrowLink>
 *
 * @example External — opens in new tab
 * <DocsArrowLink href="https://www.radix-ui.com/...">Radix UI</DocsArrowLink>
 */
export function DocsArrowLink(props: DocsArrowLinkProps) {
  const { children, size = "md", className } = props;
  const baseClass = cn(
    "inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:no-underline",
    sizeClasses[size],
    className,
  );
  const icon = (
    <ArrowRight className={cn("shrink-0", iconSizeClasses[size])} />
  );

  if ("href" in props && props.href) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClass}
      >
        {children}
        {icon}
      </a>
    );
  }

  // LinkTo doesn't expose className in its type defs; wrap and style its rendered <a> via descendant selector.
  return (
    <span
      className={cn(
        "[&>a]:inline-flex [&>a]:items-center [&>a]:gap-1",
        baseClass,
        "[&>a]:no-underline",
      )}
    >
      <LinkTo kind={props.kind} story={props.story ?? "docs"}>
        {children}
        {icon}
      </LinkTo>
    </span>
  );
}
