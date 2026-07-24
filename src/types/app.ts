import type * as React from "react";

/** Props passed to a custom Veryfront application wrapper. */
export interface AppProps<TPageProps extends object = Record<string, unknown>> {
  /** Page component selected for the current route. */
  Component: React.ComponentType<TPageProps>;
  /** Props resolved for the selected page component. */
  pageProps: TPageProps;
}
