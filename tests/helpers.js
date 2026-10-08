import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const ADMIN = '11111111-1111-4111-8111-111111111111';
export async function createDatabase() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values($1)',[ADMIN]);
  await db.query('insert into public.admin_users(id,name) values($1,$2)',[ADMIN,'Administrador de teste']);
  return db;
}
export async function mutate(db, action, data = {}, invitation = null, admin = ADMIN) {
  const { rows } = await db.query('select public.wedding_mutate($1,$2::jsonb,$3::bigint,$4::uuid) as value',[action,JSON.stringify(data),invitation,admin]);
  return rows[0].value;
}
export async function family(db, name = 'Família A', status = 'ATTENDING', max = 2) {
  const {id} = await mutate(db,'invitation.create',{name,max_guests:max});
  const guest = await mutate(db,'guest.create',{name:`Pessoa ${name}`},id);
  await mutate(db,'rsvp',{guest_id:guest.id,rsvp_status:status},id,null);
  return {id,guestId:guest.id};
}
export async function gift(db, name = 'Cafeteira') {
  let category = (await db.query("select id from public.gift_categories where name='Casa'")).rows[0];
  if (!category) category = await mutate(db,'category.create',{name:'Casa',sort_order:0});
  const {id} = await mutate(db,'gift.create',{name,category_id:category.id});
  return (await db.query('select * from public.gifts where id=$1',[id])).rows[0];
}
export async function reset(db) {
  await db.exec('truncate public.app_sessions,public.activity_logs,public.gift_reservations,public.gifts,public.gift_categories,public.guests,public.invitation_tokens,public.invitations restart identity cascade;');
  await db.exec("update public.wedding_settings set value='95' where key='guest_limit'; update public.wedding_settings set value=null where key='rsvp_deadline_at'; update public.admin_users set is_active=true;");
}
// Adaptador exclusivo de teste: emula o formato de resposta do SDK,
// mas executa queries e RPCs no PostgreSQL real do PGlite.
export function testAdapter(db) {
  const ident = value => { if (!/^[a-z_]+$/.test(value)) throw new Error('Identificador inesperado no teste'); return `"${value}"`; };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.ordering = []; this.operation = 'select'; this.fields = '*'; }
    select(fields = '*', options = {}) { this.fields = fields; this.count = options.count; return this; }
    insert(data) { this.operation = 'insert'; this.data = data; return this; }
    delete() { this.operation = 'delete'; return this; }
    eq(field,value) { this.filters.push([field,'=',value]); return this; }
    gt(field,value) { this.filters.push([field,'>',value]); return this; }
    lt(field,value) { this.filters.push([field,'<',value]); return this; }
    is(field,value) { this.filters.push([field,'is',value]); return this; }
    order(field,options = {}) { this.ordering.push([field,options.ascending !== false]); return this; }
    range(start,end) { this.start = start; this.end = end; return this; }
    maybeSingle() { this.single = true; return this; }
    async run() {
      try {
        const params = [];
        const where = this.filters.length ? ' where ' + this.filters.map(([field,op,value]) => {
          if (op === 'is' && value === null) return `${ident(field)} is null`;
          params.push(value); return `${ident(field)} ${op} $${params.length}`;
        }).join(' and ') : '';
        const table = `public.${ident(this.table)}`;
        if (this.operation === 'insert') {
          const keys = Object.keys(this.data); const values = Object.values(this.data);
          await db.query(`insert into ${table}(${keys.map(ident).join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,values);
          return {data:null,error:null};
        }
        if (this.operation === 'delete') { await db.query(`delete from ${table}${where}`,params); return {data:null,error:null}; }
        const count = this.count ? Number((await db.query(`select count(*) as total from ${table}${where}`,params)).rows[0].total) : null;
        const order = this.ordering.length ? ' order by '+this.ordering.map(([field,asc])=>`${ident(field)} ${asc?'asc':'desc'}`).join(',') : '';
        const range = this.start !== undefined ? ` limit ${this.end - this.start + 1} offset ${this.start}` : '';
        let rows = (await db.query(`select * from ${table}${where}${order}${range}`,params)).rows;
        if (this.fields.includes('gift:gifts')) {
          for (const row of rows) {
            row.gift = (await db.query('select * from public.gifts where id=$1',[row.gift_id])).rows[0];
            row.gift.category = (await db.query('select id,name from public.gift_categories where id=$1',[row.gift.category_id])).rows[0];
            row.invitation = (await db.query('select id,name from public.invitations where id=$1',[row.invitation_id])).rows[0];
          }
        } else if (this.fields !== '*') {
          const fields = this.fields.split(','); rows = rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]])));
        }
        return {data:this.single ? rows[0] || null : rows,count,error:null};
      } catch(error) { return {data:null,error:{code:error.code,message:error.message}}; }
    }
    then(resolve,reject) { return this.run().then(resolve,reject); }
  }
  return {
    from: table => new Query(table),
    rpc: async (name,args) => {
      try {
        const data = name === 'wedding_dashboard' ? (await db.query('select public.wedding_dashboard() as value')).rows[0].value : await mutate(db,args.p_action,args.p_data,args.p_invitation,args.p_admin);
        return {data,error:null};
      } catch(error) { return {data:null,error:{code:error.code,message:error.message}}; }
    },
    storage: {from: () => ({getPublicUrl: path => ({data:{publicUrl:`http://localhost/test-images/${path}`}}),upload: async () => ({data:{},error:null}),remove: async () => ({data:{},error:null})})},
  };
}
