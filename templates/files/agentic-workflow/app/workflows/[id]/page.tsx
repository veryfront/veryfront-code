'use client'

import { usePageContext } from 'veryfront/context'
import { useApproval, useWorkflow } from 'veryfront/workflow'

const STEP_ICONS: Record<string, string> = {
  completed: '\u2713',
  running: '\u25C9',
  pending: '\u25CB',
  skipped: '\u23F8',
  failed: '\u2717',
}

/** The drafts `workflows/content-pipeline.ts` attaches to its approval gate. */
interface ReviewPayload {
  article?: string
  summary?: string
}

function ApprovalPanel({ runId, approvalId, message, onDecided }: {
  runId: string
  approvalId: string
  message?: string
  onDecided: () => Promise<void>
}): React.JSX.Element {
  // The server records the signed-in identity as the approver, not this one.
  const { approval, approve, reject, isSubmitting, error } = useApproval({
    runId,
    approvalId,
    approver: 'user',
  })
  // Decisions stay disabled until the drafts have loaded, so nobody approves blind.
  const drafts = (approval?.payload ?? {}) as ReviewPayload

  async function decide(submit: () => Promise<void>) {
    try {
      await submit()
    } catch {
      // `error` below shows why the decision was refused.
      return
    }
    await onDecided()
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
      <h2 className="font-medium text-amber-900 dark:text-amber-200 mb-2">Approval Required</h2>
      <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">{message}</p>
      {drafts.summary && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-4 whitespace-pre-wrap">{drafts.summary}</p>
      )}
      {drafts.article && (
        <details className="mb-4">
          <summary className="text-sm font-medium text-neutral-700 dark:text-neutral-300 cursor-pointer">Article draft</summary>
          <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{drafts.article}</p>
        </details>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => decide(() => approve())}
          disabled={isSubmitting || !approval}
          className="px-4 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors text-sm"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => decide(() => reject())}
          disabled={isSubmitting || !approval}
          className="px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors text-sm"
        >
          Reject
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error.message}</p>}
    </div>
  )
}

export default function WorkflowDetail(): React.JSX.Element {
  const { params } = usePageContext()
  const runId = params.id ?? ''
  const { run, pendingApprovals, isLoading, refresh } = useWorkflow({ runId })
  const pendingApproval = pendingApprovals[0]

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <p className="text-neutral-400">Loading workflow...</p>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <p className="text-neutral-400">Workflow not found</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <a href="/" className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 mb-6 inline-block">&larr; Back</a>

        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-1">{run.id}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-8">{run.workflowId} &middot; Started {new Date(run.createdAt).toLocaleString()}</p>

        {/* One card per workflow node, in definition order */}
        <div className="space-y-4 mb-8">
          {Object.entries(run.nodeStates).map(([nodeId, node]) => (
            <div key={nodeId} className="flex items-start gap-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
              <span className="text-lg mt-0.5">{STEP_ICONS[node.status] || '\u25CB'}</span>
              <div className="flex-1">
                <p className="font-medium text-neutral-900 dark:text-white text-sm">{nodeId}</p>
                <p className="text-xs text-neutral-500 mt-1">Attempt {node.attempt}</p>
              </div>
              <span className="text-xs text-neutral-400">{node.status}</span>
            </div>
          ))}
        </div>

        {/* Approval */}
        {pendingApproval && (
          <ApprovalPanel
            key={pendingApproval.id}
            runId={runId}
            approvalId={pendingApproval.id}
            message={pendingApproval.message}
            onDecided={refresh}
          />
        )}
      </div>
    </div>
  )
}
