import React from "react";

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  prefetch?: boolean;
};

export function Link({ prefetch = true, children, ...rest }: LinkProps) {
  const props = {
    ...rest,
    ...(prefetch ? { "data-prefetch": "true" } : {}),
  };
  // @ts-ignore - csstype version conflict between dependencies
  return <a {...props}>{children}</a>;
}
