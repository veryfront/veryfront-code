import * as dntShim from "../../../_dnt.shims.js";
import { useCallback, useState } from "react";
export function useWorkflowStart(options) {
    const { workflowId, apiBase = "/api/workflows", onStart, onError } = options;
    const [isStarting, setIsStarting] = useState(false);
    const [lastRunId, setLastRunId] = useState(null);
    const [error, setError] = useState(null);
    const start = useCallback(async (input) => {
        setIsStarting(true);
        setError(null);
        try {
            const response = await dntShim.fetch(`${apiBase}/${workflowId}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input }),
            });
            if (!response.ok) {
                const errorData = await response
                    .json()
                    .catch(() => ({}));
                throw new Error(errorData.message ?? `Failed to start workflow: ${response.status}`);
            }
            const data = await response.json();
            const runId = data.runId ?? data.id ?? "";
            setLastRunId(runId);
            onStart?.(runId);
            return runId;
        }
        catch (error) {
            const startError = error instanceof Error ? error : new Error(String(error));
            setError(startError);
            onError?.(startError);
            throw startError;
        }
        finally {
            setIsStarting(false);
        }
    }, [apiBase, onError, onStart, workflowId]);
    const resetError = useCallback(() => {
        setError(null);
    }, []);
    return { start, isStarting, lastRunId, error, resetError };
}
