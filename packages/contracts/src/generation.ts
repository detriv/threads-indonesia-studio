import { z } from 'zod';
const contentFormatSchema = z.enum(['OBSERVASI_PENDEK', 'BAHASAN_LEBIH_DALAM', 'TREN_RELEVAN']);
export const GENERATION_JOB_NAME = 'content.generate';
export const generationPurposeSchema = z.enum(['IDEAS', 'SHORT', 'DEEP', 'REVISE', 'TRY_THEME']);
export type GenerationPurpose = z.infer<typeof generationPurposeSchema>;
export const evidenceSchema = z.object({ url: z.url().refine(s => /^https?:\/\//.test(s)), time: z.iso.datetime(), relevance: z.string().trim().min(10).max(2000) }).strict().refine(v=>Date.parse(v.time)<=Date.now(),{message:'Waktu bukti tidak boleh di masa depan'});
export const generationInputSchema = z.object({
  purpose: generationPurposeSchema, themeId: z.uuid(), format: contentFormatSchema.default('OBSERVASI_PENDEK'),
  instruction: z.string().trim().max(2000).default(''), evidence: evidenceSchema.nullable().default(null),
  personalSourceId: z.uuid().nullable().default(null), draftId: z.uuid().nullable().default(null), expectedVersion: z.number().int().positive().nullable().default(null)
}).strict().superRefine((v,c) => {
  if(v.format === 'TREN_RELEVAN' && (!v.evidence || Date.parse(v.evidence.time) > Date.now())) c.addIssue({code:'custom',message:'Bukti tren dan waktu yang valid wajib diisi'});
  if(v.purpose === 'REVISE' && (!v.draftId || !v.expectedVersion)) c.addIssue({code:'custom',message:'Revisi memerlukan ID dan versi draft'});
  if(v.purpose !== 'REVISE' && (v.draftId || v.expectedVersion)) c.addIssue({code:'custom',message:'Target revisi tidak sesuai fungsi'});
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationContext = { theme: {name:string;examples:string[]}; voices:string[]; ownerNote:string|null; original:{text:string;format:z.infer<typeof contentFormatSchema>}|null };
export const generationOutputSchema = z.object({ drafts: z.array(z.object({text:z.string().trim().min(1).max(500),format:contentFormatSchema}).strict()).min(1).max(3) }).strict();
export type GenerationOutput = z.infer<typeof generationOutputSchema>;
export function validateGenerationOutput(value:unknown,input:GenerationInput):GenerationOutput {
  if(input.evidence && !evidenceSchema.safeParse(input.evidence).success) throw new Error('INVALID_OUTPUT');
  const output=generationOutputSchema.parse(value);
  const count=input.purpose==='TRY_THEME'?3:1;
  if(output.drafts.length!==count) throw new Error('INVALID_OUTPUT');
  if(input.purpose==='TRY_THEME') {
    const texts=new Set(output.drafts.map(d=>d.text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('id-ID')));
    const formats=new Set(output.drafts.map(d=>d.format));
    if(texts.size!==3 || formats.size!==2 || !formats.has('OBSERVASI_PENDEK') || !formats.has('BAHASAN_LEBIH_DALAM')) throw new Error('INVALID_OUTPUT');
  }
  for(const d of output.drafts) {
    const format=input.purpose==='SHORT'?'OBSERVASI_PENDEK':input.purpose==='DEEP'?'BAHASAN_LEBIH_DALAM':input.format;
    if(input.purpose!=='TRY_THEME' && d.format!==format) throw new Error('INVALID_OUTPUT');
    if(d.format==='TREN_RELEVAN' && !input.evidence) throw new Error('INVALID_OUTPUT');
  }
  return output;
}
export type GenerationUsage={promptTokens:number|null;outputTokens:number|null;totalTokens:number|null};
export type GenerationResult={output:GenerationOutput;usage:GenerationUsage|null;actualModel?:string};
export const GENERATION_ERRORS:Record<string,string>={QUOTA:'Batas generasi harian tercapai.',RATE_LIMIT:'Kuota atau rate limit Gemini tercapai (429).',TIMEOUT:'Gemini melewati batas waktu.',INVALID_OUTPUT:'Output AI tidak valid; tidak ada draft baru disimpan.',SAFETY:'Gemini memblokir output demi keamanan.',CONFIG:'Konfigurasi Gemini belum lengkap; tidak diganti simulasi.',PROVIDER:'Layanan Gemini gagal. Coba permintaan baru.',CONFLICT:'Draft berubah atau terkunci; revisi tidak diterapkan.'};
