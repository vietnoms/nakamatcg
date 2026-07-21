// zod/v4 API (available from zod 3.25+): the Anthropic SDK's zodOutputFormat
// helper requires a v4-core schema. The rest of the codebase uses classic zod.
import { z } from 'zod/v4';

// Single source of truth for the analysis verdict. The zod schema drives:
//  - the structured-output JSON schema sent to the Claude API (via zodOutputFormat)
//  - server-side re-validation of the model's output
//  - the TS type used by the UI

export const FLAW_TYPES = [
  'scratch',
  'whitening',
  'edge_wear',
  'corner_wear',
  'crease',
  'dent',
  'print_line',
  'stain',
  'curl',
  'scuff',
  'surface_wear',
  'cloudiness',
  'other',
] as const;

export const FlawSchema = z.object({
  type: z.enum(FLAW_TYPES),
  severity: z.enum(['minor', 'moderate', 'severe']),
  location: z.string().describe('Where on the card, e.g. "back bottom edge"'),
  photo_index: z
    .number()
    .int()
    .describe('1-based photo number where the flaw is visible; -1 if not photo-specific'),
  description: z.string(),
});

export const VerdictSchema = z.object({
  assessed_condition: z
    .enum(['NM', 'LP', 'MP', 'HP', 'DMG', 'SLAB_VERIFIED', 'UNKNOWN'])
    .describe('Condition assessed from the photos; SLAB_VERIFIED when a graded slab is confirmed'),
  condition_rationale: z.string().describe('Short justification for the assessed condition'),
  claim_match: z
    .enum(['MATCHES', 'WORSE', 'BETTER', 'UNVERIFIABLE'])
    .describe('How the assessed condition compares to what the listing claims'),
  flaws: z.array(FlawSchema),
  red_flags: z
    .array(z.string())
    .describe('Listing-level warning signs: stock photos, mismatched images, seller issues, etc.'),
  recommendation: z.enum(['BUY', 'MAYBE', 'PASS']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  confidence_reason: z.string(),
  summary: z.string().describe('2-3 sentence overall summary for a human buyer'),
});

export type Flaw = z.infer<typeof FlawSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
