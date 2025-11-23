export const getRouterScript = () => `
    // Use current origin for module server (modules are served by main dev server at /_vf_modules/)
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';
    console.log('[DEBUG] MODULE_SERVER_URL set to:', MODULE_SERVER_URL);
    console.log('[DEBUG] window.location.origin:', window.location.origin);

    const router = {
      push: (path) => {
        console.log('[Veryfront Router] Navigating to:', path);
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      replace: (path) => {
        console.log('[Veryfront Router] Replacing with:', path);
        window.history.replaceState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      back: () => {
        console.log('[Veryfront Router] Going back');
        window.history.back();
      },
      forward: () => {
        console.log('[Veryfront Router] Going forward');
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
