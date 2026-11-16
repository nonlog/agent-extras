import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";

// Use Pi's installed SDK and loader, as extensions do; no separate test dependencies.
const require = createRequire(import.meta.url);
let entry;
try {
	entry = require.resolve("@earendil-works/pi-coding-agent");
} catch {
	entry = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js");
}
const hostRequire = createRequire(entry);
const { createJiti } = hostRequire("jiti");
const tuiEntry = hostRequire.resolve("@earendil-works/pi-tui");
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { "@earendil-works/pi-coding-agent": entry, "@earendil-works/pi-tui": tuiEntry },
});
const sdk = await import(pathToFileURL(entry).href);
sdk.initTheme("dark", false);
const { visibleWidth } = await import(pathToFileURL(tuiEntry).href);
const theme = { fg: (_token, text) => text, bold: (text) => text };
const plain = (lines) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const result = (text) => ({ content: [{ type: "text", text }] });
const context = (extra = {}) => ({ toolCallId: "call", invalidate() {}, expanded: false, args: {}, ...extra });

async function load(name) {
	const factory = await jiti.import(fileURLToPath(new URL(`../extensions/${name}.ts`, import.meta.url)), { default: true });
	const handlers = new Map();
	let resolver;
	const pi = {
		on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
		registerToolRenderer(fn) { resolver = fn; },
	};
	factory(pi);
	return {
		resolve: (name, base) => resolver(name, () => base),
		emit: async (name, event = {}, ctx = {}) => { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); },
	};
}

const tools = await load("tools");
await tools.emit("session_start", {}, { hasUI: false, sessionManager: { getBranch: () => [] } });

test("MCP and unknown tools get compact, background-free rendering", () => {
	for (const name of ["ctx_execute", "mcp__context_mode__ctx_execute", "hindsight_search_pages", "future_tool"]) {
		const renderer = tools.resolve(name);
		assert.equal(renderer?.renderShell, "self", name);
		const call = plain(renderer.renderCall({ command: "git status\nsecret second line" }, theme, context()).render(80));
		assert.match(call, /●/);
		assert.ok(!call.includes("secret second line"));
		const body = plain(renderer.renderResult(result("raw output\n".repeat(50)), { expanded: false }, theme, context()).render(80));
		assert.ok(body.split("\n").length <= 2);
		assert.ok(!body.includes("raw output"));
		const expanded = plain(renderer.renderResult(result("raw output"), { expanded: true }, theme, context()).render(80));
		assert.match(expanded, /raw output/);
	}
});

test("specialized interactive renderers remain authoritative", () => {
	const base = { renderCall: () => ({ render: () => ["questionnaire"], invalidate() {} }) };
	assert.equal(tools.resolve("questionnaire", base), base);
});

test("collapsed generic tools still show errors", () => {
	const renderer = tools.resolve("ctx_execute");
	const lines = renderer.renderResult(result("Permission denied\nadditional details"), { expanded: false }, theme, context({ isError: true })).render(80);
	assert.match(plain(lines), /Permission denied/);
});

test("grouped built-in tools retain errors and expandability", async () => {
	await tools.emit("agent_start");
	await tools.emit("tool_execution_start", { toolCallId: "bad", toolName: "bash", args: { command: "bad" } });
	await tools.emit("tool_execution_end", { toolCallId: "bad", isError: true });
	const renderer = tools.resolve("bash");
	const ctx = context({ toolCallId: "bad", isError: true });
	assert.match(plain(renderer.renderCall({ command: "bad" }, theme, ctx).render(80)), /failed/);
	assert.match(plain(renderer.renderResult(result("command not found"), { expanded: false }, theme, ctx).render(80)), /command not found/);
	await tools.emit("agent_end");
});

await load("chrome");
const message = {
	role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Visible reply" }],
	stopReason: "stop",
};

test("Pi's collapsed-thinking setting and manual reveal remain intact", () => {
	const component = new sdk.AssistantMessageComponent(message, true);
	assert.ok(!plain(component.render(80)).includes("private reasoning"));
	component.setHideThinkingBlock(false);
	assert.match(plain(component.render(80)), /private reasoning/);
	assert.equal(message.content[0].thinking, "private reasoning");
	assert.match(plain(new sdk.AssistantMessageComponent(message, false).render(80)), /private reasoning/);
});

test("assistant and user markers survive current Pi rendering", () => {
	assert.match(plain(new sdk.AssistantMessageComponent(message, true).render(80)), /● Visible reply/);
	assert.match(plain(new sdk.UserMessageComponent("User prompt").render(80)), /❯ User prompt/);
});

test("session startup collapses tools using the UI API", async () => {
	let expanded;
	await tools.emit("session_start", {}, {
		hasUI: true, sessionManager: { getBranch: () => [] },
		ui: { setToolsExpanded(value) { expanded = value; }, setWidget() {} },
	});
	assert.equal(expanded, false);
});

test("reload does not duplicate message markers", async () => {
	await load("chrome");
	const reply = plain(new sdk.AssistantMessageComponent(message, true).render(80));
	assert.equal(reply.match(/●/g)?.length, 1);
	const prompt = plain(new sdk.UserMessageComponent("User prompt").render(80));
	assert.equal(prompt.match(/❯/g)?.length, 1);
});

test("crab header handles narrow terminals and is in both package entrypoints", async () => {
	const { readFileSync } = await import("node:fs");
	for (const relative of ["../package.json", "../../../package.json"]) {
		const manifest = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
		assert.ok(manifest.pi.extensions.some((name) => name.endsWith("/header.ts")), relative);
	}
	const header = await load("header");
	let factory;
	await header.emit("session_start", {}, { mode: "tui", ui: { setHeader(value) { factory = value; } } });
	const component = factory({}, { ...theme, getColorMode: () => "truecolor" });
	for (const width of [1, 8, 20, 80]) {
		assert.ok(component.render(width).every((line) => visibleWidth(line) <= width), `width ${width}`);
	}
});

await tools.emit("session_shutdown");
