import type {SchemaNode} from '../agent';

export interface ParserInput {
  content?: string;
  filePath?: string;
}

export interface DocumentParser {
  readonly source: string;
  parse(input: ParserInput): Promise<SchemaNode[]>;
}
