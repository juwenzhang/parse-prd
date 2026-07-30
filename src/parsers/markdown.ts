import remarkParse from 'remark-parse';
import {unified} from 'unified';

import type {SchemaNode} from '../agent';
import type {DocumentParser, ParserInput} from './types';
import {createNode, toPlainText, toTableRows} from './utils';

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

type HeadingStackEntry = {level: number; node: SchemaNode};

function parseListItems(
  items: MdastNode[],
  counter: () => number,
  ordered: boolean,
  start: number
): SchemaNode[] {
  const result: SchemaNode[] = [];

  for (const item of items) {
    if (!Array.isArray(item.children)) {
      continue;
    }

    const textParts: string[] = [];
    const nestedItems: SchemaNode[] = [];
    let checkboxChecked: boolean | null = null;

    for (const child of item.children) {
      if (child.type === 'paragraph') {
        textParts.push(toPlainText(child).trim());
      } else if (child.type === 'list') {
        nestedItems.push(
          ...parseListItems(child.children ?? [], counter, child.ordered ?? false, child.start ?? 1)
        );
      } else if (child.type === 'blockquote') {
        const blockNode = parseBlockquote(child, counter);
        nestedItems.push(blockNode);
      } else {
        textParts.push(toPlainText(child).trim());
      }
    }

    if (item.checked !== null && item.checked !== undefined) {
      checkboxChecked = item.checked;
    }

    const label = checkboxChecked !== null ? (checkboxChecked ? '[x]' : '[ ]') : '';
    const itemText = textParts.filter(Boolean).join(' ');
    const itemNode = createNode(
      `node-${counter()}`,
      label ? `${label} ${itemText}` : itemText || 'list item',
      0,
      'listItem',
      itemText
    );
    itemNode.metadata = {ordered, start};
    for (const nested of nestedItems) {
      nested.parentId = itemNode.id;
      itemNode.children.push(nested);
    }
    result.push(itemNode);
  }

  return result;
}

function parseBlockquote(node: MdastNode, counter: () => number): SchemaNode {
  const childNodes: SchemaNode[] = [];

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.type === 'paragraph') {
        const text = toPlainText(child).trim();
        if (text) {
          childNodes.push(createNode(`node-${counter()}`, 'paragraph', 0, 'paragraph', text));
        }
      } else if (child.type === 'list') {
        childNodes.push(
          ...parseListItems(child.children ?? [], counter, child.ordered ?? false, child.start ?? 1)
        );
      }
    }
  }

  const textContent = childNodes
    .map(c => c.content)
    .filter(Boolean)
    .join(' | ');
  const blockNode = createNode(`node-${counter()}`, '引用', 0, 'blockquote', textContent);
  for (const child of childNodes) {
    child.parentId = blockNode.id;
    blockNode.children.push(child);
  }
  return blockNode;
}

function parseMarkdownNodes(content: string): SchemaNode[] {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(content) as {children?: MdastNode[]};
  const nodes: SchemaNode[] = [];
  const headingStack: HeadingStackEntry[] = [];
  let counter = 1;
  const nextId = () => counter++;

  const appendNode = (node: SchemaNode, parent?: SchemaNode): void => {
    if (parent) {
      parent.children.push(node);
    } else {
      nodes.push(node);
    }
  };

  const currentParent = (): SchemaNode | undefined => headingStack[headingStack.length - 1]?.node;

  const children = tree.children ?? [];
  for (const child of children) {
    // --- heading ---
    if (child.type === 'heading') {
      const level = Number(child.depth ?? 1);
      const title = toPlainText(child).trim() || 'Untitled';
      while (
        headingStack.length > 0 &&
        (headingStack[headingStack.length - 1]?.level ?? 0) >= level
      ) {
        headingStack.pop();
      }

      const parent = currentParent();
      const headingNode = createNode(`node-${nextId()}`, title, level, 'heading', '');
      appendNode(headingNode, parent);
      headingStack.push({level, node: headingNode});
      continue;
    }

    // --- thematic break ---
    if (child.type === 'thematicBreak') {
      continue;
    }

    // --- code block ---
    if (child.type === 'code') {
      const codeValue = child.value ?? '';
      const lang = child.lang ?? undefined;
      const codeNode = createNode(`node-${nextId()}`, lang || 'code', 0, 'code', codeValue);
      codeNode.metadata = lang ? {lang} : undefined;
      appendNode(codeNode, currentParent());
      continue;
    }

    // --- blockquote ---
    if (child.type === 'blockquote') {
      const blockNode = parseBlockquote(child, nextId);
      appendNode(blockNode, currentParent());
      continue;
    }

    // --- list (ordered / unordered / task list) ---
    if (child.type === 'list') {
      const ordered = child.ordered ?? false;
      const start = child.start ?? 1;
      const items = parseListItems(child.children ?? [], nextId, ordered, start);

      const label = ordered ? '有序列表' : '无序列表';
      const listNode = createNode(`node-${nextId()}`, label, 0, 'list', '');
      listNode.metadata = {ordered, start};
      for (const item of items) {
        item.parentId = listNode.id;
        listNode.children.push(item);
      }
      appendNode(listNode, currentParent());
      continue;
    }

    // --- paragraph (may contain links/images/inlineCode) ---
    if (child.type === 'paragraph') {
      const text = toPlainText(child).trim();
      const paragraphNode = createNode(`node-${nextId()}`, 'paragraph', 0, 'paragraph', text);
      const parent = currentParent();
      appendNode(paragraphNode, parent);

      if (parent?.kind === 'heading' && text) {
        parent.content = `${parent.content}${parent.content ? '\n' : ''}${text}`.trim();
      }

      const nestedChildren = child.children ?? [];
      for (const nestedChild of nestedChildren) {
        if (nestedChild.type === 'link') {
          const linkNode = createNode(
            `node-${nextId()}`,
            toPlainText(nestedChild).trim() || 'link',
            0,
            'link',
            nestedChild.url ?? ''
          );
          linkNode.metadata = {href: nestedChild.url ?? ''};
          paragraphNode.children.push(linkNode);
        } else if (nestedChild.type === 'image') {
          const imageNode = createNode(
            `node-${nextId()}`,
            nestedChild.alt || 'image',
            0,
            'image',
            nestedChild.url ?? ''
          );
          imageNode.metadata = {href: nestedChild.url ?? '', alt: nestedChild.alt || 'image'};
          paragraphNode.children.push(imageNode);
        } else if (nestedChild.type === 'inlineCode') {
          const inlineCodeNode = createNode(
            `node-${nextId()}`,
            nestedChild.value ?? '',
            0,
            'code',
            nestedChild.value ?? ''
          );
          inlineCodeNode.metadata = {lang: 'inline'};
          paragraphNode.children.push(inlineCodeNode);
        }
      }
      continue;
    }

    // --- table ---
    if (child.type === 'table') {
      const tableNode = createNode(`node-${nextId()}`, 'table', 0, 'table', '');
      tableNode.metadata = {rows: toTableRows(child)};
      appendNode(tableNode, currentParent());
    }
  }

  return nodes;
}

export const markdownParser: DocumentParser = {
  source: 'markdown',
  async parse(input: ParserInput): Promise<SchemaNode[]> {
    if (!input.content) {
      return [];
    }
    return parseMarkdownNodes(input.content);
  }
};
