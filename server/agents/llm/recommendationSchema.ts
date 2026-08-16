import { z } from 'zod';

// The ONLY shape an AI-originated recommendation is allowed to take. Nothing
// downstream (PolicyEngine, ActionExecutor, UI) interprets free-form LLM text
// as a command — spec §13/§29.

export const RecommendationActionSchema = z.enum([
  'CHANGE_ROUTE',
  'NOTIFY_SCHOOL',
  'FLAG_INCIDENT',
  'NO_ACTION',
]);

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

// Category label shown in the UI, distinct from the concrete `action` — kept
// to the subset this system's action set can actually produce (spec Phase 2A
// §5: "do not implement unnecessary recommendation types").
export const RecommendationTypeSchema = z.enum([
  'DELAY',
  'ROUTE_CHANGE',
  'SAFETY_ALERT',
  'PARENT_NOTIFICATION',
  'MONITORING',
]);

export const StructuredRecommendationSchema = z.object({
  type: RecommendationTypeSchema,
  title: z.string().min(1),
  problem: z.string().min(1),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  prediction: z.object({
    delayMinutes: z.number().min(0),
    probability: z.number().min(0).max(1),
  }),
  recommendation: z.object({
    action: RecommendationActionSchema,
    targetId: z.string().nullable(),
    reason: z.string().min(1),
    expectedOutcome: z.string().nullable(),
  }),
  requiresApproval: z.boolean(),
});

export type StructuredRecommendation = z.infer<typeof StructuredRecommendationSchema>;

export function parseStructuredRecommendation(raw: unknown): StructuredRecommendation {
  return StructuredRecommendationSchema.parse(raw);
}

export function safeParseStructuredRecommendation(raw: unknown) {
  return StructuredRecommendationSchema.safeParse(raw);
}
