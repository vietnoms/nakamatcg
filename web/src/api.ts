import type {
  AnalysisRow,
  DealRow,
  DealWithLatestAnalysis,
  QueueState,
  RuleCriteria,
  Settings,
  StatusInfo,
} from '../../shared/types';
import type { Verdict } from '../../shared/verdict';

export interface DealsResponse {
  deals: DealWithLatestAnalysis[];
  total_matching: number;
  last_poll_at: string | null;
}

export interface AnalysisWithVerdict extends AnalysisRow {
  verdict: Verdict | null;
}

export interface DealDetail {
  deal: DealRow;
  analyses: AnalysisWithVerdict[];
}

export interface RuleDto {
  id: number;
  name: string;
  enabled: number;
  notify: number;
  criteria: RuleCriteria;
  created_at: string;
  updated_at: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const api = {
  deals: (qs: string) => req<DealsResponse>(`/api/deals?${qs}`),
  dealDetail: (id: string) => req<DealDetail>(`/api/deals/${encodeURIComponent(id)}`),
  analyze: (dealId: string) =>
    req<{ analysis_id: number }>(`/api/deals/${encodeURIComponent(dealId)}/analyze`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  analysis: (id: number) => req<AnalysisWithVerdict>(`/api/analyses/${id}`),
  queue: () => req<QueueState & { paused: boolean }>('/api/queue'),
  status: () => req<StatusInfo>('/api/status'),
  pollNow: () => req<{ ok: boolean }>('/api/poll', { method: 'POST' }),
  rules: {
    list: () => req<RuleDto[]>('/api/rules'),
    create: (body: { name: string; enabled: boolean; notify: boolean; criteria: RuleCriteria }) =>
      req<RuleDto>('/api/rules', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, patch: Partial<{ name: string; enabled: boolean; notify: boolean; criteria: RuleCriteria }>) =>
      req<RuleDto>(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/rules/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => req<Settings>('/api/settings'),
    put: (patch: Partial<Settings>) =>
      req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  },
  notificationsTest: () => req<{ ok: boolean }>('/api/notifications/test', { method: 'POST' }),
};
