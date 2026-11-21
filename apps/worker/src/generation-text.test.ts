import {expect,it,vi} from 'vitest';
import {callGemini,buildGenerationPrompt} from './generation-provider.js';
const context={theme:{name:'Chat',examples:['Balas besok jadi minggu depan.']},voices:['Gue santai.'],ownerNote:'Catatan asli pemilik.',original:null};
const input={purpose:'TRY_THEME' as const,themeId:'a',format:'OBSERVASI_PENDEK' as const,instruction:'',evidence:null,personalSourceId:null,draftId:null,expectedVersion:null};
const texts=['Buka chat.\n\nLupa mau balas apa.','Rencana membalas cepat sering kalah dengan kebiasaan menunda.\nAda yang sama?','Pesan singkat, mikir jawabannya lama.'];
const section=(i:number,text:string)=>`<<<DRAFT_${i+1}_${i===1?'BAHASAN_LEBIH_DALAM':'OBSERVASI_PENDEK'}>>>\n${text}\n<<<END_DRAFT_${i+1}>>>`;
const response=(text:string)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}));
it('Coba tema memisahkan tiga teks multiline dalam satu panggilan dan menetapkan format aplikasi',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>response(texts.map((t,i)=>section(i,t)).join('\n\n')));
 const result=await callGemini(input,context,'fixture-model','fixture-key',transport);
 expect(transport).toHaveBeenCalledTimes(1);
 expect(result.output.drafts).toEqual(texts.map((text,i)=>({text,format:i===1?'BAHASAN_LEBIH_DALAM':'OBSERVASI_PENDEK'})));
 const prompt=buildGenerationPrompt(input,context);
 for(let i=0;i<3;i++)expect(prompt).toContain(section(i,`teks ${i+1}`));
 expect(prompt).toContain('teks biasa');
 expect(prompt).not.toContain('Output JSON drafts');
 expect(prompt).toContain('ownerNote');expect(prompt).toContain('evidence');expect(prompt).toContain('Gue santai.');
});

it('single-purpose menolak delimiter Coba tema alih-alih menyimpan envelope sebagai caption',async()=>{
 await expect(callGemini({...input,purpose:'SHORT'},context,'fixture-model','fixture-key',async()=>response(section(0,'Teks.')))).rejects.toThrow(/^INVALID_OUTPUT$/);
});
const valid=texts.map((t,i)=>section(i,t)).join('\n\n');
it.each([
 ['adjacent delimiter lines',valid.replace('<<<END_DRAFT_1>>>\n\n<<<DRAFT_2','<<<END_DRAFT_1>>><<<DRAFT_2')],
 ['missing section',texts.slice(0,2).map((t,i)=>section(i,t)).join('\n')],
 ['extra section',valid+'\n'+section(0,'Extra')],
 ['preamble','Ini hasilnya:\n'+valid],
 ['postscript',valid+'\nSelesai.'],
 ['wrong format',valid.replace('DRAFT_2_BAHASAN_LEBIH_DALAM','DRAFT_2_TREN_RELEVAN')],
 ['reordered',[section(1,texts[1]!),section(0,texts[0]!),section(2,texts[2]!)].join('\n')],
 ['missing end',valid.replace('<<<END_DRAFT_2>>>','')],
 ['empty text',texts.map((t,i)=>section(i,i===1?' ':t)).join('\n')],
 ['too long',texts.map((t,i)=>section(i,i===1?'x'.repeat(501):t)).join('\n')],
 ['normalized duplicate',texts.map((t,i)=>section(i,i===2?' BUKA chat.   Lupa mau balas apa. ':t)).join('\n')],
 ['nested delimiter',valid.replace(texts[0]!,'<<<DRAFT_4>>>')],
 ['JSON envelope',JSON.stringify({drafts:texts.map(text=>({text,format:'OBSERVASI_PENDEK'}))})]
])('Coba tema menolak %s tanpa perbaikan atau request tambahan',async(_name,text)=>{
 const transport=vi.fn<typeof fetch>(async()=>response(text));
 await expect(callGemini(input,context,'fixture-model','fixture-key',transport)).rejects.toThrow(/^INVALID_OUTPUT$/);
 expect(transport).toHaveBeenCalledTimes(1);
});
it('Coba tema menerima CRLF dan membuang thought parts tanpa kehilangan paragraf',async()=>{
 const transport:typeof fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'private reasoning',thought:true},{text:valid.replace(/\n/g,'\r\n')}]}}]}));
 expect((await callGemini(input,context,'fixture-model','fixture-key',transport)).output.drafts.map(d=>d.text)).toEqual(texts);
});
it.each(['IDEAS','SHORT','DEEP','REVISE'] as const)('%s menerima satu teks, menetapkan format tanpa metadata model',async purpose=>{
 const result=await callGemini({...input,purpose,format:'BAHASAN_LEBIH_DALAM'},context,'fixture-model','fixture-key',async()=>response('Teks pertama.\n\nParagraf kedua.'));
 expect(result.output.drafts).toEqual([{text:'Teks pertama.\n\nParagraf kedua.',format:purpose==='SHORT'?'OBSERVASI_PENDEK':'BAHASAN_LEBIH_DALAM'}]);
 expect(buildGenerationPrompt({...input,purpose},context)).toContain('hanya satu teks biasa');
});
it.each([
 ['non-STOP',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:valid}]}}]},'INVALID_OUTPUT'],
 ['safety',{candidates:[{finishReason:'SAFETY',content:{parts:[{text:valid}]}}]},'SAFETY'],
 ['no candidates',{},'INVALID_OUTPUT'],
 ['missing parts',{candidates:[{finishReason:'STOP',content:{}}]},'INVALID_OUTPUT'],
 ['thought only',{candidates:[{finishReason:'STOP',content:{parts:[{text:valid,thought:true}]}}]},'INVALID_OUTPUT']
])('transport %s memakai error aman',async(_name,body,code)=>{
 await expect(callGemini(input,context,'fixture-model','fixture-key',async()=>new Response(JSON.stringify(body)))).rejects.toThrow(new RegExp(`^${code}$`));
});
it.each([' '.repeat(3),'x'.repeat(501)])('single text tetap memvalidasi kosong/panjang',async text=>{
 await expect(callGemini({...input,purpose:'SHORT'},context,'fixture-model','fixture-key',async()=>response(text))).rejects.toThrow(/^INVALID_OUTPUT$/);
});
