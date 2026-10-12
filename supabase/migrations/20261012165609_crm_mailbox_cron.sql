create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $cleanup$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='crm-mail-sync-every-minute';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$cleanup$;

select cron.schedule(
  'crm-mail-sync-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/mail-sync',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-oryneo-cron',(select decrypted_secret from vault.decrypted_secrets where name='oryneo_mail_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
  $job$
);
