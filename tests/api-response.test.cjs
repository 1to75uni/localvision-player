const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({URL,Date});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../api-response.js'),'utf8'),ctx);
const read=(body,status=200,headers={})=>ctx.LVApiResponse.read(new Response(body,{status,headers}), 'https://cms.test/api/player-state');

test('JSON D1 quota preserves HTTP status, endpoint, Retry-After and Ray ID',async()=>{
 await assert.rejects(read(JSON.stringify({ok:false,errorCode:'LV-D1-QUOTA',error:'limit'}),503,{'content-type':'application/json','retry-after':'1800','cf-ray':'qa-ray'}),e=>e.code==='LV-D1-QUOTA'&&e.status===503&&e.endpoint==='/api/player-state'&&e.retryAfterMs===1800000&&e.rayId==='qa-ray');
});
test('plain text and HTML D1 errors are classified without losing HTTP evidence',async()=>{
 for(const body of ["D1_ERROR: Your account has exceeded D1's free tier daily row write limit",'<html><h1>D1_ERROR</h1><p>daily row read limit exceeded</p></html>'])
  await assert.rejects(read(body,503,{'content-type':'text/html'}),e=>e.code==='LV-D1-QUOTA'&&e.status===503&&e.temporary&&e.retryAfterMs>=900000);
});
test('Workers 1027 request quota is distinguished from D1 row quota',async()=>{
 await assert.rejects(read('<html><h1>Error <span>1027</span></h1><p>Worker exceeded request limit</p></html>',429),e=>e.code==='LV-WORKER-QUOTA'&&e.status===429);
});
test('unknown HTML server failure is not invented as a quota error',async()=>{
 await assert.rejects(read('<html>Service unavailable</html>',503,{'content-type':'text/html'}),e=>e.code==='LV-API-INVALID'&&e.status===503&&e.temporary&&e.contentType==='text/html');
});
test('HTTP 200 HTML, null, array, string, boolean and empty bodies are invalid',async()=>{
 for(const body of ['<html>login</html>','null','[]','"ok"','true',''])await assert.rejects(read(body),e=>e.code==='LV-API-INVALID'&&e.status===200&&e.temporary);
});
test('HTML 404 keeps compatibility fallback possible without a global cooldown',async()=>{
 await assert.rejects(read('<h1>Not found</h1>',404),e=>e.status===404&&!e.temporary);
});
test('normal data containing old quota logs is accepted',async()=>{
 const body={ok:true,errors:[{errorCode:'LV-D1-QUOTA',message:'D1 exceeded daily row write limit'}],playlists:{left:[],right:[]}};
 assert.equal(JSON.stringify(await read(JSON.stringify(body))),JSON.stringify(body));
});
test('rate limit honors HTTP-date Retry-After and bounds excessive delays',async()=>{
 const now=Date.parse('2026-09-11T01:00:00Z');
 const r=new Response('busy',{status:429,headers:{'retry-after':'Fri, 11 Sep 2026 01:10:00 GMT'}});
 await assert.rejects(ctx.LVApiResponse.read(r,'https://cms.test/api/heartbeat',now),e=>e.code==='LV-API-RATE-LIMIT'&&e.retryAfterMs===600000);
 await assert.rejects(read('busy',429,{'retry-after':'999999999'}),e=>e.retryAfterMs===86400000);
});
test('truncated body keeps status rather than reporting an unknown format error',async()=>{
 const r={ok:false,status:502,headers:new Headers({'content-type':'text/html'}),text:async()=>{throw new Error('stream aborted')}};
 await assert.rejects(ctx.LVApiResponse.read(r,'https://cms.test/api/player-state'),e=>e.code==='LV-API-DOWN'&&e.status===502&&e.temporary);
});
