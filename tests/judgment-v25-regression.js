'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {computePaipan}=require('../dist/api');
const {arbitrateMainlineV2}=require('../dist/core/judgment/v25/MainlineArbiterV2');
const vectors=require('./judgment-source-benchmark-vectors.json');

function runPillars(pillars,gender='male',name='v25'){
  const [year,month,day,hour]=pillars;
  const r=computePaipan({name,gender,input_mode:'pillars',direct_pillars:{year,month,day,hour}});
  assert.equal(r.ok,true,`${name}: ${r.message||'paipan failed'}`);
  return r.data.blind_judgment;
}
function runDate(input){
  const r=computePaipan(input); assert.equal(r.ok,true,r.message||'date paipan failed'); return r.data.blind_judgment;
}
let passed=0;
function ok(name,fn){fn();passed++;console.log(`✓ ${name}`);}

const source={};
for(const v of vectors) source[v.id]=runPillars(v.pillars,v.gender,v.id);

ok('engine exposes v2.5 settlement and lexicographic mainline',()=>{
  const j=source['source-core-001'];
  assert.match(j.engine_version,/^2\.5\./);
  assert.equal(j.mainline.arbitration?.mode,'lexicographic-v2');
  assert(j.mainline.primary?.settlement);
  assert.equal(j.mainline.primary.settlement.pathId,j.mainline.primary.id);
});

ok('a standard primary must pass the valid settlement gate',()=>{
  for(const [id,j] of Object.entries(source)){
    const p=j.mainline.primary;
    if(!p||p.type==='xiang_fallback')continue;
    assert.equal(p.settlement?.eligibility,'valid',`${id} primary not valid`);
    assert.notEqual(p.settlement?.completion,'none',`${id} primary has no completion`);
  }
});

ok('source-core-002 keeps candidate work out of primary and falls back to Xiang',()=>{
  const j=source['source-core-002'];
  assert.equal(j.mainline.primary?.type,'xiang_fallback');
  const standards=j.gong_paths.filter(p=>p.type!=='xiang_fallback');
  assert(standards.length>0);
  assert(standards.every(p=>p.settlement?.eligibility!=='valid'));
});

ok('QiShi control requires independent control/clash evidence',()=>{
  const js=[...Object.values(source),runPillars(['甲寅','乙亥','己丑','甲子'],'male','qishi-gate')];
  for(const j of js) for(const p of j.gong_paths||[]){
    if(p.actionMode==='qishi_control'&&p.settlement?.eligibility==='valid'){
      assert((p.settlement.controlEvidenceRelationIds||[]).length>0,`${p.id} valid qishi lacks control evidence`);
    }
  }
});

ok('multi-target tomb work resolves targets node-by-node but dedups one structural result',()=>{
  const j=runPillars(['乙巳','己丑','壬辰','辛丑'],'male','multi-tomb');
  const p=j.gong_paths.find(x=>x.type==='mu_yong'&&x.settlement?.targetGraph?.primaryTargets?.length===2);
  assert(p,'expected two-target mu_yong path');
  assert.equal(p.settlement.targetGraph.primaryTargets.length,2);
  assert.equal(p.settlement.targetResolutions.length,2);
  assert(p.settlement.targetResolutions.every(x=>x.state==='resolved'));
  assert.equal(p.settlement.completion,'complete');
  assert.equal(p.settlement.magnitude.contributionCount,1);
  assert.equal(p.settlement.magnitude.contributions[0].targetIds.length,2);
});

ok('HuaYong restores officials as targets and daymaster as result carrier',()=>{
  const j=runPillars(['乙巳','己丑','壬辰','辛丑'],'male','hua-target');
  const p=j.gong_paths.find(x=>x.type==='hua_yong');
  assert(p,'expected hua_yong path');
  assert.equal(p.execution_mode,'serial_transform');
  assert(p.settlement.targetGraph.primaryTargets.every(id=>(p.actorNodes||[]).includes(id)));
  assert(p.settlement.targetGraph.carriers.some(id=>(p.resultNodes||[]).includes(id)));
  assert(!p.settlement.targetGraph.primaryTargets.some(id=>(p.resultNodes||[]).includes(id)),'hua target must not collapse into result carrier');
});

ok('Magnitude counts ResultSignature, not relation count',()=>{
  const p=source['source-core-007'].mainline.primary;
  assert((p.relationIds||[]).length>1,'fixture needs multiple relations');
  assert.equal(p.settlement.magnitude.contributionCount,1);
  assert.equal(new Set(p.settlement.magnitude.contributions.map(x=>x.resultSignature)).size,p.settlement.magnitude.contributionCount);
  assert.notEqual(p.settlement.efficiency.class,'unknown','complete primary should receive qualitative book-structural efficiency instead of permanent unknown');
  assert.equal(p.settlement.efficiency.basis,'book_structural');
});

