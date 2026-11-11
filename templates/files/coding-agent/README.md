# Coding Agent

An AI assistant that can read, understand, and modify project files.

## What's included

- Coder agent with file system tools
- Read, list, and edit files through conversation
- Safe search/replace editing pattern

## Structure

```
agents/coder.ts        Agent with coding instructions
tools/
  read-file.ts         Read file contents
  list-files.ts        List directory contents
  edit-file.ts         Search and replace in files
lib/
  project-files.ts     Project file access, local or on Veryfront Cloud
app/
  api/ag-ui/route.ts    AG-UI endpoint
  page.tsx             Chat interface
```

## Where the tools read files

With `veryfront dev`, the tools read and edit the project folder on your machine.

On Veryfront Cloud, the runtime does not run from the project folder. The tools
read and edit the project's files through the platform file operations
(`veryfront__list_files`, `veryfront__get_file`, and `veryfront__update_file`),
which each tool declares in `delegatedPlatformTools`. An agent run on Veryfront
Cloud grants them. Outside an agent run, for example in a task, the tools answer
that the runtime has no local copy of the project files.

This starter is not production-ready.
