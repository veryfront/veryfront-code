'use client'

import { useState } from 'react'
import { useWorkflowStart, useWorkflowList } from 'veryfront/workflow'

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  waiting_for_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
}

export default function WorkflowDashboard(): JSX.Element {
  const [topic, setTopic] = useState('')
  const { start, isStarting } = useWorkflowStart({ workflowId: 'content-pipeline' })
  const { runs, isLoading } = useWorkflowList()

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!topic.trim()) return
    await start({ topic: topic.trim() })
    setTopic('')
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Content Pipeline</h1>
          <p className="mt-1 text-neutral-500 dark:text-neutral-400">Research &rarr; Write &rarr; Review &rarr; Publish</p>
        </div>

        {/* Start new workflow */}
        <form onSubmit={handleStart} className="mb-10">
          <div className="flex gap-3">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic to research and write about..."
              className="flex-1 px-4 py-2.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isStarting || !topic.trim()}
              className="px-5 py-2.5 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStarting ? 'Starting...' : 'Start'}
            </button>
          </div>
        </form>

        {/* Workflow runs */}
        <div>
          <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">Recent Runs</h2>

          {isLoading ? (
            <p className="text-neutral-400 text-sm py-8 text-center">Loading...</p>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <p className="text-neutral-500 dark:text-neutral-400">No workflows yet. Start one above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((wf) => (
                <a
                  key={wf.id}
                  href={`/workflows/${wf.id}`}
                  className="block bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-neutral-900 dark:text-white text-sm">{wf.input?.topic || 'Untitled'}</p>
                      <p className="text-xs text-neutral-500 mt-1">{new Date(wf.createdAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[wf.status] || STATUS_STYLES.pending}`}>
                      {wf.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
