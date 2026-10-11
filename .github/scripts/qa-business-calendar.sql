do $$
begin
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if not public.crm_is_business_time('2026-10-13 12:00:00+00') then
  raise exception 'Terça 9h em São Paulo deveria estar aberta';
 end if;
 if public.crm_is_business_time('2026-10-12 15:00:00+00') then
  raise exception 'Feriado nacional deveria estar fechado';
 end if;
 if public.crm_is_business_time('2026-10-17 15:00:00+00') then
  raise exception 'Sábado deveria estar fechado';
 end if;
 if public.crm_is_business_time('2026-10-13 21:00:00+00') then
  raise exception '18h em São Paulo deveria estar fechado';
 end if;
end $$;
