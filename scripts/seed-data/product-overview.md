# Acme Knowledge Platform — Product Overview

## What it is

Acme Knowledge Platform is an **enterprise AI knowledge base**. Teams upload documents, search across them, and chat with citations grounded in company content.

## Core features

### Knowledge bases

- Organize documents by team or topic
- Supported formats: PDF, DOCX, TXT, Markdown
- Automatic chunking and embedding after upload

### Hybrid search

- Combines full-text search and vector similarity (RRF fusion)
- Filters by knowledge base
- Returns snippets with document titles

### AI chat

- Conversational Q&A over a selected knowledge base
- Streaming answers (SSE)
- Inline citations linking back to source chunks
- Optional query rewrite for follow-up questions

## Roles

| Role | Capabilities |
|------|----------------|
| Owner | Full org control, billing settings |
| Admin | Manage members, KBs, documents |
| Member | Create KBs (if allowed), upload, chat, search |
| Viewer | Read-only search and chat |

## Demo scenario

Ask: *“How many remote days per week are allowed?”*  
Expected grounding: Employee Handbook → Working hours section.
