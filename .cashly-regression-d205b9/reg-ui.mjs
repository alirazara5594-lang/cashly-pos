import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const folder=resolve('.cashly-regression-d205b9');const {main,waiter,usa}=JSON.parse(await readFile(join(folder,'fixtures.json')));
const env=JSON.parse(await readFile(join(folder,'env.json')));const source=await readFile('tools/demo-videos/rec.mjs','utf8');
await writeFile(join(folder,'rec.mjs'),source.replace("['--headless=new', '--disable-gpu'", "['--headless=new', '--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu'").replace('    close: b.close','    onEvent: b.on,\n    close: b.close'));
const {launchApp}=await import('./rec.mjs');

const r=await launchApp({edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',profile:await mkdtemp(join(folder,'edge-')),appUrl:env.ui,apiUrl:env.ui});
const get=async(path)=>{const res=await fetch(env.api+'/api'+path,{headers:{Authorization:'Bearer '+main.token}});assert.ok(res.ok);return res.json()};
let faults=[],errors=[];
r.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)});
async function wait(fn,label){for(let i=0;i<80;i++){if(await fn())return;await r.sleep(200)}throw Error(label+' / '+(await r.evaluate('document.querySelector("main")?.innerText.slice(0,230)')))}
const go=path=>r.goto(path,{wait:600});
async function use(account,path){await r.evaluate('sessionStorage.clear();sessionStorage.setItem("cashly_pos_token",'+JSON.stringify(account.token)+');sessionStorage.setItem("cashly_pos_user",'+JSON.stringify(JSON.stringify(account.user))+')');await go(path)}
const click=(text,contains=false)=>r.click({text,tag:'button',contains,enabled:true},{after:280,ms:140});
const check=async(name,cb)=>{try{await cb();console.log('PASS '+name)}catch(e){console.log('FAIL '+name+' '+e.message.slice(0,600));faults.push(name)}};
try{
await go('/');
await check('Analytics populated metrics and 30-day chart',async()=>{await use(main,'/analytics');await r.waitText('Avg Order Value',14000);await click('30D');await r.waitText('Last 30 days');await r.waitText(main.products[0].name);assert.ok(!(await r.evaluate('document.body.innerText.includes("NaN")')))});
await check('USD catalog and price editor',async()=>{await use(usa,'/menu');await r.waitText('prices in USD',13000);assert.doesNotMatch(await r.evaluate('document.querySelector("main").innerText'),/\bPKR\b/);await click('Add Product',true);await r.waitText('Cost Price');assert.doesNotMatch(await r.evaluate('document.querySelector("main").innerText'),/\bPKR\b/)});
await check('Z report business calendar and explicit historical date',async()=>{await r.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});await use(main,'/reports');const server=await get('/reports/daily-z?branchId='+main.branch.id);await wait(()=>r.evaluate('document.querySelector("main input[type=date]")?.value === '+JSON.stringify(server.period)),'server business date');await r.setValue({css:'main input[type=date]'},'2025-05-01');await wait(()=>r.evaluate('document.querySelector("main")?.innerText.includes("2025-05-01")'),'historical report');});
await check('Unpaid bill invokes browser printing and leaves cart unpaid',async()=>{await use(main,'/');await r.waitText(main.products[1].name);await click('Take Away');await r.click({text:'Add',tag:'button',near:main.products[1].name},{after:180});const before=await get('/orders?branchId='+main.branch.id);await r.evaluate('window.__printed=0;window.print=()=>window.__printed++');await r.click({css:'button[title="Print the bill"]'},{after:220});await r.waitText('Unpaid bill preview');assert.doesNotMatch(await r.evaluate('document.querySelector(".paper").innerText'),/TAX INVOICE|Cash Tendered/i);await click('Print Bill');assert.equal(await r.evaluate('window.__printed'),1);await click('Close');assert.equal((await get('/orders?branchId='+main.branch.id)).length,before.length)});
await check('Manage riders through dispatch board',async()=>{await use(main,'/delivery');await click('Manage riders');await r.type({css:'form[role=dialog] input[maxlength="100"]'},'UI Rider',{clear:true});await r.type({css:'form[role=dialog] input[type=tel]'},'03016662222',{clear:true});await click('Save rider');await wait(async()=>(await get('/riders?branchId='+main.branch.id)).some(x=>x.name==='UI Rider'),'rider saved');});
await check('Waiter dropped acknowledgement, page reload and safe retry',async()=>{
await use(waiter,'/order-tab');
await r.click({text:main.table.tableNumber,tag:'button',contains:true},{after:240});await r.click({text:main.products[1].name,tag:'h3'},{after:150});
let intercepted=false;const fired=()=>r.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.innerText.includes("Fire to Kitchen"))?.click()');
r.onEvent(e=>{if(e.method==='Fetch.requestPaused'){const m=e.params;if(m.request.method==='POST'&&m.responseStatusCode===200&&!intercepted){intercepted=true;r.send('Fetch.failRequest',{requestId:m.requestId,errorReason:'Failed'}).catch(()=>{})}else r.send('Fetch.continueRequest',{requestId:m.requestId}).catch(()=>{})}});
await r.send('Fetch.enable',{patterns:[{urlPattern:'*/api/orders',requestStage:'Response'}]});await fired();await wait(async()=>intercepted,'committed response interrupted');await r.waitText('Retry kitchen confirmation');await r.send('Fetch.disable');await go('/order-tab');await r.waitText('Retry kitchen confirmation');const before=await get('/orders?branchId='+main.branch.id);const original=before.find(o=>o.tableNumber===main.table.tableNumber);assert.ok(original);await click('Retry kitchen confirmation');await r.waitText('Ticket sent to Kitchen',14000);const after=await get('/orders?branchId='+main.branch.id);assert.equal(after.length,before.length);assert.equal((await get('/kitchen/tickets?branchId='+main.branch.id)).filter(t=>t.orderId===original.id).length,1);
});assert.deepEqual(errors,[]);assert.deepEqual(faults,[]);
}finally{r.close()}