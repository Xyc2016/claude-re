import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ToolDefinition, ToolUseBlock } from "./agents/protocol.js";
import { builtinToolDefinitions, type BashToolInput, type EditToolInput, type ReadToolInput, type WriteToolInput } from "./agents/tool-boundary.js";

export interface ToolContext {
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  permissionMode?: "default" | "plan";
  runTask?: (input: Record<string, unknown>) => Promise<string>;
}

export function toolDefinitions(): readonly ToolDefinition[] {
  return builtinToolDefinitions();
}

export async function executeTool(call: ToolUseBlock, context: ToolContext): Promise<string> {
  switch (call.name) {
    case "Read": return readTool(call.input as unknown as ReadToolInput, context.cwd);
    case "Write":
      if (context.permissionMode === "plan") throw new Error("Write is not available in plan mode");
      return writeTool(call.input as unknown as WriteToolInput, context.cwd);
    case "Edit":
      if (context.permissionMode === "plan") throw new Error("Edit is not available in plan mode");
      return editTool(call.input as unknown as EditToolInput, context.cwd);
    case "Bash": return bashTool(call.input as unknown as BashToolInput, context.cwd, context.environment);
    case "Agent":
    case "Task":
      if (context.permissionMode === "plan") throw new Error("Task is not available in plan mode");
      if (!context.runTask) throw new Error("Task is unavailable in this agent context");
      return context.runTask(call.input);
    default: throw new Error(`Tool ${call.name} is not implemented by the independent runtime`);
  }
}

async function readTool(input: ReadToolInput, cwd: string): Promise<string> {
  const path = workspacePath(input.file_path, cwd);
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/u);
  const start = Math.max(0, (input.offset ?? 1) - 1);
  const end = Math.min(lines.length, start + (input.limit ?? 2_000));
  return lines.slice(start, end).map((line, index) => `${start + index + 1}\t${line}`).join("\n");
}

async function writeTool(input: WriteToolInput, cwd: string): Promise<string> {
  const path = workspacePath(input.file_path, cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.content, "utf8");
  return `Wrote ${input.content.length} characters to ${input.file_path}`;
}

async function editTool(input: EditToolInput, cwd: string): Promise<string> {
  const path = workspacePath(input.file_path, cwd);
  const original = await readFile(path, "utf8");
  const occurrences = original.split(input.old_string).length - 1;
  if (occurrences === 0) throw new Error(`old_string was not found in ${input.file_path}`);
  if (occurrences > 1 && !input.replace_all) throw new Error(`old_string occurs ${occurrences} times; use replace_all`);
  // Use a function replacer so `$&`, `$`` and `$'` in user text stay literal.
  const replaceOnce = (value: string): string => value.replace(input.old_string, () => input.new_string);
  const updated = input.replace_all ? original.split(input.old_string).join(input.new_string) : replaceOnce(original);
  await writeFile(path, updated, "utf8");
  return `Updated ${input.file_path}`;
}

async function bashTool(input: BashToolInput, cwd: string, environment?: NodeJS.ProcessEnv): Promise<string> {
  const timeout = input.timeout ?? 120_000;
  const contextEnvironment = environment ?? process.env;
  return new Promise((resolveResult, reject) => {
    const child = spawn("/bin/sh", ["-c", input.command], { cwd, env: contextEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Command timed out after ${timeout}ms`)); }, timeout);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
      if (code !== 0) reject(new Error(`Command exited with ${code}: ${output}`));
      else resolveResult(output || "(no output)");
    });
  });
}

function workspacePath(requested: string, cwd: string): string {
  const candidate = resolve(cwd, requested);
  if (isAbsolute(requested) && !candidate.startsWith(`${resolve(cwd)}/`)) throw new Error(`Path is outside the workspace: ${requested}`);
  if (!candidate.startsWith(`${resolve(cwd)}/`) && candidate !== resolve(cwd)) throw new Error(`Path is outside the workspace: ${requested}`);
  return candidate;
}
