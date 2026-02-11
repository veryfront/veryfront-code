'use client'

import { useState } from 'react'
import { usePageContext } from 'veryfront/context'
import { useWorkflow } from 'veryfront/workflow'

const STEP_ICONS: Record<string, string> = {
  completed: '\u2713',
  running: '\u25C9',
  pending: '\u25CB',
  waiting_for_approval: '\u23F8',
  failed: '\u2717',
}

export default function WorkflowDetail(): JSX.Element {
  const { params } = usePageContext()
  const { run, pendingApprovals, isLoading, refresh } = useWorkflow({ runId: params.id })
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleApproval(approvalId: string, approved: boolean) {
    setIsSubmitting(true)
    try {
      await fetch(`/api/workflows/runs/${params.id}/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, approver: 'user' }),
      })
      await refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

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

        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-1">{run.input?.topic || 'Workflow'}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-8">Started {new Date(run.createdAt).toLocaleString()}</p>

        {/* Steps */}
        <div className="space-y-4 mb-8">
          {run.steps?.map((step: any) => (
            <div key={step.id} className="flex items-start gap-3 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
              <span className="text-lg mt-0.5">{STEP_ICONS[step.status] || '\u25CB'}</span>
              <div className="flex-1">
                <p className="font-medium text-neutral-900 dark:text-white text-sm">{step.name}</p>
                {step.output && (
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{typeof step.output === 'string' ? step.output : JSON.stringify(step.output)}</p>
                )}
              </div>
              <span className="text-xs text-neutral-400">{step.status}</span>
            </div>
          ))}
        </div>

        {/* Approval */}
        {pendingApprovals.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
            <h2 className="font-medium text-amber-900 dark:text-amber-200 mb-2">Approval Required</h2>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">Review the draft before publishing.</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleApproval(pendingApprovals[0].id, true)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors text-sm"
              >
                Approve
              </button>
              <button
                onClick={() => handleApproval(pendingApprovals[0].id, false)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50 transition-colors text-sm"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
