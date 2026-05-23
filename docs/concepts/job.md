---
title: "Job"
description: "How jobs run tasks and workflows durably."
order: 25
---

A job owns durable execution. It records status, events, logs, and result state
for background work.

Use a job when work needs to outlive an HTTP request or continue after the caller
disconnects. A job can run a task, workflow, or other supported target.

The target defines what work is done. The job records that the work ran.

For implementation steps, see [Jobs](../guides/jobs.md).
