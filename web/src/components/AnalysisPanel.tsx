import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AnalysisWithVerdict } from '../api';
import { VerdictBadge } from './VerdictBadge';

const ACTIVE = new Set(['queued', 'fetching_images', 'analyzing']);

function VerdictDetails({ analysis }: { analysis: AnalysisWithVerdict }) {
  const v = analysis.verdict;
  if (!v) return null;
  return (
    <>
      <div className="analysis-header">
        <span className={`badge v-${v.recommendation}`}>{v.recommendation}</span>
        <strong>
          Assessed {v.assessed_condition} — {v.claim_match} vs claim
        </strong>
        <span className="muted">confidence {v.confidence}</span>
      </div>
      <div>{v.summary}</div>
      <div className="muted" style={{ marginTop: 6 }}>
        {v.condition_rationale} · {v.confidence_reason}
      </div>
      {v.flaws.length > 0 && (
        <ul className="flaw-list">
          {v.flaws.map((f, i) => (
            <li key={i} className={`sev-${f.severity}`}>
              [{f.severity}] {f.type.replace(/_/g, ' ')} — {f.location}
              {f.photo_index > 0 ? ` (photo ${f.photo_index})` : ''}: {f.description}
            </li>
          ))}
        </ul>
      )}
      {v.red_flags.length > 0 && (
        <div className="red-flags">⚠ {v.red_flags.join(' · ')}</div>
      )}
      <div className="meta-line">
        analysis #{analysis.id} · {analysis.trig} · {analysis.model} ·{' '}
        {analysis.image_count ?? '?'} photos via {analysis.image_source ?? '?'}
        {analysis.image_source === 'primary_only' ? ' (degraded: primary photo only)' : ''} · $
        {(analysis.cost_usd ?? 0).toFixed(3)} · {analysis.input_tokens ?? 0}/{analysis.output_tokens ?? 0} tok
      </div>
    </>
  );
}

export function AnalysisPanel({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => api.dealDetail(dealId),
    refetchInterval: (query) => {
      const analyses = query.state.data?.analyses ?? [];
      return analyses.some((a) => ACTIVE.has(a.status)) ? 2500 : false;
    },
  });

  const analyzeMut = useMutation({
    mutationFn: () => api.analyze(dealId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['deal', dealId] });
      void qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });

  if (detail.isLoading) return <div className="analysis-panel muted">Loading…</div>;
  if (detail.isError || !detail.data) {
    return <div className="analysis-panel error-text">Failed to load deal detail.</div>;
  }

  const analyses = detail.data.analyses;
  const latest = analyses[0] ?? null;
  const busy = analyses.some((a) => ACTIVE.has(a.status));

  return (
    <div className="analysis-panel">
      {latest === null && <div className="muted">No analysis yet for this listing.</div>}
      {latest && ACTIVE.has(latest.status) && (
        <div className="analysis-header">
          <VerdictBadge summary={latest} />
          <span className="muted">working — this can take a minute…</span>
        </div>
      )}
      {latest && latest.status === 'done' && <VerdictDetails analysis={latest} />}
      {latest && (latest.status === 'error' || latest.status === 'refused') && (
        <div className="error-text">
          {latest.status === 'refused' ? 'Model declined to analyze this listing.' : `Analysis failed: ${latest.error}`}
        </div>
      )}
      <div className="row-actions">
        <button
          className="primary"
          disabled={busy || analyzeMut.isPending}
          onClick={() => analyzeMut.mutate()}
        >
          {busy ? 'Analyzing…' : latest ? 'Re-run analysis' : 'Perform analysis'}
        </button>
        {analyzeMut.isError && (
          <span className="error-text">{(analyzeMut.error as Error).message}</span>
        )}
        {analyses.length > 1 && (
          <span className="muted">{analyses.length} analyses total (latest shown)</span>
        )}
      </div>
    </div>
  );
}
