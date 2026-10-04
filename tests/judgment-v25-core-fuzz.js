'use strict';
const assert=require('node:assert/strict');
const {LocalChartAdapter}=require('../dist/core/LocalChartAdapter');
const {BlindJudgmentEngine}=require('../dist/core/judgment/BlindJudgmentEngine');
const stems=[...'甲乙丙丁戊己庚辛壬癸'];
const branches=[...'子丑寅卯辰巳午未申酉戌亥'];
const monthBranches=[...'寅卯辰巳午未申酉戌亥子丑'];
const jz=Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]);
const monthStart={甲:'丙',己:'丙',乙:'戊',庚:'戊',丙:'庚',辛:'庚',丁:'壬',壬:'壬',戊:'甲',癸:'甲'};
const hourStart={甲:'甲',己:'甲',乙:'丙',庚:'丙',丙:'戊',辛:'戊',丁:'庚',壬:'庚',戊:'壬',癸:'壬'};
function stemAt(start,offset){return stems[(stems.indexOf(start)+offset)%10];}
let seed=Number(process.env.V25_CORE_FUZZ_SEED || 0x255a17e) >>> 0;
function rnd(){seed=(Math.imul(seed,1103515245)+12345)>>>0; return seed/0x100000000;}
function pick(a){return a[Math.floor(rnd()*a.length)];}
function legalChart(){const year=pick(jz),day=pick(jz),mi=Math.floor(rnd()*12),hi=Math.floor(rnd()*12);return [year,stemAt(monthStart[year[0]],mi)+monthBranches[mi],day,stemAt(hourStart[day[0]],hi)+branches[hi]];}
const adapter=new LocalChartAdapter(); const engine=new BlindJudgmentEngine();
function makeChart(p,gender){const [year,month,day,hour]=p;return adapter.computeFromPillars({id:0,name:'fuzz',gender,input_mode:'pillars',direct_pillars:{year,month,day,hour},direct_birth_year:'',direct_qiyun_year:'',direct_qiyun_month:'',birth_region:'四柱直排'});}
function slim(j){return {primary:j.mainline.primary?.id||null,co:[...(j.mainline.co_primary_ids||[])],paths:(j.gong_paths||[]).map(g=>[g.id,g.status,g.execution_mode,g.settlement?.eligibility,g.settlement?.completion,g.settlement?.resultIntegrity,g.settlement?.alignment,g.settlement?.magnitude?.contributionCount,(g.settlement?.residualTargetIds||[]).join(',')]),deps:(j.gong_dependency_graph||[]).map(e=>[e.fromPathId,e.toPathId,e.type,(e.viaNodeIds||[]).join(',')])};}
const N=Number(process.env.V25_CORE_FUZZ_N||20000), DOUBLE=Number(process.env.V25_CORE_FUZZ_DOUBLE||2000);
let paths=0,assertions=0,validQishi=0,multi=0,xiang=0,co=0;
const start=Date.now();
for(let i=0;i<N;i++){
 const pillars=legalChart(),gender=rnd()<.5?'male':'female'; const chart=makeChart(pillars,gender); const j=engine.analyze(chart);
 assert.match(j.engine_version,/^2\.5\./);assertions++;
 const ids=new Set();
 for(const g of j.gong_paths||[]){
   paths++; assert(!ids.has(g.id),'duplicate path id');ids.add(g.id);assertions++;
   const s=g.settlement; assert(s,'missing settlement');assertions++;
   assert.equal(s.pathId,g.id);assertions++;
   assert(['valid','candidate','invalid'].includes(s.eligibility));assertions++;
   assert(['none','acting','partial','complete','broken','counterproductive'].includes(s.completion));assertions++;
   assert(['intact','impaired','broken','unknown'].includes(s.resultIntegrity));assertions++;
   const tg=s.targetGraph?.primaryTargets||[], trs=s.targetResolutions||[];
   assert.equal(new Set(trs.map(x=>x.targetId)).size,trs.length);assertions++;
   for(const id of tg){assert(trs.some(x=>x.targetId===id),`unsettled target ${id}`);assertions++;}
   if(tg.length>1)multi++;
   const sigs=(s.magnitude?.contributions||[]).map(x=>x.resultSignature);assert.equal(new Set(sigs).size,sigs.length);assertions++;assert.equal(s.magnitude.contributionCount,sigs.length);assertions++;
   if(s.completion==='complete'){assert(trs.every(x=>x.state==='resolved'));assert.equal(s.residualTargetIds.length,0);assert.equal(s.resultIntegrity,'intact');assertions+=3;}
   if(s.eligibility==='invalid'){assert.equal(g.status,'invalid');assertions++;}
   if(g.actionMode==='qishi_control'&&s.eligibility==='valid'){validQishi++;assert(s.controlEvidenceRelationIds.length>0);assertions++;}
   for(const c of s.magnitude?.contributions||[]){assert(c.targetIds.length>0);assert(c.sourcePathIds.includes(g.id));assertions+=2;}
 }
 const p=j.mainline.primary;
 if(p?.type==='xiang_fallback')xiang++;
 else if(p){assert.equal(p.settlement?.eligibility,'valid');assert(j.gong_paths.some(x=>x.id===p.id));assertions+=2;}
 if(j.mainline.co_primary){co++;assert((j.mainline.co_primary_ids||[]).length>1);assertions++;}
 for(const e of j.gong_dependency_graph||[]){assert(ids.has(e.fromPathId)&&ids.has(e.toPathId));assert.notEqual(e.fromPathId,e.toPathId);assertions+=2;}
 if(i<DOUBLE){const j2=engine.analyze(makeChart(pillars,gender));assert.deepEqual(slim(j),slim(j2),'nondeterministic engine result');assertions++;}
}
const ms=Date.now()-start;
console.log(JSON.stringify({charts:N,doubleRuns:DOUBLE,paths,validQishi,multiTargetPaths:multi,xiangFallbackCharts:xiang,coPrimaryCharts:co,assertions,elapsedMs:ms,chartsPerSecond:Math.round(N/(ms/1000))},null,2));
console.log('v2.5 core fuzz invariants passed');
