import fs from 'node:fs/promises';
import path from 'node:path';

import type {SchemaNode} from '../agent';
import {logger} from '../logger';
import {getVlmProvider} from '../vlm/index';

import type {DocumentParser, ParserInput} from './types';
import {createNode} from './utils';

async function imageToBase64(filePath: string): Promise<{base64: string; mimeType: string}> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  return {
    base64: buffer.toString('base64'),
    mimeType: mimeMap[ext] ?? 'image/png'
  };
}

export const imageParser: DocumentParser = {
  source: 'image',
  async parse(input: ParserInput): Promise<SchemaNode[]> {
    if (!input.filePath) {
      return [createNode('node-1', 'No image path', 0, 'mockup', '')];
    }

    const alt = path.basename(input.filePath);

    try {
      const {base64, mimeType} = await imageToBase64(input.filePath);
      const vlm = getVlmProvider();

      logger.info({file: input.filePath, vlm: vlm.name}, 'analyzing image');

      const result = await vlm.describe(
        {base64, mimeType},
        `请分析这张 UI 设计图，提取所有可见文字和交互组件。如果图片中无明显 UI 元素，请描述图片内容。`
      );

      const node = createNode(`node-1`, alt, 0, 'mockup', alt);
      node.metadata = {
        imageUrl: input.filePath,
        alt,
        ocrText: result.ocrText || alt,
        components: result.components
      };

      logger.info(
        {ocrLen: result.ocrText.length, components: result.components.length},
        'image analyzed'
      );

      return [node];
    } catch (err) {
      logger.error({err, file: input.filePath}, 'image analysis failed');
      const node = createNode('node-1', alt, 0, 'mockup', alt);
      node.metadata = {imageUrl: input.filePath, alt, ocrText: '', components: []};
      return [node];
    }
  }
};
