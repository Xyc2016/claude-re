import type { ToolDefinition, ToolUseBlock } from "./protocol.js";

export const BUILTIN_TOOL_NAMES = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent", "CronCreate", "CronDelete", "CronList",
  "EnterWorktree", "ExitWorktree", "ListAgents", "NotebookEdit", "ReportFindings", "ScheduleWakeup",
  "SendMessage", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "WebFetch", "WebSearch", "Workflow",
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
  const definitions = [
    { name: "Read", description: "read files, images, PDFs, notebooks", input_schema: objectSchema({ file_path: { description: "The absolute path to the file to read", type: "string" }, offset: { description: "The line number to start reading from. Only provide if the file is too large to read at once", type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, limit: { description: "The number of lines to read. Only provide if the file is too large to read at once.", type: "integer", exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER }, pages: { description: "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request.", type: "string" } }, ["file_path"]) },
    { name: "Write", description: "Write complete file contents.", input_schema: objectSchema({ file_path: { type: "string" }, content: { type: "string" } }, ["file_path", "content"]) },
    { name: "Edit", description: "modify file contents in place", input_schema: objectSchema({ file_path: { description: "The absolute path to the file to modify", type: "string" }, old_string: { description: "The text to replace", type: "string" }, new_string: { description: "The text to replace it with (must be different from old_string)", type: "string" }, replace_all: { description: "Replace all occurrences of old_string (default false)", default: false, type: "boolean" } }, ["file_path", "old_string", "new_string"]) },
    { name: "Bash", description: "execute shell commands", input_schema: objectSchema({ command: { description: "The command to execute", type: "string" }, timeout: { description: "Optional timeout in milliseconds (max 600000 for a foreground command)", type: "number" }, description: { description: "Clear, concise description of what this command does in active voice. Never use words like \"complex\" or \"risk\" in the description - just describe what it does.\n\nSay what the command does in plain words: do not echo the command's text, its flags, or file paths - the user reads this description, often without seeing it.\n\nFor simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):\n- ls → \"List files in current directory\"\n- git status → \"Show working tree status\"\n- npm install → \"Install package dependencies\"\n- curl -s url | jq '.data[]' → \"Fetch JSON from URL and extract data array elements\"\n\nFor commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:\n- find . -name \"*.tmp\" -exec rm {} \\\\; → \"Find and delete all .tmp files recursively\"\n- git reset --hard origin/main → \"Discard local changes and match origin/main\"\n- curl -s url | jq '.data[]' → \"Fetch JSON and extract data array elements\"", type: "string" }, run_in_background: { description: "Set to true to run the command in the background", type: "boolean" }, dangerouslyDisableSandbox: { description: "Set this to true to dangerously override sandbox mode and run commands without sandboxing.", type: "boolean" } }, ["command"]) },
    { name: "Agent", description: "Launch a focused foreground or background subagent.", input_schema: objectSchema({ description: { type: "string" }, prompt: { type: "string" }, subagent_type: { type: "string" }, model: { type: "string" }, run_in_background: { type: "boolean" }, isolation: { type: "string" } }, ["description", "prompt"]) },
    ...["CronCreate", "CronDelete", "CronList", "EnterWorktree", "ExitWorktree", "ListAgents", "NotebookEdit", "ReportFindings", "ScheduleWakeup", "SendMessage", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "WebFetch", "WebSearch", "Workflow"].map((name) => ({
      name,
      description: `${name} is available in the agent runtime.`,
      input_schema: { type: "object", additionalProperties: true },
    })),
  ];
  const order = ["Agent", "Bash", "CronCreate", "CronDelete", "CronList", "Edit", "EnterWorktree", "ExitWorktree", "ListAgents", "NotebookEdit", "Read", "ReportFindings", "ScheduleWakeup", "SendMessage", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "WebFetch", "WebSearch", "Workflow", "Write"];
  return definitions.sort((left, right) => order.indexOf(left.name) - order.indexOf(right.name));
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
    Bash: ["command"], Agent: ["description", "prompt"],
  };
  for (const key of required[call.name] ?? []) {
    if (typeof call.input[key] !== "string") throw new Error(`${call.name}.${key} must be a string`);
  }
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}