ok('chart-level fan does not mechanically turn path Alignment into conflicting',()=>{
  const j=source['source-core-005'];
  assert.equal(j.chart_zheng_fan.status,'fan');
  assert.notEqual(j.mainline.primary.settlement.alignment,'conflicting');
});

ok('legacy resultIntact=true cannot override Settlement impairment',()=>{
  const p=source['source-core-002'].gong_paths[0];
  assert.equal(p.validation.resultIntact,true,'fixture should expose old constant audit field');
  assert.equal(p.settlement.eligibility,'candidate');
  assert.equal(p.settlement.resultIntegrity,'impaired');
});

ok('candidate path can never become Mainline v2 primary',()=>{
  const paths=[
    {id:'A',type:'zhi_yong',rank_score:999,settlement:{eligibility:'candidate',completion:'partial',alignment:'aligned',resultIntegrity:'intact',residualTargetIds:[],efficiency:{class:'matched'},magnitude:{contributionCount:9},structureLevel:'L5'}},
    {id:'B',type:'sheng_yong',rank_score:-999,settlement:{eligibility:'valid',completion:'acting',alignment:'unknown',resultIntegrity:'unknown',residualTargetIds:[],efficiency:{class:'unknown'},magnitude:{contributionCount:1},structureLevel:'L2'}}
  ];
  const r=arbitrateMainlineV2(paths,{byId:{}},{dominant:{elements:[]}});
  assert.equal(r.primary.id,'B');
});

ok('legacy rank_score cannot decide v2.5 arbitration',()=>{
  const common={eligibility:'valid',completion:'complete',alignment:'aligned',resultIntegrity:'intact',residualTargetIds:[],efficiency:{class:'unknown'},magnitude:{contributionCount:1},structureLevel:'L3',targetResolutions:[{state:'resolved'}],controlEvidenceRelationIds:[]};
  const a={id:'A',type:'sheng_yong',rank_score:999999,settlement:{...common,operationalIntent:{action:'output'}}};
  const b={id:'B',type:'zhi_yong',rank_score:-999999,settlement:{...common,operationalIntent:{action:'control'}}};
  const r=arbitrateMainlineV2([a,b],{byId:{}},{dominant:{elements:[]}});
  assert.equal(r.primary.id,'B');
});

ok('exact-vector ties are order-invariant and preserved as co-primary',()=>{
  const settlement={eligibility:'valid',completion:'complete',alignment:'unknown',resultIntegrity:'intact',residualTargetIds:[],efficiency:{class:'unknown'},magnitude:{contributionCount:1},structureLevel:'L3',targetResolutions:[{state:'resolved'}],controlEvidenceRelationIds:[],operationalIntent:{action:'obtain'}};
  const A={id:'A',type:'he_yong',settlement:{...settlement}};
  const B={id:'B',type:'he_yong',settlement:{...settlement}};
  const r1=arbitrateMainlineV2([B,A],{byId:{}},{dominant:{elements:[]}});
  const r2=arbitrateMainlineV2([A,B],{byId:{}},{dominant:{elements:[]}});
  assert.equal(r1.primary.id,'A'); assert.equal(r2.primary.id,'A');
  assert.equal(r1.co_primary,true); assert.deepEqual([...r1.co_primary_ids].sort(),['A','B']);
  assert.deepEqual([...r2.co_primary_ids].sort(),['A','B']);
});

ok('dependency graph is exposed independently of primary arbitration',()=>{
  const j=source['source-core-008'];
  assert(Array.isArray(j.gong_dependency_graph));
});

ok('Timing State Replay carries Settlement candidate deltas without selecting a new theme',()=>{
  const j=runDate({birthday:'1990-01-02',birth_time:'12:00',gender:'male',longitude:118.752,birth_region:'安徽省宣城市'});
  const sr=j.timing?.state_replay;
  assert.equal(sr?.mode,'original_mainline_state_replay');
  assert(sr.original?.settlement);
  assert.equal(sr.original.path_id,j.mainline.primary.id);
  for(const stage of sr.snapshots||[]){
    assert.equal(stage.settlement_delta?.mode,'settlement_replay_candidate');
    assert.equal(stage.settlement_delta?.completion_before,j.mainline.primary.settlement.completion);
    assert.match(stage.settlement_delta?.note||'',/不.*新值|不伪造|候选/);
  }
});

ok('presentation exposes v2.5 settlement labels while preserving legacy presentation',()=>{
  const j=runPillars(['乙巳','己丑','壬辰','辛丑'],'male','presentation');
  const p=j.presentation;
  for(const key of ['structure_level_label','completion_label','execution_mode_label','residual_label','efficiency_label','magnitude_label','alignment_label']) assert(key in p,`missing ${key}`);
  assert.match(p.engine_note,/v2\.5 Gong Settlement/);
});

