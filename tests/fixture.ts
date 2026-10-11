/** A deterministic model endpoint, shared by both CLIs. No real API keys or models. */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface Block {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface RequestBody {
  model: string;
  stream?: boolean;
  tools?: { name: string }[];
  system?: unknown;
  messages: { role: string; content: string | Block[] }[];
}

export interface Reply {
  blocks: Block[];
  status?: number;
}

export function resultsIn(body: RequestBody): Block[] {
  return body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === "tool_result");
}

export function callsIn(body: RequestBody): Block[] {
  return body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === "tool_use");
}

export async function createModelFixture(respond: (body: RequestBody, attempt: number) => Reply) {
  const requests: RequestBody[] = [];
  const errors: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.split("?")[0].endsWith("/messages")) {
      response.writeHead(404).end();
      return;
    }
    try {
      let bytes = "";
      for await (const chunk of request) {
        bytes += chunk;
        if (bytes.length > 8_000_000) throw new Error("Fixture input exceeded 8 MB");
      }
      const body = JSON.parse(bytes) as RequestBody;
      requests.push(body);
      const reply = respond(body, requests.length);
      if (reply.status) {
        response.writeHead(reply.status, { "content-type": "application/json", "retry-after": "0" });
        response.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "fixture transient failure" } }));
        return;
      }
      const stopReason = reply.blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn";
      const message = {
        id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: body.model,
        content: reply.blocks, stop_reason: stopReason, stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
      if (!body.stream) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(message));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (type: string, fields: Record<string, unknown>) => {
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
      };
      send("message_start", { message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } });
      reply.blocks.forEach((block, index) => {
        if (block.type === "tool_use") {
          send("content_block_start", { index, content_block: { ...block, input: {} } });
          send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
        } else {
          send("content_block_start", { index, content_block: { type: "text", text: "" } });
          send("content_block_delta", { index, delta: { type: "text_delta", text: block.text ?? "" } });
        }
        send("content_block_stop", { index });
      });
      send("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } });
      send("message_stop", {});
      response.end();
    } catch (error) {
      errors.push(String(error));
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(error) } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl, requests, errors,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
