import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findAvailablePort,
  isPortAvailable,
  isPortInUseError,
  MAX_PORT_FALLBACK_ATTEMPTS,
  MAX_TCP_PORT,
} from "./port-fallback.ts";

/** A probe reporting the given ports as taken, recording what was asked about. */
function probeBusyOn(busy: number[]): {
  probe: (port: number) => Promise<boolean>;
  probed: number[];
} {
  const probed: number[] = [];
  return {
    probed,
    probe: (port: number) => {
      probed.push(port);
      return Promise.resolve(!busy.includes(port));
    },
  };
}

describe("cli/commands/dev/port-fallback", () => {
  describe("findAvailablePort", () => {
    it("keeps the requested port when it is free", async () => {
      const { probe, probed } = probeBusyOn([]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3000);
      assertEquals(probed, [3000]);
    });

    it("falls forward to the next free port when the default dev port is taken", async () => {
      const { probe, probed } = probeBusyOn([3000]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3001);
      assertEquals(probed, [3000, 3001]);
    });

    it("keeps scanning past a run of busy ports", async () => {
      const { probe, probed } = probeBusyOn([3000, 3001, 3002]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3003);
      assertEquals(probed, [3000, 3001, 3002, 3003]);
    });

    it("falls forward from an explicitly requested port too", async () => {
      const { probe } = probeBusyOn([8080]);

      assertEquals(await findAvailablePort(8080, MAX_PORT_FALLBACK_ATTEMPTS, probe), 8081);
    });

    it("reports the --port flag once the whole scan range is busy", async () => {
      const busy = [3000, 3001, 3002];
      const { probe } = probeBusyOn(busy);

      const error = await findAvailablePort(3000, busy.length, probe).then(
        () => null,
        (caught: unknown) => caught,
      );

      assert(error instanceof Error, "expected the exhausted scan to reject");
      const veryfrontError = error as Error & { slug?: string; suggestion?: string };
      assertEquals(veryfrontError.slug, "port-in-use");
      assertStringIncludes(veryfrontError.message, "3000");
      assertStringIncludes(veryfrontError.message, "3002");
      assertStringIncludes(veryfrontError.suggestion ?? "", "--port");
    });

    it("stops at the last valid TCP port instead of probing past it", async () => {
      const start = MAX_TCP_PORT - 2;
      const { probe, probed } = probeBusyOn([start, start + 1, MAX_TCP_PORT]);

      const error = await findAvailablePort(start, MAX_PORT_FALLBACK_ATTEMPTS, probe).then(
        () => null,
        (caught: unknown) => caught,
      );

      // A runtime rejects 65536 as an invalid port, not as an address in use,
      // so probing it would let a raw error escape instead of PORT_IN_USE.
      assertEquals(probed, [start, start + 1, MAX_TCP_PORT]);
      assert(error instanceof Error, "expected the exhausted scan to reject");
      const veryfrontError = error as Error & { slug?: string };
      assertEquals(veryfrontError.slug, "port-in-use");
      assertStringIncludes(veryfrontError.message, String(MAX_TCP_PORT));
    });

    it("still probes an out-of-range requested port so the runtime can reject it", async () => {
      const probed: number[] = [];

      await findAvailablePort(MAX_TCP_PORT + 1, MAX_PORT_FALLBACK_ATTEMPTS, (port) => {
        probed.push(port);
        return Promise.resolve(true);
      });

      assertEquals(probed, [MAX_TCP_PORT + 1]);
    });
  });

  describe("isPortAvailable", () => {
    it("skips a port another process is really holding", async () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;

      try {
        assertEquals(await isPortAvailable(heldPort), false);

        // Which port it lands on depends on what else the machine is running,
        // but it must never be the held one, and must never throw.
        const chosen = await findAvailablePort(heldPort, MAX_PORT_FALLBACK_ATTEMPTS);
        assert(chosen > heldPort, `expected a port after ${heldPort}, got ${chosen}`);
        assert(chosen < heldPort + MAX_PORT_FALLBACK_ATTEMPTS);
      } finally {
        held.close();
      }
    });

    it("accepts a port nothing is holding", async () => {
      const probeListener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const freePort = (probeListener.addr as Deno.NetAddr).port;
      probeListener.close();

      assertEquals(await isPortAvailable(freePort), true);
    });

    it("probes without going through the ambient Deno namespace", async () => {
      // Stand in the failure the npm build hits under Deno: dnt swaps the
      // ambient namespace for @deno/shim-deno, whose `listen` throws on a null
      // `server._handle`. The probe must answer correctly without it.
      const nativeListen = Deno.listen;
      const held = nativeListen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;
      const freeListener = nativeListen({ hostname: "127.0.0.1", port: 0 });
      const freePort = (freeListener.addr as Deno.NetAddr).port;
      freeListener.close();

      Object.defineProperty(Deno, "listen", {
        configurable: true,
        writable: true,
        value: () => {
          throw new TypeError("Cannot read properties of null (reading 'fd')");
        },
      });

      try {
        assertEquals(await isPortAvailable(heldPort), false);
        assertEquals(await isPortAvailable(freePort), true);
      } finally {
        Object.defineProperty(Deno, "listen", {
          configurable: true,
          writable: true,
          value: nativeListen,
        });
        held.close();
      }
    });
  });

  describe("npm build safety", () => {
    it("never reaches the runtime through the binding dnt rewrites", async () => {
      // dnt rewrites every bare `Deno.<member>` access in the npm build to
      // `dntShim.Deno.<member>`, i.e. `@deno/shim-deno`. That shim implements
      // its TCP listen as `net.createServer()` followed by an immediate read of
      // `server._handle.fd`, and Deno's own `node:net` compat leaves `_handle`
      // null at that point. So under a Deno-installed CLI the probe threw
      // `TypeError: Cannot read properties of null (reading 'fd')` and
      // `veryfront dev` died before the dev server could bind - while the very
      // same package ran fine under Node, where the shim is not used.
      //
      // The test above proves the probe survives a poisoned ambient namespace.
      // This one guards the whole file, including paths that test never runs:
      // any bare `Deno.` member access reintroduced anywhere here is a rewrite
      // target. Reach the runtime through `getDenoRuntime()` instead, whose
      // `Reflect.get(globalThis, "Deno")` dnt leaves alone.
      const source = await Deno.readTextFile(new URL("./port-fallback.ts", import.meta.url));
      // dnt rewrites code, not prose, and the fix's own doc comment has to be
      // free to name `Deno.listen` as the thing it stopped calling. Strip
      // comments first - `(?<![:\\])` keeps the `//` of a `https://` inside one
      // from ending it early. String literals are left in, so a `"Deno.foo"`
      // would be a false positive: it fails towards rewording, never silence.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<![:\\])\/\/.*$/gm, "");
      const rewrittenByDnt = code.match(/(?<![.\w$])Deno\.\w+/g) ?? [];

      assertEquals(
        rewrittenByDnt,
        [],
        `dnt would rewrite ${rewrittenByDnt.join(", ")} to the broken @deno/shim-deno namespace`,
      );
    });
  });

  describe("isPortInUseError", () => {
    it("recognises the address-in-use error the runtime actually throws", () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;

      try {
        let thrown: unknown;
        try {
          Deno.listen({ hostname: "127.0.0.1", port: heldPort }).close();
        } catch (error) {
          thrown = error;
        }

        assert(thrown !== undefined, "second listen on a held port must throw");
        assert(isPortInUseError(thrown), "the runtime's own error must be recognised");
      } finally {
        held.close();
      }
    });

    it("recognises the Node error shape", () => {
      const error = Object.assign(new Error("listen EADDRINUSE: address already in use :::3000"), {
        code: "EADDRINUSE",
      });

      assert(isPortInUseError(error));
    });

    it("does not treat unrelated failures as port collisions", () => {
      assert(!isPortInUseError(new Error("boom")));
      assert(!isPortInUseError("EADDRINUSE"));
      assert(!isPortInUseError(undefined));
    });
  });
});
