import React from "react";

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  prefetch?: boolean;
};

export function Link({
  prefetch = true,
  children,
  ...rest
}: LinkProps): React.ReactElement {
  return (
    <a {...rest} {...(prefetch ? { "data-prefetch": "true" } : {})}>
      {children}
    </a>
  );
}
