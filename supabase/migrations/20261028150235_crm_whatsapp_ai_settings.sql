create table public.crm_wa_ai_settings (
  channel_id uuid primary key references public.crm_wa_channels(id) on delete cascade,
  provider text not null default 'openai' check (provider in ('openai','anthropic')),
  model text not null default 'gpt-5-mini' check (length(model) between 1 and 100),
  mode text not null default 'off' check (mode in ('off','suggest','auto')),
  system_prompt text not null default 'Você é o SDR da ORYNEO. Responda em português do Brasil com linguagem leve, direta e educada. Faça uma pergunta por vez, entenda o contexto do negócio e conduza para um diagnóstico com uma pessoa da equipe. Não invente preços, prazos, funcionalidades ou garantias. Quando não tiver certeza, encaminhe para atendimento humano.',
  api_secret_id uuid,
  api_key_last_four text check (api_key_last_four is null or api_key_last_four ~ '^[A-Za-z0-9_-]{4}$'),
  updated_by uuid references public.crm_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_wa_ai_settings enable row level security;
revoke all on public.crm_wa_ai_settings from public, anon, authenticated;
grant select,insert,update on public.crm_wa_ai_settings to service_role;

create or replace function public.crm_wa_ai_store_secret(p_channel_id uuid,p_secret text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_name text;
begin
  if length(trim(p_secret)) < 20 or length(p_secret) > 500 then
    raise exception 'Chave de API inválida.' using errcode='22023';
  end if;
  select s.api_secret_id into v_id from public.crm_wa_ai_settings s where s.channel_id=p_channel_id for update;
  if not found then raise exception 'Configuração não encontrada.' using errcode='P0002'; end if;
  v_name='crm_wa_ai_'||replace(p_channel_id::text,'-','');
  if v_id is null then
    v_id=vault.create_secret(p_secret,v_name,'Chave do provedor de IA do WhatsApp ORYNEO');
  else
    perform vault.update_secret(v_id,p_secret,v_name,'Chave do provedor de IA do WhatsApp ORYNEO');
  end if;
  update public.crm_wa_ai_settings set api_secret_id=v_id,api_key_last_four=right(p_secret,4),updated_at=now() where channel_id=p_channel_id;
  return v_id;
end;
$$;
revoke all on function public.crm_wa_ai_store_secret(uuid,text) from public,anon,authenticated;
grant execute on function public.crm_wa_ai_store_secret(uuid,text) to service_role;

create or replace function public.crm_wa_ai_get_secret(p_channel_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select v.decrypted_secret
  from public.crm_wa_ai_settings s
  join vault.decrypted_secrets v on v.id=s.api_secret_id
  where s.channel_id=p_channel_id
$$;
revoke all on function public.crm_wa_ai_get_secret(uuid) from public,anon,authenticated;
grant execute on function public.crm_wa_ai_get_secret(uuid) to service_role;

insert into public.crm_wa_ai_settings(channel_id)
select id from public.crm_wa_channels
on conflict(channel_id) do nothing;
