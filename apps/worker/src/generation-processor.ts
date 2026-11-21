import { randomUUID } from 'node:crypto';
import type { GenerationRepository } from '@threads-id/db';
import type { GenerationInput,GenerationContext,GenerationResult } from '@threads-id/contracts';
import { estimateCost } from './generation-provider.js';
import { GENERATION_ERRORS } from '@threads-id/contracts';
export type GenerationAdapter=(input:GenerationInput,context:GenerationContext,model:string,provider:'GEMINI'|'SIMULATION')=>Promise<GenerationResult>;
/** Session advisory lock survives transactions, is released by PostgreSQL on worker death.
 * Never hold editorial/draft row locks during network IO. Terminal persisted request prevents duplicate drafts. */
export async function processGeneration(id:string,repo:GenerationRepository,adapter:GenerationAdapter):Promise<void>{
 const client=await repo.pool.connect();
 let locked=false;
 try {
  locked=(await client.query<{ok:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1, 2)) AS ok',[id])).rows[0]!.ok;
  if(!locked)return;
  const row=await repo.get(id);if(!['QUEUED','PROCESSING'].includes(row.status))return;
  await client.query("UPDATE generation_requests SET status='PROCESSING',updated_at=now() WHERE id=$1",[id]);
  const attemptId=randomUUID();
  await client.query("UPDATE generation_attempts SET status='UNKNOWN',completed_at=now() WHERE request_id=$1 AND status='STARTED'",[id]);
  await client.query('INSERT INTO generation_attempts(id,request_id,provider,model) VALUES($1,$2,$3,$4)',[attemptId,id,row.provider,row.model]);
  try {
   const result=await adapter(row.input,row.context,row.model,row.provider);
   await client.query('UPDATE generation_attempts SET usage=$2,actual_model=$3 WHERE id=$1',[attemptId,result.usage,result.actualModel??null]);
   await client.query('UPDATE generation_requests SET usage=$2,actual_model=$3 WHERE id=$1',[id,result.usage,result.actualModel??null]);
   const cost=estimateCost(row.provider,result.actualModel??row.model,result.usage,process.env.GEMINI_PRICING_JSON);
   await client.query('UPDATE generation_attempts SET estimated_cost=$2 WHERE id=$1',[attemptId,cost]);
   await client.query('UPDATE generation_requests SET estimated_cost=$2 WHERE id=$1',[id,cost]);
   await repo.complete(client,row,result,attemptId);
  }catch(error){
   const code=error instanceof Error && Object.hasOwn(GENERATION_ERRORS,error.message)?error.message:'PROVIDER';
   await repo.fail(client,id,code,GENERATION_ERRORS[code]!);
   await client.query("UPDATE generation_attempts SET status='FAILED',error_code=$2,completed_at=now() WHERE id=$1",[attemptId,code]);
  }
 }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 2))',[id]);client.release();}
}
