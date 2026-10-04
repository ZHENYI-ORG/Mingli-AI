'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {computePaipan}=require('../dist/api');
const {annotateBookEntry,resolveGongRoles}=require('../dist/core/judgment/v25/BookMethodEngine');

function runPillars(pillars,name='book-audit'){
  const [year,month,day,hour]=pillars;
  const r=computePaipan({name,gender:'male',input_mode:'pillars',direct_pillars:{year,month,day,hour}});
  assert.equal(r.ok,true,`${name}: ${r.message||'paipan failed'}`);
  return r.data.blind_judgment;
}
let n=0;const ok=(name,fn)=>{fn();n++;console.log('✓ '+name)};

ok('v2.5.5 exposes book_method and algorithm-correction engine version',()=>{
  const j=runPillars(['壬寅','戊申','戊子','丙辰'],'book-layer');
  assert.match(j.engine_version,/^2\.5\.5-algorithm-correction$/);
  assert(j.book_method?.entry&&j.book_method?.party&&j.book_method?.gong_roles);
});

ok('guest/host is explicit hierarchy, not only a floating weight',()=>{
  const j=runPillars(['壬寅','戊申','戊子','丙辰'],'guest-host');
  assert.equal(j.guest_host.mode,'book_hierarchical_guest_host_v1');
  assert.equal(j.guest_host.nodeStates['original.year.branch'].bookSide,'guest');
  assert.equal(j.guest_host.nodeStates['original.day.branch'].bookSide,'host');
  assert.equal(j.guest_host.nodeStates['original.month.branch'].gongSide,'host_proxy_by_day_party');
  assert.equal(j.guest_host.nodeStates['original.month.branch'].bookSide,'guest');
});

ok('four absolutes are structured B-grade facts but never automatic major work',()=>{
  const j=runPillars(['甲寅','癸酉','戊子','甲寅'],'absolute');
  const rows=j.relations.filter(r=>r.type==='absolute');
  assert(rows.length>=1);assert(rows.every(r=>r.evidence_grade==='B'&&r.major_conclusion_allowed===false));
  assert(j.relation_semantics.filter(x=>rows.some(r=>r.id===x.relationId)).every(x=>x.gate==='conditional'));
});

ok('non-core common break and self-punishment remain explicit B candidates',()=>{
  const b=runPillars(['甲寅','癸酉','戊子','甲寅'],'break-candidate');
  assert(b.relations.some(r=>r.type==='break_candidate'&&r.evidence_grade==='B'&&r.status==='candidate'));
  const s=runPillars(['壬辰','壬子','戊辰','辛酉'],'self-punish-candidate');
  assert(s.relations.some(r=>r.type==='self_punish_candidate'&&r.evidence_grade==='B'&&r.major_conclusion_allowed===false));
});

ok('dry earth brittle metal overrides ordinary earth-generates-metal',()=>{
  const j=runPillars(['辛未','丁酉','戊子','丙辰'],'dry-earth');
  const y='original.year.branch',m='original.month.branch';
  assert(j.relations.some(r=>r.type==='brittle_control'&&r.direction===`${y}>${m}`));
  assert(!j.relations.some(r=>r.type==='generate'&&r.direction===`${y}>${m}`));
});

ok('wet earth does not mechanically control water and can dampen fire',()=>{
  const w=runPillars(['壬辰','壬子','丁巳','庚戌'],'wet-water');
  assert(!w.relations.some(r=>r.type==='control'&&r.direction==='original.year.branch>original.month.branch'));
  const f=runPillars(['壬辰','乙巳','戊子','壬戌'],'wet-fire');
  assert(f.relations.some(r=>r.type==='dampen_fire'&&r.direction==='original.year.branch>original.month.branch'));
});

