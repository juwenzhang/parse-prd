import OpenAI from 'openai';
import type {ZodType, z} from 'zod';

import {env} from '../env';
import {logger} from '../logger';

const client = new OpenAI({
  apiKey: env.LLM_API_KEY,
  baseURL: env.LLM_BASE_URL
});

const MAX_RETRIES = 3;
const MAX_PROMPT_CHARS = 24000;

const DRY_RUN = process.argv.includes('--dry-run');

export interface LlmStats {
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalMs: number;
}

const globalStats: LlmStats = {
  calls: 0,
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalMs: 0
};

export function getLlmStats(): LlmStats {
  return {...globalStats};
}

function recordUsage(
  usage: {total_tokens?: number; prompt_tokens?: number; completion_tokens?: number} | undefined,
  ms: number
): void {
  globalStats.calls++;
  globalStats.totalTokens += usage?.total_tokens ?? 0;
  globalStats.promptTokens += usage?.prompt_tokens ?? 0;
  globalStats.completionTokens += usage?.completion_tokens ?? 0;
  globalStats.totalMs += ms;
}

function isEmptyOutput(obj: Record<string, unknown>, schemaName: string): boolean {
  const keyCount = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null).length;
  if (keyCount <= 1) return true;

  if (schemaName === 'OpenSpecProposal') {
    const hasModules = Array.isArray(obj.modules) && obj.modules.length > 0;
    const hasEndpoints = Array.isArray(obj.apiEndpoints) && obj.apiEndpoints.length > 0;
    const hasModels = Array.isArray(obj.dataModels) && obj.dataModels.length > 0;
    return !hasModules && !hasEndpoints && !hasModels && keyCount <= 5;
  }
  return false;
}

function patchLlmOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const patched = {...raw};

  if (!patched.meta || typeof patched.meta !== 'object') {
    patched.meta = {
      title: patched.title || 'Untitled',
      version: '1.0',
      createdAt: new Date().toISOString()
    };
  }

  const meta = patched.meta as Record<string, unknown>;
  if (!meta.title) meta.title = typeof patched.title === 'string' ? patched.title : 'Untitled';
  if (!meta.version) meta.version = '1.0';
  if (!meta.createdAt) meta.createdAt = new Date().toISOString();

  const fixArr = (arr: unknown, fn: (item: Record<string, unknown>) => void): void => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) continue;
      fn(item as Record<string, unknown>);
    }
  };

  fixArr(patched.functionalRequirements, fr => {
    if (!Array.isArray(fr.dependencies)) fr.dependencies = [];
    if (!Array.isArray(fr.acceptanceCriteria)) fr.acceptanceCriteria = [];
    if (!fr.id) fr.id = `FR-${Math.random().toString(36).slice(2, 6)}`;
    if (!fr.title && fr.name) fr.title = String(fr.name);
    if (!fr.title && fr.description) fr.title = String(fr.description).slice(0, 30);
    if (!fr.title) fr.title = '未命名需求';
    if (!fr.description) fr.description = fr.title ?? '';
    const priorityMap: Record<string, string> = {
      high: 'P0',
      medium: 'P1',
      low: 'P2',
      critical: 'P0',
      major: 'P1',
      minor: 'P2'
    };
    if (typeof fr.priority === 'string')
      fr.priority = priorityMap[fr.priority] ?? fr.priority.toUpperCase();
    if (!fr.priority) fr.priority = 'P2';
  });
  fixArr(patched.nonFunctionalRequirements, nfr => {
    if (!nfr.category) nfr.category = 'performance';
    if (!nfr.metric) nfr.metric = '待定义';
  });
  // convert NFR strings to objects
  if (Array.isArray(patched.nonFunctionalRequirements)) {
    let id = 1;
    patched.nonFunctionalRequirements = (patched.nonFunctionalRequirements as Array<unknown>).map(
      item =>
        typeof item === 'string'
          ? {id: `NFR-${id++}`, category: 'performance', description: item, metric: '待定义'}
          : item
    );
  }
  fixArr(patched.userStories, us => {
    if (!us.id) us.id = `US-${Math.random().toString(36).slice(2, 6)}`;
    if (!us.role) us.role = '用户';
    if (!us.goal) us.goal = '完成操作';
    if (!us.reason) us.reason = '提高效率';
    if (!Array.isArray(us.acceptanceCriteria)) us.acceptanceCriteria = [];
  });
  fixArr(patched.domainEntities, e => {
    if (!Array.isArray(e.attributes)) e.attributes = [];
    else {
      e.attributes = (e.attributes as Array<unknown>).map(a =>
        typeof a === 'string' ? {name: a, type: 'string', description: ''} : a
      );
    }
    if (!Array.isArray(e.relationships)) e.relationships = [];
    else {
      e.relationships = (e.relationships as Array<unknown>).map(r =>
        typeof r === 'string' ? {target: r, type: '1:N', description: ''} : r
      );
    }
  });
  fixArr(patched.modules, mod => {
    if (!mod.description) mod.description = '';
    if (!Array.isArray(mod.responsibilities)) mod.responsibilities = [];
    if (!Array.isArray(mod.dependsOn)) mod.dependsOn = [];
  });
  fixArr(patched.dataModels, dm => {
    if (!dm.description) dm.description = '';
    if (!Array.isArray(dm.keyFields)) dm.keyFields = [];
  });
  fixArr(patched.apiEndpoints, ep => {
    if (!ep.method) ep.method = 'GET';
    if (!ep.path) ep.path = '/';
    if (!ep.summary) ep.summary = '';
  });

  for (const k of [
    'glossary',
    'constraints',
    'functionalRequirements',
    'nonFunctionalRequirements',
    'userStories',
    'domainEntities',
    'riskItems',
    'openQuestions'
  ]) {
    if (!Array.isArray(patched[k])) {
      Reflect.set(patched, k, []);
    }
  }

  // flatten riskItems / openQuestions to strings
  for (const k of ['riskItems', 'openQuestions'] as const) {
    const arr = patched[k];
    if (Array.isArray(arr)) {
      Reflect.set(
        patched,
        k,
        arr.map(item =>
          typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '')
        )
      );
    }
  }
  for (const [k, d] of [
    ['overview', ''],
    ['background', ''],
    ['summary', ''],
    ['estimatedEffort', 'M'],
    ['specId', 'SPEC-DRAFT'],
    ['title', 'Untitled Proposal'],
    ['status', 'draft']
  ] as const) {
    if (!patched[k]) Reflect.set(patched, k, d);
  }

  // auto-fill data model descriptions if empty
  fixArr(patched.dataModels, dm => {
    if (
      !dm.description ||
      !dm.keyFields ||
      (Array.isArray(dm.keyFields) && dm.keyFields.length === 0)
    ) {
      const name = String(dm.name ?? '');
      if (!dm.description) dm.description = `${name}实体`;
      if (!Array.isArray(dm.keyFields) || (dm.keyFields as Array<unknown>).length === 0) {
        dm.keyFields = ['id', 'createdAt', 'updatedAt'];
      }
    }
  });

  // auto-fill riskItems if empty
  if (
    Array.isArray(patched.riskItems) &&
    patched.riskItems.length === 0 &&
    Array.isArray(patched.modules) &&
    patched.modules.length > 0
  ) {
    patched.riskItems = [
      '需求理解偏差：PRD中部分功能细节不够明确，需与业务方进一步确认',
      '用户体验风险：大促高并发场景下的系统稳定性需提前压测验证'
    ];
  }

  if (!patched.scope || typeof patched.scope !== 'object') {
    patched.scope = {inScope: [], outOfScope: []};
  }

  return patched;
}

