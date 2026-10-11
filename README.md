# Claude Code shaped TypeScript agent runtime

This repository is an independent, readable TypeScript implementation of a
coding agent CLI. It does not bundle, execute, import, or download the Claude
Code executable. The implementation uses the Anthropic Messages API and keeps
the agent loop, tool calls, and subagent scheduling in ordinary TypeScript.

The implementation is organized as follows:

- `src/index.ts` — command-line entry point and output modes.
- `src/config.ts` — argument parsing, settings loading, and API key helpers.
- `src/model-client.ts` — Anthropic-compatible Messages API transport.
- `src/agent-runtime.ts` — multi-turn model/tool loop and Task delegation.
- `src/tools.ts` — readable Read, Write, Edit, Bash, and Task execution.
- `src/agents/` — protocol types, agent definitions, and concurrency scheduler.

Build it with Node.js:

```bash
npm ci
npm run check
npm run build
node dist/index.js --version
```

To use a settings profile such as `~/.claude/my-profiles/opencode.json`:

```bash
node dist/index.js \
  --settings ~/.claude/my-profiles/opencode.json \
  --print \
  '请读取当前目录的 package.json，并告诉我项目名称。'
```

The result is a semantic reimplementation, so its binary hash cannot equal
the proprietary Claude ELF. Hash equality would require shipping or fetching
that original executable, which this repository deliberately does not do.
