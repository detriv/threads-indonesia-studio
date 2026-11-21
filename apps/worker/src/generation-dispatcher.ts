import type {PgBoss} from 'pg-boss';
import type {GenerationRepository} from '@threads-id/db';
import {GENERATION_JOB_NAME} from '@threads-id/contracts';
/** Request is durable outbox. Exclusive policy prevents pending/active duplicate per request,
 * while allowing recovery after a failed/expired job. Advisory lock + terminal DB state is final guard. */
export async function dispatchGenerationRequests(repo:GenerationRepository,boss:PgBoss):Promise<void>{
 await boss.createQueue(GENERATION_JOB_NAME,{policy:'exclusive'});
 for(const id of await repo.pending())await boss.send(GENERATION_JOB_NAME,{requestId:id},{singletonKey:id,retryLimit:3,retryDelay:10,expireInSeconds:120});
}
