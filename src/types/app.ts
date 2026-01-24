import type { ReactElement } from "react";

export interface AppProps {
  Component: (props: Record<string, unknown>) => ReactElement | null;
  pageProps: Record<string, unknown>;
}
