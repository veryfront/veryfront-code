export interface paths {
    "/account/analytics/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run analytics
         * @description Returns run analytics.
         */
        get: operations["getAccountRunAnalytics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/child-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation child runs
         * @description Lists child runs in a conversation.
         */
        get: operations["listConversationChildRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/input-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation input requests
         * @description Lists input requests in a conversation.
         */
        get: operations["listConversationInputRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/conversations/{conversation_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List conversation runs
         * @description Lists runs in a conversation.
         */
        get: operations["listConversationRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get input request
         * @description Returns an input request.
         */
        get: operations["getInputRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel input request
         * @description Cancels an input request.
         */
        post: operations["cancelInputRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/input-requests/{input_request_id}/responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Respond to input request
         * @description Submits a response to an input request.
         */
        post: operations["createInputResponse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/evals/{eval_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List evaluation runs
         * @description Lists runs of an evaluation.
         */
        get: operations["listEvalRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List project runs
         * @description Lists runs in a project.
         */
        get: operations["listProjectRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{project_reference}/webhooks/{webhook_definition_id}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook runs
         * @description Lists runs of a webhook.
         */
        get: operations["listProjectWebhookRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List runs
         * @description Lists runs.
         */
        get: operations["listRuns"];
        put?: never;
        /**
         * Create run
         * @description Creates a run of type agent, workflow or task.
         */
        post: operations["createRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run
         * @description Returns a run.
         */
        get: operations["getRun"];
        put?: never;
        post?: never;
        /**
         * Delete run
         * @description Deletes a run.
         */
        delete: operations["deleteRun"];
        options?: never;
        head?: never;
        /**
         * Update run
         * @description Updates a run’s title and labels.
         */
        patch: operations["updateRun"];
        trace?: never;
    };
    "/runs/{run_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel run
         * @description Requests cancellation of a run and its descendants.
         */
        post: operations["cancelRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/child-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List child runs
         * @description Lists child runs of a run.
         */
        get: operations["listRunChildRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/event-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create run event token
         * @description Creates a run event token.
         */
        post: operations["createRunEventToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run events
         * @description Lists recorded run events.
         */
        get: operations["listRunEvents"];
        put?: never;
        /**
         * Append run events
         * @description Appends run events.
         */
        post: operations["appendRunEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events/{event_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run event
         * @description Returns a run event.
         */
        get: operations["getRunEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/events/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run event summary
         * @description Summarizes run events.
         */
        get: operations["getRunEventsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/fail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fail a run
         * @description Fails a run.
         */
        post: operations["failRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finalize a run
         * @description Finalizes a run with output or an error.
         */
        post: operations["finalizeRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/heartbeats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send run heartbeat
         * @description Renews the run’s execution lease.
         */
        post: operations["createRunHeartbeat"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/input-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run input requests
         * @description Lists input requests for a run.
         */
        get: operations["listRunInputRequests"];
        put?: never;
        /**
         * Create input request
         * @description Creates an input request for a run.
         */
        post: operations["createRunInputRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause run
         * @description Requests a pause for a run.
         */
        post: operations["pauseRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume run
         * @description Resumes a waiting run.
         */
        post: operations["resumeRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run snapshot
         * @description Returns a run snapshot.
         */
        get: operations["getRunSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream run events
         * @description Streams live run events.
         */
        get: operations["streamRunEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}/succeed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Succeed a run
         * @description Completes a run successfully.
         */
        post: operations["succeedRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/event-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List run event types
         * @description Lists run event types and their payload schemas.
         */
        get: operations["listRunEventTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActivityDeltaPayload: {
            /** @enum {string} */
            type: "ACTIVITY_DELTA";
        } & {
            /** @enum {string} */
            type: "ACTIVITY_DELTA";
        };
        ActivitySnapshotPayload: {
            /** @enum {string} */
            type: "ACTIVITY_SNAPSHOT";
        } & {
            /** @enum {string} */
            type: "ACTIVITY_SNAPSHOT";
        };
        /** @description Immediate authenticated initiator, recorded by the server; execution credentials identify their issuing service account, not the original caller. */
        Actor: {
            id: string;
            /** @enum {string} */
            type: "user" | "api_key" | "service_account" | "system";
        };
        AgentRunAuthorizationSealedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_AUTHORIZATION_SEALED";
        };
        AgentRunAuthorizationSealedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_AUTHORIZATION_SEALED";
        };
        AgentRunBillingUsageRetainedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_BILLING_USAGE_RETAINED";
        };
        AgentRunBillingUsageRetainedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_BILLING_USAGE_RETAINED";
        };
        AgentRunContextCompactedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTEXT_COMPACTED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            firstKeptEntryId: string;
            /** @enum {string} */
            reason: "context_window" | "transport_body";
            /** Format: int64 */
            reserveTokens: number;
            summary: {
                text: string;
            };
            /** Format: int64 */
            tokenBudget: number;
            /** Format: int64 */
            tokensAfter: number;
            /** Format: int64 */
            tokensBefore: number;
            /** @enum {string} */
            type: "AGENT_RUN_CONTEXT_COMPACTED";
        };
        AgentRunContextCompactedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTEXT_COMPACTED";
        };
        AgentRunControlPlaneDispatchAcceptedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        } & {
            requestHash: string;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        };
        AgentRunControlPlaneDispatchAcceptedPayloadRead: {
            requestHash: string;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        } | {
            /** Format: uuid */
            dispatchAttemptId: string;
            /** Format: date-time */
            leaseExpiresAt: string;
            leaseOwner: string;
            /** Format: uuid */
            projectId: string;
            requestHash: string;
            /** Format: uuid */
            resumesDispatchAttemptId?: string;
            runId: string;
            /** @enum {string} */
            state: "intent_recorded";
            /** Format: int64 */
            transportRecoveryAttempt: number;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
            /**
             * Format: double
             * @enum {number}
             */
            version: 2;
        };
        AgentRunControlPlaneDispatchAcceptedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
        };
        AgentRunControlPlaneDispatchReceiptPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
        } & {
            requestHash: string;
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
        };
        AgentRunControlPlaneDispatchReceiptPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
        };
        AgentRunDefaultChatStartEnqueuedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
        };
        AgentRunDetachedAcceptedPayload: {
            /** Format: uuid */
            dispatchAttemptId: string;
            leaseOwner: string;
            /** @enum {string} */
            type: "AGENT_RUN_DETACHED_ACCEPTED";
        };
        AgentRunDetachedAcceptedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_DETACHED_ACCEPTED";
        };
        AgentRunIntegrationConnectionRefusedPayload: {
            integration: string;
            message: string;
            toolName: string;
            /** @enum {string} */
            type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
        };
        AgentRunInvokeAgentBillingModeRetainedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
        };
        AgentRunInvokeAgentBillingModeRetainedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
        };
        AgentRunModelCallContextPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messages: ({
                content: string;
                providerOptions?: {
                    [key: string]: {
                        cacheControl: {
                            /** @enum {string} */
                            ttl?: "5m" | "1h";
                            /** @enum {string} */
                            type: "ephemeral";
                        };
                    };
                };
                /** @enum {string} */
                role: "system";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    filename?: string;
                    mediaType: string;
                    /** @enum {string} */
                    type: "image" | "file";
                    url: string;
                })[];
                /** @enum {string} */
                role: "user";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    input: unknown;
                    providerExecuted?: boolean;
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-call";
                })[];
                /** @enum {string} */
                role: "assistant";
            } | {
                content: {
                    output: {
                        /** @enum {string} */
                        type: "json";
                        value: unknown;
                    };
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-result";
                }[];
                /** @enum {string} */
                role: "tool";
            })[];
            model?: {
                id: string;
                modelProvider?: string;
            };
            request?: {
                /** Format: double */
                frequencyPenalty?: number;
                /** Format: double */
                maxOutputTokens?: number;
                /** Format: double */
                presencePenalty?: number;
                reasoning?: {
                    /** Format: int64 */
                    budgetTokens?: number;
                    /** @enum {string} */
                    effort?: "low" | "medium" | "high" | "max";
                    enabled?: boolean;
                };
                /** Format: double */
                seed?: number;
                stopSequences?: string[];
                /** Format: double */
                temperature?: number;
                /** Format: double */
                topK?: number;
                /** Format: double */
                topP?: number;
            };
            tools?: ({
                description?: string;
                inputSchema: unknown;
                name: string;
                /** @enum {string} */
                type: "function";
            } | {
                args: {
                    [key: string]: unknown;
                };
                id: string;
                name: string;
                /** @enum {string} */
                type: "provider";
            })[];
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT";
        };
        AgentRunModelCallContextPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT";
        };
        AgentRunModelCallContextRecordedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messages: ({
                content: string;
                providerOptions?: {
                    [key: string]: {
                        cacheControl: {
                            /** @enum {string} */
                            ttl?: "5m" | "1h";
                            /** @enum {string} */
                            type: "ephemeral";
                        };
                    };
                };
                /** @enum {string} */
                role: "system";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    filename?: string;
                    mediaType: string;
                    /** @enum {string} */
                    type: "image" | "file";
                    url: string;
                })[];
                /** @enum {string} */
                role: "user";
            } | {
                content: ({
                    text: string;
                    /** @enum {string} */
                    type: "text";
                } | {
                    input: unknown;
                    providerExecuted?: boolean;
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-call";
                })[];
                /** @enum {string} */
                role: "assistant";
            } | {
                content: {
                    output: {
                        /** @enum {string} */
                        type: "json";
                        value: unknown;
                    };
                    toolCallId: string;
                    toolName: string;
                    /** @enum {string} */
                    type: "tool-result";
                }[];
                /** @enum {string} */
                role: "tool";
            })[];
            model?: {
                id: string;
                modelProvider?: string;
            };
            request?: {
                /** Format: double */
                frequencyPenalty?: number;
                /** Format: double */
                maxOutputTokens?: number;
                /** Format: double */
                presencePenalty?: number;
                reasoning?: {
                    /** Format: int64 */
                    budgetTokens?: number;
                    /** @enum {string} */
                    effort?: "low" | "medium" | "high" | "max";
                    enabled?: boolean;
                };
                /** Format: double */
                seed?: number;
                stopSequences?: string[];
                /** Format: double */
                temperature?: number;
                /** Format: double */
                topK?: number;
                /** Format: double */
                topP?: number;
            };
            tools?: ({
                description?: string;
                inputSchema: unknown;
                name: string;
                /** @enum {string} */
                type: "function";
            } | {
                args: {
                    [key: string]: unknown;
                };
                id: string;
                name: string;
                /** @enum {string} */
                type: "provider";
            })[];
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
        };
        AgentRunModelCallContextRecordedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
        };
        AgentRunProviderReplayCheckpointedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messageId: string;
            /** @enum {string} */
            provider: "anthropic" | "openai-responses";
            providerBlockPositions: number[];
            providerBlocks: {
                block: {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                provider: "anthropic" | "openai-responses";
                /** @enum {string} */
                type: "provider-block";
            }[];
            providerMessageBlockCounts?: number[];
            /** Format: int64 */
            totalPartCount: number;
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            /**
             * Format: double
             * @enum {number}
             */
            version: 1;
        };
        AgentRunProviderReplayCheckpointedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
        };
        AgentRunProviderReplayCheckpointPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
        } & {
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            messageId: string;
            /** @enum {string} */
            provider: "anthropic" | "openai-responses";
            providerBlockPositions: number[];
            providerBlocks: {
                block: {
                    [key: string]: unknown;
                };
                /** @enum {string} */
                provider: "anthropic" | "openai-responses";
                /** @enum {string} */
                type: "provider-block";
            }[];
            providerMessageBlockCounts?: number[];
            /** Format: int64 */
            totalPartCount: number;
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            /**
             * Format: double
             * @enum {number}
             */
            version: 1;
        };
        AgentRunProviderReplayCheckpointPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
        };
        AgentRunProviderReplayTurnFinishedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
        };
        AgentRunProviderReplayTurnFinishedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
        };
        AgentRunProviderReplayTurnStartedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
        };
        AgentRunProviderReplayTurnStartedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
        };
        AgentRunReplayedUploadsSealedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
        };
        AgentRunReplayedUploadsSealedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
        };
        AgentRunRequestEnqueuedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_REQUEST_ENQUEUED";
        };
        AgentRunRuntimeInvokeRetriedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
        };
        AgentRunRuntimeOwnerBoundPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
        };
        AgentRunToolExposureCheckpointedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
        } & {
            authorizedCatalogFingerprint?: string;
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            loadedToolNames: string[];
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            version: 1 | 2;
        };
        AgentRunToolExposureCheckpointedPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
        };
        AgentRunToolExposureCheckpointPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
        } & {
            authorizedCatalogFingerprint?: string;
            /** Format: double */
            elapsedMs?: number;
            /** Format: int64 */
            emittedAt?: number;
            loadedToolNames: string[];
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            version: 1 | 2;
        };
        AgentRunToolExposureCheckpointPayloadRedacted: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
        };
        AgentRunToolResultDeliveryFailedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
        };
        AgentRunToolResultSubmittedPayload: {
            /** @enum {string} */
            type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
        };
        AppendRunEventsRequest: {
            events: (components["schemas"]["TextMessageStartPayload"] | components["schemas"]["TextMessageContentPayload"] | components["schemas"]["TextMessageEndPayload"] | components["schemas"]["ToolCallStartPayload"] | components["schemas"]["ToolCallArgsPayload"] | components["schemas"]["ToolCallChunkPayload"] | components["schemas"]["ToolCallEndPayload"] | components["schemas"]["ToolCallResultPayload"] | components["schemas"]["MessagesSnapshotPayload"] | components["schemas"]["StateSnapshotPayload"] | components["schemas"]["StateDeltaPayload"] | components["schemas"]["RunStartedPayload"] | components["schemas"]["RunFinishedPayload"] | components["schemas"]["RunErrorPayload"] | components["schemas"]["StepStartedPayload"] | components["schemas"]["StepFinishedPayload"] | components["schemas"]["ReasoningStartPayload"] | components["schemas"]["ReasoningMessageStartPayload"] | components["schemas"]["ReasoningMessageContentPayload"] | components["schemas"]["ReasoningMessageEndPayload"] | components["schemas"]["ReasoningContentPayload"] | components["schemas"]["ReasoningEndPayload"] | components["schemas"]["ActivitySnapshotPayload"] | components["schemas"]["ActivityDeltaPayload"] | components["schemas"]["ToolCallStatusChangedPayload"] | components["schemas"]["InputRequestCreatedPayload"] | components["schemas"]["InputRequestUpdatedPayload"] | components["schemas"]["ChildRunStatusChangedPayload"] | components["schemas"]["ModelCallCompletedPayload"] | components["schemas"]["RunParkedPayload"] | components["schemas"]["RunLogCapturedPayload"] | components["schemas"]["StreamHeartbeatEmittedPayload"] | components["schemas"]["UrlCitedPayload"] | components["schemas"]["DocumentCitedPayload"] | components["schemas"]["FileAttachedPayload"] | components["schemas"]["FilesChangedPayload"] | components["schemas"]["RuntimeEventRecordedPayload"] | components["schemas"]["AgentRunContextCompactedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayload"] | components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"] | components["schemas"]["AgentRunToolExposureCheckpointedPayload"] | components["schemas"]["AgentRunToolExposureCheckpointPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointedPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointPayload"] | components["schemas"]["AgentRunModelCallContextRecordedPayload"] | components["schemas"]["AgentRunModelCallContextPayload"])[];
            expected_previous_event_id?: number | null;
            expected_previous_external_event_sequence?: number | null;
            /** @enum {string} */
            external_sequence_scope?: "agent" | "publish_only";
        };
        AppendRunEventsResponse: {
            /** Format: int64 */
            appended_count: number;
            /** Format: int64 */
            latest_event_id: number;
            /** Format: int64 */
            latest_external_event_sequence?: number;
            /** Format: uuid */
            run_id: string;
        };
        ChildRunStatusChangedPayload: {
            childAgentId?: string | null;
            childConversationId?: string | null;
            childMessageId?: string | null;
            childRunId: string;
            description?: string;
            status: string;
            toolCallId: string;
            /** @enum {string} */
            type: "CHILD_RUN_STATUS_CHANGED";
        } & {
            childAgentId?: string | null;
            childConversationId?: string | null;
            childMessageId?: string | null;
            childRunId: string;
            description?: string;
            status: string;
            toolCallId: string;
            /** @enum {string} */
            type: "CHILD_RUN_STATUS_CHANGED";
        };
        /** @description Estimated EUR usage value before tax: total values billed credits at EUR 0.10 each; provider converts recorded USD cost at the catalog reference rate; platform is total minus provider and can be negative. These amounts are visible to authorized run readers and do not represent invoice charges or actual purchase prices. Descendants sum the same per-run amounts. Credits are exact billed units. Signed decimal strings have at most eight fractional digits. Unknown provider costs leave provider and platform null. Status is independent of token capture; unavailable requires all amounts null. Posted amounts come from the billing ledger and may change through later adjustments. */
        Cost: {
            /** @description Billed credit units. */
            credits: string | null;
            /**
             * @description Currency of reference usage value and provider costs.
             * @enum {string}
             */
            currency: "EUR";
            /** @description Reference usage value minus estimated provider cost; null when either amount is unknown. */
            platform: string | null;
            /** @description Recorded provider USD cost converted to EUR at the catalog reference rate; null when unknown. */
            provider: string | null;
            /**
             * @description Whether charges are estimated, posted or unavailable.
             * @enum {string}
             */
            status: "estimated" | "posted" | "unavailable";
            /** @description Billed credits valued at EUR 0.10 per credit, independent of subscription or purchase discounts. */
            total: string | null;
        } & unknown;
        /** @description A newly created run with resolved target and recorded trigger. */
        CreatedRun: {
            /** @description Files produced by the run. */
            artifacts?: components["schemas"]["RunArtifact"][];
            /**
             * Format: uuid
             * @description Batch containing the run.
             */
            batch_id?: string;
            /** @description Definition-specific execution configuration. */
            config?: {
                [key: string]: unknown;
            };
            /** @description Pending control requests and the current wait. */
            control?: {
                cancellation?: components["schemas"]["RunCancellation"];
                pause?: components["schemas"]["RunPause"];
                waiting?: components["schemas"]["RunWait"];
            };
            /**
             * Format: uuid
             * @description Conversation containing the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the run was accepted.
             */
            created_at: string;
            /** @description Counts and usage across all descendant runs, excluding this run. */
            descendants?: {
                /**
                 * Format: int64
                 * @description Descendants that are pending, running or waiting.
                 */
                active: number;
                /** @description Whether any descendant has failed. */
                has_failures: boolean;
                /**
                 * Format: int64
                 * @description Total descendants at every depth.
                 */
                total: number;
                /** @description Aggregate usage of every descendant, excluding this run. */
                usage?: components["schemas"]["Usage"];
            };
            /** @description Failure details, present only when the run failed. */
            error?: components["schemas"]["RunFailure"];
            /** @description Resolved execution settings and diagnostics. */
            execution?: {
                /**
                 * Format: int64
                 * @description Current or last execution attempt, starting at 1; absent before execution.
                 */
                attempt?: number;
                /**
                 * Format: int64
                 * @description Elapsed time from first start to finish, including waits and retries; null when not finished.
                 */
                duration_ms?: number | null;
                /** @description Runtime process exit code, or null when no exit code was recorded. */
                exit_code?: number | null;
                /** @description Captured runtime text logs, when available. */
                logs?: string;
                /**
                 * Format: int64
                 * @description Maximum retries after the first attempt; only retryable failures are retried.
                 */
                retry_limit?: number;
                /** @description Resolved logical runtime selection; main_branch identifies the selected main-branch deployment, not a worker process. */
                runtime?: components["schemas"]["RunRuntime"];
                /** @description Recorded execution start mode, when available. */
                start_mode?: string;
                /**
                 * Format: int64
                 * @description Deadline for the whole run in seconds, measured from its first start and including retries.
                 */
                timeout_seconds?: number;
                /**
                 * Format: int64
                 * @description Recorded failed tool invocations during this run.
                 */
                tool_error_count?: number;
            };
            /**
             * Format: date-time
             * @description When the run completed, failed or was cancelled.
             */
            finished_at?: string;
            /**
             * Format: uuid
             * @description Unique run UUID.
             */
            id: string;
            /** @description Business input supplied when the run was created. */
            input: unknown;
            /**
             * Format: uuid
             * @description Conversation message that supplied the input.
             */
            input_message_id?: string;
            /** @description Labels used to organize runs. */
            labels?: components["schemas"]["RunLabels"];
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /** @description Final business output; null until successful finalization. */
            output: unknown;
            /**
             * Format: uuid
             * @description Conversation message containing the result.
             */
            output_message_id?: string;
            /**
             * Format: uuid
             * @description Immediate parent run ID, present on child runs.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description Project containing the run.
             */
            project_id: string;
            /**
             * Format: uuid
             * @description Top-level ancestor run ID, present on child runs.
             */
            root_run_id?: string;
            /** @description Pinned schemas for business input and output; null means no declared schema. */
            schemas?: {
                input: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
                output: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
            };
            /**
             * Format: date-time
             * @description When the first execution attempt started, omitted before execution.
             */
            started_at?: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
            /** @description Resolved execution definition. */
            target: components["schemas"]["RunTarget"];
            /** @description Orchestration task ID, distinct from the execution definition. */
            task_id?: string;
            /** @description Display title, omitted when unset. */
            title?: string;
            /** @description How execution was initiated. */
            trigger: components["schemas"]["RunTrigger"];
            /**
             * Format: date-time
             * @description When the resource last changed, including usage updates.
             */
            updated_at: string;
            /** @description Usage when available; unknown measurements are null. */
            usage?: components["schemas"]["Usage"];
        } & (unknown & unknown & unknown & unknown & unknown & unknown & unknown);
        CreateInputRequestRequest: {
            description?: string;
            /** Format: date-time */
            expires_at?: string;
            fields: components["schemas"]["InputRequestField"][];
            metadata?: {
                [key: string]: unknown;
            };
            /**
             * @default human
             * @enum {string}
             */
            requested_responder_type: "human" | "agent" | "system";
            title: string;
            /** @description Tool invocation to request input for. Defaults to the run’s current waiting invocation. */
            tool_call_id?: string;
        };
        CreateInputRequestRequestInput: {
            description?: string;
            /** Format: date-time */
            expires_at?: string;
            fields: components["schemas"]["InputRequestFieldInput"][];
            metadata?: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            requested_responder_type?: "human" | "agent" | "system";
            title: string;
            /** @description Tool invocation to request input for. Defaults to the run’s current waiting invocation. */
            tool_call_id?: string;
        };
        CreateRunHeartbeatRequest: {
            /**
             * Format: int64
             * @default 60
             */
            lease_duration_seconds: number;
        };
        CreateRunHeartbeatRequestInput: {
            /** Format: int64 */
            lease_duration_seconds?: number;
        };
        /** @description Create a direct run with project_id, target:{type,id}, and optional input, or execute a saved schedule or webhook. Input is business data; configuration and execution settings are separate. */
        CreateRunRequest: components["schemas"]["DirectRunRequest"] | components["schemas"]["ScheduleRunRequest"] | components["schemas"]["WebhookRunRequest"];
        /** @description The full created run when readable by the caller; otherwise only its admission receipt. Replay uses the same caller visibility. */
        CreateRunResult: components["schemas"]["CreatedRun"] | components["schemas"]["RunCreationReceipt"];
        DirectRunRequest: {
            /**
             * Format: uuid
             * @description Batch UUID associated with the accepted run.
             */
            batch_id?: string;
            /** @description Definition-specific configuration; business keys retain their spelling on every transport. */
            config?: {
                [key: string]: unknown;
            };
            /**
             * Format: uuid
             * @description Conversation associated with an agent admission, when applicable.
             */
            conversation_id?: string;
            /** @description Execution overrides, separate from business input and configuration. */
            execution?: components["schemas"]["RunExecutionOptions"];
            /** @description Business input passed to the definition unchanged; omitted input resolves to null. */
            input?: unknown;
            labels?: components["schemas"]["RunLabels"];
            /** @description Started workflow node on the parent; requires parent_run_id and excludes tool_call_id. */
            node_id?: string;
            /**
             * Format: uuid
             * @description Canonical UUID of the authenticated runtime parent; ordinary users cannot assert parent authority.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description UUID of the project containing the execution definition or saved source.
             */
            project_id: string;
            target: components["schemas"]["RunTarget"];
            /** @description Optional display title for the accepted run. */
            title?: string;
            /** @description Durable tool invocation on an agent parent; requires parent_run_id and excludes node_id. */
            tool_call_id?: string;
        } & unknown;
        DocumentCitedPayload: {
            filename?: string;
            mediaType: string;
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "DOCUMENT_CITED";
        } & {
            filename?: string;
            mediaType: string;
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "DOCUMENT_CITED";
        };
        EvaluationMetricResult: {
            evidence?: {
                [key: string]: unknown;
            };
            explanation?: string;
            /** @enum {string} */
            family: "answer" | "agent" | "ops" | "judge" | "knowledge" | "check";
            name: string;
            passed?: boolean;
            /** Format: double */
            score?: number;
            /** @enum {string} */
            severity: "gate" | "soft" | "budget";
            skipped?: boolean;
        };
        EvaluationRecord: {
            checks: components["schemas"]["EvaluationMetricResult"][];
            citations?: {
                metadata?: {
                    [key: string]: unknown;
                };
                quote?: string;
                source: string;
                text?: string;
            }[];
            completed: boolean;
            /** Format: int64 */
            duration_ms: number;
            error?: components["schemas"]["RunFailure"];
            example_id: string;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            execution_input?: unknown;
            id: string;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            input: unknown;
            metadata: {
                [key: string]: unknown;
            };
            metrics: components["schemas"]["EvaluationMetricResult"][];
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            output: unknown;
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            reference?: unknown;
            /** Format: int64 */
            repetition: number;
            retrieved_context?: {
                content?: string;
                metadata?: {
                    [key: string]: unknown;
                };
                source: string;
                title?: string;
            }[];
            trace?: components["schemas"]["EvaluationTrace"];
            usage?: components["schemas"]["Usage"];
        };
        /** @description Public evaluation report version 1, mapped from the internal report format; internal schemaVersion is a separate version. */
        EvaluationReport: {
            /** Format: date-time */
            completed_at: string;
            dataset?: {
                /** Format: int64 */
                examples: number;
                hash: string;
                kind: string;
                path?: string;
            };
            eval_id: string;
            exports?: {
                [key: string]: unknown;
            }[];
            metadata?: {
                [key: string]: unknown;
            };
            records: components["schemas"]["EvaluationRecord"][];
            /** Format: uuid */
            run_id: string;
            /**
             * Format: double
             * @enum {number}
             */
            schema_version: 1;
            /** Format: date-time */
            started_at: string;
            summary: components["schemas"]["EvaluationSummary"];
            target: string;
        };
        /** @description Read output.report from standard run detail: either the inline report or an explicit artifact reference; serialized run.output remains at most 1 MiB. */
        EvaluationRunOutput: {
            report: components["schemas"]["EvaluationReport"];
            /** @enum {string} */
            report_storage: "inline";
        } | {
            report: components["schemas"]["RunArtifact"];
            /** @enum {string} */
            report_storage: "artifact";
            summary: components["schemas"]["EvaluationSummary"];
        };
        EvaluationSummary: {
            duration?: {
                /** Format: int64 */
                max_ms: number;
                /** Format: double */
                mean_ms: number;
                /** Format: int64 */
                min_ms: number;
                /** Format: int64 */
                p50_ms: number;
                /** Format: int64 */
                p95_ms: number;
                /** Format: int64 */
                total_ms: number;
            };
            /** Format: int64 */
            failed: number;
            failed_examples?: {
                example_id: string;
                /** Format: int64 */
                failed: number;
                flaky: boolean;
                /** Format: double */
                pass_rate: number;
                /** Format: int64 */
                passed: number;
                /** Format: int64 */
                records: number;
            }[];
            flakes?: {
                /** Format: int64 */
                examples: number;
                /** Format: int64 */
                flaky: number;
                /** Format: int64 */
                stable_failed: number;
                /** Format: int64 */
                stable_passed: number;
            };
            gate_failures?: {
                evidence?: {
                    [key: string]: unknown;
                };
                example_id: string;
                explanation?: string;
                family: string;
                name: string;
                record_id: string;
                /** Format: int64 */
                repetition: number;
                /** @enum {string} */
                severity: "gate" | "budget";
            }[];
            metrics?: {
                /** Format: int64 */
                failed: number;
                /** @enum {string} */
                family: "answer" | "agent" | "ops" | "judge" | "knowledge" | "check";
                name: string;
                /** Format: double */
                pass_rate: number;
                /** Format: int64 */
                passed: number;
                /** @enum {string} */
                severity: "gate" | "soft" | "budget";
                /** Format: int64 */
                skipped: number;
            }[];
            /** Format: double */
            pass_rate: number;
            /** Format: int64 */
            passed: number;
            /** Format: int64 */
            records: number;
            /** Format: int64 */
            skipped: number;
            usage?: components["schemas"]["Usage"];
        };
        EvaluationTrace: {
            events: unknown[];
            tool_calls: {
                error?: string;
                id?: string;
                /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
                input?: unknown;
                metadata?: {
                    [key: string]: unknown;
                };
                name: string;
                /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
                output?: unknown;
                /** @enum {string} */
                status?: "ok" | "error" | "skipped" | "denied";
            }[];
        };
        /** @description Error for a failed run. */
        FailRunRequest: {
            error: components["schemas"]["RunFailure"];
        };
        FileAttachedPayload: {
            filename?: string;
            mediaType: string;
            /** @enum {string} */
            type: "FILE_ATTACHED";
            url?: string;
        } & {
            filename?: string;
            mediaType: string;
            /** @enum {string} */
            type: "FILE_ATTACHED";
            url?: string;
        };
        FilesChangedPayload: {
            changes: unknown;
            id: string | null;
            status: string | null;
            /** @enum {string} */
            type: "FILES_CHANGED";
        } & {
            changes: unknown;
            id: string | null;
            status: string | null;
            /** @enum {string} */
            type: "FILES_CHANGED";
        };
        /** @description Finalizes a run with output or an error. */
        FinalizeRunRequest: {
            /** @description Any JSON value. The HTTP boundary rejects non-JSON values. */
            output: unknown;
            /** @enum {string} */
            status: "completed";
        } | {
            error: components["schemas"]["RunFailure"];
            /** @enum {string} */
            status: "failed";
        };
        /** @description Recorded execution definition; historical IDs may be unavailable. */
        HistoricalRunTarget: {
            /** @description Definition ID; null when unavailable on a historical run. */
            id: string | null;
            /**
             * @description Execution definition type.
             * @enum {string}
             */
            type: "agent" | "task" | "workflow" | "eval";
        };
        InputRequest: {
            /**
             * Format: uuid
             * @description Conversation inherited from the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the request was created.
             */
            created_at: string;
            /** @description Additional instructions for the responder. */
            description?: string;
            /**
             * Format: date-time
             * @description When the request expires.
             */
            expires_at?: string;
            /** @description Fields the responder can fill in. */
            fields: components["schemas"]["InputRequestField"][];
            /**
             * Format: uuid
             * @description Unique input request ID.
             */
            input_request_id: string;
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /**
             * Format: uuid
             * @description Project inherited from the run.
             */
            project_id: string;
            /**
             * @description Required responder role; the authenticated actor identifies who actually responded.
             * @enum {string}
             */
            requested_responder_type: "human" | "agent" | "system";
            /**
             * Format: date-time
             * @description When the request was submitted, cancelled or expired.
             */
            resolved_at?: string;
            /** @description Submitted response, or null before submission or after cancellation or expiry. */
            response: components["schemas"]["InputResponse"] | null;
            /**
             * Format: uuid
             * @description Run waiting for this input.
             */
            run_id: string;
            /**
             * @description Current resolution state.
             * @enum {string}
             */
            status: "open" | "submitted" | "cancelled" | "expired";
            /** @description Question or decision shown to the responder. */
            title: string;
            /** @description Tool invocation waiting for the response. */
            tool_call_id?: string;
        } & (unknown & unknown);
        InputRequestCreatedPayload: {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_CREATED";
        } & {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_CREATED";
        };
        InputRequestField: {
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "password";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "text" | "textarea" | "email" | "url";
        } | {
            /** Format: double */
            default?: number;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "number";
        } | {
            default?: boolean;
            description?: string;
            label?: string;
            name: string;
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "checkbox" | "confirm";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            options: {
                description?: string;
                label: string;
                recommended?: boolean;
                value: string;
            }[];
            /** @default false */
            required: boolean;
            /** @enum {string} */
            type: "select" | "radio";
        };
        InputRequestFieldInput: {
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "password";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "text" | "textarea" | "email" | "url";
        } | {
            /** Format: double */
            default?: number;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "number";
        } | {
            default?: boolean;
            description?: string;
            label?: string;
            name: string;
            required?: boolean;
            /** @enum {string} */
            type: "checkbox" | "confirm";
        } | {
            default?: string;
            description?: string;
            label?: string;
            name: string;
            options: {
                description?: string;
                label: string;
                recommended?: boolean;
                value: string;
            }[];
            required?: boolean;
            /** @enum {string} */
            type: "select" | "radio";
        };
        InputRequestUpdatedPayload: {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_UPDATED";
        } & {
            inputRequest: {
                id: string;
            };
            /** @enum {string} */
            type: "INPUT_REQUEST_UPDATED";
        };
        InputResponse: {
            /** @description Authenticated principal that submitted the response, or `unavailable` for a historical response without authoritative provenance. */
            actor: components["schemas"]["Actor"] | components["schemas"]["UnavailableActor"];
            /**
             * Format: date-time
             * @description When the response was submitted.
             */
            created_at: string;
            /** @description Names of submitted secret fields omitted from values. */
            redacted_fields?: string[];
            /**
             * Format: uuid
             * @description Unique response ID.
             */
            response_id: string;
            /** @description Submitted values keyed by field name; password values are omitted from reads. */
            values: components["schemas"]["InputValues"];
        };
        InputValues: {
            [key: string]: string | number | boolean | null;
        };
        ListInputRequestsResponse: {
            data: components["schemas"]["InputRequest"][];
            page_info: components["schemas"]["PageInfo"];
        };
        ListRunEventsResponse: {
            data: components["schemas"]["RunEvent"][];
            page_info: components["schemas"]["PageInfo"];
        };
        ListRunEventTypesResponse: {
            data: {
                custom_names?: string[];
                description: string;
                /** @enum {string} */
                event_class: "fact" | "delta";
                fields: string[];
                group: string | null;
                legacy_types?: string[];
                name: string;
                /** @enum {string} */
                scope: "ag-ui" | "control-plane" | "extension";
                /** @enum {string} */
                status: "active" | "live_only" | "reserved" | "deprecated";
                type: string;
                /** @enum {string} */
                viewer_visibility: "full" | "sanitised" | "type_only";
            }[];
        };
        ListRunsResponse: {
            data: components["schemas"]["Run"][];
            page_info: components["schemas"]["PageInfo"];
        };
        MessagesSnapshotPayload: {
            messages: {
                [key: string]: unknown;
            }[];
            /** @enum {string} */
            type: "MESSAGES_SNAPSHOT";
        } & {
            messages: {
                content?: unknown;
                id?: string;
                parts?: {
                    type: string;
                }[];
                role?: string;
            }[];
            /** @enum {string} */
            type: "MESSAGES_SNAPSHOT";
        };
        ModelCallCompletedPayload: {
            /** Format: int64 */
            cacheCreationTokens: number;
            /** Format: int64 */
            cacheReadTokens: number;
            costCredits: string;
            /** Format: int64 */
            inputTokens: number;
            latencyMs: number | null;
            model: string;
            modelCallContextEventId: number | null;
            /** Format: int64 */
            outputTokens: number;
            provider: string;
            providerRequestId: string | null;
            /** Format: int64 */
            totalTokens: number;
            /** @enum {string} */
            type: "MODEL_CALL_COMPLETED";
            /** @enum {string} */
            usageCaptureStatus: "complete" | "partial" | "missing";
        } & {
            /** Format: int64 */
            cacheCreationTokens: number;
            /** Format: int64 */
            cacheReadTokens: number;
            costCredits: string;
            /** Format: int64 */
            inputTokens: number;
            latencyMs: number | null;
            model: string;
            modelCallContextEventId: number | null;
            /** Format: int64 */
            outputTokens: number;
            provider: string;
            providerRequestId: string | null;
            /** Format: int64 */
            totalTokens: number;
            /** @enum {string} */
            type: "MODEL_CALL_COMPLETED";
            /** @enum {string} */
            usageCaptureStatus: "complete" | "partial" | "missing";
        };
        /** @description Opaque cursor for the next page; null means there are no more results. */
        PageInfo: {
            next: string | null;
        };
        PaginationCursor: string;
        Problem: {
            /**
             * @description Schedule admission refusal.
             * @enum {string}
             */
            cause?: "schedule_concurrency_forbidden" | "schedule_fire_in_progress";
            code: string;
            detail?: string;
            errors?: {
                field: string;
                message: string;
            }[];
            instance?: string;
            /** Format: int64 */
            status: number;
            title: string;
            /** @description Problem type URI reference. */
            type: string;
        };
        ProjectReference: string;
        ReasoningContentPayload: {
            delta: string;
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_CONTENT";
        } & {
            /** @enum {string} */
            type: "REASONING_CONTENT";
        };
        ReasoningEndPayload: {
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_END";
        } & {
            /** @enum {string} */
            type: "REASONING_END";
        };
        ReasoningMessageContentPayload: {
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_CONTENT";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_CONTENT";
        };
        ReasoningMessageEndPayload: {
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_END";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_END";
        };
        ReasoningMessageStartPayload: {
            messageId: string;
            /** @enum {string} */
            type: "REASONING_MESSAGE_START";
        } & {
            /** @enum {string} */
            type: "REASONING_MESSAGE_START";
        };
        ReasoningStartPayload: {
            messageId?: string;
            /** @enum {string} */
            type: "REASONING_START";
        } & {
            /** @enum {string} */
            type: "REASONING_START";
        };
        RespondToInputRequestRequest: {
            values: components["schemas"]["InputValues"];
        };
        ResumeRunRequest: {
            /** @enum {string} */
            type: "manual";
        } | {
            is_error?: boolean;
            /** @description A JSON value. */
            result: unknown;
            tool_call_id: string;
            /** @enum {string} */
            type: "tool_result";
        } | {
            integration: string;
            /** @enum {string} */
            type: "integration_connected";
        } | {
            approved: boolean;
            comment?: string;
            node_id: string;
            /** @enum {string} */
            type: "approval";
            wait_id: string;
        } | {
            name: string;
            /** @description A JSON value. */
            payload?: unknown;
            /** @enum {string} */
            type: "event";
            wait_id: string;
        };
        /** @description One execution resource returned by reads, creation, updates, and lifecycle actions. Omit irrelevant fields and empty groups. Errors appear only on failure; parent/root IDs only on child runs; timestamps appear when reached. Output is null until successful finalization. */
        Run: {
            /** @description Files produced by the run. */
            artifacts?: components["schemas"]["RunArtifact"][];
            /**
             * Format: uuid
             * @description Batch containing the run.
             */
            batch_id?: string;
            /** @description Definition-specific execution configuration. */
            config?: {
                [key: string]: unknown;
            };
            /** @description Pending control requests and the current wait. */
            control?: {
                cancellation?: components["schemas"]["RunCancellation"];
                pause?: components["schemas"]["RunPause"];
                waiting?: components["schemas"]["RunWait"];
            };
            /**
             * Format: uuid
             * @description Conversation containing the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the run was accepted.
             */
            created_at: string;
            /** @description Counts and usage across all descendant runs, excluding this run. */
            descendants?: {
                /**
                 * Format: int64
                 * @description Descendants that are pending, running or waiting.
                 */
                active: number;
                /** @description Whether any descendant has failed. */
                has_failures: boolean;
                /**
                 * Format: int64
                 * @description Total descendants at every depth.
                 */
                total: number;
                /** @description Aggregate usage of every descendant, excluding this run. */
                usage?: components["schemas"]["Usage"];
            };
            /** @description Failure details, present only when the run failed. */
            error?: components["schemas"]["RunFailure"];
            /** @description Resolved execution settings and diagnostics. */
            execution?: {
                /**
                 * Format: int64
                 * @description Current or last execution attempt, starting at 1; absent before execution.
                 */
                attempt?: number;
                /**
                 * Format: int64
                 * @description Elapsed time from first start to finish, including waits and retries; null when not finished.
                 */
                duration_ms?: number | null;
                /** @description Runtime process exit code, or null when no exit code was recorded. */
                exit_code?: number | null;
                /** @description Captured runtime text logs, when available. */
                logs?: string;
                /**
                 * Format: int64
                 * @description Maximum retries after the first attempt; only retryable failures are retried.
                 */
                retry_limit?: number;
                /** @description Resolved logical runtime selection; main_branch identifies the selected main-branch deployment, not a worker process. */
                runtime?: components["schemas"]["RunRuntime"];
                /** @description Recorded execution start mode, when available. */
                start_mode?: string;
                /**
                 * Format: int64
                 * @description Deadline for the whole run in seconds, measured from its first start and including retries.
                 */
                timeout_seconds?: number;
                /**
                 * Format: int64
                 * @description Recorded failed tool invocations during this run.
                 */
                tool_error_count?: number;
            };
            /**
             * Format: date-time
             * @description When the run completed, failed or was cancelled.
             */
            finished_at?: string;
            /**
             * Format: uuid
             * @description Unique run UUID.
             */
            id: string;
            /** @description Business input supplied when the run was created. */
            input: unknown;
            /**
             * Format: uuid
             * @description Conversation message that supplied the input.
             */
            input_message_id?: string;
            /** @description Labels used to organize runs. */
            labels?: components["schemas"]["RunLabels"];
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /** @description Final business output; null until successful finalization. */
            output: unknown;
            /**
             * Format: uuid
             * @description Conversation message containing the result.
             */
            output_message_id?: string;
            /**
             * Format: uuid
             * @description Immediate parent run ID, present on child runs.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description Project containing the run.
             */
            project_id: string;
            /**
             * Format: uuid
             * @description Top-level ancestor run ID, present on child runs.
             */
            root_run_id?: string;
            /** @description Pinned schemas for business input and output; null means no declared schema. */
            schemas?: {
                input: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
                output: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
            };
            /**
             * Format: date-time
             * @description When the first execution attempt started, omitted before execution.
             */
            started_at?: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
            /** @description Execution definition; its ID may be null only on historical runs. */
            target: components["schemas"]["HistoricalRunTarget"];
            /** @description Orchestration task ID, distinct from the execution definition. */
            task_id?: string;
            /** @description Display title, omitted when unset. */
            title?: string;
            /** @description How execution was initiated. */
            trigger?: components["schemas"]["RunTrigger"];
            /**
             * Format: date-time
             * @description When the resource last changed, including usage updates.
             */
            updated_at: string;
            /** @description Usage when available; unknown measurements are null. */
            usage?: components["schemas"]["Usage"];
        } & (unknown & unknown & unknown & unknown & unknown & unknown & unknown);
        RunAnalytics: {
            models: {
                /**
                 * Format: double
                 * @description Number of uses.
                 */
                count: number;
                /** @description AI model identifier. */
                model: string;
                /** @description AI provider. */
                provider: string;
            }[];
            projects: {
                /**
                 * Format: double
                 * @description Number of matching records.
                 */
                count: number;
                /**
                 * Format: uuid
                 * @description Project ID, or null for unscoped usage.
                 */
                project_id: string | null;
                /** @description Project display name. */
                project_name: string;
                /** @description Project slug, or null when unavailable. */
                project_slug: string | null;
            }[];
            recent_runs: components["schemas"]["Run"][];
            series: {
                /** @description Bucket start timestamp. */
                bucket_start: string;
                /**
                 * Format: double
                 * @description Completed runs in the bucket.
                 */
                completed_runs: number;
                /**
                 * Format: double
                 * @description Failed runs in the bucket.
                 */
                failed_runs: number;
                /**
                 * Format: double
                 * @description Runs created in the bucket.
                 */
                runs: number;
            }[];
            statuses: {
                /**
                 * Format: double
                 * @description Number of matching records.
                 */
                count: number;
                /** @description Status or outcome label. */
                status: string;
            }[];
            summary: {
                /** @description Average finished run duration in milliseconds. */
                average_duration_ms: number | null;
                /**
                 * Format: double
                 * @description Completed runs in the timeframe.
                 */
                completed_runs: number;
                /**
                 * Format: double
                 * @description Failed runs in the timeframe.
                 */
                failed_runs: number;
                /** @description Most recent run creation timestamp. */
                last_run_at: string | null;
                /** @description 95th percentile finished run duration in milliseconds. */
                p95_duration_ms: number | null;
                /**
                 * Format: double
                 * @description Total agent runs in the timeframe.
                 */
                total_runs: number;
            };
            timeframe: {
                /**
                 * Format: double
                 * @description Number of buckets returned.
                 */
                bucket_count: number;
                /** @description Inclusive timeframe start timestamp. */
                from: string;
                /**
                 * @description Analytics aggregation granularity.
                 * @enum {string}
                 */
                granularity: "day";
                /** @description IANA timezone used for buckets. */
                timezone: string;
                /** @description Exclusive timeframe end timestamp. */
                to: string;
            };
            tools: {
                /**
                 * Format: double
                 * @description Runs with this recorded waiting tool.
                 */
                count: number;
                /** @description Recorded waiting tool name. */
                name: string;
            }[];
        };
        /** @description An immutable file reference authorized through the run’s project and conversation permissions. */
        RunArtifact: {
            /** @description Immutable artifact identifier. */
            artifact_id: string;
            /**
             * Format: uri
             * @description Authorized artifact URL.
             */
            href: string;
            /** @description File media type. */
            media_type: string;
            /** @description SHA-256 digest of the file. */
            sha256: string;
            /**
             * Format: int64
             * @description File size in bytes.
             */
            size_bytes: number;
            /** @description Artifact kind. */
            type: string;
        };
        RunCancellation: {
            /**
             * Format: date-time
             * @description Time cancellation was requested.
             */
            requested_at: string;
            /**
             * Format: date-time
             * @description Time the runtime confirmed its stop; null until confirmed.
             */
            stopped_at: string | null;
        };
        /** @description Minimal admission receipt for a caller who cannot read the created run. No private fields are disclosed. */
        RunCreationReceipt: {
            /** Format: uuid */
            run_id: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
        };
        RunErrorPayload: {
            code?: string;
            message?: string;
            metadata?: {
                [key: string]: unknown;
            };
            runId?: string;
            /** @enum {string} */
            type: "RUN_ERROR";
        } & {
            /** @enum {string} */
            type: "RUN_ERROR";
        };
        RunEvent: {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_ERROR";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunErrorPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_ARGS";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallArgsPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_CHUNK";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallChunkPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_RESULT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallResultPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STATE_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STATE_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "MESSAGES_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["MessagesSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STEP_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STEP_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "REASONING_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "ACTIVITY_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivitySnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "ACTIVITY_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivityDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_AUTHORIZATION_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunAuthorizationSealedPayload"] | components["schemas"]["AgentRunAuthorizationSealedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_REQUEST_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRequestEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDefaultChatStartEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultSubmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultDeliveryFailedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunIntegrationConnectionRefusedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeOwnerBoundPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeInvokeRetriedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTEXT_COMPACTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunContextCompactedPayload"] | components["schemas"]["AgentRunContextCompactedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointedPayload"] | components["schemas"]["AgentRunToolExposureCheckpointedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointedPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnStartedPayload"] | components["schemas"]["AgentRunProviderReplayTurnStartedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnFinishedPayload"] | components["schemas"]["AgentRunProviderReplayTurnFinishedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextRecordedPayload"] | components["schemas"]["AgentRunModelCallContextRecordedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayloadRead"] | components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_DETACHED_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDetachedAcceptedPayload"] | components["schemas"]["AgentRunDetachedAcceptedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayload"] | components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_BILLING_USAGE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunBillingUsageRetainedPayload"] | components["schemas"]["AgentRunBillingUsageRetainedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunReplayedUploadsSealedPayload"] | components["schemas"]["AgentRunReplayedUploadsSealedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "TOOL_CALL_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_CREATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestCreatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_UPDATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestUpdatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "CHILD_RUN_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ChildRunStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "MODEL_CALL_COMPLETED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ModelCallCompletedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_PARKED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunParkedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUN_LOG_CAPTURED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunLogCapturedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "STREAM_HEARTBEAT_EMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StreamHeartbeatEmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "URL_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["UrlCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "DOCUMENT_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["DocumentCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "FILE_ATTACHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FileAttachedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "FILES_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FilesChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "RUNTIME_EVENT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RuntimeEventRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"] | components["schemas"]["AgentRunControlPlaneDispatchReceiptPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointPayload"] | components["schemas"]["AgentRunToolExposureCheckpointPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextPayload"] | components["schemas"]["AgentRunModelCallContextPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            created_at: string;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            /** Format: int64 */
            event_id: number;
            event_type: string;
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            /** @description Payload of an unrecognized historical or future event. */
            payload: unknown;
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        };
        /** @description Replay events with a continuation cursor. For task and workflow histories over 5000 events or 10 MiB, use paginated event reads. */
        RunEventSnapshot: {
            /**
             * Format: int64
             * @description Cursor for continuing event reads after this snapshot.
             */
            after_event_id: number;
            events: components["schemas"]["RunSnapshotEvent"][];
        };
        RunEventSummary: {
            /** @description Half-open time buckets `[start, end)` covering `first_event_at` through `last_event_at + 1 ms`. Boundaries use whole milliseconds; widths differ by at most 1 ms. Boundaries can be passed directly as the event-list `start` and `end` filters. The bucket count cannot exceed the span in milliseconds. Empty if no events match. */
            buckets: {
                /** Format: int64 */
                count: number;
                /** Format: date-time */
                end: string;
                /** Format: int64 */
                error_count: number;
                /** Format: date-time */
                start: string;
            }[];
            by_event_class: {
                /** Format: int64 */
                delta: number;
                /** Format: int64 */
                fact: number;
            };
            by_event_type: {
                /** Format: int64 */
                count: number;
                /** Format: int64 */
                error_count: number;
                /**
                 * @description The event class associated with this record.
                 * @enum {string}
                 */
                event_class: "fact" | "delta";
                event_type: string;
            }[];
            /** Format: int64 */
            error_count: number;
            /** Format: date-time */
            first_event_at: string | null;
            first_event_id: number | null;
            /** Format: date-time */
            last_event_at: string | null;
            last_event_id: number | null;
            /** Format: uuid */
            run_id: string;
            /** Format: int64 */
            total: number;
        };
        /** @description A short-lived event-append credential for the target child run; never grants finalization, heartbeat, or child creation. */
        RunEventToken: {
            /** Format: date-time */
            expires_at: string;
            permissions: "run.events.append"[];
            /** Format: uuid */
            run_id: string;
            token: string;
            /** @enum {string} */
            token_type: "Bearer";
        };
        /** @description Optional execution overrides; unsupported overrides return 400 before admission. Retry policy only repeats retryable failures. */
        RunExecutionOptions: {
            /**
             * Format: int64
             * @description Maximum retries after the first attempt, restricted to retryable failures.
             */
            retry_limit?: number;
            /** @description Deployment or registered runtime override; omit to use the definition default. */
            runtime?: components["schemas"]["RunRuntime"];
            /**
             * Format: int64
             * @description Whole-run deadline in seconds, including retries; unsupported target overrides are refused.
             */
            timeout_seconds?: number;
        };
        RunFailure: {
            /** @description Stable failure code. */
            code: string;
            /** @description Additional failure details. */
            details?: {
                [key: string]: unknown;
            };
            /** @description Human-readable failure message. */
            message: string;
        };
        RunFinishedPayload: {
            metadata?: {
                [key: string]: unknown;
            };
            runId?: string;
            /** @enum {string} */
            type: "RUN_FINISHED";
        } & {
            /** @enum {string} */
            type: "RUN_FINISHED";
        };
        RunHeartbeat: {
            /** Format: date-time */
            expires_at: string;
            /** Format: uuid */
            run_id: string;
        };
        /** @description Labels used to organize runs. */
        RunLabels: {
            [key: string]: string;
        };
        RunLogCapturedPayload: {
            logs: string;
            /** @enum {string} */
            type: "RUN_LOG_CAPTURED";
        } & {
            logs: string;
            /** @enum {string} */
            type: "RUN_LOG_CAPTURED";
        };
        RunParkedPayload: {
            /** Format: int64 */
            lastEventId: number;
            reason: string;
            runId: string;
            /** @enum {string} */
            type: "RUN_PARKED";
        } & {
            /** Format: int64 */
            lastEventId: number;
            reason: string;
            runId: string;
            /** @enum {string} */
            type: "RUN_PARKED";
        };
        /** @description When a pause was requested; control.waiting confirms when execution is paused. */
        RunPause: {
            /**
             * Format: date-time
             * @description Time the pause was requested.
             */
            requested_at: string;
        };
        /** @description Select an authorized deployment or registered runtime; omit to use the definition default. */
        RunRuntime: {
            /**
             * @description Runtime selection kind.
             * @enum {string}
             */
            type: "main_branch";
        } | {
            /**
             * Format: uuid
             * @description Environment UUID.
             */
            id: string;
            /**
             * @description Runtime selection kind.
             * @enum {string}
             */
            type: "environment";
        } | {
            /**
             * Format: uuid
             * @description Preview branch UUID.
             */
            id: string;
            /**
             * @description Runtime selection kind.
             * @enum {string}
             */
            type: "preview_branch";
        } | {
            /** @description Registered runtime identifier. */
            id: string;
            /**
             * @description Runtime selection kind.
             * @enum {string}
             */
            type: "registered";
        };
        RunSnapshotEvent: {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_ERROR";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunErrorPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TEXT_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["TextMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_ARGS";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallArgsPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_CHUNK";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallChunkPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_RESULT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallResultPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STATE_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STATE_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StateDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "MESSAGES_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["MessagesSnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STEP_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepStartedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STEP_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StepFinishedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_START";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageStartPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_MESSAGE_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningMessageEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_CONTENT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningContentPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "REASONING_END";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ReasoningEndPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "ACTIVITY_SNAPSHOT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivitySnapshotPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "ACTIVITY_DELTA";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ActivityDeltaPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_AUTHORIZATION_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunAuthorizationSealedPayload"] | components["schemas"]["AgentRunAuthorizationSealedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_REQUEST_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRequestEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_DEFAULT_CHAT_START_ENQUEUED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDefaultChatStartEnqueuedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_SUBMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultSubmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_RESULT_DELIVERY_FAILED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolResultDeliveryFailedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_INTEGRATION_CONNECTION_REFUSED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunIntegrationConnectionRefusedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_OWNER_BOUND";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeOwnerBoundPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_RUNTIME_INVOKE_RETRIED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunRuntimeInvokeRetriedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTEXT_COMPACTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunContextCompactedPayload"] | components["schemas"]["AgentRunContextCompactedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointedPayload"] | components["schemas"]["AgentRunToolExposureCheckpointedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointedPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_STARTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnStartedPayload"] | components["schemas"]["AgentRunProviderReplayTurnStartedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_TURN_FINISHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayTurnFinishedPayload"] | components["schemas"]["AgentRunProviderReplayTurnFinishedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextRecordedPayload"] | components["schemas"]["AgentRunModelCallContextRecordedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayloadRead"] | components["schemas"]["AgentRunControlPlaneDispatchAcceptedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_DETACHED_ACCEPTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunDetachedAcceptedPayload"] | components["schemas"]["AgentRunDetachedAcceptedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_INVOKE_AGENT_BILLING_MODE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayload"] | components["schemas"]["AgentRunInvokeAgentBillingModeRetainedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_BILLING_USAGE_RETAINED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunBillingUsageRetainedPayload"] | components["schemas"]["AgentRunBillingUsageRetainedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_REPLAYED_UPLOADS_SEALED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunReplayedUploadsSealedPayload"] | components["schemas"]["AgentRunReplayedUploadsSealedPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "TOOL_CALL_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ToolCallStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_CREATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestCreatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "INPUT_REQUEST_UPDATED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["InputRequestUpdatedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "CHILD_RUN_STATUS_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ChildRunStatusChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "MODEL_CALL_COMPLETED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["ModelCallCompletedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_PARKED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunParkedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUN_LOG_CAPTURED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RunLogCapturedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "STREAM_HEARTBEAT_EMITTED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["StreamHeartbeatEmittedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "URL_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["UrlCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "DOCUMENT_CITED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["DocumentCitedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "FILE_ATTACHED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FileAttachedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "FILES_CHANGED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["FilesChangedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "RUNTIME_EVENT_RECORDED";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["RuntimeEventRecordedPayload"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_CONTROL_PLANE_DISPATCH_RECEIPT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunControlPlaneDispatchReceiptPayload"] | components["schemas"]["AgentRunControlPlaneDispatchReceiptPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunToolExposureCheckpointPayload"] | components["schemas"]["AgentRunToolExposureCheckpointPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunProviderReplayCheckpointPayload"] | components["schemas"]["AgentRunProviderReplayCheckpointPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            /** @enum {string} */
            event_type: "AGENT_RUN_MODEL_CALL_CONTEXT";
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            payload: components["schemas"]["AgentRunModelCallContextPayload"] | components["schemas"]["AgentRunModelCallContextPayloadRedacted"];
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        } | {
            /** Format: date-time */
            created_at: string | null;
            /**
             * @description The event class associated with this record.
             * @enum {string}
             */
            event_class: "fact" | "delta";
            event_id: number | null;
            event_type: string;
            is_error: boolean;
            /** @description The origin custom name associated with this record. */
            origin_custom_name: string | null;
            /** @description The origin event type associated with this record. */
            origin_event_type: string;
            /** @description The parent span id associated with this record. */
            parent_span_id: string | null;
            /** @description Payload of an unrecognized historical or future event. */
            payload: unknown;
            /**
             * Format: uuid
             * @description Run identifier associated with the record.
             */
            run_id: string;
            /** @description The span id associated with this record. */
            span_id: string;
            /** @description The turn id associated with this record. */
            turn_id: string | null;
            /** @description List of unrecoverable fields associated with this record. */
            unrecoverable_fields: string[];
        };
        RunStartedPayload: {
            runId?: string;
            /** @enum {string} */
            type: "RUN_STARTED";
        } & {
            /** @enum {string} */
            type: "RUN_STARTED";
        };
        RunStreamEvent: {
            type: string;
        } & {
            [key: string]: unknown;
        };
        RunStreamFrame: {
            /** @description Stored timestamp; null when the frame has no stored timestamp. */
            created_at: string | null;
            /** @description Durable reconnect cursor; null for transient frames. */
            event_id: number | null;
            /** @description Stored event type used for the SSE event name. */
            event_type: string;
            /** @description Error classification from the stored row. */
            is_error: boolean;
            payload: components["schemas"]["RunStreamEvent"];
        };
        /** @description Definition executed by this run. */
        RunTarget: {
            /** @description Definition ID without a kind prefix, such as health-check rather than task:health-check. */
            id: string;
            /**
             * @description Kind of execution definition.
             * @enum {string}
             */
            type: "agent" | "task" | "workflow";
        };
        RuntimeEventRecordedPayload: {
            kind: string;
            runtime: string;
            /** @enum {string} */
            type: "RUNTIME_EVENT_RECORDED";
            value: unknown;
        } & {
            kind: string;
            runtime: string;
            /** @enum {string} */
            type: "RUNTIME_EVENT_RECORDED";
            value: unknown;
        };
        /** @description User, credential, automation or execution definition that directly started this run. */
        RunTrigger: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "user";
        } | {
            id: string;
            /** @enum {string} */
            type: "api_key";
        } | {
            id: string;
            /** @enum {string} */
            type: "service_account";
        } | {
            id: string;
            /** @enum {string} */
            type: "system";
        } | {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            type: "schedule";
        } | {
            id: string;
            /** @enum {string} */
            type: "webhook";
        } | {
            id: string;
            tool_call_id?: string;
            /** @enum {string} */
            type: "agent";
        } | {
            id: string;
            /** @enum {string} */
            type: "task";
        } | {
            id: string;
            node_id?: string;
            /** @enum {string} */
            type: "workflow";
        };
        /** @description The current durable wait, with only the fields required to satisfy that wait. */
        RunWait: {
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "manual_pause";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
        } | {
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "tool_result";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
            /** @description Tool call awaiting a result. */
            tool_call_id: string;
        } | {
            /** @description Integration awaiting connection. */
            integration: string;
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "integration_connected";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
        } | {
            /** @description Workflow nodes awaiting approval. */
            node_ids: string[];
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "approval";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
            /** @description Durable wait identifier. */
            wait_id: string;
        } | {
            /** @description Event required to resume. */
            name: string;
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "event";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
            /** @description Durable wait identifier. */
            wait_id: string;
        } | {
            /** @description Input requests awaiting responses. */
            input_request_ids: string[];
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "input_request";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
        } | {
            /** @description Child runs that must finish. */
            dependencies: {
                correlation: {
                    /** @description Tool call identifier. */
                    id: string;
                    /**
                     * @description Child invocation kind.
                     * @enum {string}
                     */
                    type: "tool_call";
                } | {
                    /** @description Workflow node identifier. */
                    id: string;
                    /**
                     * @description Child invocation kind.
                     * @enum {string}
                     */
                    type: "workflow_node";
                };
                /**
                 * Format: uuid
                 * @description Canonical UUID of the child run.
                 */
                run_id: string;
            }[];
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "child_run";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at?: string;
        } | {
            /**
             * @description Condition required to resume the run.
             * @enum {string}
             */
            reason: "timer";
            /**
             * Format: date-time
             * @description Scheduled automatic resume time.
             */
            resume_at: string;
        };
        ScheduleRunRequest: {
            labels?: components["schemas"]["RunLabels"];
            /**
             * Format: uuid
             * @description UUID of the project containing the execution definition or saved source.
             */
            project_id: string;
            /** @description Saved schedule supplying the target and execution configuration. */
            source: {
                /**
                 * Format: uuid
                 * @description UUID of the saved schedule in this project.
                 */
                id: string;
                /**
                 * @description Execute a saved schedule.
                 * @enum {string}
                 */
                type: "schedule";
            };
            /** @description Optional display title for the accepted run. */
            title?: string;
        };
        StateDeltaPayload: {
            delta?: unknown;
            /** @enum {string} */
            type: "STATE_DELTA";
        } & {
            delta: {
                [key: string]: unknown;
            } | {
                from?: string;
                /** @enum {string} */
                op: "add" | "remove" | "replace" | "move" | "copy" | "test";
                path: string;
                value?: unknown;
            }[];
            /** @enum {string} */
            type: "STATE_DELTA";
        };
        StateSnapshotPayload: {
            snapshot: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            type: "STATE_SNAPSHOT";
        } & {
            snapshot: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            type: "STATE_SNAPSHOT";
        };
        StepFinishedPayload: {
            runtime?: string;
            status?: string;
            stepId?: string;
            stepName?: string;
            /** @enum {string} */
            type: "STEP_FINISHED";
        } & {
            /** @enum {string} */
            type: "STEP_FINISHED";
        };
        StepStartedPayload: {
            runtime?: string;
            stepId?: string;
            stepName?: string;
            /** @enum {string} */
            type: "STEP_STARTED";
        } & {
            /** @enum {string} */
            type: "STEP_STARTED";
        };
        StreamHeartbeatEmittedPayload: {
            /** Format: int64 */
            lastEventId: number;
            runId: string;
            /** @enum {string} */
            type: "STREAM_HEARTBEAT_EMITTED";
        } & {
            /** Format: int64 */
            lastEventId: number;
            runId: string;
            /** @enum {string} */
            type: "STREAM_HEARTBEAT_EMITTED";
        };
        /** @description Final output for a successful run. */
        SucceedRunRequest: {
            /** @description Final JSON output. Use explicit null when there is no value. */
            output: unknown;
        };
        TextMessageContentPayload: {
            contentId?: string;
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_CONTENT";
        } & {
            contentId: string;
            delta: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_CONTENT";
        };
        TextMessageEndPayload: {
            contentId?: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_END";
        } & {
            contentId: string;
            messageId: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_END";
        };
        TextMessageStartPayload: {
            contentId: string;
            messageId: string;
            role?: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_START";
        } & {
            contentId: string;
            messageId: string;
            role?: string;
            /** @enum {string} */
            type: "TEXT_MESSAGE_START";
        };
        /** @description Input excludes cache reads/writes; output includes reasoning. Total is input + output + cache.read + cache.write. Null means unknown, never zero. */
        TokenUsage: {
            cache: {
                /**
                 * Format: int64
                 * @description Tokens read from the provider cache.
                 */
                read: number | null;
                /**
                 * Format: int64
                 * @description Tokens written to the provider cache.
                 */
                write: number | null;
            };
            /**
             * Format: int64
             * @description Input tokens excluding cache reads and writes.
             */
            input: number | null;
            /**
             * Format: int64
             * @description Output tokens including reasoning.
             */
            output: number | null;
            /**
             * Format: int64
             * @description Reasoning tokens included in output.
             */
            reasoning?: number | null;
            /**
             * Format: int64
             * @description Sum of input, output, cache-read and cache-write tokens.
             */
            total: number | null;
        };
        ToolCallArgsPayload: {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_ARGS";
        } & {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_ARGS";
        };
        ToolCallChunkPayload: {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_CHUNK";
        } & {
            delta: string;
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_CHUNK";
        };
        ToolCallEndPayload: {
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_END";
        } & {
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_END";
        };
        ToolCallResultPayload: {
            content?: unknown;
            isError: boolean | null;
            messageId?: string;
            parentMessageId?: string;
            /** @enum {string} */
            role?: "tool";
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_RESULT";
        } & {
            content?: unknown;
            input?: unknown;
            isError: boolean | null;
            messageId?: string;
            parentMessageId?: string;
            result?: unknown;
            /** @enum {string} */
            role?: "tool";
            toolCallId: string;
            /** @enum {string} */
            type: "TOOL_CALL_RESULT";
        };
        ToolCallStartPayload: {
            parentMessageId?: string;
            toolCallId: string;
            toolCallName: string;
            /** @enum {string} */
            type: "TOOL_CALL_START";
        } & {
            toolCallId: string;
            toolCallName: string;
            /** @enum {string} */
            type: "TOOL_CALL_START";
        };
        ToolCallStatusChangedPayload: {
            status: string;
            toolCallId: string;
            toolCallName: string | null;
            /** @enum {string} */
            type: "TOOL_CALL_STATUS_CHANGED";
        } & {
            status: string;
            toolCallId: string;
            toolCallName: string | null;
            /** @enum {string} */
            type: "TOOL_CALL_STATUS_CHANGED";
        };
        /** @description A historical response without authoritative submitting-credential provenance. The server never infers or looks up a replacement actor. */
        UnavailableActor: {
            /** @description Actor ID stored with the response. It is not promoted to an authenticated actor. */
            legacy_id?: string;
            /**
             * @description Role tag stored with the response. It is not an authenticated actor type.
             * @enum {string}
             */
            legacy_role?: "human" | "agent" | "integration" | "system" | "user" | "api_key" | "service_account";
            /**
             * @description `not_recorded`: the server never stored the submitting credential. `identity_removed`: the recorded identity was later revoked or deleted.
             * @enum {string}
             */
            reason: "not_recorded" | "identity_removed";
            /** @enum {string} */
            type: "unavailable";
        };
        /** @description Update the run title or labels. */
        UpdateRunRequest: {
            labels?: components["schemas"]["RunLabels"] & unknown;
            /** @description Replace the display title; null clears it. */
            title?: string | null;
        };
        UrlCitedPayload: {
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "URL_CITED";
            url: string;
        } & {
            sourceId: string;
            title?: string;
            /** @enum {string} */
            type: "URL_CITED";
            url: string;
        };
        /** @description Shared usage shape for a run, descendant aggregate, or evaluation; capture_status describes token capture coverage. Cost can remain unavailable independently. */
        Usage: {
            /**
             * @description Token capture coverage.
             * @enum {string}
             */
            capture_status: "complete" | "partial" | "missing";
            cost: components["schemas"]["Cost"];
            /**
             * Format: int64
             * @description Billed provider call count.
             */
            model_calls?: number | null;
            tokens: components["schemas"]["TokenUsage"];
        };
        VersionedRun: {
            /** @description Files produced by the run. */
            artifacts?: components["schemas"]["RunArtifact"][];
            /**
             * Format: uuid
             * @description Batch containing the run.
             */
            batch_id?: string;
            /** @description Definition-specific execution configuration. */
            config?: {
                [key: string]: unknown;
            };
            /** @description Pending control requests and the current wait. */
            control?: {
                cancellation?: components["schemas"]["RunCancellation"];
                pause?: components["schemas"]["RunPause"];
                waiting?: components["schemas"]["RunWait"];
            };
            /**
             * Format: uuid
             * @description Conversation containing the run.
             */
            conversation_id?: string;
            /**
             * Format: date-time
             * @description When the run was accepted.
             */
            created_at: string;
            /** @description Counts and usage across all descendant runs, excluding this run. */
            descendants?: {
                /**
                 * Format: int64
                 * @description Descendants that are pending, running or waiting.
                 */
                active: number;
                /** @description Whether any descendant has failed. */
                has_failures: boolean;
                /**
                 * Format: int64
                 * @description Total descendants at every depth.
                 */
                total: number;
                /** @description Aggregate usage of every descendant, excluding this run. */
                usage?: components["schemas"]["Usage"];
            };
            /** @description Failure details, present only when the run failed. */
            error?: components["schemas"]["RunFailure"];
            /** @description Version of caller-editable run metadata. */
            etag: string;
            /** @description Resolved execution settings and diagnostics. */
            execution?: {
                /**
                 * Format: int64
                 * @description Current or last execution attempt, starting at 1; absent before execution.
                 */
                attempt?: number;
                /**
                 * Format: int64
                 * @description Elapsed time from first start to finish, including waits and retries; null when not finished.
                 */
                duration_ms?: number | null;
                /** @description Runtime process exit code, or null when no exit code was recorded. */
                exit_code?: number | null;
                /** @description Captured runtime text logs, when available. */
                logs?: string;
                /**
                 * Format: int64
                 * @description Maximum retries after the first attempt; only retryable failures are retried.
                 */
                retry_limit?: number;
                /** @description Resolved logical runtime selection; main_branch identifies the selected main-branch deployment, not a worker process. */
                runtime?: components["schemas"]["RunRuntime"];
                /** @description Recorded execution start mode, when available. */
                start_mode?: string;
                /**
                 * Format: int64
                 * @description Deadline for the whole run in seconds, measured from its first start and including retries.
                 */
                timeout_seconds?: number;
                /**
                 * Format: int64
                 * @description Recorded failed tool invocations during this run.
                 */
                tool_error_count?: number;
            };
            /**
             * Format: date-time
             * @description When the run completed, failed or was cancelled.
             */
            finished_at?: string;
            /**
             * Format: uuid
             * @description Unique run UUID.
             */
            id: string;
            /** @description Business input supplied when the run was created. */
            input: unknown;
            /**
             * Format: uuid
             * @description Conversation message that supplied the input.
             */
            input_message_id?: string;
            /** @description Labels used to organize runs. */
            labels?: components["schemas"]["RunLabels"];
            /** @description Additional resource metadata. */
            metadata?: {
                [key: string]: unknown;
            };
            /** @description Final business output; null until successful finalization. */
            output: unknown;
            /**
             * Format: uuid
             * @description Conversation message containing the result.
             */
            output_message_id?: string;
            /**
             * Format: uuid
             * @description Immediate parent run ID, present on child runs.
             */
            parent_run_id?: string;
            /**
             * Format: uuid
             * @description Project containing the run.
             */
            project_id: string;
            /**
             * Format: uuid
             * @description Top-level ancestor run ID, present on child runs.
             */
            root_run_id?: string;
            /** @description Pinned schemas for business input and output; null means no declared schema. */
            schemas?: {
                input: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
                output: {
                    /** @description JSON Schema captured for this run; object schemas and boolean schemas are supported. */
                    schema: boolean | {
                        [key: string]: unknown;
                    };
                    /** @description SHA-256 digest of the pinned schema. */
                    sha256: string;
                } | null;
            };
            /**
             * Format: date-time
             * @description When the first execution attempt started, omitted before execution.
             */
            started_at?: string;
            /**
             * @description Current execution state.
             * @enum {string}
             */
            status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
            /** @description Execution definition; its ID may be null only on historical runs. */
            target: components["schemas"]["HistoricalRunTarget"];
            /** @description Orchestration task ID, distinct from the execution definition. */
            task_id?: string;
            /** @description Display title, omitted when unset. */
            title?: string;
            /** @description How execution was initiated. */
            trigger?: components["schemas"]["RunTrigger"];
            /**
             * Format: date-time
             * @description When the resource last changed, including usage updates.
             */
            updated_at: string;
            /** @description Usage when available; unknown measurements are null. */
            usage?: components["schemas"]["Usage"];
        } & (unknown & unknown & unknown & unknown & unknown & unknown & unknown);
        WebhookRunRequest: {
            /** @description A JSON value. */
            input: unknown;
            labels?: components["schemas"]["RunLabels"];
            /** Format: uuid */
            project_id: string;
            /** @description Saved webhook to execute. */
            source: {
                /** @description Saved webhook identifier. */
                id: string;
                /**
                 * @description Saved source kind.
                 * @enum {string}
                 */
                type: "webhook";
            };
            title?: string;
        };
    };
    responses: never;
    parameters: {
        /** @description Opaque cursor pointing at the next page. Omit it to read the first page. */
        PaginationCursor: components["schemas"]["PaginationCursor"];
        /** @description Project slug, UUID, or domain that identifies the project. */
        ProjectReference: components["schemas"]["ProjectReference"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getAccountRunAnalytics: {
        parameters: {
            query?: {
                /** @description Project label filters as key or key=value, repeated or comma-separated. */
                label?: string[] | null;
                /** @description Relative timeframe preset. */
                preset?: "7d" | "30d" | "90d";
                /** @description Optional project UUID or slug to scope analytics to a single project. */
                project_reference?: string;
                /** @description IANA timezone for daily bucket boundaries. */
                timezone?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Account run analytics statistics. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunAnalytics"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Server error. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listConversationChildRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                /** @description Filter by tool_call_id. */
                tool_call_id?: string;
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listConversationInputRequests: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                run_id?: string;
                /** @description Lifecycle status for the target record. */
                status?: "open" | "submitted" | "cancelled" | "expired";
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListInputRequestsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listConversationRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
            };
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                conversation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getInputRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    cancelInputRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled input request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createInputResponse: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 00000000-0000-4000-8000-000000000001 */
                input_request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RespondToInputRequestRequest"];
            };
        };
        responses: {
            /** @description InputRequest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Service temporarily unavailable; retry the request */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 503;
                    };
                };
            };
        };
    };
    listEvalRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                sort_by?: "created_at" | "status";
                sort_order?: "asc" | "desc";
            };
            header?: never;
            path: {
                /** @example eval_example */
                eval_id: string;
                /**
                 * @description Project slug, UUID, or domain that identifies the project.
                 * @example example
                 */
                project_reference: components["schemas"]["ProjectReference"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listProjectRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                parent_run_id?: string;
                root_only?: "true" | "false";
                /** @description Field used to order runs: created_at, status or duration. Defaults to created_at. */
                sort_by?: "created_at" | "status" | "duration";
                /** @description Sort direction: asc or desc. Defaults to desc. */
                sort_order?: "asc" | "desc";
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
                /** @description Filter by execution definition ID. */
                target_id?: string[];
                /** @description Filter by execution definition type. */
                target_type?: ("agent" | "task" | "workflow" | "eval")[];
                /** @description Filter by the persisted orchestration task identity in task_id; this is distinct from the execution definition target. */
                task_id?: string;
                /** @description Filter by trigger_id. */
                trigger_id?: string;
                /** @description Filter by trigger_type. */
                trigger_type?: ("user" | "api_key" | "service_account" | "system" | "schedule" | "webhook" | "agent" | "task" | "workflow")[];
            };
            header?: never;
            path: {
                /** @example example */
                project_reference: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listProjectWebhookRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                sort_order?: "asc" | "desc";
            };
            header?: never;
            path: {
                /** @example example */
                project_reference: string;
                /** @example 00000000-0000-4000-8000-000000000001 */
                webhook_definition_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRuns: {
        parameters: {
            query?: {
                /** @description Restrict accessible runs to this conversation; filters intersect and never grant access. */
                conversation_id?: string;
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                parent_run_id?: string;
                /** @description Restrict accessible runs to this project; filters intersect and never grant access. */
                project_id?: string;
                root_only?: "true" | "false";
                /** @description Field used to order runs: created_at, status or duration. Defaults to created_at. */
                sort_by?: "created_at" | "status" | "duration";
                /** @description Sort direction: asc or desc. Defaults to desc. */
                sort_order?: "asc" | "desc";
                /** @description Filter by status. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                status?: string[];
                /** @description Filter by execution definition ID. */
                target_id?: string[];
                /** @description Filter by execution definition type. */
                target_type?: ("agent" | "task" | "workflow" | "eval")[];
                /** @description Filter by the persisted orchestration task identity in task_id; this is distinct from the execution definition target. */
                task_id?: string;
                /** @description Filter by trigger_id. */
                trigger_id?: string;
                /** @description Filter by trigger_type. */
                trigger_type?: ("user" | "api_key" | "service_account" | "system" | "schedule" | "webhook" | "agent" | "task" | "workflow")[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRunRequest"];
            };
        };
        responses: {
            /** @description CreatedRun */
            202: {
                headers: {
                    /** @description Canonical run URL for status polling. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateRunResult"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run detail */
            200: {
                headers: {
                    /** @description Opaque version for conditional metadata updates. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    deleteRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run, its events, and owned input requests deleted; referenced artifact files are retained. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    updateRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description ETag from the latest run detail; prevents overwriting concurrent metadata changes.
                 * @example "run-version-1"
                 */
                "If-Match": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRunRequest"];
            };
        };
        responses: {
            /** @description Updated run */
            200: {
                headers: {
                    /** @description Opaque version for conditional metadata updates. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Run metadata changed since the supplied ETag */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 412;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description If-Match header required */
            428: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 428;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    cancelRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunChildRuns: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                /** @description Maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunEventToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Scoped event token created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventToken"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunEvents: {
        parameters: {
            query?: {
                after_event_id?: number | null;
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: string;
                end?: string;
                /** @description The event class associated with this record. */
                event_class?: "fact" | "delta";
                /** @description Filter by event_type. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                event_type?: string[];
                include_descendants?: "true" | "false";
                is_error?: "true" | "false";
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                search?: string;
                sort_order?: "asc" | "desc";
                span_id?: string;
                start?: string;
                turn_id?: string;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run events */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunEventsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    appendRunEvents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AppendRunEventsRequest"];
            };
        };
        responses: {
            /** @description Events appended with updated durable cursor */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppendRunEventsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Service temporarily unavailable; retry the request */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 503;
                    };
                };
            };
        };
    };
    getRunEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 1 */
                event_id: number;
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEvent"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRunEventsSummary: {
        parameters: {
            query?: {
                buckets?: number;
                end?: string;
                /** @description The event class associated with this record. */
                event_class?: "fact" | "delta";
                /** @description Filter by event_type. Repeat the query parameter for multiple values; comma-separated values remain a compatibility alias. Values within this filter use OR; different filters use AND. */
                event_type?: string[];
                include_descendants?: "true" | "false";
                is_error?: "true" | "false";
                search?: string;
                span_id?: string;
                start?: string;
                turn_id?: string;
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventSummary"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
            /** @description Server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    failRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
                /** @description Required for execution credentials. */
                "X-Veryfront-Run-Terminal-Token"?: string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FailRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    finalizeRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
                /** @description Required for execution credentials. */
                "X-Veryfront-Run-Terminal-Token"?: string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinalizeRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunHeartbeat: {
        parameters: {
            query?: never;
            header?: {
                /** @description Atomically accept this detached dispatch before starting execution. A duplicate returns 409. */
                "x-veryfront-run-dispatch-acceptance"?: "true";
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRunHeartbeatRequestInput"];
            };
        };
        responses: {
            /** @description Execution lease renewal outcome */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunHeartbeat"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Run is cancelled, terminal, or no longer owned by this execution generation. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunInputRequests: {
        parameters: {
            query?: {
                /** @description Opaque page_info.next cursor; reuse with unchanged filters and ordering. */
                cursor?: components["schemas"]["PaginationCursor"];
                /** @description Maximum number of records in a page, from 1 to 100. Defaults to 20. */
                limit?: number;
                /** @description Lifecycle status for the target record. */
                status?: "open" | "submitted" | "cancelled" | "expired";
            };
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Input request page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListInputRequestsResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    createRunInputRequest: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateInputRequestRequestInput"];
            };
        };
        responses: {
            /** @description Input request created or idempotently replayed */
            201: {
                headers: {
                    /** @description Canonical input request URL. */
                    Location?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputRequest"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    pauseRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    resumeRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResumeRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    getRunSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run stream snapshot */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunEventSnapshot"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    streamRunEvents: {
        parameters: {
            query?: never;
            header?: {
                /** @example example */
                "Last-Event-ID"?: string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Agent event stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    succeedRun: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description Caller-scoped retry key; replay the same request for at least 24 hours. A different payload with the same key returns 409.
                 * @example example-request-1
                 */
                "Idempotency-Key": string;
                /** @description Required for execution credentials. */
                "X-Veryfront-Run-Terminal-Token"?: string;
            };
            path: {
                /** @example 11111111-1111-4111-8111-111111111111 */
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SucceedRunRequest"];
            };
        };
        responses: {
            /** @description Run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description State conflict, stale execution generation, or idempotency mismatch */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 409;
                    };
                };
            };
            /** @description Request or final output exceeds its byte limit */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 413;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
    listRunEventTypes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run event type overview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListRunEventTypesResponse"];
                };
            };
            /** @description Invalid request or cursor */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 400;
                    };
                };
            };
            /** @description Missing, invalid, or expired credentials */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 401;
                    };
                };
            };
            /** @description Insufficient resource permission or credential purpose */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 403;
                    };
                };
            };
            /** @description Resource not found or not visible */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 404;
                    };
                };
            };
            /** @description Rate limit exceeded */
            429: {
                headers: {
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"] & {
                        /** @constant */
                        status?: 429;
                    };
                };
            };
        };
    };
}
