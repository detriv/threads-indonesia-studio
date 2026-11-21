// Isolated simulation-only four-service smoke. Never reads/writes main .env or deletes volumes.
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {hash} from '@node-rs/argon2';
const project=`threads-phase2-qa-${randomBytes(4).toString('hex')}`;
const web=process.env.PHASE2_WEB_PORT||'18086',db=process.env.PHASE2_DB_PORT||'15443';
const scratch=process.env.TMPDIR;if(!scratch)throw new Error('TMPDIR scratch wajib');
const dir=mkdtempSync(join(scratch,'threads-phase2-'));const envFile=join(dir,'compose.env');
const password=randomBytes(24).toString('hex');
writeFileSync(envFile,`POSTGRES_DB=threads_id\nPOSTGRES_USER=threads\nPOSTGRES_PASSWORD=threads_local_only\nDATABASE_URL=postgres://threads:threads_local_only@db:5432/threads_id\nADMIN_USERNAME=phase2-qa\nADMIN_PASSWORD_HASH='${await hash(password)}'\nWEB_PORT=${web}\nDB_PORT=${db}\nGENERATION_PROVIDER=simulation\nGEMINI_ALLOW_OUTBOUND=false\n`,{mode:0o600});
function compose(...args){const result=spawnSync('docker',['compose','--env-file',envFile,'-p',project,...args],{stdio:'inherit',env:{...process.env,GENERATION_PROVIDER:'simulation',GEMINI_ALLOW_OUTBOUND:'false',GEMINI_API_KEY:'',DATABASE_URL:'postgres://threads:threads_local_only@db:5432/threads_id'}});assert.equal(result.status,0);}
let cookies={};const base=`http://127.0.0.1:${web}`;
async function api(path,method='GET',body,status=200){const headers={connection:'close',cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '),'x-csrf-token':cookies.csrf||''};if(body!==undefined)headers['content-type']='application/json';const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();assert.equal(r.status,status,`${method} ${path}: ${text}`);if(path==='/api/auth/login')cookies=Object.fromEntries(r.headers.getSetCookie().map(c=>c.split(';')[0].split('=')));return text?JSON.parse(text):null;}
async function generate(input){const id=randomUUID();await api('/api/generations','POST',{id,input},202);return id;}
async function wait(id){for(let n=0;n<100;n++){const r=await api(`/api/generations/${id}`);if(['COMPLETED','FAILED'].includes(r.status))return r;await new Promise(r=>setTimeout(r,500));}throw new Error(`timeout ${id}`);}
compose('up','-d','--build','--wait','--wait-timeout','100');
await new Promise(r=>setTimeout(r,1500));
await api('/api/auth/login','POST',{username:'phase2-qa',password});
const themes=await api('/api/themes');assert.equal(themes.length,4);
await api('/api/voice-examples','POST',{text:'Gue suka obrolan santai dan humor kecil.'},201);
const ids=[];
for(const t of themes){const id=await generate({purpose:'TRY_THEME',themeId:t.id});const result=await wait(id);assert.equal(result.status,'COMPLETED');assert.equal(result.provider,'SIMULATION');assert.equal(result.draft_ids.length,3);assert.equal(result.usage,null);assert.equal(result.estimated_cost,null);for(const dId of result.draft_ids){const d=await api(`/api/drafts/${dId}`);assert.equal(d.themeId,t.id);assert.match(d.text,/Gue/);}ids.push(id);}
assert.equal((await api('/api/schedule')).length,0);
await api(`/api/themes/${themes[0].id}`,'PATCH',{examples:['x'.repeat(500)]});
const longExample=await generate({purpose:'TRY_THEME',themeId:themes[0].id});const longResult=await wait(longExample);assert.equal(longResult.status,'COMPLETED');
const longDrafts=await Promise.all(longResult.draft_ids.map(id=>api(`/api/drafts/${id}`)));
assert.equal(new Set(longDrafts.map(d=>d.text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase())).size,3);
assert.deepEqual([...new Set(longDrafts.map(d=>d.format))].sort(),['BAHASAN_LEBIH_DALAM','OBSERVASI_PENDEK']);assert.ok(longDrafts.every(d=>d.text.length<=500));
const requests=await api('/api/generations');let original=await api(`/api/drafts/${requests[0].draft_ids[0]}`);
await api(`/api/drafts/${original.id}/review`,'POST',{decision:'APPROVE'});original=await api(`/api/drafts/${original.id}`);assert.equal(original.status,'APPROVED');
const revision=await generate({purpose:'REVISE',themeId:original.themeId,format:original.format,draftId:original.id,expectedVersion:original.version});assert.equal((await wait(revision)).status,'COMPLETED');assert.ok((await api(`/api/drafts/${original.id}`)).version>original.version);
assert.equal((await api(`/api/drafts/${original.id}`)).status,'DRAFT');
// Persist queued request with worker stopped, then restart whole stack on same volume.
compose('stop','worker');const pending=await generate({purpose:'SHORT',themeId:themes[0].id});
assert.equal((await api(`/api/generations/${pending}`)).status,'QUEUED');
compose('down');compose('up','-d','--wait','--wait-timeout','100');
assert.equal((await wait(pending)).status,'COMPLETED');
for(const id of ids)assert.equal((await api(`/api/generations/${id}`)).draft_ids.length,3);
assert.equal((await api('/api/schedule')).length,0);
const usage=await api('/api/generations/usage');assert.equal(usage.requests,7);assert.equal(usage.total_tokens,null);assert.equal(usage.estimated_cost,null);
const evidence={project,webPort:web,dbPort:db,base,envFile,requestIds:ids,longExampleId:longExample,revisionId:revision,recoveredId:pending,draftId:original.id,usage};
writeFileSync(join(dir,'browser-fixture.json'),JSON.stringify({base,cookies}),{mode:0o600});
writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({PASS:true,...evidence,evidenceFile:join(dir,'evidence.json'),browserFixture:join(dir,'browser-fixture.json')}));
console.log('QA stack left running for browser/independent review. Stop with docker compose --env-file <envFile> -p <project> down (never -v).');
