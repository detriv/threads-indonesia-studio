import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import type pg from 'pg';
import {resetTestDatabase,truncateAll} from '@threads-id/db/testing';
import {AuthRepository,EditorialRepository,GenerationRepository,hashPassword} from '@threads-id/db';
import {buildApp} from './app.js';
import {adminLogin} from './testing.js';
import {randomUUID} from 'node:crypto';
let pool:pg.Pool;let auth:AuthRepository;let editorial:EditorialRepository;let generation:GenerationRepository;
beforeAll(async()=>{pool=await resetTestDatabase();auth=new AuthRepository(pool);editorial=new EditorialRepository(pool);generation=new GenerationRepository(pool);});
afterAll(async()=>{await pool.end();});
beforeEach(async()=>{await truncateAll(pool);await auth.ensureAdmin('admin',await hashPassword('password-lokal-yang-kuat'));await editorial.seedDefaults();});
it('API generasi memerlukan auth/CSRF, menyimpan request durable dan mengekspos provider jujur',async()=>{
 const app=buildApp({repo:{create:vi.fn(),get:vi.fn(),list:vi.fn()},queue:{send:vi.fn()},auth,editorial,generation});
 try {
  expect((await app.inject({method:'GET',url:'/api/generations'})).statusCode).toBe(401);
  const {cookie,csrf}=await adminLogin(app);
  const theme=(await editorial.listThemes())[0]!;
  const body={id:randomUUID(),input:{purpose:'TRY_THEME',themeId:theme.id}};
  expect((await app.inject({method:'POST',url:'/api/generations',headers:{cookie},payload:body})).statusCode).toBe(403);
  const response=await app.inject({method:'POST',url:'/api/generations',headers:{cookie,'x-csrf-token':csrf},payload:body});
  expect(response.statusCode).toBe(202);expect(response.json()).toMatchObject({id:body.id,status:'QUEUED',provider:'SIMULATION'});
  const config=(await app.inject({method:'GET',url:'/api/generations/config',headers:{cookie}})).json();
  expect(config).toMatchObject({provider:'SIMULATION',livePublication:false});
  expect(JSON.stringify(config)).not.toContain('apiKey');
  expect((await generation.pending())).toEqual([body.id]);
 }finally{await app.close();}
});
