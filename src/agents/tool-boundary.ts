import type { ToolDefinition, ToolUseBlock } from "./protocol.js";

export const BUILTIN_TOOL_NAMES = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "WebFetch", "WebSearch",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export interface ReadToolInput { file_path: string; offset?: number; limit?: number }
export interface WriteToolInput { file_path: string; content: string }
export interface EditToolInput { file_path: string; old_string: string; new_string: string; replace_all?: boolean }
export interface BashToolInput { command: string; description?: string; timeout?: number; run_in_background?: boolean }
export interface TaskToolInput {
  description: string;
  prompt: string;
  subagent_type?: string;
  model?: string;
  run_in_background?: boolean;
  name?: string;
  isolation?: "worktree" | "remote" | string;
}

export function builtinToolDefinitions(): readonly ToolDefinition[] {
  return [
    { name: "Read", description: "Read a file from the workspace.", input_schema: objectSchema({ file_path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, ["file_path"]) },
    { name: "Write", description: "Write complete file contents.", input_schema: objectSchema({ file_path: { type: "string" }, content: { type: "string" } }, ["file_path", "content"]) },
    { name: "Edit", description: "Replace text in an existing file.", input_schema: objectSchema({ file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, ["file_path", "old_string", "new_string"]) },
    { name: "Bash", description: "Run a shell command in the workspace.", input_schema: objectSchema({ command: { type: "string" }, description: { type: "string" }, timeout: { type: "integer" }, run_in_background: { type: "boolean" } }, ["command"]) },
    { name: "Task", description: "Start a focused foreground or background subagent.", input_schema: objectSchema({ description: { type: "string" }, prompt: { type: "string" }, subagent_type: { type: "string" }, model: { type: "string" }, run_in_background: { type: "boolean" }, name: { type: "string" }, isolation: { type: "string" } }, ["description", "prompt"]) },
  ];
}

export function isBuiltinTool(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

export function validateToolInput(call: ToolUseBlock): void {
  if (!isBuiltinTool(call.name)) return;
  if (call.input === null || typeof call.input !== "object" || Array.isArray(call.input)) {
    throw new Error(`${call.name} input must be an object`);
  }
  const required: Partial<Record<BuiltinToolName, readonly string[]>> = {
    Read: ["file_path"], Write: ["file_path", "content"], Edit: ["file_path", "old_string", "new_string"],
    Bash: ["command"], Task: ["description", "prompt"],
  };
  for (const key of required[call.name] ?? []) {
    if (typeof call.input[key] !== "string") throw new Error(`${call.name}.${key} must be a string`);
  }
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}
