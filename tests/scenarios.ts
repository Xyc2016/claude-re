import { join } from "node:path";
import { callsIn, resultsIn, type Block, type Reply, type RequestBody } from "./fixture.ts";

export interface ToolStep {
  tool: string;
  input: Record<string, unknown>;
  error?: boolean;
  contains?: string;
}

export interface Scenario {
  name: string;
  initialFiles?: Record<string, string>;
  steps?: (cwd: string) => ToolStep[];
  expectedFiles?: Record<string, string>;
  flags?: string[];
  environment?: Record<string, string>;
  format?: "json" | "stream-json";
  delegate?: boolean;
  transientFailure?: boolean;
  bare?: boolean;
}

const inputFile = "input.txt";
const initial = "alpha\nbeta 中文\ngamma\n";
const readStep = (cwd: string): ToolStep => ({ tool: "Read", input: { file_path: join(cwd, inputFile) } });
export const scenarios: Scenario[] = [
  { name: "plain-answer" },
  { name: "read-unicode-range", initialFiles: { [inputFile]: initial }, steps: cwd => [{ tool: "Read", input: { file_path: join(cwd, inputFile), offset: 2, limit: 1 }, contains: "beta 中文" }] },
  { name: "read-offset-zero", initialFiles: { [inputFile]: initial }, steps: cwd => [{ tool: "Read", input: { file_path: join(cwd, inputFile), offset: 0, limit: 1 }, contains: "alpha" }] },
  { name: "read-missing-file", steps: cwd => [{ tool: "Read", input: { file_path: join(cwd, "missing.txt") }, error: true }] },
  { name: "read-outside-workspace", steps: () => [{ tool: "Read", input: { file_path: "/tmp/claude-re-outside.txt" }, error: true }] },
  { name: "write-new-file", bare: false, steps: cwd => [{ tool: "Write", input: { file_path: join(cwd, "nested/out.txt"), content: "written 中文\n" } }], expectedFiles: { "nested/out.txt": "written 中文\n" } },
  { name: "read-edit-chain", initialFiles: { [inputFile]: initial }, steps: cwd => [readStep(cwd), { tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "beta 中文", new_string: "changed" } }], expectedFiles: { [inputFile]: "alpha\nchanged\ngamma\n" } },
  { name: "edit-ambiguous", initialFiles: { [inputFile]: "same same\n" }, steps: cwd => [readStep(cwd), { tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "same", new_string: "new" }, error: true }], expectedFiles: { [inputFile]: "same same\n" } },
  { name: "edit-replace-all", initialFiles: { [inputFile]: "same same\n" }, steps: cwd => [readStep(cwd), { tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "same", new_string: "new", replace_all: true } }], expectedFiles: { [inputFile]: "new new\n" } },
  { name: "edit-missing-string", initialFiles: { [inputFile]: initial }, steps: cwd => [readStep(cwd), { tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "absent", new_string: "new" }, error: true }], expectedFiles: { [inputFile]: initial } },
  { name: "edit-literal-dollar", initialFiles: { [inputFile]: "old\n" }, steps: cwd => [readStep(cwd), { tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "old", new_string: "$&-$`-$'" } }], expectedFiles: { [inputFile]: "$&-$`-$'\n" } },
  { name: "edit-before-read", initialFiles: { [inputFile]: initial }, steps: cwd => [{ tool: "Edit", input: { file_path: join(cwd, inputFile), old_string: "alpha", new_string: "changed" } }], expectedFiles: { [inputFile]: "changed\nbeta 中文\ngamma\n" } },
  { name: "bash-workspace", steps: () => [{ tool: "Bash", input: { command: "printf 'BASH_OK' > shell.txt; cat shell.txt", description: "Write and read a test marker" }, contains: "BASH_OK" }], expectedFiles: { "shell.txt": "BASH_OK" } },
  { name: "bash-failure", steps: () => [{ tool: "Bash", input: { command: "printf 'FAIL_MARKER' >&2; exit 7", description: "Test nonzero exit" }, error: true, contains: "FAIL_MARKER" }] },
  { name: "bash-profile-environment", environment: { CLAUDE_RE_FIXTURE_VALUE: "PROFILE_MARKER" }, steps: () => [{ tool: "Bash", input: { command: 'printf "%s" "$CLAUDE_RE_FIXTURE_VALUE"', description: "Read test profile environment" }, contains: "PROFILE_MARKER" }] },
  { name: "permission-plan-write", flags: ["--permission-mode", "plan"], steps: cwd => [{ tool: "Write", input: { file_path: join(cwd, "denied.txt"), content: "must not write" }, error: true }] },
  { name: "foreground-subagent", bare: false, delegate: true },
  { name: "retry-rate-limit", transientFailure: true },
  { name: "stream-result-envelope", format: "stream-json" },
];

export function scenarioReply(scenario: Scenario, cwd: string, body: RequestBody, attempts: number): Reply {
  if (attempts > 16) throw new Error("Scenario exceeded fixture request budget");
  if (scenario.transientFailure && attempts === 1) return { blocks: [], status: 429 };
  const marker = "CHILD_SCENARIO_PROMPT";
  if (scenario.delegate && body.messages.some(message => typeof message.content === "string" && message.content.includes(marker))) {
    return { blocks: [{ type: "text", text: "CHILD_OK" }] };
  }
  if (scenario.delegate && !callsIn(body).some(call => call.id?.startsWith("bench_"))) {
    const tool = body.tools?.some(tool => tool.name === "Agent") ? "Agent" : "Task";
    return { blocks: [{ type: "tool_use", id: "bench_delegate", name: tool, input: { description: "Reply to a child scenario", prompt: marker, subagent_type: "general-purpose" } }] };
  }
  const steps = scenario.steps?.(cwd) ?? [];
  const completed = resultsIn(body).filter(block => block.tool_use_id?.startsWith("bench_")).length;
  if (completed < steps.length) {
    const step = steps[completed];
    return { blocks: [{ type: "tool_use", id: `bench_${completed}`, name: step.tool, input: step.input }] };
  }
  return { blocks: [{ type: "text", text: "SCENARIO_OK" }] };
}

export function resultText(block: Block): string {
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) return block.content.map(value => value?.text ?? "").join("\n");
  return "";
}
