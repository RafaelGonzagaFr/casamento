import express from 'express';
import { createApp } from './server/app.js';
import { clients } from './server/supabase.js';

const config = {
  origin: new URL(process.env.APP_URL).origin,
  production: true,
  supabaseUrl: process.env.SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  secretKey: process.env.SUPABASE_SECRET_KEY,
  bucket: process.env.STORAGE_BUCKET || 'wedding-gifts',
  trustProxy: 1,
};

const app = express();

app.use(createApp(config, clients(config)));

export default app;