import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import modelPrompts from "../extensions/model-prompts.js";

const require = createRequire(import.meta.url);
const packageDir = process.env.PI_TEST_PACKAGE_DIR || dirname(dirname(require.resolve("@earendil-works/pi-coding-agent")));
const sdk = (file) => import(pathToFileURL(join(packageDir, "dist/core", file)).href);
const { ExtensionRunner } = await sdk("extensions/runner.js");
const { loadExtensionFromFactory, createExtensionRuntime } = await sdk("extensions/loader.js");
const { createEventBus } = await sdk("event-bus.js");
const { buildSystemPrompt } = await sdk("system-prompt.js");

const root = await mkdtemp(join(tmpdir(), "pi-model-prompts-runner-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = root;
after(async () => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  await rm(root, { recursive: true, force: true });
});
await mkdir(join(root, "model-prompts"));
await writeFile(join(root, "model-prompts.json"), JSON.stringify({
  "test/claude": "model-prompts/claude.md",
  "test/gemini": "model-prompts/gemini.md",
}));
await writeFile(join(root, "model-prompts/claude.md"), "CLAUDE {{model_name}}");
await writeFile(join(root, "model-prompts/gemini.md"), "GEMINI {{model_name}}");

test("Pi runner preserves legacy full-prompt extensions and routes one current vendor section", async () => {
  const runtime = createExtensionRuntime();
  const eventBus = createEventBus();
  const factories = [
    (pi) => pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\n\nCONTEXT-MODE GUIDANCE" })),
    modelPrompts,
    (pi) => pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\n\nLATER GUIDANCE" })),
  ];
  const extensions = [];
  for (const [index, factory] of factories.entries()) {
    extensions.push(await loadExtensionFromFactory(factory, root, eventBus, runtime, `fixture-${index}`));
  }
  const runner = new ExtensionRunner(extensions, runtime, root, {}, {});
  let model = { provider: "test", id: "claude", name: "Claude Fixture" };
  runner.createContext = () => ({ model });
  const errors = [];
  runner.onError((error) => errors.push(error.error));
  const input = { cwd: root, sections: { ponytail: "PONYTAIL GUIDANCE" }, contextFiles: [{ path: "AGENTS.md", content: "PROJECT GUIDANCE" }] };
  let options = input;
  for (const id of ["claude", "gemini", "gemini", "unmapped"]) {
    model = { provider: "test", id, name: `${id} Fixture` };
    const result = await runner.emitBeforeAgentStart({ messageType: "user", prompt: "synthetic probe" }, options);
    assert.deepEqual(errors, []);
    const rendered = buildSystemPrompt(result.systemPromptOptions);
    for (const text of ["coding assistant running inside pi", "PROJECT GUIDANCE", "PONYTAIL GUIDANCE", "CONTEXT-MODE GUIDANCE", "LATER GUIDANCE"]) {
      assert.ok(rendered.includes(text), text);
    }
    assert.equal((rendered.match(/<vendor_model>/g) || []).length, id === "unmapped" ? 0 : 1);
    assert.equal(rendered.includes("CLAUDE"), id === "claude");
    assert.equal(rendered.includes("GEMINI"), id === "gemini");
    // Replay a forced snapshot as well as Pi's ordinary fresh per-run inputs.
    options = result.systemPromptOptions;
  }
});
