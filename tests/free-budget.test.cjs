const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('100 persistent player identities stay within 80,500 budgeted API attempts/day, including failures and reloads',()=>{
 const ctx=vm.createContext({URL,Date});vm.runInContext(fs.readFileSync(path.join(__dirname,'../free-budget.js'),'utf8'),ctx);
 const {Budget,LIMITS}=ctx.LVFreeBudget;let total=0;
 for(let i=0;i<100;i++){
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  let b=new Budget(storage,'b');
  for(const [route,limit] of Object.entries(LIMITS)){
   for(let j=0;j<limit;j++){b.take('https://cms/api/'+route);total++;}
   b=new Budget(storage,'b');assert.throws(()=>b.take('https://cms/api/'+route),e=>e.code==='LV-REQUEST-BUDGET'&&e.retryAfterMs>0);
  }
 }
 assert.equal(total,80500);
});
test('budget resets on next UTC day and routes do not consume each other’s allowance',()=>{
 let now=Date.parse('2026-09-11T23:59:00Z');class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const ctx=vm.createContext({URL,Date:Clock});vm.runInContext(fs.readFileSync(path.join(__dirname,'../free-budget.js'),'utf8'),ctx);
 const data=new Map(),b=new ctx.LVFreeBudget.Budget({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},'b');
 for(let i=0;i<50;i++)b.take('https://cms/api/player-errors');assert.throws(()=>b.take('https://cms/api/player-errors'));
 b.take('https://cms/api/heartbeat');now+=60000;b.take('https://cms/api/player-errors');assert.equal(b.data.counts['player-errors'],1);
});
