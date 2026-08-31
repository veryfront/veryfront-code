import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import type { RunFilter, WorkflowStatus } from "#veryfront/workflow/types.ts";
import type { WorkflowRunSummary } from "#veryfront/workflow/http/run-summary.ts";
import { normalizeWorkflowApiBase, useStableWorkflowHeaders } from "./mutation-headers.ts";

/** Default interval for auto-refreshing the workflow list */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/** Options accepted by use workflow list. */
export interface UseWorkflowListOptions {
  workflowId?: string;
  status?: WorkflowStatus | WorkflowStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
  pageSize?: number;
  apiBase?: string;
  /** Additional headers, such as a cross-origin authorization token. */
  headers?: HeadersInit;
  /** Fetch credential mode for cross-origin cookie-backed sessions. */
  credentials?: RequestCredentials;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

/** Result returned from use workflow list. */
export interface UseWorkflowListResult {
  runs: WorkflowRunSummary[];
  totalCount?: number;
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setFilter: (filter: Partial<UseWorkflowListOptions>) => void;
  filter: RunFilter;
}

/**
 * List and filter workflow runs.
 */
export function useWorkflowList(options: UseWorkflowListOptions = {}): UseWorkflowListResult {
  const {
    workflowId,
    status,
    createdAfter,
    createdBefore,
    pageSize = 20,
    apiBase = "/api/workflows",
    headers,
    credentials,
    autoRefresh = false,
    refreshInterval = DEFAULT_REFRESH_INTERVAL_MS,
  } = options;
  const normalizedApiBase = normalizeWorkflowApiBase(apiBase);
  const stableHeaders = useStableWorkflowHeaders(headers);
  const authorizationContext = useMemo(
    () => ({ credentials, normalizedApiBase, stableHeaders }),
    [credentials, normalizedApiBase, stableHeaders],
  );
  const currentAuthorizationContext = useRef(authorizationContext);
  currentAuthorizationContext.current = authorizationContext;

  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [dataAuthorizationContext, setDataAuthorizationContext] = useState(
    authorizationContext,
  );
  const requestSequence = useRef(0);
  const activeRequestSequence = useRef<number | null>(null);
  const isCurrentRequest = useCallback(
    (request: { authorizationContext: typeof authorizationContext; sequence: number }): boolean =>
      request.sequence === requestSequence.current &&
      request.authorizationContext === currentAuthorizationContext.current,
    [],
  );

  const [filter, setFilterState] = useState<RunFilter>({
    workflowId,
    status,
    createdAfter,
    createdBefore,
    limit: pageSize,
  });

  const buildQueryString = useCallback((filterToUse: RunFilter, cursorToUse?: string): string => {
    const params = new URLSearchParams();

    if (filterToUse.workflowId) params.set("workflowId", filterToUse.workflowId);

    if (filterToUse.status) {
      const statuses = Array.isArray(filterToUse.status)
        ? filterToUse.status
        : [filterToUse.status];
      for (const s of statuses) params.append("status", s);
    }

    if (filterToUse.createdAfter) {
      params.set("createdAfter", filterToUse.createdAfter.toISOString());
    }
    if (filterToUse.createdBefore) {
      params.set("createdBefore", filterToUse.createdBefore.toISOString());
    }
    if (filterToUse.limit) params.set("limit", String(filterToUse.limit));
    if (cursorToUse) params.set("cursor", cursorToUse);

    return params.toString();
  }, []);

  const fetchRuns = useCallback(
    async (
      append = false,
    ): Promise<{ authorizationContext: typeof authorizationContext; sequence: number }> => {
      const sequence = ++requestSequence.current;
      const request = { authorizationContext, sequence };
      activeRequestSequence.current = sequence;
      try {
        const queryString = buildQueryString(filter, append ? cursor : undefined);
        const response = await fetch(`${normalizedApiBase}/runs?${queryString}`, {
          headers: stableHeaders,
          credentials,
        });

        if (!response.ok) {
          throw REQUEST_ERROR.create({
            detail: `Failed to fetch runs: ${response.status}`,
            status: response.status,
          });
        }

        const data = await response.json() as
          | {
            runs?: WorkflowRunSummary[];
            cursor?: string;
            totalCount?: number;
          }
          | WorkflowRunSummary[];
        const fetchedRuns = Array.isArray(data) ? data : data.runs ?? [];
        const nextCursor = Array.isArray(data) ? undefined : data.cursor;
        const total = Array.isArray(data) ? undefined : data.totalCount;

        if (!isCurrentRequest(request)) return request;

        setDataAuthorizationContext(authorizationContext);
        setRuns((prev) => (append ? [...prev, ...fetchedRuns] : fetchedRuns));
        setCursor(nextCursor);
        setHasMore(Boolean(nextCursor) || fetchedRuns.length === filter.limit);
        setTotalCount(total);
        setError(null);
      } catch (err) {
        if (!isCurrentRequest(request)) return request;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (activeRequestSequence.current === sequence) {
          activeRequestSequence.current = null;
        }
      }
      return request;
    },
    [
      authorizationContext,
      buildQueryString,
      credentials,
      cursor,
      filter,
      isCurrentRequest,
      normalizedApiBase,
      stableHeaders,
    ],
  );

  useEffect(() => {
    // Data from one authorization context must not remain visible while a
    // replacement request is pending or after it fails.
    requestSequence.current++;
    activeRequestSequence.current = null;
    setRuns([]);
    setCursor(undefined);
    setHasMore(false);
    setTotalCount(undefined);
    setError(null);
  }, [authorizationContext]);

  useEffect(() => {
    let cancelled = false;

    async function doFetch(): Promise<void> {
      setIsLoading(true);
      const request = await fetchRuns(false);
      if (!cancelled && isCurrentRequest(request)) setIsLoading(false);
    }

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [fetchRuns, filter, isCurrentRequest]);

  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      if (activeRequestSequence.current !== null) return;
      fetchRuns(false);
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, fetchRuns, refreshInterval]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || isLoading) return;

    setIsLoading(true);
    const request = await fetchRuns(true);
    if (isCurrentRequest(request)) setIsLoading(false);
  }, [fetchRuns, hasMore, isCurrentRequest, isLoading]);

  const refresh = useCallback(async (): Promise<void> => {
    setCursor(undefined);
    setIsLoading(true);
    const request = await fetchRuns(false);
    if (isCurrentRequest(request)) setIsLoading(false);
  }, [fetchRuns, isCurrentRequest]);

  const setFilter = useCallback((newFilter: Partial<UseWorkflowListOptions>): void => {
    setCursor(undefined);
    setFilterState((prev) => ({
      ...prev,
      workflowId: newFilter.workflowId ?? prev.workflowId,
      status: newFilter.status ?? prev.status,
      createdAfter: newFilter.createdAfter ?? prev.createdAfter,
      createdBefore: newFilter.createdBefore ?? prev.createdBefore,
      limit: newFilter.pageSize ?? prev.limit,
    }));
  }, []);

  const hasCurrentAuthorizationData = dataAuthorizationContext === authorizationContext;

  return {
    runs: hasCurrentAuthorizationData ? runs : [],
    totalCount: hasCurrentAuthorizationData ? totalCount : undefined,
    isLoading,
    error,
    hasMore: hasCurrentAuthorizationData ? hasMore : false,
    loadMore,
    refresh,
    setFilter,
    filter,
  };
}
