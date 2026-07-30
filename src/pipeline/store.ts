import fs from 'node:fs/promises';
import path from 'node:path';

import type {PipelineLayer, PipelineState} from './types';

export function pipelineRoot(cwd = '.'): string {
  return path.join(cwd, '.prd-pipeline');
}

export function openspecRoot(cwd = '.'): string {
  return path.join(cwd, 'openspec');
}

async function ensureDocDir(documentId: string, cwd: string): Promise<string> {
  const dir = path.join(pipelineRoot(cwd), documentId);
  await fs.mkdir(dir, {recursive: true});
  return dir;
}

export function layerFilePath(
  documentId: string,
  layer: PipelineLayer,
  cwd = '.',
  suffix = ''
): string {
  const nameMap: Record<PipelineLayer, string> = {1: 'standardize', 2: 'proposal', 3: 'openspec'};
  return path.join(pipelineRoot(cwd), documentId, `${layer}-${nameMap[layer]}${suffix}.json`);
}

export function stateFilePath(documentId: string, cwd = '.'): string {
  return path.join(pipelineRoot(cwd), documentId, 'state.json');
}

export async function readState(documentId: string, cwd = '.'): Promise<PipelineState | null> {
  try {
    const raw = await fs.readFile(stateFilePath(documentId, cwd), 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (
      data &&
      typeof data.documentId === 'string' &&
      typeof data.currentLayer === 'number' &&
      typeof data.status === 'object'
    ) {
      return data as unknown as PipelineState;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeState(state: PipelineState, cwd = '.'): Promise<void> {
  await ensureDocDir(state.documentId, cwd);
  await fs.writeFile(stateFilePath(state.documentId, cwd), JSON.stringify(state, null, 2));
}

export async function writeLayerOutput(
  documentId: string,
  layer: PipelineLayer,
  data: unknown,
  cwd = '.'
): Promise<void> {
  await ensureDocDir(documentId, cwd);
  await fs.writeFile(layerFilePath(documentId, layer, cwd), JSON.stringify(data, null, 2));
}

export async function readLayerOutput<T>(
  documentId: string,
  layer: PipelineLayer,
  cwd = '.'
): Promise<T | null> {
  try {
    const raw = await fs.readFile(layerFilePath(documentId, layer, cwd), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readReviewOutput<T>(
  documentId: string,
  layer: PipelineLayer,
  cwd = '.'
): Promise<T | null> {
  try {
    const raw = await fs.readFile(layerFilePath(documentId, layer, cwd, '.review'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed as object).length === 0) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export async function checkReviewDone(
  documentId: string,
  layer: PipelineLayer,
  cwd = '.'
): Promise<boolean> {
  const reviewed = await readReviewOutput(documentId, layer, cwd);
  return reviewed !== null;
}

export async function initState(documentId: string, cwd = '.'): Promise<PipelineState> {
  await ensureDocDir(documentId, cwd);
  const state: PipelineState = {
    documentId,
    currentLayer: 1,
    status: {'1': 'draft', '2': 'draft', '3': 'draft'},
    updatedAt: new Date().toISOString()
  };
  await writeState(state, cwd);
  return state;
}

export async function advanceState(
  documentId: string,
  toLayer: PipelineLayer,
  cwd = '.'
): Promise<PipelineState> {
  const state = await readState(documentId, cwd);
  if (!state) throw new Error(`No pipeline state found for ${documentId}`);
  state.currentLayer = toLayer;
  state.updatedAt = new Date().toISOString();
  await writeState(state, cwd);
  return state;
}
