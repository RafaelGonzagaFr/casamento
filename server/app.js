import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { result } from './supabase.js';
import { HttpError, text, integer, id, uuid, boolean, giftData, imageData, settingsData } from './validation.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const settingMap = rows => Object.fromEntries(rows.map(row => [row.key, row.value]));
const reservationSelect = 'id,invitation_id,gift_id,reserved_at,cancelled_at,gift:gifts(*,category:gift_categories(id,name)),invitation:invitations(id,name)';

export function createApp(config, { db, login }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 0);
  const limits = new Map();
  const rate = (tag, max, windowMs = 60000) => (req, res, next) => {
    const now = Date.now(); const key = `${tag}:${req.ip}`;
    let counter = limits.get(key);
    if (!counter || now >= counter.until) { counter = { count: 0, until: now + windowMs }; limits.set(key, counter); }
    if (++counter.count > max) { res.set('Retry-After', String(Math.ceil((counter.until - now) / 1000))); return next(new HttpError(429, 'Muitas tentativas. Aguarde um minuto.')); }
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    next();
  };
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/') || req.path.startsWith('/i/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (!['GET','HEAD'].includes(req.method)) {
      if (req.get('origin') !== config.origin || !req.is('application/json')) return next(new HttpError(403, 'Origem da solicitação inválida.'));
    }
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  const cookieName = config.production ? '__Host-wedding_session' : 'wedding_session';
  const cookieOptions = { httpOnly: true, secure: !!config.production, sameSite: 'lax', path: '/' };
  const cookie = req => {
    const found = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`));
    const value = found?.slice(cookieName.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  };
  async function destroySession(req, res) {
    const raw = cookie(req);
    if (raw) await result(db.from('app_sessions').delete().eq('token_hash', hash(raw)));
    res.clearCookie(cookieName, cookieOptions);
  }
  async function newSession(req, res, actor, seconds) {
    await destroySession(req, res);
    const raw = secret(); const csrf = secret();
    await result(db.from('app_sessions').insert({ token_hash: hash(raw), csrf_token: csrf, ...actor, expires_at: new Date(Date.now() + seconds * 1000).toISOString() }));
    // Limpeza evita acúmulo de sessões expiradas; falhas de limpeza não invalidam login.
    await db.from('app_sessions').delete().lt('expires_at', new Date().toISOString());
    res.cookie(cookieName, raw, { ...cookieOptions, maxAge: seconds * 1000 });
  }
  async function loadSession(req, res, next) {
    try {
      const raw = cookie(req);
      if (!raw) throw new HttpError(401, 'Entre na administração ou abra o link do seu convite.');
      const session = await result(db.from('app_sessions').select('*').eq('token_hash', hash(raw)).gt('expires_at', new Date().toISOString()).maybeSingle());
      if (!session) throw new HttpError(401, 'Sua sessão expirou. Abra o convite ou entre novamente.');
      if (session.admin_id) {
        const admin = await result(db.from('admin_users').select('id,name,is_active').eq('id', session.admin_id).eq('is_active', true).maybeSingle());
        if (!admin) throw new HttpError(401, 'Acesso administrativo encerrado.');
        req.admin = admin;
      } else {
        const inv = await result(db.from('invitations').select('*').eq('id', session.invitation_id).eq('is_active', true).is('deleted_at', null).maybeSingle());
        const token = await result(db.from('invitation_tokens').select('id,invitation_id,expires_at').eq('id', session.invitation_token_id).is('revoked_at', null).maybeSingle());
        if (!inv || !token || token.invitation_id !== inv.id || (token.expires_at && Date.parse(token.expires_at) <= Date.now())) throw new HttpError(401, 'Este convite foi revogado ou está inativo.');
        req.invitation = inv;
      }
      req.session = session;
      if (!['GET','HEAD'].includes(req.method) && !safeEqual(req.get('x-csrf-token'), session.csrf_token)) throw new HttpError(403, 'Sessão de formulário inválida. Atualize a página.');
      next();
    } catch (e) { next(e); }
  }
  const adminOnly = (req, res, next) => req.admin ? next() : next(new HttpError(403, 'Acesso administrativo necessário.'));
  const guestOnly = (req, res, next) => req.invitation ? next() : next(new HttpError(403, 'Abra o seu convite.'));
  const mutate = (req, action, data, invitation = null) => result(db.rpc('wedding_mutate', { p_action: action, p_data: data, p_admin: req.admin?.id ?? null, p_invitation: invitation ?? req.invitation?.id ?? null }));
  async function settings() { return settingMap(await result(db.from('wedding_settings').select('key,value'))); }
  function photo(gift) {
    if (gift) gift.image_url = gift.image_path ? db.storage.from(config.bucket).getPublicUrl(gift.image_path).data.publicUrl : null;
    return gift;
  }
  const paginate = req => ({ page: integer(req.query.page || 1, 'Página', 1, 100000), size: 20 });
  const sendList = async (req, res, query, size = 20) => {
    const page = paginate(req).page;
    const { data, count, error } = await query.range((page - 1) * size, page * size - 1);
    if (error) await result(Promise.resolve({ error }));
    res.json({ items: data, total: count, page, size });
  };

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/public', async (req, res) => {
    const data = await settings();
    res.json({ couple_names: data.couple_names, wedding_date: data.wedding_date });
  });
  app.post('/api/admin/login', rate('login', 5), async (req, res) => {
    const email = text(req.body.email, 'E-mail');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'E-mail inválido.');
    const password = req.body.password;
    if (typeof password !== 'string' || !password.length || password.length > 1024) throw new HttpError(422, 'Informe sua senha.');
    const user = await login(email, password);
    const admin = await result(db.from('admin_users').select('id').eq('id', user.id).eq('is_active', true).maybeSingle());
    if (!admin) throw new HttpError(403, 'Esta conta não tem acesso administrativo.');
    await newSession(req, res, { admin_id: admin.id }, 8 * 3600);
    res.json({ ok: true });
  });
  app.get('/i/:token', rate('invite', 20), async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.token)) throw new HttpError(404, 'Convite inválido.');
    const token = await result(db.from('invitation_tokens').select('id,invitation_id,expires_at').eq('token_hash', hash(req.params.token)).is('revoked_at', null).maybeSingle());
    if (!token || (token.expires_at && Date.parse(token.expires_at) <= Date.now())) throw new HttpError(404, 'Convite inválido ou revogado.');
    const inv = await result(db.from('invitations').select('id').eq('id', token.invitation_id).eq('is_active', true).is('deleted_at', null).maybeSingle());
    if (!inv) throw new HttpError(404, 'Convite inválido ou inativo.');
    await newSession(req, res, { invitation_id: inv.id, invitation_token_id: token.id }, 7 * 24 * 3600);
    res.redirect(303, '/convite');
  });
  app.get('/api/session', loadSession, async (req, res) => res.json({ csrf_token: req.session.csrf_token, role: req.admin ? 'admin' : 'guest', admin: req.admin, invitation: req.invitation }));
  app.post('/api/logout', loadSession, async (req, res) => { await destroySession(req, res); res.json({ ok: true }); });

  app.use('/api/guest', loadSession, guestOnly);
  app.get('/api/guest/home', async (req, res) => {
    const [guests, config] = await Promise.all([
      result(db.from('guests').select('id,name,rsvp_status').eq('invitation_id', req.invitation.id).is('deleted_at', null).order('id')), settings(),
    ]);
    res.json({ invitation: req.invitation, guests, settings: config });
  });
  app.patch('/api/guest/guests/:id/rsvp', rate('rsvp', 30), async (req, res) => {
    if (!['PENDING','ATTENDING','DECLINED'].includes(req.body.rsvp_status)) throw new HttpError(422, 'Confirmação inválida.');
    res.json(await mutate(req, 'rsvp', { guest_id: id(req.params.id), rsvp_status: req.body.rsvp_status }));
  });
  app.get('/api/guest/gifts', async (req, res) => {
    const page = paginate(req).page;
    // Uma view só retorna presentes livres e evita limites do PostgREST em filtros IN.
    const { data, count, error } = await db.from('available_gifts').select('*', { count: 'exact' }).order('sort_order').order('id').range((page - 1) * 12, page * 12 - 1);
    if (error) await result(Promise.resolve({ error }));
    res.json({ items: data.map(photo), total: count, page, size: 12 });
  });
  app.get('/api/guest/reservation', async (req, res) => {
    const data = await result(db.from('gift_reservations').select(reservationSelect).eq('invitation_id', req.invitation.id).is('cancelled_at', null).maybeSingle());
    if (data) photo(data.gift);
    res.json(data);
  });
  app.post('/api/guest/gifts/:uuid/reserve', rate('gift', 20), async (req, res) => res.json(await mutate(req, 'reserve', { gift_public_id: uuid(req.params.uuid) })));
  app.post('/api/guest/gifts/:uuid/swap', rate('gift', 20), async (req, res) => res.json(await mutate(req, 'swap', { gift_public_id: uuid(req.params.uuid) })));
  app.delete('/api/guest/gifts/:uuid/reservation', rate('gift', 20), async (req, res) => res.json(await mutate(req, 'cancel', { gift_public_id: uuid(req.params.uuid) })));

  app.use('/api/admin', loadSession, adminOnly);
  app.get('/api/admin/dashboard', async (req, res) => {
    const data = await result(db.rpc('wedding_dashboard'));
    res.json(data);
  });
  app.get('/api/admin/invitations', (req, res) => sendList(req, res, db.from('invitation_summary').select('*', { count: 'exact' }).order('id', { ascending: false })));
  app.post('/api/admin/invitations', async (req, res) => res.status(201).json(await mutate(req, 'invitation.create', { name: text(req.body.name, 'Nome'), max_guests: integer(req.body.max_guests, 'Limite', 1, 95) })));
  app.get('/api/admin/invitations/:id', async (req, res) => {
    const invId = id(req.params.id);
    const inv = await result(db.from('invitations').select('*').eq('id', invId).is('deleted_at', null).maybeSingle());
    if (!inv) throw new HttpError(404, 'Convite não encontrado.');
    const [guests, tokens, reservation] = await Promise.all([
      result(db.from('guests').select('id,name,rsvp_status').eq('invitation_id', invId).is('deleted_at', null).order('id')),
      result(db.from('invitation_tokens').select('id,created_at,revoked_at,expires_at').eq('invitation_id', invId).order('id', { ascending: false })),
      result(db.from('gift_reservations').select(reservationSelect).eq('invitation_id', invId).is('cancelled_at', null).maybeSingle()),
    ]);
    res.json({ invitation: inv, guests, tokens, reservation });
  });
  app.patch('/api/admin/invitations/:id', async (req, res) => res.json(await mutate(req, 'invitation.update', { name: text(req.body.name, 'Nome'), max_guests: integer(req.body.max_guests, 'Limite', 1, 95), is_active: boolean(req.body.is_active) }, id(req.params.id))));
  app.post('/api/admin/invitations/:id/tokens', async (req, res) => {
    const raw = secret(); const invId = id(req.params.id);
    await mutate(req, 'token.issue', { token_hash: hash(raw) }, invId);
    const url = `${config.origin}/i/${raw}`;
    const qr = await QRCode.toDataURL(url, { width: 360, margin: 4, errorCorrectionLevel: 'M' });
    res.json({ url, qr });
  });
  app.delete('/api/admin/invitations/:id/tokens/:tokenId', async (req, res) => res.json(await mutate(req, 'token.revoke', { token_id: id(req.params.tokenId) }, id(req.params.id))));
  app.post('/api/admin/invitations/:id/guests', async (req, res) => res.status(201).json(await mutate(req, 'guest.create', { name: text(req.body.name, 'Nome') }, id(req.params.id))));
  app.patch('/api/admin/invitations/:id/guests/:guestId', async (req, res) => res.json(await mutate(req, 'guest.update', { guest_id: id(req.params.guestId), name: text(req.body.name, 'Nome') }, id(req.params.id))));
  app.delete('/api/admin/invitations/:id/guests/:guestId', async (req, res) => res.json(await mutate(req, 'guest.delete', { guest_id: id(req.params.guestId) }, id(req.params.id))));
  app.get('/api/admin/categories', async (req, res) => res.json(await result(db.from('gift_categories').select('id,name,sort_order').is('deleted_at', null).order('sort_order').order('id'))));
  app.post('/api/admin/categories', async (req, res) => res.status(201).json(await mutate(req, 'category.create', { name: text(req.body.name, 'Nome'), sort_order: integer(req.body.sort_order ?? 0, 'Ordem') })));
  app.patch('/api/admin/categories/:id', async (req, res) => res.json(await mutate(req, 'category.update', { category_id: id(req.params.id), name: text(req.body.name, 'Nome'), sort_order: integer(req.body.sort_order, 'Ordem') })));
  app.delete('/api/admin/categories/:id', async (req, res) => res.json(await mutate(req, 'category.delete', { category_id: id(req.params.id) })));
  app.get('/api/admin/gifts', async (req, res) => {
    const page = paginate(req).page;
    const { data, error, count } = await db.from('gift_summary').select('*', { count: 'exact' }).order('id', { ascending: false }).range((page - 1) * 20, page * 20 - 1);
    if (error) await result(Promise.resolve({ error }));
    res.json({ items: data.map(photo), total: count, page, size: 20 });
  });
  async function saveGift(req, res, update) {
    const data = giftData(req.body, update);
    if (update) data.gift_public_id = uuid(req.params.uuid);
    const image = imageData(req.body.image);
    if (image) {
      data.image_path = `gifts/${secret()}.${image.extension}`;
      await result(db.storage.from(config.bucket).upload(data.image_path, image.buffer, { contentType: image.type, upsert: false }));
    }
    let saved;
    try { saved = await mutate(req, update ? 'gift.update' : 'gift.create', data); }
    catch (e) { if (image) await db.storage.from(config.bucket).remove([data.image_path]); throw e; }
    res.status(update ? 200 : 201).json(saved);
  }
  app.post('/api/admin/gifts', (req, res) => saveGift(req, res, false));
  app.patch('/api/admin/gifts/:uuid', (req, res) => saveGift(req, res, true));
  app.delete('/api/admin/gifts/:uuid', async (req, res) => res.json(await mutate(req, 'gift.delete', { gift_public_id: uuid(req.params.uuid) })));
  app.get('/api/admin/gifts/:uuid/history', async (req, res) => {
    const gift = await result(db.from('gifts').select('id,name').eq('public_id', uuid(req.params.uuid)).maybeSingle());
    if (!gift) throw new HttpError(404, 'Presente não encontrado.');
    const { data, count, error } = await db.from('gift_reservations').select(reservationSelect, { count: 'exact' }).eq('gift_id', gift.id).order('reserved_at', { ascending: false }).range((paginate(req).page - 1) * 20, paginate(req).page * 20 - 1);
    if (error) await result(Promise.resolve({ error }));
    res.json({ gift, items: data, total: count, page: paginate(req).page, size: 20 });
  });
  app.get('/api/admin/reservations', (req, res) => sendList(req, res, db.from('gift_reservations').select(reservationSelect, { count: 'exact' }).order('reserved_at', { ascending: false })));
  app.post('/api/admin/reservations/:id/cancel', async (req, res) => res.json(await mutate(req, 'reservation.cancel', { reservation_id: id(req.params.id), reason: text(req.body.reason, 'Motivo', 500, true) })));
  app.get('/api/admin/settings', async (req, res) => res.json(await settings()));
  app.patch('/api/admin/settings', async (req, res) => res.json(await mutate(req, 'settings.update', settingsData(req.body))));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use(express.static(publicDir, { index: false, dotfiles: 'deny' }));
  app.get(/^\/(?:|admin(?:\/.*)?|convite(?:\/.*)?)$/, (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(`${publicDir}/index.html`); });
  app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : error.status || 500;
    const message = status === 413 ? 'Arquivo muito grande.' : status === 400 ? 'JSON inválido.' : status < 500 || error instanceof HttpError ? error.message : 'Não foi possível concluir a operação.';
    // Não registre URL, cookie, token de convite, senha ou corpo da requisição.
    if (status >= 500) console.error(`Falha no servidor (${status}).`);
    if (req.path.startsWith('/api/')) res.status(status).json({ error: message });
    else res.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Convite indisponível</title><link rel="stylesheet" href="/styles.css"><main class="centered"><section class="card"><h1>Convite indisponível</h1><p>O link está inválido, expirou ou foi revogado. Solicite um novo convite aos noivos.</p><a href="/">Voltar ao início</a></section></main></html>`);
  });
  return app;
}