function extractJson(raw: string): string {
  // strip markdown code fences
  let result = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();

  // find first { and last }
  const start = result.indexOf('{');
  const end = result.lastIndexOf('}');
  if (start !== -1 && end > start) {
    result = result.slice(start, end + 1);
  }

  // state machine: only escape control chars inside JSON string values
  let out = '';
  let inString = false;
  let isEscaped = false;
  for (const ch of result) {
    if (isEscaped) {
      out += ch;
      isEscaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out += ch;
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === '\n') {
      out += '\\n';
      continue;
    }
    if (inString && ch === '\r') {
      out += '\\r';
      continue;
    }
    if (inString && ch === '\t') {
      out += '\\t';
      continue;
    }
    if (inString && ch < ' ') {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }

  return out;
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  return `${prompt.slice(0, Math.floor(MAX_PROMPT_CHARS * 0.6))}\n\n...\n\n${prompt.slice(-Math.floor(MAX_PROMPT_CHARS * 0.35))}`;
}

export async function llmStructuredOutput<S extends ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  schemaName: string;
}): Promise<z.output<S>> {
  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN: ${opts.schemaName} ===`);
    console.log(`SYS: ${opts.system.slice(0, 200)}`);
    console.log(`PROMPT(${opts.prompt.length}): ${opts.prompt.slice(0, 500)}`);
    return {} as never;
  }

  const safePrompt = truncatePrompt(opts.prompt);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({schema: opts.schemaName, attempt}, `llm calling`);

    const started = Date.now();
    let raw = '';
    try {
      const response = await client.chat.completions.create({
        model: env.LLM_MODEL,
        messages: [
          {role: 'system', content: opts.system},
          {role: 'user', content: safePrompt}
        ],
        response_format: {type: 'json_object'},
        temperature: 0.3,
        max_tokens: 8192
      });

      const elapsed = Date.now() - started;
      recordUsage(response.usage, elapsed);

      raw = response.choices[0]?.message?.content ?? '';
      if (!raw) {
        logger.warn({attempt}, 'empty response');
        continue;
      }

      const cleaned = extractJson(raw);
      const parsed = JSON.parse(cleaned) as unknown;

      const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
      >;

      if (isEmptyOutput(obj, opts.schemaName)) {
        logger.warn({attempt}, 'empty/placeholder output, retrying');
        continue;
      }

      const result = opts.schema.safeParse(patchLlmOutput(obj));
      if (result.success) return result.data as z.output<S>;

      logger.warn({attempt, errors: result.error.issues.slice(0, 5)}, 'schema validation failed');
    } catch (err) {
      logger.error({attempt, err, rawPreview: raw.slice(0, 200)}, 'llm call failed');
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw new Error(`LLM failed for ${opts.schemaName} after ${MAX_RETRIES} attempts`);
}

export async function llmMarkdown(opts: {
  system: string;
  prompt: string;
  label: string;
}): Promise<string> {
  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN: ${opts.label} ===`);
    console.log(`SYS: ${opts.system.slice(0, 200)}`);
    console.log(`PROMPT(${opts.prompt.length}): ${opts.prompt.slice(0, 500)}`);
    return '# DRY RUN OUTPUT';
  }

  const safePrompt = truncatePrompt(opts.prompt);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({label: opts.label, attempt}, `llm calling`);

    const started = Date.now();
    try {
      const response = await client.chat.completions.create({
        model: env.LLM_MODEL,
        messages: [
          {role: 'system', content: opts.system},
          {role: 'user', content: safePrompt}
        ],
        temperature: 0.3,
        max_tokens: 8192
      });

      const elapsed = Date.now() - started;
      recordUsage(response.usage, elapsed);

      const raw = response.choices[0]?.message?.content;
      if (raw) return raw;

      logger.warn({attempt}, 'empty markdown');
    } catch (err) {
      logger.error({attempt, err, label: opts.label}, 'llm markdown failed');
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw new Error(`LLM failed for ${opts.label} after ${MAX_RETRIES} attempts`);
}
