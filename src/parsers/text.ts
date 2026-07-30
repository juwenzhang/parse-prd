import type {SchemaNode} from '../agent';
import type {DocumentParser, ParserInput} from './types';
import {parsePlainTextStructure} from './utils';

export const textParser: DocumentParser = {
  source: 'text',
  async parse(input: ParserInput): Promise<SchemaNode[]> {
    if (!input.content) {
      return [];
    }
    return parsePlainTextStructure(input.content);
  }
};
