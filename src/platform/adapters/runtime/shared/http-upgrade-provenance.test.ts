import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  consumeNodeWebSocketUpgradeRequest,
  getWebSocketUpgradeIdleTimeout,
  hasNodeWebSocketUpgradeRequest,
  isDenoWebSocketResponse,
  readWebSocketBufferedAmount,
  recordDenoWebSocketResponse,
  recordNodeWebSocketUpgradeRequest,
  recordWebSocketBufferedAmount,
  recordWebSocketUpgradeIdleTimeout,
  revokeNodeWebSocketUpgradeRequest,
} from "./http-upgrade-provenance.ts";

it("upgrade provenance does not expose requests to replaced collection methods", () => {
  const request = new Request("http://localhost", { headers: { authorization: "synthetic" } });
  const clone = request.clone();
  const response = {};
  const connection = {};
  const map = Object.getOwnPropertyDescriptors(WeakMap.prototype);
  const set = Object.getOwnPropertyDescriptors(WeakSet.prototype);
  let observations = 0;
  const observed = () => {
    observations++;
    throw new Error("authored collection observer");
  };
  let granted = false;
  let cloned = true;
  let consumed: string | undefined;
  let revoked = true;
  let timeout: number | undefined;
  let dom = false;
  let buffered = -1;
  try {
    for (const key of ["set", "get", "has", "delete"]) {
      Object.defineProperty(WeakMap.prototype, key, { ...map[key], value: observed });
    }
    for (const key of ["add", "has"]) {
      Object.defineProperty(WeakSet.prototype, key, { ...set[key], value: observed });
    }
    recordNodeWebSocketUpgradeRequest(request, "exact");
    granted = hasNodeWebSocketUpgradeRequest(request);
    cloned = hasNodeWebSocketUpgradeRequest(clone);
    consumed = consumeNodeWebSocketUpgradeRequest(request);
    recordNodeWebSocketUpgradeRequest(request, "revoked");
    revokeNodeWebSocketUpgradeRequest(request);
    revoked = hasNodeWebSocketUpgradeRequest(request);
    recordWebSocketUpgradeIdleTimeout(response, 30);
    timeout = getWebSocketUpgradeIdleTimeout(response);
    recordDenoWebSocketResponse(response);
    dom = isDenoWebSocketResponse(response);
    recordWebSocketBufferedAmount(connection, () => 7);
    buffered = readWebSocketBufferedAmount(connection);
  } finally {
    Object.defineProperties(WeakMap.prototype, map);
    Object.defineProperties(WeakSet.prototype, set);
  }
  assertEquals({ observations, granted, cloned, consumed, revoked, timeout, dom, buffered }, {
    observations: 0,
    granted: true,
    cloned: false,
    consumed: "exact",
    revoked: false,
    timeout: 30,
    dom: true,
    buffered: 7,
  });
  assertThrows(() => consumeNodeWebSocketUpgradeRequest(clone), Error, "original request");
});
