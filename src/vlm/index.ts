import {NoopVlmProvider} from './noop';
import type {VlmProvider} from './types';

let provider: VlmProvider | null = null;

export function setVlmProvider(p: VlmProvider): void {
  provider = p;
}

export function getVlmProvider(): VlmProvider {
  return provider ?? new NoopVlmProvider();
}

export {NoopVlmProvider} from './noop';
export {OpenAICompatibleVisionProvider} from './openai-vision';
export type {VlmImageInput, VlmOutput, VlmProvider} from './types';
