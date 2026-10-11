/** Public data model for the independent TypeScript agent runtime. */
export type AgentModel = string;
export type AgentIsolation = "worktree" | "remote" | string;

export interface AgentDefinition {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: AgentModel;
  effort?: string;
  permissionMode?: string;
  mcpServers?: unknown;
  hooks?: unknown;
  maxTurns?: number;
  skills?: string[];
  initialPrompt?: string;
  memory?: unknown;
  background?: boolean;
  omitClaudeMd?: boolean;
  isolation?: AgentIsolation;
  observer?: boolean;
  observerMessage?: string;
  observeSubagents?: boolean;
}

export interface AgentFile {
  name: string;
  content: string;
}

const AGENT_FILE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_AGENT_FILES = 64;
const MAX_AGENT_FILE_BYTES = 1024 * 1024;

export function validateAgentFiles(files: readonly AgentFile[]): void {
  if (!Array.isArray(files)) throw new Error("agent_files is not an array");
  if (files.length > MAX_AGENT_FILES) {
    throw new Error(`agent_files has ${files.length} entries (at most ${MAX_AGENT_FILES})`);
  }
  const names = new Set<string>();
  for (const file of files) {
    if (typeof file?.name !== "string" || !AGENT_FILE_NAME.test(file.name)) {
      throw new Error("agent_files entry rejected (name must match ^[a-z][a-z0-9-]{0,63}$)");
    }
    if (typeof file.content !== "string" || Buffer.byteLength(file.content) > MAX_AGENT_FILE_BYTES) {
      throw new Error(`agent_files entry '${file.name}' has invalid content`);
    }
    if (names.has(file.name)) throw new Error(`agent_files contains duplicate name: ${file.name}`);
    names.add(file.name);
  }
}

export function parseAgentsObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("claude_code_args agents is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export const AGENT_FRONTMATTER_FIELDS = Object.freeze([
  "name", "description", "tools", "disallowedTools", "model", "effort",
  "permissionMode", "mcpServers", "hooks", "maxTurns", "skills",
  "initialPrompt", "memory", "background", "omitClaudeMd", "isolation",
  "observer", "observerMessage", "observeSubagents",
] as const);

export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 20;

export function maxConcurrentSubagents(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_CONCURRENT_SUBAGENTS;
}

export interface SubagentRequest {
  description: string;
  prompt: string;
  subagent_type?: string;
  model?: AgentModel;
  run_in_background?: boolean;
  name?: string;
  isolation?: AgentIsolation;
}

export interface BackgroundAgentResult {
  status: "async_launched" | "completed" | "failed";
  agentId?: string;
  taskId?: string;
  outputFile?: string;
  sessionUrl?: string;
}
