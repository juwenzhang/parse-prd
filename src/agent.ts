import {unified} from 'unified';
import remarkParse from 'remark-parse';

export interface AgentInput {
  documentId: string;
  source: 'pdf' | 'markdown' | 'text';
  content: string;
  focusTitle?: string;
}

export interface EvidenceItem {
  type: 'text' | 'structure';
  source: 'content' | 'title' | 'section';
  snippet: string;
}

export interface Section {
  title: string;
  kind: 'summary' | 'detail';
  text: string;
  nodeId?: string;
  children: Section[];
}

export interface SchemaNode {
  id: string;
  title: string;
  level: number;
  content: string;
  kind: 'heading' | 'paragraph' | 'link' | 'table' | 'image';
  children: SchemaNode[];
  parentId?: string;
  metadata?: {
    href?: string;
    alt?: string;
    rows?: string[][];
  };
}

export interface SchedulerViewItem {
  id: string;
  title: string;
  kind: SchemaNode['kind'];
  level: number;
  content: string;
  parentId?: string;
  childrenIds: string[];
  metadata?: SchemaNode['metadata'];
}

export interface AgentOutput {
  documentId: string;
  source: AgentInput['source'];
  summary: string;
  sections: Section[];
  evidence: EvidenceItem[];
  nodes: SchemaNode[];
  schedulerView: SchedulerViewItem[];
}

function countNodes(nodes: SchemaNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function toSections(nodes: SchemaNode[]): Section[] {
  return nodes.map((node) => ({
    title: node.title,
    kind: node.level === 1 ? 'summary' : 'detail',
    text: node.content || node.title,
    nodeId: node.id,
    children: toSections(node.children)
  }));
}

function createNode(
  id: string,
  title: string,
  level: number,
  kind: SchemaNode['kind'],
  content: string
): SchemaNode {
  return {
    id,
    title,
    level,
    content,
    kind,
    children: []
  };
}

function attachParent(nodes: SchemaNode[], parentId?: string): void {
  for (const node of nodes) {
    node.parentId = parentId;
    attachParent(node.children, node.id);
  }
}

function toPlainText(node: any): string {
  if (!node) {
    return '';
  }

  if (typeof node === 'string') {
    return node;
  }

  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }

  if (node.type === 'html') {
    return '';
  }

  if (node.type === 'link' || node.type === 'image') {
    return node.alt ?? '';
  }

  if (Array.isArray(node.children)) {
    return node.children.map((child: any) => toPlainText(child)).join('');
  }

  if (typeof node.value === 'string') {
    return node.value;
  }

  return '';
}

function toTableRows(table: any): string[][] {
  const rows = Array.isArray(table?.children) ? table.children : [];
  return rows
    .map((row: any) => {
      const cells = Array.isArray(row?.children) ? row.children : [];
      return cells.map((cell: any) => toPlainText(cell).trim());
    })
    .filter((row: string[]) => row.some(Boolean));
}

function filterNodesByTitle(nodes: SchemaNode[], focusTitle?: string): SchemaNode[] {
  if (!focusTitle) {
    return nodes;
  }

  const normalized = focusTitle.trim().toLowerCase();
  const matchNode = (node: SchemaNode): SchemaNode | null => {
    if (node.title.trim().toLowerCase() === normalized) {
      return node;
    }

    for (const child of node.children) {
      const matchedChild = matchNode(child);
      if (matchedChild) {
        return matchedChild;
      }
    }

    return null;
  };

  const matched = nodes.map((node) => matchNode(node)).find(Boolean);
  if (!matched) {
    return [];
  }

  const collectSubtree = (node: SchemaNode): SchemaNode => ({
    ...node,
    children: node.children.map((child) => collectSubtree(child))
  });

  return [collectSubtree(matched)];
}

