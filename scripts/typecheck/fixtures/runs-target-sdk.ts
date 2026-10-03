import {
  createRunsSdk,
  type RunsContractComponents,
  type RunsInput,
  type RunsOutput,
  type RunStreamFrame,
} from "veryfront/runs/target";

type Run = RunsContractComponents["schemas"]["Run"];

const runs = createRunsSdk({
  baseUrl: "https://api.veryfront.com",
  transport: (request) => fetch(request),
  credential: { bearer: "<TOKEN>" },
});

const getRunInput: RunsInput<"getRun"> = { path: { run_id: "run_123" } };

export async function readRun(): Promise<Run> {
  const run: RunsOutput<"getRun"> = await runs.getRun(getRunInput);
  return run;
}

export async function lastFrame(): Promise<RunStreamFrame | undefined> {
  let last: RunStreamFrame | undefined;
  for await (const frame of runs.streamRunEvents({ path: { run_id: "run_123" } })) last = frame;
  return last;
}

// @ts-expect-error getRun requires the run_id path parameter.
export const missingRunId: RunsInput<"getRun"> = {};
