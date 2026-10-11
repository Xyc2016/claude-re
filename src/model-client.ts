import { spawn } from "node:child_process";
import type { AgentTurnRequest, ModelResponse } from "./agents/protocol.js";

export class AnthropicMessagesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async createMessage(request: AgentTurnRequest): Promise<ModelResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": this.apiKey,
    };
    for (const [key, value] of parseCustomHeaders(this.environment.ANTHROPIC_CUSTOM_HEADERS)) headers[key] = value;
    const { status, body } = await postJson(`${this.baseUrl}/v1/messages`, headers, request);
    if (status < 200 || status >= 300) throw new Error(`Anthropic API ${status}: ${describeError(body)}`);
    if (!isRecord(body) || body.type !== "message") throw new Error("Anthropic API returned an invalid message");
    return body as unknown as ModelResponse;
  }
}

function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["--silent", "--show-error", "--include", "--max-time", "120", url, ...Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]), "--data-binary", "@-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) { reject(new Error(stderr.trim() || `curl exited with ${code}`)); return; }
      const separator = stdout.lastIndexOf("\r\n\r\n");
      const headerText = separator >= 0 ? stdout.slice(0, separator) : "";
      const bodyText = separator >= 0 ? stdout.slice(separator + 4) : stdout;
      const statuses = [...headerText.matchAll(/^HTTP\/\S+ (\d+)/gm)];
      const status = Number(statuses.at(-1)?.[1] ?? 0);
      let body: unknown;
      try { body = JSON.parse(bodyText); } catch { body = bodyText; }
      resolve({ status, body });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseCustomHeaders(value: string | undefined): Array<[string, string]> {
  if (!value) return [];
  return value.split(/[,\n]/u).flatMap((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1) return [];
    return [[entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()] as [string, string]];
  });
}

function describeError(value: unknown): string {
  if (isRecord(value) && typeof value.error === "object" && value.error !== null && "message" in value.error) return String((value.error as Record<string, unknown>).message);
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