ok('conditional self-combine requires clash/punish while stable/research levels stay separate',()=>{
  const no=runPillars(['甲子','乙亥','丙戌','丁酉'],'conditional-self-no');
  assert(no.relations.some(r=>r.type==='stem_branch_combine_candidate'&&r.self_combine_mode==='requires_clash_or_punish'&&r.evidence_grade==='A'));
  const yes=runPillars(['戊辰','癸亥','丙戌','丁酉'],'conditional-self-yes');
  assert(yes.relations.some(r=>r.type==='stem_branch_combine'&&r.self_combine_mode==='opened_by_clash_or_punish'));
  const b=runPillars(['甲子','乙亥','戊辰','辛酉'],'research-self');
  assert(b.relations.some(r=>r.type==='stem_branch_combine_candidate'&&r.self_combine_mode==='research_only'&&r.evidence_grade==='B'));
});

ok('dynamic Ti/Yong is attached to each enumerated gong path',()=>{
  const j=runPillars(['壬寅','戊申','戊子','丙辰'],'tiyong');
  assert(j.gong_paths.length>0);
  for(const p of j.gong_paths){assert.equal(p.dynamic_tiyong?.mode,'path_contextual_tiyong_v1');assert(Array.isArray(p.dynamic_tiyong.nodes));}
});

ok('day-stem output is only an entry intent when downstream output work exists',()=>{
  const facts={dayMasterNodeId:'DM',dayBranchNodeId:'DB',byId:{DM:{id:'DM',tenGod:'日元'},DB:{id:'DB'},O:{id:'O',tenGod:'伤官'},W:{id:'W',tenGod:'正财'}}};
  const rel=[{id:'R1',type:'generate',nodes:['DM','O']}];
  const paths=[
    {id:'raw',type:'xie_yong',actorNodes:['DM'],targetNodes:['O'],relationIds:['R1'],settlement:{eligibility:'valid',completion:'complete'}},
    {id:'down',type:'sheng_yong',actorNodes:['O'],targetNodes:['W'],relationIds:[],settlement:{eligibility:'valid',completion:'complete'}}
  ];
  const a=annotateBookEntry(paths,facts,rel);
  assert.equal(a.annotations.down.kind,'day_stem_output_downstream');
  assert(a.annotations.down.tier>a.annotations.raw.tier);
});

ok('primary and auxiliary gongshen are programmatically separated',()=>{
  const paths=[
    {id:'P1',leadActorNodes:['A'],actorNodes:['A'],targetNodes:['T'],resultNodes:['T'],settlement:{eligibility:'valid',completion:'complete'}},
    {id:'P2',actorNodes:['B'],targetNodes:['A'],resultNodes:['A'],settlement:{eligibility:'valid',completion:'complete'}}
  ];
  const facts={dayMasterNodeId:'DM',nodes:[{id:'DM',visibility:'visible'},{id:'A',visibility:'visible'},{id:'B',visibility:'visible'},{id:'T',visibility:'visible'}]};
  const g=resolveGongRoles(paths,{primary:{id:'P1'},co_primary_ids:['P1']},facts);
  assert.deepEqual(g.primary_gongshen,['A']);assert.deepEqual(g.auxiliary_gongshen,['B']);
});

ok('ChartZhengFan exposes independent candidate and explicit source governance with no hidden guard',()=>{
  const j=runPillars(['辛亥','丙申','己丑','甲戌'],'zf-governance');
  const z=j.chart_zheng_fan;
  assert.equal(z.mode,'chart_zheng_fan_v2_settlement');assert.equal(z.version,'v2.5.4-chart-first');
  assert('candidate_status' in z&&'source_disagreement' in z);
  assert(!z.axes.some(x=>x.id==='ZF2-SOURCE-GOLD-GUARD'));
  assert(z.axes.some(x=>x.id==='ZF2-SOURCE-GOVERNANCE'));
});

ok('completion is neutral in chart-level direction and cannot itself create zheng',()=>{
  const j=runPillars(['壬子','丙午','己巳','辛未'],'zf-completion');
  const a=j.chart_zheng_fan.axes.find(x=>x.id==='ZF2-RESULT-COMPLETE-NEUTRAL');
  if(a){assert.equal(a.direction,'neutral');assert.equal(a.weight,0);}
  assert(!j.chart_zheng_fan.axes.some(x=>x.id==='ZF2-RESULT-COMPLETED'));
});

