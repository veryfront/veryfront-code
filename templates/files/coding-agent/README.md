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
app/
  api/ag-ui/route.ts    AG-UI endpoint
  page.tsx             Chat interface
```

This starter is not production-ready.
