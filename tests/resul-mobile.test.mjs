import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessToken, sha256, queueUrl, mediaUrl, validateJob, falInput,
  sealProvider, openProvider, publicJob, imageType, readBounded, createHandler,
} from '../supabase/functions/resul-video/core.ts';

const id = '16a4d28b-e3d1-4421-a60b-dd84bc0daf65';
const token = 'ab'.repeat(32);
const input = { idempotencyKey: id, prompt: '  Sahne  ', mode: 'text', duration: 5, resolution: '480P', aspectRatio: '9:16' };

test('mobile: rejects public, publishable-key and malformed credentials', async () => {
  for (const header of [null, '', 'Bearer anything', `Bearer ${token} extra`, `Basic ${token}`]) {
    assert.throws(() => accessToken(header));
  }
  assert.equal(accessToken(`Bearer ${token}`), token);
  assert.equal((await sha256(token)).length, 64);
  let contactedDatabase = false;
  const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'server-only',
    fetch: async () => { contactedDatabase = true; throw new Error(); } });
  const response = await handler(new Request('https://example.supabase.co/functions/v1/resul-video/workspace'));
  assert.equal(response.status, 401);
  assert.equal(contactedDatabase, false);
});

test('mobile: paid requests have fixed model inputs and require owned photo references', () => {
  const validated = validateJob(input);
  assert.equal(validated.prompt, 'Sahne');
  assert.deepEqual(falInput(validated), { prompt: 'Sahne', prompt_expansion_mode: 'disabled', duration: 5,
    resolution: '480P', enable_safety_checker: true, sync_mode: false, aspect_ratio: '9:16' });
  for (const patch of [{ duration: 60 }, { resolution: '4K' }, { prompt: ' ' }, { mode: 'image' }, { aspectRatio: 'random' }]) {
    assert.throws(() => validateJob({ ...input, ...patch }));
  }
  const imageJob = validateJob({ ...input, mode: 'image', imageId: id });
  assert.throws(() => falInput(imageJob));
  assert.equal(falInput(imageJob, 'https://example.supabase.co/signed-image').aspect_ratio, undefined);
});

test('mobile: provider credential cannot be sent to arbitrary hosts, redirects or another task', () => {
  const good = `https://queue.fal.run/minimax/h3-max/requests/${id}/status`;
  assert.equal(queueUrl(good, id), good);
  for (const bad of [good.replace('queue.fal.run', 'queue.fal.run.attacker.example'),
    good.replace('https:', 'http:'), good.replace('/requests/', '/text-to-video/requests/'),
    good.replace(id, '00000000-0000-4000-8000-000000000000'), good.replace('https://', 'https://attacker@')]) {
    assert.throws(() => queueUrl(bad, id));
  }
  assert.equal(mediaUrl('https://v3b.fal.media/files/result.mp4'), 'https://v3b.fal.media/files/result.mp4');
  for (const bad of ['https://127.0.0.1/a', 'https://fal.media.attacker.example/a', 'http://fal.media/a', 'https://a@fal.media/a']) {
    assert.throws(() => mediaUrl(bad));
  }
});

test('mobile: fal keys are authenticated-encrypted and bound to their workspace', async () => {
  const sealed = await sealProvider('test-provider-key-not-real', 'test-runtime-secret', id);
  assert.ok(!sealed.cipher.includes('provider'));
  assert.equal(await openProvider(sealed.cipher, sealed.iv, 'test-runtime-secret', id), 'test-provider-key-not-real');
  await assert.rejects(() => openProvider(sealed.cipher, sealed.iv, 'different-runtime-secret', id));
  await assert.rejects(() => openProvider(sealed.cipher, sealed.iv, 'test-runtime-secret', 'another-workspace'));
  const changed = `${sealed.cipher[0] === 'A' ? 'B' : 'A'}${sealed.cipher.slice(1)}`;
  await assert.rejects(() => openProvider(changed, sealed.iv, 'test-runtime-secret', id));
});

test('mobile: public job responses omit backend credentials and queue internals', () => {
  const output = publicJob({ id, status: 'queued', provider_cipher: 'secret', access_hash: 'digest',
    status_url: 'provider-private-url', response_url: 'provider-private-url', provider_request_id: 'request',
    workspace_id: 'private', prompt: 'mine', resolution: '480P' });
  const encoded = JSON.stringify(output);
  for (const value of ['secret', 'digest', 'provider-private-url', 'workspace_id', 'provider_request_id']) assert.ok(!encoded.includes(value));
});

