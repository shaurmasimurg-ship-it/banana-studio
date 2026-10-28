-- Isolated mobile workspace. This does not modify Banana Studio Auth users,
-- its existing application tables, or their RLS policies.
-- The owner access token is generated outside this file. Store only its SHA-256
-- hash here; never put an access token, provider key, or real account in Git.
--
-- The RPC is SECURITY INVOKER and executable only by service_role. Edge accepts
-- the owner bearer only through Authorization and passes its hash to this RPC,
-- which resolves an active workspace. The service-role credential stays in the
-- server runtime exclusively.
-- Provider credentials are ciphertext + IV, never plaintext. No browser role
-- has table access or RPC execution permission. UUID keys create no sequences.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.resul_mobile_workspaces (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  access_hash text NOT NULL UNIQUE CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  active boolean NOT NULL DEFAULT true,
  provider_cipher text,
  provider_iv text,
  key_suffix text CHECK (key_suffix IS NULL OR char_length(key_suffix) = 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resul_mobile_provider_complete CHECK (
    (provider_cipher IS NULL AND provider_iv IS NULL AND key_suffix IS NULL)
    OR (provider_cipher IS NOT NULL AND provider_iv IS NOT NULL AND key_suffix IS NOT NULL
      AND char_length(provider_cipher) BETWEEN 20 AND 16384
      AND char_length(provider_iv) BETWEEN 1 AND 128)
  )
);

CREATE TABLE IF NOT EXISTS private.resul_mobile_uploads (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES private.resul_mobile_workspaces(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT resul_mobile_upload_path CHECK (
    object_key ~ ('^' || workspace_id::text || '/inputs/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
    AND position('..' IN object_key) = 0
  )
);

CREATE TABLE IF NOT EXISTS private.resul_mobile_jobs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES private.resul_mobile_workspaces(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('text', 'image')),
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 4000),
  duration integer NOT NULL CHECK (duration IN (5, 10, 15)),
  resolution text NOT NULL CHECK (resolution IN ('480P', '768P', '1080P')),
  aspect_ratio text NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  image_id uuid,
  status text NOT NULL DEFAULT 'submitting' CHECK (
    status IN ('submitting', 'queued', 'running', 'completed', 'failed', 'submission_unknown')
  ),
  provider_request_id text CHECK (
    provider_request_id IS NULL OR provider_request_id ~ '^[A-Za-z0-9_-]{1,128}$'
  ),
  status_url text,
  response_url text,
  cancel_url text,
  source_video_url text,
  output_key text,
  error text CHECK (error IS NULL OR char_length(error) <= 4000),
  warning text CHECK (warning IS NULL OR char_length(warning) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, image_id)
    REFERENCES private.resul_mobile_uploads(workspace_id, id),
  CONSTRAINT resul_mobile_job_image CHECK (
    (mode = 'text' AND image_id IS NULL) OR (mode = 'image' AND image_id IS NOT NULL)
  ),
  CONSTRAINT resul_mobile_status_url CHECK (
    status_url IS NULL OR (char_length(status_url) <= 2048
      AND status_url ~ '^https://queue[.]fal[.]run/[A-Za-z0-9/_-]+$')
  ),
  CONSTRAINT resul_mobile_response_url CHECK (
    response_url IS NULL OR (char_length(response_url) <= 2048
      AND response_url ~ '^https://queue[.]fal[.]run/[A-Za-z0-9/_-]+$')
  ),
  CONSTRAINT resul_mobile_cancel_url CHECK (
    cancel_url IS NULL OR (char_length(cancel_url) <= 2048
      AND cancel_url ~ '^https://queue[.]fal[.]run/[A-Za-z0-9/_-]+$')
  ),
  CONSTRAINT resul_mobile_source_url CHECK (
    source_video_url IS NULL OR (char_length(source_video_url) <= 4096
      AND source_video_url ~ '^https://([A-Za-z0-9-]+[.])+fal[.]media/[^[:space:]]+$'
      AND position(chr(92) IN source_video_url) = 0)
  ),
  CONSTRAINT resul_mobile_output_path CHECK (
    output_key IS NULL OR output_key = workspace_id::text || '/videos/' || id::text || '.mp4'
  )
);

CREATE INDEX IF NOT EXISTS resul_mobile_uploads_workspace_created_idx
  ON private.resul_mobile_uploads (workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS resul_mobile_jobs_workspace_created_idx
  ON private.resul_mobile_jobs (workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS resul_mobile_jobs_workspace_active_idx
  ON private.resul_mobile_jobs (workspace_id, created_at)
  WHERE status IN ('submitting', 'queued', 'running');
CREATE INDEX IF NOT EXISTS resul_mobile_jobs_image_idx
  ON private.resul_mobile_jobs (workspace_id, image_id) WHERE image_id IS NOT NULL;

ALTER TABLE private.resul_mobile_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resul_mobile_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resul_mobile_jobs ENABLE ROW LEVEL SECURITY;

-- Re-running this setup reasserts the no-client-access boundary only for these
-- new tables. Existing private schema grants and Banana policies are untouched.
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'private'
      AND tablename IN ('resul_mobile_workspaces', 'resul_mobile_uploads', 'resul_mobile_jobs')
  LOOP
    EXECUTE format('DROP POLICY %I ON private.%I', p.policyname, p.tablename);
  END LOOP;
END;
$policies$;

REVOKE ALL ON TABLE private.resul_mobile_workspaces,
  private.resul_mobile_uploads, private.resul_mobile_jobs FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.resul_mobile_workspaces,
  private.resul_mobile_uploads, private.resul_mobile_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.resul_mobile_api(
  p_action text,
  p_access_hash text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $api$
DECLARE
  v_workspace private.resul_mobile_workspaces%ROWTYPE;
  v_upload private.resul_mobile_uploads%ROWTYPE;
  v_job private.resul_mobile_jobs%ROWTYPE;
  v_next private.resul_mobile_jobs%ROWTYPE;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
  v_image_id uuid;
  v_idempotency_key uuid;
  v_mode text;
  v_key text;
  v_value jsonb;
  v_text text;
  v_bytes bigint;
  v_count integer;
  v_jobs jsonb;
BEGIN
  IF p_access_hash IS NULL OR p_access_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Workspace access is invalid or inactive.';
  END IF;

  -- Serialize admission per workspace so simultaneous requests cannot bypass
  -- either concurrency limits or the idempotency check.
  IF p_action = 'job_reserve' THEN
    SELECT * INTO v_workspace FROM private.resul_mobile_workspaces
      WHERE access_hash = p_access_hash AND active FOR UPDATE;
  ELSE
    SELECT * INTO v_workspace FROM private.resul_mobile_workspaces
      WHERE access_hash = p_access_hash AND active;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Workspace access is invalid or inactive.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The request payload must be an object.';
  END IF;

  IF p_action IN ('context', 'job_reserve') THEN
    UPDATE private.resul_mobile_jobs SET
      status = 'submission_unknown',
      warning = coalesce(warning, 'Provider acceptance is unconfirmed. Check the saved request before creating another video.'),
      updated_at = now()
    WHERE workspace_id = v_workspace.id AND status = 'submitting'
      AND created_at < now() - interval '2 minutes';
  END IF;

  CASE p_action
    WHEN 'context' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC, j.id DESC), '[]'::jsonb)
      INTO v_jobs FROM (
        SELECT * FROM private.resul_mobile_jobs
        WHERE workspace_id = v_workspace.id ORDER BY created_at DESC, id DESC LIMIT 40
      ) j;
      -- Ciphertext is returned only to the service-role caller. Edge must return
      -- only configured/key_suffix to the browser, never this workspace object.
      RETURN jsonb_build_object('workspace', jsonb_build_object(
        'id', v_workspace.id, 'name', v_workspace.name,
        'provider_cipher', v_workspace.provider_cipher, 'provider_iv', v_workspace.provider_iv,
        'key_suffix', v_workspace.key_suffix
      ), 'jobs', v_jobs);

    WHEN 'provider_set' THEN
      IF jsonb_typeof(v_payload->'cipher') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_payload->'iv') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_payload->'suffix') IS DISTINCT FROM 'string'
        OR char_length(v_payload->>'cipher') NOT BETWEEN 20 AND 16384
        OR char_length(v_payload->>'iv') NOT BETWEEN 1 AND 128
        OR char_length(v_payload->>'suffix') <> 4 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Encrypted provider credentials are invalid.';
      END IF;
      UPDATE private.resul_mobile_workspaces SET
        provider_cipher = v_payload->>'cipher', provider_iv = v_payload->>'iv', key_suffix = v_payload->>'suffix'
      WHERE id = v_workspace.id;
      RETURN jsonb_build_object('configured', true, 'key_suffix', v_payload->>'suffix');

    WHEN 'provider_delete' THEN
      UPDATE private.resul_mobile_workspaces SET provider_cipher = NULL, provider_iv = NULL, key_suffix = NULL
      WHERE id = v_workspace.id;
      RETURN jsonb_build_object('configured', false);

    WHEN 'upload_add', 'upload_get', 'job_get', 'job_update' THEN
      v_text := v_payload->>'id';
      IF jsonb_typeof(v_payload->'id') IS DISTINCT FROM 'string'
        OR v_text !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid record ID is required.';
      END IF;
      v_id := v_text::uuid;

      IF p_action = 'upload_add' THEN
        IF jsonb_typeof(v_payload->'object_key') IS DISTINCT FROM 'string'
          OR (v_payload->>'object_key') !~ ('^' || v_workspace.id::text || '/inputs/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
          OR position('..' IN v_payload->>'object_key') > 0 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The image path must belong to this workspace inputs directory.';
        END IF;
        IF jsonb_typeof(v_payload->'mime') IS DISTINCT FROM 'string'
          OR (v_payload->>'mime') NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Use a JPEG, PNG, or WebP image.';
        END IF;
        IF jsonb_typeof(v_payload->'bytes') IS DISTINCT FROM 'number'
          OR (v_payload->>'bytes') !~ '^[0-9]{1,8}$' THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The image size must be a whole number of bytes.';
        END IF;
        v_bytes := (v_payload->>'bytes')::bigint;
        IF v_bytes NOT BETWEEN 1 AND 8388608 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The image must be between 1 byte and 8 MiB.';
        END IF;
        SELECT * INTO v_upload FROM private.resul_mobile_uploads
        WHERE workspace_id = v_workspace.id AND id = v_id;
        IF FOUND THEN
          IF v_upload.object_key = v_payload->>'object_key'
            AND v_upload.mime = v_payload->>'mime' AND v_upload.bytes = v_bytes THEN
            RETURN to_jsonb(v_upload);
          END IF;
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'This image ID is already associated with another upload.';
        END IF;
        BEGIN
          INSERT INTO private.resul_mobile_uploads(id, workspace_id, object_key, mime, bytes)
          VALUES (v_id, v_workspace.id, v_payload->>'object_key', v_payload->>'mime', v_bytes)
          RETURNING * INTO v_upload;
        EXCEPTION WHEN unique_violation THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'This image ID or path has already been used.';
        END;
        RETURN to_jsonb(v_upload);
      ELSIF p_action = 'upload_get' THEN
        SELECT * INTO v_upload FROM private.resul_mobile_uploads
        WHERE workspace_id = v_workspace.id AND id = v_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Image not found in this workspace.';
        END IF;
        RETURN to_jsonb(v_upload);
      END IF;

      SELECT * INTO v_job FROM private.resul_mobile_jobs
      WHERE workspace_id = v_workspace.id AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Video not found in this workspace.';
      END IF;
      IF p_action = 'job_get' THEN RETURN to_jsonb(v_job); END IF;

      -- No mass assignment: a caller cannot patch ownership, admission input,
      -- idempotency, timestamps, or any field outside this explicit allowlist.
      FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_payload) LOOP
        IF v_key NOT IN ('id', 'status', 'provider_request_id', 'status_url', 'response_url',
          'cancel_url', 'source_video_url', 'output_key', 'error', 'warning') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported video update field.';
        END IF;
        IF jsonb_typeof(v_value) NOT IN ('string', 'null') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Video update values must be text or null.';
        END IF;
      END LOOP;
      v_next := v_job;
      IF v_payload ? 'status' THEN
        v_text := v_payload->>'status';
        IF v_text IS NULL OR v_text NOT IN ('submitting', 'queued', 'running', 'completed', 'failed', 'submission_unknown') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The video status is invalid.';
        END IF;
        -- Terminal results survive stale polls. Archival fields can still update.
        IF v_job.status NOT IN ('completed', 'failed') THEN v_next.status := v_text; END IF;
      END IF;
      IF v_payload ? 'provider_request_id' THEN
        v_text := v_payload->>'provider_request_id';
        IF v_job.provider_request_id IS NOT NULL AND v_text IS DISTINCT FROM v_job.provider_request_id THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'The provider request association cannot be changed.';
        END IF;
        IF v_text IS NOT NULL AND v_text !~ '^[A-Za-z0-9_-]{1,128}$' THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The provider request ID is invalid.';
        END IF;
        v_next.provider_request_id := v_text;
      END IF;
      IF v_payload ? 'status_url' THEN v_next.status_url := v_payload->>'status_url'; END IF;
      IF v_payload ? 'response_url' THEN v_next.response_url := v_payload->>'response_url'; END IF;
      IF v_payload ? 'cancel_url' THEN v_next.cancel_url := v_payload->>'cancel_url'; END IF;
      IF v_payload ? 'source_video_url' THEN v_next.source_video_url := v_payload->>'source_video_url'; END IF;
      IF v_payload ? 'output_key' THEN v_next.output_key := v_payload->>'output_key'; END IF;
      IF v_payload ? 'error' THEN v_next.error := v_payload->>'error'; END IF;
      IF v_payload ? 'warning' THEN v_next.warning := v_payload->>'warning'; END IF;

      FOREACH v_text IN ARRAY ARRAY[v_next.status_url, v_next.response_url, v_next.cancel_url] LOOP
        IF v_text IS NOT NULL AND (char_length(v_text) > 2048
          OR v_text !~ '^https://queue[.]fal[.]run/[A-Za-z0-9/_-]+$') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Provider queue URLs must use https://queue.fal.run without credentials, query strings, or alternate ports.';
        END IF;
      END LOOP;
      IF v_next.source_video_url IS NOT NULL AND (char_length(v_next.source_video_url) > 4096
        OR v_next.source_video_url !~ '^https://([A-Za-z0-9-]+[.])+fal[.]media/[^[:space:]]+$'
        OR position(chr(92) IN v_next.source_video_url) > 0) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Video media must use an HTTPS fal.media subdomain URL.';
      END IF;
      IF v_next.output_key IS NOT NULL
        AND v_next.output_key <> v_workspace.id::text || '/videos/' || v_job.id::text || '.mp4' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The archived video path must match this workspace and video ID.';
      END IF;
      IF char_length(v_next.error) > 4000 OR char_length(v_next.warning) > 4000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Video messages must not exceed 4000 characters.';
      END IF;
      IF v_next.status IN ('queued', 'running') AND v_next.provider_request_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A queued or running video must retain its provider request ID.';
      END IF;
      IF v_next.status = 'completed' AND v_next.source_video_url IS NULL AND v_next.output_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A completed video must have an output.';
      END IF;
      UPDATE private.resul_mobile_jobs SET
        status = v_next.status, provider_request_id = v_next.provider_request_id,
        status_url = v_next.status_url, response_url = v_next.response_url, cancel_url = v_next.cancel_url,
        source_video_url = v_next.source_video_url, output_key = v_next.output_key,
        error = v_next.error, warning = v_next.warning, updated_at = now()
      WHERE workspace_id = v_workspace.id AND id = v_job.id RETURNING * INTO v_job;
      RETURN to_jsonb(v_job);

    WHEN 'job_reserve' THEN
      v_text := v_payload->>'idempotency_key';
      IF jsonb_typeof(v_payload->'idempotency_key') IS DISTINCT FROM 'string'
        OR v_text !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid idempotency key is required.';
      END IF;
      v_idempotency_key := v_text::uuid;
      SELECT * INTO v_job FROM private.resul_mobile_jobs
      WHERE workspace_id = v_workspace.id AND idempotency_key = v_idempotency_key;
      IF FOUND THEN
        -- Even a different payload cannot repurpose a previously admitted key.
        RETURN jsonb_build_object('created', false, 'job', to_jsonb(v_job));
      END IF;
      IF v_workspace.provider_cipher IS NULL OR v_workspace.provider_iv IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Save a provider API key before creating a video.';
      END IF;
      SELECT count(*) INTO v_count FROM private.resul_mobile_jobs
      WHERE workspace_id = v_workspace.id AND status IN ('submitting', 'queued', 'running');
      IF v_count >= 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Two videos are already active. Wait for one to finish.';
      END IF;
      SELECT count(*) INTO v_count FROM private.resul_mobile_jobs
      WHERE workspace_id = v_workspace.id AND created_at >= now() - interval '1 hour';
      IF v_count >= 12 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'The workspace limit is 12 video requests per hour. Try again later.';
      END IF;
      v_mode := v_payload->>'mode';
      IF jsonb_typeof(v_payload->'mode') IS DISTINCT FROM 'string' OR v_mode NOT IN ('text', 'image') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose text or image video mode.';
      END IF;
      IF jsonb_typeof(v_payload->'prompt') IS DISTINCT FROM 'string'
        OR char_length(btrim(v_payload->>'prompt')) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Enter a prompt between 1 and 4000 characters.';
      END IF;
      IF jsonb_typeof(v_payload->'duration') IS DISTINCT FROM 'number'
        OR (v_payload->>'duration') NOT IN ('5', '10', '15') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a video duration of 5, 10, or 15 seconds.';
      END IF;
      IF jsonb_typeof(v_payload->'resolution') IS DISTINCT FROM 'string'
        OR (v_payload->>'resolution') NOT IN ('480P', '768P', '1080P') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose 480P, 768P, or 1080P resolution.';
      END IF;
      IF jsonb_typeof(v_payload->'aspect_ratio') IS DISTINCT FROM 'string'
        OR (v_payload->>'aspect_ratio') NOT IN ('9:16', '16:9', '1:1') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a 9:16, 16:9, or 1:1 aspect ratio.';
      END IF;
      v_text := v_payload->>'image_id';
      IF v_mode = 'image' THEN
        IF jsonb_typeof(v_payload->'image_id') IS DISTINCT FROM 'string'
          OR v_text !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose an uploaded image for image video mode.';
        END IF;
        v_image_id := v_text::uuid;
        PERFORM 1 FROM private.resul_mobile_uploads WHERE workspace_id = v_workspace.id AND id = v_image_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Image not found in this workspace.';
        END IF;
      ELSIF v_text IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Text video mode must not include an image ID.';
      END IF;
      v_text := v_payload->>'id';
      IF v_text IS NULL THEN
        v_id := pg_catalog.gen_random_uuid();
      ELSIF jsonb_typeof(v_payload->'id') = 'string'
        AND v_text ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
        v_id := v_text::uuid;
      ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The video ID is invalid.';
      END IF;
      BEGIN
        INSERT INTO private.resul_mobile_jobs(id, workspace_id, idempotency_key, mode, prompt,
          duration, resolution, aspect_ratio, image_id, status)
        VALUES (v_id, v_workspace.id, v_idempotency_key, v_mode, btrim(v_payload->>'prompt'),
          (v_payload->>'duration')::integer, v_payload->>'resolution', v_payload->>'aspect_ratio', v_image_id, 'submitting')
        RETURNING * INTO v_job;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'This video ID or request key has already been used.';
      END;
      RETURN jsonb_build_object('created', true, 'job', to_jsonb(v_job));

    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported mobile workspace action.';
  END CASE;
END;
$api$;

REVOKE ALL ON FUNCTION public.resul_mobile_api(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resul_mobile_api(text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.resul_mobile_api(text, text, jsonb) IS
  'Service-role-only, security-invoker API for isolated mobile workspaces. Owner bearer hashes authorize each workspace; browser roles have no access.';

COMMIT;
