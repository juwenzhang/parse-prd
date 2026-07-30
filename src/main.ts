import {logger} from './logger.js';
import {runAgent} from './agent.js';

async function main(): Promise<void> {
  logger.info('. starting');

  const result = await runAgent({
    documentId: 'demo',
    source: 'markdown',
    content: '# Demo\n\nSee [docs](https://example.com).\n\n## Details\n\nMore context here.\n\n# Outro\n\nSee you later.',
    // focusTitle: 'Details'
  });

  logger.info({result}, 'agent output');
  logger.info('ready');
}

const shutdown = (signal: string): void => {
  logger.info({signal}, 'shutting down');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.error({err}, 'fatal error');
  process.exit(1);
});
