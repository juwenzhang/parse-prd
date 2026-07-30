import 'dotenv/config';
import {z} from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
  LLM_MODEL: z.string().default('deepseek-chat')
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
