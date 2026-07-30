import {parseDocument} from './parsers/index';

export interface MockupComponent {
  type:
    | 'text-input'
    | 'password-input'
    | 'button'
    | 'link'
    | 'image'
    | 'table'
    | 'form'
    | 'container'
    | 'text'
    | string;
  label?: string;
  placeholder?: string;
  action?: string;
  children?: MockupComponent[];
  metadata?: Record<string, string>;
}

export interface AgentInput {
  documentId: string;
  source: 'pdf' | 'markdown' | 'text' | 'xlsx' | 'image';
  content?: string;
  filePath?: string;
  focusTitle?: string;
}

export interface EvidenceItem {
  type: 'text' | 'structure';
  source: 'content' | 'title' | 'section';
  snippet: string;
  context?: string;
}

export interface Section {
  title: string;
  kind: 'summary' | 'detail';
  text: string;
  nodeId?: string;
  children: Section[];
}

export type NodeKind =
  | 'heading'
  | 'paragraph'
  | 'link'
  | 'table'
  | 'image'
  | 'code'
  | 'blockquote'
  | 'list'
  | 'listItem'
  | 'mockup';

export interface SchemaNode {
  id: string;
  title: string;
  level: number;
  content: string;
  kind: NodeKind;
  children: SchemaNode[];
  parentId?: string;
  metadata?: {
    href?: string;
    alt?: string;
    rows?: string[][];
    lang?: string;
    ordered?: boolean;
    start?: number;
    pageNumber?: number;
    sheetName?: string;
    // mockup
    imageUrl?: string;
    ocrText?: string;
    components?: MockupComponent[];
  };
}

export interface SchedulerViewItem {
  id: string;
  title: string;
  kind: NodeKind;
  level: number;
  content: string;
  parentId?: string;
  childrenIds: string[];
  metadata?: SchemaNode['metadata'];
}

export interface AgentStats {
  totalNodes: number;
  byKind: Partial<Record<NodeKind, number>>;
  maxDepth: number;
  headingCount: number;
}

export interface AgentOutput {
  documentId: string;
  source: AgentInput['source'];
  summary: string;
  stats: AgentStats;
  sections: Section[];
  evidence: EvidenceItem[];
  nodes: SchemaNode[];
  schedulerView: SchedulerViewItem[];
}

function countNodes(nodes: SchemaNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function maxDepth(nodes: SchemaNode[], currentDepth = 0): number {
  let depth = currentDepth;
  for (const node of nodes) {
    const childDepth = maxDepth(node.children, currentDepth + 1);
    if (childDepth > depth) {
      depth = childDepth;
    }
  }
  return depth;
}

function buildStats(nodes: SchemaNode[]): AgentStats {
  const byKind: Record<string, number> = {};
  let headingCount = 0;

  const walk = (nodeList: SchemaNode[]): void => {
    for (const node of nodeList) {
      byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
      if (node.kind === 'heading') {
        headingCount++;
      }
      walk(node.children);
    }
  };
  walk(nodes);

  return {
    totalNodes: countNodes(nodes),
    byKind: byKind as AgentStats['byKind'],
    maxDepth: maxDepth(nodes),
    headingCount
  };
}

function buildSummary(nodes: SchemaNode[], source: string): string {
  const headings: string[] = [];

  const collect = (nodeList: SchemaNode[]): void => {
    for (const node of nodeList) {
      if (node.kind === 'heading' && node.title) {
        headings.push(node.title);
        if (headings.length >= 8) {
          return;
        }
      }
      collect(node.children);
      if (headings.length >= 8) {
        return;
      }
    }
  };
  collect(nodes);

  if (headings.length === 0) {
    return `Parsed ${source} document with ${countNodes(nodes)} node(s).`;
  }

  const outline = headings.join(' › ');
  return `${outline}（共 ${countNodes(nodes)} 节点）`;
}

function toSections(nodes: SchemaNode[]): Section[] {
  return nodes.map(node => ({
    title: node.title,
    kind: node.level === 1 ? 'summary' : 'detail',
    text: node.content || node.title,
    nodeId: node.id,
    children: toSections(node.children)
  }));
}

function attachParent(nodes: SchemaNode[], parentId?: string): void {
  for (const node of nodes) {
    node.parentId = parentId;
    attachParent(node.children, node.id);
  }
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

  const matched = nodes.map(node => matchNode(node)).find(Boolean);
  if (!matched) {
    return [];
  }

  const collectSubtree = (node: SchemaNode): SchemaNode => ({
    ...node,
    children: node.children.map(child => collectSubtree(child))
  });

  return [collectSubtree(matched)];
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  let nodes = await parseDocument(input.source, {
    content: input.content,
    filePath: input.filePath
  });

  nodes = filterNodesByTitle(nodes, input.focusTitle);

  if (nodes.length === 0) {
    const fallbackContent = input.content ?? input.filePath ?? 'Untitled';
    const lines = fallbackContent
      .split(/\n+/)
      .map(l => l.trim())
      .filter(Boolean);
    nodes = [
      {
        id: 'node-1',
        title: lines[0] ?? 'Untitled',
        level: 1,
        content: lines.slice(1).join(' ') || fallbackContent,
        kind: 'paragraph' as const,
        children: []
      }
    ];
  }

  attachParent(nodes);

  const stats = buildStats(nodes);
  const summary = buildSummary(nodes, input.source);
  const sections = toSections(nodes);

  const evidence: EvidenceItem[] = nodes.flatMap(node => {
    const list: EvidenceItem[] = [];
    const visit = (current: SchemaNode): void => {
      if (current.kind === 'heading' || current.kind === 'paragraph') {
        list.push({
          type: 'structure',
          source: current.kind === 'heading' ? 'title' : 'content',
          snippet: current.content || current.title,
          context: current.metadata?.pageNumber ? `page ${current.metadata.pageNumber}` : undefined
        });
      }
      current.children.forEach(visit);
    };
    visit(node);
    return list;
  });

  const schedulerView: SchedulerViewItem[] = [];
  const collectFlat = (nodeList: SchemaNode[]): void => {
    for (const node of nodeList) {
      schedulerView.push({
        id: node.id,
        title: node.title,
        kind: node.kind,
        level: node.level,
        content: node.content,
        parentId: node.parentId,
        childrenIds: node.children.map(c => c.id),
        metadata: node.metadata
      });
      collectFlat(node.children);
    }
  };
  collectFlat(nodes);

  return {
    documentId: input.documentId,
    source: input.source,
    summary,
    stats,
    sections,
    evidence,
    nodes,
    schedulerView
  };
}