function parseMarkdownNodes(content: string): SchemaNode[] {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(content) as any;
  const nodes: SchemaNode[] = [];
  const headingStack: Array<{level: number; node: SchemaNode}> = [];
  let counter = 1;

  const appendNode = (node: SchemaNode, parent?: SchemaNode): void => {
    if (parent) {
      parent.children.push(node);
    } else {
      nodes.push(node);
    }
  };

  const children = Array.isArray(tree?.children) ? tree.children : [];
  for (const child of children) {
    if (child.type === 'heading') {
      const level = Number(child.depth ?? 1);
      const title = toPlainText(child).trim() || 'Untitled';
      while (headingStack.length > 0 && (headingStack[headingStack.length - 1]?.level ?? 0) >= level) {
        headingStack.pop();
      }

      const parent = headingStack[headingStack.length - 1]?.node;
      const headingNode = createNode(`node-${counter++}`, title, level, 'heading', '');
      appendNode(headingNode, parent);
      headingStack.push({level, node: headingNode});
      continue;
    }

    if (child.type === 'paragraph') {
      const text = toPlainText(child).trim();
      const paragraphNode = createNode(`node-${counter++}`, 'paragraph', 0, 'paragraph', text);
      const parent = headingStack[headingStack.length - 1]?.node;
      appendNode(paragraphNode, parent);

      if (parent?.kind === 'heading' && text) {
        parent.content = `${parent.content}${parent.content ? '\n' : ''}${text}`.trim();
      }

      const nestedChildren = Array.isArray(child.children) ? child.children : [];
      for (const nestedChild of nestedChildren) {
        if (nestedChild.type === 'link') {
          const linkNode = createNode(`node-${counter++}`, toPlainText(nestedChild).trim() || 'link', 0, 'link', nestedChild.url ?? '');
          linkNode.metadata = {href: nestedChild.url ?? ''};
          paragraphNode.children.push(linkNode);
        } else if (nestedChild.type === 'image') {
          const imageNode = createNode(`node-${counter++}`, nestedChild.alt || 'image', 0, 'image', nestedChild.url ?? '');
          imageNode.metadata = {href: nestedChild.url ?? '', alt: nestedChild.alt || 'image'};
          paragraphNode.children.push(imageNode);
        }
      }
      continue;
    }

    if (child.type === 'table') {
      const tableNode = createNode(`node-${counter++}`, 'table', 0, 'table', '');
      tableNode.metadata = {rows: toTableRows(child)};
      const parent = headingStack[headingStack.length - 1]?.node;
      appendNode(tableNode, parent);
    }
  }

  return nodes;
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const lines = input.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = lines[0] ?? 'Untitled';
  const body = lines.slice(1).join(' ');

  let nodes: SchemaNode[] = [];
  if (input.source === 'markdown') {
    nodes = parseMarkdownNodes(input.content);
  }

  nodes = filterNodesByTitle(nodes, input.focusTitle);

  if (nodes.length === 0) {
    nodes = [
      {
        id: 'node-1',
        title,
        level: 1,
        content: body,
        kind: 'paragraph',
        children: []
      }
    ];
  }

  attachParent(nodes);

  const sections = toSections(nodes);

  const evidence: EvidenceItem[] = nodes.flatMap((node) => {
    const list: EvidenceItem[] = [];
    const visit = (current: SchemaNode): void => {
      list.push({
        type: current.kind === 'paragraph' || current.kind === 'heading' ? 'structure' : 'text',
        source: current.kind === 'heading' ? 'title' : 'content',
        snippet: current.content || current.title
      });
      current.children.forEach(visit);
    };
    visit(node);
    return list;
  });

  const schedulerView = nodes.map((node) => ({
    id: node.id,
    title: node.title,
    kind: node.kind,
    level: node.level,
    content: node.content,
    parentId: node.parentId,
    childrenIds: node.children.map((child) => child.id),
    metadata: node.metadata
  }));

  return {
    documentId: input.documentId,
    source: input.source,
    summary: `Parsed ${input.source} content into ${countNodes(nodes)} schema node(s).`,
    sections,
    evidence,
    nodes,
    schedulerView
  };
}
