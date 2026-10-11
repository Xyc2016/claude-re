import { execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const reference = process.env.CLAUDE_REFERENCE_BINARY;
if (!reference) throw new Error("Set CLAUDE_REFERENCE_BINARY to the installed Claude CLI");
const outputDirectory = process.env.CLAUDE_RE_OBSERVATION_DIR ?? join(homedir(), ".codex/memory/local/claude-re-reference");
await mkdir(outputDirectory, { recursive: true });
const hook = join(outputDirectory, "syscall-hook.so");
await execFileAsync("cc", ["-shared", "-fPIC", "-O2", "-o", hook, join(projectRoot, "tests/syscall-hook.c"), "-ldl"]);
const logPath = join(outputDirectory, "syscalls.log");
const requests = join(outputDirectory, "requests");
await mkdir(requests, { recursive: true });
const child = spawn(process.execPath, ["--import", "tsx", "tests/differential.ts"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CLAUDE_REFERENCE_BINARY: reference,
    CLAUDE_RE_DUMP_REQUESTS: requests,
    RE_PROCESS_LD_PRELOAD: hook,
    RE_PROCESS_CLAUDE_SYSCALL_LOG: logPath,
  },
  stdio: "inherit",
});
const exitCode = await new Promise<number>((resolveExit) => child.once("exit", (code) => resolveExit(code ?? 1)));
console.log(`Syscall log: ${logPath}`);
console.log(`Request bodies: ${requests}`);
process.exitCode = exitCode;
