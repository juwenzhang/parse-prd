import {z} from 'zod';

export type PipelineLayer = 1 | 2 | 3;
export type PipelineStatus = 'draft' | 'review' | 'approved' | 'rejected';

export const GlosssaryItemSchema = z.object({
  term: z.string(),
  definition: z.string()
});

export const FunctionalReqSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['P0', 'P1', 'P2']).default('P2'),
  acceptanceCriteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([])
});

const nfrCategory = z.enum(['performance', 'security', 'reliability', 'scalability', 'usability']);

export const NonFunctionalReqSchema = z.object({
  id: z.string(),
  category: z
    .string()
    .transform(v => {
      const valid = nfrCategory.safeParse(v);
      return valid.success ? valid.data : 'performance';
    })
    .pipe(nfrCategory),
  description: z.string(),
  metric: z.string().default('待定义')
});

export const UserStorySchema = z.object({
  id: z.string(),
  role: z.string(),
  goal: z.string(),
  reason: z.string(),
  acceptanceCriteria: z.array(z.string()).default([])
});

export const DomainAttributeSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string()
});

export const DomainRelationshipSchema = z.object({
  target: z.string(),
  type: z.enum(['1:1', '1:N', 'N:M']).default('1:N'),
  description: z.string()
});

export const DomainEntitySchema = z.object({
  name: z.string(),
  attributes: z.array(DomainAttributeSchema).default([]),
  relationships: z.array(DomainRelationshipSchema).default([])
});

export const StandardizedPRDSchema = z.object({
  meta: z.object({
    title: z.string(),
    version: z.string().default('1.0'),
    author: z.string().optional(),
    createdAt: z.string().default(new Date().toISOString())
  }),
  overview: z.string(),
  background: z.string().default(''),
  scope: z.object({
    inScope: z.array(z.string()).default([]),
    outOfScope: z.array(z.string()).default([])
  }),
  functionalRequirements: z.array(FunctionalReqSchema).default([]),
  nonFunctionalRequirements: z.array(NonFunctionalReqSchema).default([]),
  userStories: z.array(UserStorySchema).default([]),
  domainEntities: z.array(DomainEntitySchema).default([]),
  constraints: z.array(z.string()).default([]),
  glossary: z.array(GlosssaryItemSchema).default([])
});

export type StandardizedPRD = z.infer<typeof StandardizedPRDSchema>;

export const ModuleOutlineSchema = z.object({
  name: z.string(),
  description: z.string(),
  responsibilities: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([])
});

export const APIOutlineSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  path: z.string(),
  summary: z.string()
});

export const DataModelOutlineSchema = z.object({
  name: z.string(),
  description: z.string(),
  keyFields: z.array(z.string()).default([])
});

export const OpenSpecProposalSchema = z.object({
  specId: z.string(),
  title: z.string(),
  status: z.enum(['draft', 'review', 'approved', 'rejected']).default('draft'),
  summary: z.string(),
  modules: z.array(ModuleOutlineSchema).default([]),
  apiEndpoints: z.array(APIOutlineSchema).default([]),
  dataModels: z.array(DataModelOutlineSchema).default([]),
  riskItems: z.array(z.string()).default([]),
  estimatedEffort: z.string().default('M'),
  openQuestions: z.array(z.string()).default([])
});

export type OpenSpecProposal = z.infer<typeof OpenSpecProposalSchema>;

export const SchemaFieldSchema: z.ZodType = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().default(true),
    description: z.string().default(''),
    children: z.array(SchemaFieldSchema).optional()
  })
);

export type SchemaField = z.infer<typeof SchemaFieldSchema>;

export const APISpecSchema = z.object({
  method: z.string().default('GET'),
  path: z.string(),
  summary: z.string().default(''),
  description: z.string().default(''),
  request: z
    .object({
      headers: z.record(z.string(), z.string()).default({}),
      params: z.record(z.string(), SchemaFieldSchema).default({}),
      query: z.record(z.string(), SchemaFieldSchema).default({}),
      body: SchemaFieldSchema.optional()
    })
    .optional(),
  response: z.object({
    status: z.number().default(200),
    body: SchemaFieldSchema.optional()
  }),
  errors: z.array(z.object({code: z.string(), message: z.string()})).default([])
});

export const DataModelSpecSchema = z.object({
  name: z.string(),
  tableName: z.string(),
  fields: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      nullable: z.boolean().default(false),
      defaultValue: z.string().optional(),
      description: z.string().default('')
    })
  ),
  indexes: z
    .array(z.object({fields: z.array(z.string()), unique: z.boolean().default(false)}))
    .default([])
});

export const BusinessFlowSchema = z.object({
  name: z.string(),
  steps: z.array(
    z.object({
      order: z.number(),
      actor: z.string(),
      action: z.string(),
      systemResponse: z.string(),
      alternativeFlows: z.array(z.string()).default([])
    })
  )
});

export const AcceptanceTestSchema = z.object({
  id: z.string(),
  feature: z.string(),
  scenario: z.string(),
  given: z.array(z.string()).default([]),
  when: z.string(),
  thenSteps: z.array(z.string()).default([])
});

export const ChangelogEntrySchema = z.object({
  version: z.string().default('1.0'),
  date: z.string().default(new Date().toISOString()),
  changes: z.array(z.string()).default([])
});

export const OpenSpecSchema = z.object({
  specId: z.string(),
  title: z.string(),
  version: z.string().default('1.0'),
  status: z.string().default('draft'),
  proposal: OpenSpecProposalSchema.optional(),
  apiSpecs: z.array(APISpecSchema).default([]),
  dataModels: z.array(DataModelSpecSchema).default([]),
  businessFlows: z.array(BusinessFlowSchema).default([]),
  acceptanceTests: z.array(AcceptanceTestSchema).default([]),
  changelog: z.array(ChangelogEntrySchema).default([])
});

export type OpenSpec = z.infer<typeof OpenSpecSchema>;

export interface PipelineState {
  documentId: string;
  currentLayer: PipelineLayer;
  status: Record<string, string>;
  updatedAt: string;
}