ok('stage replay keeps cumulative audit but current-stage delta only consumes current layer',()=>{
  const r=computePaipan({birthday:'1995-11-05',birth_time:'00:00',gender:'male',use_true_solar_time:true,longitude:119.186466,timezone_id:'Asia/Shanghai',birth_region:'安徽省宣城市郎溪县'});
  assert.equal(r.ok,true,r.message||'date');const sr=r.data.blind_judgment.timing?.state_replay;
  if(sr?.available){
    for(const s of sr.snapshots||[]){
      assert.equal(s.settlement_delta?.scope,'stage_delta');
      for(const c of s.stage_changes||[]) if(c.layer) assert.equal(c.layer,s.stage);
      assert((s.cumulative_changes||[]).length>=(s.stage_changes||[]).length);
    }
  }
});

ok('book rule registry is machine-readable and carries production/candidate separation',()=>{
  const reg=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/core/judgment/rules/book-rule-registry.json'),'utf8'));
  assert.equal(reg.version,'2.5.5-algorithm-correction');assert(reg.rules.length>=25);
  assert(reg.rules.some(r=>r.status==='candidate'));assert(reg.rules.some(r=>String(r.status).startsWith('production')));
});


ok('source examples expose 官统财 and the controlled pivot path wins over local ordinary flow',()=>{
  for(const ps of [
    ['己巳','戊辰','乙巳','庚辰'],
    ['戊午','己未','乙亥','庚辰'],
    ['甲子','丁卯','癸卯','戊午']
  ]){
    const j=runPillars(ps,'unified-official-wealth');
    const u=j.book_method?.unified_structures?.structures?.find(x=>x.type==='official_unifies_wealth');
    assert(u&&u.status==='formed');
    assert(u.sourceNodeIds.length>=2);
    assert(u.controlPathIds.includes(j.mainline.primary?.id));
    assert.equal(j.mainline.primary?.unified_structure?.type,'official_unifies_wealth');
  }
});

ok('ordinary output-generates-wealth does not falsely mean the wealth pivot is controlled',()=>{
  const j=runPillars(['甲子','乙亥','丙寅','壬辰'],'unified-no-false-control');
  for(const u of j.book_method?.unified_structures?.structures||[]){
    if(u.type==='wealth_unifies_output'&&!u.nativeHostPivot) assert((u.controlPathIds||[]).length>0);
  }
});

ok('one path may retain multiple unified structures without last-write overwrite',()=>{
  const j=runPillars(['己巳','戊辰','乙巳','庚辰'],'unified-array');
  for(const p of j.gong_paths||[]){
    if((p.unified_structures||[]).length){
      assert.equal(p.unified_structure?.id,p.unified_structures[0].id);
      const sizes=p.unified_structures.map(x=>(x.sourceNodeIds||[]).length);
      assert.deepEqual(sizes,[...sizes].sort((a,b)=>b-a));
    }
  }
});

ok('relation semantics expose book adjudication families instead of collapsing combine/clash into one meaning',()=>{
  const j=runPillars(['壬子','丙午','己巳','甲戌'],'semantic-family');
  const combine=j.relation_semantics.find(x=>x.book_adjudication?.family==='combine');
  const clash=j.relation_semantics.find(x=>x.book_adjudication?.family==='clash');
  assert(combine&&combine.book_adjudication.alternatives.length>=3);
  assert(clash&&clash.book_adjudication.alternatives.length>=4);
  assert.equal(combine.book_adjudication.selection_status,'context_required');
});

