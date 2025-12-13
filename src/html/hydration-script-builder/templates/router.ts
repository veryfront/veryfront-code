export const getRouterScript = () => `
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    const router = {
      push: (path) => {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      replace: (path) => {
        window.history.replaceState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      back: () => {
        window.history.back();
      },
      forward: () => {
        window.history.forward();
      },
      pathname: window.location.pathname,
      query: Object.fromEntries(new URLSearchParams(window.location.search))
    };

    window.__veryfrontRouter = router;

    const RouterContext = React.createContext(router);

    window.useRouter = () => {
      const ctx = React.useContext(RouterContext);
      if (!ctx) {
        console.warn('[Veryfront] useRouter called outside RouterContext, returning global router');
        return window.__veryfrontRouter;
      }
      return ctx;
    };

    const RouterProvider = ({ children }) => {
      return React.createElement(RouterContext.Provider, { value: router }, children);
    };
`;
