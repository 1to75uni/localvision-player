/* SHA-256 per 1 MiB chunk: bounded verification buffers, no full-file ArrayBuffer. */
(function(root){
'use strict';
const CHUNK=1024*1024;
const fail=(message,code='LV-INTEGRITY-MISMATCH')=>Object.assign(new Error(message),{code});
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
// Compatibility path for older WebViews without SubtleCrypto. Input is at most one chunk.
function fallbackDigest(input){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64);
 const n=input.byteLength,bytes=new Uint8Array(Math.ceil((n+9)/64)*64);bytes.set(input);bytes[n]=128;
 const view=new DataView(bytes.buffer);view.setUint32(bytes.length-8,Math.floor(n/0x20000000));view.setUint32(bytes.length-4,(n*8)>>>0);
 const r=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let off=0;off<bytes.length;off+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(off+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  for(const [i,x] of [a,b,c,d,e,f,g,h].entries())H[i]=(H[i]+x)>>>0;
 }
 return H.map(x=>x.toString(16).padStart(8,'0')).join('');
}
async function digest(bytes){return root.crypto?.subtle ? hex(await root.crypto.subtle.digest('SHA-256',bytes)) : fallbackDigest(bytes);}
function validate(m){
 if(!m || m.algorithm!=='SHA-256-CHUNKS' || m.chunkBytes!==CHUNK || !Number.isSafeInteger(m.byteSize) || m.byteSize<=0 || m.byteSize>1024*1024*1024 || !Array.isArray(m.hashes) || m.hashes.length!==Math.ceil(m.byteSize/CHUNK) || m.hashes.some(x=>! /^[a-f0-9]{64}$/.test(x)) || !/^[a-f0-9]{64}$/.test(m.revision))throw fail('잘못된 원본 검증 정보','LV-INTEGRITY-MANIFEST');
 return m;
}
async function inspect(stream,{expected,signal,onChunk}={}){
 if(expected)validate(expected);
 const reader=stream.getReader(),block=new Uint8Array(CHUNK),hashes=[];let used=0,size=0;
 const check=()=>{if(signal?.aborted)throw fail('파일 검증 취소','AbortError');};
 async function flush(){check();const hash=await digest(block.subarray(0,used));if(expected && expected.hashes[hashes.length]!==hash)throw fail(`파일 구간 ${hashes.length+1}의 SHA-256 불일치`);hashes.push(hash);used=0;if(onChunk)await onChunk(size);}
 try{
  while(true){check();const {value,done}=await reader.read();if(done)break;let offset=0;size+=value.byteLength;
   if(size>1024*1024*1024 || (expected && size>expected.byteSize))throw fail('파일 크기 한도 또는 원본 크기 초과');
   while(offset<value.byteLength){const n=Math.min(CHUNK-used,value.byteLength-offset);block.set(value.subarray(offset,offset+n),used);used+=n;offset+=n;if(used===CHUNK)await flush();}
  }
  if(used)await flush();if(!size)throw fail('빈 미디어 파일');if(expected && size!==expected.byteSize)throw fail('원본과 저장 파일의 크기가 다릅니다.');
  const revision=await digest(new TextEncoder().encode(JSON.stringify([size,CHUNK,hashes])));
  if(expected && revision!==expected.revision)throw fail('원본 검증 정보의 리비전 불일치','LV-INTEGRITY-MANIFEST');
  return {algorithm:'SHA-256-CHUNKS',chunkBytes:CHUNK,byteSize:size,hashes,revision};
 }catch(error){try{await reader.cancel(error)}catch(_){}throw error;}finally{reader.releaseLock();}
}
root.LVIntegrity={CHUNK,inspect,validate,digest};
})(globalThis);
