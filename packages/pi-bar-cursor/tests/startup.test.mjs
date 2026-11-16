import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

let entry;
try { entry = import.meta.resolve("@earendil-works/pi-coding-agent"); }
catch { entry = pathToFileURL(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist/index.js")).href; }
const hostRequire = createRequire(entry);
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": fileURLToPath(entry), "@earendil-works/pi-tui": hostRequire.resolve("@earendil-works/pi-tui") } });
const { CustomEditor } = await import(entry);
const proto = Object.getPrototypeOf(CustomEditor.prototype);
const nativeRender = proto.render;
proto.render = () => ["\x1b[7m \x1b[0m\x1b_pi:c\x07"];
const factory = await jiti.import(fileURLToPath(new URL("../extensions/bar-cursor.ts", import.meta.url)), { default: true });

test("the first focused TUI frame gets the bar cursor before session_start, never at module load", async () => {
	const handlers = new Map();
	const output = [];
	const originalWrite = process.stdout.write;
	let visible = false;
	const tui = { terminal: { write() {} }, getShowHardwareCursor: () => visible, setShowHardwareCursor(value) { visible = value; } };
	try {
		process.stdout.write = (data) => { output.push(String(data)); return true; };
		factory({ on: (name, handler) => handlers.set(name, handler) });
		assert.equal(output.length, 0, "loading in RPC/print mode must not write terminal escapes");
		const lines = proto.render.call({ tui, focused: true }, 80);
		await new Promise((resolve) => queueMicrotask(resolve));
		assert.ok(!lines.join("").includes("\x1b[7m"));
		assert.ok(output.join("").includes("\x1b[5 q"), "bar shape is applied before session_start");
		assert.equal(visible, true);
		handlers.get("session_start")({}, { mode: "tui", ui: { theme: { getFgAnsi: () => "\x1b[38;2;100;150;200m" } } });
		proto.render.call({ tui, focused: true }, 80);
		handlers.get("session_shutdown")({ reason: "quit" });
		const length = output.length;
		proto.render.call({ tui, focused: true }, 80);
		await new Promise((resolve) => queueMicrotask(resolve));
		assert.equal(visible, false, "teardown cannot reactivate the cursor");
		assert.equal(output.length, length);
	} finally {
		process.stdout.write = originalWrite;
		proto.render = nativeRender;
	}
});
