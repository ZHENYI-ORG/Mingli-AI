'use strict';
const assert=require('node:assert/strict');
const {computePaipan}=require('../dist/api');
const {resolveStageZhengFan}=require('../dist/core/judgment/v25/StageZhengFan');

function runPillars(pillars,name='zf252'){
  const [year,month,day,hour]=pillars;
  const r=computePaipan({name,gender:'male',input_mode:'pillars',direct_pillars:{year,month,day,hour}});
  assert.equal(r.ok,true,r.message||name);return r.data.blind_judgment;
}
let n=0;const ok=(name,fn)=>{fn();n++;console.log('✓ '+name)};
const gold=[
  [['辛亥','丙申','己丑','甲戌'],'fan'],[['乙巳','庚辰','辛卯','丙申'],'fan'],[['甲辰','戊辰','癸卯','己未'],'zheng'],[['戊辰','壬戌','丁丑','丁未'],'zheng'],
  [['丙子','戊戌','丁丑','丁未'],'fan'],[['癸未','丙辰','戊戌','丙辰'],'fan'],[['壬寅','戊申','辛巳','戊戌'],'fan'],[['辛卯','丙申','辛未','癸巳'],'zheng'],
  [['己巳','壬申','己未','乙丑'],'fan'],[['戊申','丁巳','戊子','戊午'],'fan'],[['丁未','癸丑','丙申','辛卯'],'zheng']
];
ok('ChartZhengFan V2 preserves all 11 frozen direction gold cases',()=>{
  for(let i=0;i<gold.length;i++){
    const j=runPillars(gold[i][0],`zf-gold-${i+1}`);
    assert.equal(j.chart_zheng_fan.mode,'chart_zheng_fan_v2_settlement');
    assert.equal(j.chart_zheng_fan.status,gold[i][1]);
    assert.equal(j.chart_zheng_fan.direction_context.status,gold[i][1]);
    assert.equal(j.chart_zheng_fan.major_conclusion_allowed,false);
    assert.equal(j.chart_zheng_fan.event_conclusion_allowed,false);
    assert(j.chart_zheng_fan.original_intent_graph);
    assert(Array.isArray(j.chart_zheng_fan.axes));
  }
});
ok('ChartZhengFan V2 intent graph is settlement-aware when a primary exists',()=>{
  const j=runPillars(['壬子','丙午','己巳','辛未'],'zf-intent-graph');
  const g=j.chart_zheng_fan.original_intent_graph;
  if(j.mainline.primary?.type!=='xiang_fallback'){
    assert.equal(g.primaryPathId,j.mainline.primary.id);
    assert.deepEqual(g.targetNodeIds,j.mainline.primary.settlement.targetGraph.primaryTargets);
    assert.equal(g.completion,j.mainline.primary.settlement.completion);
    assert.deepEqual(g.controlRelationIds,j.mainline.primary.settlement.controlEvidenceRelationIds);
  }
});
ok('partial completion never becomes fan merely because residual exists',()=>{
  const j=runPillars(['甲寅','乙亥','己丑','甲子'],'zf-partial-not-auto-fan');
  const axes=j.chart_zheng_fan.axes||[];
  const partial=axes.find(x=>x.id==='ZF2-RESULT-PARTIAL');
  if(partial) assert.equal(partial.direction,'neutral');
});

function stage(base,snapshot){return resolveStageZhengFan({status:base,confidence:'high'}, {state_replay:{available:true,snapshots:[{stage:'dayun',changes:[],settlement_delta:{executor_state:'maintained',control_edge_state:'maintained',target_state:'maintained',...snapshot}}]}}).dayun;}
ok('zheng + broken original control edge => stage fan',()=>{
  const r=stage('zheng',{control_edge_state:'impaired_candidate',integrity_after_candidate:'impaired_or_broken_candidate'});
  assert.equal(r.status,'fan');assert(r.conflict_axes.includes('STAGE-CONTROL-EDGE-IMPAIRED'));
});
ok('zheng + support and hard conflict => partial_fan',()=>{
  const out=resolveStageZhengFan({status:'zheng',confidence:'high'}, {state_replay:{available:true,snapshots:[{stage:'dayun',changes:[{type:'actor_capacity_changed',role:'actor',detail:'actor strengthened'},{type:'original_combine_released_candidate',role:'target',detail:'combine released'}],settlement_delta:{executor_state:'changed_candidate',control_edge_state:'impaired_candidate',target_state:'disturbed_candidate',integrity_after_candidate:'impaired_or_broken_candidate'}}]}}).dayun;
  assert.equal(out.status,'partial_fan');
});
ok('fan + support only => repair_candidate, not automatic zheng',()=>{
  const r=stage('fan',{executor_state:'changed_candidate',target_state:'engaged_candidate'});
  assert.equal(r.status,'repair_candidate');
});
ok('fan + conflict only => maintained_fan',()=>{
  const r=stage('fan',{control_edge_state:'impaired_candidate',target_state:'disturbed_candidate'});
  assert.equal(r.status,'maintained_fan');
});
ok('unclear + hard control-edge conflict may become structural fan candidate only',()=>{
  const r=stage('unclear',{control_edge_state:'impaired_candidate'});
  assert.equal(r.status,'fan');assert.equal(r.event_conclusion_allowed,false);assert.equal(r.major_conclusion_allowed,false);
});
ok('StageZhengFan exposes all three timing stages without changing theme',()=>{
  const timing={state_replay:{available:true,snapshots:['dayun','liunian','liuyue'].map(stage=>({stage,changes:[],settlement_delta:{executor_state:'maintained',control_edge_state:'maintained',target_state:'maintained',completion_before:'complete',completion_after_candidate:'complete',residual_change_candidate:'unchanged_candidate',integrity_after_candidate:'intact',ownership_after_candidate:'unchanged_candidate',alignment_after_candidate:'unchanged_candidate'}}))}};
  const r=resolveStageZhengFan({status:'zheng',confidence:'medium'},timing);
  assert.equal(r.available,true);assert.equal(r.snapshots.length,3);assert.equal(r.dayun.status,'maintained_zheng');assert.equal(r.liunian.status,'maintained_zheng');assert.equal(r.liuyue.status,'maintained_zheng');
});
ok('real date/API timing exposes stage_zheng_fan when a replayable primary exists',()=>{
  const r=computePaipan({birthday:'1995-11-05',birth_time:'00:00',gender:'male',use_true_solar_time:true,longitude:119.186466,timezone_id:'Asia/Shanghai',birth_region:'安徽省宣城市郎溪县'});
  assert.equal(r.ok,true,r.message||'date');const j=r.data.blind_judgment;
  assert.match(j.engine_version,/^2\.5\.(2-zhengfan-v2|3-book-audited|4-book-validated|5-algorithm-correction)$/);
  assert(j.chart_zheng_fan?.mode==='chart_zheng_fan_v2_settlement');
  assert(j.timing?.stage_zheng_fan,'missing stage_zheng_fan');
  if(j.timing.state_replay?.available) assert.equal(j.timing.stage_zheng_fan.available,true);
});
console.log(`v2.5.2 ZhengFan V2 regression passed: ${n}/${n}`);
