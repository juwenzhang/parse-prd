import {runAgent} from './agent';
import {logger} from './logger';
import {getSupportedSources} from './parsers/index';
import {runPipeline} from './pipeline/pipeline';
import {readLayerOutput, readState} from './pipeline/store';
import type {PipelineLayer} from './pipeline/types';

type DocSource = 'markdown' | 'pdf' | 'text' | 'xlsx';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function guardSource(v: string): DocSource {
  const valid = new Set(['markdown', 'pdf', 'text', 'xlsx']);
  if (valid.has(v)) return v as DocSource;
  throw new Error(`Unknown source: ${v}. Use: markdown | pdf | text | xlsx`);
}

async function readInput(args: string[]): Promise<{content?: string; filePath?: string}> {
  const filePath = flag(args, '--file');
  if (filePath) return {filePath, content: undefined};
  if (hasFlag(args, '--stdin')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {content: Buffer.concat(chunks).toString('utf-8'), filePath: undefined};
  }
  return {};
}

function inferSource(filePath: string): DocSource {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'pdf':
      return 'pdf';
    case 'xlsx':
    case 'xls':
      return 'xlsx';
    default:
      return 'text';
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const docId = args[1] ?? 'default';
  const input = await readInput(args);
  const sourceFlag = flag(args, '--source');
  const source = sourceFlag
    ? guardSource(sourceFlag)
    : input.filePath
      ? inferSource(input.filePath)
      : 'markdown';
  const cwd = flag(args, '--cwd') ?? '.';

  logger.info({sources: getSupportedSources(), cmd, docId, source, cwd}, 'starting');

  switch (cmd) {
    case 'parse': {
      const result = await runAgent({
        documentId: docId,
        source,
        content: input.content,
        filePath: input.filePath
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const st = await readState(docId);
      console.log(JSON.stringify(st ?? {message: 'no state'}, null, 2));
      break;
    }

    case 'run': {
      const fromLayer = Number(flag(args, '--from') ?? '1') as PipelineLayer;
      const parsed = await runAgent({
        documentId: docId,
        source,
        content: input.content,
        filePath: input.filePath
      });
      await runPipeline(docId, parsed, fromLayer, cwd);
      break;
    }

    case 'layer': {
      const layer = Number(args[2]) as PipelineLayer;
      const map: Record<PipelineLayer, string> = {1: 'standardize', 2: 'proposal', 3: 'openspec'};
      const out = await readLayerOutput(docId, layer);
      if (out) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        logger.info(`no ${map[layer]} for ${docId}`);
      }
      break;
    }

    default: {
      logger.info(
        'usage:\n' +
          '  parse <docId> --file ./prd.md [--source markdown]\n' +
          '  run <docId> --file ./prd.md [--from 1] [--cwd .] [--dry-run]\n' +
          '  layer <docId> <1|2|3>\n' +
          '  status <docId>\n' +
          '  cat prd.md | run <docId> --stdin'
      );
    }
  }

  logger.info('done');
}

const shutdown = (signal: string): void => {
  logger.info({signal}, 'shutting down');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(err => {
  logger.error({err}, 'fatal error');
  process.exit(1);
});
