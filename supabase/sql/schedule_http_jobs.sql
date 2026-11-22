-- Run once in the Supabase SQL editor AFTER deploying the `notify` and `payouts-process` Edge Functions.
-- Requires the pg_cron, pg_net and supabase_vault extensions (Database > Extensions).
-- Store your project's values in Vault first (they are kept encrypted); replace the placeholders:
--   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'service_role_key');
-- The pure-SQL jobs (weekly selection, deadline expiry, Friday reminders) are created by migration 4.

select cron.schedule('cleancity-notify', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 8000)
  where exists (select 1 from public.notifications where status = 'pending');
$$);

select cron.schedule('cleancity-payouts', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/payouts-process',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
  where exists (select 1 from public.payout_requests where status in ('approved', 'processing'));
$$);

-- Check: select * from cron.job; select * from cron.job_run_details order by start_time desc limit 20;
-- Stop:  select cron.unschedule('cleancity-notify'); select cron.unschedule('cleancity-payouts');
