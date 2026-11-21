import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { generationInputSchema, validateGenerationOutput } from '@threads-id/contracts';
import type { GenerationInput,GenerationContext,GenerationResult } from '@threads-id/contracts';
import { EditorialRepository } from './editorial.js';
import { DraftRepository } from './drafts.js';
export type GenerationConfig={provider:'SIMULATION'|'GEMINI';model:string;dailyLimit:number};
export function generationConfig(purpose:string):GenerationConfig {
 const selected=process.env.GENERATION_PROVIDER??'simulation';
 if(!['simulation','gemini'].includes(selected))throw new Error('CONFIG');
 const provider=selected==='gemini'?'GEMINI':'SIMULATION';
 return {provider,model:provider==='SIMULATION'?'simulation-v1':(process.env[`GEMINI_MODEL_${purpose}`]||process.env.GEMINI_MODEL||''),dailyLimit:Number(process.env.GENERATION_DAILY_LIMIT??20)};
}
export type GenerationRow={id:string;input:GenerationInput;context:GenerationContext;provider:'SIMULATION'|'GEMINI';model:string;status:string;draft_ids:string[];usage:GenerationResult['usage'];actual_model:string|null;estimated_cost:string|null;error_code:string|null;error:string|null;fallback_draft_id:string|null;created_at:Date};
export class GenerationRepository {
 constructor(readonly pool:pg.Pool){}
 async get(id:string):Promise<GenerationRow>{const r=await this.pool.query<GenerationRow>('SELECT * FROM generation_requests WHERE id=$1',[id]);if(!r.rows[0])throw new Error('NOT_FOUND');return r.rows[0];}
 async list():Promise<GenerationRow[]>{return (await this.pool.query<GenerationRow>('SELECT * FROM generation_requests ORDER BY created_at DESC LIMIT 100')).rows;}
 async pending():Promise<string[]>{return (await this.pool.query<{id:string}>("SELECT id FROM generation_requests WHERE status IN ('QUEUED','PROCESSING') ORDER BY created_at LIMIT 50")).rows.map(r=>r.id);}
 async submit(id:string,value:unknown,config:GenerationConfig):Promise<GenerationRow>{
  const input=generationInputSchema.parse(value);
  const editorial=new EditorialRepository(this.pool);
  const theme=await editorial.getTheme(input.themeId);if(!theme?.active)throw new Error('Tema tidak aktif');
  const voices=(await editorial.listVoiceExamples()).map(v=>v.text);
  const owner=input.personalSourceId?(await editorial.listPersonalSources()).find(s=>s.id===input.personalSourceId):null;
  if(input.personalSourceId && !owner)throw new Error('Catatan pemilik tidak ditemukan');
  const context:GenerationContext={theme:{name:theme.name,examples:theme.examples},voices,ownerNote:owner?.note??null,original:null};
  const client=await this.pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('SELECT id FROM editorial_settings WHERE id=1 FOR UPDATE');
   const existing=(await client.query<GenerationRow>('SELECT * FROM generation_requests WHERE id=$1',[id])).rows[0];
   if(existing){
    if(JSON.stringify(existing.input)!==JSON.stringify(input)) {
     // JSONB key ordering differs; compare canonically in PostgreSQL.
     const same=(await client.query<{same:boolean}>('SELECT input=$2::jsonb AS same FROM generation_requests WHERE id=$1',[id,JSON.stringify(input)])).rows[0]!.same;
     if(!same)throw new Error('IDEMPOTENCY_CONFLICT');
    }
    await client.query('COMMIT');return existing;
   }
   if(input.purpose==='REVISE'){
    const draft=(await client.query<{text:string;format:GenerationInput['format'];theme_id:string;locked:boolean;version:number;status:string;personal_source_id:string|null;source_url:string|null;source_time:Date|null;relevance_note:string|null}>('SELECT * FROM drafts WHERE id=$1 FOR UPDATE',[input.draftId])).rows[0];
    if(!draft || draft.locked || draft.status==='CANCELLED' || draft.version!==input.expectedVersion || draft.theme_id!==input.themeId || draft.format!==input.format)throw new Error('CONFLICT');
    if(draft.personal_source_id!==input.personalSourceId)throw new Error('CONFLICT');
    if(draft.format==='TREN_RELEVAN' && (draft.source_url!==input.evidence?.url || draft.source_time?.getTime()!==Date.parse(input.evidence?.time??'') || draft.relevance_note!==input.evidence?.relevance))throw new Error('CONFLICT');
    context.original={text:draft.text,format:draft.format};
   }
   const count=Number((await client.query<{n:string}>("SELECT count(*) n FROM generation_requests WHERE (created_at AT TIME ZONE 'Asia/Jakarta')::date=(now() AT TIME ZONE 'Asia/Jakarta')::date")).rows[0]!.n);
   if(!Number.isInteger(config.dailyLimit)||config.dailyLimit<1||count>=config.dailyLimit)throw new Error('QUOTA');
   await client.query('INSERT INTO generation_requests(id,input,context,provider,model) VALUES($1,$2,$3,$4,$5)',[id,input,context,config.provider,config.model]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return this.get(id);
 }
 async fallback(requestId:string) {
  const row=await this.get(requestId);
  if(row.status!=='FAILED')return null;
  return row.fallback_draft_id?new DraftRepository(this.pool).getReadyFallback(row.fallback_draft_id):null;
 }
 async fail(client:pg.PoolClient,id:string,code:string,message:string){
  await client.query(`UPDATE generation_requests SET status='FAILED',error_code=$2,error=$3,updated_at=now(),fallback_draft_id=(SELECT d.id FROM drafts d JOIN themes t ON t.id=d.theme_id WHERE d.status='APPROVED' AND NOT d.locked AND d.format<>'TREN_RELEVAN' AND t.active AND NOT EXISTS(SELECT 1 FROM schedule_entries s WHERE s.draft_id=d.id) ORDER BY d.created_at LIMIT 1) WHERE id=$1`,[id,code,message]);
 }
 async complete(client:pg.PoolClient,row:GenerationRow,result:GenerationResult,attemptId?:string):Promise<void>{
  let output:ReturnType<typeof validateGenerationOutput>;
  try {output=validateGenerationOutput(result.output,row.input);}catch{throw new Error('INVALID_OUTPUT');}
  await client.query('BEGIN');
  try {
   await client.query('SELECT id FROM editorial_settings WHERE id=1 FOR UPDATE');
   const ids:string[]=[];
   if(row.input.purpose==='REVISE'){
    try {
     // FK ON DELETE SET NULL can change provenance without incrementing draft.version.
     // Compare the admission snapshot again while holding the commit-boundary draft lock.
     const current=(await client.query<{theme_id:string;format:GenerationInput['format'];personal_source_id:string|null;source_url:string|null;source_time:Date|null;relevance_note:string|null}>(
      'SELECT theme_id,format,personal_source_id,source_url,source_time,relevance_note FROM drafts WHERE id=$1 FOR UPDATE',[row.input.draftId])).rows[0];
     if(!current || current.theme_id!==row.input.themeId || current.format!==row.input.format || current.personal_source_id!==row.input.personalSourceId)throw new Error('CONFLICT');
     if(current.format==='TREN_RELEVAN' && (current.source_url!==row.input.evidence?.url || current.source_time?.getTime()!==Date.parse(row.input.evidence?.time??'') || current.relevance_note!==row.input.evidence?.relevance))throw new Error('CONFLICT');
     await new DraftRepository(this.pool).update(row.input.draftId!,{text:output.drafts[0]!.text},row.input.expectedVersion!,client);
    }catch {throw new Error('CONFLICT');}
    ids.push(row.input.draftId!);
   } else for(const d of output.drafts){const id=randomUUID();ids.push(id);await client.query(`INSERT INTO drafts(id,theme_id,format,text,status,source_url,source_time,relevance_note,personal_source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,row.input.themeId,d.format,d.text,d.format==='TREN_RELEVAN'?'IN_REVIEW':'DRAFT',row.input.evidence?.url??null,row.input.evidence?.time??null,row.input.evidence?.relevance??null,row.input.personalSourceId]);}
   await client.query("UPDATE generation_requests SET status='COMPLETED',draft_ids=$2,usage=$3,actual_model=$4,updated_at=now() WHERE id=$1",[row.id,ids,result.usage,result.actualModel??null]);
   if(attemptId)await client.query("UPDATE generation_attempts SET status='COMPLETED',completed_at=now() WHERE id=$1",[attemptId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
 }
}
