import type {AgentOutput, NodeKind, SchemaNode} from './agent';

interface FormatOptions {
  stats?: boolean;
  evidence?: boolean;
  maxDepth?: number;
}

function renderNode(node: SchemaNode, depth: number, opts: FormatOptions): string {
  const lines: string[] = [];
  const maxD = opts.maxDepth ?? 6;

  if (depth > maxD) return '';

  switch (node.kind) {
    case 'heading': {
      const level = Math.min(node.level || 1, 6);
      lines.push(`${'#'.repeat(level)} ${node.title}`);
      if (node.content && node.content !== node.title) {
        lines.push('');
        lines.push(node.content);
      }
      break;
    }
    case 'paragraph':
      if (node.content) lines.push(node.content);
      break;
    case 'code': {
      const lang = node.metadata?.lang ?? '';
      lines.push(`\`\`\`${lang}\n${node.content}\n\`\`\``);
      break;
    }
    case 'blockquote': {
      const childLines = renderChildren(node, depth, opts);
      lines.push(
        ...childLines
          .split('\n')
          .filter(Boolean)
          .map(l => `> ${l}`)
      );
      if (!childLines && node.content) lines.push(`> ${node.content}`);
      break;
    }
    case 'list':
      lines.push(renderChildren(node, depth + 1, opts));
      break;
    case 'listItem': {
      const prefix = node.metadata?.ordered ? `${node.metadata?.start ?? 1}. ` : '- ';
      if (node.content) lines.push(`${prefix}${node.content}`);
      const nested = node.children
        .map(c => renderNode(c, depth + 1, opts))
        .filter(Boolean)
        .join('\n');
      if (nested) lines.push(...nested.split('\n').map(l => `  ${l}`));
      break;
    }
    case 'link':
      if (node.metadata?.href) lines.push(`[${node.content || node.title}](${node.metadata.href})`);
      break;
    case 'image':
    case 'mockup': {
      if (node.metadata?.imageUrl || node.metadata?.href) {
        const url = node.metadata.imageUrl || node.metadata.href || '';
        const alt = node.metadata?.alt ?? node.title;
        lines.push(`![${alt}](${url})`);
        if (node.metadata?.ocrText) {
          lines.push(`> OCR: ${node.metadata.ocrText}`);
        }
        if (node.metadata?.components?.length) {
          lines.push('> 组件:');
          for (const c of node.metadata.components) {
            lines.push(
              `> - ${c.type}${c.label ? ` "${c.label}"` : ''}${c.action ? ` → ${c.action}` : ''}`
            );
          }
        }
      }
      break;
    }
    case 'table': {
      const rows = node.metadata?.rows;
      if (rows && rows.length > 0) {
        const header = rows[0];
        if (header) {
          lines.push(`| ${header.join(' | ')} |`);
          lines.push(`| ${header.map(() => '---').join(' | ')} |`);
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row) lines.push(`| ${row.join(' | ')} |`);
          }
        }
      }
      break;
    }
  }

  return lines.join('\n');
}

function renderChildren(node: SchemaNode, depth: number, opts: FormatOptions): string {
  return node.children
    .map(c => renderNode(c, depth, opts))
    .filter(Boolean)
    .join('\n\n');
}

export function formatOutput(output: AgentOutput, opts: FormatOptions = {}): string {
  const sections: string[] = [];
  sections.push(`# ${output.documentId}`);

  if (opts.stats) {
    const kindSummary = (Object.keys(output.stats.byKind) as NodeKind[])
      .map(k => `${k}: ${output.stats.byKind[k]}`)
      .join(', ');
    sections.push('');
    sections.push(
      `> **Stats** — ${output.stats.totalNodes} nodes, ${output.stats.headingCount} headings, max depth ${output.stats.maxDepth}`
    );
    sections.push(`> ${kindSummary}`);
  }

  sections.push('');
  for (const node of output.nodes) {
    const rendered = renderNode(node, 0, opts);
    if (rendered) sections.push(rendered);
  }

  if (opts.evidence && output.evidence.length > 0) {
    sections.push('');
    sections.push('## Evidence');
    for (const item of output.evidence.slice(0, 20)) {
      const ctx = item.context ? ` (${item.context})` : '';
      sections.push(`- [${item.source}] ${item.snippet}${ctx}`);
    }
  }

  return sections.join('\n');
}
