import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('env.json',import.meta.url)));const base=config.api+'/api';
async function call(method,path,body,token,status){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const raw=await r.text();if(status? r.status!==status : !r.ok)throw Error(method+' '+path+' '+r.status+' '+raw.slice(0,280));return raw?JSON.parse(raw):null;
}
const branch=s=>s.branch.id,scoped=(s,path)=>path+'?branchId='+s.branch.id;
const a=(s,path)=>call('GET',path,null,s.token),p=(s,path,body,status)=>call('POST',path,body,s.token,status);
const pin='418527', pwd='Cashly-Launch-Fiction-129!';
const boot=Date.now().toString(36).slice(-6), seed=Number(Date.now().toString().slice(-5));
const business=(code,slot,edition,verticalPack,businessType='Retail')=>({
  restaurantName:'QA '+code+' '+boot, contactName:'QA '+code+' Owner', email:'', phone:'', city:'Lahore',
  address:'QA business address', adminUsername:'qa-'+code.toLowerCase()+'-'+boot, adminPin:pin, acceptedTerms:true, termsVersion:'qa',
  ownerMobile:'0305'+String(seed+slot).padStart(7,'0'), country:'Pakistan', stateCode:'PK-PB',
  verticalPack,businessType,packageKey:edition,businessStructure:'SingleShop',
  webName:'qa-'+code.toLowerCase()+'-'+boot, seedSampleMenu:false,setUpAccounting:edition==='Professional'
});

async function make(input){const signup=await call('POST','/auth/signup',input);const auth=await call('POST','/auth/login',{username:input.adminUsername,pinCode:pin,tenantSlug:input.webName});return {...auth,input,tenant:signup.tenant,branch:signup.branches.find(b=>b.canSell)}}

const orig=JSON.parse(await readFile(new URL('legacy.json',import.meta.url)));const restored=await call('POST','/auth/login',{username:orig.main.adminUsername,pinCode:pin,tenantSlug:orig.main.webName});const branches=await a(restored,'/auth/my-branches');const br=branches.find(x=>x.canSell);const receipts=await a(restored,'/orders?branchId='+br.id);
const old=receipts.find(o=>o.id===orig.cod);assert.equal(old.amountPaidPKR,old.totalPKR);assert.ok(old.legacyCodNeedsReview&&old.paidAt);assert.ok(!(await a(restored,'/riders/'+old.assignedRiderId+'/pending-cod')).orders.some(o=>o.id===old.id));assert.equal(receipts.find(o=>o.id===orig.tab).status,'InKitchen');
console.log('PASS upgrading historical ambiguous COD and a premature kitchen-ready order');
const input={...business('Head',6,'Professional','restaurant','Restaurant'),businessStructure:'ChainWithHeadOffice',email:'hq-'+boot+'@example.test',adminPassword:pwd,branches:[{name:'East',stateCode:'PK-PB',posEdition:'Professional'},{name:'West',stateCode:'PK-PB',posEdition:'Standard'}]};
const org=await call('POST','/auth/signup',input);const auth=await call('POST','/auth/email-login',{email:input.email,password:pwd});const head={...auth,tenant:org.tenant,branch:org.branches.find(b=>b.canSell)};
const catalog=async(account,items)=>{
 const cat=await p(account,'/catalog/categories',{tenantId:account.tenant.id,name:'QA Tasting Menu',sortOrder:20});
 assert.ok(cat.id);account.category=cat;
 const products=[];
 for(const item of items){
  const row=await p(account,'/catalog/products',{tenantId:account.tenant.id,categoryId:cat.id,sku:item.name.replace(/\W/g,'-'),name:item.name,
    sellingPricePKR:item.price,costPricePKR:item.cost??50,unit:'Each',station:item.station??'MainKitchen',barcode:item.barcode??'',aiPhoto:false,
    modifiers:item.modifiers??[],...item.extra});
  assert.ok(row.id); products.push(row);
 }
 account.products=products;
 const listed=await a(account,scoped(account,'/catalog/products'));
 for(const product of products)assert.ok(listed.some(pr=>pr.id===product.id));
 return products;
};


await catalog(head,[{name:'Synced COD item',price:95,station:'Grill'}]);
const grant=await p(head,'/host/register',{branchId:branch(head),hostName:'Regression outlet',forEnrollment:true,port:18605});
const outlet=async(path,body,token)=>{const res=await fetch(config.outlet+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const val=await res.text();if(!res.ok)throw Error(path+' '+res.status+' '+val.slice(0,350));return val?JSON.parse(val):null};
const setup=await outlet('/setup/attach-host',{cloudUrl:config.api,businessId:grant.businessId,enrollmentCode:grant.enrollmentCode,fullName:'QA Local Manager',username:'qa-local-manager',pin:'719326'});assert.equal(setup.catalogueSynced,true);
const local=await outlet('/auth/login',{username:'qa-local-manager',pinCode:'719326',tenantSlug:input.webName});const product=head.products[0],branchId=branch(head);
const order=await outlet('/orders',{branchId,clientLocalId:randomUUID(),orderType:'Delivery',paymentMethod:'Cash',isPaid:false,items:[{productId:product.id,quantity:1,unitPricePKR:product.sellingPricePKR,productName:product.name,station:product.station}]},local.token);const id=order.orderId;
const sale=async()=> (await a(head,'/orders?branchId='+branchId)).find(o=>o.id===id);
async function until(fn,label){for(let i=0;i<70;i++){const data=await fn();if(data)return data;await new Promise(ok=>setTimeout(ok,2200))}throw Error('Timed out '+label)}
const first=await until(sale,'original open order');assert.equal(first.isPaid,false);console.log('PASS local unpaid delivery reached HQ before collection');
const rider=await outlet('/riders',{branchId,name:'Host rider',phone:'03019998877'},local.token);const tickets=(await outlet('/kitchen/tickets?branchId='+branchId,null,local.token)).filter(k=>k.orderId===id);for(const t of tickets)await outlet('/kitchen/tickets/'+t.id+'/status',{status:'Ready'},local.token);
await outlet('/delivery/assign-rider',{orderId:id,riderId:rider.id},local.token);
const completed=await outlet('/delivery/mark-delivered?orderId='+id,{},local.token);
const final=await until(async()=>{const o=await sale();return o?.isPaid&&o},'late COD at HQ');assert.equal(final.status,'Completed');assert.equal(final.amountPaidPKR,completed.totalPKR);assert.equal(final.paidAt,completed.paidAt);assert.equal(final.cashShiftId,null);assert.equal((await a(head,'/orders?branchId='+branchId)).filter(o=>o.id===id).length,1);
console.log('PASS already-synced sale updated at HQ with original receipt ID, payment time, completed status and cash amount');