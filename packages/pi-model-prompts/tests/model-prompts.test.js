import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(join(tmpdir(), "pi-model-prompts-"));
await mkdir(join(root, "model-prompts"));
await writeFile(join(root, "model-prompts.json"), JSON.stringify({
  "www/claude-opus-5-5": "model-prompts/claude.md",
  "www/gemini-4-carbon": "model-prompts/gemini.md",
}));
await writeFile(join(root, "model-prompts/claude.md"), "Claude {{model_name}} instructions");
await writeFile(join(root, "model-prompts/gemini.md"), "Gemini {{model_name}} instructions");
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
after(async () => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(root, { recursive: true, force: true });
});
const { default: extension } = await import("../extensions/model-prompts.js");

function createHandler(model) {
  let handler;
  extension({
    on(event, callback) {
      assert.equal(event, "before_agent_start");
      handler = callback;
    },
  });
  const event = {
    systemPromptOptions: { sections: { pi_builtin: "keep me", vendor_model: "stale" } },
  };
  const ctx = { model };
  return { event, ctx, run: () => handler(event, ctx) };
}

test("selects exact model prompt and renders identity", async () => {
  const { event, run } = createHandler({ provider: "www", id: "claude-opus-5-5", name: "Claude Opus 5.5" });
  await run();
  assert.equal(event.systemPromptOptions.sections.vendor_model, "Claude Claude Opus 5.5 instructions");
  assert.equal(event.systemPromptOptions.sections.pi_builtin, "keep me");
});

test("switching model refreshes and unmapped models clear the section", async () => {
  const harness = createHandler({ provider: "www", id: "gemini-4-carbon", name: "Gemini 4 Carbon" });
  await harness.run();
  assert.equal(harness.event.systemPromptOptions.sections.vendor_model, "Gemini Gemini 4 Carbon instructions");
  harness.ctx.model = { provider: "www", id: "other-model", name: "Other" };
  await harness.run();
  assert.equal(harness.event.systemPromptOptions.sections.vendor_model, undefined);
  assert.equal(harness.event.systemPromptOptions.sections.pi_builtin, "keep me");
});

test("reloads changed local prompt text", async () => {
  const harness = createHandler({ provider: "www", id: "www/ignored", name: "Ignored" });
  harness.ctx.model = { provider: "www", id: "claude-opus-5-5", name: "Opus" };
  await writeFile(join(root, "model-prompts/claude.md"), "Updated {{model_name}}");
  await harness.run();
  assert.equal(harness.event.systemPromptOptions.sections.vendor_model, "Updated Opus");
});

test("rejects paths outside the agent directory and composes forced full prompts", async () => {
  const configPath = join(root, "model-prompts.json");
  await writeFile(configPath, JSON.stringify({ "www/claude-opus-5-5": "C:\\outside-prompt.md" }));
  const harness = createHandler({ provider: "www", id: "claude-opus-5-5", name: "Opus" });
  assert.throws(harness.run, /relative to the Pi agent directory/);
  await writeFile(configPath, JSON.stringify({ "www/claude-opus-5-5": "model-prompts/claude.md" }));
  harness.event.systemPromptOptions.forceSystemPrompt = "forced";
  harness.run();
  assert.equal(harness.event.systemPromptOptions.forceSystemPrompt, "forced\n\n<vendor_model>\nUpdated Opus\n</vendor_model>");
  harness.run();
  assert.equal((harness.event.systemPromptOptions.forceSystemPrompt.match(/<vendor_model>/g) || []).length, 1);
  harness.ctx.model = { provider: "other", id: "claude-opus-5-5" };
  harness.run();
  assert.equal(harness.event.systemPromptOptions.forceSystemPrompt, "forced");
  assert.equal(harness.event.systemPromptOptions.sections.vendor_model, undefined);
});

test("clears owned forced content for missing or invalid configuration, including empty bases", async () => {
  const configPath = join(root, "model-prompts.json");
  const harness = createHandler({ provider: "www", id: "claude-opus-5-5", name: "Opus" });
  harness.event.systemPromptOptions.forceSystemPrompt = "";
  harness.run();
  assert.ok(harness.event.systemPromptOptions.forceSystemPrompt.startsWith("<vendor_model>\n"));
  await rm(configPath);
  harness.run();
  assert.equal(harness.event.systemPromptOptions.forceSystemPrompt, "");
  await writeFile(configPath, '{"www/claude-opus-5-5":"model-prompts/claude.md"}');
  harness.run();
  await writeFile(configPath, '{bad json');
  assert.throws(harness.run, SyntaxError);
  assert.equal(harness.event.systemPromptOptions.forceSystemPrompt, "");
  assert.equal(harness.event.systemPromptOptions.sections.vendor_model, undefined);
});
