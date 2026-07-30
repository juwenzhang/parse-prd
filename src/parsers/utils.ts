import type {NodeKind, SchemaNode} from '../agent';

interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  url?: string;
  alt?: string;
  lang?: string;
  meta?: string | null;
  ordered?: boolean;
  start?: number;
  spread?: boolean;
  checked?: boolean | null;
}

export function createNode(
  id: string,
  title: string,
  level: number,
  kind: NodeKind,
  content: string
): SchemaNode {
  return {id, title, level, content, kind, children: []};
}

export function toPlainText(node: MdastNode | string): string {
  if (!node) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }
  if (node.type === 'html' || node.type === 'thematicBreak') {
    return '';
  }
  if (node.type === 'link' || node.type === 'image') {
    return node.alt ?? '';
  }
  if (node.type === 'code') {
    return node.value ?? '';
  }
  if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete') {
    if (Array.isArray(node.children)) {
      return node.children.map(child => toPlainText(child)).join('');
    }
  }
  if (node.type === 'list' || node.type === 'listItem') {
    return '';
  }
  if (node.type === 'blockquote') {
    if (Array.isArray(node.children)) {
      return node.children.map(child => toPlainText(child)).join('\n');
    }
    return '';
  }
  if (Array.isArray(node.children)) {
    return node.children.map(child => toPlainText(child)).join('');
  }
  if (typeof node.value === 'string') {
    return node.value;
  }
  return '';
}

export function toTableRows(table: MdastNode): string[][] {
  const rows = Array.isArray(table.children) ? table.children : [];
  return rows
    .map(row => {
      const cells = Array.isArray(row.children) ? row.children : [];
      return cells.map(cell => toPlainText(cell).trim());
    })
    .filter(row => row.some(Boolean));
}

const HEADING_PATTERNS: Array<{regex: RegExp; level: number}> = [
  {regex: /^#{1,6}\s+(.+)$/, level: 0},
  {regex: /^(?:第[一二三四五六七八九十]+章|[Cc]hapter\s+\d+)\s*[-—–:：]?\s*(.+)$/, level: 1},
  {regex: /^(?:[一二三四五六七八九十]+|[1-9]\d*)[、，。]\s*(.+)$/, level: 2},
  {regex: /^(?:[（(]\s*[一二三四五六七八九十1-9]\s*[)）]|[1-9]\d*[)）])\s*(.+)$/, level: 3},
  {regex: /^\d+\.\d+\s+(.+)$/, level: 4},
  {regex: /^[A-Z][A-Za-z\s]{2,50}$/, level: 5}
];

function detectHeadingLevel(line: string): {title: string; level: number} | null {
  const trimmed = line.trim();

  for (const {regex, level} of HEADING_PATTERNS) {
    const match = trimmed.match(regex);
    if (match) {
      const title = (match[1] ?? trimmed).trim();
      if (regex.source.startsWith('^#{1,6}')) {
        const hashCount = (trimmed.match(/^#+/) ?? [''])[0]?.length ?? 1;
        return {title, level: Math.min(hashCount, 6)};
      }
      return {title, level: level || 1};
    }
  }

  if (trimmed.length > 0 && trimmed.length < 80) {
    const noEndingPunct = !/[。！？.!?，,;；：:]$/.test(trimmed);
    const startsWithBold = /^\*\*.+\*\*$/.test(trimmed) || /^__.+__$/.test(trimmed);
    if ((noEndingPunct && trimmed.length < 60) || startsWithBold) {
      return {title: trimmed.replace(/^\*\*|^__|\*\*$|__$/g, '').trim(), level: 3};
    }
  }

  return null;
}

export function parsePlainTextStructure(text: string): SchemaNode[] {
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const nodes: SchemaNode[] = [];
  const headingStack: Array<{level: number; node: SchemaNode}> = [];
  let counter = 1;

  for (const line of lines) {
    const heading = detectHeadingLevel(line);

    if (heading) {
      while (
        headingStack.length > 0 &&
        (headingStack[headingStack.length - 1]?.level ?? 0) >= heading.level
      ) {
        headingStack.pop();
      }

      const parent = headingStack[headingStack.length - 1]?.node;
      const headingNode = createNode(
        `node-${counter++}`,
        heading.title,
        heading.level,
        'heading',
        ''
      );
      if (parent) {
        parent.children.push(headingNode);
      } else {
        nodes.push(headingNode);
      }
      headingStack.push({level: heading.level, node: headingNode});
    } else {
      const paragraphNode = createNode(`node-${counter++}`, 'paragraph', 0, 'paragraph', line);
      const parent = headingStack[headingStack.length - 1]?.node;
      if (parent) {
        paragraphNode.parentId = parent.id;
        parent.children.push(paragraphNode);
        parent.content = `${parent.content}${parent.content ? '\n' : ''}${line}`.trim();
      } else {
        nodes.push(paragraphNode);
      }
    }
  }

  return nodes;
}
