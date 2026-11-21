import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {generationInputSchema,GENERATION_ERRORS} from '@threads-id/contracts';
import {generationConfig} from '@threads-id/db';
import type {GenerationRepository} from '@threads-id/db';
export function registerGenerationRoutes(app:FastifyInstance,repo:GenerationRepository):void {
 app.get('/api/generations/config',async()=>({provider:generationConfig('SHORT').provider,dailyLimit:generationConfig('SHORT').dailyLimit,models:Object.fromEntries(['IDEAS','SHORT','DEEP','REVISE','TRY_THEME'].map(p=>[p,generationConfig(p).model])),livePublication:false,note:'Provider generasi terpisah dari simulasi publikasi. Konfigurasi bukan bukti koneksi Gemini; verifikasi live belum dilakukan.'}));
 app.get('/api/generations',async()=>repo.list());
 app.get('/api/generations/usage',async()=>{
  const r=await repo.pool.query(`SELECT count(*)::int AS requests, count(*) FILTER(WHERE status='FAILED')::int AS failures FROM generation_requests`);
  const a=await repo.pool.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE status='UNKNOWN')::int AS unknown_attempts, sum((usage->>'totalTokens')::bigint)::text AS total_tokens, sum(estimated_cost)::text AS estimated_cost FROM generation_attempts`);
  const daily=await repo.pool.query(`SELECT count(*)::int AS today_requests FROM generation_requests WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date`);
  return {...r.rows[0],...a.rows[0],...daily.rows[0],dailyLimit:generationConfig('SHORT').dailyLimit,currency:'USD',note:'Token/biaya null berarti belum diketahui; simulasi bukan penggunaan Gemini nyata. UNKNOWN: worker terhenti; penggunaan provider mungkin sudah terjadi.'};
 });
 app.post('/api/generations',async(request,reply)=>{
  const parsed=z.object({id:z.uuid(),input:generationInputSchema}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:'Permintaan generasi tidak valid. Revisi perlu versi, tren perlu URL/waktu/relevansi.'});
  try {return reply.code(202).send(await repo.submit(parsed.data.id,parsed.data.input,generationConfig(parsed.data.input.purpose)));}
  catch(error){const code=error instanceof Error?error.message:'';return reply.code(code==='QUOTA'?429:code==='CONFLICT'||code==='IDEMPOTENCY_CONFLICT'?409:400).send({error:GENERATION_ERRORS[code]??'Permintaan generasi ditolak; periksa tema, catatan pemilik, dan versi draft.'});}
 });
 app.get<{Params:{id:string}}>('/api/generations/:id',async(request,reply)=>{
  if(!z.uuid().safeParse(request.params.id).success)return reply.code(400).send({error:'ID tidak valid'});
  try{return await repo.get(request.params.id);}catch{return reply.code(404).send({error:'Generasi tidak ditemukan'});}
 });
 app.get<{Params:{id:string}}>('/api/generations/:id/fallback',async(request,reply)=>{
  if(!z.uuid().safeParse(request.params.id).success)return reply.code(400).send({error:'ID tidak valid'});
  try{return {draft:await repo.fallback(request.params.id),note:'Draft lama, bukan hasil generasi baru. Tidak dijadwalkan otomatis.'};}catch{return reply.code(404).send({error:'Generasi tidak ditemukan'});}
 });
}
