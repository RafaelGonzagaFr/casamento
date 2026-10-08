import { before,after,beforeEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp,hash } from '../server/app.js';
import { HttpError } from '../server/validation.js';
import { createDatabase,reset,testAdapter,family,gift,ADMIN } from './helpers.js';
let db,server,base,config;
const PASSWORD=' senha preservada ';
const allowedUser={id:ADMIN};
before(async () => { db=await createDatabase(); });
after(async () => { await new Promise(resolve=>server.close(resolve));await db.close(); });
beforeEach(async () => {
 if (server) await new Promise(resolve=>server.close(resolve));
 await reset(db);
 config={origin:'http://localhost:3000',production:false,bucket:'wedding-gifts'};
 server=createApp(config,{db:testAdapter(db),login:async (email,password)=> {
  if (email==='admin@example.test' && password===PASSWORD) return allowedUser;
  if (email==='outro@example.test' && password===PASSWORD) return {id:'22222222-2222-4222-8222-222222222222'};
  throw new HttpError(401,'E-mail ou senha inválidos.');
 }}).listen(0,'127.0.0.1');
 await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;config.origin=base;
});
function client() {
 return {cookie:'',csrf:'',async request(path,method='GET',body={},options={}) {
  const headers={Cookie:this.cookie,...options.headers};
  if(method!=='GET') { headers.Origin=config.origin;headers['Content-Type']='application/json';headers['X-CSRF-Token']=this.csrf; }
  Object.assign(headers,options.headers);
  const response=await fetch(`${base}${path}`,{method,headers,body:method==='GET'?undefined:JSON.stringify(body),redirect:options.redirect || 'manual'});
  const cookies=response.headers.getSetCookie();if(cookies.length) this.cookie=cookies.at(-1).split(';')[0];
  const raw=await response.text();let data;try {data=JSON.parse(raw);}catch{data=raw;}
  return {status:response.status,data,headers:response.headers};
 },async login() {
  const response=await this.request('/api/admin/login','POST',{email:'admin@example.test',password:PASSWORD});assert.equal(response.status,200);
  const data=await this.request('/api/session');this.csrf=data.data.csrf_token;return data;
 },async enter(url) {
  const response=await this.request(new URL(url).pathname);assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'/convite');
  const data=await this.request('/api/session');this.csrf=data.data.csrf_token;return data;
 }};
}
async function token(admin,invId) { const response=await admin.request(`/api/admin/invitations/${invId}/tokens`,'POST');assert.equal(response.status,200);return response.data; }

