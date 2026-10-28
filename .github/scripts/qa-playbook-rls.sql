-- ORYNEO / QA RLS. Run ONLY on ephemeral PostgreSQL CI service.
\set ON_ERROR_STOP on
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE TABLE public.crm_members (user_id uuid PRIMARY KEY);
GRANT SELECT ON public.crm_members TO authenticated;
INSERT INTO public.crm_members (user_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
\i supabase/migrations/20261028194251_crm_playbook_annotations.sql
\i supabase/migrations/20261028194349_crm_playbook_restrict_member_privileges.sql

SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO public.crm_playbook_annotations(id,user_id,slide_id,block_key,start_offset,end_offset,quote,visibility,content_version)
VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','01','lead',0,4,'Lead','private','1.0.0'),
('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','01','lead',0,4,'Lead','team','1.0.0');
INSERT INTO public.crm_playbook_progress(user_id,last_slide_id) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','04');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.crm_playbook_annotations(id,user_id,slide_id,block_key,start_offset,end_offset,quote,visibility,content_version)
VALUES
('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','02','lead',0,4,'Lead','private','1.0.0'),
('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','02','lead',0,4,'Lead','team','1.0.0');
INSERT INTO public.crm_playbook_progress(user_id,last_slide_id) VALUES
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','05');
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.crm_playbook_annotations;
 IF n<>3 THEN RAISE EXCEPTION 'B access scope error: expected 3 got %',n; END IF;
 SELECT count(*) INTO n FROM public.crm_playbook_progress;
 IF n<>1 THEN RAISE EXCEPTION 'B progress leak: expected 1 got %',n; END IF;
END $$;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.crm_playbook_annotations(user_id,slide_id,block_key,start_offset,end_offset,quote,visibility,content_version)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','03','lead',0,4,'Lead','private','1.0.0');
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'B may forge annotation owned by A'; END IF;
END $$;
DELETE FROM public.crm_playbook_annotations WHERE id='22222222-2222-4222-8222-222222222222';
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM public.crm_playbook_annotations WHERE id='22222222-2222-4222-8222-222222222222';
 IF n<>1 THEN RAISE EXCEPTION 'B deleted shared note owned by A'; END IF;
END $$;
UPDATE public.crm_playbook_progress SET last_slide_id='99' WHERE user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM public.crm_playbook_progress WHERE last_slide_id='99';
 IF n<>0 THEN RAISE EXCEPTION 'B modified progress owned by A'; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.crm_playbook_annotations;
 IF n<>3 THEN RAISE EXCEPTION 'A access scope error: expected 3 got %',n; END IF;
 SELECT count(*) INTO n FROM public.crm_playbook_progress;
 IF n<>1 THEN RAISE EXCEPTION 'A progress leak: expected 1 got %',n; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.crm_playbook_annotations;
 IF n<>0 THEN RAISE EXCEPTION 'non-member can read shared annotations'; END IF;
END $$;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
 INSERT INTO public.crm_playbook_annotations(user_id,slide_id,block_key,start_offset,end_offset,quote,visibility,content_version)
 VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','05','lead',0,4,'Lead','team','1.0.0');
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'non-member may write annotations'; END IF;
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
 PERFORM 1 FROM public.crm_playbook_annotations LIMIT 1;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'anon read permitted'; END IF;
END $$;
RESET ROLE;
\echo 'ORYNEO PLAYBOOK RLS QA PASSED (authors, team, nonmembers, anonymous, progress)'
