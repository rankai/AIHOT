import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { rolldown } from 'rolldown';

test('real task loader and SSR keep the downloaded page cursor and shared provider entry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'aihot-result-export-')),require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
 const bundle=await rolldown({input:new URL('../app/routes/admin/operation.tsx',import.meta.url).pathname,plugins:[{name:'existing-react-runtime',resolveId(id){if(['react','react/jsx-runtime','react-router','motion/react'].includes(id))return {id:require.resolve(id),external:true};}}]});
 try{
 const out=join(directory,'operation.mjs');await bundle.write({file:out,format:'esm'});const {default:Operation,loader}=await import(pathToFileURL(out).href);
 for(const provider of ['redfox','socialdata','dajiala'])for(const cursor of ['','42','invalid']){
 const calls:string[]=[];
 const detail={id:9,provider,operationKey:'synthetic.query',status:'completed',step:'query',inputs:{},progress:{},attempts:[],results:[],nextResultCursor:100,nextAction:'view-results',createdAt:'2026-10-21T00:00:00Z'};
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);return Response.json(url.includes('/results?')?{results:[],nextCursor:200}:detail);};
 const r=await loader({request:new Request(`http://local.test/admin/operations/9${cursor?'?cursor='+cursor:''}`),params:{id:'9'}});
 const expected=cursor==='42'?'42':'0';assert.equal(r.resultCursor,expected);assert.equal(calls.length,cursor==='42'?2:1);if(cursor==='42')assert(calls.some(url=>url.endsWith('/results?cursor=42&limit=100')));
 const router=createMemoryRouter([{path:'/admin/operations/9',element:createElement(Operation,{loaderData:r})}],{initialEntries:['/admin/operations/9']});
 try{const html=renderToStaticMarkup(createElement(RouterProvider,{router}));assert(html.includes('data-testid="operation-results-export"'));assert(html.includes(`href="/api/admin/operations/runs/9/results/export?cursor=${expected}"`));assert(html.includes('download=""'));assert(html.includes('下载本页结果 JSON'));assert(html.includes('其余结果请翻页后下载'));}finally{router.dispose();}
 }
 }finally{globalThis.fetch=originalFetch;await bundle.close();await rm(directory,{recursive:true,force:true});}
});
