import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function QueueStatusBar() {
  const qc = useQueryClient();
  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: api.queue,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.counts.queued + d.counts.running > 0 ? 2000 : 30_000;
    },
  });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 30_000 });

  const pollMut = useMutation({
    mutationFn: api.pollNow,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['status'] });
      void qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });

  const q = queue.data;
  const s = status.data;

  return (
    <footer className="status-bar">
      <span>
        MCP:{' '}
        {s ? (
          s.mcp_ok ? (
            <span className="ok">ok</span>
          ) : (
            <span className="bad" title={s.mcp_error ?? ''}>
              {s.capabilities.pallet_trade ? 'error' : 'not configured'}
            </span>
          )
        ) : (
          '…'
        )}
      </span>
      <span>
        Queue:{' '}
        {q ? (
          <>
            {q.counts.queued} queued · {q.counts.running} running
            {q.paused && <span className="bad"> · PAUSED (auth error)</span>}
          </>
        ) : (
          '…'
        )}
      </span>
      <span>
        Budget:{' '}
        {q
          ? `${q.budget.auto_used_hour}/${q.budget.max_per_hour} hr · ${q.budget.auto_used_day}/${q.budget.max_per_day} day · $${q.budget.spend_today_usd.toFixed(2)}/$${q.budget.daily_cap_usd} spend`
          : '…'}
      </span>
      <span>
        Last poll:{' '}
        {s?.last_poll
          ? s.last_poll.error
            ? <span className="warn" title={s.last_poll.error}>failed</span>
            : new Date(s.last_poll.finished_at ?? s.last_poll.started_at).toLocaleTimeString()
          : 'never'}
      </span>
      <button
        onClick={() => pollMut.mutate()}
        disabled={pollMut.isPending || !s?.capabilities.pallet_trade}
      >
        {pollMut.isPending ? 'Polling…' : 'Poll now'}
      </button>
      <span className="muted" style={{ marginLeft: 'auto' }}>
        notify-only — this app never buys or bids
      </span>
    </footer>
  );
}
