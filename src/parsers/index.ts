import type {SchemaNode} from '../agent';

import {markdownParser} from './markdown';
import {pdfParser} from './pdf';
import {textParser} from './text';
import type {DocumentParser, ParserInput} from './types';
import {xlsxParser} from './xlsx';

const parsers = new Map<string, DocumentParser>();

function register(parser: DocumentParser): void {
  parsers.set(parser.source, parser);
}

register(markdownParser);
register(pdfParser);
register(textParser);
register(xlsxParser);

export async function parseDocument(source: string, input: ParserInput): Promise<SchemaNode[]> {
  const parser = parsers.get(source);

  if (!parser) {
    throw new Error(
      `Unsupported document source: ${source}. Supported: ${[...parsers.keys()].join(', ')}`
    );
  }

  return parser.parse(input);
}

export function getSupportedSources(): string[] {
  return [...parsers.keys()];
}

export type {DocumentParser, ParserInput} from './types';
export {markdownParser, pdfParser, textParser, xlsxParser};
