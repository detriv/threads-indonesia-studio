import type { FastifyInstance } from 'fastify';

/** Login admin untuk test integrasi; mengembalikan header cookie + token CSRF. */
export async function adminLogin(app: FastifyInstance, username = 'admin', password = 'password-lokal-yang-kuat'): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (response.statusCode !== 200) throw new Error(`Login test gagal: ${response.statusCode} ${response.body}`);
  return {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    csrf: response.cookies.find((c) => c.name === 'csrf')?.value ?? ''
  };
}
