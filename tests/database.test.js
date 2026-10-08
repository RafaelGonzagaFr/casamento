import { before,after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase,reset,mutate,family,gift,ADMIN } from './helpers.js';
let db;
before(async () => { db = await createDatabase(); });
after(async () => { await db?.close(); });
beforeEach(async () => reset(db));
const guestAction = (action,data,invitation) => mutate(db,action,data,invitation,null);
const active = async inv => (await db.query('select * from public.gift_reservations where invitation_id=$1 and cancelled_at is null',[inv])).rows;

test('RSVP exige propriedade e respeita prazo com fuso',async () => {
 const a=await family(db,'A','PENDING'), b=await family(db,'B','PENDING');
 await assert.rejects(guestAction('rsvp',{guest_id:b.guestId,rsvp_status:'ATTENDING'},a.id),/Pessoa não encontrada/);
 await guestAction('rsvp',{guest_id:a.guestId,rsvp_status:'ATTENDING'},a.id);
 await db.exec("update public.wedding_settings set value='2000-01-01T20:00:00-03:00' where key='rsvp_deadline_at'");
 await assert.rejects(guestAction('rsvp',{guest_id:a.guestId,rsvp_status:'DECLINED'},a.id),/prazo/);
 assert.equal((await db.query('select rsvp_status from public.guests where id=$1',[a.guestId])).rows[0].rsvp_status,'ATTENDING');
});
test('reserva exige presença, é única por convite e por item e só dono cancela',async () => {
 const a=await family(db,'A','PENDING'),b=await family(db,'B');const one=await gift(db),two=await gift(db,'Outro');
 await assert.rejects(guestAction('reserve',{gift_public_id:one.public_id},a.id),/Confirme/);
 await guestAction('rsvp',{guest_id:a.guestId,rsvp_status:'ATTENDING'},a.id);
 await guestAction('reserve',{gift_public_id:one.public_id},a.id);
 await assert.rejects(guestAction('reserve',{gift_public_id:two.public_id},a.id),/já possui/);
 await assert.rejects(guestAction('reserve',{gift_public_id:one.public_id},b.id),/outro convite/);
 await assert.rejects(guestAction('cancel',{gift_public_id:one.public_id},b.id),/Reserva não encontrada/);
 await guestAction('cancel',{gift_public_id:one.public_id},a.id);
 await guestAction('reserve',{gift_public_id:one.public_id},b.id);
 assert.equal((await active(b.id))[0].gift_id,one.id);
});
test('troca falha preserva escolha e troca válida funciona após RSVP recusado',async () => {
 const a=await family(db,'A'),b=await family(db,'B');const old=await gift(db,'Antigo'),next=await gift(db,'Novo'),busy=await gift(db,'Ocupado');
 await guestAction('reserve',{gift_public_id:old.public_id},a.id);
 await guestAction('reserve',{gift_public_id:busy.public_id},b.id);
 await assert.rejects(guestAction('swap',{gift_public_id:busy.public_id},a.id),/outro convite/);
 assert.equal((await active(a.id))[0].gift_id,old.id);
 await guestAction('rsvp',{guest_id:a.guestId,rsvp_status:'DECLINED'},a.id);
 await guestAction('swap',{gift_public_id:next.public_id},a.id);
 assert.equal((await active(a.id))[0].gift_id,next.id);
 await guestAction('cancel',{gift_public_id:next.public_id},a.id);
 await assert.rejects(guestAction('reserve',{gift_public_id:old.public_id},a.id),/Confirme/);
});
test('erro de banco no INSERT da troca desfaz o cancelamento anterior',async () => {
 const a=await family(db);const old=await gift(db),next=await gift(db,'Novo');
 await guestAction('reserve',{gift_public_id:old.public_id},a.id);
 await db.exec(`create function public.force_failure() returns trigger language plpgsql as $$ begin if NEW.gift_id=${next.id} then raise exception 'falha forçada'; end if; return NEW; end $$; create trigger failure before insert on public.gift_reservations for each row execute function public.force_failure();`);
 try { await assert.rejects(guestAction('swap',{gift_public_id:next.public_id},a.id),/falha forçada/); assert.equal((await active(a.id))[0].gift_id,old.id); }
 finally { await db.exec('drop trigger failure on public.gift_reservations; drop function public.force_failure();'); }
});
test('índices parciais barram escrita direta que duplica convite ou presente',async () => {
 const a=await family(db),b=await family(db,'B');const one=await gift(db),two=await gift(db,'Dois');
 await guestAction('reserve',{gift_public_id:one.public_id},a.id);
 await assert.rejects(db.query('insert into public.gift_reservations(gift_id,invitation_id) values($1,$2)',[one.id,b.id]),error=>error.code==='23505');
 await assert.rejects(db.query('insert into public.gift_reservations(gift_id,invitation_id) values($1,$2)',[two.id,a.id]),error=>error.code==='23505');
});
test('presentes reservados não podem mudar de nome ou ser arquivados',async () => {
 const a=await family(db);const one=await gift(db);
 await guestAction('reserve',{gift_public_id:one.public_id},a.id);
 await assert.rejects(mutate(db,'gift.update',{gift_public_id:one.public_id,name:'Novo nome',category_id:one.category_id}),/renomear/);
 await assert.rejects(mutate(db,'gift.delete',{gift_public_id:one.public_id}),/Libere/);
 await mutate(db,'gift.update',{gift_public_id:one.public_id,category_id:one.category_id,description:'Descrição alterada'});
 const reservation=(await active(a.id))[0];
 await mutate(db,'reservation.cancel',{reservation_id:reservation.id,reason:'Pedido dos noivos'});
 await mutate(db,'gift.delete',{gift_public_id:one.public_id});
 const log=(await db.query("select metadata from public.activity_logs where action='gift_reservation.cancelled'")).rows[0];
 assert.equal(log.metadata.reason,'Pedido dos noivos');
 assert.equal((await db.query('select count(*)::integer as count from public.available_gifts')).rows[0].count,0);
});
test('limites por convite, global e redução abaixo das pessoas cadastradas',async () => {
 const a=await family(db,'A','PENDING',1);
 await assert.rejects(mutate(db,'guest.create',{name:'Segundo'},a.id),/deste convite/);
 await mutate(db,'invitation.update',{name:'A',max_guests:2,is_active:true},a.id);
 await mutate(db,'guest.create',{name:'Segundo'},a.id);
 await assert.rejects(mutate(db,'invitation.update',{name:'A',max_guests:1,is_active:true},a.id),/menor/);
 await db.exec("update public.wedding_settings set value='2' where key='guest_limit'");
 const b=await mutate(db,'invitation.create',{name:'B',max_guests:2});
 await assert.rejects(mutate(db,'guest.create',{name:'Terceiro'},b.id),/total/);
 await mutate(db,'guest.delete',{guest_id:a.guestId},a.id);
 await mutate(db,'guest.create',{name:'Terceiro'},b.id);
});
test('inativos, categorias utilizadas e admins não autorizados são barrados',async () => {
 const a=await family(db);const one=await gift(db);
 await mutate(db,'gift.update',{gift_public_id:one.public_id,category_id:one.category_id,is_active:false});
 await assert.rejects(guestAction('reserve',{gift_public_id:one.public_id},a.id),/disponível/);
 await assert.rejects(mutate(db,'category.delete',{category_id:one.category_id}),/com presentes/);
 await mutate(db,'invitation.update',{name:'A',max_guests:2,is_active:false},a.id);
 await assert.rejects(guestAction('rsvp',{guest_id:a.guestId,rsvp_status:'ATTENDING'},a.id),/inativo/);
 await assert.rejects(mutate(db,'invitation.create',{name:'Sem permissão',max_guests:1},null,null),/administrativo/);
 await db.query('update public.admin_users set is_active=false where id=$1',[ADMIN]);
 await assert.rejects(mutate(db,'category.create',{name:'Sem permissão'}),/negado/);
});
test('RLS, grants e RPC não deixam anon/authenticated ler dados ou escrever',async () => {
 const a=await family(db); await gift(db);
 for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  try {
   await assert.rejects(db.query('select * from public.guests'),error=>error.code==='42501');
   await assert.rejects(db.query('select * from public.available_gifts'),error=>error.code==='42501');
   await assert.rejects(guestAction('reserve',{gift_public_id:'00000000-0000-0000-0000-000000000000'},a.id),error=>error.code==='42501');
  } finally { await db.exec('reset role'); }
 }
 await db.exec('set role service_role');
 try { assert.equal((await db.query('select public.wedding_dashboard() as data')).rows[0].data.guests,1); }
 finally { await db.exec('reset role'); }
});

test('edição parcial de presente preserva os campos omitidos',async () => {
 const one=await gift(db);
 await mutate(db,'gift.update',{gift_public_id:one.public_id,description:'Modelo X',estimated_price:180,sort_order:7,is_active:false});
 await mutate(db,'gift.update',{gift_public_id:one.public_id,is_active:true});
 const current=(await db.query('select * from public.gifts where id=$1',[one.id])).rows[0];
 assert.equal(current.description,'Modelo X');assert.equal(Number(current.estimated_price),180);assert.equal(current.sort_order,7);assert.equal(current.is_active,true);
});
