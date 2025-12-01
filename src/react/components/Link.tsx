import React from "react";

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  prefetch?: boolean;
};

export function Link({ prefetch = true, children, ...rest }: LinkProps) {
  const props: React.AnchorHTMLAttributes<HTMLAnchorElement> = {
    ...rest,
    ...(prefetch ? { "data-prefetch": "true" } : {}),
  };
  return <a {...props}>{children}</a>;
}
