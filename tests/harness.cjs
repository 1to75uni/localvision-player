const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../runtime.js'),'utf8');
const settle = async () => {for(let i=0;i<16;i++) await Promise.resolve();};
function setup(options={}) {
  let now=1700000000000,seq=0,live=0,maxLive=0;
  const timers=new Map(),storage=new Map(),events=[],states=[],elements=[];
  const timer=(fn,ms)=>{timers.set(++seq,{fn,at:now+Math.max(0,ms)});return seq;};
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  class Element {
    constructor(tag){this.tag=tag;this.style={};this.readyState=options.readyState ?? 4;this._src='';this.paused=true;this.currentTime=0;this.duration=options.duration || 9;this.ended=false;this.frameTimer=null;this.children=[];this.alloc=false;elements.push(this);}
    set src(value){this._src=value;if(this.tag==='img' && value && !value.includes('loading.jpg'))timer(()=>this.onload?.(),10);}
    get src(){return this._src;}
    setAttribute(){} removeAttribute(k){if(k==='src')this.src='';}
    replaceChildren(...xs){this.children=xs;}
    remove(){} load(){if(this.tag!=='video')return;if(!this.src){if(this.alloc){this.alloc=false;live--;}return;}if(!this.alloc){this.alloc=true;live++;maxLive=Math.max(maxLive,live);}timer(()=>this.onloadedmetadata?.(),1);}
    pause(){this.paused=true;if(this.frameTimer)timers.delete(this.frameTimer);}
    play(){
      this.calls=(this.calls || 0)+1;
      if(options.deferPlay)return new Promise(()=>{});
      if(options.rejectFirst && this.calls===1)return Promise.reject(Object.assign(new Error('policy'),{name:'NotAllowedError'}));
      if(options.rejectAlways)return Promise.reject(Object.assign(new Error('policy'),{name:'NotAllowedError'}));
      this.paused=false;this.onplaying?.();
      const advance=()=>{if(this.paused || !this.src)return;this.currentTime=Math.min(this.duration,this.currentTime+1);if(this.currentTime>=this.duration){this.ended=true;this.onended?.();return;}this.frameTimer=timer(advance,1000);};
      if(!options.freeze)this.frameTimer=timer(advance,1000);
      return Promise.resolve();
    }
  }
  const ctx=vm.createContext({Date:Clock,URL:{revokeObjectURL(){}},Promise,AbortController,console,Map,Set,
    crypto:{randomUUID:()=>`event-${++seq}`},setTimeout:timer,clearTimeout:id=>timers.delete(id),
    document:{createElement:tag=>new Element(tag)},fetch:async()=>new Response('{}'),Response});
  ctx.window=ctx;vm.runInContext(source,ctx);
  const runtime=ctx.LVRuntime;
  const localStorage={getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v)};
  const acquire=runtime.createGate();
  const lanes={};
  for(const side of ['left','right']) lanes[side]=new runtime.Lane(side,{zone:new Element('zone'),acquire,resolveSource:async item=>item.url,onEvent:(...x)=>events.push(x),onState:(...x)=>states.push(x)});
  async function tick(ms){const target=now+ms;await settle();let rounds=0;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next || next[1].at>target)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await settle();if(++rounds>2000000)throw new Error('timer loop');}now=target;await settle();}
  return {runtime,lanes,events,states,timers,elements,storage,localStorage,tick,ctx,Element,timer,settle,get live(){return live},get maxLive(){return maxLive}};
}

module.exports={setup};
