import { z } from "zod";
export const TITLE_DELIVERY_CONTRACT='xhs-title-report@1';
const text=z.string().trim().min(1);
const candidateTitle=text.max(80).refine(value=>[...value].length<=20,'标题最多20个Unicode码点');
const references=z.array(text.max(100)).min(1).max(80);
const dimension=z.object({score:z.number().finite().min(0).max(10),reason:text.max(1000)}).strict();
export const TitleDimensions=z.object({keyword:dimension,structure:dimension,emotion:dimension,benefit:dimension,creativity:dimension,safety:dimension}).strict();
export const SaveTitleReport=z.object({activationId:z.string().uuid(),mode:z.enum(['generate','score']),title:text.max(300),summary:text.max(2500),
 sampleIds:references,candidates:z.array(z.object({title:candidateTitle,reason:text.max(1000),match:z.number().min(0).max(10),sourceIds:references}).strict()).max(10).default([]),
 evaluations:z.array(z.object({title:text.max(1000),dimensions:TitleDimensions,summary:text.max(2000),sourceIds:references,revisions:z.array(z.object({title:candidateTitle,scenario:text.max(500)}).strict()).max(3)}).strict()).max(10).default([])
}).strict().superRefine((value,ctx)=>{
 if(value.mode==='generate'?(value.candidates.length!==10||value.evaluations.length!==0||new Set(value.candidates.map(c=>c.title)).size!==10):(value.evaluations.length<1||value.candidates.length!==0))ctx.addIssue({code:'custom',message:'生成须10个不同候选；评分须1至10个原标题'});
});
export function titleGrade(dimensions:z.infer<typeof TitleDimensions>){
 const d=TitleDimensions.parse(dimensions),weights={keyword:15,structure:20,emotion:20,benefit:25,creativity:15,safety:5};
 const total=Math.round(Object.entries(weights).reduce((sum,[key,weight])=>sum+d[key as keyof typeof d].score*weight,0)/10)/10;
 return {total,grade:total>=9?'S':total>=7?'A':total>=5?'B':'C'} as const;
}
