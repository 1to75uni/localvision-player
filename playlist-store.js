(function(root){
'use strict';
const error=(code,message)=>Object.assign(new Error(message),{code});
class VerifiedFiles {
 constructor(options){this.o=options;this.checked=new Map();this.chain=Promise.resolve();}
 async ensure(item,signal){
  const key=item.cacheUrl || item.url;
  if(item.integrity)root.LVIntegrity.validate(item.integrity);
  if(this.checked.has(key)){const hit=await (await this.o.cache()).match(key);if(hit && hit.headers.get('x-lv-content-revision')===this.checked.get(key) && (!item.integrity || item.integrity.revision===this.checked.get(key))){const blob=await hit.blob();if(blob.size===Number(hit.headers.get('x-lv-byte-size')))return {blob,revision:this.checked.get(key),verified:Boolean(item.integrity)};}}
  const task=this.chain.catch(()=>{}).then(()=>this.prepare(item,key,signal));this.chain=task;return task;
 }
 async prepare(item,key,signal){
  const cache=await this.o.cache(),expected=item.integrity;
  if(expected)root.LVIntegrity.validate(expected);
  const verify=async (response,verifySignal=signal)=>{
   const blob=await response.blob();if(!blob.size)throw error('LV-INTEGRITY-MISMATCH','빈 캐시 파일');
   const receipt=response.headers.get('x-lv-content-revision') || '';
   const wanted=expected?.revision || receipt;
   if(this.checked.get(key)===wanted && wanted && Number(response.headers.get('x-lv-byte-size'))===blob.size)return {blob,revision:wanted,verified:Boolean(expected)};
   this.o.stage?.('verifying',item);
   const manifest=await root.LVIntegrity.inspect(blob.stream(),{expected,signal:verifySignal,onChunk:this.o.yieldChunk});
   if(receipt && receipt!==manifest.revision)throw error('LV-INTEGRITY-MISMATCH','저장 이후 파일 내용 변경 감지');
   return {blob,revision:manifest.revision,verified:Boolean(expected)};
  };
  let response=await cache.match(key);
  // An unversioned old cache can be adopted only after checking the new manifest.
  if(!response && expected && item.fetchUrl && item.fetchUrl!==key)response=await cache.match(item.fetchUrl);
  if(response){
   try{const result=await verify(response);await this.seal(cache,key,result,item);return result;}
   catch(e){if(e.code==='LV-INTEGRITY-UNAVAILABLE' || e.code==='LV-INTEGRITY-MANIFEST' || signal?.aborted)throw e;this.checked.delete(key);await cache.delete(key);this.o.fault?.(e,item);}
  }
  let last;
  for(let attempt=0;attempt<2;attempt++){
   if(signal?.aborted)throw error('AbortError','취소됨');
   try{
    this.o.stage?.('downloading',item);
    const result=await this.o.fetch(item.fetchUrl || key,signal,async (response,effectiveSignal)=>{
     const type=response.headers.get('content-type') || '';
     if(!response.ok || response.status===206 || /text\/html|application\/json/.test(type))throw error('LV-MEDIA-DOWNLOAD',`미디어 응답 오류 HTTP ${response.status}`);
     const headerSize=Number(response.headers.get('content-length') || 0);
     await this.o.room(expected?.byteSize || headerSize || 32*1024*1024,key);
     const value=await verify(response,effectiveSignal);
     if(headerSize && headerSize!==value.blob.size && !response.headers.get('content-encoding'))throw error('LV-INTEGRITY-MISMATCH','응답 길이와 저장 크기 불일치');
     await this.o.room(value.blob.size,key);return value;
    });
    if(signal?.aborted)throw error('AbortError','취소됨');
    await this.seal(cache,key,result,item);return result;
   }catch(e){last=e;if(signal?.aborted || ['LV-CACHE-CAPACITY','LV-INTEGRITY-MANIFEST','LV-INTEGRITY-UNAVAILABLE'].includes(e.code))break;}
  }
  throw last;
 }
 async seal(cache,key,result,item){
  const existing=await cache.match(key);
  if(!existing || existing.headers.get('x-lv-content-revision')!==result.revision){
   const headers={'content-type':result.blob.type || (item.type==='video'?'video/mp4':'application/octet-stream'),'content-length':String(result.blob.size),'x-lv-byte-size':String(result.blob.size),'x-lv-content-revision':result.revision,'x-lv-origin-verified':result.verified?'1':'0'};
   await cache.put(key,new Response(result.blob,{headers}));
   const stored=await cache.match(key);if(!stored || stored.headers.get('x-lv-content-revision')!==result.revision)throw error('LV-CACHE-WRITE','검증 파일 저장 확인 실패');
  }
  this.checked.set(key,result.revision);this.o.saved?.(key,result);return result;
 }
}
class Journal {
 constructor(storage,key){this.storage=storage;this.key=key;}
 read(){try{const value=JSON.parse(this.storage.getItem(this.key)||'null');return value?.schema===1 && this.valid(value.active)?value:null;}catch(_){return null;}}
 valid(b){return b && Array.isArray(b.left) && Array.isArray(b.right) && b.left.length+b.right.length>0;}
 commit(bundle){
  if(!this.valid(bundle))throw error('LV-PLAYLIST-INVALID','비어 있거나 잘못된 재생목록');
  if(this.storage.volatile)throw error('LV-STORAGE-WRITE','영구 저장소 사용 불가: 현재 송출 유지');
  const old=this.read();const value={schema:1,active:bundle,previous:old?.active?.id && old.active.id===bundle.id ? old.previous : old?.active || null};
  try{this.storage.setItem(this.key,JSON.stringify(value));if(this.storage.volatile || this.storage.getItem(this.key)!==JSON.stringify(value))throw new Error('저장 확인 실패');}
  catch(e){throw error('LV-STORAGE-WRITE',`재생목록 적용 기록 저장 실패: ${e.message}`);}
  return value;
 }
}
root.LVPlaylistStore={VerifiedFiles,Journal};
})(globalThis);
