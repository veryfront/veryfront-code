/**
 * Generate the compatibility bridge between the shared hydration runtime and
 * release-pinned router assets.
 *
 * Router releases since the v1 navigation store landed share the same
 * Symbol.for registry entry even when they predate the public
 * getNavigationStore export. Keeping the fallback store shape in sync with the
 * two v1 implementations lets those releases retain SPA navigation.
 */
export const getNavigationStoreCompatibilityScript = () => `
    const navigationStoreUsesRegistryFallback =
      typeof RouterRuntime.getNavigationStore !== 'function';
    const getNavigationStore = navigationStoreUsesRegistryFallback
      ? () => {
          const storeKey = Symbol.for('veryfront.navigation.store.v1');
          const existing = globalThis[storeKey];
          if (existing) return existing;

          const listeners = new Set();
          const navigatorRegistrations = [];
          const store = {
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            getHref() {
              const loc = globalThis.location;
              return loc ? loc.pathname + loc.search + loc.hash : '/';
            },
            notify() {
              for (const listener of [...listeners]) {
                try {
                  listener();
                } catch {
                  // One subscriber must not prevent the others from updating.
                }
              }
            },
            navigate(href, options) {
              const registration = navigatorRegistrations.at(-1);
              if (registration) return registration.navigate(href, options);

              const location = globalThis.location;
              if (location && options?.history !== 'none') {
                if (options?.history === 'replace') location.replace(href);
                else location.assign(href);
              }
              return Promise.resolve();
            },
            setNavigator(next) {
              const registration = { navigate: next };
              navigatorRegistrations.push(registration);
              let active = true;

              return () => {
                if (!active) return;
                active = false;
                const index = navigatorRegistrations.indexOf(registration);
                if (index !== -1) navigatorRegistrations.splice(index, 1);
              };
            },
          };

          globalThis[storeKey] = store;
          return store;
        }
      : RouterRuntime.getNavigationStore;
`;
