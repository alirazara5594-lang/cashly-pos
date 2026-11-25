import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const folder=resolve('.cashly-regression-d205b9');const {main,waiter,usa}=JSON.parse(await readFile(join(folder,'fixtures.json')));
const env=JSON.parse(await readFile(join(folder,'env.json')));const source=await readFile('tools/demo-videos/rec.mjs','utf8');
await writeFile(join(folder,'rec.mjs'),source.replace("['--headless=new', '--disable-gpu'", "['--headless=new', '--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu'").replace('    close: b.close','    onEvent: b.on,\n    close: b.close'));
const {launchApp}=await import('./rec.mjs');

const r=await launchApp({edge:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',profile:await mkdtemp(join(folder,'edge-')),appUrl:env.ui,apiUrl:env.ui});
const get=async(path)=>{const res=await fetch(env.api+'/api'+path,{headers:{Authorization:'Bearer '+main.token}});assert.ok(res.ok);return res.json()};
let faults=[],errors=[],urls=[];await r.send('Network.enable');r.onEvent(e=>{if(e.method==='Network.responseReceived') urls.push(e.params.response.url)});
r.onEvent(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)});
async function wait(fn,label){for(let i=0;i<80;i++){if(await fn())return;await r.sleep(200)}throw Error(label+' / '+(await r.evaluate('document.querySelector("main")?.innerText.slice(0,230)')))}
const go=path=>r.goto(path,{wait:600});
async function use(account,path){await r.evaluate('sessionStorage.clear();sessionStorage.setItem("cashly_pos_token",'+JSON.stringify(account.token)+');sessionStorage.setItem("cashly_pos_user",'+JSON.stringify(JSON.stringify(account.user))+')');await go(path)}
const click=(text,contains=false)=>r.click({text,tag:'button',contains,enabled:true},{after:280,ms:140});
const check=async(name,cb)=>{try{await cb();console.log('PASS '+name)}catch(e){console.log('FAIL '+name+' '+e.message.slice(0,400)+' | '+(await r.evaluate('document.querySelector("main")?.innerText.slice(0,700)')));faults.push(name)}};
try{
await go('/');
await check('Analytics populated metrics and 30-day chart',async()=>{await use(main,'/analytics');await wait(()=>r.evaluate('document.querySelector("main")?.innerText.toLowerCase().includes("avg order value")'),'average order value');await click('30D');await r.waitText('Last 30 days');await r.waitText(main.products[0].name);assert.ok(!(await r.evaluate('document.body.innerText.includes("NaN")')))});
await check('USD catalog and price editor',async()=>{await use(usa,'/menu');await r.waitText('prices in USD',13000);assert.doesNotMatch(await r.evaluate('document.querySelector("main").innerText'),/\bPKR\b/);await click('Products',true);await click('Add Product',true);await wait(()=>r.evaluate('document.querySelector("main").innerText.toLowerCase().includes("cost price")'),'cost price');assert.doesNotMatch(await r.evaluate('document.querySelector("main").innerText'),/\bPKR\b/)});
await check('Z report business calendar and explicit historical date',async()=>{await r.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});await use(main,'/reports');const server=await get('/reports/daily-z?branchId='+main.branch.id);await wait(()=>r.evaluate('document.querySelector("main input[type=date]")?.value === '+JSON.stringify(server.period)),'server business date');await r.setValue({css:'main input[type=date]'},'2025-05-01');await wait(async()=>urls.some(u=>u.includes('/reports/daily-z?')&&u.includes('2025-05-01')) && (await r.evaluate('document.querySelector("main")?.innerText.includes("0 paid orders settled")')),'historical report');});
assert.deepEqual(errors,[]);assert.deepEqual(faults,[]);}finally{r.close()}