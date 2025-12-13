import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getRouterScript } from "./router.ts";

describe("router template", () => {
  describe("getRouterScript", () => {
    it("should return router script string", () => {
      const script = getRouterScript();

      assert(typeof script === "string");
      assert(script.length > 0);
    });

    it("should define MODULE_SERVER_URL", () => {
      const script = getRouterScript();

      assert(script.includes("const MODULE_SERVER_URL"));
      assert(script.includes("/_vf_modules"));
    });

    it("should create router object", () => {
      const script = getRouterScript();

      assert(script.includes("const router = {"));
    });

    it("should implement push method", () => {
      const script = getRouterScript();

      assert(script.includes("push: (path)"));
      assert(script.includes("window.history.pushState"));
    });

    it("should implement replace method", () => {
      const script = getRouterScript();

      assert(script.includes("replace: (path)"));
      assert(script.includes("window.history.replaceState"));
    });

    it("should implement back method", () => {
      const script = getRouterScript();

      assert(script.includes("back: ()"));
      assert(script.includes("window.history.back"));
    });

    it("should implement forward method", () => {
      const script = getRouterScript();

      assert(script.includes("forward: ()"));
      assert(script.includes("window.history.forward"));
    });

    it("should include pathname property", () => {
      const script = getRouterScript();

      assert(script.includes("pathname: window.location.pathname"));
    });

    it("should include query property", () => {
      const script = getRouterScript();

      assert(script.includes("query: Object.fromEntries"));
      assert(script.includes("URLSearchParams"));
    });

    it("should set global router", () => {
      const script = getRouterScript();

      assert(script.includes("window.__veryfrontRouter = router"));
    });

    it("should create RouterContext", () => {
      const script = getRouterScript();

      assert(script.includes("const RouterContext = React.createContext(router)"));
    });

    it("should define useRouter hook", () => {
      const script = getRouterScript();

      assert(script.includes("window.useRouter = ()"));
      assert(script.includes("React.useContext(RouterContext)"));
    });

    it("should define RouterProvider component", () => {
      const script = getRouterScript();

      assert(script.includes("const RouterProvider = ({ children })"));
      assert(script.includes("RouterContext.Provider"));
    });

    it("should dispatch popstate events", () => {
      const script = getRouterScript();

      assert(script.includes("new PopStateEvent('popstate')"));
    });
  });
});
