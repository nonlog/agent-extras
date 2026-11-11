import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function modelPrompts(pi) {
  const configuredDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const agentDir = resolve(configuredDir.replace(/^~(?=$|[\\/])/, () => homedir()));
  const configPath = join(agentDir, "model-prompts.json");

  pi.on("before_agent_start", (event, ctx) => {
    const options = event.systemPromptOptions;
    if (!options?.sections) throw new Error("pi-model-prompts requires Pi 1.5.2 or later");
    delete options.sections.vendor_model;
    if (options.forceSystemPrompt !== undefined) {
      // Earlier extensions may have captured our owned section in a complete prompt.
      options.forceSystemPrompt = options.forceSystemPrompt.replace(/(?:\r?\n\r?\n|^)<vendor_model>\r?\n[\s\S]*?\r?\n<\/vendor_model>/g, "");
    }
    if (!ctx.model) return;

    let source;
    try {
      source = readFileSync(configPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const mappings = JSON.parse(source.replace(/^\uFEFF/, ""));
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      throw new Error("model-prompts.json must be an object mapping provider/model IDs to relative files");
    }
    for (const [key, file] of Object.entries(mappings)) {
      if (!/^[^\s/]+\/\S+$/.test(key) || typeof file !== "string" || !file.trim()) {
        throw new Error("model-prompts.json contains an invalid provider/model ID or file path");
      }
    }
    const key = `${ctx.model.provider}/${ctx.model.id}`;
    if (!Object.hasOwn(mappings, key)) return;
    const file = mappings[key];
    if (isAbsolute(file) || win32.isAbsolute(file)) {
      throw new Error("Model prompt files must be relative to the Pi agent directory");
    }
    const promptPath = realpathSync(resolve(agentDir, file));
    const insidePath = relative(realpathSync(agentDir), promptPath);
    if (insidePath === ".." || insidePath.startsWith(`..${sep}`) || isAbsolute(insidePath)) {
      throw new Error("Model prompt files must stay inside the Pi agent directory");
    }
    const prompt = readFileSync(promptPath, "utf8");
    if (!prompt.trim()) throw new Error("Selected model prompt file is empty");
    options.sections.vendor_model = prompt.replaceAll("{{model_name}}", () => ctx.model.name || ctx.model.id);
    if (options.forceSystemPrompt !== undefined) {
      const separator = options.forceSystemPrompt ? "\n\n" : "";
      options.forceSystemPrompt += `${separator}<vendor_model>\n${options.sections.vendor_model}\n</vendor_model>`;
    }
  });
}
