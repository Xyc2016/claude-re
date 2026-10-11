# Semantic agent reconstruction

This directory is the readable TypeScript reconstruction layer. It is written
from observable agent contracts and keeps names that explain the protocol
instead of preserving generated one-letter identifiers.

- `protocol.ts` models JSONL messages, model responses, and tool blocks.
- `loader.ts` parses `--agents` objects and markdown agent files.
- `scheduler.ts` models foreground/background Task lifecycle and concurrency.
- `tool-boundary.ts` defines built-in tool inputs and validation.
- `types.ts` contains the shared agent data model and validation limits.

The command line entry point uses these modules directly. The implementation
is intentionally independent of the original executable; it aims to preserve
the observable agent contracts while remaining inspectable and testable.