test('login exige conta administrativa; sessão protege endpoints e mantém espaços na senha',async () => {
 const c=client();
 assert.equal((await c.request('/api/admin/dashboard')).status,401);
 assert.equal((await c.request('/api/admin/login','POST',{email:'outro@example.test',password:PASSWORD})).status,403);
 const login=await c.login();assert.equal(login.data.role,'admin');assert.equal(login.data.csrf_token.length,64);
 assert.match(c.cookie,/wedding_session=/);
 const dashboard=await c.request('/api/admin/dashboard');assert.equal(dashboard.status,200);assert.equal(dashboard.data.guests,0);
 await c.request('/api/logout','POST');assert.equal((await c.request('/api/admin/dashboard')).status,401);
});
test('escritas rejeitam origem externa, CSRF ausente e JSON inválido',async () => {
 const c=client();await c.login();
 const body={name:'A',max_guests:1};
 assert.equal((await c.request('/api/admin/invitations','POST',body,{headers:{Origin:'https://outro.example'}})).status,403);
 assert.equal((await c.request('/api/admin/invitations','POST',body,{headers:{'X-CSRF-Token':''}})).status,403);
 assert.equal((await c.request('/api/admin/invitations','POST',body,{headers:{'X-CSRF-Token':'é'.repeat(64)}})).status,403);
 const response=await fetch(`${base}/api/admin/invitations`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:c.cookie,'X-CSRF-Token':c.csrf},body:'{'});
 assert.equal(response.status,400);
 assert.equal((await c.request('/api/admin/invitations','POST',body)).status,201);
});
test('QR contém link único; hash é persistido; revogação encerra acesso existente',async () => {
 const admin=client();await admin.login();const inv=await family(db);
 const issued=await token(admin,inv.id);const raw=new URL(issued.url).pathname.split('/').pop();
 assert.match(issued.qr,/^data:image\/png;base64,/);
 const row=(await db.query('select * from public.invitation_tokens')).rows[0];assert.equal(row.token_hash,hash(raw));assert.notEqual(row.token_hash,raw);
 const guest=client();await guest.enter(issued.url);
 assert.equal((await guest.request('/api/guest/home')).data.invitation.id,inv.id);
 const detail=await admin.request(`/api/admin/invitations/${inv.id}`);assert.equal(detail.data.tokens[0].token_hash,undefined);
 assert.equal((await admin.request(`/api/admin/invitations/${inv.id}/tokens/${row.id}`,'DELETE')).status,200);
 assert.equal((await guest.request('/api/guest/home')).status,401);
 assert.equal((await client().request(new URL(issued.url).pathname)).status,404);
});
test('fluxo completo: RSVP, reserva, troca, cancelamento, propriedade e admin isolado',async () => {
 const admin=client();await admin.login();const a=await family(db,'A','PENDING'),b=await family(db,'B');const one=await gift(db),two=await gift(db,'Segundo');
 const guest=client();await guest.enter((await token(admin,a.id)).url);
 assert.equal((await guest.request('/api/admin/dashboard')).status,403);
 assert.equal((await guest.request(`/api/guest/guests/${b.guestId}/rsvp`,'PATCH',{rsvp_status:'ATTENDING'})).status,404);
 assert.equal((await guest.request(`/api/guest/gifts/${one.public_id}/reserve`,'POST')).status,422);
 assert.equal((await guest.request(`/api/guest/guests/${a.guestId}/rsvp`,'PATCH',{rsvp_status:'ATTENDING'})).status,200);
 assert.equal((await guest.request(`/api/guest/gifts/${one.public_id}/reserve`,'POST',{invitation_id:b.id})).status,200);
 assert.equal((await guest.request('/api/guest/reservation')).data.invitation_id,a.id);
 let gifts=await guest.request('/api/guest/gifts');assert.equal(gifts.data.items.length,1);assert.equal(gifts.data.items[0].name,'Segundo');
 assert.equal((await guest.request(`/api/guest/gifts/${two.public_id}/swap`,'POST')).status,200);
 assert.equal((await guest.request('/api/guest/reservation')).data.gift.public_id,two.public_id);
 assert.equal((await guest.request(`/api/guest/gifts/${two.public_id}/reservation`,'DELETE')).status,200);
 assert.equal((await guest.request('/api/guest/reservation')).data,null);
 gifts=await guest.request('/api/guest/gifts');assert.equal(gifts.data.total,2);
});
test('duas requisições concorrentes de reserva retornam uma vencedora',async () => {
 const admin=client();await admin.login();const a=await family(db,'A'),b=await family(db,'B'),one=await gift(db);
 const guestA=client(),guestB=client();await guestA.enter((await token(admin,a.id)).url);await guestB.enter((await token(admin,b.id)).url);
 const responses=await Promise.all([guestA.request(`/api/guest/gifts/${one.public_id}/reserve`,'POST'),guestB.request(`/api/guest/gifts/${one.public_id}/reserve`,'POST')]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,422]);
 assert.equal((await db.query('select count(*)::integer as count from public.gift_reservations where cancelled_at is null')).rows[0].count,1);
});
test('cadastros, edição, filtros e histórico funcionam via HTTP',async () => {
 const admin=client();await admin.login();
 const category=await admin.request('/api/admin/categories','POST',{name:'Cozinha',sort_order:2});assert.equal(category.status,201);
 const created=await admin.request('/api/admin/gifts','POST',{name:'Liquidificador',category_id:category.data.id,estimated_price:250,sort_order:0});assert.equal(created.status,201);
 const gifts=await admin.request('/api/admin/gifts');assert.equal(gifts.data.items[0].category_name,'Cozinha');const item=gifts.data.items[0];
 assert.equal((await admin.request(`/api/admin/gifts/${item.public_id}`,'PATCH',{name:item.name,category_id:item.category_id,is_active:false,sort_order:0})).status,200);
 assert.equal((await admin.request(`/api/admin/gifts/${item.public_id}/history`)).data.items.length,0);
 assert.equal((await admin.request(`/api/admin/categories/${category.data.id}`,'DELETE')).status,422);
 assert.equal((await admin.request(`/api/admin/gifts/${item.public_id}`,'DELETE')).status,200);
 assert.equal((await admin.request('/api/admin/gifts')).data.total,0);
 assert.equal((await admin.request('/api/admin/settings','PATCH',{couple_names:'Rafael & Maria',wedding_date:'2027-03-20',rsvp_deadline_at:'2027-03-10T20:00:00-03:00',welcome_message:'Bem-vindos!'})).status,200);
 assert.equal((await admin.request('/api/public')).data.wedding_date,'2027-03-20');
});
test('assets, rotas frontend e dados sensíveis têm headers apropriados',async () => {
 const c=client();
 for(const path of ['/','/admin/login','/admin/convites/1','/convite/presentes','/styles.css','/app.js']) {
  const r=await c.request(path);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
 }
 assert.equal((await c.request('/.env')).status,404);
 assert.equal((await c.request('/api/session')).headers.get('cache-control'),'no-store');
 assert.equal((await c.request('/server/index.js')).status,404);
});

test('login tem limite de cinco tentativas por minuto',async () => {
 const c=client();
 for (let i=0;i<5;i++) assert.equal((await c.request('/api/admin/login','POST',{email:'admin@example.test',password:'incorreta'})).status,401);
 const limited=await c.request('/api/admin/login','POST',{email:'admin@example.test',password:PASSWORD});
 assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});
