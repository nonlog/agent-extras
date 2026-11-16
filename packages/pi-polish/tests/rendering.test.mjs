import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const { Editor, MouseRegion, visibleWidth } = await import(pathToFileURL(tuiEntry).href);
const theme = { fg: (_token, text) => text, bold: (text) => text };
const plain = (lines) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const result = (text) => ({ content: [{ type: "text", text }] });
const context = (extra = {}) => ({ toolCallId: "call", invalidate() {}, expanded: false, args: {}, ...extra });

async function load(name) {
	const factory = await jiti.import(fileURLToPath(new URL(`../extensions/${name}.ts`, import.meta.url)), { default: true });
	const handlers = new Map();
	let resolver;
	let markdownTransformer;
	const pi = {
		on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
		registerToolRenderer(fn) { resolver = fn; },
		registerCommand() {},
		registerMarkdownTransformer(transform, options) { markdownTransformer = { transform, options }; },
	};
	factory(pi);
	return {
		resolve: (name, base) => resolver(name, () => base),
		markdownTransformer,
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

test("codemode stays compact despite its custom renderer and preserves expanded details", () => {
	const { Text } = hostRequire("@earendil-works/pi-tui");
	const base = { renderCall: () => new Text("expanded code", 0, 0), renderResult: () => new Text("expanded inner tools", 0, 0) };
	const renderer = tools.resolve("codemode", base);
	assert.equal(renderer.renderShell, "self");
	assert.ok(!plain(renderer.renderCall({ code: "const result = await tools.read({});" }, theme, context()).render(80)).includes("expanded code"));
	assert.ok(!plain(renderer.renderResult(result("raw result"), { expanded: false }, theme, context()).render(80)).includes("expanded inner tools"));
	assert.match(plain(renderer.renderCall({}, theme, context({ expanded: true })).render(80)), /expanded code/);
	assert.match(plain(renderer.renderResult(result("raw result"), { expanded: true }, theme, context({ expanded: true })).render(80)), /expanded inner tools/);
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

const chrome = await load("chrome");
const message = {
	role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Visible reply" }],
	stopReason: "stop",
};

test("Pi's collapsed-thinking setting and manual reveal remain intact", () => {
	const component = new sdk.AssistantMessageComponent(message, true);
	assert.match(plain(component.render(80)), /private reasoning/);
	assert.ok(!plain(component.render(80)).includes("Thinking"));
	component.setHideThinkingBlock(false);
	assert.match(plain(component.render(80)), /private reasoning/);
	assert.equal(message.content[0].thinking, "private reasoning");
	assert.match(plain(new sdk.AssistantMessageComponent(message, false).render(80)), /private reasoning/);
});

test("assistant and user markers survive current Pi rendering", () => {
	assert.match(plain(new sdk.AssistantMessageComponent(message, true).render(80)), /● Visible reply/);
	assert.match(plain(new sdk.UserMessageComponent("User prompt").render(80)), /❯ User prompt/);
});

test("the chat prompt marker is present before session_start installs the editor factory", () => {
	const editor = new sdk.CustomEditor({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, { borderColor: (text) => text, selectList: {} }, {});
	editor.setText("Draft input");
	assert.match(plain(editor.render(80)), /❯ Draft input/);
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

async function thinkingFixture(mode = "single") {
	const register = await jiti.import(fileURLToPath(new URL("../extensions/thinking.ts", import.meta.url)), { default: true });
	const dir = mkdtempSync(join(tmpdir(), "pi-polish-thinking-test-"));
	const configPath = join(dir, "pi-polish.json");
	writeFileSync(configPath, JSON.stringify({ thinking: mode, preserved: true }));
	const handlers = new Map();
	const commands = new Map();
	const notices = [];
	const views = [];
	let label = "Thinking…";
	const pi = { on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command) };
	register(pi, configPath);
	const ctx = {
		mode: "tui", hasUI: true,
		ui: {
			theme,
			setHiddenThinkingLabel(value) { label = value; for (const view of views) view.setHiddenThinkingLabel(value); },
			notify: (text, type) => notices.push({ text, type }),
			select: async () => "multi",
		},
	};
	await handlers.get("session_start")({}, ctx);
	return {
		dir, configPath, notices, ctx,
		get command() { return commands.get("polish-thinking"); },
		reload: async () => { register(pi, configPath); await handlers.get("session_start")({}, ctx); },
		create(content, markdownTheme) {
			const view = new sdk.AssistantMessageComponent({ ...message, content }, true, markdownTheme, label);
			views.push(view);
			return view;
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

const thinkingContent = [
	{ type: "thinking", thinking: "First line\nSecond line\nThird line\nLatest line" },
	{ type: "text", text: "Visible reply" },
];

test("single thinking preview shows only the latest line and updates while streaming", async () => {
	const f = await thinkingFixture();
	try {
		const view = f.create(thinkingContent);
		const output = plain(view.render(80));
		assert.match(output, /Latest line/);
		assert.ok(!output.includes("Thinking"));
		assert.ok(!output.includes("First line") && !output.includes("Third line"));
		view.updateContent({ ...message, content: [{ type: "thinking", thinking: "Old line\nNewest line" }] }, true);
		assert.match(plain(view.render(80)), /Newest line/);
		assert.ok(view.render(12).every((line) => visibleWidth(line) <= 12));
		view.setHideThinkingBlock(false);
		assert.match(plain(view.render(80)), /Old line/);
	} finally { f.cleanup(); }
});

test("thinking previews render Markdown emphasis instead of exposing source delimiters", async () => {
	for (const mode of ["single", "multi"]) {
		const f = await thinkingFixture(mode);
		try {
			const source = "**Reading smaller sections**";
			const content = [{ type: "thinking", thinking: source }];
			const view = f.create(content, { ...sdk.getMarkdownTheme(), bold: (text) => `\x1b[1m${text}\x1b[22m` });
			const lines = view.render(80);
			assert.match(plain(lines), /Reading smaller sections/);
			assert.ok(!plain(lines).includes("**"));
			assert.match(lines.join("\n"), /\x1b\[(?:1|22;1)m/, "Markdown bold styling survives");
			assert.equal(content[0].thinking, source);
			view.updateContent({ ...message, content: [{ type: "thinking", thinking: "Check `renderer` and *formatting*" }] }, true);
			assert.match(plain(view.render(80)), /Check renderer and formatting/);
			assert.ok(view.render(12).every((line) => visibleWidth(line) <= 12));
		} finally { f.cleanup(); }
	}
});

test("thinking preview Markdown follows theme color changes after invalidation", async () => {
	const f = await thinkingFixture();
	try {
		f.ctx.ui.theme = { ...theme, fg: (_token, text) => `\x1b[31m${text}\x1b[39m` };
		const view = f.create([{ type: "thinking", thinking: "Theme-sensitive preview" }]);
		assert.ok(view.render(80).join("\n").includes("\x1b[31m"));
		f.ctx.ui.theme = { ...theme, fg: (_token, text) => `\x1b[34m${text}\x1b[39m` };
		view.invalidate();
		assert.ok(view.render(80).join("\n").includes("\x1b[34m"));
	} finally { f.cleanup(); }
});

test("multi-line thinking preview retains the line budget after Markdown rendering", async () => {
	const f = await thinkingFixture("multi");
	try {
		const view = f.create([{ type: "thinking", thinking: "Discard this\n**First**\n`Second`\n*Third*" }]);
		const lines = view.render(30).filter((line) => plain([line]).trim());
		assert.equal(lines.length, 3);
		assert.deepEqual(lines.map((line) => plain([line]).trim()), ["First", "Second", "Third"]);
	} finally { f.cleanup(); }
});

test("thinking preview preserves intentionally escaped Markdown punctuation", async () => {
	const f = await thinkingFixture();
	try {
		const view = f.create([{ type: "thinking", thinking: String.raw`Literal \*\*stars\*\*` }]);
		assert.match(plain(view.render(80)), /Literal \*\*stars\*\*/);
	} finally { f.cleanup(); }
});

test("multi thinking preview shows the latest three lines without changing stored reasoning", async () => {
	const f = await thinkingFixture("multi");
	try {
		const output = plain(f.create(thinkingContent).render(80));
		assert.ok(!output.includes("First line"));
		for (const line of ["Second line", "Third line", "Latest line"]) assert.ok(output.includes(line));
		assert.equal(thinkingContent[0].thinking, "First line\nSecond line\nThird line\nLatest line");
	} finally { f.cleanup(); }
});

test("off hides the whole thinking area even when native thinking is expanded", async () => {
	const f = await thinkingFixture("off");
	try {
		const view = f.create(thinkingContent);
		assert.equal(plain(view.render(80)).trim(), "● Visible reply");
		view.setHideThinkingBlock(false);
		assert.equal(plain(view.render(80)).trim(), "● Visible reply");
	} finally { f.cleanup(); }
});

test("thinking picker persists the mode and redraws existing messages", async () => {
	const f = await thinkingFixture();
	try {
		const view = f.create(thinkingContent);
		await f.command.handler("", f.ctx);
		assert.match(plain(view.render(80)), /Second line/);
		assert.deepEqual(JSON.parse(readFileSync(f.configPath, "utf8")), { thinking: "multi", preserved: true });
		await f.reload();
		assert.match(plain(view.render(80)), /Second line/);
		await f.command.handler("off", f.ctx);
		assert.equal(plain(view.render(80)).trim(), "● Visible reply");
		await f.command.handler("single", f.ctx);
		assert.match(plain(view.render(80)), /Latest line/);
		assert.deepEqual(readdirSync(f.dir), ["pi-polish.json"]);
	} finally { f.cleanup(); }
});

test("invalid commands and malformed config cannot overwrite settings", async () => {
	const f = await thinkingFixture();
	try {
		const before = readFileSync(f.configPath, "utf8");
		await f.command.handler("invalid", f.ctx);
		assert.equal(readFileSync(f.configPath, "utf8"), before);
		writeFileSync(f.configPath, "{broken");
		await f.command.handler("multi", f.ctx);
		assert.equal(readFileSync(f.configPath, "utf8"), "{broken");
		assert.equal(f.notices.at(-1).type, "error");
		assert.deepEqual(readdirSync(f.dir), ["pi-polish.json"]);
	} finally { f.cleanup(); }
});

test("separate thinking runs retain their own native click-to-expand state", async () => {
	const f = await thinkingFixture();
	try {
		const view = f.create([
			{ type: "thinking", thinking: "Old first run\nLatest first run" },
			{ type: "text", text: "Between runs" },
			{ type: "thinking", thinking: "Old second run\nLatest second run" },
		]);
		assert.ok(!plain(view.render(80)).includes("Old first run"));
		const first = view.contentContainer.children.find((child) => child instanceof MouseRegion);
		first.onMouse({ type: "click", button: "left" });
		const output = plain(view.render(80));
		assert.match(output, /Old first run/);
		assert.match(output, /Latest second run/);
		assert.ok(!output.includes("Old second run"));
	} finally { f.cleanup(); }
});

test("thinking preview strips terminal escape sequences", async () => {
	const f = await thinkingFixture();
	try {
		const view = f.create([{ type: "thinking", thinking: "\x1b]0;malicious title\x07Safe preview\x1b[31m" }]);
		const output = view.render(80).join("\n");
		assert.match(output, /Safe preview/);
		assert.ok(!output.includes("malicious title"));
	} finally { f.cleanup(); }
});

async function imageFixture() {
	const { decorateImagePastes } = await jiti.import(fileURLToPath(new URL("../extensions/images.ts", import.meta.url)));
	const dir = mkdtempSync(join(tmpdir(), "pi-polish-images-test-"));
	const first = join(dir, "first.png");
	const second = join(dir, "second image.png");
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBO8AAAAASUVORK5CYII=", "base64");
	writeFileSync(first, png); writeFileSync(second, png);
	const editor = new Editor({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, { borderColor: (text) => text, selectList: {} });
	decorateImagePastes(editor);
	return { editor, first, second, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("image paste markers stay compact while submission and expanded text retain original paths", async () => {
	const f = await imageFixture();
	try {
		f.editor.insertTextAtCursor(f.first);
		f.editor.insertTextAtCursor(" ");
		f.editor.insertTextAtCursor(f.second);
		assert.equal(f.editor.getText(), "[image1] [image2]");
		assert.equal(f.editor.getExpandedText(), `${f.first} ${f.second}`);
		assert.ok(!f.editor.render(40).join("\n").includes(f.first));
		let submitted;
		f.editor.onSubmit = (text) => { submitted = text; };
		f.editor.handleInput("\r");
		assert.equal(submitted, `${f.first} ${f.second}`);
		assert.equal(f.editor.getExpandedText(), "");
	} finally { f.cleanup(); }
});

test("image deletion is atomic and undo restores the original attachment", async () => {
	const f = await imageFixture();
	try {
		f.editor.insertTextAtCursor(f.first);
		f.editor.handleInput("\x7f");
		assert.equal(f.editor.getText(), "");
		assert.equal(f.editor.getExpandedText(), "");
		f.editor.undo();
		assert.equal(f.editor.getText(), "[image1]");
		assert.equal(f.editor.getExpandedText(), f.first);
		f.editor.setText(`${f.first} compare with "${f.second}"`);
		assert.equal(f.editor.getText(), "[image1] compare with [image2]");
		assert.equal(f.editor.getExpandedText(), `${f.first} compare with "${f.second}"`);
	} finally { f.cleanup(); }
});

test("bracketed image pastes and normal large text pastes keep separate registries", async () => {
	const f = await imageFixture();
	try {
		f.editor.handleInput(`\x1b[200~${f.first}\x1b[201~`);
		assert.equal(f.editor.getText(), "[image1]");
		const text = `${"normal text ".repeat(110)}literal [image1]`;
		f.editor.handleInput(`\x1b[200~${text}\x1b[201~`);
		assert.ok(f.editor.getText().includes("[paste #1"));
		assert.equal(f.editor.getExpandedText(), f.first + text);
	} finally { f.cleanup(); }
});

test("image markers survive history browsing and leave missing files as ordinary text", async () => {
	const f = await imageFixture();
	try {
		f.editor.addToHistory(f.first);
		f.editor.insertTextAtCursor(f.second);
		f.editor.render(80);
		f.editor.handleInput("\x1b[A");
		f.editor.handleInput("\x1b[A"); // Native Up first moves to column zero, then browses history.
		assert.equal(f.editor.getExpandedText(), f.first);
		assert.match(f.editor.getText(), /^\[image\d+\]$/);
		f.editor.handleInput("\x1b[B");
		assert.equal(f.editor.getExpandedText(), f.second);
		f.editor.setText(`${f.first}.missing.png`);
		assert.equal(f.editor.getText(), `${f.first}.missing.png`);
	} finally { f.cleanup(); }
});

test("user transcript image markers are display-only and do not change URLs or assistant text", () => {
	const input = 'C:\\Temp\\first.png compare with "C:\\Temp\\second image.png"';
	assert.deepEqual(chrome.markdownTransformer.options.messageTypes, ["user"]);
	assert.equal(chrome.markdownTransformer.transform(input), "[image1] compare with [image2]");
	assert.equal(chrome.markdownTransformer.transform("https://example.com/photo.png"), "https://example.com/photo.png");
	assert.equal(input, 'C:\\Temp\\first.png compare with "C:\\Temp\\second image.png"');
});

test("pi-polish and pi-bar-cursor cooperate on the real editor's first startup frame", async () => {
	const bar = await jiti.import(fileURLToPath(new URL("../../pi-bar-cursor/extensions/bar-cursor.ts", import.meta.url)), { default: true });
	const handlers = new Map();
	let visible = false;
	const output = [];
	const write = process.stdout.write;
	const tui = { terminal: { rows: 24, columns: 80, write() {} }, requestRender() {}, getShowHardwareCursor: () => visible, setShowHardwareCursor(value) { visible = value; } };
	try {
		process.stdout.write = (data) => { output.push(String(data)); return true; };
		bar({ on: (name, handler) => handlers.set(name, handler) });
		const editor = new sdk.CustomEditor(tui, { borderColor: (text) => text, selectList: {} }, {});
		editor.focused = true;
		editor.setText("Early input");
		const lines = editor.render(80);
		await new Promise((resolve) => queueMicrotask(resolve));
		assert.match(plain(lines), /❯ Early input/);
		assert.ok(!lines.join("").includes("\x1b[7m"));
		assert.ok(output.join("").includes("\x1b[5 q"));
		assert.equal(visible, true);
	} finally {
		handlers.get("session_shutdown")?.({ reason: "quit" });
		process.stdout.write = write;
	}
});
