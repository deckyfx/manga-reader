# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a manga reader application built with Bun. The project is currently in initial setup phase.

## Development Commands

### Setup

```bash
bun install              # Install dependencies
```

### Development

```bash
bun run dev             # Start development server
```

## Technology Stack

**Runtime**: Bun (native TypeScript support)

## Architecture Notes

This section will be updated as the architecture develops.

### Key Principles

- Use Bun native APIs when available (sqlite, postgresql, file I/O)
- Write type-safe TypeScript with comprehensive TSDoc documentation
- Follow class-based OOP architecture patterns
- Prioritize performance and modern best practices

# Bun Development Guidelines

**Load BUN.md first for overview, then load topic-specific guides as needed:**

@.claude/bun/BUN.md

**Topic Guides (load based on current task):**

- @.claude/bun/BUN_PROJECT_INIT.md - When creating new projects
- @.claude/bun/BUN_BASIC_SERVER.md - For simple web servers (native Bun)
- @.claude/bun/BUN_ELYSIA_SERVER.md - For full-stack apps (ElysiaJS + React)
- @.claude/bun/BUN_ENV_CONFIG.md - For environment configuration
- @.claude/bun/BUN_TYPE_SAFETY.md - For TypeScript guidelines
- @.claude/bun/BUN_ERROR_HANDLING.md - For error handling patterns
- @.claude/bun/BUN_DATABASE.md - For database integration
