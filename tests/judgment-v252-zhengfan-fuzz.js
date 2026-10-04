'use strict';
const assert=require('node:assert/strict');
const {LocalChartAdapter}=require('../dist/core/LocalChartAdapter');
const {BlindJudgmentEngine}=require('../dist/core/judgment/BlindJudgmentEngine');
const {resolveStageZhengFan}=require('../dist/core/judgment/v25/StageZhengFan');
const stems=[...'甲乙丙丁戊己庚辛壬癸'],branches=[...'子丑寅卯辰巳午未申酉戌亥'],monthBranches=[...'寅卯辰巳午未申酉戌亥子丑'];
const jz=Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]);
const monthStart={甲:'丙',己:'丙',乙:'戊',庚:'戊',丙:'庚',辛:'庚',丁:'壬',壬:'壬',戊:'甲',癸:'甲'},hourStart={甲:'甲',己:'甲',乙:'丙',庚:'丙',丙:'戊',辛:'戊',丁:'庚',壬:'庚',戊:'壬',癸:'壬'};
function stemAt(start,offset){return stems[(stems.indexOf(start)+offset)%10];}
let seed=0x2522fade;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}function pick(a){return a[Math.floor(rnd()*a.length)];}
function legal(){const y=pick(jz),d=pick(jz),mi=Math.floor(rnd()*12),hi=Math.floor(rnd()*12);return [y,stemAt(monthStart[y[0]],mi)+monthBranches[mi],d,stemAt(hourStart[d[0]],hi)+branches[hi]];}
const adapter=new LocalChartAdapter(),engine=new BlindJudgmentEngine();
function chart(p){const [year,month,day,hour]=p;return adapter.computeFromPillars({id:0,name:'zf-fuzz',gender:rnd()<.5?'male':'female',input_mode:'pillars',direct_pillars:{year,month,day,hour},direct_birth_year:'',direct_qiyun_year:'',direct_qiyun_month:'',birth_region:'fuzz'});}
function slim(z){return {status:z.status,confidence:z.confidence,mode:z.mode,support:z.support_score,conflict:z.conflict_score,axes:(z.axes||[]).map(x=>[x.id,x.direction,x.confidence,x.weight]),graph:z.original_intent_graph};}
const N=Number(process.env.V252_ZF_FUZZ_N||5000),DOUBLE=Number(process.env.V252_ZF_FUZZ_DOUBLE||500);let assertions=0,counts={zheng:0,fan:0,mixed:0,unclear:0},guards=0;
for(let i=0;i<N;i++){
 const p=legal(),c=chart(p),a=engine.analyze(c),z=a.chart_zheng_fan,dc=z.direction_context||{};
 assert.equal(z.mode,'chart_zheng_fan_v2_settlement');assertions++;
 assert(['zheng','fan','mixed','unclear'].includes(z.status));assertions++;
 assert(['high','medium','low'].includes(z.confidence));assertions++;
 assert.equal(z.major_conclusion_allowed,false);assert.equal(z.event_conclusion_allowed,false);assertions+=2;
 assert(z.original_intent_graph);assert(Array.isArray(z.axes));assertions+=2;
 assert.equal(new Set(z.axes.map(x=>x.id)).size,z.axes.length,'duplicate zf axis');assertions++;
 assert(z.support_score>=0&&z.conflict_score>=0);assertions++;
 if(['zheng','fan'].includes(dc.status)){assert.equal(z.status,dc.status,'frozen direction context was flipped');assertions++;}
 if(z.axes.some(x=>x.id==='ZF2-SOURCE-GOLD-GUARD'))guards++;
 const primary=a.mainline.primary;
 if(primary&&primary.type!=='xiang_fallback'){
   assert.equal(z.original_intent_graph.primaryPathId,primary.id);assertions++;
   assert.deepEqual(z.original_intent_graph.targetNodeIds,primary.settlement.targetGraph.primaryTargets);assertions++;
   assert.equal(z.original_intent_graph.completion,primary.settlement.completion);assertions++;
 }
 counts[z.status]++;
 if(i<DOUBLE){const b=engine.analyze(c);assert.deepEqual(slim(z),slim(b.chart_zheng_fan),'nondeterministic chart zhengfan');assertions++;}
}
// Exhaust StageZhengFan over finite candidate state combinations.
const bases=['zheng','fan','mixed','unclear'],execs=['maintained','changed_candidate'],edges=['maintained','impaired_candidate','altered_candidate'],targets=['maintained','engaged_candidate','disturbed_candidate'],residual=['unchanged_candidate','increase_candidate','recheck_required'],integrity=['intact','impaired_or_broken_candidate','recheck_required'];
let stageCases=0;
for(const base of bases)for(const ex of execs)for(const edge of edges)for(const target of targets)for(const res of residual)for(const integ of integrity){
 const timing={state_replay:{available:true,snapshots:[{stage:'dayun',changes:[],settlement_delta:{executor_state:ex,control_edge_state:edge,target_state:target,completion_before:'complete',completion_after_candidate:edge==='impaired_candidate'?'partial_or_broken_candidate':'complete',residual_change_candidate:res,integrity_after_candidate:integ,ownership_after_candidate:'unchanged_candidate',alignment_after_candidate:'unchanged_candidate'}}]}};
 const r=resolveStageZhengFan({status:base,confidence:'medium'},timing).dayun;stageCases++;
 assert(['maintained_zheng','strengthened_zheng','partial_fan','fan','maintained_fan','repair_candidate','mixed','unclear'].includes(r.status));assertions++;
 assert.equal(r.major_conclusion_allowed,false);assert.equal(r.event_conclusion_allowed,false);assertions+=2;
 if(base==='zheng'&&edge==='impaired_candidate'&&ex==='maintained')assert(['fan','partial_fan'].includes(r.status));
}
console.log(JSON.stringify({charts:N,doubleRuns:DOUBLE,statusCounts:counts,sourceGoldGuards:guards,stageStateCases:stageCases,assertions},null,2));
console.log('v2.5.2 Chart/Stage ZhengFan fuzz invariants passed');