ok('compatibility status is derived from Settlement completion',()=>{
  for(const j of Object.values(source))for(const p of j.gong_paths||[]){
    if(p.settlement?.eligibility==='invalid') assert.equal(p.status,'invalid');
    if(p.settlement?.completion==='complete'&&p.settlement?.eligibility==='valid') assert.equal(p.status,'effective');
    if(['partial','acting'].includes(p.settlement?.completion)&&p.settlement?.eligibility!=='invalid') assert.equal(p.status,'conditional');
  }
});

ok('legacy rank score is audit-only and v2.5 arbitration mode is explicit',()=>{
  const j=source['source-core-001'];
  assert.equal(j.mainline.arbitration.mode,'lexicographic-v2');
  assert(j.gong_paths.some(p=>Number.isFinite(p.legacy_rank_score)),'legacy rank audit should remain available');
  assert(j.gong_paths.every(p=>p.settlement),'all standard gong paths should carry settlement');
});


ok('EdgeFunctionalState preserves semantic gates instead of bypassing them',()=>{
  const p=source['source-core-007'].mainline.primary;
  assert.equal(p.settlement.edgeFunctionalStates.length,p.relationIds.length);
  assert(p.settlement.edgeFunctionalStates.some(x=>x.role==='control'&&x.status==='active'));
  assert.equal(p.settlement.operationalIntent.action,'control');
});

ok('global Result Ledger dedups the same controlled target across multiple mechanisms/paths',()=>{
  const j=source['source-core-007'];
  const row=j.gong_result_ledger.contributions.find(x=>x.resultSignature==='control:original.year.branch');
  assert(row,'missing deduped control result');
  assert(row.sourcePathIds.length>1,'fixture should merge more than one path into the same result');
  assert.equal(j.gong_result_ledger.contributions.filter(x=>x.resultSignature==='control:original.year.branch').length,1);
});

ok('DependencyGraph uses requires only for explicit composite components',()=>{
  const j=source['source-core-008'];
  const composites=j.gong_paths.filter(x=>x.type==='composite'&&(x.componentPathIds||[]).length>=2);
  assert(composites.length>0,'fixture needs explicit composites');
  for(const e of j.gong_dependency_graph.filter(x=>x.type==='requires')){
    assert(composites.some(c=>c.componentPathIds[0]===e.fromPathId&&c.componentPathIds[1]===e.toPathId),'requires leaked from mere node overlap');
  }
});



ok('result UI consumes Settlement target graph and presentation labels',()=>{
  const html=fs.readFileSync(require.resolve('../public/result.html'),'utf8');
  assert(html.includes('settlement?.targetGraph?.primaryTargets'),'result UI must render true Settlement targets');
  assert(html.includes('pres.completion_label'),'result UI must render Settlement completion');
  assert(html.includes('pres.structure_level_label'),'result UI must render structure level');
});

ok('v2.5.5 governance freezes Settlement boundaries in machine-readable policy',()=>{
  const gov=require('../src/core/judgment/rules/governance.json');
  const registry=require('../src/core/judgment/rules/source-registry.json');
  assert.equal(gov.version,'2.5.5'); assert.equal(registry.version,'2.5.3');
  const text=(gov.hard_rules||[]).join('\n');
  for(const phrase of ['RelationSemantic','Completion、Efficiency、Magnitude、Ownership','ResultSignature','candidate','co-primary','State Replay']) assert(text.includes(phrase),`missing governance boundary: ${phrase}`);
});



ok('v2.5 professional judgment UI exposes the full Settlement dashboard',()=>{
  const html=fs.readFileSync(require.resolve('../public/result.html'),'utf8');
  for(const id of ['judgeSettlementMetrics','judgeTargetResolution','judgeResultLedger','judgeTargetGraphRoles','judgeMainlineStack','judgeDependencySummary']){
    assert(html.includes(`id="${id}"`),`missing professional UI node ${id}`);
  }
  for(const token of ['renderJudgeSettlement','targetResolutions','residualTargetIds','resultIntegrity','gong_result_ledger','gong_dependency_graph']){
    assert(html.includes(token),`professional UI does not consume ${token}`);
  }
});

ok('professional timing UI renders v2.5 Settlement Replay deltas',()=>{
  const html=fs.readFileSync(require.resolve('../public/result.html'),'utf8');
  assert(html.includes('id="proSettlementDelta"'));
  assert(html.includes('renderProSettlementDelta(timing)'));
  for(const token of ['executor_state','control_edge_state','target_state','completion_after_candidate','residual_change_candidate','ownership_after_candidate','alignment_after_candidate']) assert(html.includes(token),`missing timing delta ${token}`);
});

ok('professional UI keeps v2.5 technical detail readable instead of fake percentages',()=>{
  const html=fs.readFileSync(require.resolve('../public/result.html'),'utf8');
  assert(html.includes('逐节点结算，不用整体布尔值'));
  assert(html.includes('不按关系数量计功'));
  assert(!html.includes('judgeSettlementPercent'));
  assert(html.includes('font-size:13px;line-height:19px;font-weight:750'));
});

console.log(`\nv2.5 Gong Settlement regression passed: ${passed}/${passed}`);
