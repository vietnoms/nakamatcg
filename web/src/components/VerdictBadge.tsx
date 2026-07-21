import type { LatestAnalysisSummary } from '../../../shared/types';

export function VerdictBadge({ summary }: { summary: LatestAnalysisSummary | null }) {
  if (!summary) return null;
  if (summary.status === 'done' && summary.recommendation) {
    return (
      <span className={`badge v-${summary.recommendation}`} title={summary.assessed_condition ?? ''}>
        {summary.recommendation}
        {summary.confidence ? ` · ${summary.confidence[0]}` : ''}
      </span>
    );
  }
  if (summary.status === 'error' || summary.status === 'refused') {
    return <span className="badge v-error">{summary.status}</span>;
  }
  return <span className="badge v-pending">{summary.status.replace(/_/g, ' ')}…</span>;
}

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <span className={`badge tier-${tier}`}>{tier}</span>;
}
