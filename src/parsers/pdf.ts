import fs from 'node:fs/promises';
import {PDFParse} from 'pdf-parse';

import type {SchemaNode} from '../agent';
import {logger} from '../logger';
import type {DocumentParser, ParserInput} from './types';
import {createNode, parsePlainTextStructure} from './utils';

interface PdfExtractResult {
  text: string;
  pageCount: number;
}

async function extractFromPdf(filePath: string): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(filePath);

  const pdfParse = new PDFParse({data: new Uint8Array(buffer)});

  const [textResult, tableResult] = await Promise.all([
    pdfParse.getText({parseHyperlinks: true, pageJoiner: '\f'}),
    pdfParse.getTable().catch(() => null)
  ]);

  const text = textResult.text;
  const pageCount = textResult.total;

  if (tableResult) {
    logger.info(
      {pages: pageCount, tablePages: Object.keys(tableResult.pages).length},
      'pdf parsed with tables'
    );
  } else {
    logger.info({pages: pageCount, textLength: text.length}, 'pdf parsed');
  }

  await pdfParse.destroy();

  return {text, pageCount};
}

export const pdfParser: DocumentParser = {
  source: 'pdf',
  async parse(input: ParserInput): Promise<SchemaNode[]> {
    let text = input.content;

    if (input.filePath) {
      try {
        const result = await extractFromPdf(input.filePath);
        text = result.text;
      } catch (err) {
        logger.error({err, filePath: input.filePath}, 'pdf parse failed');
        return [
          createNode('node-1', 'PDF Parse Error', 1, 'heading', ''),
          createNode('node-2', 'paragraph', 0, 'paragraph', String(err))
        ];
      }
    }

    if (!text || text.trim().length === 0) {
      return [createNode('node-1', 'Empty PDF', 1, 'heading', '')];
    }

    const pages = text.split(/\f+/).filter(p => p.trim());

    if (pages.length <= 1) {
      return parsePlainTextStructure(text);
    }

    const nodes: SchemaNode[] = [];
    let counter = 1;

    for (const page of pages) {
      const pageNode = createNode(`node-${counter++}`, `Page ${counter - 1}`, 1, 'heading', '');
      pageNode.metadata = {pageNumber: counter - 1};
      const pageChildren = parsePlainTextStructure(page);

      for (const child of pageChildren) {
        child.parentId = pageNode.id;
        child.metadata = {...child.metadata, pageNumber: counter - 1};
        pageNode.children.push(child);
      }

      pageNode.content = pageChildren
        .map(c => c.content || c.title)
        .filter(Boolean)
        .join('\n');

      nodes.push(pageNode);
    }

    return nodes;
  }
};
