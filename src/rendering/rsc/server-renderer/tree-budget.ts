export const MAX_RSC_RENDER_DEPTH = 64;
export const MAX_RSC_RENDER_NODES = 10_000;
export const MAX_RSC_RENDER_CONCURRENCY = 16;

export interface RscRenderBudget {
  nodes: number;
}

export function createRscRenderBudget(): RscRenderBudget {
  return { nodes: 0 };
}

export function claimRscRenderNode(
  budget: RscRenderBudget,
  depth: number,
): void {
  if (depth > MAX_RSC_RENDER_DEPTH) {
    throw new RangeError(
      `RSC render depth limit of ${MAX_RSC_RENDER_DEPTH} was exceeded`,
    );
  }
  if (budget.nodes >= MAX_RSC_RENDER_NODES) {
    throw new RangeError(
      `RSC render node limit of ${MAX_RSC_RENDER_NODES} was exceeded`,
    );
  }
  budget.nodes += 1;
}

export function assertRscRenderCapacity(
  budget: RscRenderBudget,
  additionalNodes: number,
  depth: number,
): void {
  if (depth > MAX_RSC_RENDER_DEPTH) {
    throw new RangeError(
      `RSC render depth limit of ${MAX_RSC_RENDER_DEPTH} was exceeded`,
    );
  }
  if (
    !Number.isSafeInteger(additionalNodes) ||
    additionalNodes < 0 ||
    additionalNodes > MAX_RSC_RENDER_NODES - budget.nodes
  ) {
    throw new RangeError(
      `RSC render node limit of ${MAX_RSC_RENDER_NODES} was exceeded`,
    );
  }
}

export async function mapRscRenderChildren<Input, Output>(
  values: readonly Input[],
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (values.length === 0) return [];

  const results = new Array<Output>(values.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  };

  const workerCount = Math.min(MAX_RSC_RENDER_CONCURRENCY, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
