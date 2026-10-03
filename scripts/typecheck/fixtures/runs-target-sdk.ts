import {
  createRunsApiTransport,
  createRunsSdk,
  type RunsContractComponents,
  type RunsInput,
  type RunsOutput,
  type RunStreamFrame,
} from "veryfront/runs/target";

type Run = RunsContractComponents["schemas"]["Run"];

const runs = createRunsSdk({
  transport: createRunsApiTransport({
    baseUrl: "https://api.veryfront.com",
    getToken: () => "<TOKEN>",
    authMode: "api-key",
  }),
});

const getRunInput: RunsInput<"getRun"> = { path: { run_id: "11111111-1111-4111-8111-111111111111" } };

export async function readRun(): Promise<Run> {
  const run: RunsOutput<"getRun"> = await runs.getRun(getRunInput);
  return run;
}

export async function lastFrame(): Promise<RunStreamFrame | undefined> {
  let last: RunStreamFrame | undefined;
  for await (const frame of runs.streamRunEvents({ path: { run_id: "11111111-1111-4111-8111-111111111111" } })) last = frame;
  return last;
}

// @ts-expect-error getRun requires the run_id path parameter.
export const missingRunId: RunsInput<"getRun"> = {};
