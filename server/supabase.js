import { createClient } from '@supabase/supabase-js';
import { HttpError } from './validation.js';

export function clients(config) {
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  };

  return {
    db: createClient(
      config.supabaseUrl,
      config.secretKey,
      options
    ),

    login: async (email, password) => {
      const auth = createClient(
        config.supabaseUrl,
        config.publishableKey,
        options
      );

      const { data, error } = await auth.auth.signInWithPassword({
        email,
        password
      });

      if (error || !data.user) {
        throw new HttpError(401, 'E-mail ou senha inválidos.');
      }

      await auth.auth.signOut({ scope: 'local' });
      return data.user;
    }
  };
}

export async function result(query) {
  const { data, error } = await query;

  if (error) {
    console.error('Erro Supabase:', {
      code: error.code,
      message: error.message
    });

    if (error.code === 'P0001') {
      throw new HttpError(422, error.message);
    }

    if (error.code === 'P0002') {
      throw new HttpError(404, error.message);
    }

    if (error.code === '42501') {
      throw new HttpError(403, 'Acesso negado.');
    }

    if (error.code === '23505') {
      throw new HttpError(
        409,
        'Este nome já existe ou o presente/convite acabou de receber uma reserva.'
      );
    }

    if (['23503', '23514', '22003', '22P02'].includes(error.code)) {
      throw new HttpError(
        422,
        'Dados inválidos. Verifique os campos e tente novamente.'
      );
    }

    throw new HttpError(
      503,
      'Não foi possível consultar o banco. Verifique a configuração do Supabase.'
    );
  }

  return data;
}
