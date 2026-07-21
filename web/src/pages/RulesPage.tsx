import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type RuleDto } from '../api';
import type { RuleCriteria } from '../../../shared/types';

const EMPTY_CRITERIA: RuleCriteria = {};

function CriteriaSummary({ c }: { c: RuleCriteria }) {
  const bits: string[] = [];
  if (c.source && c.source !== 'all') bits.push(c.source);
  if (c.tiers?.length) bits.push(c.tiers.join('/'));
  if (c.min_discount_pct !== undefined) bits.push(`≥${c.min_discount_pct}% off`);
  if (c.min_price !== undefined) bits.push(`≥$${c.min_price}`);
  if (c.max_price !== undefined) bits.push(`≤$${c.max_price}`);
  if (c.grader) bits.push(`${c.grader}${c.min_grade !== undefined ? ` ≥${c.min_grade}` : ''}`);
  else if (c.min_grade !== undefined) bits.push(`grade ≥${c.min_grade}`);
  if (c.auction_only) bits.push('auctions');
  if (c.bin_only) bits.push('BIN');
  if (c.ends_within_h !== undefined) bits.push(`ends <${c.ends_within_h}h`);
  if (c.title_includes?.length) bits.push(`title~"${c.title_includes.join('|')}"`);
  return <span className="muted">{bits.length ? bits.join(' · ') : 'matches everything'}</span>;
}

interface FormState {
  id: number | null;
  name: string;
  enabled: boolean;
  notify: boolean;
  criteria: RuleCriteria;
}

function RuleForm({ initial, onDone }: { initial: FormState; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const c = form.criteria;

  const setC = (patch: Partial<RuleCriteria>) => {
    const next = { ...c, ...patch };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete (next as Record<string, unknown>)[k];
      }
    }
    setForm({ ...form, criteria: next });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      form.id === null
        ? api.rules.create({ name: form.name, enabled: form.enabled, notify: form.notify, criteria: c })
        : api.rules.update(form.id, { name: form.name, enabled: form.enabled, notify: form.notify, criteria: c }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rules'] });
      onDone();
    },
  });

  const numField = (key: 'min_discount_pct' | 'min_price' | 'max_price' | 'min_grade' | 'ends_within_h', label: string) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={c[key] ?? ''}
        onChange={(e) => setC({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="card">
      <h3>{form.id === null ? 'New rule' : `Edit rule #${form.id}`}</h3>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          Source
          <select
            value={c.source ?? 'all'}
            onChange={(e) => setC({ source: e.target.value === 'all' ? undefined : (e.target.value as 'ebay' | 'wallet') })}
          >
            <option value="all">All</option>
            <option value="ebay">eBay</option>
            <option value="wallet">Wallet</option>
          </select>
        </label>
        <label className="field">
          Tiers (comma-sep)
          <input
            value={c.tiers?.join(',') ?? ''}
            placeholder="steal,great-deal"
            onChange={(e) =>
              setC({
                tiers: e.target.value
                  ? (e.target.value.split(',').map((s) => s.trim()) as RuleCriteria['tiers'])
                  : undefined,
              })
            }
          />
        </label>
        {numField('min_discount_pct', 'Min % off')}
        {numField('min_price', 'Min $')}
        {numField('max_price', 'Max $')}
        <label className="field">
          Grader
          <input value={c.grader ?? ''} onChange={(e) => setC({ grader: e.target.value || undefined })} />
        </label>
        {numField('min_grade', 'Min grade')}
        <label className="field">
          Listing type
          <select
            value={c.auction_only ? 'auction' : c.bin_only ? 'bin' : 'all'}
            onChange={(e) =>
              setC({
                auction_only: e.target.value === 'auction' ? true : undefined,
                bin_only: e.target.value === 'bin' ? true : undefined,
              })
            }
          >
            <option value="all">All</option>
            <option value="auction">Auctions only</option>
            <option value="bin">BIN only</option>
          </select>
        </label>
        {numField('ends_within_h', 'Ends within (h)')}
        <label className="field">
          Title contains (comma-sep, any-of)
          <input
            value={c.title_includes?.join(',') ?? ''}
            placeholder="charizard,umbreon"
            onChange={(e) =>
              setC({
                title_includes: e.target.value
                  ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  : undefined,
              })
            }
          />
        </label>
      </div>
      <div className="row-actions">
        <label>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />{' '}
          Enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.notify}
            onChange={(e) => setForm({ ...form, notify: e.target.checked })}
          />{' '}
          Discord notify
        </label>
        <button className="primary" disabled={!form.name || saveMut.isPending} onClick={() => saveMut.mutate()}>
          Save
        </button>
        <button onClick={onDone}>Cancel</button>
        {saveMut.isError && <span className="error-text">{(saveMut.error as Error).message}</span>}
      </div>
    </div>
  );
}

export function RulesPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.rules.list });
  const [editing, setEditing] = useState<FormState | null>(null);

  const toggleMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { enabled?: boolean; notify?: boolean } }) =>
      api.rules.update(id, patch),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['rules'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.rules.remove(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const startEdit = (r: RuleDto) =>
    setEditing({ id: r.id, name: r.name, enabled: r.enabled === 1, notify: r.notify === 1, criteria: r.criteria });

  return (
    <>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button
          className="primary"
          onClick={() =>
            setEditing({ id: null, name: '', enabled: true, notify: true, criteria: EMPTY_CRITERIA })
          }
        >
          + New rule
        </button>
        <span className="muted">
          Rules auto-analyze NEW listings that match (budget-capped, never re-analyzes a listing).
        </span>
      </div>
      {editing && <RuleForm key={editing.id ?? 'new'} initial={editing} onDone={() => setEditing(null)} />}
      {rules.data?.length === 0 && <div className="empty">No rules yet.</div>}
      {rules.data?.map((r) => (
        <div className="card" key={r.id}>
          <div className="analysis-header">
            <strong>{r.name}</strong>
            <CriteriaSummary c={r.criteria} />
          </div>
          <div className="row-actions">
            <label>
              <input
                type="checkbox"
                checked={r.enabled === 1}
                onChange={(e) => toggleMut.mutate({ id: r.id, patch: { enabled: e.target.checked } })}
              />{' '}
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={r.notify === 1}
                onChange={(e) => toggleMut.mutate({ id: r.id, patch: { notify: e.target.checked } })}
              />{' '}
              Notify
            </label>
            <button onClick={() => startEdit(r)}>Edit</button>
            <button className="danger" onClick={() => deleteMut.mutate(r.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
