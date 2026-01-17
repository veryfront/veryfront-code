import type * as React from "react";

export interface AppProps {
  Component: (props: Record<string, unknown>) => React.ReactElement | null;
  pageProps: Record<string, unknown>;
}
