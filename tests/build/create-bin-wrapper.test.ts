import { assertEquals } from "#std/assert";
import process from "node:process";

type CreateBinWrapper = {
  exitCodeForSignal(signal: string): number;
  exitFromChildStatus(
    code: number | null,
    signal: NodeJS.Signals | null,
    hooks: {
      killSelf?: (pid: number, signal: NodeJS.Signals) => void;
      exit?: (code?: number) => never | void;
    },
  ): void;
};

const wrapper = await import("../../scripts/build/create-bin-wrapper.js") as CreateBinWrapper;

Deno.test("create-veryfront wrapper forwards child signals when supported", () => {
  const calls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const exits: number[] = [];

  wrapper.exitFromChildStatus(null, "SIGTERM", {
    killSelf: (pid, signal) => {
      calls.push({ pid, signal });
    },
    exit: (code = 0) => {
      exits.push(code);
    },
  });

  assertEquals(calls, [{ pid: process.pid, signal: "SIGTERM" }]);
  assertEquals(exits, []);
});

Deno.test("create-veryfront wrapper exits cleanly when child signal cannot be forwarded", () => {
  const exits: number[] = [];

  wrapper.exitFromChildStatus(null, "SIGTERM", {
    killSelf: () => {
      throw new Error("unsupported signal");
    },
    exit: (code = 0) => {
      exits.push(code);
    },
  });

  assertEquals(exits, [wrapper.exitCodeForSignal("SIGTERM")]);
});
