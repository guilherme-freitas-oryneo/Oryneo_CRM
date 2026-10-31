-- Eight ORYNEO starter drafts. READ-ONLY TEMPLATES: NO AUTOMATIC SEND.
-- Idempotent, refuses slug collisions, never edits existing user workflows.
-- Workspace must be disabled with emergency stop. No paid/Meta/SDR calls.
BEGIN;
DO $oryneo_starters$
DECLARE v_workspace uuid;
BEGIN
 SELECT w.id INTO v_workspace
 FROM public.automation_workspaces w JOIN public.automation_runtime_settings r
 ON r.workspace_id=w.id
 WHERE w.slug='oryneo-crm' AND w.active=false AND r.mode='disabled'
   AND r.emergency_stop=true;
 IF v_workspace IS NULL THEN
   RAISE EXCEPTION 'STARTER_WORKSPACE_NOT_STOPPED' USING ERRCODE='42501';
 END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-new-opportunity'
      AND id<>'f1100000-0000-4000-8000-000000000001'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: new_opportunity' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000000001'::uuid,v_workspace,'starter-new-opportunity','Nova oportunidade','pipeline',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000000001'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000000001","name":"Nova oportunidade","kind":"pipeline","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-000000000002","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"opportunity.created"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-000000000003","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"exists","field":"opportunity.stage_id"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-000000000004","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000000005","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-000000000065","source":"f1100000-0000-4000-8000-000000000002","source_port":"out","target":"f1100000-0000-4000-8000-000000000003","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000066","source":"f1100000-0000-4000-8000-000000000003","source_port":"no","target":"f1100000-0000-4000-8000-000000000004","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000067","source":"f1100000-0000-4000-8000-000000000003","source_port":"yes","target":"f1100000-0000-4000-8000-000000000005","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"new_opportunity","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000000001'::uuid,
      '{"template_id":"new_opportunity","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-talk-to-us'
      AND id<>'f1100000-0000-4000-8000-0000000003e9'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: talk_to_us' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-0000000003e9'::uuid,v_workspace,'starter-talk-to-us','Quero conversar','sdr',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-0000000003e9'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-0000000003e9","name":"Quero conversar","kind":"sdr","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-0000000003ea","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"conversation.inbound"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-0000000003eb","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"compare","field":"conversation.mode","op":"eq","value":"sdr_active"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-0000000003ec","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-0000000003ed","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-00000000044d","source":"f1100000-0000-4000-8000-0000000003ea","source_port":"out","target":"f1100000-0000-4000-8000-0000000003eb","target_port":"in"},{"id":"f1100000-0000-4000-8000-00000000044e","source":"f1100000-0000-4000-8000-0000000003eb","source_port":"no","target":"f1100000-0000-4000-8000-0000000003ec","target_port":"in"},{"id":"f1100000-0000-4000-8000-00000000044f","source":"f1100000-0000-4000-8000-0000000003eb","source_port":"yes","target":"f1100000-0000-4000-8000-0000000003ed","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"talk_to_us","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-0000000003e9'::uuid,
      '{"template_id":"talk_to_us","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-direct-checkout'
      AND id<>'f1100000-0000-4000-8000-0000000007d1'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: direct_checkout' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-0000000007d1'::uuid,v_workspace,'starter-direct-checkout','Checkout direto','pipeline',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-0000000007d1'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-0000000007d1","name":"Checkout direto","kind":"pipeline","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-0000000007d2","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"checkout.started"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-0000000007d3","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"exists","field":"billing.status"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-0000000007d4","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-0000000007d5","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-000000000835","source":"f1100000-0000-4000-8000-0000000007d2","source_port":"out","target":"f1100000-0000-4000-8000-0000000007d3","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000836","source":"f1100000-0000-4000-8000-0000000007d3","source_port":"no","target":"f1100000-0000-4000-8000-0000000007d4","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000837","source":"f1100000-0000-4000-8000-0000000007d3","source_port":"yes","target":"f1100000-0000-4000-8000-0000000007d5","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"direct_checkout","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-0000000007d1'::uuid,
      '{"template_id":"direct_checkout","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-payment-confirmed'
      AND id<>'f1100000-0000-4000-8000-000000000bb9'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: payment_confirmed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000000bb9'::uuid,v_workspace,'starter-payment-confirmed','Pagamento confirmado','pipeline',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000000bb9'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000000bb9","name":"Pagamento confirmado","kind":"pipeline","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-000000000bba","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"billing.paid_verified"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-000000000bbb","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"compare","field":"billing.paid_verified","op":"eq","value":true}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-000000000bbc","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000000bbd","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-000000000c1d","source":"f1100000-0000-4000-8000-000000000bba","source_port":"out","target":"f1100000-0000-4000-8000-000000000bbb","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000c1e","source":"f1100000-0000-4000-8000-000000000bbb","source_port":"no","target":"f1100000-0000-4000-8000-000000000bbc","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000000c1f","source":"f1100000-0000-4000-8000-000000000bbb","source_port":"yes","target":"f1100000-0000-4000-8000-000000000bbd","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"payment_confirmed","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000000bb9'::uuid,
      '{"template_id":"payment_confirmed","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-diagnosis'
      AND id<>'f1100000-0000-4000-8000-000000000fa1'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: diagnosis' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000000fa1'::uuid,v_workspace,'starter-diagnosis','Diagnóstico','pipeline',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000000fa1'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000000fa1","name":"Diagnóstico","kind":"pipeline","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-000000000fa2","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"opportunity.stage_changed"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-000000000fa3","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"exists","field":"opportunity.stage_id"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-000000000fa4","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000000fa5","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-000000001005","source":"f1100000-0000-4000-8000-000000000fa2","source_port":"out","target":"f1100000-0000-4000-8000-000000000fa3","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000001006","source":"f1100000-0000-4000-8000-000000000fa3","source_port":"no","target":"f1100000-0000-4000-8000-000000000fa4","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000001007","source":"f1100000-0000-4000-8000-000000000fa3","source_port":"yes","target":"f1100000-0000-4000-8000-000000000fa5","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"diagnosis","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000000fa1'::uuid,
      '{"template_id":"diagnosis","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-proposal'
      AND id<>'f1100000-0000-4000-8000-000000001389'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: proposal' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000001389'::uuid,v_workspace,'starter-proposal','Proposta','pipeline',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000001389'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000001389","name":"Proposta","kind":"pipeline","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-00000000138a","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"proposal.sent"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-00000000138b","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"exists","field":"opportunity.stage_id"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-00000000138c","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-00000000138d","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-0000000013ed","source":"f1100000-0000-4000-8000-00000000138a","source_port":"out","target":"f1100000-0000-4000-8000-00000000138b","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000013ee","source":"f1100000-0000-4000-8000-00000000138b","source_port":"no","target":"f1100000-0000-4000-8000-00000000138c","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000013ef","source":"f1100000-0000-4000-8000-00000000138b","source_port":"yes","target":"f1100000-0000-4000-8000-00000000138d","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"proposal","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000001389'::uuid,
      '{"template_id":"proposal","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-follow-up'
      AND id<>'f1100000-0000-4000-8000-000000001771'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: follow_up' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000001771'::uuid,v_workspace,'starter-follow-up','Follow-up','sdr',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000001771'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000001771","name":"Follow-up","kind":"sdr","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-000000001772","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"conversation.inbound"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-000000001773","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"compare","field":"conversation.consent_granted","op":"eq","value":true}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-000000001774","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000001775","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000001776","type":"wait","label":"Esperar ou cancelar pela resposta","position":{"x":720,"y":100},"config":{"duration_minutes":60,"cancel_on_reply":true},"ports":["in","out","timeout"]}],"edges":[{"id":"f1100000-0000-4000-8000-0000000017d5","source":"f1100000-0000-4000-8000-000000001772","source_port":"out","target":"f1100000-0000-4000-8000-000000001773","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000017d6","source":"f1100000-0000-4000-8000-000000001773","source_port":"no","target":"f1100000-0000-4000-8000-000000001774","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000017d7","source":"f1100000-0000-4000-8000-000000001773","source_port":"yes","target":"f1100000-0000-4000-8000-000000001776","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000017d8","source":"f1100000-0000-4000-8000-000000001776","source_port":"out","target":"f1100000-0000-4000-8000-000000001775","target_port":"in"},{"id":"f1100000-0000-4000-8000-0000000017d9","source":"f1100000-0000-4000-8000-000000001776","source_port":"timeout","target":"f1100000-0000-4000-8000-000000001774","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"follow_up","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000001771'::uuid,
      '{"template_id":"follow_up","dispatch_authorized":false}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM public.automation_flows
    WHERE workspace_id=v_workspace AND slug='starter-conversational-sdr'
      AND id<>'f1100000-0000-4000-8000-000000001b59'::uuid)
  THEN RAISE EXCEPTION 'STARTER_SLUG_CONFLICT: conversational_sdr' USING ERRCODE='40001'; END IF;
  INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
    VALUES('f1100000-0000-4000-8000-000000001b59'::uuid,v_workspace,'starter-conversational-sdr','SDR conversacional','sdr',false)
    ON CONFLICT(workspace_id,slug) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.automation_flow_versions
      (workspace_id,flow_id,version,schema_version,graph_json,status,validation_report)
    VALUES(v_workspace,'f1100000-0000-4000-8000-000000001b59'::uuid,1,'1.0.0',
      '{"schema_version":"1.0.0","id":"f1100000-0000-4000-8000-000000001b59","name":"SDR conversacional","kind":"sdr","status":"draft","version":1,"nodes":[{"id":"f1100000-0000-4000-8000-000000001b5a","type":"trigger","label":"Evento canônico","position":{"x":80,"y":200},"config":{"event_type":"conversation.inbound"},"ports":["out"]},{"id":"f1100000-0000-4000-8000-000000001b5b","type":"condition","label":"Condição verificada","position":{"x":390,"y":200},"config":{"rule":{"kind":"compare","field":"conversation.mode","op":"eq","value":"sdr_active"}},"ports":["in","yes","no"]},{"id":"f1100000-0000-4000-8000-000000001b5c","type":"stop","label":"Interromper sem ação","position":{"x":1070,"y":370},"config":{},"ports":["in"]},{"id":"f1100000-0000-4000-8000-000000001b5d","type":"end","label":"Finalizar sem enviar","position":{"x":1070,"y":100},"config":{},"ports":["in"]}],"edges":[{"id":"f1100000-0000-4000-8000-000000001bbd","source":"f1100000-0000-4000-8000-000000001b5a","source_port":"out","target":"f1100000-0000-4000-8000-000000001b5b","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000001bbe","source":"f1100000-0000-4000-8000-000000001b5b","source_port":"no","target":"f1100000-0000-4000-8000-000000001b5c","target_port":"in"},{"id":"f1100000-0000-4000-8000-000000001bbf","source":"f1100000-0000-4000-8000-000000001b5b","source_port":"yes","target":"f1100000-0000-4000-8000-000000001b5d","target_port":"in"}],"description":"Modelo inicial editável; bloqueado para envio. Verifique regras e consentimento antes de publicar.","metadata":{"starter_id":"conversational_sdr","requires_business_approval":true,"live_dispatch":false,"source":"ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28"}}'::jsonb,'draft',
      '{"status":"starter_unvalidated","runtime_enabled":false}'::jsonb);
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,NULL,'starter_draft_seeded','flow','f1100000-0000-4000-8000-000000001b59'::uuid,
      '{"template_id":"conversational_sdr","dispatch_authorized":false}'::jsonb);
  END IF;
END $oryneo_starters$;
COMMIT;
