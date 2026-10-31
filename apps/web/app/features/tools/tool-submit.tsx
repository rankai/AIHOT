import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { MemberPriceCatalog } from '@aihot/contracts/membership';
import { Button } from '../admin/ui';
import { estimateToolPrice, toolPriceText, type ToolPriceSelection } from './price-estimate';
const PricingContext=createContext<{catalog:MemberPriceCatalog|null;admin:boolean}>({catalog:null,admin:false});
export function ToolPricingProvider({catalog,admin=false,children}:{catalog:MemberPriceCatalog;admin?:boolean;children:ReactNode}) {
 return <PricingContext.Provider value={{catalog,admin}}>{children}</PricingContext.Provider>;
}
function formValues(form: HTMLFormElement): Record<string,unknown> {
 const values: Record<string,unknown>={};
 for(const [key,value] of new FormData(form)) if(typeof value==='string') values[key]=value;
 for(const element of Array.from(form.elements)) if(element instanceof HTMLInputElement && element.name){
  if(element.type==='checkbox') values[element.name]=element.checked;
  if(element.type==='number') values[element.name]=element.value==='' ? undefined : Number(element.value);
 }
 return values;
}
/** Reads named native fields locally; controlled forms pass their existing body-shaped state. */
export function ToolSubmit({selection,inputFromForm,children,...button}: ComponentProps<typeof Button> & {selection:ToolPriceSelection;inputFromForm?:(values:Record<string,unknown>)=>Record<string,unknown>}) {
 const context=useContext(PricingContext), anchor=useRef<HTMLDivElement>(null), [values,setValues]=useState<Record<string,unknown>>({});
 useEffect(()=>{const form=anchor.current?.closest('form');if(!form)return;const update=()=>setValues(formValues(form));update();form.addEventListener('input',update);form.addEventListener('change',update);return()=>{form.removeEventListener('input',update);form.removeEventListener('change',update);};},[]);
 const estimate=estimateToolPrice(context.catalog,{...selection,input:{...(inputFromForm ? inputFromForm(values) : values),...selection.input}});
 const blocked=!context.admin && (estimate.state==='unavailable' || estimate.state==='ambiguous');
 return <div ref={anchor} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"><Button {...button} disabled={button.disabled || blocked}>{children}</Button><span className="text-[12.5px] leading-relaxed text-ink-3" aria-live="polite">{toolPriceText(estimate,context.admin)}</span></div>;
}
