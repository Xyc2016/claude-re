import {
  AGENT_FRONTMATTER_FIELDS,
  type AgentDefinition,
  type AgentFile,
  validateAgentFiles,
} from "./types.js";

export type AgentMap = ReadonlyMap<string, AgentDefinition>;

/** Load the object accepted by Claude's --agents option. */
export function loadAgentsObject(value: unknown): AgentMap {
  if (!isRecord(value)) throw new Error("agents must be a JSON object");
  const loaded = new Map<string, AgentDefinition>();
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) throw new Error(`Agent '${name}' must be an object`);
    loaded.set(name, normalizeAgent(name, raw));
  }
  return loaded;
}

/** Parse the JSON file form used by `--agents <file>`. */
export function loadAgentsJson(text: string): AgentMap {
  try {
    return loadAgentsObject(JSON.parse(text));
  } catch (error) {
    throw new Error(`Unable to parse agents JSON: ${(error as Error).message}`);
  }
}

/**
 * Parse markdown agent files. Claude's files use YAML-like frontmatter; this
 * intentionally accepts only the fields observed in the bundle so malformed
 * configuration is reported instead of silently changing the agent.
 */
export function loadAgentFiles(files: readonly AgentFile[]): AgentMap {
  validateAgentFiles(files);
  const loaded = new Map<string, AgentDefinition>();
  for (const file of files) {
    const parsed = parseFrontmatter(file.content);
    const name = typeof parsed.name === "string" ? parsed.name : file.name;
    const description = typeof parsed.description === "string"
      ? parsed.description
      : `Agent loaded from ${file.name}`;
    const prompt = parsed.prompt ?? parsed.body;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error(`Agent '${name}' has no prompt`);
    }
    loaded.set(name, normalizeAgent(name, { ...parsed, description, prompt }));
  }
  return loaded;
}

function normalizeAgent(name: string, value: Record<string, unknown>): AgentDefinition {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    throw new Error(`Invalid agent name: ${name}`);
  }
  const prompt = value.prompt ?? value.systemPrompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Agent '${name}' requires a prompt`);
  }
  const description = value.description;
  if (typeof description !== "string") {
    throw new Error(`Agent '${name}' requires a description`);
  }
  const result: AgentDefinition = { name, description, prompt };
  for (const field of AGENT_FRONTMATTER_FIELDS) {
    if (field in value && field !== "name" && field !== "description") {
      (result as unknown as Record<string, unknown>)[field] = value[field];
    }
  }
  return result;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return { body: normalized.trim() };
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) throw new Error("Agent frontmatter is not closed");
  const header = normalized.slice(3, end).replace(/^\r?\n/, "");
  const body = normalized.slice(end + 4).replace(/^\r?\n/, "").trim();
  const result: Record<string, unknown> = { body };
  for (const line of header.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    result[key] = parseScalar(raw);
  }
  return result;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try { return JSON.parse(value); } catch { /* keep the original scalar */ }
  }
  return value.replace(/^(['"])(.*)\1$/u, "$2");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
