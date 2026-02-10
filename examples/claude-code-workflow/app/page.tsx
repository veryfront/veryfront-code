/**
 * Claude Code Workflow Example - UI
 *
 * Simple interface to trigger code review and bug fix workflows.
 */

export default function WorkflowPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Claude Code Workflows</h1>
      <p style={{ color: "#666" }}>
        Run AI-powered coding workflows using Claude Code as a workflow step.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>Code Review</h2>
        <p>Analyze code for security issues, performance problems, and quality improvements.</p>
        <pre style={{ background: "#f5f5f5", padding: "1rem", borderRadius: 8, overflow: "auto" }}>
{`curl -X POST http://localhost:3002/api/workflow \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflow": "code-review",
    "input": {
      "target": "src/",
      "focus": "security"
    }
  }'`}
        </pre>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Bug Fix</h2>
        <p>Investigate, fix, and verify a bug — three Claude Code steps in sequence.</p>
        <pre style={{ background: "#f5f5f5", padding: "1rem", borderRadius: 8, overflow: "auto" }}>
{`curl -X POST http://localhost:3002/api/workflow \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflow": "bug-fix",
    "input": {
      "description": "Login form accepts empty passwords",
      "files": ["src/auth/login.ts", "src/auth/validate.ts"],
      "errorMessage": "ValidationError: password is required"
    }
  }'`}
        </pre>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Check Status</h2>
        <pre style={{ background: "#f5f5f5", padding: "1rem", borderRadius: 8, overflow: "auto" }}>
{`curl http://localhost:3002/api/workflow?id=<runId>`}
        </pre>
      </section>

      <section style={{ marginTop: "2rem", padding: "1rem", background: "#f0f7ff", borderRadius: 8 }}>
        <h3>Requirements</h3>
        <ul>
          <li>Claude Code installed locally (<code>claude --version</code>)</li>
          <li>No separate API key needed — uses your local Claude Code auth</li>
          <li>For worker mode: Redis running + <code>veryfront worker</code> in a separate terminal</li>
          <li>Without worker: workflows run inline in the dev server process</li>
        </ul>
      </section>
    </div>
  );
}
