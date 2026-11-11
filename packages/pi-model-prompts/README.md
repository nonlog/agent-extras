# pi-model-prompts

Automatically add a local instruction section for an exact Pi `provider/model-id`. Requires Pi 1.5.2 or later. There are no bundled model prompts, credentials, network requests, or extra runtime dependencies.

Install the root agent-extras package as usual. It includes this extension. Without a configuration file, the extension does nothing.

## Private configuration

Create `~/.pi/agent/model-prompts.json`, or use that filename under `PI_CODING_AGENT_DIR` when set:

```json
{
  "my-provider/my-model": "model-prompts/my-model.md"
}
```

Place the prompt in `~/.pi/agent/model-prompts/my-model.md`. Files must be relative to and remain inside the agent directory, including symlink targets. The optional `{{model_name}}` token renders to the selected model's display name, with its ID as the fallback. Keep this configuration and its prompt files in a private repository if desired; they are not part of this package.

Run `/reload` once after installing the extension, or start a new Pi session. Continue selecting models with `/model`; the next run reads the current mapping and prompt file, including local edits. Unmapped models and a missing configuration file remove this extension's section and retain Pi's ordinary instructions. No family-name guessing or wildcard matching is performed.

## Prompt behavior

The `before_agent_start` handler normally sets `systemPromptOptions.sections.vendor_model`. Pi retains its built-in prompt, executable tools, tool guidance, project context, skills, and other extensions' sections. Pi handles section differences and provider replay when a model or file changes. Cached-prefix reuse depends on the provider's support for system-message updates; it is not guaranteed across model switches.

Some extensions, including Context Mode, return a complete `systemPrompt`, which Pi stores in `forceSystemPrompt`. In that mode this extension preserves the complete text and appends its rendered `<vendor_model>` block as well as setting the structured section. Before each run it removes only its reserved `<vendor_model>` block from a captured full prompt, preventing duplicate or stale model guidance on switches, unmapped models, and missing configuration. Reserve that tag for this extension. Full-prompt changes can invalidate the provider's prefix cache; this extension does not convert another extension back to structured mode.

Adapt instructions to Pi's actual tool names and behavior. Do not copy another client's full prompt with its private paths, tool schemas, approval mechanisms, or session state.

Invalid JSON, invalid mappings, missing or empty selected files, and paths outside the agent directory raise an extension error after clearing this extension's previous section. Pi reports handler errors and may continue the run with its other instructions; this extension is not a request-blocking mechanism. Later extensions that replace the entire prompt without preserving its content can still discard earlier guidance, so review those separately if this section disappears.

## Validation

```bash
node --test packages/pi-model-prompts/tests/*.test.js
```

Unit tests use temporary local files and a stub extension API. They cover exact selection, identity rendering, model switching, file refresh, unrelated section preservation, malformed configuration, absolute-path rejection, and forced-prompt composition. They make no model requests and remove their temporary fixtures.

The integration test loads the installed Pi 1.5.2 extension loader, runner, and prompt renderer, then chains earlier and later full-prompt extensions around this extension. It verifies the rendered model instructions, removal on switching, and preservation of Pi/project/other-extension guidance. Resolve Pi from the normal Node package path or specify its installed package directory:

```powershell
$env:PI_TEST_PACKAGE_DIR = '<installed-package-directory>/@earendil-works/pi-coding-agent'
node --test packages/pi-model-prompts/tests/pi-runner.integration.js
```
