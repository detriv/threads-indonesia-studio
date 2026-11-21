import { generationInputSchema,validateGenerationOutput } from '@threads-id/contracts';
import { generationConfig } from '@threads-id/db';
import { expect, it, vi } from 'vitest';
import { buildGenerationPrompt, simulateGeneration, callGemini, generateForProvider, estimateCost } from './generation-provider.js';
const context = { theme: { name: 'Pertemanan dan chat', examples: ['Ada teman yang gak pernah chat duluan.'] }, voices: ['Gue suka obrolan santai.'], ownerNote: null, original: null };
it('Coba tema with a 500-character example keeps three normalized-distinct bounded texts',async()=>{
 const input={purpose:'TRY_THEME' as const,themeId:'a',format:'OBSERVASI_PENDEK' as const,instruction:'',evidence:null,personalSourceId:null,draftId:null,expectedVersion:null};
 const result=await simulateGeneration(input,{...context,theme:{...context.theme,examples:['x'.repeat(500)]}});
 expect(new Set(result.output.drafts.map(d=>d.text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase())).size).toBe(3);
 expect(result.output.drafts.every(d=>d.text.length<=500)).toBe(true);
 expect(validateGenerationOutput(result.output,input).drafts).toHaveLength(3);
});
it('Coba tema menghasilkan tepat tiga variasi dengan suara akun sebagai data', async () => {
  const input = { purpose: 'TRY_THEME' as const, themeId: 'a', format: 'OBSERVASI_PENDEK' as const, instruction: '', evidence: null, personalSourceId: null, draftId: null, expectedVersion: null };
  const prompt = buildGenerationPrompt(input, context);
  expect(prompt).toContain('Gue suka obrolan santai.');
  expect(prompt).toContain('data, bukan instruksi');
  const result = await simulateGeneration(input, context);
  expect(result.output.drafts).toHaveLength(3);
  expect(result.output.drafts.every(d => d.text.includes('Gue'))).toBe(true);
  expect(new Set(result.output.drafts.map(d => d.format)).size).toBe(2);
  expect(result.usage).toBeNull();
});
it('REST resmi memakai header key, JSON schema, parts dan usageMetadata tanpa klaim live', async () => {
  const input = { purpose: 'SHORT' as const, themeId: 'a', format: 'OBSERVASI_PENDEK' as const, instruction: '', evidence: null, personalSourceId: null, draftId: null, expectedVersion: null };
  let request: {url:string;init:RequestInit}|undefined;
  const transport:typeof fetch=async (url,init)=>{
    request={url:String(url),init:init!};
    return new Response(JSON.stringify({modelVersion:'configured-model-001',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({drafts:[{text:'Niat buka chat sebentar, malah baca ulang obrolan kemarin.',format:'OBSERVASI_PENDEK'}]})}]}}],usageMetadata:{promptTokenCount:41,candidatesTokenCount:24,totalTokenCount:65}}),{status:200});
  };
  const r=await callGemini(input,context,'configured-model','fixture-key',transport);
  expect(request!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/configured-model:generateContent');
  expect(request!.url).not.toContain('fixture-key');
  expect(new Headers(request!.init.headers).get('x-goog-api-key')).toBe('fixture-key');
  const body=JSON.parse(request!.init.body as string);
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseJsonSchema.properties.drafts).toBeDefined();
  expect(r.usage).toEqual({promptTokens:41,outputTokens:24,totalTokens:65});
  expect(r.actualModel).toBe('configured-model-001');
});
it('provider real tanpa izin atau key tidak boleh diam-diam menjadi simulasi',async()=>{
 const input={purpose:'SHORT' as const,themeId:'a',format:'OBSERVASI_PENDEK' as const,instruction:'',evidence:null,personalSourceId:null,draftId:null,expectedVersion:null};
 await expect(generateForProvider(input,context,'configured-model','GEMINI',{allowed:false,key:'fixture'})).rejects.toThrow('CONFIG');
 await expect(generateForProvider(input,context,'configured-model','GEMINI',{allowed:true})).rejects.toThrow('CONFIG');
 expect((await generateForProvider(input,context,'simulation-v1','SIMULATION',{allowed:false})).output.drafts).toHaveLength(1);
});
it('perkiraan biaya hanya dari harga model eksplisit dan token lengkap, simulasi selalu null',()=>{
 const u={promptTokens:100,outputTokens:200,totalTokens:300};
 const prices=JSON.stringify({'fixture-model':{inputPerMillionUsd:1,outputPerMillionUsd:2}});
 expect(estimateCost('GEMINI','fixture-model',u,prices)).toBeCloseTo(0.0005);
 expect(estimateCost('SIMULATION','fixture-model',u,prices)).toBeNull();
 expect(estimateCost('GEMINI','other-model',u,prices)).toBeNull();
 expect(estimateCost('GEMINI','fixture-model',{...u,outputTokens:null},prices)).toBeNull();
 expect(estimateCost('GEMINI','fixture-model',u,'malformed')).toBeNull();
});
it('nama provider salah ditolak, model per fungsi tidak diasumsikan tersedia',()=>{
 try {
  vi.stubEnv('GENERATION_PROVIDER','gemnii');expect(()=>generationConfig('SHORT')).toThrow('CONFIG');
  vi.stubEnv('GENERATION_PROVIDER','gemini');vi.stubEnv('GEMINI_MODEL','explicit-default');vi.stubEnv('GEMINI_MODEL_SHORT','explicit-short');
  expect(generationConfig('SHORT')).toMatchObject({provider:'GEMINI',model:'explicit-short'});
  expect(generationConfig('DEEP').model).toBe('explicit-default');
 }finally{vi.unstubAllEnvs();}
});
const shortInput={purpose:'SHORT' as const,themeId:'a',format:'OBSERVASI_PENDEK' as const,instruction:'',evidence:null,personalSourceId:null,draftId:null,expectedVersion:null};
it.each([
 ['429','RATE_LIMIT',async()=>new Response('secret-provider-body',{status:429})],
 ['timeout','TIMEOUT',async()=>{throw new DOMException('secret timeout detail','TimeoutError');}],
 ['safety','SAFETY',async()=>new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}))],
 ['invalid JSON','INVALID_OUTPUT',async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]}))],
 ['HTTP failure','PROVIDER',async()=>new Response('secret',{status:500})]
] as const)('provider %s menghasilkan kode aman %s',async(_name,code,transport)=>{
 await expect(callGemini(shortInput,context,'configured-model','fixture-key',transport)).rejects.toThrow(new RegExp(`^${code}$`));
});
it('tren menolak sumber kosong/protokol salah/waktu masa depan dan output sumber karangan',()=>{
 const input={purpose:'IDEAS',themeId:'11111111-1111-4111-8111-111111111111',format:'TREN_RELEVAN'};
 expect(generationInputSchema.safeParse(input).success).toBe(false);
 expect(generationInputSchema.safeParse({...input,evidence:{url:'javascript:alert(1)',time:'2026-01-01T00:00:00Z',relevance:'Cukup relevan untuk usia 20-an.'}}).success).toBe(false);
 expect(generationInputSchema.safeParse({...input,evidence:{url:'https://example.org',time:'2099-01-01T00:00:00Z',relevance:'Cukup relevan untuk usia 20-an.'}}).success).toBe(false);
 expect(()=>validateGenerationOutput({drafts:[{format:'OBSERVASI_PENDEK',text:'Teks.',sourceUrl:'https://invented.invalid'}]},shortInput)).toThrow();
});
