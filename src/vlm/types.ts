import type {MockupComponent} from '../agent';

export interface VlmImageInput {
  url?: string;
  base64?: string;
  mimeType?: string;
}

export interface VlmOutput {
  ocrText: string;
  components: MockupComponent[];
  rawResponse: string;
}

export interface VlmProvider {
  readonly name: string;
  describe(input: VlmImageInput, prompt?: string): Promise<VlmOutput>;
}
