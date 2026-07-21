import type { DealTier } from '../../../shared/types';
import type { FilterState } from '../../../shared/filterParams';

const TIERS: DealTier[] = ['steal', 'great-deal', 'good-deal', 'fair'];

export interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  extraActions?: React.ReactNode;
}

export function FilterBar({ value, onChange, extraActions }: FilterBarProps) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) =>
    onChange({ ...value, [key]: v });

  const numInput = (key: 'min_price' | 'max_price' | 'min_discount' | 'min_grade' | 'ends_within_h', label: string, placeholder: string) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={value[key] ?? ''}
        placeholder={placeholder}
        style={{ width: 90 }}
        onChange={(e) => {
          const next = { ...value };
          if (e.target.value === '') delete next[key];
          else next[key] = Number(e.target.value);
          onChange(next);
        }}
      />
    </label>
  );

  return (
    <div className="filter-bar">
      <label className="field">
        Tier
        <div className="tier-chips">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${value.tiers.includes(t) ? ' on' : ''}`}
              onClick={() =>
                set(
                  'tiers',
                  value.tiers.includes(t)
                    ? value.tiers.filter((x) => x !== t)
                    : [...value.tiers, t],
                )
              }
            >
              {t}
            </button>
          ))}
        </div>
      </label>
      {numInput('min_discount', 'Min % off', 'e.g. 35')}
      {numInput('min_price', 'Min $', '0')}
      {numInput('max_price', 'Max $', '∞')}
      <label className="field">
        Grader
        <input
          value={value.grader ?? ''}
          placeholder="PSA / BGS / CGC"
          style={{ width: 100 }}
          onChange={(e) => {
            const next = { ...value };
            if (e.target.value === '') delete next.grader;
            else next.grader = e.target.value;
            onChange(next);
          }}
        />
      </label>
      {numInput('min_grade', 'Min grade', 'e.g. 9')}
      <label className="field">
        Listing
        <select value={value.listing} onChange={(e) => set('listing', e.target.value as FilterState['listing'])}>
          <option value="all">All</option>
          <option value="auction">Auctions</option>
          <option value="bin">Buy It Now</option>
        </select>
      </label>
      {numInput('ends_within_h', 'Ends in (h)', 'any')}
      <label className="field">
        Source
        <select value={value.source} onChange={(e) => set('source', e.target.value as FilterState['source'])}>
          <option value="all">All</option>
          <option value="ebay">eBay</option>
          <option value="wallet">Wallet</option>
        </select>
      </label>
      <label className="field">
        Sort
        <select value={value.sort} onChange={(e) => set('sort', e.target.value as FilterState['sort'])}>
          <option value="discount">Deepest discount</option>
          <option value="ends_at">Ending soonest</option>
          <option value="price">Cheapest</option>
        </select>
      </label>
      {extraActions}
    </div>
  );
}
