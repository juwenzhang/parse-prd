import type {VlmImageInput, VlmOutput, VlmProvider} from './types';

export class NoopVlmProvider implements VlmProvider {
  readonly name = 'noop';

  async describe(_input: VlmImageInput): Promise<VlmOutput> {
    return {ocrText: '', components: [], rawResponse: ''};
  }
}
