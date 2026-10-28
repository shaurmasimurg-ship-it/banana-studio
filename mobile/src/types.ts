export type Mode = 'text' | 'image';
export type Resolution = '480P' | '768P' | '1080P';
export type Duration = 5 | 10 | 15;
export type AspectRatio = '9:16' | '16:9' | '1:1';
export type JobStatus = 'submitting' | 'queued' | 'running' | 'completed' | 'failed' | 'submission_unknown';

export interface Job {
  id: string;
  mode: Mode;
  prompt: string;
  status: JobStatus;
  duration: Duration;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  imageId?: string;
  videoUrl?: string;
  error?: string;
  warning?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  name: string;
  providerConfigured: boolean;
  keySuffix?: string;
  pricing: { rates: Record<Resolution, number>; currency: string; source: string };
  jobs: Job[];
  limits: { maxConcurrent: number; maxImageBytes: number };
}

export interface GenerationInput {
  prompt: string;
  mode: Mode;
  imageId?: string;
  duration: Duration;
  resolution: Resolution;
  aspectRatio: AspectRatio;
}

export interface GenerationAttempt {
  idempotencyKey: string;
  input: GenerationInput;
}
