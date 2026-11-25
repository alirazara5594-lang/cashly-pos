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
const main=await make(business('Floor',1,'Professional','restaurant','Restaurant'));
const grocery=await make(business('Grocery',2,'Standard','grocery','CashAndCarry'));
const usa=await make({...business('Usd',3,'Standard','retail'),country:'United States',stateCode:'US-CA',ownerMobile:'+12025550121'});
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

await catalog(main,[{name:'Reg Grill',price:200,station:'Grill'},{name:'Reg Juice',price:100,station:'BeverageBar'}]);
await catalog(grocery,[{name:'Reg Batch',price:80}]);await catalog(usa,[{name:'Reg Dollar',price:12.5}]);
main.table=await p(main,'/tables',{branchId:branch(main),tableNumber:'QA-01',section:'Main',capacity:4});
const staff=await p(main,'/users',{tenantId:main.tenant.id,branchId:branch(main),fullName:'Regression Waiter',username:'floor-waiter',pinCode:'431783',role:'Waiter'});
const waiter=await call('POST','/auth/login',{username:staff.username,pinCode:'431783',tenantSlug:main.input.webName,branchId:branch(main)});
await writeFile(new URL('fixtures.json',import.meta.url),JSON.stringify({main,grocery,usa,waiter}));
console.log('PASS fresh registrations, real sign-ins, 3 catalogs and waiter');
const orderBody=(scope,products,extra={})=>({branchId:branch(scope),orderType:'Takeaway',subTotalPKR:0,discountPKR:0,taxPKR:0,totalPKR:0,paymentMethod:'Cash',
 isPaid:true,changeDuePKR:0,amountPaidPKR:2000,clientLocalId:'qa:'+randomUUID(),cashierName:scope.user.fullName,createdByRole:scope.user.role,
 items:products.map(pr=>({productId:pr.id,productName:pr.name,quantity:1,unitPricePKR:pr.sellingPricePKR,station:pr.station})),...extra});

const riderData={branchId:branch(main),name:'Rider One',phone:'03015552222',vehicleNumber:'BIKE-01'};
const rider=await p(main,'/riders',riderData,201);assert.equal(rider.isActive,true);await p(waiter,'/riders',riderData,403);await p(main,'/riders',riderData,409);
const edit=active=>call('PUT','/riders/'+rider.id,{...riderData,name:'Rider One Edited',isActive:active},main.token);
assert.equal((await edit(false)).isActive,false);await edit(true);
console.log('PASS rider setup, edit, deactivate, reactivation, duplicate and role checks');
const shift=await p(main,'/cash-shifts/open',{branchId:branch(main),terminalName:'Till',cashierName:'Owner',openingFloatPKR:500});
const unpaid=orderBody(main,main.products,{orderType:'Delivery',amountPaidPKR:0,isPaid:false});
const [one,two]=await Promise.all([p(main,'/orders',unpaid),p(main,'/orders',unpaid)]);assert.equal(one.orderId,two.orderId);
const id=one.orderId,total=one.totalPKR,dispatch=(code)=>p(main,'/delivery/assign-rider',{orderId:id,riderId:rider.id},code);
const pending=()=>a(main,'/riders/'+rider.id+'/pending-cod');
const tickets=(await a(main,scoped(main,'/kitchen/tickets'))).filter(t=>t.orderId===id);assert.equal(tickets.length,2);
const status=(t,status)=>p(main,'/kitchen/tickets/'+t.id+'/status',{status});
await status(tickets[0],'Ready');await dispatch(409);assert.ok((await a(main,scoped(main,'/delivery/board'))).inKitchen.some(o=>o.id===id));
await status(tickets[0],'Completed');await status(tickets[1],'Ready');await dispatch(200);await dispatch(200);assert.equal((await pending()).expectedCODPKR,0);
const deliver=()=>p(main,'/delivery/mark-delivered?orderId='+id,{});const delivered=await Promise.all([deliver(),deliver()]);
assert.ok(delivered.every(o=>o.paidAt&&o.completedAt&&o.isPaid&&o.amountPaidPKR===total&&!o.cashShiftId));assert.equal(delivered[0].paidAt,delivered[1].paidAt);
assert.equal((await pending()).expectedCODPKR,total);const report=await a(main,scoped(main,'/reports/daily-z'));
assert.equal(report.cashSalesPKR,total);assert.equal(report.expectedCashInDrawerPKR,500);
console.log('PASS retry, multi-station readiness, early dispatch refusal, COD payment exactly once and drawer unchanged');
const handover={riderId:rider.id,orderIds:[id],cashCollectedPKR:total-1,expectedCODPKR:90000,totalOrdersDelivered:999};
const settle=(x,code)=>p(main,'/riders/settle',x,code);
const settled=await Promise.all([settle(handover,200),settle(handover,200)]);assert.equal(settled[0].settlementId,settled[1].settlementId);assert.equal(settled[0].variancePKR,-1);
await settle({...handover,cashCollectedPKR:total},409);assert.equal((await pending()).orders.length,0);const logs=await a(main,scoped(main,'/delivery/settlements'));assert.equal(logs.length,1);assert.equal(logs[0].totalCODExpectedPKR,total);assert.equal(logs[0].totalOrdersDelivered,1);
console.log('PASS concurrent handover, variance, stale repeat, cleared balance and server-calculated totals');
const prepaid=await p(main,'/orders',{...unpaid,clientLocalId:randomUUID()});await p(main,'/orders/'+prepaid.orderId+'/settle',{paymentMethod:'Cash'});
const kt=(await a(main,scoped(main,'/kitchen/tickets'))).filter(t=>t.orderId===prepaid.orderId);await Promise.all(kt.map(t=>status(t,'Ready')));
await p(main,'/delivery/assign-rider',{orderId:prepaid.orderId,riderId:rider.id});await p(main,'/delivery/mark-delivered?orderId='+prepaid.orderId,{});assert.equal((await pending()).expectedCODPKR,0);
console.log('PASS prepaid delivery, simultaneous readiness and no second collection');
for(const n of [7,14,30]){const analytics=await a(main,'/analytics/smart?days='+n);assert.equal(analytics.revenueTrend.length,n);assert.equal(analytics.summary.totalOrders,2);assert.equal(analytics.avgOrderValue,total);assert.equal(analytics.bestSellers.length,2);assert.ok(analytics.peakHours[0].orderCount===2)}
const line={branchId:branch(grocery),productId:grocery.products[0].id,quantity:3,supplierName:'QA',costPricePKR:25,batchNumber:'QA-B1',expiryDate:'2099-01-01'};
await p(grocery,'/inventory/stock-in',line);await p(grocery,'/inventory/stock-in',{...line,expiryDate:'2001-01-01'},400);const stock=await a(grocery,scoped(grocery,'/inventory'));assert.ok(stock.some(x=>x.productId===line.productId&&x.quantityOnHand===3&&x.expiryDate.startsWith('2099-01-01')));
console.log('PASS analytics ranges, populated sales and calendar-date stock intake');
