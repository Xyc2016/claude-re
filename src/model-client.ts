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
    let response: { status: number; body: unknown } | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await postJson(`${this.baseUrl}/v1/messages`, headers, request);
      if (response.status >= 200 && response.status < 300) break;
      if (!isRetryable(response.status) || attempt === 2) break;
      await delay(100 * (attempt + 1));
    }
    const { status, body } = response!;
    if (status < 200 || status >= 300) throw new Error(`Anthropic API ${status}: ${describeError(body)}`);
    if (!isRecord(body) || body.type !== "message") throw new Error("Anthropic API returned an invalid message");
    return body as unknown as ModelResponse;
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<{ status: number; body: unknown }> {
  const payloadIsStream = isRecord(payload) && payload.stream === true;
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
      try { body = payloadIsStream ? parseSseMessage(bodyText) : JSON.parse(bodyText); } catch { body = bodyText; }
      resolve({ status, body });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseSseMessage(input: string): unknown {
  const events = input.split(/\r?\n\r?\n/u).flatMap((chunk) => {
    const type = chunk.match(/^event:\s*(.+)$/mu)?.[1]?.trim();
    const data = chunk.match(/^data:\s*(.+)$/mu)?.[1];
    if (!data) return [];
    try { return [{ type, value: JSON.parse(data) as Record<string, unknown> }]; } catch { return []; }
  });
  const start = events.find((event) => event.type === "message_start")?.value.message as Record<string, unknown> | undefined;
  if (!start) throw new Error("Anthropic stream did not contain message_start");
  const content: Array<Record<string, unknown>> = [];
  for (const event of events) {
    const value = event.value;
    if (event.type === "content_block_start" && value.content_block && typeof value.content_block === "object") {
      content[Number(value.index)] = { ...(value.content_block as Record<string, unknown>) };
    } else if (event.type === "content_block_delta" && value.delta && typeof value.delta === "object") {
      const index = Number(value.index);
      const block = content[index] ?? (content[index] = {});
      const delta = value.delta as Record<string, unknown>;
      if (delta.type === "text_delta") block.text = `${typeof block.text === "string" ? block.text : ""}${String(delta.text ?? "")}`;
      if (delta.type === "input_json_delta") {
        block.inputJson = `${typeof block.inputJson === "string" ? block.inputJson : ""}${String(delta.partial_json ?? "")}`;
      }
    } else if (event.type === "message_delta" && value.delta && typeof value.delta === "object") {
      start.stop_reason = (value.delta as Record<string, unknown>).stop_reason ?? start.stop_reason;
    }
  }
  for (const block of content) {
    if (block.inputJson !== undefined) {
      try { block.input = JSON.parse(String(block.inputJson)); } catch { block.input = {}; }
      delete block.inputJson;
    }
  }
  start.content = content.filter(Boolean);
  return start;
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
