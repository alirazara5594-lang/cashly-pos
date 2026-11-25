import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile), folder=resolve('.cashly-regression-d205b9'), dist=resolve('pos-frontend/dist');
const pgDir='C:/Program Files/PostgreSQL/18/bin', dbDir=join(folder,'pg');
const processLog=(name)=>createWriteStream(join(folder,name+'.log'),{flags:'a'});
const pw=(await readFile(join(folder,'db-secret.txt'),'utf8')).trim(), jwt=randomBytes(52).toString('base64url');
const pgPort=55497, apiPort=18603, uiPort=18604, outletPort=18605;
const dbName='postgres', apiOrigin='http://127.0.0.1:'+apiPort;
const parts=[];
let apiUp=true, closing=false;
const starts=(file,args,name,options={})=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});
  const log=processLog(name);
  child.stdout.pipe(log,{end:false}); child.stderr.pipe(log,{end:false});
  child.once('exit',()=>log.end());
  parts.push(child); return child;
};
async function until(fn,what,seconds=55) {
  const limit=Date.now()+seconds*1000;
  let failure;
  while(Date.now()<limit) {
    try { const result=await fn(); if(result) return result; } catch(e){ failure=e; }
    await delay(250);
  }
  throw new Error(what+' did not become ready '+(failure?.message??''));
}
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.mp4':'video/mp4','.woff2':'font/woff2'};
const pg=starts(join(pgDir,'postgres.exe'),['-D',dbDir,'-p',String(pgPort),'-h','127.0.0.1'],'postgres',{cwd:folder});
await until(async()=>{await run(join(pgDir,'pg_isready.exe'),['-h','127.0.0.1','-p',String(pgPort),'-q'],{windowsHide:true});return true;},'PostgreSQL');
const psql=async(sql,database=dbName)=>run(join(pgDir,'psql.exe'),['-h','127.0.0.1','-p',String(pgPort),'-U','cashly_qa','-d',database,'-v','ON_ERROR_STOP=1','-c',sql],{env:{...process.env,PGPASSWORD:pw},windowsHide:true});
const startApi=(port,database,mode,name)=>{
  return starts('dotnet.exe',[resolve('Pos.Api/bin/Release/net10.0/Pos.Api.dll'),'--urls','http://127.0.0.1:'+port],name,{
    cwd:folder,
    env:{...process.env,ASPNETCORE_ENVIRONMENT:'Production',JWT_KEY:jwt,Host__Mode:mode,
      ConnectionStrings__DefaultConnection:'Host=127.0.0.1;Port='+pgPort+';Database='+database+';Username=cashly_qa;Password='+pw,
      Logging__EventLog__LogLevel__Default:'None',Logging__LogLevel__Default:'Warning',PUBLIC_WEB_URL:'http://127.0.0.1:'+uiPort,
      SUPER_ADMIN_USERNAME:'qa-platform',SUPER_ADMIN_PIN:'691542',
      APP_URL:'http://127.0.0.1:'+uiPort}
  });
};
const api=startApi(apiPort,dbName,'Cloud','api');
await until(async()=>{const r=await fetch(apiOrigin+'/api/health/ready');return r.ok&&(await r.json()).status==='ready';},'Cloud API');

const outlet=startApi(outletPort,'cashly_outlet','BusinessHost','outlet');
const http=createServer(async(req,res)=>{
  const raw=req.url??'/';
  const path=new URL(raw,'http://127.0.0.1').pathname;
  if(path==='/__qa_link'&&req.method==='POST') {
    apiUp=new URL(raw,'http://127.0.0.1').searchParams.get('online')==='true';
    res.end(String(apiUp)); return;
  }
  if(path==='/__qa_stop'&&req.method==='POST') {
    res.end('stopping'); void shutdown(); return;
  }
  if(path.startsWith('/api/')||path.startsWith('/media/')) {
    if(!apiUp) {res.writeHead(503,{'Content-Type':'application/json'}).end('{"message":"Simulated cloud outage"}');return;}
    const dest=request(apiOrigin+raw,{method:req.method,headers:{...req.headers,host:'127.0.0.1:'+apiPort}}, upstream=>{
      res.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(res);
    });
    dest.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    req.pipe(dest);
    return;
  }
  const relative=extname(path)?'.'+path:'./index.html', file=resolve(dist,relative);
  if(!file.startsWith(dist+sep)) {res.writeHead(403).end();return;}
  try {
    const info=await stat(file);
    if(!info.isFile())throw new Error('not file');
    res.writeHead(200,{'Content-Type':contentTypes[extname(file)]??'application/octet-stream','Content-Length':info.size});
    createReadStream(file).pipe(res);
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>http.listen(uiPort,'127.0.0.1',r));
await writeFile(join(folder,'env.json'),JSON.stringify({api:apiOrigin,outlet:'http://127.0.0.1:'+outletPort,ui:'http://127.0.0.1:'+uiPort,pgPort,dbName,head:api.pid,local:outlet.pid}));
console.log('QA POS and cloud API are ready at '+uiPort+' and '+apiPort+'.');
async function shutdown() {
  if(closing)return; closing=true;
  http.closeAllConnections(); http.close();
  for(const p of parts.slice(1).reverse())if(p.exitCode===null)p.kill();
  try {await run(join(pgDir,'pg_ctl.exe'),['stop','-D',dbDir,'-m','fast','-w','-t','8'],{windowsHide:true,timeout:10000});}catch{}
  if(pg.exitCode===null)pg.kill();
  console.log('Isolated services stopped.');
}
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());
setTimeout(()=>void shutdown(),55*60*1000).unref();