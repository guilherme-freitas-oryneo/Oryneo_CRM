-- Verified paid-order bridge between the commercial pipeline and delivery.
-- The legacy implementation-stage trigger remains installed as a rollback path.
-- No historical order is replayed and this migration sends no external message.

CREATE TABLE IF NOT EXISTS public.crm_postsale_bridge_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  commercial_won_stage_id uuid NOT NULL,
  legacy_implementation_stage_id uuid NOT NULL,
  verified_at timestamptz,
  verification_reason text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (commercial_won_stage_id <> legacy_implementation_stage_id)
);

CREATE TABLE IF NOT EXISTS public.crm_postsale_bridge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.crm_postsale_bridge_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_postsale_bridge_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_postsale_bridge_settings,public.crm_postsale_bridge_audit
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.crm_postsale_bridge_settings,public.crm_postsale_bridge_audit
  TO authenticated;

DROP POLICY IF EXISTS crm_postsale_bridge_settings_member_read
  ON public.crm_postsale_bridge_settings;
CREATE POLICY crm_postsale_bridge_settings_member_read
  ON public.crm_postsale_bridge_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_members member
                 WHERE member.user_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS crm_postsale_bridge_audit_member_read
  ON public.crm_postsale_bridge_audit;
CREATE POLICY crm_postsale_bridge_audit_member_read
  ON public.crm_postsale_bridge_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_members member
                 WHERE member.user_id=(SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.crm_postsale_bridge_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT EXISTS(
   SELECT 1
   FROM public.crm_postsale_bridge_settings settings
   JOIN public.crm_records won ON won.id=settings.commercial_won_stage_id
     AND won.kind='stage' AND NOT won.deleted
     AND won.data->>'name'='Ganha' AND won.data->>'outcome'='won'
   JOIN public.crm_records legacy ON legacy.id=settings.legacy_implementation_stage_id
     AND legacy.kind='stage' AND NOT legacy.deleted
     AND legacy.data->>'name'='Implantação' AND legacy.data->>'outcome'='won'
   WHERE settings.id AND settings.enabled AND settings.verified_at IS NOT NULL
 )
$function$;
REVOKE ALL ON FUNCTION public.crm_postsale_bridge_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_postsale_bridge_ready() TO service_role;

CREATE OR REPLACE FUNCTION public.crm_postsale_bridge_set_enabled(
  p_enabled boolean,p_reason text,p_actor uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  IF p_enabled IS NULL OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Motivo de alteração inválido.' USING ERRCODE='22023';
  END IF;
  IF p_enabled AND NOT EXISTS(
    SELECT 1 FROM public.crm_postsale_bridge_settings settings
    JOIN public.crm_records won ON won.id=settings.commercial_won_stage_id
      AND won.kind='stage' AND NOT won.deleted
      AND won.data->>'name'='Ganha' AND won.data->>'outcome'='won'
    JOIN public.crm_records legacy ON legacy.id=settings.legacy_implementation_stage_id
      AND legacy.kind='stage' AND NOT legacy.deleted
      AND legacy.data->>'name'='Implantação' AND legacy.data->>'outcome'='won'
    WHERE settings.id
  ) THEN
    RAISE EXCEPTION 'Mapeamento pós-venda não verificado.' USING ERRCODE='55000';
  END IF;
  UPDATE public.crm_postsale_bridge_settings
  SET enabled=p_enabled,
      verified_at=CASE WHEN p_enabled THEN clock_timestamp() ELSE verified_at END,
      verification_reason=trim(p_reason),updated_at=clock_timestamp()
  WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração pós-venda ausente.'; END IF;
  INSERT INTO public.crm_postsale_bridge_audit(enabled,reason,actor)
  VALUES(p_enabled,trim(p_reason),p_actor);
  RETURN jsonb_build_object('ok',true,'enabled',p_enabled);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_postsale_bridge_set_enabled(boolean,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_postsale_bridge_set_enabled(boolean,text,uuid)
  TO service_role;

INSERT INTO public.crm_postsale_bridge_settings(
  id,enabled,commercial_won_stage_id,legacy_implementation_stage_id,
  verified_at,verification_reason
) VALUES (
  true,false,'6ab321bd-5ec4-4dfc-b8c0-4824da854273',
  'a623469a-34c8-4c21-9a44-7e20cc7df502',NULL,
  'Aguardando verificação transacional da migração'
) ON CONFLICT(id) DO UPDATE SET
  commercial_won_stage_id=EXCLUDED.commercial_won_stage_id,
  legacy_implementation_stage_id=EXCLUDED.legacy_implementation_stage_id,
  updated_at=clock_timestamp();

CREATE OR REPLACE FUNCTION public.crm_create_delivery_on_paid_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_created integer:=0;
BEGIN
  IF NOT public.crm_postsale_bridge_ready()
     OR new.status<>'paid' OR new.paid_at IS NULL
     OR new.billing_environment IS DISTINCT FROM 'live' THEN
    RETURN new;
  END IF;
  INSERT INTO public.crm_delivery_projects(order_id)
  VALUES(new.id) ON CONFLICT(order_id) DO NOTHING;
  GET DIAGNOSTICS v_created=ROW_COUNT;
  INSERT INTO public.crm_delivery_milestones(order_id,position,title)
  VALUES (new.id,1,'Kickoff e alinhamento do escopo'),
         (new.id,2,'Preparação e configuração do ambiente'),
         (new.id,3,'Validação de acessos e entregáveis')
  ON CONFLICT(order_id,position) DO NOTHING;
  IF v_created=1 THEN
    INSERT INTO public.crm_delivery_audit(order_id,action,detail)
    VALUES(new.id,'delivery_created',
      jsonb_build_object('origin','verified_live_paid_order','deal_id',new.deal_id));
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_create_delivery_on_paid_order()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS crm_delivery_after_paid ON public.crm_billing_orders;
CREATE TRIGGER crm_delivery_after_paid
AFTER INSERT OR UPDATE OF status,paid_at,billing_environment
ON public.crm_billing_orders FOR EACH ROW
EXECUTE FUNCTION public.crm_create_delivery_on_paid_order();

CREATE OR REPLACE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_deal_id uuid; v_rows integer:=0;
BEGIN
  IF NOT public.crm_postsale_bridge_ready() THEN RETURN new; END IF;
  SELECT bill.deal_id INTO v_deal_id
  FROM public.crm_billing_orders bill
  WHERE bill.id=new.order_id AND bill.status='paid'
    AND bill.paid_at IS NOT NULL AND bill.billing_environment='live';
  IF v_deal_id IS NULL THEN RETURN new; END IF;
  INSERT INTO public.crm_automation_jobs(
    deal_id,job_type,due_at,subject_type,subject_id,occurrence_key
  ) VALUES (
    v_deal_id,'implementation_started_email',clock_timestamp()+interval '5 minutes',
    'billing_order',new.order_id,'implementation_started'
  ) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=1 THEN
    INSERT INTO public.crm_delivery_audit(order_id,action,detail)
    VALUES(new.order_id,'implementation_email_queued',
      '{"origin":"verified_live_paid_order","exact_order_bound":true}'::jsonb);
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_sync_billing_order_to_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_stage uuid; v_from text; v_changed integer; v_label text;
BEGIN
  IF new.status IS NOT DISTINCT FROM old.status
     AND new.paid_at IS NOT DISTINCT FROM old.paid_at
     AND new.billing_environment IS NOT DISTINCT FROM old.billing_environment THEN
    RETURN new;
  END IF;
  IF new.status='paid' THEN
    IF public.crm_postsale_bridge_ready() THEN
      IF new.paid_at IS NULL OR new.billing_environment IS DISTINCT FROM 'live' THEN
        RETURN new;
      END IF;
      SELECT settings.commercial_won_stage_id INTO v_stage
      FROM public.crm_postsale_bridge_settings settings WHERE settings.id;
    ELSE
      SELECT id INTO v_stage FROM public.crm_records
      WHERE kind='stage' AND NOT deleted AND data->>'outcome'='won'
      ORDER BY (data->>'position')::numeric,id LIMIT 1;
    END IF;
    IF v_stage IS NULL THEN RAISE EXCEPTION 'Etapa de ganho indisponível.'; END IF;
    SELECT data->>'stage_id' INTO v_from FROM public.crm_records
      WHERE id=new.deal_id FOR UPDATE;
    UPDATE public.crm_records SET
      data=data||jsonb_build_object(
        'stage_id',v_stage,'checkout_state','paid',
        'next_action',jsonb_build_object('title','Iniciar implantação','done',false,'updated_at',now())
      ),revision=revision+1
    WHERE id=new.deal_id AND kind='deal' AND NOT deleted;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed=1 AND v_from IS DISTINCT FROM v_stage::text THEN
      INSERT INTO public.crm_events(deal_id,event_type,actor_label,detail)
      VALUES(new.deal_id,'stage_changed','Sistema ORYNEO',
        jsonb_build_object('from',v_from,'to',v_stage,'reason','Pagamento confirmado','order_id',new.id));
    ELSIF v_changed=1 THEN
      INSERT INTO public.crm_events(deal_id,event_type,actor_label,detail)
      VALUES(new.deal_id,'activity','Sistema ORYNEO',
        jsonb_build_object('text','Pagamento confirmado','order_id',new.id));
    END IF;
    UPDATE public.crm_checkout_drafts SET
      state='paid',last_activity_at=now(),updated_at=now()
    WHERE deal_id=new.deal_id;
  ELSIF new.status IN ('payment_failed','expired') THEN
    v_label=CASE new.status WHEN 'payment_failed' THEN 'Pagamento não confirmado'
      ELSE 'Sessão de pagamento expirada' END;
    UPDATE public.crm_records deal SET
      data=data||jsonb_build_object(
        'checkout_state',new.status,
        'next_action',jsonb_build_object('title','Retomar pagamento','done',false,'updated_at',now())
      ),revision=revision+1
    WHERE deal.id=new.deal_id AND deal.kind='deal' AND NOT deal.deleted
      AND EXISTS(SELECT 1 FROM public.crm_records stage
        WHERE stage.id=(deal.data->>'stage_id')::uuid AND stage.data->>'outcome'='open');
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed=1 THEN
      INSERT INTO public.crm_events(deal_id,event_type,actor_label,detail)
      VALUES(new.deal_id,'activity','Sistema ORYNEO',
        jsonb_build_object('text',v_label,'order_id',new.id));
    END IF;
    UPDATE public.crm_checkout_drafts SET
      state=new.status,last_activity_at=now(),updated_at=now()
    WHERE deal_id=new.deal_id AND state<>'paid';
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_sync_billing_order_to_deal()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS crm_billing_order_sync_deal ON public.crm_billing_orders;
CREATE TRIGGER crm_billing_order_sync_deal
AFTER UPDATE OF status,paid_at,billing_environment ON public.crm_billing_orders
FOR EACH ROW EXECUTE FUNCTION public.crm_sync_billing_order_to_deal();

CREATE OR REPLACE FUNCTION public.crm_pause_delivery_on_payment_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_changed integer:=0;
BEGIN
  IF old.status='paid' AND old.paid_at IS NOT NULL
     AND old.billing_environment='live'
     AND (new.status IS DISTINCT FROM 'paid' OR new.paid_at IS NULL
          OR new.billing_environment IS DISTINCT FROM 'live') THEN
    UPDATE public.crm_delivery_projects SET status='paused',updated_at=clock_timestamp()
    WHERE order_id=new.id AND status<>'completed' AND status<>'paused';
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed=1 THEN
      INSERT INTO public.crm_delivery_audit(order_id,action,detail)
      VALUES(new.id,'delivery_paused_payment_reversed',
        jsonb_build_object('from_status',old.status,'to_status',new.status));
    END IF;
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION public.crm_pause_delivery_on_payment_reversal()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS crm_pause_delivery_on_payment_reversal ON public.crm_billing_orders;
CREATE TRIGGER crm_pause_delivery_on_payment_reversal
AFTER UPDATE OF status,paid_at,billing_environment ON public.crm_billing_orders
FOR EACH ROW EXECUTE FUNCTION public.crm_pause_delivery_on_payment_reversal();

CREATE OR REPLACE FUNCTION public.crm_update_delivery_milestone(
 p_order_id uuid,p_milestone_id uuid,p_state text,p_due_at timestamptz,p_note text,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_old public.crm_delivery_milestones; v_new public.crm_delivery_milestones;
BEGIN
 IF p_state NOT IN ('pending','in_progress','completed','blocked')
   OR p_order_id IS NULL OR p_milestone_id IS NULL OR p_actor IS NULL
   OR length(coalesce(p_note,''))>1000 THEN
   RETURN jsonb_build_object('ok',false,'reason','invalid_input'); END IF;
 IF NOT EXISTS (SELECT 1 FROM public.crm_members WHERE user_id=p_actor) THEN
   RETURN jsonb_build_object('ok',false,'reason','not_authorized'); END IF;
 IF NOT EXISTS (SELECT 1 FROM public.crm_billing_orders bill
   WHERE bill.id=p_order_id AND bill.status='paid' AND bill.paid_at IS NOT NULL
     AND bill.billing_environment='live') THEN
   RETURN jsonb_build_object('ok',false,'reason','payment_not_verified'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text,20261017));
 SELECT * INTO v_old FROM public.crm_delivery_milestones
  WHERE id=p_milestone_id AND order_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','milestone_not_found'); END IF;
 UPDATE public.crm_delivery_milestones SET
  state=p_state,due_at=p_due_at,note=nullif(trim(coalesce(p_note,'')),''),
  completed_at=CASE WHEN p_state='completed' THEN coalesce(v_old.completed_at,now()) ELSE NULL END,
  updated_at=now()
 WHERE id=p_milestone_id AND order_id=p_order_id RETURNING * INTO v_new;
 UPDATE public.crm_delivery_projects SET
  status=CASE
    WHEN NOT EXISTS(SELECT 1 FROM public.crm_delivery_milestones WHERE order_id=p_order_id AND state<>'completed') THEN 'completed'
    WHEN EXISTS(SELECT 1 FROM public.crm_delivery_milestones WHERE order_id=p_order_id AND state IN ('completed','in_progress')) THEN 'in_progress'
    ELSE 'pending_kickoff' END,
  started_at=CASE WHEN p_state IN ('completed','in_progress') THEN coalesce(started_at,now()) ELSE started_at END,
  completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM public.crm_delivery_milestones WHERE order_id=p_order_id AND state<>'completed') THEN coalesce(completed_at,now()) ELSE NULL END,
  updated_at=now()
 WHERE order_id=p_order_id;
 INSERT INTO public.crm_delivery_audit(order_id,actor,action,detail)
 VALUES(p_order_id,p_actor,'milestone_updated',
   jsonb_build_object('milestone_id',p_milestone_id,'position',v_old.position,
     'from',v_old.state,'to',v_new.state,'old_due_at',v_old.due_at,'new_due_at',v_new.due_at));
 RETURN jsonb_build_object('ok',true,'state',v_new.state);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_update_delivery_milestone(uuid,uuid,text,timestamptz,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_delivery_milestone(uuid,uuid,text,timestamptz,text,uuid)
 TO service_role;

-- Enable only after the transaction proves the expected production identities
-- and that no unsafe historical state would be replayed.
DO $guard$
DECLARE v_safe boolean;
BEGIN
  SELECT
    EXISTS(SELECT 1 FROM public.crm_records WHERE id='6ab321bd-5ec4-4dfc-b8c0-4824da854273'
      AND kind='stage' AND NOT deleted AND data->>'name'='Ganha' AND data->>'outcome'='won')
    AND EXISTS(SELECT 1 FROM public.crm_records WHERE id='a623469a-34c8-4c21-9a44-7e20cc7df502'
      AND kind='stage' AND NOT deleted AND data->>'name'='Implantação' AND data->>'outcome'='won')
    AND NOT EXISTS(SELECT 1 FROM public.crm_records WHERE kind='deal' AND NOT deleted
      AND data->>'stage_id'='a623469a-34c8-4c21-9a44-7e20cc7df502')
    AND NOT EXISTS(SELECT 1 FROM public.crm_delivery_projects project
      LEFT JOIN public.crm_billing_orders bill ON bill.id=project.order_id
      WHERE bill.id IS NULL OR bill.status<>'paid' OR bill.paid_at IS NULL
        OR bill.billing_environment IS DISTINCT FROM 'live')
  INTO v_safe;
  IF NOT v_safe THEN
    RAISE EXCEPTION 'POSTSALE_BRIDGE_PREFLIGHT_FAILED';
  END IF;
  PERFORM public.crm_postsale_bridge_set_enabled(true,
    'Mapeamento verificado; zero replay histórico e gatilho legado preservado',NULL);
END
$guard$;
