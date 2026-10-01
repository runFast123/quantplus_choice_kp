-- Source: quantspulse_supabase_schema.md §5.12 Storage (contract notes)
-- =====================================================================
-- 5.12 Private bucket; path = '{user_id}/{import_id}.{ext}'
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-notes', 'contract-notes', false, 10485760,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

create policy contract_notes_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contract-notes'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy contract_notes_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-notes'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy contract_notes_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'contract-notes'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
