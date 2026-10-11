import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OutputFormat = "text" | "json" | "stream-json";

export interface CliOptions {
  command?: string;
  prompt?: string;
  print: boolean;
  outputFormat: OutputFormat;
  settingsPath?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns: number;
  maxTokens: number;
  agent?: string;
  agentsFile?: string;
  tools: string[];
  cwd: string;
}

export interface SettingsFile {
  apiKeyHelper?: string;
  env?: Record<string, string>;
  model?: string;
  alwaysThinkingEnabled?: boolean;
  [key: string]: unknown;
}

export interface RuntimeConfig {
  options: CliOptions;
  settings: SettingsFile;
  environment: NodeJS.ProcessEnv;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function parseCliArguments(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    print: false,
    outputFormat: "text",
    maxTurns: 50,
    maxTokens: 32_000,
    tools: [],
    cwd: process.cwd(),
  };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--help" || arg === "-h") options.command = "help";
    else if (arg === "--version" || arg === "-v") options.command = "version";
    else if (arg === "--print" || arg === "-p") options.print = true;
    else if (arg === "--settings") options.settingsPath = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--system-prompt") options.systemPrompt = next();
    else if (arg === "--max-turns") options.maxTurns = positiveInteger(next(), "--max-turns");
    else if (arg === "--max-tokens") options.maxTokens = positiveInteger(next(), "--max-tokens");
    else if (arg === "--output-format") options.outputFormat = parseOutputFormat(next());
    else if (arg === "--json") options.outputFormat = "json";
    else if (arg === "--agent") options.agent = next();
    else if (arg === "--agents") options.agentsFile = next();
    else if (arg === "--tools" || arg === "--allowed-tools") options.tools.push(...next().split(/[ ,]+/u).filter(Boolean));
    else if (arg.startsWith("--")) {
      // Permission and UI flags affect the native client, but do not alter the
      // model protocol. Accept them so existing scripts can invoke this CLI.
      if (!new Set(["--dangerously-skip-permissions", "--bare", "--verbose", "--no-session-persistence", "--permission-mode", "--effort"]).has(arg)) {
        throw new Error(`Unknown option: ${arg}`);
      }
      if (arg === "--permission-mode" || arg === "--effort") next();
    } else if (arg === "agents" || arg === "mcp" || arg === "doctor") {
      options.command = arg;
    } else positional.push(arg);
  }
  if (positional.length > 0) options.prompt = positional.join(" ");
  return options;
}

export async function loadRuntimeConfig(options: CliOptions): Promise<RuntimeConfig> {
  const settings = options.settingsPath ? await readSettings(options.settingsPath) : {};
  const environment = { ...process.env, ...(settings.env ?? {}) };
  const apiKey = await resolveApiKey(settings, environment);
  const baseUrl = (environment.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/u, "");
  const model = options.model ?? settings.model ?? environment.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  return { options, settings, environment, apiKey, baseUrl, model };
}

async function readSettings(path: string): Promise<SettingsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings must be a JSON object");
    return parsed as SettingsFile;
  } catch (error) {
    throw new Error(`Unable to load settings ${path}: ${(error as Error).message}`);
  }
}

async function resolveApiKey(settings: SettingsFile, environment: NodeJS.ProcessEnv): Promise<string> {
  if (environment.ANTHROPIC_API_KEY) return environment.ANTHROPIC_API_KEY;
  if (!settings.apiKeyHelper) throw new Error("No ANTHROPIC_API_KEY or apiKeyHelper configured");
  const { stdout } = await execFileAsync("/bin/sh", ["-c", settings.apiKeyHelper], { env: environment });
  const key = stdout.trim();
  if (!key) throw new Error("apiKeyHelper returned an empty key");
  return key;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "stream-json") return value;
  throw new Error(`Unsupported output format: ${value}`);
}
