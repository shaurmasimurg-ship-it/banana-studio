import type { GenerationInput, Job, Resolution } from '../types.ts';

export const MAX_PROMPT_LENGTH = 5000;
export const DEFAULT_RATES: Readonly<Record<Resolution, number>> = { '480P': 0.05, '768P': 0.08, '1080P': 0.16 };

export function estimateCost(resolution: Resolution, duration: number, rates?: Partial<Record<Resolution, number>>): number {
  const configured = rates?.[resolution];
  const rate = typeof configured === 'number' && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RATES[resolution];
  return Math.round(rate * duration * 10000) / 10000;
}

export const formatCost = (amount: number): string => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(amount);

export function validateGeneration(input: GenerationInput): string | null {
  if (!input.prompt.trim()) return 'Videonda ne görmek istediğini yaz.';
  if (input.prompt.trim().length > MAX_PROMPT_LENGTH) return `Açıklama en fazla ${MAX_PROMPT_LENGTH} karakter olabilir.`;
  if (input.mode !== 'text' && input.mode !== 'image') return 'Geçerli bir video türü seç.';
  if (input.mode === 'image' && !input.imageId) return 'Önce bir başlangıç fotoğrafı yükle.';
  if (![5, 10, 15].includes(input.duration)) return 'Video süresini 5, 10 veya 15 saniye olarak seç.';
  if (!['480P', '768P', '1080P'].includes(input.resolution)) return 'Geçerli bir çözünürlük seç.';
  if (!['9:16', '16:9', '1:1'].includes(input.aspectRatio)) return 'Geçerli bir kadraj seç.';
  return null;
}

export const isPollingJob = (job: Job): boolean => ['submitting', 'queued', 'running'].includes(job.status);
export const isUnfinishedJob = (job: Job): boolean => isPollingJob(job) || job.status === 'submission_unknown';

export function mergeJob(jobs: Job[], incoming: Job): Job[] {
  const existing = jobs.find(job => job.id === incoming.id);
  if (existing && Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt)) return jobs;
  return [incoming, ...jobs.filter(job => job.id !== incoming.id)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function safeMediaUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
