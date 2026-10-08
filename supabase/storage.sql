-- Execute após schema.sql. Somente fotos de presentes ficam públicas.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('wedding-gifts','wedding-gifts',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
-- Sem políticas de upload para anon/authenticated. O backend usa a chave secreta.