ok('catcher-thief structure now yields qualitative efficiency without fake percentages',()=>{
  const j=runPillars(['壬寅','戊申','戊子','丙辰'],'efficiency-book-qualitative');
  assert(j.book_method?.control_fields);
  for(const p of j.gong_paths||[]){
    if(p.control_field?.utilization&&p.control_field.utilization!=='unknown'&&p.settlement?.completion==='complete'){
      assert.notEqual(p.settlement?.efficiency?.class,'unknown');
      assert.equal(p.settlement?.efficiency?.basis,'book_structural');
      assert(!/%/.test((p.settlement?.efficiency?.evidence||[]).join(' ')),'efficiency must remain qualitative, not a fake percentage');
    }
  }
});

ok('book efficiency gold: He Shen one catcher controls two officials => high utilization',()=>{
  const j=runPillars(['庚午','乙酉','庚子','壬午'],'efficiency-heshen');
  assert.match(String(j.mainline.primary?.title||''),/制官|成势制官/);
  assert.equal(j.mainline.primary?.settlement?.efficiency?.grade,'high');
  assert.equal(j.mainline.primary?.settlement?.efficiency?.class,'matched');
});

ok('book efficiency gold: excessive output with too little official stays a low-efficiency control, not a high-efficiency tomb work',()=>{
  const j=runPillars(['丁亥','壬子','庚辰','壬午'],'efficiency-too-many-catchers');
  assert.equal(j.mainline.primary?.type,'zhi_yong');
  assert.match(String(j.mainline.primary?.title||''),/制官/);
  assert.equal(j.mainline.primary?.settlement?.efficiency?.grade,'low');
  assert.equal(j.mainline.primary?.settlement?.efficiency?.class,'underutilized');
  const badTomb=(j.gong_paths||[]).find(p=>p.type==='mu_yong'&&(p.targetNodes||[]).length>=2);
  if(badTomb) assert.notEqual(badTomb.settlement?.eligibility,'valid','tool storage must not outrank the actual control work');
});

ok('standard he_yong is restricted to day stem/day branch, never hour or host-weight proxy actors',()=>{
  for(const pillars of [['癸巳','壬戌','庚申','乙酉'],['戊申','己未','癸巳','己未'],['壬申','己酉','癸巳','辛酉']]){
    const j=runPillars(pillars,'he-yong-scope-'+pillars.join(''));
    for(const p of (j.gong_paths||[]).filter(x=>x.type==='he_yong')){
      assert(['original.day.stem','original.day.branch'].includes(p.actorNodes?.[0]),`unexpected he_yong actor ${p.actorNodes?.[0]}`);
      assert(!/^主位合/.test(String(p.title||'')),'generic 主位合 title should not hide the real day-stem/day-branch actor');
    }
  }
});


ok('wood life/death and water nature are machine-auditable without auto health conclusions',()=>{
  const y=runPillars(['癸未','乙卯','甲子','己巳'],'wood-yuefei');
  const dm=y.book_method.special_nature_profiles.wood_profiles.find(x=>x.nodeId==='original.day.stem');
  assert(dm);assert.equal(dm.status,'dead_wood_candidate');assert(dm.rootNodeIds.length>0);assert.equal(dm.strongWaterEvidence.length,0);assert.equal(dm.major_conclusion_allowed,false);
  const live=runPillars(['辛亥','己亥','乙卯','丁亥'],'wood-live').book_method.special_nature_profiles.wood_profiles.find(x=>x.nodeId==='original.day.stem');
  assert(live);assert.equal(live.status,'live_wood');assert(live.strongWaterEvidence.length>0);
});

ok('Si dual nature is recalculated from structure instead of permanently treated as fire',()=>{
  const fire=runPillars(['己未','癸酉','丁巳','丁未'],'si-fire').book_method.special_nature_profiles.si_profiles.find(x=>x.nodeId==='original.day.branch');
  assert(fire);assert.equal(fire.status,'fire_mode_candidate');
  const metal=runPillars(['辛酉','己亥','丁巳','辛丑'],'si-metal').book_method.special_nature_profiles.si_profiles.find(x=>x.nodeId==='original.day.branch');
  assert(metal);assert.equal(metal.status,'metal_assimilation_candidate');
});

