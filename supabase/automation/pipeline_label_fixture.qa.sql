-- QA-only fixture, disposable PostgreSQL after shadow_queue.qa.sql.
\set ON_ERROR_STOP on
CREATE TABLE public.crm_records(
 id uuid PRIMARY KEY,
 kind text NOT NULL,
 data jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
UPDATE public.automation_workspaces SET slug='oryneo-crm'
  WHERE id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.crm_records(id,kind,data,revision) VALUES
('8e200e46-92db-4419-b752-11ab089fd5a3','stage',
 '{"name":"Qualificada","color":"#123456","position":3000,"outcome":"open"}',2),
('f883a26d-d813-4d09-b807-fa1eb44396f4','stage',
 '{"name":"Em decisão","color":"#123456","position":5000,"outcome":"open"}',2),
('a623469a-34c8-4c21-9a44-7e20cc7df502','stage',
 '{"name":"Implantação","color":"#123456","position":6500,"outcome":"won"}',1),
('6ab321bd-5ec4-4dfc-b8c0-4824da854273','stage',
 '{"name":"Ganha","color":"#123456","position":6000,"outcome":"won"}',1),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','deal',
 '{"title":"Negociação preservada","stage_id":"8e200e46-92db-4419-b752-11ab089fd5a3"}',9);
SELECT 'stage-rename-fixture-created' AS qa_status;
