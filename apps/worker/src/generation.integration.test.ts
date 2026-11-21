import { PgBoss } from 'pg-boss';
import { TEST_DATABASE_URL } from '@threads-id/db/testing';
import { dispatchGenerationRequests } from './generation-dispatcher.js';
import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import type pg from 'pg';
import { resetTestDatabase,truncateAll } from '@threads-id/db/testing';
import { EditorialRepository,GenerationRepository,DraftRepository,ScheduleRepository } from '@threads-id/db';
import { randomUUID } from 'node:crypto';
import { processGeneration } from './generation-processor.js';
import { simulateGeneration } from './generation-provider.js';
let pool:pg.Pool; let repo:GenerationRepository; let editorial:EditorialRepository;
beforeAll(async()=>{pool=await resetTestDatabase();repo=new GenerationRepository(pool);editorial=new EditorialRepository(pool);});
beforeEach(async()=>{await truncateAll(pool);await editorial.seedDefaults();});
afterAll(async()=>{await pool.end();});
async function submit(purpose='TRY_THEME', dailyLimit=20) {
 const theme=(await editorial.listThemes())[0]!;
 return repo.submit(randomUUID(),{purpose,themeId:theme.id,format:'OBSERVASI_PENDEK'}, {provider:'SIMULATION',model:'simulation-v1',dailyLimit});
}
it('Coba tema durable menyimpan tiga draft tanpa jadwal dan idempoten pada worker konkuren',async()=>{
 const r=await submit();
 await Promise.all([processGeneration(r.id,repo,simulateGeneration),processGeneration(r.id,repo,simulateGeneration)]);
 const persisted=await repo.get(r.id);
 expect(persisted.status).toBe('COMPLETED');
 expect(persisted.draft_ids).toHaveLength(3);
 expect((await pool.query('SELECT * FROM drafts')).rowCount).toBe(3);
 expect((await pool.query('SELECT * FROM schedule_entries')).rowCount).toBe(0);
 expect(persisted.usage).toBeNull();expect(persisted.estimated_cost).toBeNull();
 await processGeneration(r.id,repo,async()=>{throw new Error('should not call');});
 expect((await pool.query('SELECT * FROM drafts')).rowCount).toBe(3);
});
it('kuota generasi konkuren terpisah dari kuota publikasi dan replay ID tidak dihitung lagi',async()=>{
 await pool.query("CREATE FUNCTION generation_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$; CREATE TRIGGER generation_slow BEFORE INSERT ON generation_requests FOR EACH ROW EXECUTE FUNCTION generation_slow()");
 try {
  const results=await Promise.allSettled([submit('SHORT',1),submit('DEEP',1)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const [r]=await repo.list();
  expect((await repo.submit(r!.id,r!.input,{provider:'SIMULATION',model:'simulation-v1',dailyLimit:1})).id).toBe(r!.id);
  expect((await editorial.getSettings()).dailyPostLimit).toBe(2);
 }finally{await pool.query('DROP TRIGGER generation_slow ON generation_requests; DROP FUNCTION generation_slow()');}
});
it('revisi menolak kunci dan versi usang saat request, mempertahankan edit manual saat commit',async()=>{
 const drafts=new DraftRepository(pool); const theme=(await editorial.listThemes())[0]!;
 const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Teks manual pemilik.'});
 const input={purpose:'REVISE',themeId:theme.id,format:d.format,draftId:d.id,expectedVersion:d.version};
 const cfg={provider:'SIMULATION' as const,model:'simulation-v1',dailyLimit:20};
 await drafts.setLocked(d.id,true);
 await expect(repo.submit(randomUUID(),input,cfg)).rejects.toThrow('CONFLICT');
 await drafts.setLocked(d.id,false);
 const r=await repo.submit(randomUUID(),{...input,expectedVersion:(await drafts.get(d.id))!.version},cfg);
 expect(r.context.original?.text).toBe(d.text);
 await processGeneration(r.id,repo,async(i,c)=>{await drafts.update(d.id,{text:'Edit manual ketika AI berjalan.'});return simulateGeneration(i,c);});
 expect((await repo.get(r.id)).error_code).toBe('CONFLICT');
 expect((await drafts.get(d.id))!.text).toBe('Edit manual ketika AI berjalan.');
 expect((await pool.query('SELECT * FROM drafts')).rowCount).toBe(1);
 await expect(repo.submit(randomUUID(),input,cfg)).rejects.toThrow('CONFLICT');
});
it('revisi tidak boleh mengganti provenance pengalaman atau bukti tren diam-diam',async()=>{
 const drafts=new DraftRepository(pool);const theme=(await editorial.listThemes())[0]!;
 const owner=await editorial.addPersonalSource('Catatan yang dipakai pemilik.');const other=await editorial.addPersonalSource('Catatan lain bukan untuk draft ini.');
 const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Tulisan asli pemilik.',personalSourceId:owner.id});
 await expect(repo.submit(randomUUID(),{purpose:'REVISE',themeId:theme.id,format:d.format,draftId:d.id,expectedVersion:d.version,personalSourceId:other.id},{provider:'SIMULATION',model:'simulation-v1',dailyLimit:20})).rejects.toThrow('CONFLICT');
});
it('kegagalan menyimpan error aman dan mengembalikan fallback approved reguler tanpa mutasi',async()=>{
 const drafts=new DraftRepository(pool); const theme=(await editorial.listThemes())[0]!;
 const candidate=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Draft siap milik pemilik.'});
 await pool.query("UPDATE drafts SET status='APPROVED' WHERE id=$1",[candidate.id]);
 const locked=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Tidak boleh dipilih.'});
 await pool.query("UPDATE drafts SET status='APPROVED',locked=true WHERE id=$1",[locked.id]);
 const r=await submit();
 await processGeneration(r.id,repo,async()=>{throw new Error('RATE_LIMIT');});
 const result=await repo.get(r.id);
 expect(result).toMatchObject({status:'FAILED',error_code:'RATE_LIMIT',draft_ids:[],fallback_draft_id:candidate.id});
 const fallback=await repo.fallback(r.id);
 expect(fallback?.text).toBe(candidate.text);
 expect((await drafts.get(candidate.id))!.status).toBe('APPROVED');
 expect((await pool.query('SELECT * FROM schedule_entries')).rowCount).toBe(0);
 await drafts.setLocked(candidate.id,true);
 expect(await repo.fallback(r.id)).toBeNull();
});
it('pemakaian provider dan attempt tercatat, biaya tidak dikarang, recovery PROCESSING aman',async()=>{
 const r=await submit('SHORT');
 await pool.query("UPDATE generation_requests SET status='PROCESSING' WHERE id=$1",[r.id]);
 await pool.query("INSERT INTO generation_attempts(id,request_id,provider,model) VALUES($1,$2,'SIMULATION','simulation-v1')",[randomUUID(),r.id]);
 await processGeneration(r.id,repo,async(i,c)=>({...await simulateGeneration(i,c),usage:{promptTokens:12,outputTokens:20,totalTokens:32},actualModel:'fixture-model-001'}));
 const result=await repo.get(r.id);
 expect(result.usage?.totalTokens).toBe(32);expect(result.actual_model).toBe('fixture-model-001');expect(result.estimated_cost).toBeNull();
 const attempts=(await pool.query('SELECT * FROM generation_attempts WHERE request_id=$1 ORDER BY created_at',[r.id])).rows;
 expect(attempts.map(a=>a.status)).toEqual(['UNKNOWN','COMPLETED']);
 expect(attempts[1].usage.totalTokens).toBe(32);
 expect((await pool.query('SELECT * FROM drafts')).rowCount).toBe(1);
});
it('revisi sukses memakai versi terbaru, jadwal reguler naik versi dan tren dibatalkan untuk review baru',async()=>{
 const drafts=new DraftRepository(pool),schedule=new ScheduleRepository(pool);const theme=(await editorial.listThemes())[0]!;
 for(const format of ['OBSERVASI_PENDEK','TREN_RELEVAN'] as const){
  const d=await drafts.create({themeId:theme.id,format,text:'Teks manual sebelum revisi.',sourceUrl:format==='TREN_RELEVAN'?'https://example.org/fixture':null,sourceTime:'2026-01-01T00:00:00Z',relevanceNote:'Kaitan yang jelas dengan kehidupan usia 20-an.'});
  if(format==='TREN_RELEVAN')await drafts.review(d.id,'APPROVE');
  const entry=await schedule.create(d.id,new Date(Date.now()+86400000));
  const current=(await drafts.get(d.id))!;
  const r=await repo.submit(randomUUID(),{purpose:'REVISE',themeId:theme.id,format,draftId:d.id,expectedVersion:current.version,evidence:format==='TREN_RELEVAN'?{url:current.sourceUrl,time:current.sourceTime,relevance:current.relevanceNote}:null},{provider:'SIMULATION',model:'simulation-v1',dailyLimit:20});
  await processGeneration(r.id,repo,simulateGeneration);
  expect((await repo.get(r.id)).status).toBe('COMPLETED');
  expect((await schedule.get(entry.id))!.version).toBe(entry.version+1);
  expect((await schedule.get(entry.id))!.status).toBe(format==='TREN_RELEVAN'?'CANCELLED':'SCHEDULED');
  expect((await drafts.get(d.id))!.text).toContain('Teks manual sebelum revisi.');
  if(format==='TREN_RELEVAN')expect((await drafts.get(d.id))!.status).toBe('IN_REVIEW');
 }
});
it('empat pilar dan tren menyimpan sumber terpilih; invalid output tidak menjadi tiga draft',async()=>{
 const themes=await editorial.listThemes();
 await editorial.addVoiceExample('Aku suka cerita santai.');
 const owner=await editorial.addPersonalSource('Pemilik pernah lupa cek jam saat membaca grup kerja.');
 const ignored=await editorial.addPersonalSource('CATATAN TIDAK DIPILIH');
 for(const [i,t] of themes.entries()){
  const input={purpose:i===1?'DEEP':'SHORT',themeId:t.id,format:i===1?'BAHASAN_LEBIH_DALAM':'OBSERVASI_PENDEK',personalSourceId:i===2?owner.id:null};
  const r=await repo.submit(randomUUID(),input,{provider:'SIMULATION',model:'simulation-v1',dailyLimit:20});
  expect(JSON.stringify(r.context)).not.toContain(ignored.note);
  expect(r.context.ownerNote).toBe(i===2?owner.note:null);
  await processGeneration(r.id,repo,simulateGeneration);
  const persisted=await repo.get(r.id);const d=await new DraftRepository(pool).get(persisted.draft_ids[0]!);
  expect(d!.text).toContain('Aku');expect(d!.themeId).toBe(t.id);expect(d!.format).toBe(input.format);
 }
 const evidence={url:'https://example.org/evidence-fixture',time:'2026-01-01T00:00:00Z',relevance:'Bukti fixture terkait kebiasaan digital audiens usia 20-an.'};
 const trend=await repo.submit(randomUUID(),{purpose:'IDEAS',themeId:themes[2]!.id,format:'TREN_RELEVAN',evidence},{provider:'SIMULATION',model:'simulation-v1',dailyLimit:20});
 await processGeneration(trend.id,repo,simulateGeneration);
 const d=await new DraftRepository(pool).get((await repo.get(trend.id)).draft_ids[0]!);
 expect(d).toMatchObject({status:'IN_REVIEW',sourceUrl:evidence.url,sourceTime:'2026-01-01T00:00:00.000Z',relevanceNote:evidence.relevance});
 const invalid=await submit();
 await processGeneration(invalid.id,repo,async()=>({output:{drafts:[]},usage:null}));
 expect(await repo.get(invalid.id)).toMatchObject({status:'FAILED',error_code:'INVALID_OUTPUT',draft_ids:[]});
});
it('pemilik dapat menyetujui draft reguler sebagai cadangan melalui policy review',async()=>{
 const drafts=new DraftRepository(pool);const theme=(await editorial.listThemes())[0]!;
 const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Cadangan reguler siap ditinjau pemilik.'});
 expect((await drafts.review(d.id,'APPROVE')).status).toBe('APPROVED');
 const r=await submit();await processGeneration(r.id,repo,async()=>{throw new Error('TIMEOUT');});
 expect((await repo.fallback(r.id))!.id).toBe(d.id);
});
it('dua revisi konkuren hanya commit satu dan perubahan lock selama provider dipertahankan',async()=>{
 const drafts=new DraftRepository(pool);const theme=(await editorial.listThemes())[0]!;const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Pemilik menulis teks ini.'});
 const input={purpose:'REVISE',themeId:theme.id,format:d.format,draftId:d.id,expectedVersion:d.version};const cfg={provider:'SIMULATION' as const,model:'simulation-v1',dailyLimit:20};
 const a=await repo.submit(randomUUID(),input,cfg),b=await repo.submit(randomUUID(),input,cfg);
 let arrived=0;let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
 const adapter=async(i:Parameters<typeof simulateGeneration>[0],c:Parameters<typeof simulateGeneration>[1])=>{if(++arrived===2)release();await barrier;return simulateGeneration(i,c);};
 await Promise.all([processGeneration(a.id,repo,adapter),processGeneration(b.id,repo,adapter)]);
 expect([(await repo.get(a.id)).status,(await repo.get(b.id)).status].sort()).toEqual(['COMPLETED','FAILED']);
 expect((await drafts.get(d.id))!.version).toBe(d.version+1);
 const current=(await drafts.get(d.id))!;const lockedRequest=await repo.submit(randomUUID(),{...input,expectedVersion:current.version},cfg);
 await processGeneration(lockedRequest.id,repo,async(i,c)=>{await drafts.setLocked(d.id,true);await drafts.setLocked(d.id,false);return simulateGeneration(i,c);});
 expect((await repo.get(lockedRequest.id)).error_code).toBe('CONFLICT');expect((await drafts.get(d.id))!.text).toBe(current.text);
});
it('dispatcher pg-boss tidak membanjiri job duplikat saat polling request pending',async()=>{
 const boss=new PgBoss({connectionString:TEST_DATABASE_URL});await boss.start();
 try{
  const r=await submit();
  await dispatchGenerationRequests(repo,boss);await dispatchGenerationRequests(repo,boss);await dispatchGenerationRequests(repo,boss);
  expect(Number((await pool.query("SELECT count(*) n FROM pgboss.job WHERE name='content.generate' AND data->>'requestId'=$1",[r.id])).rows[0].n)).toBe(1);
 }finally{await boss.stop();}
});
