# Issue 5171 research

Service dispatch already authenticates the invocation and consumes an accepted response with an optional runtime-owner URL. The owner URL identifies the receiving replica for run control, but the public run cannot show its process identity. The native control-plane invocation path currently omits this response decoration.

Use accepted-response metadata rather than a new callback or authentication system for the first slice. Generate one UUID per process, preserve it across route factories, and use `VERYFRONT_RUNTIME_NAME` with hostname fallback for display. Keep process identity independent of endpoint URL availability. Reuse current API generation fencing when persisting the response (API issue 6591).

Headers: `x-veryfront-runtime-id` UUID, `x-veryfront-runtime-name` encodeURIComponent of a nonempty display name of at most 128 UTF-16 code units, `x-veryfront-runtime-mode: service`. Encoded name is at most 1536 characters. Reject control characters and malformed Unicode in configured names before serving requests. These are attribution, not credentials.
