/**
 * Spinner Verbs Extension
 *
 * Replaces boring spinner verbs with themed alternatives that have more personality.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const verbsDir = join(__dirname, '..', '..', 'spinner-verbs');

const VERB = Symbol.for('pi-spinner-verbs.verb');
const VERB_CONSUMER = Symbol.for('pi-spinner-verbs.verb.consumer');

export default function (pi: ExtensionAPI) {
  const available = readdirSync(verbsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'));

  const DEFAULT = '(default)';
  const RANDOM = 'random';
  const availableWithDefault = [...available, RANDOM, DEFAULT];
  const validChoices = new Set(availableWithDefault);

  function parseVerbsData(data: unknown): string[] | undefined {
    return Array.isArray(data) && data.length > 0 ? data : undefined;
  }

  // A missing or corrupt bundled verb file must not abort session_start: report it and let
  // callers fall back to the default spinner, as the spinnerVerbsFile branch already does.
  function loadVerbs(name: string): string[] | undefined {
    try {
      const verbs = parseVerbsData(JSON.parse(readFileSync(join(verbsDir, `${name}.json`), 'utf-8')));
      if (!verbs) console.error('Empty or invalid verbs file:', name);
      return verbs;
    } catch (error) {
      console.error('Failed to load spinner verbs:', name, error);
      return undefined;
    }
  }

  function randomVerbs(): { verbs: string[] | undefined; setName: string } {
    const availableVerbs = available as string[];
    const name = availableVerbs[Math.floor(Math.random() * availableVerbs.length)]!;
    return { verbs: loadVerbs(name), setName: name };
  }

  pi.registerFlag('verbs', {
    description: `Spinner verb list (${available.join(', ')})`,
    type: 'string' as const,
    default: undefined,
  } as const);

  let activeVerbs: string[] | undefined;
  let activeVerbSetName: string | undefined;

  // Claude Code draws one verb per model turn and holds it for the whole turn; nothing
  // rotates on a clock, so the word changes as fast as the work does and a long single
  // thought keeps the same word.
  function nextVerb(ctx: ExtensionContext) {
    if (!activeVerbs || activeVerbs.length === 0) return;
    const verb = activeVerbs[Math.floor(Math.random() * activeVerbs.length)];
    // pi-polish reads this and renders the verb inside its own status line
    // shortcut: the consumer flag is process-wide, so disabling pi-polish without restarting pi leaves verbs silent
    (globalThis as any)[VERB] = verb;
    if (!(globalThis as any)[VERB_CONSUMER]) ctx.ui.setWorkingMessage(`${verb}...`);
  }

  function activate(verbs: string[], verbSetName: string | undefined, ctx: ExtensionContext) {
    activeVerbs = verbs;
    activeVerbSetName = verbSetName;
    nextVerb(ctx);
  }

  function readSettings(settingsPath: string): Record<string, unknown> | undefined {
    if (!existsSync(settingsPath)) return undefined;
    try {
      return JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      return undefined;
    }
  }

  type LoadVerbsResult = {
    verbs: string[] | undefined;
    verbSetName: string | undefined;
  };

  const EMPTY_RESULT: LoadVerbsResult = {
    verbs: undefined,
    verbSetName: undefined,
  };

  type SpinnerConfig = {
    settingsPath?: string;
    hasSpinnerVerbs: boolean;
    hasSpinnerVerbsFile: boolean;
    spinnerVerbs?: string;
    spinnerVerbsFile?: string;
  };

  function readSpinnerConfig(settingsPath?: string): SpinnerConfig | undefined {
    if (!settingsPath) return undefined;
    const settings = readSettings(settingsPath);
    if (!settings) return undefined;

    const spinnerVerbsValue =
      typeof settings['spinnerVerbs'] === 'string' ? settings['spinnerVerbs'] : undefined;
    const spinnerVerbsFileValue =
      typeof settings['spinnerVerbsFile'] === 'string' ? settings['spinnerVerbsFile'] : undefined;

    return {
      settingsPath: settingsPath,
      hasSpinnerVerbs: Object.prototype.hasOwnProperty.call(settings, 'spinnerVerbs'),
      hasSpinnerVerbsFile: Object.prototype.hasOwnProperty.call(settings, 'spinnerVerbsFile'),
      spinnerVerbs: spinnerVerbsValue,
      spinnerVerbsFile: spinnerVerbsFileValue,
    };
  }

  function hasSpinnerConfig(config?: SpinnerConfig): config is SpinnerConfig {
    return !!config && (config.hasSpinnerVerbs || config.hasSpinnerVerbsFile);
  }

  function pickSpinnerConfig(
    source: string | undefined,
    projectSettings: string | undefined,
    globalSettings: string | undefined,
  ): SpinnerConfig | undefined {
    const sourceConfig =
      typeof source === 'string'
        ? {
            settingsPath: undefined,
            hasSpinnerVerbs: true,
            hasSpinnerVerbsFile: false,
            spinnerVerbs: source,
            spinnerVerbsFile: undefined,
          }
        : undefined;

    return [
      sourceConfig,
      readSpinnerConfig(projectSettings),
      readSpinnerConfig(globalSettings),
    ].find(hasSpinnerConfig);
  }

  function resolveFilePath(filePath: string, settingsPath: string): string {
    if (filePath.startsWith('~')) {
      return join(homedir(), filePath.slice(1));
    } else if (filePath.startsWith('/')) {
      return filePath;
    } else {
      return join(dirname(settingsPath), filePath);
    }
  }

  function loadVerbsFromConfig(config: SpinnerConfig | undefined): LoadVerbsResult {
    if (!config) {
      return EMPTY_RESULT;
    }

    if (config.spinnerVerbs === DEFAULT) {
      return EMPTY_RESULT;
    }

    if (config.spinnerVerbs === RANDOM) {
      const result = randomVerbs();
      return { verbs: result.verbs, verbSetName: result.verbs ? result.setName : undefined };
    }

    if (
      config.spinnerVerbs &&
      config.spinnerVerbs !== DEFAULT &&
      config.spinnerVerbs !== RANDOM &&
      available.includes(config.spinnerVerbs)
    ) {
      const verbs = loadVerbs(config.spinnerVerbs);
      return { verbs, verbSetName: verbs ? config.spinnerVerbs : undefined };
    }

    if (config.spinnerVerbsFile && config.settingsPath) {
      const resolved = resolveFilePath(config.spinnerVerbsFile, config.settingsPath);
      if (existsSync(resolved)) {
        try {
          const fileVerbs = parseVerbsData(JSON.parse(readFileSync(resolved, 'utf-8')));
          if (fileVerbs) {
            return { verbs: fileVerbs, verbSetName: undefined };
          }
        } catch (error) {
          console.error(`Failed to parse verbs from file ${resolved}:`, error);
          return EMPTY_RESULT;
        }
      }
    }

    return EMPTY_RESULT;
  }

  function loadVerbsFromSource(
    source: string | undefined,
    projectSettings: string | undefined,
    globalSettings: string | undefined,
  ): LoadVerbsResult {
    return loadVerbsFromConfig(pickSpinnerConfig(source, projectSettings, globalSettings));
  }

  pi.on('session_start', async (_event, ctx) => {
    const flag = pi.getFlag('verbs') as string | undefined;
    const projectSettings = join(ctx.cwd, '.pi', 'settings.json');
    const globalSettings = join(homedir(), '.pi', 'agent', 'settings.json');

    // Normalize flag - if it's invalid, set it to undefined and notify user
    let normalizedFlag = flag;
    if (flag && !validChoices.has(flag as string)) {
      ctx.ui.notify(
        `Invalid verb set: ${flag}. Available: ${availableWithDefault.join(', ')}`,
        'error',
      );
      normalizedFlag = undefined;
    }

    // Load from normalized flag or settings using centralized function
    const { verbs, verbSetName } = loadVerbsFromSource(
      normalizedFlag,
      projectSettings,
      globalSettings,
    );

    if (verbs) activate(verbs, verbSetName, ctx);
  });

  pi.on('turn_start', async (_event, ctx) => nextVerb(ctx));

  pi.registerCommand('verbs', {
    description: 'Choose spinner verb list',
    getArgumentCompletions: (prefix: string) => {
      const matches = availableWithDefault
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const arg = args?.trim();
      if (arg && !validChoices.has(arg)) {
        ctx.ui.notify(
          `Unknown verb list: ${arg}. Available: ${availableWithDefault.join(', ')}`,
          'error',
        );
        return;
      }
      const choice = arg || (await ctx.ui.select('Spinner verbs:', availableWithDefault));
      if (!choice) return;
      if (choice === DEFAULT) {
        activeVerbs = undefined;
        activeVerbSetName = undefined;
        ctx.ui.setWorkingMessage();
        ctx.ui.notify('Restored default spinner', 'info');
      } else if (choice === RANDOM) {
        const result = loadVerbsFromSource(choice, undefined, undefined);
        if (!result.verbs) {
          ctx.ui.notify('Failed to load random spinner verbs', 'error');
          return;
        }
        activate(result.verbs, result.verbSetName, ctx);
        ctx.ui.notify('Spinner: random', 'info');
      } else {
        // For direct verb selection, we don't have settings context so we'll use undefined
        const result = loadVerbsFromSource(choice, undefined, undefined);
        if (!result.verbs) {
          ctx.ui.notify(`Failed to load spinner: ${choice}`, 'error');
          return;
        }
        activate(result.verbs, result.verbSetName, ctx);
        ctx.ui.notify(`Spinner: ${choice}`, 'info');
      }
    },
  });

  pi.registerCommand('verb-status', {
    description: 'Show current spinner verb status',
    handler: async (_args, ctx) => {
      if (!activeVerbs) {
        ctx.ui.notify('No spinner active. Use /verbs to set one.', 'info');
        return;
      }

      let currentVerbSet = 'Unknown';
      const flagVerbSet = pi.getFlag('verbs') as string | undefined;
      if (activeVerbSetName) {
        currentVerbSet = activeVerbSetName;
      } else if (flagVerbSet && flagVerbSet !== DEFAULT) {
        currentVerbSet = flagVerbSet;
      }

      const verbCount = activeVerbs?.length || 0;
      const message = `Spinner active with ${verbCount} verbs from "${currentVerbSet}" set\nAvailable verb sets: ${available.join(', ')}`;
      ctx.ui.notify(message, 'info');
    },
  });
}
