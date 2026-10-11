import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArguments } from "../src/config.ts";
import { executeTool, toolDefinitions } from "../src/tools.ts";

test("CLI parses agent and permission flags", () => {
  const options = parseCliArguments(["--bare", "--dangerously-skip-permissions", "--permission-mode", "plan", "--output-format", "stream-json", "--max-turns", "3", "prompt"]);
  assert.equal(options.bare, true);
  assert.equal(options.dangerouslySkipPermissions, true);
  assert.equal(options.permissionMode, "plan");
  assert.equal(options.outputFormat, "stream-json");
  assert.equal(options.maxTurns, 3);
  assert.equal(options.prompt, "prompt");
});

test("CLI rejects unknown flags and invalid positive integers", () => {
  assert.throws(() => parseCliArguments(["--unknown"]), /Unknown option/);
  assert.throws(() => parseCliArguments(["--max-turns", "0"]), /positive integer/);
  assert.throws(() => parseCliArguments(["--permission-mode", "yolo"]), /Unsupported permission mode/);
});

test("full tool contract uses the reference order", () => {
  assert.deepEqual(toolDefinitions().map((tool) => tool.name), [
    "Agent", "Bash", "CronCreate", "CronDelete", "CronList", "Edit", "EnterWorktree", "ExitWorktree", "ListAgents", "NotebookEdit", "Read", "ReportFindings", "ScheduleWakeup", "SendMessage", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "WebFetch", "WebSearch", "Workflow", "Write",
  ]);
  const read = toolDefinitions().find((tool) => tool.name === "Read");
  assert.deepEqual(read?.input_schema.required, ["file_path"]);
});

test("Read returns one-based numbered lines and honors offset and limit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  const path = join(cwd, "input.txt");
  await writeFile(path, "one\ntwo\nthree\n", "utf8");
  const result = await executeTool({ type: "tool_use", id: "read", name: "Read", input: { file_path: path, offset: 2, limit: 1 } }, { cwd });
  assert.equal(result, "2\ttwo");
});

test("Write creates parent directories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  await executeTool({ type: "tool_use", id: "write", name: "Write", input: { file_path: join(cwd, "a", "b.txt"), content: "中文" } }, { cwd });
  assert.equal(await readFile(join(cwd, "a", "b.txt"), "utf8"), "中文");
});

test("Edit treats replacement dollar syntax literally", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  const path = join(cwd, "input.txt");
  await writeFile(path, "old\n", "utf8");
  await executeTool({ type: "tool_use", id: "edit", name: "Edit", input: { file_path: path, old_string: "old", new_string: "$&-$`-$'" } }, { cwd });
  assert.equal(await readFile(path, "utf8"), "$&-$`-$'\n");
});

test("Edit rejects ambiguous replacement without replace_all", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  const path = join(cwd, "input.txt");
  await writeFile(path, "same same\n", "utf8");
  await assert.rejects(() => executeTool({ type: "tool_use", id: "edit", name: "Edit", input: { file_path: path, old_string: "same", new_string: "new" } }, { cwd }), /occurs 2 times/);
});

test("Bash receives settings environment and reports stderr on failure", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  const result = await executeTool({ type: "tool_use", id: "bash", name: "Bash", input: { command: "printf '%s' \"$CLAUDE_RE_TEST_VALUE\"" } }, { cwd, environment: { ...process.env, CLAUDE_RE_TEST_VALUE: "marker" } });
  assert.equal(result, "marker");
  await assert.rejects(() => executeTool({ type: "tool_use", id: "bash", name: "Bash", input: { command: "printf 'failure' >&2; exit 7" } }, { cwd }), /failure/);
});

test("plan mode blocks mutating tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  await assert.rejects(() => executeTool({ type: "tool_use", id: "write", name: "Write", input: { file_path: join(cwd, "denied"), content: "x" } }, { cwd, permissionMode: "plan" }), /not available in plan mode/);
});

test("tool execution rejects paths outside the workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "claude-re-contract-"));
  await assert.rejects(() => executeTool({ type: "tool_use", id: "read", name: "Read", input: { file_path: "/etc/hosts" } }, { cwd }), /outside the workspace/);
});
