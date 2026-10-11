import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  maxConcurrentSubagents,
  type SubagentRequest,
} from "./types.js";

export type AgentRunState = "queued" | "running" | "completed" | "failed" | "stopped";

export interface AgentRun {
  readonly id: string;
  readonly request: SubagentRequest;
  state: AgentRunState;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  error?: string;
}

export type AgentExecutor = (request: SubagentRequest, signal: AbortSignal) => Promise<string>;

/**
 * Small, explicit scheduler for foreground and background Task agents.
 * Concurrency and lifecycle transitions mirror the observable agent surface;
 * model transport remains owned by the exact runtime in the release artifact.
 */
export class AgentScheduler {
  private readonly runs = new Map<string, AgentRun>();
  private readonly queue: Array<{
    run: AgentRun;
    executor: AgentExecutor;
    resolve: (value: AgentRun) => void;
  }> = [];
  private active = 0;
  private readonly limit: number;

  constructor(limit = DEFAULT_MAX_CONCURRENT_SUBAGENTS) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  static fromEnvironment(): AgentScheduler {
    return new AgentScheduler(maxConcurrentSubagents());
  }

  list(): readonly AgentRun[] {
    return [...this.runs.values()].map((run) => ({ ...run, request: { ...run.request } }));
  }

  get(id: string): AgentRun | undefined {
    const run = this.runs.get(id);
    return run ? { ...run, request: { ...run.request } } : undefined;
  }

  stop(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || (run.state !== "queued" && run.state !== "running")) return false;
    run.state = "stopped";
    run.finishedAt = Date.now();
    return true;
  }

  run(request: SubagentRequest, executor: AgentExecutor): Promise<AgentRun> {
    const run: AgentRun = { id: randomUUID(), request: { ...request }, state: "queued" };
    this.runs.set(run.id, run);
    return new Promise((resolve) => {
      this.queue.push({ run, executor, resolve });
      this.pump();
    });
  }

  async runInBackground(
    request: SubagentRequest,
    executor: AgentExecutor,
    outputFile = resolve(process.cwd(), ".claude-reconstructed", `${randomUUID()}.out`),
  ): Promise<AgentRun> {
    const run = await this.run(request, executor);
    if (run.output !== undefined) {
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(outputFile, run.output, "utf8");
    }
    return run;
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      if (next.run.state === "stopped") {
        next.resolve(next.run);
        continue;
      }
      this.active++;
      void this.execute(next).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async execute(item: {
    run: AgentRun;
    executor: AgentExecutor;
    resolve: (value: AgentRun) => void;
  }): Promise<void> {
    const { run, executor, resolve: complete } = item;
    run.state = "running";
    run.startedAt = Date.now();
    const controller = new AbortController();
    try {
      run.output = await executor(run.request, controller.signal);
      run.state = "completed";
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      run.state = "failed";
    } finally {
      run.finishedAt = Date.now();
      complete(run);
    }
  }
}
