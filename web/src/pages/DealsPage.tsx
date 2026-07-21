import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { FilterBar } from '../components/FilterBar';
import { Countdown } from '../components/Countdown';
import { TierBadge, VerdictBadge } from '../components/VerdictBadge';
import { AnalysisPanel } from '../components/AnalysisPanel';
import {
  filtersToApiQuery,
  filtersToParams,
  filtersToRuleCriteria,
  paramsToFilters,
} from '../../../shared/filterParams';
import type { DealRow, RuleCriteria } from '../../../shared/types';

function thumbUrl(deal: DealRow): string | null {
  return deal.primary_image_hash
    ? `https://i.ebayimg.com/images/g/${deal.primary_image_hash}/s-l140.jpg`
    : null;
}

function money(v: number | null, currency: string): string {
  if (v == null) return '—';
  return `${currency === 'USD' ? '$' : `${currency} `}${v.toFixed(2)}`;
}

export function DealsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => paramsToFilters(searchParams), [searchParams]);
  const apiQuery = useMemo(() => filtersToApiQuery(filters), [filters]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const deals = useQuery({
    queryKey: ['deals', apiQuery],
    queryFn: () => api.deals(apiQuery),
    refetchInterval: 60_000,
  });

  const saveRuleMut = useMutation({
    mutationFn: () =>
      api.rules.create({
        name: `From filters ${new Date().toLocaleString()}`,
        enabled: true,
        notify: true,
        criteria: filtersToRuleCriteria(filters) as RuleCriteria,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  return (
    <>
      <FilterBar
        value={filters}
        onChange={(next) => setSearchParams(filtersToParams(next), { replace: true })}
        extraActions={
          <button onClick={() => saveRuleMut.mutate()} disabled={saveRuleMut.isPending}>
            {saveRuleMut.isSuccess ? 'Saved ✓' : 'Save filters as rule'}
          </button>
        }
      />
      {deals.isLoading && <div className="empty">Loading deals…</div>}
      {deals.isError && (
        <div className="empty error-text">Failed to load deals: {(deals.error as Error).message}</div>
      )}
      {deals.data && deals.data.deals.length === 0 && (
        <div className="empty">
          No deals in the local cache match these filters.
          <br />
          <span className="muted">
            The poller fills the cache — check the status bar, or hit “Poll now”.
          </span>
        </div>
      )}
      {deals.data && deals.data.deals.length > 0 && (
        <table className="deals">
          <thead>
            <tr>
              <th></th>
              <th>Listing</th>
              <th>Price</th>
              <th>Discount</th>
              <th>Tier</th>
              <th>Ends</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {deals.data.deals.map(({ deal, latest_analysis }) => (
              <Fragment key={deal.id}>
                <tr
                  className="deal-row"
                  onClick={() => setExpandedId(expandedId === deal.id ? null : deal.id)}
                >
                  <td>
                    {thumbUrl(deal) ? (
                      <img className="thumb" src={thumbUrl(deal)!} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb" />
                    )}
                  </td>
                  <td>
                    <div className="deal-title" title={deal.title}>
                      {deal.title}
                    </div>
                    <div className="deal-sub">
                      {[deal.card_name, deal.set_name, deal.grader ? `${deal.grader} ${deal.grade ?? ''}` : 'raw']
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      ·{' '}
                      <a
                        href={deal.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        open ↗
                      </a>
                    </div>
                  </td>
                  <td>
                    <div className="price-main">{money(deal.price_total, deal.currency)}</div>
                    <div className="price-est">est. {money(deal.market_estimate, deal.currency)}</div>
                  </td>
                  <td>
                    {deal.percent_below_market != null ? (
                      <span className="discount">{deal.percent_below_market}%</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <TierBadge tier={deal.deal_tier} />
                  </td>
                  <td>
                    <Countdown endsAt={deal.ends_at} />
                    {deal.bid_count != null && (
                      <div className="deal-sub">{deal.bid_count} bids</div>
                    )}
                  </td>
                  <td>
                    <VerdictBadge summary={latest_analysis} />
                  </td>
                </tr>
                {expandedId === deal.id && (
                  <tr>
                    <td colSpan={7}>
                      <AnalysisPanel dealId={deal.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {deals.data && (
        <p className="muted" style={{ marginTop: 10 }}>
          {deals.data.deals.length} shown of {deals.data.total_matching} matching · cache updated{' '}
          {deals.data.last_poll_at ? new Date(deals.data.last_poll_at).toLocaleTimeString() : 'never'}
        </p>
      )}
    </>
  );
}
