import {expect,it} from 'vitest';
import {generationInputSchema,validateGenerationOutput} from './generation.js';
import type {GenerationInput} from './generation.js';
const input:GenerationInput={purpose:'TRY_THEME',themeId:'11111111-1111-4111-8111-111111111111',format:'OBSERVASI_PENDEK',instruction:'',evidence:null,personalSourceId:null,draftId:null,expectedVersion:null};
it('regular request rejects future evidence even if its requested format is not trend',()=>{
 const future={...input,purpose:'IDEAS',evidence:{url:'https://example.org/fixture',time:'2099-01-01T00:00:00Z',relevance:'Kaitan audiens yang jelas.'}};
 expect(generationInputSchema.safeParse(future).success).toBe(false);
});
it('output validator rejects supplied future evidence independently of input format',()=>{
 const future={...input,purpose:'IDEAS' as const,evidence:{url:'https://example.org/fixture',time:'2099-01-01T00:00:00Z',relevance:'Kaitan audiens yang jelas.'}};
 expect(()=>validateGenerationOutput({drafts:[{text:'Observasi biasa.',format:'OBSERVASI_PENDEK'}]},future)).toThrow('INVALID_OUTPUT');
});
it.each([
 ['normalized duplicates',[{text:'  Niat   cek jam. ',format:'OBSERVASI_PENDEK'},{text:'niat cek jam.',format:'BAHASAN_LEBIH_DALAM'},{text:'Obrolan lain.',format:'OBSERVASI_PENDEK'}]],
 ['all short',[{text:'Satu.',format:'OBSERVASI_PENDEK'},{text:'Dua.',format:'OBSERVASI_PENDEK'},{text:'Tiga.',format:'OBSERVASI_PENDEK'}]],
 ['all trend',[{text:'Satu.',format:'TREN_RELEVAN'},{text:'Dua.',format:'TREN_RELEVAN'},{text:'Tiga.',format:'TREN_RELEVAN'}]]
])('Coba tema rejects %s',(_name,drafts)=>{
 expect(()=>validateGenerationOutput({drafts},{...input,evidence:{url:'https://example.org/fixture',time:'2026-01-01T00:00:00Z',relevance:'Kaitan audiens yang jelas.'}})).toThrow('INVALID_OUTPUT');
});
