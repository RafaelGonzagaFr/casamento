const main = document.querySelector('#main');
const header = document.querySelector('#header');
const footer = document.querySelector('#footer');
const notice = document.querySelector('#notice');
let session = null;
let publicInfo = { couple_names: 'Rafael & Maria' };
let renderVersion = 0;
let noticeTimer;
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const statusNames = { PENDING: 'Pendente', ATTENDING: 'Vou comparecer', DECLINED: 'Não vou comparecer' };
const dateTime = value => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' }) : '—';
const dateOnly = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '';
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const selected = (a, b) => String(a) === String(b) ? ' selected' : '';
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function tell(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message; notice.classList.toggle('error', error); notice.hidden = false;
  notice.setAttribute('role', error ? 'alert' : 'status');
  if (!error) noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
}
async function api(path, method = 'GET', body = {}) {
  const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    if (session?.csrf_token) options.headers['X-CSRF-Token'] = session.csrf_token;
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, options);
  let data; try { data = await response.json(); } catch { throw new Error('Resposta inválida do servidor.'); }
  if (!response.ok) throw new ApiError(response.status, data.error || 'Não foi possível concluir a operação.');
  return data;
}
const form = (endpoint, method, message, content, options = {}) => `<form data-endpoint="${e(endpoint)}" data-method="${method}" data-message="${e(message)}"${options.next ? ` data-next="${e(options.next)}"` : ''}${options.confirm ? ` data-confirm="${e(options.confirm)}"` : ''} class="${e(options.class || 'stack')}">${content}</form>`;
const action = (label, endpoint, method = 'POST', confirmation = '', message = 'Alteração salva.') => `<button class="link-button" type="button" data-action="request" data-endpoint="${e(endpoint)}" data-method="${method}" data-confirm="${e(confirmation)}" data-message="${e(message)}">${e(label)}</button>`;
const field = (label, name, value = '', type = 'text', attrs = '') => `<label class="field"><span class="label">${e(label)}</span><input class="input" name="${e(name)}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const textarea = (label, name, value = '', max = 5000) => `<label class="field"><span class="label">${e(label)}</span><textarea class="input" name="${name}" maxlength="${max}">${e(value)}</textarea></label>`;
const submit = label => `<button class="btn" type="submit">${e(label)}</button>`;
const heading = (title, subtitle = '', eyebrow = 'Administração') => `<p class="eyebrow">${e(eyebrow)}</p><h1>${e(title)}</h1>${subtitle ? `<p class="subtitle">${e(subtitle)}</p>` : ''}`;
const empty = text => `<p class="empty">${e(text)}</p>`;
const pill = (text, color = '') => `<span class="pill ${color}">${e(text)}</span>`;
function pagination(data) {
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const pageLink = (page, label) => {
    const url = new URL(location.href); url.searchParams.set('page', page);
    return `<a class="btn secondary small" href="${e(url.pathname + url.search)}" data-nav>${label}</a>`;
  };
  return pages <= 1 ? '' : `<nav class="pagination" aria-label="Paginação">${data.page > 1 ? pageLink(data.page - 1, 'Anterior') : ''}<span>Página ${data.page} de ${pages}</span>${data.page < pages ? pageLink(data.page + 1, 'Próxima') : ''}</nav>`;
}
function layout(path) {
  const admin = path.startsWith('/admin') && path !== '/admin/login';
  const guest = path.startsWith('/convite');
  document.body.className = admin ? 'admin' : 'guest';
  let items = [];
  if (admin) items = [['/admin','Painel'],['/admin/convites','Convites'],['/admin/presentes','Presentes'],['/admin/reservas','Reservas'],['/admin/categorias','Categorias'],['/admin/configuracoes','Configurações']];
  if (guest) items = [['/convite','Meu convite'],['/convite/presentes','Presentes'],['/convite/meus-presentes','Meu presente']];
  header.innerHTML = `<div class="header-inner"><a href="${admin ? '/admin' : guest ? '/convite' : '/'}" data-nav class="brand">${e(admin ? 'Administração' : publicInfo.couple_names)}</a>${items.length ? `<nav aria-label="Menu principal">${items.map(([url,label]) => `<a href="${url}" data-nav${path === url || (url !== '/admin' && url !== '/convite' && path.startsWith(`${url}/`)) ? ' aria-current="page"' : ''}>${label}</a>`).join('')}<button type="button" class="logout" data-action="logout">Sair</button></nav>` : ''}</div>`;
  footer.innerHTML = `${e(publicInfo.couple_names)}${publicInfo.wedding_date ? ` · ${e(dateOnly(publicInfo.wedding_date))}` : ''}${!guest && !admin ? '<p><a href="/admin/login" data-nav>Acesso administrativo</a></p>' : ''}`;
}
function welcome() {
  return `<section class="card welcome"><p class="eyebrow">Nosso casamento</p><div class="ornament" aria-hidden="true">♡</div><h1>${e(publicInfo.couple_names)}</h1>${publicInfo.wedding_date ? `<p>${e(dateOnly(publicInfo.wedding_date))}</p>` : ''}<p class="muted">Abra o link ou escaneie o QR Code do seu convite para confirmar sua presença e escolher um presente.</p></section>`;
}
function loginPage() {
  return `<section class="centered card login-card">${heading('Acesso administrativo','Entre para organizar os convites e os presentes.','Nosso casamento')}<form id="login-form" class="stack">${field('E-mail','email','','email','required autocomplete="username"')}${field('Senha','password','','password','required autocomplete="current-password"')}${submit('Entrar')}</form></section>`;
}
async function dashboard() {
  const data = await api('/admin/dashboard');
  const stats = [['Convites',data.invitations,'Famílias e grupos'],['Pessoas',data.guests,`Limite total: ${data.guest_limit}`],['Presentes',data.gifts,'Itens cadastrados'],['Reservados',data.reserved,'Um por convite']];
  return `${heading('Seu casamento, organizado','Acompanhe os convites, as confirmações e a lista de presentes.')}<div class="grid cols-4">${stats.map(([label,value,sub]) => `<article class="card stat"><p>${e(label)}</p><strong>${e(value)}</strong><small>${e(sub)}</small></article>`).join('')}</div><section class="card spaced"><h2>Confirmações de presença</h2><div class="grid cols-3">${[['Confirmados',data.attending,'green'],['Pendentes',data.pending,'rose'],['Não comparecem',data.declined,'red']].map(([label,value,color]) => `<div class="stat"><p>${pill(label,color)}</p><strong>${e(value)}</strong></div>`).join('')}</div><progress class="progress" value="${data.guests}" max="${data.guest_limit}" aria-label="Pessoas cadastradas em relação ao limite">${data.guests}/${data.guest_limit}</progress><p class="muted spaced">${data.guests} de ${data.guest_limit} pessoas cadastradas.</p><div class="actions"><a class="btn" href="/admin/convites" data-nav>Gerenciar convites</a><a class="btn secondary" href="/admin/presentes" data-nav>Organizar presentes</a></div></section>`;
}
async function invitations(page) {
  const data = await api(`/admin/invitations?page=${page}`);
  return `${heading('Convites','Cadastre cada família ou grupo e defina quem faz parte do convite.')}<section class="card">${form('/admin/invitations','POST','Convite criado.',`${field('Nome da família ou convite','name','','text','required maxlength="255"')}${field('Limite de pessoas','max_guests',1,'number','required min="1" max="95"')}${submit('Criar convite')}`,{class:'form-grid',next:'invitation-created'})}</section><section class="card table-wrap spaced"><table><thead><tr><th>Convite</th><th>Pessoas</th><th>Confirmados</th><th>Situação</th><th></th></tr></thead><tbody>${data.items.map(inv => `<tr><td>${e(inv.name)}</td><td>${inv.guests_count}/${inv.max_guests}</td><td>${inv.attending_count}</td><td>${pill(inv.is_active ? 'Ativo' : 'Inativo',inv.is_active ? 'green' : '')}</td><td><a href="/admin/convites/${inv.id}" data-nav>Abrir</a></td></tr>`).join('') || '<tr><td colspan="5">Nenhum convite cadastrado.</td></tr>'}</tbody></table></section>${pagination(data)}`;
}
async function invitation(id) {
  const data = await api(`/admin/invitations/${id}`); const inv = data.invitation;
  const endpoint = `/admin/invitations/${id}`;
  return `${heading(inv.name,'Gerencie as pessoas e os links de acesso deste convite.')}<div class="grid cols-2"><section class="card"><h2>Convite</h2>${form(endpoint,'PATCH','Convite atualizado.',`${field('Nome','name',inv.name,'text','required maxlength="255"')}${field('Limite de pessoas','max_guests',inv.max_guests,'number','required min="1" max="95"')}<label><span class="label">Situação</span><select class="input" name="is_active"><option value="true"${selected(inv.is_active,true)}>Ativo</option><option value="false"${selected(inv.is_active,false)}>Inativo</option></select></label>${submit('Salvar convite')}`)}<hr class="divider"><button class="btn" type="button" data-action="issue-token" data-id="${id}">Gerar novo QR Code</button><p class="muted spaced">Os links anteriores continuam válidos até serem revogados. Cada link dá acesso às pessoas deste convite.</p><h3>Links emitidos</h3>${data.tokens.map(token => `<div class="row"><p>Link #${token.id} ${pill(token.revoked_at ? 'Revogado' : token.expires_at && Date.parse(token.expires_at) <= Date.now() ? 'Expirado' : 'Ativo', token.revoked_at ? '' : 'green')}</p><small>Emitido em ${e(dateTime(token.created_at))}</small>${!token.revoked_at ? `<div>${action('Revogar',`${endpoint}/tokens/${token.id}`,'DELETE','Revogar este link e encerrar as sessões vinculadas a ele?','Link revogado.')}</div>` : ''}</div>`).join('') || '<p class="muted">Nenhum link emitido.</p>'}</section><section class="card"><h2>Pessoas (${data.guests.length}/${inv.max_guests})</h2>${form(`${endpoint}/guests`,'POST','Pessoa adicionada.',`<label class="sr-only" for="new-guest">Nome da pessoa</label><input id="new-guest" class="input" name="name" required maxlength="255" placeholder="Nome da pessoa">${submit('Adicionar')}`,{class:'inline-form'})}${data.guests.map(guest => `<div class="row spaced">${form(`${endpoint}/guests/${guest.id}`,'PATCH','Nome atualizado.',`<label class="sr-only" for="guest-${guest.id}">Nome da pessoa</label><input id="guest-${guest.id}" class="input" name="name" required maxlength="255" value="${e(guest.name)}">${submit('Salvar')}`,{class:'inline-form'})}<p class="spaced">${pill(statusNames[guest.rsvp_status], guest.rsvp_status === 'ATTENDING' ? 'green' : guest.rsvp_status === 'DECLINED' ? 'red' : '')}</p>${action('Remover',`${endpoint}/guests/${guest.id}`,'DELETE','Remover esta pessoa do convite?','Pessoa removida.')}</div>`).join('') || '<p class="muted spaced">Adicione as pessoas que fazem parte deste convite.</p>'}</section></div>${data.reservation ? `<section class="card spaced"><h2>Presente escolhido</h2><p>${e(data.reservation.gift.name)}</p><a href="/admin/reservas" data-nav>Gerenciar reserva</a></section>` : ''}`;
}
async function categories() {
  const data = await api('/admin/categories');
  return `${heading('Categorias','Organize os presentes por ambiente ou tipo.')}<section class="card">${form('/admin/categories','POST','Categoria criada.',`${field('Nova categoria','name','','text','required maxlength="255"')}${field('Ordem','sort_order',0,'number','required')}${submit('Adicionar')}`,{class:'form-grid'})}</section><div class="stack spaced">${data.map(category => `<section class="card">${form(`/admin/categories/${category.id}`,'PATCH','Categoria atualizada.',`${field('Nome','name',category.name,'text','required maxlength="255"')}${field('Ordem','sort_order',category.sort_order,'number','required')}${submit('Salvar')}`,{class:'form-grid'})}<div class="actions">${action('Arquivar',`/admin/categories/${category.id}`,'DELETE','Arquivar esta categoria? Ela precisa estar sem presentes.','Categoria arquivada.')}</div></section>`).join('') || empty('Nenhuma categoria cadastrada.')}</div>`;
}
function giftFields(gift, categories, reserved = false) {
  return `${field('Nome','name',gift?.name || '','text',`maxlength="255" ${reserved ? 'disabled' : 'required'}`)}<label><span class="label">Categoria</span><select name="category_id" class="input" required><option value="">Selecione</option>${categories.map(cat => `<option value="${cat.id}"${selected(cat.id,gift?.category_id)}>${e(cat.name)}</option>`).join('')}</select></label>${textarea('Descrição','description',gift?.description)}${field('Link de referência','external_url',gift?.external_url || '','url','maxlength="2048"')}${field(gift ? 'Nova imagem (opcional, até 2 MB)' : 'Imagem (opcional, até 2 MB)','image','','file','accept="image/png,image/jpeg,image/webp"')}${field('Valor estimado (opcional)','estimated_price',gift?.estimated_price ?? '','number','min="0" max="99999999.99" step="0.01"')}${field('Ordem na lista','sort_order',gift?.sort_order ?? 0,'number','required')}<label><span class="label">Situação</span><select class="input" name="is_active"><option value="true"${selected(gift?.is_active ?? true,true)}>Ativo</option><option value="false"${selected(gift?.is_active,false)}>Desativado</option></select></label><div class="full">${submit(gift ? 'Salvar alterações' : 'Cadastrar presente')}</div>`;
}
async function adminGifts(page) {
  const [data, cats] = await Promise.all([api(`/admin/gifts?page=${page}`),api('/admin/categories')]);
  return `${heading('Presentes','Cada item representa uma unidade e pode ser escolhido por um convite.')}<section class="card"><h2>Novo presente</h2>${cats.length ? form('/admin/gifts','POST','Presente cadastrado.',giftFields(null,cats),{class:'form-grid'}) : '<p>Cadastre uma <a href="/admin/categorias" data-nav>categoria</a> antes de adicionar presentes.</p>'}</section><div class="grid cols-2 spaced">${data.items.map(gift => `<article class="card"><h2>${e(gift.name)}</h2><p>${e(gift.category_name)} · ${pill(gift.is_active ? 'Ativo' : 'Desativado',gift.is_active ? 'green' : '')}</p><p>${gift.reservation_id ? pill(`Reservado por ${gift.reserved_by}`,'rose') : pill('Disponível','green')}</p>${gift.image_url ? `<img class="gift-img" src="${e(gift.image_url)}" alt="${e(gift.name)}" loading="lazy">` : ''}<details><summary>Editar presente</summary>${form(`/admin/gifts/${gift.public_id}`,'PATCH','Presente atualizado.',giftFields(gift,cats,!!gift.reservation_id),{class:'form-grid'})}</details><div class="actions"><a href="/admin/presentes/${gift.public_id}/historico" data-nav>Histórico</a>${!gift.reservation_id ? action('Arquivar',`/admin/gifts/${gift.public_id}`,'DELETE','Arquivar este presente?','Presente arquivado.') : ''}</div></article>`).join('') || empty('Nenhum presente cadastrado.')}</div>${pagination(data)}`;
}
function historyRow(reservation, showGift = true) {
  return `<article class="history-entry">${showGift ? `<h2>${e(reservation.gift?.name)}</h2>` : ''}<p><a href="/admin/convites/${reservation.invitation_id}" data-nav>${e(reservation.invitation?.name)}</a> · ${pill(reservation.cancelled_at ? 'Cancelada' : 'Ativa',reservation.cancelled_at ? '' : 'green')}</p><p class="muted">Reservado em ${e(dateTime(reservation.reserved_at))}${reservation.cancelled_at ? `<br>Cancelado em ${e(dateTime(reservation.cancelled_at))}` : ''}</p>${showGift && !reservation.cancelled_at ? form(`/admin/reservations/${reservation.id}/cancel`,'POST','Reserva liberada.',`<label class="sr-only" for="reason-${reservation.id}">Motivo da liberação</label><input id="reason-${reservation.id}" class="input" name="reason" maxlength="500" placeholder="Motivo (opcional)">${submit('Liberar reserva')}`,{class:'inline-form',confirm:'Liberar esta reserva e disponibilizar o presente para outro convite?'}) : ''}</article>`;
}
async function reservations(page) {
  const data = await api(`/admin/reservations?page=${page}`);
  return `${heading('Reservas','Veja as escolhas dos convidados e libere uma reserva quando necessário.')}<section class="card">${data.items.map(r => historyRow(r)).join('') || empty('Ainda não há reservas.')}</section>${pagination(data)}`;
}
async function giftHistory(uuid, page) {
  const data = await api(`/admin/gifts/${uuid}/history?page=${page}`);
  return `${heading(`Histórico: ${data.gift.name}`)}<p><a href="/admin/presentes" data-nav>Voltar aos presentes</a></p><section class="card">${data.items.map(r => historyRow(r,false)).join('') || empty('Este presente ainda não tem histórico.')}</section>${pagination(data)}`;
}
function bahiaInput(value) {
  if (!value) return '';
  // UTC-03:00 é o fuso da Bahia; a gravação inclui esse deslocamento explicitamente.
  return new Date(Date.parse(value) - 3 * 3600 * 1000).toISOString().slice(0,16);
}
async function settingsPage() {
  const data = await api('/admin/settings');
  return `${heading('Configurações','Defina as informações exibidas no convite e o prazo de confirmação.')}<section class="card">${form('/admin/settings','PATCH','Configurações salvas.',`${field('Nomes do casal','couple_names',data.couple_names,'text','required maxlength="255"')}${field('Data do casamento','wedding_date',data.wedding_date || '','date')}${field('Prazo da confirmação (horário da Bahia)','rsvp_deadline_at',bahiaInput(data.rsvp_deadline_at),'datetime-local')}<small>Deixe o prazo vazio para permitir confirmações a qualquer momento.</small>${textarea('Mensagem de boas-vindas','welcome_message',data.welcome_message,1000)}${submit('Salvar configurações')}`,{class:'stack'})}</section>`;
}
async function guestHome() {
  const data = await api('/guest/home');
  const expired = data.settings.rsvp_deadline_at && Date.parse(data.settings.rsvp_deadline_at) < Date.now();
  return `${heading(data.invitation.name,data.settings.welcome_message || 'Confirme a presença de cada pessoa do seu convite.','Seu convite')}${data.settings.wedding_date ? `<p>Nosso casamento será em ${e(dateOnly(data.settings.wedding_date))}.</p>` : ''}${data.settings.rsvp_deadline_at ? `<div class="info-box">${expired ? 'O prazo de confirmação terminou em' : 'Confirme sua presença até'} ${e(dateTime(data.settings.rsvp_deadline_at))} (horário da Bahia).</div>` : ''}<section class="card">${data.guests.map(guest => `<article class="row"><h2>${e(guest.name)}</h2>${form(`/guest/guests/${guest.id}/rsvp`,'PATCH','Confirmação salva.',`<label class="sr-only" for="rsvp-${guest.id}">Confirmação de ${e(guest.name)}</label><select id="rsvp-${guest.id}" class="input" name="rsvp_status"${expired ? ' disabled' : ''}>${Object.entries(statusNames).map(([key,label]) => `<option value="${key}"${selected(key,guest.rsvp_status)}>${label}</option>`).join('')}</select><button class="btn"${expired ? ' disabled' : ''}>Salvar</button>`,{class:'inline-form'})}</article>`).join('') || empty('Nenhuma pessoa foi adicionada ao seu convite. Entre em contato com os noivos.')}<div class="actions"><a class="btn" href="/convite/presentes" data-nav>Ver lista de presentes</a></div></section>`;
}
async function guestGifts(page) {
  const [data, mine] = await Promise.all([api(`/guest/gifts?page=${page}`),api('/guest/reservation')]);
  return `${heading('Lista de presentes','Escolha um presente para o seu convite. Cada item representa uma unidade.','Para o nosso lar')}${mine ? `<div class="info-box"><p>Você escolheu <strong>${e(mine.gift.name)}</strong>. <a href="/convite/meus-presentes" data-nav>Ver minha escolha</a>.</p></div>` : '<p class="muted">Confirme a presença de ao menos uma pessoa antes de escolher.</p>'}<div class="grid cols-3">${data.items.map(gift => `<article class="card gift-card">${gift.image_url ? `<img class="gift-img" src="${e(gift.image_url)}" alt="${e(gift.name)}" loading="lazy">` : '<div class="gift-placeholder" aria-hidden="true">♡</div>'}<p class="eyebrow">${e(gift.category_name)}</p><h2>${e(gift.name)}</h2><p class="muted">${e(gift.description)}</p>${gift.estimated_price !== null ? `<p class="gift-price">${e(money(gift.estimated_price))} <small>estimado</small></p>` : ''}${gift.external_url ? `<p><a href="${e(gift.external_url)}" target="_blank" rel="noopener noreferrer">Ver referência</a></p>` : ''}<div class="actions"><button class="btn" type="button" data-action="gift-choice" data-id="${gift.public_id}" data-swap="${!!mine}">${mine ? 'Trocar por este' : 'Escolher'}</button></div></article>`).join('') || empty('Nenhum presente disponível neste momento.')}</div>${pagination(data)}`;
}
async function guestMine() {
  const data = await api('/guest/reservation');
  return `${heading('Seu presente','','Sua escolha')}<section class="card">${data ? `${data.gift.image_url ? `<img class="gift-img" src="${e(data.gift.image_url)}" alt="${e(data.gift.name)}">` : ''}<h2>${e(data.gift.name)}</h2><p>${e(data.gift.description)}</p>${data.gift.external_url ? `<a href="${e(data.gift.external_url)}" target="_blank" rel="noopener noreferrer">Ver referência</a>` : ''}<p class="muted spaced">Escolhido em ${e(dateTime(data.reserved_at))}.</p><div class="actions"><a class="btn" href="/convite/presentes" data-nav>Trocar presente</a><button class="btn danger" type="button" data-action="request" data-endpoint="/guest/gifts/${data.gift.public_id}/reservation" data-method="DELETE" data-confirm="Cancelar a escolha deste presente?" data-message="Escolha cancelada.">Cancelar escolha</button></div>` : '<p>Você ainda não escolheu um presente.</p><a class="btn" href="/convite/presentes" data-nav>Ver presentes</a>'}</section>`;
}
async function render() {
  const version = ++renderVersion;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const page = new URLSearchParams(location.search).get('page') || 1;
  layout(path); main.innerHTML = '<p class="loading">Carregando…</p>';
  try {
    if ((path.startsWith('/admin') && path !== '/admin/login') || path.startsWith('/convite')) {
      session = await api('/session');
      if (path.startsWith('/admin') && session.role !== 'admin') return navigate('/admin/login',true);
      if (path.startsWith('/convite') && session.role !== 'guest') throw new ApiError(401,'Abra o link do seu convite para continuar.');
    }
    let html;
    if (path === '/') html = welcome();
    else if (path === '/admin/login') html = loginPage();
    else if (path === '/admin') html = await dashboard();
    else if (path === '/admin/convites') html = await invitations(page);
    else if (/^\/admin\/convites\/\d+$/.test(path)) html = await invitation(path.split('/').pop());
    else if (path === '/admin/categorias') html = await categories();
    else if (path === '/admin/presentes') html = await adminGifts(page);
    else if (/^\/admin\/presentes\/[a-f\d-]+\/historico$/.test(path)) html = await giftHistory(path.split('/')[3],page);
    else if (path === '/admin/reservas') html = await reservations(page);
    else if (path === '/admin/configuracoes') html = await settingsPage();
    else if (path === '/convite') html = await guestHome();
    else if (path === '/convite/presentes') html = await guestGifts(page);
    else if (path === '/convite/meus-presentes') html = await guestMine();
    else html = `<section class="card">${heading('Página não encontrada')}<a href="/" data-nav>Voltar ao início</a></section>`;
    if (version !== renderVersion) return;
    main.innerHTML = html;
    document.title = `${main.querySelector('h1')?.textContent || publicInfo.couple_names} • ${publicInfo.couple_names}`;
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401 && path.startsWith('/admin')) return navigate('/admin/login',true);
    main.innerHTML = `<section class="card"><h1>${error.status === 401 ? 'Abra seu convite' : 'Não foi possível carregar'}</h1><p>${e(error.message)}</p><a href="/" data-nav>Voltar ao início</a></section>`;
  }
}
async function navigate(path, replace = false) {
  if (replace) history.replaceState(null,'',path); else history.pushState(null,'',path);
  await render(); window.scrollTo(0,0);
}
function busy(element, value) {
  const buttons = element.matches('form') ? [...element.querySelectorAll('button[type="submit"],button:not([type])')] : [element];
  for (const button of buttons) {
    if (value) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = 'Aguarde…'; }
    else { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent; }
  }
}
async function filePayload(file) {
  if (!file?.size) return null;
  if (file.size > 2097152 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Use uma imagem PNG, JPEG ou WebP de até 2 MB.');
  const base64 = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file); });
  return { type: file.type, base64 };
}
document.addEventListener('submit', async event => {
  const element = event.target;
  if (!element.matches('#login-form,form[data-endpoint]')) return;
  event.preventDefault();
  if (element.dataset.confirm && !confirm(element.dataset.confirm)) return;
  busy(element,true);
  try {
    const fields = new FormData(element); const body = Object.fromEntries(fields);
    if (fields.has('image')) { const image = await filePayload(fields.get('image')); delete body.image; if (image) body.image = image; }
    if (element.id === 'login-form') {
      await api('/admin/login','POST',body); await navigate('/admin'); return;
    }
    if (element.dataset.endpoint === '/admin/settings') body.rsvp_deadline_at = body.rsvp_deadline_at ? `${body.rsvp_deadline_at}:00-03:00` : null;
    const data = await api(element.dataset.endpoint,element.dataset.method,body);
    tell(element.dataset.message);
    if (element.dataset.next === 'invitation-created') await navigate(`/admin/convites/${data.id}`);
    else {
      if (element.dataset.endpoint === '/admin/settings') publicInfo = await api('/public');
      await render();
    }
  } catch (error) { tell(error.message,true); }
  finally { busy(element,false); }
});
document.addEventListener('click', async event => {
  const link = event.target.closest('a[data-nav]');
  if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); await navigate(link.getAttribute('href')); return; }
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  if (button.dataset.confirm && !confirm(button.dataset.confirm)) return;
  busy(button,true);
  try {
    switch (button.dataset.action) {
      case 'logout': { const target = session?.role === 'admin' ? '/admin/login' : '/'; await api('/logout','POST'); session = null; await navigate(target); break; }
      case 'request': await api(button.dataset.endpoint,button.dataset.method); tell(button.dataset.message); await render(); break;
      case 'gift-choice': {
        const swap = button.dataset.swap === 'true';
        if (swap && !confirm('Trocar seu presente por este item?')) break;
        await api(`/guest/gifts/${button.dataset.id}/${swap ? 'swap' : 'reserve'}`,'POST');
        tell(swap ? 'Presente trocado.' : 'Presente escolhido.'); await navigate('/convite/meus-presentes'); break;
      }
      case 'issue-token': {
        const data = await api(`/admin/invitations/${button.dataset.id}/tokens`,'POST');
        main.innerHTML = `<section class="card qr-panel"><p class="eyebrow">Convite pronto</p><h1>Novo QR Code</h1><p>Copie o link ou salve o QR Code agora. O link secreto só é mostrado nesta tela.</p><img class="qr" src="${e(data.qr)}" alt="QR Code do convite"><label for="invite-url" class="label">Link do convite</label><input id="invite-url" class="input" readonly value="${e(data.url)}"><div class="actions no-print"><button class="btn" data-action="copy-link" type="button">Copiar link</button><a class="btn secondary" href="${e(data.qr)}" download="qr-convite.png">Salvar QR Code</a><button class="btn secondary" data-action="print" type="button">Imprimir</button></div><p class="spaced no-print"><a href="/admin/convites/${button.dataset.id}" data-nav>Voltar ao convite</a></p></section>`;
        break;
      }
      case 'copy-link': {
        const input = document.querySelector('#invite-url'); input.select();
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(input.value); tell('Link copiado.'); }
        else tell('Link selecionado. Pressione Ctrl+C para copiar.');
        break;
      }
      case 'print': window.print(); break;
    }
  } catch (error) { tell(error.message,true); }
  finally { busy(button,false); }
});
window.addEventListener('popstate',render);
try { publicInfo = await api('/public'); } catch (error) { tell(error.message,true); }
await render();