test('mobile: rejects disguised files and oversized streaming bodies', async () => {
  assert.deepEqual(imageType(new Uint8Array([255, 216, 255, 0]), 'image/jpeg'), { mime: 'image/jpeg', extension: 'jpg' });
  assert.throws(() => imageType(new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg'));
  assert.throws(() => imageType(new Uint8Array([255, 216, 255]), 'image/png'));
  await assert.rejects(() => readBounded(new Response('123456789').body, 8));
});

test('mobile: idempotent retry never submits another paid generation', async () => {
  const sealed = await sealProvider('provider-key-for-test', 'runtime', id);
  let paidCalls = 0;
  const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'runtime',
    fetch: async (url, options) => {
      if (String(url).startsWith('https://queue.fal.run')) { paidCalls++; throw new Error('must not submit'); }
      const body = JSON.parse(options.body);
      if (body.p_action === 'context') return Response.json({ workspace: { id, provider_cipher: sealed.cipher, provider_iv: sealed.iv }, jobs: [] });
      if (body.p_action === 'job_reserve') return Response.json({ created: false, job: { id, status: 'queued', prompt: 'existing' } });
      throw new Error(`unexpected action ${body.p_action}`);
    } });
  const response = await handler(new Request('https://example.supabase.co/functions/v1/resul-video/jobs', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.id, id);
  assert.equal(paidCalls, 0);
});

test('mobile: ambiguous submission is recorded without an automatic paid retry', async () => {
  const sealed = await sealProvider('provider-key-for-test', 'runtime', id);
  let paidCalls = 0;
  let savedStatus;
  const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'runtime',
    fetch: async (url, options) => {
      if (String(url).startsWith('https://queue.fal.run')) { paidCalls++; throw new Error('network timeout after acceptance'); }
      const body = JSON.parse(options.body);
      if (body.p_action === 'context') return Response.json({ workspace: { id, provider_cipher: sealed.cipher, provider_iv: sealed.iv }, jobs: [] });
      if (body.p_action === 'job_reserve') return Response.json({ created: true, job: { id, status: 'submitting' } });
      if (body.p_action === 'job_update') { savedStatus = body.p_payload.status; return Response.json({ id, ...body.p_payload }); }
      throw new Error('unexpected');
    } });
  const response = await handler(new Request('https://example.supabase.co/functions/v1/resul-video/jobs', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  assert.equal(savedStatus, 'submission_unknown');
  assert.equal(paidCalls, 1);
});

test('mobile: reflected provider secrets never enter saved or public errors, including at a truncation boundary', async () => {
  const providerKey = 'SYNTHETIC_SECRET_123456789012345678901234567890';
  const reflectedError = 'x'.repeat(280) + providerKey;
  const sealed = await sealProvider(providerKey, 'runtime', id);
  const base = `https://queue.fal.run/minimax/h3-max/requests/${id}`;

  for (const stage of ['submit', 'status', 'result']) {
    const updates = [];
    const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'runtime',
      fetch: async (url, options) => {
        if (String(url).startsWith('https://queue.fal.run/')) {
          if (stage === 'submit') return Response.json({ error: reflectedError }, { status: 400 });
          if (String(url) === `${base}/status`) {
            return Response.json({ status: 'COMPLETED', ...(stage === 'status' ? { error: reflectedError } : {}) });
          }
          if (stage === 'result' && String(url) === base) return Response.json({ error: reflectedError }, { status: 422 });
          throw new Error('Unexpected provider request in secret-reflection test');
        }
        const body = JSON.parse(options.body);
        if (body.p_action === 'context') return Response.json({ workspace: { id, provider_cipher: sealed.cipher, provider_iv: sealed.iv }, jobs: [] });
        if (body.p_action === 'job_reserve') return Response.json({ created: true, job: { id, status: 'submitting' } });
        if (body.p_action === 'job_get') return Response.json({ id, status: 'running', provider_request_id: id,
          status_url: `${base}/status`, response_url: base });
        if (body.p_action === 'job_update') {
          updates.push(body.p_payload);
          return Response.json({ id, ...body.p_payload });
        }
        throw new Error(`Unexpected database action ${body.p_action}`);
      } });
    const request = stage === 'submit'
      ? new Request('https://example.supabase.co/functions/v1/resul-video/jobs', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      : new Request(`https://example.supabase.co/functions/v1/resul-video/jobs/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const response = await handler(request);
    const data = await response.json();
    assert.equal(response.status, 200, stage);
    assert.equal(data.job.status, 'failed', stage);
    assert.equal(updates.length, 1, stage);
    assert.equal(typeof updates[0].error, 'string', stage);
    assert.ok(updates[0].error.length > 0, stage);
    assert.equal(data.job.error, updates[0].error, stage);
    for (const errorText of [updates[0].error, data.job.error]) {
      assert.ok(!errorText.includes(providerKey), stage);
      assert.ok(!errorText.includes(providerKey.slice(0, 16)), `${stage}: partial key leaked`);
      assert.ok(!errorText.includes('x'.repeat(50)), `${stage}: raw provider text was relayed`);
    }
  }
});

for (const lookupStatus of [402, 404]) {
  test(`mobile: result lookup ${lookupStatus} preserves the accepted job and resumes polling without paid resubmission`, async () => {
    const sealed = await sealProvider('provider-key-for-test', 'runtime', id);
    const base = `https://queue.fal.run/minimax/h3-max/requests/${id}`;
    const row = { id, status: 'running', provider_request_id: id, status_url: `${base}/status`, response_url: base };
    const updates = [];
    let resultReads = 0;
    let paidCalls = 0;
    let showProgress = false;
    const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'runtime',
      fetch: async (url, options) => {
        if (String(url).startsWith('https://queue.fal.run/')) {
          if (options.method === 'POST') { paidCalls++; throw new Error('A lookup must not submit a generation'); }
          if (String(url) === `${base}/status`) return Response.json({ status: showProgress ? 'IN_PROGRESS' : 'COMPLETED' });
          if (String(url) === base) { resultReads++; return Response.json({ error: 'Temporary lookup failure' }, { status: lookupStatus }); }
          throw new Error('Unexpected provider lookup URL');
        }
        const body = JSON.parse(options.body);
        if (body.p_action === 'context') return Response.json({ workspace: { id, provider_cipher: sealed.cipher, provider_iv: sealed.iv }, jobs: [] });
        if (body.p_action === 'job_get') return Response.json(row);
        if (body.p_action === 'job_update') {
          updates.push(body.p_payload);
          Object.assign(row, body.p_payload);
          return Response.json(row);
        }
        throw new Error(`Unexpected database action ${body.p_action}`);
      } });
    const makeRequest = () => new Request(`https://example.supabase.co/functions/v1/resul-video/jobs/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const unavailable = await handler(makeRequest());
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'POLL_RETRY');
    assert.equal(row.status, 'running');
    assert.equal(row.provider_request_id, id);
    assert.deepEqual(updates, []);
    assert.equal(resultReads, 1);
    assert.equal(paidCalls, 0);

    showProgress = true;
    const resumed = await handler(makeRequest());
    const data = await resumed.json();
    assert.equal(resumed.status, 200);
    assert.equal(data.job.id, id);
    assert.equal(data.job.status, 'running');
    assert.equal(row.provider_request_id, id);
    assert.ok(updates.every(update => update.status !== 'failed'));
    assert.equal(resultReads, 1);
    assert.equal(paidCalls, 0);
  });
}

test('mobile: accepted response aliases are normalized before saving and lifecycle URLs cannot be interchanged', async () => {
  const base = `https://queue.fal.run/minimax/h3-max/requests/${id}`;
  assert.equal(queueUrl(`${base}/response`, id, 'result'), base);
  assert.equal(queueUrl(base, id, 'result'), base);
  assert.equal(queueUrl(`${base}/status`, id, 'status'), `${base}/status`);
  assert.equal(queueUrl(`${base}/cancel`, id, 'cancel'), `${base}/cancel`);
  for (const [url, kind] of [[`${base}/response`, 'status'], [`${base}/status`, 'result'],
    [`${base}/cancel`, 'status'], [`${base}/status?logs=1`, 'status'], [`${base}/response?token=value`, 'result']]) {
    assert.throws(() => queueUrl(url, id, kind));
  }

  const sealed = await sealProvider('provider-key-for-test', 'runtime', id);
  const updates = [];
  let paidCalls = 0;
  const handler = createHandler({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'runtime',
    fetch: async (url, options) => {
      if (String(url).startsWith('https://queue.fal.run/')) {
        assert.equal(options.method, 'POST');
        paidCalls++;
        return Response.json({ request_id: id, status: 'IN_QUEUE', status_url: `${base}/status`,
          response_url: `${base}/response`, cancel_url: `${base}/cancel` });
      }
      const body = JSON.parse(options.body);
      if (body.p_action === 'context') return Response.json({ workspace: { id, provider_cipher: sealed.cipher, provider_iv: sealed.iv }, jobs: [] });
      if (body.p_action === 'job_reserve') return Response.json({ created: true, job: { id, status: 'submitting' } });
      if (body.p_action === 'job_update') { updates.push(body.p_payload); return Response.json({ id, ...body.p_payload }); }
      throw new Error(`Unexpected database action ${body.p_action}`);
    } });
  const response = await handler(new Request('https://example.supabase.co/functions/v1/resul-video/jobs', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).job.status, 'queued');
  assert.equal(paidCalls, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].provider_request_id, id);
  assert.equal(updates[0].response_url, base);
  assert.equal(updates[0].status_url, `${base}/status`);
  assert.equal(updates[0].cancel_url, `${base}/cancel`);
});
