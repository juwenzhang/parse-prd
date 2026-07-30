import fs from 'node:fs/promises';
import path from 'node:path';
import {logger} from '../logger';

export interface OpenSpecConfig {
  schema: string;
  context?: string;
  rules?: Record<string, string[]>;
  initialized: boolean;
}

export interface OpenSpecSpec {
  name: string;
  content: string;
}

export interface OpenSpecContext {
  config: OpenSpecConfig;
  specs: OpenSpecSpec[];
  codeBuddyReady: boolean;
}

export async function scanOpenSpec(root: string): Promise<OpenSpecContext> {
  const result: OpenSpecContext = {
    config: {schema: 'spec-driven', initialized: false},
    specs: [],
    codeBuddyReady: false
  };

  try {
    const configRaw = await fs.readFile(path.join(root, 'openspec', 'config.yaml'), 'utf-8');
    result.config = parseConfigYaml(configRaw);
    result.config.initialized = true;
  } catch {
    logger.info('openspec/config.yaml not found or not initialized');
  }

  try {
    await fs.access(path.join(root, '.codebuddy', 'commands', 'opsx'));
    result.codeBuddyReady = true;
  } catch {
    // codebuddy not initialized
  }

  const specsDir = path.join(root, 'openspec', 'specs');
  try {
    const entries = await fs.readdir(specsDir, {withFileTypes: true});
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const specFile = path.join(specsDir, entry.name, 'spec.md');
      try {
        const content = await fs.readFile(specFile, 'utf-8');
        if (content.trim()) {
          result.specs.push({name: entry.name, content});
        }
      } catch {
        // spec file doesn't exist or can't be read
      }
    }
  } catch {
    // specs dir doesn't exist
  }

  logger.info(
    {
      initialized: result.config.initialized,
      specs: result.specs.length,
      codeBuddy: result.codeBuddyReady
    },
    'openspec scan complete'
  );

  return result;
}

function parseConfigYaml(raw: string): OpenSpecConfig {
  const config: OpenSpecConfig = {schema: 'spec-driven', initialized: true};
  const lines = raw.split('\n');
  let currentSection = '';
  const rules: Record<string, string[]> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('schema:')) {
      config.schema = trimmed.replace('schema:', '').trim();
      continue;
    }

    if (trimmed === 'context: |') {
      currentSection = 'context';
      config.context = '';
      continue;
    }

    if (trimmed === 'rules:') {
      currentSection = 'rules-header';
      continue;
    }

    if (currentSection === 'context' && trimmed.startsWith('-')) {
      if (config.context) config.context += '\n';
      config.context += trimmed.replace(/^-\s*/, '');
      continue;
    }

    if (currentSection === 'context' && !trimmed.startsWith('-')) {
      if (config.context) config.context += '\n';
      config.context += trimmed;
      continue;
    }

    if (currentSection === 'rules-header' || currentSection.startsWith('rules-')) {
      const ruleMatch = trimmed.match(/^(\w+):$/);
      if (ruleMatch?.[1]) {
        currentSection = `rules-${ruleMatch[1]}`;
        rules[ruleMatch[1]] = [];
        continue;
      }
    }

    if (currentSection.startsWith('rules-') && trimmed.startsWith('-')) {
      const ruleKey = currentSection.replace('rules-', '');
      if (!rules[ruleKey]) rules[ruleKey] = [];
      rules[ruleKey].push(trimmed.replace(/^-\s*/, ''));
    }
  }

  if (Object.keys(rules).length > 0) config.rules = rules;
  return config;
}

export function buildOpenSpecSummary(ctx: OpenSpecContext): string {
  const lines: string[] = [];

  if (!ctx.config.initialized) return '';

  lines.push(`OpenSpec: ${ctx.config.schema} schema`);
  if (ctx.codeBuddyReady) lines.push('CodeBuddy 集成已就绪');

  if (ctx.config.context) {
    lines.push(`项目上下文:\n${ctx.config.context}`);
  }

  if (ctx.config.rules) {
    lines.push('规则约束:');
    for (const [key, rules] of Object.entries(ctx.config.rules)) {
      lines.push(`  ${key}:`);
      for (const rule of rules) lines.push(`    - ${rule}`);
    }
  }

  if (ctx.specs.length > 0) {
    lines.push(`\n已有规范模板 (${ctx.specs.length}):`);
    for (const spec of ctx.specs.slice(0, 3)) {
      lines.push(`\n### ${spec.name}\n${spec.content.slice(0, 500)}`);
    }
  }

  return lines.join('\n');
}
