import type { RuntimeConfig } from "./config.js";
import { AnthropicMessagesClient } from "./model-client.js";
import {
  createToolResult,
  textOf,
  toolUses,
  type AgentTurnRequest,
  type ConversationMessage,
  type ModelResponse,
} from "./agents/protocol.js";
import { AgentScheduler } from "./agents/scheduler.js";
import { executeTool, toolDefinitions } from "./tools.js";

export interface TurnResult {
  text: string;
  turns: number;
  responses: ModelResponse[];
}

export type EventSink = (event: Record<string, unknown>) => void;

export class AgentRuntime {
  private readonly client: AnthropicMessagesClient;
  private readonly scheduler: AgentScheduler;

  constructor(private readonly config: RuntimeConfig, private readonly sink: EventSink = () => {}) {
    this.client = new AnthropicMessagesClient(config.baseUrl, config.apiKey, config.environment);
    this.scheduler = AgentScheduler.fromEnvironment();
  }

  async run(prompt: string, depth = 0): Promise<TurnResult> {
    if (depth > 4) throw new Error("Subagent depth limit reached");
    const messages: ConversationMessage[] = [{ role: "user", content: prompt }];
    const responses: ModelResponse[] = [];
    for (let turn = 1; turn <= this.config.options.maxTurns; turn += 1) {
      const request: AgentTurnRequest = {
        model: this.config.model,
        max_tokens: this.config.options.maxTokens,
        system: this.config.options.systemPrompt ?? defaultSystemPrompt(this.config.options.cwd),
        messages,
        tools: this.config.options.tools.length === 0 ? toolDefinitions() : toolDefinitions().filter((tool) => this.config.options.tools.includes(tool.name)),
      };
      const response = await this.client.createMessage(request);
      responses.push(response);
      this.sink({ type: "assistant", message: response, turn });
      messages.push({ role: "assistant", content: response.content });
      const calls = toolUses(response);
      if (calls.length === 0) return { text: textOf(response.content), turns: turn, responses };
      const results = [];
      for (const call of calls) {
        try {
          const content = await executeTool(call, {
            cwd: this.config.options.cwd,
            runTask: (input) => this.runTask(input, depth + 1),
          });
          results.push(createToolResult(call, content));
          this.sink({ type: "tool_result", tool_use_id: call.id, content });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push(createToolResult(call, message, true));
          this.sink({ type: "tool_result", tool_use_id: call.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error(`Agent exceeded max turns (${this.config.options.maxTurns})`);
  }

  private async runTask(input: Record<string, unknown>, depth: number): Promise<string> {
    const description = typeof input.description === "string" ? input.description : "subagent task";
    const prompt = typeof input.prompt === "string" ? input.prompt : description;
    const result = await this.scheduler.run(
      { description, prompt, subagent_type: typeof input.subagent_type === "string" ? input.subagent_type : undefined, model: typeof input.model === "string" ? input.model : undefined, run_in_background: input.run_in_background === true },
      async () => (await this.run(prompt, depth)).text,
    );
    if (result.state !== "completed") throw new Error(result.error ?? `Subagent ${result.state}`);
    return result.output ?? "";
  }
}

function defaultSystemPrompt(cwd: string): string {
  return `You are a coding agent working in ${cwd}. Use the available tools to inspect and modify files. Explain the result concisely and do not claim to have performed actions you did not perform.`;
}