ok('piercing/punish/absolute directional techniques enter GongPath only as governed candidates',()=>{
  const h=runPillars(['甲寅','辛未','戊子','庚申'],'piercing-candidate');
  const hp=h.gong_paths.filter(x=>x.actionMode==='piercing_control_candidate');
  assert(hp.length>=1);assert(hp.every(x=>x.settlement?.eligibility==='candidate'&&x.major_conclusion_allowed===false));
  const p=runPillars(['乙丑','丙戌','戊戌','壬戌'],'punish-candidate');
  const pp=p.gong_paths.filter(x=>x.ruleId==='GONG-PUNISH-CANDIDATE-001');
  assert(pp.length>=1);assert(pp.every(x=>x.settlement?.eligibility!=='valid'));
  const a=runPillars(['甲寅','癸酉','戊子','庚申'],'absolute-gong-candidate');
  const ap=a.gong_paths.filter(x=>x.ruleId==='GONG-ABSOLUTE-CANDIDATE-001');
  assert(ap.every(x=>x.settlement?.eligibility!=='valid'));
});


ok('source-gated clash_take restores host-body vs guest-use without stealing ordinary clash-control',()=>{
  const j=runPillars(['丁酉','戊申','丁卯','丙午'],'clash-take-positive');
  const p=j.gong_paths.find(x=>x.actionMode==='clash_take'&&x.title==='偏印冲偏财');
  assert(p);assert.equal(p.status,'effective');assert.equal(p.settlement?.eligibility,'valid');assert.equal(p.gongDirection,'forward');
  assert.equal(j.mainline.primary?.actionMode,'clash_take');assert.equal(j.mainline.primary?.title,'偏印冲偏财');
  const ordinary=runPillars(['壬寅','戊申','戊子','丙辰'],'clash-control-not-stolen');
  assert.equal(ordinary.mainline.primary?.title,'食伤制杀');assert.equal(ordinary.mainline.primary?.actionMode,'clash_control');
});

ok('seven-kill clashing day-lu anti-example cannot be reversed into clash_take',()=>{
  const j=runPillars(['癸卯','庚申','甲寅','辛未'],'clash-take-anti-lu');
  assert.equal(j.gong_paths.some(x=>x.actionMode==='clash_take'),false);
  assert.equal(j.mainline.primary?.type,'xiang_fallback');
});

ok('core-book piercing can become production wear_control only through path-specific source gate',()=>{
  const j=runPillars(['丁未','辛亥','戊子','庚申'],'wear-control-linbiao');
  const p=j.gong_paths.find(x=>x.actionMode==='wear_control'&&x.actorNodes.includes('original.day.branch')&&x.targetNodes.includes('original.year.branch'));
  assert(p);assert.equal(p.title,'财制比劫');assert.equal(p.status,'effective');assert.equal(p.settlement?.eligibility,'valid');
  assert.equal(p.execution_mode,'penetration_assisted_control');
  assert(p.settlement?.edgeFunctionalStates?.some(x=>p.relationIds.includes(x.relationId)&&x.status==='active'&&x.semanticGate==='passed'));
  const rel=p.relationIds.map(id=>j.relations.find(r=>r.id===id)).filter(Boolean);assert(rel.some(r=>r.type==='harm'));
});

ok('yang-ren/peer piercing wealth without restraint is never fabricated as successful taking',()=>{
  const j=runPillars(['戊辰','甲子','甲辰','丁卯'],'wear-control-yangren-gate');
  const rows=j.gong_paths.filter(x=>x.actionMode==='wear_control'||x.actionMode==='piercing_control_candidate');
  assert(rows.every(p=>!(p.status==='effective'&&p.actorNodes?.some(id=>j.facts?.byId?.[id]?.char==='卯')&&p.targetNodes?.some(id=>j.facts?.byId?.[id]?.char==='辰'))));
  assert.notEqual(j.mainline.primary?.actionMode,'wear_control');
});

