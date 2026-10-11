import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createModelFixture, resultsIn } from "./fixture.ts";
import { resultText, scenarioReply, type Scenario } from "./scenarios.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const reportDirectory = process.env.CLAUDE_RE_REPORT_DIR ?? join(homedir(), ".codex/memory/local/claude-re-tests");

export interface Observation {
  exitCode: number | null;
  timedOut: boolean;
  finalText: string;
  modelRequests: number;
  advertisedTools: string[];
  streamModes: boolean[];
  systemIsStructured: boolean;
  toolResults: { id: string; isError: boolean; containsExpectedText: boolean }[];
  files: Record<string, string>;
  violations: string[];
  fixtureErrors: string[];
  stderr: string;
}

export async function observeScenario(scenario: Scenario, referenceBinary?: string): Promise<Observation> {
  await mkdir(reportDirectory, { recursive: true });
  const lab = await mkdtemp(join(reportDirectory, "case-"));
  const cwd = join(lab, "workspace");
  const profile = join(lab, "profile");
  await mkdir(cwd);
  await mkdir(profile);
  for (const [path, content] of Object.entries(scenario.initialFiles ?? {})) {
    await writeFile(join(cwd, path), content);
  }
  const fixture = await createModelFixture((body, attempt) => scenarioReply(scenario, cwd, body, attempt));
  try {
    const settingsPath = join(lab, "settings.json");
    await writeFile(settingsPath, JSON.stringify({
      model: "claude-sonnet-4-6",
      env: {
        ANTHROPIC_API_KEY: "fixture-key-no-real-credential",
        ANTHROPIC_BASE_URL: fixture.baseUrl,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...(scenario.environment ?? {}),
      },
    }));
    const flags = scenario.flags ?? ["--dangerously-skip-permissions"];
    const args = [...(scenario.bare === false ? [] : ["--bare"]), "--no-session-persistence", "--settings", settingsPath,
      "--print", "--output-format", scenario.format ?? "json", "--verbose", ...flags,
      "--max-turns", "8", "Run the deterministic fixture task and report its result."];
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (/^(ANTHROPIC_|CLAUDE_|CLAUDE_CODE_)/u.test(key)) delete environment[key];
    }
    Object.assign(environment, {
      CLAUDE_CONFIG_DIR: profile, DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_ANALYTICS: "1", CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
      NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
    });
    // Test-only escape hatch for observing the reference process. For example,
    // CLAUDE_RE_PROCESS_LD_PRELOAD becomes LD_PRELOAD only in the child CLI.
    for (const [key, value] of Object.entries(environment)) {
      if (key.startsWith("RE_PROCESS_")) environment[key.slice("RE_PROCESS_".length)] = value;
    }
    const command = referenceBinary ?? process.execPath;
    const argv = referenceBinary ? args : [resolve(projectRoot, "dist/index.js"), ...args];
    const processResult = await runProcess(command, argv, cwd, environment);
    const dumpDirectory = process.env.CLAUDE_RE_DUMP_REQUESTS;
    if (dumpDirectory) {
      await mkdir(dumpDirectory, { recursive: true });
      await writeFile(join(dumpDirectory, `${scenario.name}-${referenceBinary ? "reference" : "candidate"}.json`), JSON.stringify(fixture.requests, null, 2) + "\n");
    }
    let events: Record<string, unknown>[] = [];
    try {
      if (scenario.format === "stream-json") events = processResult.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      else {
        const output = JSON.parse(processResult.stdout.trim());
        events = Array.isArray(output) ? output : [output];
      }
    } catch { /* Missing or malformed envelopes become explicit violations. */ }
    const final = events.findLast(event => event.type === "result");
    const lastRequest = fixture.requests.at(-1);
    const steps = scenario.steps?.(cwd) ?? [];
    const observedResults = lastRequest ? resultsIn(lastRequest).filter(result => result.tool_use_id?.startsWith("bench_")) : [];
    const files = await snapshotFiles(cwd);
    const violations: string[] = [];
    if (processResult.timedOut) violations.push("process timeout");
    if (processResult.exitCode !== 0) violations.push(`exit code ${processResult.exitCode}`);
    if (final?.result !== "SCENARIO_OK") violations.push("missing final result envelope or wrong final text");
    if (observedResults.length !== (scenario.delegate ? 1 : steps.length)) violations.push("wrong number of completed tool calls");
    const toolResults = observedResults.map((result, index) => {
      const expectedError = steps[index]?.error ?? false;
      if (!!result.is_error !== expectedError) violations.push(`tool ${index}: error status differs from contract`);
      const expectedText = scenario.delegate ? "CHILD_OK" : steps[index]?.contains;
      const containsExpectedText = expectedText === undefined || resultText(result).includes(expectedText);
      if (!containsExpectedText) violations.push(`tool ${index}: expected text absent`);
      return { id: result.tool_use_id ?? "", isError: !!result.is_error, containsExpectedText };
    });
    const expectedFiles = { ...(scenario.initialFiles ?? {}), ...(scenario.expectedFiles ?? {}) };
    if (JSON.stringify(files) !== JSON.stringify(sortRecord(expectedFiles))) violations.push("workspace file contents differ from contract");
    if (fixture.errors.length) violations.push("fixture errors invalidate test");
    return {
      exitCode: processResult.exitCode, timedOut: processResult.timedOut,
      finalText: typeof final?.result === "string" ? final.result : "",
      modelRequests: fixture.requests.length,
      advertisedTools: [...new Set(fixture.requests.flatMap(request => request.tools?.map(tool => tool.name) ?? []))].sort(),
      streamModes: fixture.requests.map((request) => request.stream === true),
      systemIsStructured: Array.isArray(fixture.requests[0]?.system),
      toolResults, files, violations, fixtureErrors: fixture.errors,
      stderr: processResult.stderr.slice(-4000),
    };
  } finally {
    await fixture.close();
    await rm(lab, { recursive: true, force: true });
  }
}

async function snapshotFiles(directory: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // CLI housekeeping is outside the fixture's application filesystem contract.
    if (entry.name.startsWith(".")) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await snapshotFiles(join(directory, entry.name), `${name}/`));
    else if (entry.isFile()) files[name] = await readFile(join(directory, entry.name), "utf8");
  }
  return sortRecord(files);
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function runProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const terminate = () => {
      if (!child.pid) return;
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, 40_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", exitCode => { clearTimeout(timer); terminate(); resolveResult({ stdout, stderr, exitCode, timedOut }); });
  });
}
