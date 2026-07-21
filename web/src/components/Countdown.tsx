import { useEffect, useState } from 'react';

function fmt(msLeft: number): string {
  if (msLeft <= 0) return 'ended';
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

export function Countdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return <span className="muted">BIN</span>;
  const msLeft = new Date(endsAt).getTime() - now;
  const urgent = msLeft > 0 && msLeft < 2 * 3_600_000;
  return <span className={`countdown${urgent ? ' urgent' : ''}`}>{fmt(msLeft)}</span>;
}
