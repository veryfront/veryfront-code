import "../../../_dnt.polyfills.js";
import "../../../_dnt.polyfills.js";
import React from "react";
const defaultRouter = {
    domain: "",
    path: "/",
    pathname: "/",
    params: {},
    query: {},
    isPreview: false,
    isMounted: false,
    navigate: async () => { },
    push: async () => { },
    replace: async () => { },
    reload: async () => { },
};
const RouterContext = React.createContext(defaultRouter);
export function RouterProvider({ children, router, }) {
    return React.createElement(RouterContext.Provider, { value: router ?? defaultRouter }, children);
}
export function useRouter() {
    return React.useContext(RouterContext);
}
export { RouterProvider as Router };
