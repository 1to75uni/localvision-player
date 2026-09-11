(function(root){
 'use strict';
 const LIMITS={'player-control':310,'player-state':110,'heartbeat':160,'app-config':55,'player-status':100,'player-errors':50,'other':20};
 class Budget {
  constructor(storage,key){this.storage=storage;this.key=key;this.data={};try{this.data=JSON.parse(storage.getItem(key)||'{}')}catch(_){} }
  take(url){
   const pathname=new URL(url).pathname;if(!pathname.startsWith('/api/'))return;
   const name=pathname.split('/').pop(),route=Object.prototype.hasOwnProperty.call(LIMITS,name)?name:'other',limit=LIMITS[route];
   const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
   if(this.data.day!==day)this.data={day,counts:{}};
   const count=Number(this.data.counts?.[route])||0;
   if(count>=limit){const error=new Error('무료 운영 API 일일 예산 대기');error.code='LV-REQUEST-BUDGET';error.retryAfterMs=Date.parse(day+'T00:00:00Z')+86400000-now;throw error;}
   this.data.counts={...this.data.counts,[route]:count+1};
   try{this.storage.setItem(this.key,JSON.stringify(this.data))}catch(_){}
  }
 }
 root.LVFreeBudget={Budget,LIMITS};
})(typeof window==='undefined'?globalThis:window);
