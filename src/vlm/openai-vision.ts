import OpenAI from 'openai';
import type {MockupComponent} from '../agent';
import {env} from '../env';
import {logger} from '../logger';
import type {VlmImageInput, VlmOutput, VlmProvider} from './types';

const SYSTEM_PROMPT = `你是一个 UI 交互分析专家。
分析图片中的界面，输出 JSON：

{
  "ocrText": "图片中所有可见文字的提取结果",
  "components": [
    {"type": "text-input|button|link|image|text", "label": "组件文案", "placeholder": "占位文字", "action": "触发动作"}
  ]
}

规则：
1. ocrText 提取所有可见文字，按阅读顺序排列
2. components 只列出可交互组件（按钮、输入框、链接），不列纯展示元素
3. type 使用英文小写 + 连字符（text-input, password-input, button, link, image）`;

export class OpenAICompatibleVisionProvider implements VlmProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor(opts?: {apiKey?: string; baseURL?: string; model?: string}) {
    this.name = 'openai-compatible-vision';
    this.client = new OpenAI({
      apiKey: opts?.apiKey ?? env.LLM_API_KEY,
      baseURL: opts?.baseURL ?? 'https://api.deepseek.com/v1'
    });
    this.model = opts?.model ?? 'deepseek-chat';
  }

  async describe(input: VlmImageInput, userPrompt?: string): Promise<VlmOutput> {
    const content: Array<Record<string, unknown>> = [
      {type: 'text', text: userPrompt ?? '请分析这张图片中的 UI 界面，提取所有文字和交互组件。'}
    ];

    if (input.url) {
      content.push({type: 'image_url', image_url: {url: input.url}});
    } else if (input.base64) {
      content.push({
        type: 'image_url',
        image_url: {url: `data:${input.mimeType ?? 'image/png'};base64,${input.base64}`}
      });
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {role: 'system', content: SYSTEM_PROMPT},
          {
            role: 'user',
            content: content as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[]
          }
        ],
        max_tokens: 2048,
        response_format: {type: 'json_object'}
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as {ocrText?: string; components?: MockupComponent[]};

      return {
        ocrText: parsed.ocrText ?? '',
        components: parsed.components ?? [],
        rawResponse: raw
      };
    } catch (err) {
      logger.warn({err, model: this.model}, 'VLM call failed, returning empty result');
      return {ocrText: '', components: [], rawResponse: ''};
    }
  }
}
