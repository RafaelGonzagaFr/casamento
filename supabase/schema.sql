-- Execute uma vez no SQL Editor de um projeto Supabase vazio.
-- Não substitui nem apaga tabelas de um projeto Laravel existente.
begin;
create table public.admin_users (
 id uuid primary key references auth.users(id) on delete cascade,
 name varchar(255) not null,
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.invitations (
 id bigint generated always as identity primary key,
 name varchar(255) not null, max_guests smallint not null default 1 check(max_guests between 1 and 95),
 is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.invitation_tokens (
 id bigint generated always as identity primary key,
 invitation_id bigint not null references public.invitations(id),
 token_hash varchar(64) not null unique, expires_at timestamptz, revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index on public.invitation_tokens(invitation_id);
create table public.guests (
 id bigint generated always as identity primary key,
 invitation_id bigint not null references public.invitations(id), name varchar(255) not null,
 rsvp_status text not null default 'PENDING' check(rsvp_status in ('PENDING','ATTENDING','DECLINED')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on public.guests(invitation_id,rsvp_status);
create table public.gift_categories (
 id bigint generated always as identity primary key, name varchar(255) not null unique,
 sort_order integer not null default 0, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table public.gifts (
 id bigint generated always as identity primary key, public_id uuid not null default gen_random_uuid() unique,
 category_id bigint not null references public.gift_categories(id), name varchar(255) not null,
 description text, image_path text, estimated_price numeric(10,2) check(estimated_price >= 0), external_url text,
 is_active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on public.gifts(category_id,is_active,sort_order);
create table public.gift_reservations (
 id bigint generated always as identity primary key, gift_id bigint not null references public.gifts(id),
 invitation_id bigint not null references public.invitations(id), reserved_at timestamptz not null default now(),
 cancelled_at timestamptz check(cancelled_at is null or cancelled_at >= reserved_at)
);
create unique index gift_reservations_active_gift_unique on public.gift_reservations(gift_id) where cancelled_at is null;
create unique index gift_reservations_active_invitation_unique on public.gift_reservations(invitation_id) where cancelled_at is null;
create index on public.gift_reservations(gift_id,reserved_at);
create index on public.gift_reservations(invitation_id,reserved_at);
create table public.wedding_settings (key text primary key, value text, updated_at timestamptz not null default now());
insert into public.wedding_settings(key,value) values
 ('guest_limit','95'), ('couple_names','Rafael & Maria'), ('wedding_date',null),
 ('rsvp_deadline_at',null), ('welcome_message',null);
create table public.activity_logs (
 id bigint generated always as identity primary key, actor_type text not null, actor_id text,
 action text not null, entity_type text not null, entity_id bigint, metadata jsonb,
 created_at timestamptz not null default now()
);
create index on public.activity_logs(entity_type,entity_id,created_at);
create table public.app_sessions (
 token_hash varchar(64) primary key, csrf_token varchar(64) not null,
 admin_id uuid references public.admin_users(id) on delete cascade,
 invitation_id bigint references public.invitations(id), invitation_token_id bigint references public.invitation_tokens(id),
 expires_at timestamptz not null,
 check ((admin_id is not null and invitation_id is null and invitation_token_id is null)
     or (admin_id is null and invitation_id is not null and invitation_token_id is not null))
);
create index on public.app_sessions(expires_at);

-- Escritas ocorrem em uma função: uma chamada REST = uma transação PostgreSQL.
-- SECURITY INVOKER e acesso exclusivo de service_role; autorização também é feita no Node.
create function public.wedding_mutate(p_action text, p_data jsonb default '{}'::jsonb,
 p_invitation bigint default null, p_admin uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 inv public.invitations; gift public.gifts; reservation public.gift_reservations;
 row_id bigint; total_limit integer; deadline text; result jsonb; setting_key text;
begin
 if p_admin is not null then
  if not exists(select 1 from public.admin_users where id=p_admin and is_active) then
   raise exception using errcode='42501', message='Acesso administrativo negado.';
  end if;
 elsif p_action not in ('rsvp','reserve','swap','cancel') then
  raise exception using errcode='42501', message='Acesso administrativo necessário.';
 end if;

 -- Limite global é bloqueado antes do convite, sempre na mesma ordem.
 if p_action='guest.create' then
  select value::integer into total_limit from public.wedding_settings where key='guest_limit' for update;
  if (select count(*) from public.guests where deleted_at is null) >= total_limit then
   raise exception 'Limite total de convidados atingido.';
  end if;
 end if;
 if p_invitation is not null then
  select * into inv from public.invitations where id=p_invitation and deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='Convite não encontrado.'; end if;
  if p_admin is null and not inv.is_active then
   raise exception using errcode='42501', message='Convite inativo.';
  end if;
 elsif p_action in ('rsvp','reserve','swap','cancel') then
  raise exception using errcode='42501', message='Abra seu convite antes de continuar.';
 end if;

 case p_action
 when 'rsvp' then
  select value into deadline from public.wedding_settings where key='rsvp_deadline_at';
  if deadline is not null and now()>deadline::timestamptz then raise exception 'O prazo de confirmação terminou.'; end if;
  update public.guests set rsvp_status=p_data->>'rsvp_status',updated_at=now()
   where id=(p_data->>'guest_id')::bigint and invitation_id=p_invitation and deleted_at is null returning id into row_id;
  if not found then raise exception using errcode='P0002',message='Pessoa não encontrada neste convite.'; end if;
  insert into public.activity_logs(actor_type,actor_id,action,entity_type,entity_id,metadata)
   values('INVITATION',p_invitation::text,'guest.rsvp.updated','Guest',row_id,jsonb_build_object('status',p_data->>'rsvp_status'));
 when 'reserve','swap' then
  if p_action='reserve' then
   if not exists(select 1 from public.guests where invitation_id=p_invitation and deleted_at is null and rsvp_status='ATTENDING') then
    raise exception 'Confirme a presença de ao menos uma pessoa antes de escolher um presente.';
   end if;
   if exists(select 1 from public.gift_reservations where invitation_id=p_invitation and cancelled_at is null) then
    raise exception 'Você já possui um presente escolhido.';
   end if;
  else
   select * into reservation from public.gift_reservations where invitation_id=p_invitation and cancelled_at is null for update;
   if not found then raise exception 'Você não possui presente para trocar.'; end if;
  end if;
  select * into gift from public.gifts where public_id=(p_data->>'gift_public_id')::uuid and deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='Presente não encontrado.'; end if;
  if p_action='swap' and gift.id=reservation.gift_id then raise exception 'Escolha outro presente.'; end if;
  if not gift.is_active then raise exception 'Esse presente não está mais disponível.'; end if;
  if exists(select 1 from public.gift_reservations where gift_id=gift.id and cancelled_at is null) then
   raise exception 'Esse presente acabou de ser escolhido por outro convite.';
  end if;
  if p_action='swap' then update public.gift_reservations set cancelled_at=now() where id=reservation.id; end if;
  insert into public.gift_reservations(gift_id,invitation_id) values(gift.id,p_invitation) returning id into row_id;
 when 'cancel' then
  update public.gift_reservations r set cancelled_at=now() from public.gifts g
   where r.gift_id=g.id and g.public_id=(p_data->>'gift_public_id')::uuid and r.invitation_id=p_invitation and r.cancelled_at is null returning r.id into row_id;
  if not found then raise exception using errcode='P0002',message='Reserva não encontrada neste convite.'; end if;
 when 'invitation.create' then
  insert into public.invitations(name,max_guests) values(p_data->>'name',(p_data->>'max_guests')::integer) returning id into row_id;
 when 'invitation.update' then
  if (p_data->>'max_guests')::integer < (select count(*) from public.guests where invitation_id=p_invitation and deleted_at is null) then
   raise exception 'O limite é menor que a quantidade de pessoas cadastradas.';
  end if;
  update public.invitations set name=p_data->>'name',max_guests=(p_data->>'max_guests')::integer,
   is_active=(p_data->>'is_active')::boolean,updated_at=now() where id=p_invitation;
  row_id:=p_invitation;
 when 'token.issue' then
  insert into public.invitation_tokens(invitation_id,token_hash) values(p_invitation,p_data->>'token_hash') returning id into row_id;
  insert into public.activity_logs(actor_type,actor_id,action,entity_type,entity_id)
   values('ADMIN_USER',p_admin::text,'invitation.token.issued','Invitation',p_invitation);
 when 'token.revoke' then
  update public.invitation_tokens set revoked_at=now() where id=(p_data->>'token_id')::bigint and invitation_id=p_invitation returning id into row_id;
  if not found then raise exception using errcode='P0002',message='Link não encontrado.'; end if;
  delete from public.app_sessions where invitation_token_id=row_id;
 when 'guest.create' then
  if (select count(*) from public.guests where invitation_id=p_invitation and deleted_at is null)>=inv.max_guests then
   raise exception 'Limite de convidados deste convite atingido.';
  end if;
  insert into public.guests(invitation_id,name) values(p_invitation,p_data->>'name') returning id into row_id;
 when 'guest.update','guest.delete' then
  update public.guests set name=case when p_action='guest.update' then p_data->>'name' else name end,
   deleted_at=case when p_action='guest.delete' then now() else null end,updated_at=now()
   where id=(p_data->>'guest_id')::bigint and invitation_id=p_invitation and deleted_at is null returning id into row_id;
  if not found then raise exception using errcode='P0002',message='Pessoa não encontrada.'; end if;
 when 'category.create' then
  insert into public.gift_categories(name,sort_order) values(p_data->>'name',coalesce((p_data->>'sort_order')::integer,0)) returning id into row_id;
 when 'category.update','category.delete' then
  row_id:=(p_data->>'category_id')::bigint;
  perform 1 from public.gift_categories where id=row_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Categoria não encontrada.'; end if;
  if p_action='category.delete' then
   if exists(select 1 from public.gifts where category_id=row_id) then raise exception 'Categoria com presentes não pode ser arquivada.'; end if;
   update public.gift_categories set deleted_at=now(),updated_at=now() where id=row_id;
  else
   update public.gift_categories set name=p_data->>'name',sort_order=(p_data->>'sort_order')::integer,updated_at=now() where id=row_id;
  end if;
 when 'gift.create','gift.update','gift.delete' then
  if p_action='gift.create' or (p_action='gift.update' and p_data ? 'category_id') then
   perform 1 from public.gift_categories where id=(p_data->>'category_id')::bigint and deleted_at is null for share;
   if not found then raise exception 'Selecione uma categoria ativa.'; end if;
  end if;
  if p_action='gift.create' then
   insert into public.gifts(category_id,name,description,image_path,estimated_price,external_url,is_active,sort_order)
   values((p_data->>'category_id')::bigint,p_data->>'name',p_data->>'description',p_data->>'image_path',
    (p_data->>'estimated_price')::numeric,p_data->>'external_url',coalesce((p_data->>'is_active')::boolean,true),coalesce((p_data->>'sort_order')::integer,0))
   returning id into row_id;
  else
   select * into gift from public.gifts where public_id=(p_data->>'gift_public_id')::uuid and deleted_at is null for update;
   if not found then raise exception using errcode='P0002',message='Presente não encontrado.'; end if;
   if exists(select 1 from public.gift_reservations where gift_id=gift.id and cancelled_at is null) then
    if p_action='gift.delete' then raise exception 'Libere a reserva antes de arquivar o presente.'; end if;
    if p_data ? 'name' and p_data->>'name'<>gift.name then raise exception 'Não é possível renomear um presente reservado.'; end if;
   end if;
   row_id:=gift.id;
   if p_action='gift.delete' then
    update public.gifts set deleted_at=now(),updated_at=now() where id=row_id;
   else
    update public.gifts set name=coalesce(p_data->>'name',name), category_id=case when p_data ? 'category_id' then (p_data->>'category_id')::bigint else category_id end,
     description=case when p_data ? 'description' then p_data->>'description' else description end,
     external_url=case when p_data ? 'external_url' then p_data->>'external_url' else external_url end,
     estimated_price=case when p_data ? 'estimated_price' then (p_data->>'estimated_price')::numeric else estimated_price end,
     image_path=case when p_data ? 'image_path' then p_data->>'image_path' else image_path end,
     is_active=coalesce((p_data->>'is_active')::boolean,is_active),sort_order=coalesce((p_data->>'sort_order')::integer,sort_order),updated_at=now()
    where id=row_id;
   end if;
  end if;
 when 'reservation.cancel' then
  -- Mesma ordem de locks: convite, depois reserva.
  select invitation_id into row_id from public.gift_reservations where id=(p_data->>'reservation_id')::bigint;
  if not found then raise exception using errcode='P0002',message='Reserva não encontrada.'; end if;
  perform 1 from public.invitations where id=row_id for update;
  select * into reservation from public.gift_reservations where id=(p_data->>'reservation_id')::bigint for update;
  if reservation.cancelled_at is not null then raise exception 'Esta reserva já foi liberada.'; end if;
  update public.gift_reservations set cancelled_at=now() where id=reservation.id;
  row_id:=reservation.id;
  insert into public.activity_logs(actor_type,actor_id,action,entity_type,entity_id,metadata)
   values('ADMIN_USER',p_admin::text,'gift_reservation.cancelled','GiftReservation',row_id,
    jsonb_build_object('gift_id',reservation.gift_id,'invitation_id',reservation.invitation_id,'reason',p_data->>'reason'));
 when 'settings.update' then
  foreach setting_key in array array['couple_names','wedding_date','rsvp_deadline_at','welcome_message'] loop
   if p_data ? setting_key then
    update public.wedding_settings set value=p_data->>setting_key,updated_at=now() where key=setting_key;
   end if;
  end loop;
 else raise exception 'Operação desconhecida.';
 end case;
 return jsonb_build_object('id',row_id);
end;
$$;

-- Views respeitam RLS do chamador, sem acesso anon/authenticated.
create view public.invitation_summary with (security_invoker=true) as
 select i.*, count(g.id)::integer as guests_count,
 count(g.id) filter(where g.rsvp_status='ATTENDING')::integer as attending_count
 from public.invitations i left join public.guests g on g.invitation_id=i.id and g.deleted_at is null
 where i.deleted_at is null group by i.id;
create view public.gift_summary with (security_invoker=true) as
 select g.*,c.name as category_name,r.id as reservation_id,i.name as reserved_by
 from public.gifts g join public.gift_categories c on c.id=g.category_id
 left join public.gift_reservations r on r.gift_id=g.id and r.cancelled_at is null
 left join public.invitations i on i.id=r.invitation_id where g.deleted_at is null;
create view public.available_gifts with (security_invoker=true) as
 select g.*,c.name as category_name from public.gifts g join public.gift_categories c on c.id=g.category_id
 where g.is_active and g.deleted_at is null
 and not exists(select 1 from public.gift_reservations r where r.gift_id=g.id and r.cancelled_at is null);
create function public.wedding_dashboard() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object(
  'invitations',(select count(*) from public.invitations where deleted_at is null),
  'guests',(select count(*) from public.guests where deleted_at is null),
  'attending',(select count(*) from public.guests where deleted_at is null and rsvp_status='ATTENDING'),
  'pending',(select count(*) from public.guests where deleted_at is null and rsvp_status='PENDING'),
  'declined',(select count(*) from public.guests where deleted_at is null and rsvp_status='DECLINED'),
  'gifts',(select count(*) from public.gifts where deleted_at is null),
  'reserved',(select count(*) from public.gift_reservations where cancelled_at is null),
  'guest_limit',(select value::integer from public.wedding_settings where key='guest_limit'));
$$;
revoke all on public.invitation_summary,public.gift_summary,public.available_gifts from anon,authenticated;
grant select on public.invitation_summary,public.gift_summary,public.available_gifts to service_role;
revoke all on function public.wedding_dashboard() from public,anon,authenticated;
grant execute on function public.wedding_dashboard() to service_role;

-- Nenhuma lista de convidados, sessão ou RPC é acessível diretamente pelo navegador.
do $$
declare t text;
begin
 foreach t in array array['admin_users','invitations','invitation_tokens','guests','gift_categories','gifts','gift_reservations','wedding_settings','activity_logs','app_sessions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.wedding_mutate(text,jsonb,bigint,uuid) from public, anon, authenticated;
grant execute on function public.wedding_mutate(text,jsonb,bigint,uuid) to service_role;
commit;
