-- Scheduled jobs (pg_cron) and the private photo bucket. Both are skipped where the extension/schema is missing
-- (e.g. the PGlite test database). Jobs that call Edge Functions over HTTP are in supabase/sql/schedule_http_jobs.sql.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Times are UTC; Cameroon is UTC+1.
    perform cron.schedule('cleancity-weekly-selection', '0 7 * * 1', 'select public.weekly_job()');   -- Monday 08:00 Douala
    perform cron.schedule('cleancity-expire-invites', '*/15 * * * *', 'select public.expire_invites()');
    perform cron.schedule('cleancity-reminders', '0 17 * * 5', 'select public.queue_reminders()');    -- Friday 18:00 Douala
  else
    raise notice 'pg_cron not available: schedule weekly_job / expire_invites / queue_reminders yourself';
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('shift-photos', 'shift-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do nothing;
    -- Supervisors upload to shifts/<shift id>/...; supervisors of that shift and admins can read.
    execute $p$create policy shift_photos_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'shift-photos' and (storage.foldername(name))[1] = 'shifts'
        and public.can_supervise(((storage.foldername(name))[2])::uuid))$p$;
    execute $p$create policy shift_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'shift-photos' and (storage.foldername(name))[1] = 'shifts'
        and public.can_supervise(((storage.foldername(name))[2])::uuid))$p$;
  end if;
end $$;
