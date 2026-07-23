import type { ReactElement } from "react";

/** Props passed to a custom Veryfront application wrapper. */
export interface AppProps {
  /** Page component selected for the current route. */
  Component: (props: Record<string, unknown>) => ReactElement | null;
  /** Props resolved for the selected page component. */
  pageProps: Record<string, unknown>;
}
