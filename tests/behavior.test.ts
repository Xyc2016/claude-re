import test from "node:test";
import assert from "node:assert/strict";
import { observeScenario } from "./harness.ts";
import { scenarios } from "./scenarios.ts";

for (const scenario of scenarios) {
  test(scenario.name, { timeout: 45_000 }, async () => {
    const observation = await observeScenario(scenario);
    assert.deepEqual(observation.violations, [], JSON.stringify(observation, null, 2));
  });
}
