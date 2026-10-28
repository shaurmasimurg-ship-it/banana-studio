import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_STORAGE_KEY, consumeAccess, parseAccessFragment, validAccessCode } from '../src/lib/auth.ts';
import { normalizeApiBase } from '../src/lib/api.ts';
import { estimateCost, isPollingJob, isUnfinishedJob, mergeJob, safeMediaUrl, validateGeneration } from '../src/lib/generation.ts';
import type { GenerationInput, Job } from '../src/types.ts';

const access = 'a'.repeat(64);
const input: GenerationInput = { prompt: 'Bir kıyı sahnesi', mode: 'text', duration: 5, resolution: '480P', aspectRatio: '9:16' };
const job: Job = { ...input, id: 'job-one', status: 'queued', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z' };

test('owner access accepts exactly one 64-character lowercase hexadecimal code', () => {
  assert.equal(validAccessCode(access), true);
  for (const invalid of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ` ${access}`, null]) assert.equal(validAccessCode(invalid), false);
  assert.deepEqual(parseAccessFragment(`#access=${access}`), { hasAccess: true, token: access });
  assert.deepEqual(parseAccessFragment(`#access=${access}&access=${access}`), { hasAccess: true, token: null });
  assert.deepEqual(parseAccessFragment('#videos'), { hasAccess: false, token: null });
});

test('access fragment is removed before persisting the code and malformed fragments are also removed', () => {
  const operations: string[] = [];
  const browser = {
    location: { hash: `#access=${access}`, pathname: '/', search: '?view=studio' },
    history: { state: null, replaceState: (_state: unknown, _title: string, url?: string | URL | null) => operations.push(`replace:${url}`) },
    localStorage: { getItem: () => null, setItem: (key: string, value: string) => operations.push(`store:${key}:${value.length}`), removeItem: () => {} },
  };
  assert.deepEqual(consumeAccess(browser), { token: access, invalidLink: false });
  assert.deepEqual(operations, ['replace:/?view=studio', `store:${ACCESS_STORAGE_KEY}:64`]);
  operations.length = 0;
  browser.location.hash = '#access=invalid';
  assert.deepEqual(consumeAccess(browser), { token: null, invalidLink: true });
  assert.deepEqual(operations, ['replace:/?view=studio']);
});

test('private browsing can use a valid link even when localStorage is unavailable', () => {
  const browser = {
    location: { hash: `#access=${access}`, pathname: '/', search: '' },
    history: { state: null, replaceState: () => {} },
    localStorage: { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); }, removeItem: () => {} },
  };
  assert.equal(consumeAccess(browser).token, access);
  browser.location.hash = '';
  assert.deepEqual(consumeAccess(browser), { token: null, invalidLink: false });
});

test('cost estimates use server rates, reject unusable rates and avoid floating point noise', () => {
  assert.equal(estimateCost('480P', 5), 0.25);
  assert.equal(estimateCost('768P', 10), 0.8);
  assert.equal(estimateCost('1080P', 15), 2.4);
  assert.equal(estimateCost('480P', 5, { '480P': 0.0325 }), 0.1625);
  for (const invalid of [NaN, Infinity, -1, 0]) assert.equal(estimateCost('480P', 5, { '480P': invalid }), 0.25);
});

test('generation validation prevents empty prompts, missing uploads, and unsupported paid options', () => {
  assert.equal(validateGeneration(input), null);
  assert.equal(validateGeneration({ ...input, mode: 'image', imageId: 'image-one' }), null);
  for (const bad of [{ ...input, prompt: '  ' }, { ...input, prompt: 'x'.repeat(5001) }, { ...input, mode: 'image' }, { ...input, duration: 60 }, { ...input, resolution: '8K' }, { ...input, aspectRatio: 'auto' }]) assert.ok(validateGeneration(bad as GenerationInput));
});

test('unknown submissions remain unfinished without entering automatic polling or submission', () => {
  const unknown = { ...job, status: 'submission_unknown' as const };
  assert.equal(isPollingJob(unknown), false);
  assert.equal(isUnfinishedJob(unknown), true);
  assert.equal(isPollingJob(job), true);
  assert.equal(isUnfinishedJob({ ...job, status: 'completed' }), false);
});

test('out-of-order polling cannot overwrite a newer completed job or duplicate a gallery entry', () => {
  const completed = { ...job, status: 'completed' as const, updatedAt: '2026-01-01T10:02:00Z' };
  assert.deepEqual(mergeJob([completed], job), [completed]);
  assert.deepEqual(mergeJob([job], completed), [completed]);
  assert.equal(mergeJob([completed], completed).length, 1);
});

test('API and media URLs reject credential-bearing and unsafe protocols', () => {
  assert.equal(normalizeApiBase('https://example.test/functions/v1/studio/'), 'https://example.test/functions/v1/studio');
  assert.equal(normalizeApiBase('http://localhost:3000'), 'http://localhost:3000');
  for (const invalid of ['http://remote.test', 'https://user:password@example.test', 'https://example.test?access=code', 'javascript:alert(1)', '']) assert.equal(normalizeApiBase(invalid), null);
  assert.equal(safeMediaUrl('https://example.test/video.mp4?signature=example'), 'https://example.test/video.mp4?signature=example');
  assert.equal(safeMediaUrl('javascript:alert(1)'), undefined);
  assert.equal(safeMediaUrl('https://user:password@example.test/video.mp4'), undefined);
});
