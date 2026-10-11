/**
 * Readable model of the JSONL protocol used by Claude Code's agent process.
 *
 * The original client uses short generated identifiers internally. These
 * names describe the public wire protocol directly and remain independent of
 * any generated implementation details.
 */

export type MessageRole = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | readonly (TextBlock | ImageBlock)[];
  is_error?: boolean;
}

export interface ImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type: string;
    data?: string;
    url?: string;
  };
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

export interface ConversationMessage {
  role: MessageRole;
  content: string | readonly ContentBlock[];
}

export interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ModelResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: readonly ContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: AgentUsage;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentTurnRequest {
  model: string;
  system?: string;
  messages: readonly ConversationMessage[];
  tools?: readonly ToolDefinition[];
  max_tokens: number;
  temperature?: number;
}

export interface JsonlSystemEvent {
  type: "system";
  subtype: string;
  [key: string]: unknown;
}

export interface JsonlResultEvent {
  type: "result";
  subtype: "success" | "error_during_execution";
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  [key: string]: unknown;
}

export type AgentStreamEvent =
  | JsonlSystemEvent
  | JsonlResultEvent
  | ConversationMessage & { type: "assistant" | "user" };

export function parseJsonlEvent(line: string): AgentStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid agent JSONL: ${(error as Error).message}`);
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Agent event must be an object with a string type");
  }
  return value as AgentStreamEvent;
}

export function encodeJsonlEvent(event: AgentStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function textOf(content: string | readonly ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function toolUses(response: ModelResponse): readonly ToolUseBlock[] {
  return response.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use",
  );
}

export function createToolResult(
  call: ToolUseBlock,
  content: string,
  isError = false,
): ToolResultBlock {
  return {
    type: "tool_result",
    tool_use_id: call.id,
    content,
    ...(isError ? { is_error: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
