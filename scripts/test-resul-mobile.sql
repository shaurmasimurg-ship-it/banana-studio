-- Transactional integration tests: fixtures are always rolled back.
-- Run with a database administration connection after the setup script.
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); photo uuid := gen_random_uuid();
  ah text := repeat('1',64); bh text := repeat('2',64);
  idem uuid := gen_random_uuid(); other_idem uuid := gen_random_uuid();
  body jsonb; first_result jsonb; again jsonb; job_id uuid; saved jsonb;
  caught boolean;
BEGIN
  INSERT INTO private.resul_mobile_workspaces(id,name,access_hash,provider_cipher,provider_iv,key_suffix)
  VALUES(a,'Isolated test A',ah,repeat('A',24),repeat('B',16),'test'),
        (b,'Isolated test B',bh,repeat('C',24),repeat('D',16),'test');

  IF public.resul_mobile_api('context',ah)->'workspace'->>'id' <> a::text THEN
    RAISE EXCEPTION 'context selected wrong workspace';
  END IF;
  caught := false;
  BEGIN PERFORM public.resul_mobile_api('context',repeat('3',64));
  EXCEPTION WHEN SQLSTATE '28000' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'unknown capability accepted'; END IF;

  body := jsonb_build_object('idempotency_key',idem,'mode','text','prompt','Test only',
    'duration',5,'resolution','480P','aspect_ratio','9:16','image_id',NULL);
  first_result := public.resul_mobile_api('job_reserve',ah,body);
  job_id := (first_result->'job'->>'id')::uuid;
  again := public.resul_mobile_api('job_reserve',ah,body || '{"prompt":"Changed payload"}'::jsonb);
  IF (first_result->>'created')::boolean IS NOT TRUE OR (again->>'created')::boolean IS NOT FALSE
    OR again->'job'->>'id' <> job_id::text OR again->'job'->>'prompt' <> 'Test only' THEN
    RAISE EXCEPTION 'idempotency failed';
  END IF;

  caught := false;
  BEGIN PERFORM public.resul_mobile_api('job_get',bh,jsonb_build_object('id',job_id));
  EXCEPTION WHEN SQLSTATE 'P0002' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'cross-workspace job access'; END IF;

  PERFORM public.resul_mobile_api('upload_add',bh,jsonb_build_object('id',photo,
    'object_key',b::text || '/inputs/' || photo::text || '.jpg','mime','image/jpeg','bytes',128));
  caught := false;
  BEGIN PERFORM public.resul_mobile_api('job_reserve',ah,body || jsonb_build_object(
    'idempotency_key',other_idem,'mode','image','image_id',photo));
  EXCEPTION WHEN SQLSTATE 'P0002' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'cross-workspace image accepted'; END IF;

  PERFORM public.resul_mobile_api('job_reserve',ah,body || jsonb_build_object('idempotency_key',other_idem));
  caught := false;
  BEGIN PERFORM public.resul_mobile_api('job_reserve',ah,body || jsonb_build_object('idempotency_key',gen_random_uuid()));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'concurrency admission limit bypass'; END IF;

  caught := false;
  BEGIN PERFORM public.resul_mobile_api('job_update',ah,jsonb_build_object('id',job_id,'workspace_id',b));
  EXCEPTION WHEN SQLSTATE '22023' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'ownership mass assignment accepted'; END IF;

  saved := public.resul_mobile_api('job_update',ah,jsonb_build_object('id',job_id,
    'status','completed','source_video_url','https://v3b.fal.media/fixture/result.mp4'));
  saved := public.resul_mobile_api('job_update',ah,jsonb_build_object('id',job_id,'status','running'));
  IF saved->>'status' <> 'completed' THEN RAISE EXCEPTION 'terminal status downgraded'; END IF;
  saved := public.resul_mobile_api('job_update',ah,jsonb_build_object('id',job_id,
    'output_key',a::text || '/videos/' || job_id::text || '.mp4','warning',NULL));
  IF saved->>'output_key' IS NULL OR saved->>'status' <> 'completed' THEN RAISE EXCEPTION 'terminal archival update failed'; END IF;

  caught := false;
  BEGIN PERFORM public.resul_mobile_api('job_update',ah,jsonb_build_object('id',job_id,
    'source_video_url','https://fal.media.attacker.example/result.mp4'));
  EXCEPTION WHEN SQLSTATE '22023' THEN caught := true; END;
  IF NOT caught THEN RAISE EXCEPTION 'unsafe source media accepted'; END IF;
END;
$test$;
ROLLBACK;
SELECT jsonb_build_object('passed',true,'checks',10,'fixtures_persisted',false) AS mobile_integration_tests;
