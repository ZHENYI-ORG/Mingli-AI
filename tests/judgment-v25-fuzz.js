'use strict';
const assert=require('node:assert/strict');
const {computePaipan}=require('../dist/api');
const stems=[...'甲乙丙丁戊己庚辛壬癸'];
const branches=[...'子丑寅卯辰巳午未申酉戌亥'];
const monthBranches=[...'寅卯辰巳午未申酉戌亥子丑'];
const jz=Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]);
const monthStart={甲:'丙',己:'丙',乙:'戊',庚:'戊',丙:'庚',辛:'庚',丁:'壬',壬:'壬',戊:'甲',癸:'甲'};
const hourStart={甲:'甲',己:'甲',乙:'丙',庚:'丙',丙:'戊',辛:'戊',丁:'庚',壬:'庚',戊:'壬',癸:'壬'};
function stemAt(start,offset){return stems[(stems.indexOf(start)+offset)%10];}
let seed=Number(process.env.V25_FUZZ_SEED || 0x25c0ffee) >>> 0;
function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/0x100000000;}
function pick(a){return a[Math.floor(rnd()*a.length)];}
function legalChart(){
 const year=pick(jz), day=pick(jz);
 const mi=Math.floor(rnd()*12), hi=Math.floor(rnd()*12);
 const month=stemAt(monthStart[year[0]],mi)+monthBranches[mi];
 const hour=stemAt(hourStart[day[0]],hi)+branches[hi];
 return [year,month,day,hour];
}
function run(p){const [year,month,day,hour]=p;const r=computePaipan({gender:rnd()<.5?'male':'female',input_mode:'pillars',direct_pillars:{year,month,day,hour}});assert.equal(r.ok,true,r.message||p.join(' '));return r.data.blind_judgment;}
const N=Number(process.env.V25_FUZZ_N||2000);
const DOUBLE=Number(process.env.V25_FUZZ_DOUBLE||Math.min(N,250));
let paths=0,primaries=0,xiang=0,qishi=0,multi=0,co=0,assertions=0;
const start=Date.now();
for(let i=0;i<N;i++){
 const p=legalChart(); const j=run(p); const primary=j.mainline.primary;
 assert.match(j.engine_version,/^2\.5\./); assertions++;
 assert(Array.isArray(j.gong_dependency_graph)); assertions++;
 for(const g of j.gong_paths||[]){
   paths++; assert(g.settlement,`missing settlement ${g.id}`); assertions++;
   assert.equal(g.settlement.pathId,g.id); assertions++;
   const targets=g.settlement.targetGraph?.primaryTargets||[];
   const tr=g.settlement.targetResolutions||[];
   assert.equal(new Set(tr.map(x=>x.targetId)).size,tr.length,'duplicate target resolution'); assertions++;
   for(const tid of targets){assert(tr.some(x=>x.targetId===tid),`target ${tid} has no resolution`);assertions++;}
   const sigs=(g.settlement.magnitude?.contributions||[]).map(x=>x.resultSignature);
   assert.equal(new Set(sigs).size,sigs.length,'duplicate result signature'); assertions++;
   assert.equal(g.settlement.magnitude?.contributionCount||0,sigs.length); assertions++;
   if(g.settlement.completion==='complete'){
     assert.equal((g.settlement.residualTargetIds||[]).length,0,'complete path retains residual'); assertions++;
     assert(tr.every(x=>x.state==='resolved'),'complete path has unresolved target'); assertions++;
   }
   if(g.settlement.eligibility==='invalid') {assert.equal(g.status,'invalid'); assertions++;}
   if(g.actionMode==='qishi_control'&&g.settlement.eligibility==='valid'){
     qishi++; assert((g.settlement.controlEvidenceRelationIds||[]).length>0,'valid qishi without control evidence'); assertions++;
   }
   if(targets.length>1)multi++;
 }
 if(primary?.type==='xiang_fallback'){xiang++;}
 else if(primary){
   primaries++;
   assert.equal(primary.settlement?.eligibility,'valid','candidate became primary'); assertions++;
   assert(j.gong_paths.some(x=>x.id===primary.id),'primary absent from gong_paths'); assertions++;
 }
 if(j.mainline.co_primary){co++; assert((j.mainline.co_primary_ids||[]).length>1); assertions++;}
 if(i<DOUBLE){
   // deterministic rerun: gender must be held fixed, so reconstruct by using a fixed gender for the pair.
   const [year,month,day,hour]=p;
   const input={gender:'male',input_mode:'pillars',direct_pillars:{year,month,day,hour}};
   const a=computePaipan(input), b=computePaipan(input); assert(a.ok&&b.ok);
   const ja=a.data.blind_judgment,jb=b.data.blind_judgment;
   assert.equal(ja.mainline.primary?.id,jb.mainline.primary?.id,'nondeterministic primary'); assertions++;
   assert.deepEqual(ja.mainline.co_primary_ids,jb.mainline.co_primary_ids,'nondeterministic co-primary'); assertions++;
   const slim=x=>(x.gong_paths||[]).map(g=>[g.id,g.status,g.execution_mode,g.settlement?.eligibility,g.settlement?.completion,g.settlement?.resultIntegrity,g.settlement?.alignment,g.settlement?.magnitude?.contributionCount]);
   assert.deepEqual(slim(ja),slim(jb),'nondeterministic settlement'); assertions++;
 }
}
const ms=Date.now()-start;
console.log(JSON.stringify({charts:N,doubleRuns:DOUBLE,paths,primaries,xiang,qishiValid:qishi,multiTargetPaths:multi,coPrimaryCharts:co,assertions,elapsedMs:ms,chartsPerSecond:Math.round(N/(ms/1000))},null,2));
console.log('v2.5 fuzz invariants passed');
