export const getRouterScript = () => `
    // Use current origin for module server (modules are served by main dev server at /_vf_modules/)
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    // Navigate with View Transition API for smooth page transitions
    const navigateWithTransition = (href) => {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          window.location.href = href;
        });
      } else {
        window.location.href = href;
      }
    };

    const router = {
      push: (path) => {
        navigateWithTransition(path);
      },
      replace: (path) => {
        if (document.startViewTransition) {
          document.startViewTransition(() => {
            window.location.replace(path);
          });
        } else {
          window.location.replace(path);
        }
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

    // Intercept link clicks for smooth View Transitions
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // Skip: external links, new tab, download, modifier keys, non-path links
      if (link.target === '_blank' ||
          link.hasAttribute('download') ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
          !href.startsWith('/') ||
          href.startsWith('//')) {
        return;
      }

      e.preventDefault();
      navigateWithTransition(href);
    });

    const RouterContext = React.createContext(router);

    window.useRouter = () => {
      const ctx = React.useContext(RouterContext);
      if (!ctx) {
        return window.__veryfrontRouter;
      }
      return ctx;
    };

    const RouterProvider = ({ children }) => {
      return React.createElement(RouterContext.Provider, { value: router }, children);
    };
`;
