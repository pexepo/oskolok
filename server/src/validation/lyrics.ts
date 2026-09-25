import { z } from 'zod';

const time = z.number().finite().min(0).max(86400);
const word = z.object({ text:z.string().max(500), start:time, end:time, joinNext:z.boolean().optional() }).refine(w=>w.end>=w.start);
// Explicit depth limit prevents recursive payloads from exhausting the stack.
const line = (depth:number):z.ZodTypeAny => z.object({
  text:z.string().max(4000), time, end:time.optional(), words:z.array(word).min(1).max(500).optional(),
  estimated:z.boolean().optional(), agent:z.string().max(100).optional(), agentName:z.string().max(100).optional(),
  role:z.enum(['background','lead']).optional(), translation:z.string().max(4000).optional(), romanization:z.string().max(4000).optional(),
  background:depth>0?z.array(line(depth-1)).max(20).optional():z.never().optional(),
}).superRefine((l:any,ctx)=>{
  if (l.end!==undefined && l.end<l.time || l.words?.some((w:any,i:number)=>w.start<l.time || (i>0 && w.start<l.words[i-1].start) || (l.end!==undefined && w.end>l.end)))
    ctx.addIssue({code:'custom',message:'Некорректный порядок временных меток.'});
});
export const lyricSubmissionSchema = z.object({
  trackId:z.string().trim().min(1).max(200), trackTitle:z.string().trim().min(1).max(300),
  artistName:z.string().trim().min(1).max(200), credit:z.string().trim().min(1).max(160),
  fileName:z.string().max(240).default(''), lines:z.array(line(2)).min(1).max(3000),
}).strict();
