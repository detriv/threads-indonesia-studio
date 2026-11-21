import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {resetTestDatabase,truncateAll} from '@threads-id/db/testing';
import {DraftRepository,EditorialRepository,GenerationRepository} from '@threads-id/db';
import {processGeneration} from './generation-processor.js';
import {simulateGeneration} from './generation-provider.js';
let pool:pg.Pool;let drafts:DraftRepository;let editorial:EditorialRepository;let repo:GenerationRepository;
beforeAll(async()=>{pool=await resetTestDatabase();drafts=new DraftRepository(pool);editorial=new EditorialRepository(pool);repo=new GenerationRepository(pool);});
beforeEach(async()=>{await truncateAll(pool);await editorial.seedDefaults();});
afterAll(async()=>{await pool.end();});
const cfg={provider:'SIMULATION' as const,model:'simulation-v1',dailyLimit:20};
it.each(['source deletion','theme change','format change'] as const)('revision rejects %s during provider even when FK/SQL leaves version unchanged',async(change)=>{
 const themes=await editorial.listThemes();const theme=themes[0]!;
 const owner=await editorial.addPersonalSource('Catatan pribadi yang dahulu dipilih pemilik.');
 const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Teks pemilik tidak boleh tertimpa.',personalSourceId:owner.id});
 const r=await repo.submit(randomUUID(),{purpose:'REVISE',themeId:theme.id,format:d.format,draftId:d.id,expectedVersion:d.version,personalSourceId:owner.id},cfg);
 await processGeneration(r.id,repo,async(i,c)=>{
  if(change==='source deletion')await pool.query('DELETE FROM personal_sources WHERE id=$1',[owner.id]);
  if(change==='theme change')await pool.query('UPDATE drafts SET theme_id=$2 WHERE id=$1',[d.id,themes[1]!.id]);
  if(change==='format change')await pool.query("UPDATE drafts SET format='BAHASAN_LEBIH_DALAM' WHERE id=$1",[d.id]);
  expect((await drafts.get(d.id))!.version).toBe(d.version);
  return simulateGeneration(i,c);
 });
 expect(await repo.get(r.id)).toMatchObject({status:'FAILED',error_code:'CONFLICT',draft_ids:[]});
 const after=(await drafts.get(d.id))!;
 expect(after.text).toBe(d.text);expect(after.version).toBe(d.version);
 expect(after.personalSourceId).toBe(change==='source deletion'?null:owner.id);
 expect((await pool.query('SELECT * FROM drafts')).rowCount).toBe(1);
});
it.each(['AI','manual'] as const)('approved regular backup %s rewrite requires explicit reapproval before fallback',async(mode)=>{
 const theme=(await editorial.listThemes())[0]!;
 const d=await drafts.create({themeId:theme.id,format:'OBSERVASI_PENDEK',text:'Teks cadangan yang ditinjau pemilik.'});
 await drafts.review(d.id,'APPROVE');
 const failed=await repo.submit(randomUUID(),{purpose:'SHORT',themeId:theme.id},cfg);
 await processGeneration(failed.id,repo,async()=>{throw new Error('TIMEOUT');});
 expect((await repo.fallback(failed.id))!.id).toBe(d.id);
 const current=(await drafts.get(d.id))!;
 if(mode==='AI'){
  const r=await repo.submit(randomUUID(),{purpose:'REVISE',themeId:theme.id,format:d.format,draftId:d.id,expectedVersion:current.version},cfg);
  await processGeneration(r.id,repo,simulateGeneration);
  expect((await repo.get(r.id)).status).toBe('COMPLETED');
 }else await drafts.update(d.id,{text:'Isi manual baru yang belum ditinjau.'},current.version);
 expect((await drafts.get(d.id))!.status).toBe('DRAFT');
 expect(await repo.fallback(failed.id)).toBeNull();
 await drafts.review(d.id,'APPROVE');
 expect((await repo.fallback(failed.id))!.id).toBe(d.id);
 expect((await pool.query('SELECT * FROM schedule_entries')).rowCount).toBe(0);
});
