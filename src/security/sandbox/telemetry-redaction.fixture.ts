import { computeHash } from "#veryfront/utils";
import { ProjectWorker } from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";

const FAULTS = {
  uncaught: {
    tenantMarker: "VF_TENANT_UNCAUGHT_SECRET_7f3c",
    sourceMarker: "VF_PRIVATE_SOURCE_UNCAUGHT_8e2b",
  },
  rejection: {
    tenantMarker: "VF_TENANT_REJECTION_SECRET_3d6a",
    sourceMarker: "VF_PRIVATE_SOURCE_REJECTION_9c4e",
  },
} as const;

type FaultKind = keyof typeof FAULTS;

const faultKind = Deno.args[0] as FaultKind;
const fault = FAULTS[faultKind];
if (!fault) throw new TypeError("Unknown worker fault fixture");

const projectDir = await Deno.makeTempDir();
const modulePath = `/tenants/${fault.tenantMarker}/private-route.ts`;
const scheduleFault = faultKind === "uncaught"
  ? `queueMicrotask(() => {
      throw new Error(${JSON.stringify(`${fault.tenantMarker} ${modulePath}`)});
    });`
  : `void Promise.reject(
      new Error(${JSON.stringify(`${fault.tenantMarker} ${modulePath}`)}),
    );`;
const source = `
  Event.prototype.preventDefault = () => {
    throw new Error("Project event intrinsic must not run");
  };
  export function GET() {
    ${scheduleFault}
    return new Promise(() => {});
  }
  // ${fault.sourceMarker}
`;
const worker = new ProjectWorker({
  projectId: `telemetry-${faultKind}`,
  permissions: buildWorkerPermissions([projectDir]),
  requestTimeoutMs: 5_000,
  allowInternalEgress: false,
});
let idleNotifications = 0;
let rejectionCount = 0;
let resolved = false;
const unsubscribe = worker.onIdle(() => idleNotifications++);

try {
  worker.start();
  if (!await worker.isHealthy(30_000)) {
    throw new Error("Worker fault fixture did not become healthy");
  }

  await worker.execute({
    type: "execute-app-route",
    id: `telemetry-${faultKind}`,
    module: {
      source,
      sha256: await computeHash(source),
    },
    modulePath,
    method: "GET",
    request: {
      url: "http://localhost/private",
      method: "GET",
      headers: [],
      body: null,
    },
    params: {},
    projectDir,
    sourceIntegrationPolicy: {
      schemaVersion: 1,
      mode: "unrestricted",
    },
  }).then(
    () => {
      resolved = true;
    },
    () => {
      rejectionCount++;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  console.log(JSON.stringify({
    hasPendingRequests: worker.hasPendingRequests,
    idleNotifications,
    rejectionCount,
    resolved,
    status: worker.status,
  }));
} finally {
  unsubscribe();
  worker.terminate();
  await Deno.remove(projectDir, { recursive: true });
}
