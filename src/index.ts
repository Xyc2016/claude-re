#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentRuntime } from "./agent-runtime.js";
import { loadRuntimeConfig, parseCliArguments } from "./config.js";
import { loadAgentsJson } from "./agents/loader.js";

const VERSION = "2.1.285-reconstructed";
const HELP = `Usage: claude [options] [prompt]

Independent TypeScript agent runtime

Options:
  --settings <file>             JSON settings file
  --model <model>               Model identifier
  --system-prompt <prompt>      System prompt
  --agents <file>               Agent definitions JSON
  --max-turns <number>          Maximum model/tool turns (default: 50)
  --output-format <format>      text, json, or stream-json
  --print, -p                   Print one prompt and exit
  --dangerously-skip-permissions
  --help, -h                    Display help
  --version, -v                 Display version
`;

async function main(): Promise<void> {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.command === "help") { console.log(HELP); return; }
  if (options.command === "version") { console.log(VERSION); return; }
  if (options.command === "agents") { console.log(JSON.stringify([])); return; }
  if (options.command === "doctor") { console.log("Independent TypeScript runtime: ready"); return; }
  const config = await loadRuntimeConfig(options);
  if (options.agentsFile && options.agent) {
    const agentText = await readFile(options.agentsFile, "utf8");
    const agent = loadAgentsJson(agentText).get(options.agent);
    if (!agent) throw new Error(`Unknown agent: ${options.agent}`);
    options.systemPrompt = `${options.systemPrompt ?? ""}\n\nYou are the ${agent.name} agent.\n${agent.prompt}`.trim();
  }
  const events: Record<string, unknown>[] = [];
  const runtime = new AgentRuntime(config, (event) => {
    events.push(event);
    if (options.outputFormat === "stream-json") console.log(JSON.stringify(event));
  });
  if (options.print || options.prompt) {
    const prompt = options.prompt ?? await readPrompt();
    const result = await runtime.run(prompt);
    emitResult(options.outputFormat, result, events);
    return;
  }
  const reader = createInterface({ input, output });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const result = await runtime.run(line);
      console.log(result.text);
    }
  } finally {
    reader.close();
  }
}

async function readPrompt(): Promise<string> {
  if (!input.isTTY) {
    let text = "";
    for await (const chunk of input) text += chunk;
    return text.trim();
  }
  const reader = createInterface({ input, output });
  try { return await reader.question("> "); } finally { reader.close(); }
}

function emitResult(format: string, result: { text: string; turns: number }, events: readonly Record<string, unknown>[]): void {
  if (format === "json") {
    console.log(JSON.stringify({ type: "result", subtype: "success", result: result.text, num_turns: result.turns, events }));
  } else if (format !== "stream-json") {
    console.log(result.text);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
