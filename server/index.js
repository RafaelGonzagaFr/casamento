import { createApp } from './app.js';
import { clients } from './supabase.js';
const required = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','APP_URL'];
for (const key of required) if (!process.env[key] || /SUBSTITUA|SEU-PROJETO/.test(process.env[key])) {
  console.error(`Configure ${key} no arquivo .env. Consulte o README.md.`); process.exit(1);
}
const production = process.env.NODE_ENV === 'production';
const url = new URL(process.env.APP_URL);
if (production && url.protocol !== 'https:') { console.error('APP_URL deve usar HTTPS em produção.'); process.exit(1); }
if (url.pathname !== '/' || url.search || url.hash) { console.error('APP_URL deve ser somente a origem, sem caminho.'); process.exit(1); }
const config = {
  origin: url.origin, production, supabaseUrl: process.env.SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY, secretKey: process.env.SUPABASE_SECRET_KEY,
  bucket: process.env.STORAGE_BUCKET || 'wedding-gifts', trustProxy: Number(process.env.TRUST_PROXY || 0),
};
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(config.trustProxy) || config.trustProxy < 0) {
  console.error('PORT ou TRUST_PROXY inválido.'); process.exit(1);
}
const server = createApp(config, clients(config)).listen(port, '0.0.0.0', () => console.log(`Aplicativo iniciado: ${config.origin}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
