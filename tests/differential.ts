/** Run identical scripted model/tool tasks against two independent processes. */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { observeScenario, reportDirectory } from "./harness.ts";
import { scenarios } from "./scenarios.ts";

const reference = process.env.CLAUDE_REFERENCE_BINARY;
if (!reference) throw new Error("Set CLAUDE_REFERENCE_BINARY to an installed Claude CLI. It is used only by tests.");
const { stdout: version } = await promisify(execFile)(reference, ["--version"]);
const rows = [];
for (const scenario of scenarios) {
  const original = await observeScenario(scenario, reference);
  const candidate = await observeScenario(scenario);
  const comparable = original.violations.length === 0;
  const matches = comparable && candidate.violations.length === 0 &&
    JSON.stringify(original.files) === JSON.stringify(candidate.files) &&
    JSON.stringify(original.toolResults) === JSON.stringify(candidate.toolResults) &&
    JSON.stringify(original.advertisedTools) === JSON.stringify(candidate.advertisedTools) &&
    JSON.stringify(original.streamModes) === JSON.stringify(candidate.streamModes) &&
    original.systemIsStructured === candidate.systemIsStructured &&
    original.finalText === candidate.finalText && original.exitCode === candidate.exitCode;
  rows.push({ scenario: scenario.name, comparable, matches, original, candidate });
  console.log(`${matches ? "MATCH" : comparable ? "DIFF" : "INVALID_REFERENCE"} ${scenario.name}${candidate.violations.length ? `: ${candidate.violations.join("; ")}` : ""}`);
}
const report = {
  referenceVersion: version.trim(), testedAt: new Date().toISOString(),
  comparisonScope: "Scripted model decisions; tool status, filesystem effects, selected tool output, final CLI result. Not full behavioral equivalence.",
  passed: rows.filter(row => row.matches).length, total: rows.length,
  invalidReference: rows.filter(row => !row.comparable).length, rows,
};
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, "differential.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`${report.passed}/${report.total} matches; ${report.invalidReference} invalid reference cases. Report: ${reportPath}`);
if (report.passed !== report.total) process.exitCode = 1;