ok('book gold: Yue Fei keeps global wood-fire intent but first work is the source-gated wear control of the day-seat resource',()=>{
  const j=runPillars(['癸未','乙卯','甲子','己巳'],'book-gold-yuefei');
  assert.equal(j.mainline.primary?.actionMode,'wear_control');
  assert.match(String(j.mainline.primary?.title||''),/羊刃库制印|制印/);
  assert.equal(j.mainline.primary?.settlement?.eligibility,'valid');
});

ok('book gold: 食神入未官墓 remains the first work instead of a local piercing relation',()=>{
  const j=runPillars(['己未','癸酉','壬寅','庚子'],'book-gold-food-tomb');
  assert.equal(j.mainline.primary?.type,'mu_yong');
  assert.match(String(j.mainline.primary?.title||''),/食神入未墓/);
  assert.equal(j.mainline.primary?.settlement?.eligibility,'valid');
});

ok('book gold: fire-dry-earth party can outrank a local day-stem combine when the party has a real external control connector',()=>{
  const j=runPillars(['戊申','己未','癸巳','己未'],'book-gold-fire-dry');
  assert.equal(j.mainline.primary?.actionMode,'book_party_control');
  assert.match(String(j.mainline.primary?.title||''),/^火燥土成势制/);
  assert.notEqual(j.mainline.primary?.title,'主位合财');
});

ok('book gold: metal-water party controls day-seat wealth through a real combine connector',()=>{
  const j=runPillars(['壬申','己酉','癸巳','辛酉'],'book-gold-metal-water');
  assert.equal(j.mainline.primary?.actionMode,'book_party_control');
  assert.match(String(j.mainline.primary?.title||''),/^金水成势制财$/);
});

ok('book gold: local 乙财合庚 cannot steal the mainline from the chart-level metal-water work',()=>{
  const j=runPillars(['癸巳','壬戌','庚申','乙酉'],'book-gold-combine-not-main');
  assert.match(String(j.mainline.primary?.title||''),/^金水成势制/);
  assert.notEqual(j.mainline.primary?.title,'主位合财');
});

ok('strong independently cross-confirmed global work outranks local multi-target noise, while weak engineering party cannot outrank a true multi-target tomb closure',()=>{
  const strong=runPillars(['丁亥','庚戌','己巳','庚午'],'arbiter-strong-global');
  assert.match(String(strong.mainline.primary?.title||''),/成势制财/);
  assert((strong.mainline.arbitration?.primary_vector?.confirmedGlobalWork||0)>0);
  const weak=runPillars(['乙巳','己丑','壬辰','辛丑'],'arbiter-weak-party-vs-tomb');
  assert.equal(weak.mainline.primary?.type,'mu_yong');
  assert.match(String(weak.mainline.primary?.title||''),/2处正官入辰墓/);
  assert.equal(weak.mainline.arbitration?.primary_vector?.confirmedGlobalWork,0);
});


ok('book-party brittle/dampen control has a real execution mode instead of false unknown',()=>{
  for(const ps of [
    ['丙辰','癸巳','庚戌','乙酉'],
    ['丙辰','辛丑','丁酉','庚戌']
  ]){
    const j=runPillars(ps,'special-party-execution');
    assert.equal(j.mainline.primary?.actionMode,'book_party_control');
    assert.equal(j.mainline.primary?.settlement?.executionMode,'formation_control');
  }
});

ok('composite parent cannot become formal primary when its component paths are only candidates',()=>{
  const j=runPillars(['丁丑','壬寅','甲戌','乙丑'],'composite-child-gate');
  assert.notEqual(j.mainline.primary?.type,'composite');
  for(const p of j.gong_paths.filter(x=>x.type==='composite'&&x.compositeComponentsComplete===false)){
    assert.equal(p.settlement?.eligibility,'candidate');
  }
});

console.log(`v2.5.5 algorithm-correction book-audit regression passed: ${n}/${n}`);
