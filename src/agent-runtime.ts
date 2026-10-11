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
        // Claude Code streams the Messages API for every output mode; the CLI
        // decides how much of that stream to expose after decoding it.
        stream: true,
        max_tokens: this.config.options.maxTokens,
        system: this.config.options.systemPrompt ? this.config.options.systemPrompt : defaultSystemPrompt(this.config.options.cwd),
        messages,
        tools: this.availableTools(),
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
            environment: this.config.environment,
            permissionMode: this.config.options.permissionMode,
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

  private availableTools() {
    let tools = [...toolDefinitions()];
    if (this.config.options.bare) tools = tools.filter((tool) => ["Bash", "Edit", "Read"].includes(tool.name));
    if (this.config.options.tools.length > 0) tools = tools.filter((tool) => this.config.options.tools.includes(tool.name));
    return tools;
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

function defaultSystemPrompt(cwd: string) {
  const date = new Date().toISOString().slice(0, 10);
  return [
    { type: "text" as const, text: "x-anthropic-billing-header: cc_version=2.1.285.fe9; cc_entrypoint=sdk-cli;" },
    { type: "text" as const, text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.", cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `CWD: ${cwd}\nDate: ${date}`, cache_control: { type: "ephemeral" as const } },
  ];
}
