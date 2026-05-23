---
title: "Cron job"
description: "How cron jobs create job runs on a schedule."
order: 26
---

A cron job owns a schedule. It creates job runs at configured times.

Use a cron job when work should start automatically. The cron job should not own
the business logic. Put the work in a task or workflow and let the cron job
trigger it.

This keeps scheduling separate from execution.

For implementation steps, see [Jobs](../guides/jobs.md).
