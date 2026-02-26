# Chat with Your Docs

A chatbot that answers questions from your own documents.

## What's included

- Q&A agent with source citation
- Keyword-based document search over markdown files
- Sample content in `/content` directory

## Structure

```
agents/qa.ts           Q&A agent with citation instructions
tools/search-docs.ts   Searches markdown files by relevance
content/
  getting-started.md   Sample document
  architecture.md      Sample document
app/
  api/chat/route.ts    Chat API endpoint
  page.tsx             Chat interface
```

Add your own `.md`, `.mdx`, or `.txt` files to `content/` to expand the knowledge base.

This is a starter template to give you a good starting point — not a production-ready setup.
