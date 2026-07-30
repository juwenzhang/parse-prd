import fs from 'node:fs/promises';

import type {SchemaNode} from '../agent';
import {logger} from '../logger';
import type {DocumentParser, ParserInput} from './types';
import {createNode} from './utils';

type XlsxCellValue = string | number | boolean | null | undefined;

async function extractSheetsFromXlsx(
  filePath: string
): Promise<Array<{name: string; rows: string[][]}>> {
  const buffer = await fs.readFile(filePath);

  const XLSX = await import('xlsx');

  const workbook = XLSX.read(buffer, {type: 'buffer'});

  const sheets: Array<{name: string; rows: string[][]}> = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rawData: XlsxCellValue[][] = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ''});

    const rows: string[][] = rawData
      .map(row => row.map(cell => String(cell ?? '')))
      .filter(row => row.some(cell => cell.trim() !== ''));

    if (rows.length > 0) {
      sheets.push({name: sheetName, rows});
    }
  }

  logger.info({sheetCount: sheets.length, sheetNames: workbook.SheetNames}, 'xlsx parsed');
  return sheets;
}

export const xlsxParser: DocumentParser = {
  source: 'xlsx',
  async parse(input: ParserInput): Promise<SchemaNode[]> {
    const nodes: SchemaNode[] = [];
    let counter = 1;

    if (!input.filePath) {
      return [createNode('node-1', 'XLSX Error', 1, 'heading', 'No file path provided')];
    }

    let sheets: Array<{name: string; rows: string[][]}>;
    try {
      sheets = await extractSheetsFromXlsx(input.filePath);
    } catch (err) {
      logger.error({err, filePath: input.filePath}, 'xlsx parse failed');
      return [
        createNode('node-1', 'XLSX Parse Error', 1, 'heading', ''),
        createNode('node-2', 'paragraph', 0, 'paragraph', String(err))
      ];
    }

    if (sheets.length === 0) {
      return [createNode('node-1', 'Empty Workbook', 1, 'heading', 'No data sheets found')];
    }

    const rootNode = createNode(
      `node-${counter++}`,
      'Excel Workbook',
      1,
      'heading',
      `Workbook with ${sheets.length} sheet(s)`
    );

    for (const sheet of sheets) {
      const tableNode = createNode(
        `node-${counter++}`,
        sheet.name,
        0,
        'table',
        `Sheet: ${sheet.name} (${sheet.rows.length} rows)`
      );
      tableNode.metadata = {rows: sheet.rows};
      tableNode.parentId = rootNode.id;

      const headerRow = sheet.rows[0];
      if (headerRow) {
        const columnNames = headerRow.filter(c => c.trim()).join(', ');
        if (columnNames) {
          tableNode.content = `Columns: ${columnNames}`;
        }
      }

      for (let i = 1; i < sheet.rows.length; i++) {
        const row = sheet.rows[i];
        if (!row || row.every(c => !c.trim())) {
          continue;
        }
        const rowNode = createNode(
          `node-${counter++}`,
          `Row ${i + 1}`,
          0,
          'paragraph',
          row.filter(c => c.trim()).join(' | ')
        );
        rowNode.parentId = tableNode.id;
        tableNode.children.push(rowNode);
      }

      rootNode.children.push(tableNode);
    }

    nodes.push(rootNode);
    return nodes;
  }
};
