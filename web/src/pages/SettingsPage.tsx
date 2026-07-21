import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Recommendation, Settings } from '../../../shared/types';

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 30_000 });
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    if (settings.data && form === null) setForm(settings.data);
  }, [settings.data, form]);

  const saveMut = useMutation({
    mutationFn: (patch: Settings) => api.settings.put(patch),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      setForm(data);
    },
  });

  const testMut = useMutation({ mutationFn: api.notificationsTest });

  if (!form) return <div className="empty">Loading…</div>;

  const set = <K extends keyof Settings>(key: K, v: Settings[K]) => setForm({ ...form, [key]: v });
  const toggleVerdict = (v: Recommendation) =>
    set(
      'notify_verdicts',
      form.notify_verdicts.includes(v)
        ? form.notify_verdicts.filter((x) => x !== v)
        : [...form.notify_verdicts, v],
    );

  const caps = status.data?.capabilities;

  return (
    <>
      <div className="card">
        <h3>Integrations</h3>
        <div className="form-grid">
          <div>PalletTrade MCP: {caps ? (caps.pallet_trade ? <span className="ok">configured</span> : <span className="error-text">missing token</span>) : '…'}</div>
          <div>Anthropic: {caps ? (caps.anthropic ? <span className="ok">configured</span> : <span className="error-text">missing key</span>) : '…'}</div>
          <div>eBay API: {caps ? (caps.ebay_api ? <span className="ok">configured</span> : <span className="muted">not set (Playwright/CDN fallback)</span>) : '…'}</div>
          <div>Discord: {caps ? (caps.discord ? <span className="ok">configured</span> : <span className="muted">not set</span>) : '…'}</div>
        </div>
        <p className="muted">Secrets live in .env next to package.json — restart the app after editing.</p>
      </div>

      <div className="card">
        <h3>Polling & budgets</h3>
        <div className="form-grid">
          <label className="field">
            Poll interval (min)
            <input type="number" min={1} value={form.poll_interval_min}
              onChange={(e) => set('poll_interval_min', Number(e.target.value))} />
          </label>
          <label className="field">
            Max auto-analyses / hour
            <input type="number" min={0} value={form.max_auto_per_hour}
              onChange={(e) => set('max_auto_per_hour', Number(e.target.value))} />
          </label>
          <label className="field">
            Max auto-analyses / day
            <input type="number" min={0} value={form.max_auto_per_day}
              onChange={(e) => set('max_auto_per_day', Number(e.target.value))} />
          </label>
          <label className="field">
            Daily spend cap ($)
            <input type="number" min={0} step={0.5} value={form.daily_spend_cap_usd}
              onChange={(e) => set('daily_spend_cap_usd', Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Analysis</h3>
        <div className="form-grid">
          <label className="field">
            Model
            <select value={form.model} onChange={(e) => set('model', e.target.value)}>
              <option value="claude-sonnet-5">claude-sonnet-5 (~$0.07–0.10 / analysis)</option>
              <option value="claude-haiku-4-5">claude-haiku-4-5 (~$0.02–0.03 / analysis)</option>
            </select>
          </label>
          <label className="field">
            Effort
            <select value={form.effort} onChange={(e) => set('effort', e.target.value as Settings['effort'])}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="field">
            Max images per analysis
            <input type="number" min={1} max={20} value={form.max_images}
              onChange={(e) => set('max_images', Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Notifications</h3>
        <div className="row-actions">
          <label>
            <input type="checkbox" checked={form.discord_enabled}
              onChange={(e) => set('discord_enabled', e.target.checked)} /> Discord enabled
          </label>
          {(['BUY', 'MAYBE', 'PASS'] as Recommendation[]).map((v) => (
            <label key={v}>
              <input type="checkbox" checked={form.notify_verdicts.includes(v)}
                onChange={() => toggleVerdict(v)} /> notify on {v}
            </label>
          ))}
          <button onClick={() => testMut.mutate()} disabled={testMut.isPending || !caps?.discord}>
            {testMut.isSuccess ? 'Sent ✓' : 'Send test embed'}
          </button>
          {testMut.isError && <span className="error-text">{(testMut.error as Error).message}</span>}
        </div>
      </div>

      <div className="row-actions">
        <button className="primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate(form)}>
          {saveMut.isSuccess ? 'Saved ✓' : 'Save settings'}
        </button>
        {saveMut.isError && <span className="error-text">{(saveMut.error as Error).message}</span>}
      </div>
    </>
  );
}
