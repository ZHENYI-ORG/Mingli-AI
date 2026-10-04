'use strict';
const assert = require('node:assert/strict');
const { BlindJudgmentEngine } = require('../dist/core/judgment/BlindJudgmentEngine');
const { computePaipan } = require('../dist/api');

const engine = new BlindJudgmentEngine();
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

function fakeChart(stems=['乙','辛','甲','己'], branches=['子','丑','寅','卯']) {
  const pk=['year','month','day','hour'];
  const bp={};
  pk.forEach((p,i)=>bp[`${p}_pillar`]={heavenly_stem:stems[i],earthly_branch:branches[i]});
  return {
    input_mode:'pillars', bazi:bp,
    shi_shen:{year_stem:'劫财',month_stem:'正官',day_stem:'日元',hour_stem:'正财',year_branch:'正印',month_branch:'偏财',day_branch:'比肩',hour_branch:'劫财'},
    hidden_stems:{year:[{stem:'癸',label:'本气',element:'水',shi_shen:'正印'}],month:[{stem:'己',label:'本气',element:'土',shi_shen:'正财'}],day:[{stem:'甲',label:'本气',element:'木',shi_shen:'比肩'}],hour:[{stem:'乙',label:'本气',element:'木',shi_shen:'劫财'}]},
    da_yun:[]
  };
}

test('普通日期排盘会附带盲派判盘结果', () => {
  const r=computePaipan({name:'回归A',gender:'male',birthday:'1990-01-01',birth_time:'12:00',longitude:120,birth_region:'杭州',is_lunar:false});
  assert.equal(r.ok,true);
  assert.ok(r.data.blind_judgment);
  assert.ok(r.data.blind_judgment.presentation.title);
  assert.ok(Array.isArray(r.data.blind_judgment.evidence));
});

test('女命普通日期同样可稳定生成', () => {
  const r=computePaipan({name:'回归B',gender:'female',birthday:'2000-05-12',birth_time:'08:30',longitude:121.47,birth_region:'上海',is_lunar:false});
  assert.equal(r.ok,true);
  assert.ok(r.data.blind_judgment.mainline.primary);
});

test('四柱直排缺年份时不虚构当前岁运', () => {
  const r=computePaipan({name:'直排',gender:'male',input_mode:'pillars',direct_pillars:{year:'己巳',month:'丙子',day:'丙寅',hour:'甲午'}});
  assert.equal(r.ok,true);
  assert.equal(r.data.blind_judgment.timing.available,false);
  assert.match(r.data.blind_judgment.timing.note,/不虚构|不参与/);
});

test('乙辛不被错误识别为天干五合，甲己会识别', () => {
  const j=engine.analyze(fakeChart());
  const rs=j.relations.filter(x=>x.type==='stem_combine');
  const chars=rs.map(r=>r.nodes.map(id=>j.facts.nodes.find(n=>n.id===id)?.char).join(''));
  assert.ok(chars.includes('甲己') || chars.includes('己甲'));
  assert.ok(!chars.includes('乙辛') && !chars.includes('辛乙'));
});

test('原局冲墓不会直接被写成开库', () => {
  const c=fakeChart(['甲','丙','戊','庚'],['辰','戌','子','午']);
  const j=engine.analyze(c);
  const clashIds=j.relations.filter(r=>r.type==='clash' && r.nodes.some(id=>j.facts.nodes.find(n=>n.id===id)?.char==='辰') && r.nodes.some(id=>j.facts.nodes.find(n=>n.id===id)?.char==='戌')).map(r=>r.id);
  const sem=j.relation_semantics.filter(s=>clashIds.includes(s.relationId));
  assert.ok(sem.length>0);
  assert.ok(sem.every(s=>s.semantic!=='store_open'));
});

test('所有路径都有明确状态，做功不会用布尔值粗暴表示', () => {
  const j=engine.analyze(fakeChart());
  const allowed=new Set(['effective','conditional','intent_only','broken','invalid']);
  assert.ok(j.gong_paths.every(p=>allowed.has(p.status)));
});

test('成果归属只使用四态枚举', () => {
  const j=engine.analyze(fakeChart());
  const allowed=new Set(['mostly_native','shared','mostly_external','unclear']);
  assert.ok(j.gong_paths.every(p=>allowed.has(p.ownership.result)));
});

test('同一命盘重复运行第一主线稳定', () => {
  const c=fakeChart();
  const a=engine.analyze(c), b=engine.analyze(c);
  assert.equal(a.mainline.primary?.title,b.mainline.primary?.title);
  assert.equal(a.mainline.primary?.type,b.mainline.primary?.type);
  assert.equal(a.mainline.primary?.ownership?.result,b.mainline.primary?.ownership?.result);
});

test('关系事实与关系语义分层输出', () => {
  const j=engine.analyze(fakeChart());
  assert.ok(j.relations.length>0);
  assert.ok(Array.isArray(j.relation_semantics));
  const generated=j.relations.find(r=>r.type==='generate');
  if(generated)assert.ok(j.relation_semantics.some(s=>s.relationId===generated.id&&s.semantic==='generate_flow'));
});

test('节点来源与根气分开记录', () => {
  const j=engine.analyze(fakeChart());
  assert.ok(Array.isArray(j.origins));
  const dayOrigin=j.origins.find(x=>x.nodeId==='original.day.stem');
  assert.ok(dayOrigin);
  assert.ok(Object.hasOwn(dayOrigin,'sourceSide'));
  assert.ok(Array.isArray(j.roots));
});

test('做功层级使用 L0-L5 序位而非财富金额', () => {
  const j=engine.analyze(fakeChart());
  const allowed=new Set(['L0','L1','L2','L3','L4','L5']);
  assert.ok(j.gong_paths.every(p=>allowed.has(p.gong_level)));
  assert.ok(!JSON.stringify(j).match(/百万级|千万级|亿级|厅级|省部级/));
});

test('主线证据可追溯到规则 ID', () => {
  const j=engine.analyze(fakeChart());
  const main=j.evidence.find(e=>e.type==='mainline');
  if(j.mainline.primary){
    assert.ok(main);
    assert.ok(main.rule_ids.includes('MAINLINE-ARBITER-001'));
    assert.ok(main.rule_ids.some(x=>String(x).startsWith('GONG-')));
  }
});



test('大运后五年流年天干冲非当运运干会重新引动', () => {
  const r=computePaipan({gender:'male',birthday:'1950-06-15',birth_time:'12:00',use_true_solar_time:false});
  assert.equal(r.ok,true,r.message||'timing clash source failed');
  const j=engine.analyze(r.data,{now:'1992-12-30T04:00:00Z'});
  assert.equal(j.timing.dayun.pillar,'丙戌');
  assert.equal(j.timing.dayun.active_component,'branch');
  assert.ok(j.timing.triggers.some(x=>x.type==='cross_phase_activate'&&x.relation==='clash'&&/重新引动丙运/.test(x.detail)));
});

test('岁运关系以结构化 luck_relations 输出，不只保留文字 trigger', () => {
  const r=computePaipan({gender:'male',birthday:'2005-03-15',birth_time:'10:00',use_true_solar_time:false});
  assert.equal(r.ok,true);
  const j=engine.analyze(r.data,{now:'2013-07-01T00:00:00Z'});
  assert.ok(Array.isArray(j.timing.luck_relations));
  assert.ok(j.timing.luck_relations.some(x=>['generate','control','combine','clash','harm','break','punish','same_char'].includes(x.type)));
});



test('固定原身双向身份成立，但辰戌丑未不主观配置原身', () => {
  const c=fakeChart(['乙','辛','甲','己'],['子','丑','寅','辰']);
  const facts=engine.buildFacts(c),all=new Set(facts.nodes.map(n=>n.id));
  const jia=engine.resolveLuckIdentities({layer:'liunian',stem:'甲',branch:null},facts,all);
  assert.ok(jia.claims.some(x=>x.type==='yuanshen_appearance'&&x.targetChar==='寅'&&x.evidence_grade==='A'));
  const wu=engine.resolveLuckIdentities({layer:'liunian',stem:'戊',branch:null},facts,all);
  assert.ok(!wu.claims.some(x=>x.type==='yuanshen_appearance'&&x.targetChar==='辰'));
});

test('岁运地支可让原局天干以藏干形式出现，半禄只作B级候选', () => {
  const facts=engine.buildFacts(fakeChart(['乙','辛','丁','己'],['子','丑','寅','辰'])),all=new Set();
  for(const n of facts.nodes)all.add(n.id);
  const chen=engine.resolveLuckIdentities({layer:'liunian',stem:null,branch:'辰'},facts,all);
  assert.ok(chen.claims.some(x=>x.type==='hidden_form_appearance'&&x.targetChar==='乙'&&x.evidence_grade==='A'));
  const wei=engine.resolveLuckIdentities({layer:'liunian',stem:null,branch:'未'},facts,all);
  assert.ok(wei.claims.some(x=>x.type==='half_lu_candidate'&&x.targetChar==='丁'&&x.evidence_grade==='B'&&x.major_eligible===false));
});

test('身份解析先于主线：乙到保留A级直接身份，B级课堂顺序只作提示', () => {
  const facts=engine.buildFacts(fakeChart(['乙','辛','甲','己'],['子','未','辰','卯'])),all=new Set();
  for(const n of facts.nodes)all.add(n.id);
  const onlyChen=new Set(facts.nodes.filter(x=>x.char==='辰').map(x=>x.id));
  const r=engine.resolveLuckIdentities({layer:'liunian',stem:'乙',branch:null},facts,onlyChen);
  assert.ok(r.claims.some(x=>x.targetChar==='乙'));
  assert.ok(r.claims.some(x=>x.targetChar==='未'&&x.evidence_grade==='B'));
  assert.ok(r.claims.some(x=>x.targetChar==='辰'&&x.evidence_grade==='B'));
  assert.ok(r.selected.some(x=>x.targetChar==='乙'&&x.evidence_grade==='A'));
  assert.ok(r.selected.some(x=>x.targetChar==='卯'&&x.evidence_grade==='A'));
  assert.ok(!r.selected.some(x=>['未','辰'].includes(x.targetChar)));
  assert.equal(r.resolution_order,'identity_first_then_mainline');
  assert.deepEqual(r.school_priority_hint.ordered_target_chars.slice(0,4),['卯','未','辰','乙']);
});

test('墓库状态只认稳定对应：寅入未，卯见未不自动入墓', () => {
  const a=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','丑','寅','未'])),aa=new Set();for(const n of a.nodes)aa.add(n.id);
  const sa=engine.resolveTombStates(a,[],aa);
  assert.ok(sa.some(x=>x.layer==='original'&&x.inmateChar==='寅'&&x.storeChar==='未'&&x.contained===true));
  const b=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','丑','卯','未'])),bb=new Set();for(const n of b.nodes)bb.add(n.id);
  const sb=engine.resolveTombStates(b,[],bb);
  assert.ok(!sb.some(x=>x.inmateChar==='卯'&&x.storeChar==='未'&&x.contained===true));
});

test('丑未辰同见时不机械判丑未入辰，冲墓只进入待仲裁状态', () => {
  const facts=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','丑','未','辰'])),all=new Set();for(const n of facts.nodes)all.add(n.id);
  const base=engine.resolveTombStates(facts,[],all);
  assert.ok(base.some(x=>x.inmateChar==='丑'&&x.storeChar==='辰'&&x.status==='blocked_by_chou_wei_clash'));
  assert.ok(base.some(x=>x.inmateChar==='未'&&x.storeChar==='辰'&&x.status==='blocked_by_chou_wei_clash'));
  const clash=engine.resolveTombStates(facts,[{layer:'liunian',branch:'戌'}],all);
  assert.ok(clash.some(x=>x.action==='clash_tomb_candidate'&&x.status==='needs_arbitration'));
  assert.ok(!JSON.stringify(clash).includes('store_open'));
});


test('盲派刑破专属白名单：子卯为破不为刑，常见六破和自刑不混入主规则', () => {
  const f1=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','卯','辰','午']));
  const r1=engine.buildRelations(f1);
  const pair=(type,a,b)=>r1.some(x=>x.type===type&&x.nodes.map(id=>f1.byId[id]?.char).sort().join('')===[a,b].sort().join(''));
  assert.ok(pair('break','子','卯'));
  assert.ok(!pair('punish','子','卯'));
  assert.ok(!r1.some(x=>x.type==='punish'&&x.nodes.every(id=>f1.byId[id]?.char==='午')));
  const f2=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','酉','丑','辰']));
  const r2=engine.buildRelations(f2);
  assert.ok(!r2.some(x=>x.type==='break'&&x.nodes.map(id=>f2.byId[id]?.char).sort().join('')==='子酉'.split('').sort().join('')));
  const f3=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['寅','巳','申','子']));
  const r3=engine.buildRelations(f3);
  assert.ok(r3.some(x=>x.type==='sanxing'));
  assert.ok(r3.some(x=>x.type==='harm'&&x.nodes.map(id=>f3.byId[id]?.char).sort().join('')==='寅巳'.split('').sort().join('')));
});

test('墓库当前状态按岁运重算：流年未到后撤销原先丑入辰的 active contained', () => {
  const facts=engine.buildFacts(fakeChart(['甲','乙','丙','丁'],['子','丑','酉','辰'])),all=new Set();for(const n of facts.nodes)all.add(n.id);
  const base=engine.resolveTombStateSnapshot(facts,[],all);
  assert.ok(base.states.some(x=>x.inmate_char==='丑'&&x.store_char==='辰'&&x.contained===true));
  const after=engine.resolveTombStateSnapshot(facts,[{layer:'liunian',branch:'未'}],all);
  assert.ok(after.states.some(x=>x.inmate_char==='丑'&&x.store_char==='辰'&&x.contained===false&&x.status==='blocked_by_chou_wei_clash'));
  assert.ok(!after.states.some(x=>x.inmate_char==='丑'&&x.store_char==='辰'&&x.contained===true));
  assert.equal(after.mode,'current_state_recompute');
});

test('大运阶段门未承接主线时，流年身份只能保留为线索', () => {
  const ids=[{layer:'dayun',selected:[]}];
  const gate=engine.buildDayunStageGate(ids,[],new Set(['original.day.branch']));
  assert.equal(gate.engaged,false);
  assert.equal(gate.status,'quiet');
});



test('流年以固定禄取得大运运干身份，可跨五年重新引动并形成反客为主候选', () => {
  const c=fakeChart(['庚','庚','庚','乙'],['子','辰','午','酉']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{
    pillar:'甲申',heavenly_stem:'甲',earthly_branch:'申',start_year:2000,start_age:21,
    start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},
    stem_phase:{name:'甲运'},branch_phase:{name:'申运'},
    liu_nian:[{year:2008,ganzhi:'戊寅',heavenly_stem:'戊',earthly_branch:'寅',liunian_start_event:{window_start:'2008-02-04 00:00'},liunian_end_event:{window_start:'2009-02-04 00:00'}}]
  }];
  const facts=engine.buildFacts(c),primary={actorNodes:['original.day.stem'],targetNodes:['original.hour.stem'],bridgeNodes:[],resultNodes:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2008-06-01T00:00:00Z'});
  assert.equal(t.dayun.active_component,'branch');
  assert.ok(t.triggers.some(x=>x.type==='cross_phase_identity_activate'&&x.relation==='tonglu'&&/重新引动甲运/.test(x.detail)));
  assert.equal(t.fan_ke_wei_zhu.status,'qualified_by_dayun_identity');
  assert.ok(t.fan_ke_wei_zhu.claims.some(x=>x.type==='liunian_tonglu_dayun_stem'&&x.dayun_char==='甲'&&x.liunian_char==='寅'));
  assert.ok(t.timing_relation_semantics.some(x=>x.semantic==='clash_active_dayun_candidate'));
  assert.ok(t.future.every(x=>!('intensity' in x)&&!('level' in x)));
  assert.ok(t.future.every(x=>['timing_candidate','no_direct_trigger'].includes(x.status)));
});


test('根气分层：坐下通根与其它柱外援不再混成一个 root_score', () => {
  const c=fakeChart(['乙','辛','甲','己'],['寅','丑','子','卯']);
  c.hidden_stems={
    year:[{stem:'甲',label:'本气',element:'木',shi_shen:'比肩'},{stem:'丙',label:'中气',element:'火',shi_shen:'食神'},{stem:'戊',label:'余气',element:'土',shi_shen:'偏财'}],
    month:[{stem:'己',label:'本气',element:'土',shi_shen:'正财'},{stem:'辛',label:'中气',element:'金',shi_shen:'正官'},{stem:'癸',label:'余气',element:'水',shi_shen:'正印'}],
    day:[{stem:'癸',label:'本气',element:'水',shi_shen:'正印'}],
    hour:[{stem:'乙',label:'本气',element:'木',shi_shen:'劫财'}]
  };
  const facts=engine.buildFacts(c),roots=engine.resolveRoots(facts),day=roots.find(x=>x.stemNodeId==='original.day.stem');
  assert.equal(day.capacity_status,'external_support_only');
  assert.equal(day.actor_capable,false);
  assert.ok(day.external_support_strata.some(x=>x.branchNodeId==='original.year.branch'));
  assert.ok(!day.direct_root_strata.some(x=>x.branchNodeId==='original.year.branch'));
  assert.equal(day.score,null);
  assert.equal(day.score_deprecated,true);
});

test('根气分层：坐禄/坐墓/余气分别保留不同承载等级', () => {
  const mk=(dayBranch,hiddenDay)=>{const c=fakeChart(['乙','辛','甲','己'],['子','丑',dayBranch,'卯']);c.hidden_stems={...c.hidden_stems,day:hiddenDay};return engine.resolveRoots(engine.buildFacts(c)).find(x=>x.stemNodeId==='original.day.stem');};
  const lu=mk('寅',[{stem:'甲',label:'本气',element:'木',shi_shen:'比肩'},{stem:'丙',label:'中气',element:'火',shi_shen:'食神'},{stem:'戊',label:'余气',element:'土',shi_shen:'偏财'}]);
  assert.equal(lu.capacity_status,'strong_direct_root');
  assert.ok(lu.direct_root_strata.some(x=>x.kind==='seat_lu_root'));
  const tomb=mk('未',[{stem:'己',label:'本气',element:'土',shi_shen:'正财'},{stem:'乙',label:'中气',element:'木',shi_shen:'劫财'},{stem:'丁',label:'余气',element:'火',shi_shen:'伤官'}]);
  assert.equal(tomb.capacity_status,'medium_qi');
  assert.ok(tomb.direct_root_strata.some(x=>x.kind==='seat_tomb_qi'));
  const residual=mk('辰',[{stem:'戊',label:'本气',element:'土',shi_shen:'偏财'},{stem:'癸',label:'中气',element:'水',shi_shen:'正印'},{stem:'乙',label:'余气',element:'木',shi_shen:'劫财'}]);
  assert.equal(residual.capacity_status,'weak_qi');
  assert.ok(residual.direct_root_strata.some(x=>x.kind==='seat_residual_qi'));
});

test('大运阶段门收紧：只有普通生克背景时不打开重大应期门', () => {
  const gate=engine.buildDayunStageGate([{layer:'dayun',selected:[]}],[{layer:'dayun',type:'generate',targetNodeId:'original.day.branch',detail:'大运生原局节点'}],new Set(['original.day.branch']),{engaged:false,evidence:[]});
  assert.equal(gate.engaged,false);
  assert.equal(gate.status,'context_only');
  assert.equal(gate.strength,'shengke_context_only');
});

test('State Replay：原局合逢大运冲只记“原合被解候选”，不直接判反局或完成', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['亥','丑','寅','卯']);
  c.hidden_stems={year:[{stem:'壬',label:'本气',element:'水',shi_shen:'七杀'},{stem:'甲',label:'中气',element:'木',shi_shen:'偏印'}],month:[{stem:'己',label:'本气',element:'土',shi_shen:'伤官'}],day:[{stem:'甲',label:'本气',element:'木',shi_shen:'偏印'},{stem:'丙',label:'中气',element:'火',shi_shen:'比肩'},{stem:'戊',label:'余气',element:'土',shi_shen:'食神'}],hour:[{stem:'乙',label:'本气',element:'木',shi_shen:'正印'}]};
  const facts=engine.buildFacts(c),rels=engine.buildRelations(facts);
  const comb=rels.find(r=>r.type==='branch_combine'&&r.nodes.includes('original.year.branch')&&r.nodes.includes('original.day.branch'));
  assert.ok(comb);
  const primary={id:'PTEST',title:'测试主线',type:'he_yong',status:'effective',actorNodes:['original.day.branch'],targetNodes:['original.year.branch'],bridgeNodes:[],resultNodes:['original.day.branch'],relationIds:[comb.id]};
  const sem=[{layer:'dayun',semantic:'clash_move_candidate',targetNodeId:'original.day.branch',status:'candidate',detail:'大运申冲原局寅',source_rule:'BLIND-CLASH-SEMANTICS-001'}];
  const replay=engine.replayMainlineState(primary,facts,rels,[],sem,[],{store_actions:[]},{states:[]},{snapshots:[]});
  assert.equal(replay.mode,'original_mainline_state_replay');
  assert.equal(replay.dayun.engaged,true);
  assert.equal(replay.dayun.state,'altered_candidate');
  assert.ok(replay.dayun.changes.some(x=>x.type==='original_combine_released_candidate'));
  assert.ok(!JSON.stringify(replay.dayun).includes('reversed'));
});

test('岁运根气快照：流年见禄可增强当前承载，但不回写原局根气', () => {
  const c=fakeChart(['乙','辛','甲','己'],['子','丑','子','卯']);
  c.hidden_stems={...c.hidden_stems,day:[{stem:'癸',label:'本气',element:'水',shi_shen:'正印'}]};
  const facts=engine.buildFacts(c),roots=engine.resolveRoots(facts),snap=engine.resolveLuckRootState(facts,roots,[{layer:'liunian',branch:'寅'}]);
  const day=snap.states.find(x=>x.stemNodeId==='original.day.stem');
  assert.equal(day.original_capacity,'external_support_only');
  assert.equal(day.current_capacity,'luck_strengthened');
  assert.ok(day.luck_additions.some(x=>x.kind==='luck_lu_root'&&x.layer==='liunian'));
  assert.equal(roots.find(x=>x.stemNodeId==='original.day.stem').capacity_status,'external_support_only');
});


test('岁运根气分阶段：流年见禄不会反写大运阶段容量', () => {
  const c=fakeChart(['乙','辛','甲','己'],['子','丑','子','卯']);
  c.hidden_stems={...c.hidden_stems,day:[{stem:'癸',label:'本气',element:'水',shi_shen:'正印'}]};
  const facts=engine.buildFacts(c),roots=engine.resolveRoots(facts);
  const snap=engine.resolveLuckRootState(facts,roots,[{layer:'dayun',branch:'丑'},{layer:'liunian',branch:'寅'}]);
  const day=snap.states.find(x=>x.stemNodeId==='original.day.stem');
  assert.equal(day.original_capacity,'external_support_only');
  assert.equal(day.stage_capacities.dayun.capacity,'external_support_only');
  assert.equal(day.stage_capacities.dayun.changed,false);
  assert.equal(day.stage_capacities.liunian.capacity,'luck_strengthened');
  assert.equal(day.stage_capacities.liunian.changed,true);
  assert.ok(day.stage_capacities.liunian.additions.some(x=>x.kind==='luck_lu_root'&&x.layer==='liunian'));
});

test('组合状态按首次形成计：大运已成三合，流年不重复标记 newly_formed', () => {
  const c=fakeChart(['乙','辛','甲','己'],['巳','酉','子','卯']);
  const facts=engine.buildFacts(c);
  const comp=engine.resolveCompositeLuckState(facts,[{layer:'dayun',branch:'丑'},{layer:'liunian',branch:'午'},{layer:'liuyue',branch:'申'}],new Set(facts.branches));
  const dy=comp.snapshots.find(x=>x.stage==='dayun').formations.find(x=>x.kind==='sanhe'&&x.branches.join('')==='巳酉丑');
  const ly=comp.snapshots.find(x=>x.stage==='liunian').formations.find(x=>x.kind==='sanhe'&&x.branches.join('')==='巳酉丑');
  const lm=comp.snapshots.find(x=>x.stage==='liuyue').formations.find(x=>x.kind==='sanhe'&&x.branches.join('')==='巳酉丑');
  assert.ok(dy&&ly&&lm);
  assert.equal(dy.first_formed_stage,'dayun');
  assert.equal(dy.newly_formed,true);
  assert.equal(ly.first_formed_stage,'dayun');
  assert.equal(ly.newly_formed,false);
  assert.equal(lm.newly_formed,false);
  assert.equal(dy.transformation,'not_auto_assumed');
});



test('墓用事实：双官入同一主位墓聚合成一条多墓主线，不重复计功', () => {
  const r=computePaipan({name:'匿名墓用A',gender:'male',input_mode:'pillars',direct_pillars:{year:'乙巳',month:'己丑',day:'壬辰',hour:'辛丑'}});
  assert.equal(r.ok,true);
  const j=r.data.blind_judgment,p=j.mainline.primary;
  assert.equal(p.type,'mu_yong');
  assert.equal(p.multiTomb,true);
  assert.equal(p.targetNodes.length,2);
  assert.match(p.title,/2处正官入辰墓/);
  const same=j.gong_paths.filter(x=>x.type==='mu_yong'&&x.tombFact&&x.targetNodes?.length===2&&x.resultNodes?.includes('original.day.branch'));
  assert.equal(same.length,1);
});

test('真实入墓不等于做功：比劫/禄根入墓保留事实，但不自动升墓用主线', () => {
  const r=computePaipan({name:'匿名墓损A',gender:'male',input_mode:'pillars',direct_pillars:{year:'癸卯',month:'庚申',day:'甲寅',hour:'辛未'}});
  assert.equal(r.ok,true);
  const j=r.data.blind_judgment;
  assert.ok(j.original_tomb_state.states.some(x=>x.inmate_char==='寅'&&x.store_char==='未'&&x.contained===true));
  assert.ok(!j.gong_paths.some(x=>x.type==='mu_yong'&&x.status==='effective'&&x.targetNodes.some(id=>j.facts.nodes.find(n=>n.id===id)?.tenGod==='比肩')));
});

test('多而墓之：双中神见墓进入状态层，但比劫多墓不伪装成取得成果', () => {
  const r=computePaipan({name:'匿名多墓A',gender:'male',input_mode:'pillars',direct_pillars:{year:'壬子',month:'己酉',day:'辛酉',hour:'己丑'}});
  assert.equal(r.ok,true);
  const j=r.data.blind_judgment;
  const rows=j.original_tomb_state.states.filter(x=>x.inmate_char==='酉'&&x.store_char==='丑'&&x.mode==='multi_tomb'&&x.contained===true);
  assert.equal(rows.length,2);
  assert.ok(!j.gong_paths.some(x=>x.type==='mu_yong'&&x.status==='effective'&&x.multiTomb));
});

test('两级墓库链：对象先入中间墓，再由中间墓事实归入主位墓，成果归属回到外层墓库', () => {
  const r=computePaipan({name:'匿名墓链A',gender:'male',input_mode:'pillars',direct_pillars:{year:'己卯',month:'辛未',day:'戊辰',hour:'甲寅'}});
  assert.equal(r.ok,true);
  const j=r.data.blind_judgment,p=j.mainline.primary;
  assert.equal(p.type,'mu_yong');
  assert.equal(p.tombChain,true);
  assert.match(p.title,/官杀入未墓再归辰墓/);
  assert.equal(p.ownership.result,'mostly_native');
  assert.equal(p.resultNodes[0],'original.day.branch');
  assert.ok(p.relationIds.length>=3);
});

test('流月准入：大运已承接且流年有直接应期线索，月干合日主或月支冲合流年才取得定位资格', () => {
  const c=fakeChart(),facts=engine.buildFacts(c),relevant=new Set(['original.day.branch']);
  const gate=engine.resolveLiuYueGate(facts,{engaged:true},[{layer:'liunian',type:'clash',targetNodeId:'original.day.branch',detail:'流年直接冲主线'}],[],relevant,{heavenly_stem:'辛',earthly_branch:'酉'},{heavenly_stem:'己',earthly_branch:'卯'});
  assert.equal(gate.qualified,true);
  assert.equal(gate.flow_year_ready,true);
  assert.ok(gate.links.some(x=>x.route==='month_stem_to_day_master'));
  assert.ok(gate.links.some(x=>x.route==='month_branch_to_flow_year'));
});

test('流月准入：流年未承接大运阶段时，流月关系再漂亮也不能越级制造应期', () => {
  const c=fakeChart(),facts=engine.buildFacts(c),relevant=new Set(['original.day.branch']);
  const gate=engine.resolveLiuYueGate(facts,{engaged:false},[{layer:'liunian',type:'clash',targetNodeId:'original.day.branch',detail:'流年直接冲主线'}],[],relevant,{heavenly_stem:'辛',earthly_branch:'酉'},{heavenly_stem:'己',earthly_branch:'卯'});
  assert.equal(gate.qualified,false);
  assert.equal(gate.status,'blocked_by_flow_year');
});

test('流月准入：流年已有应期线索但本月无A级直接关联时，只保留月份线索', () => {
  const c=fakeChart(),facts=engine.buildFacts(c),relevant=new Set(['original.day.branch']);
  const gate=engine.resolveLiuYueGate(facts,{engaged:true},[{layer:'liunian',type:'clash',targetNodeId:'original.day.branch',detail:'流年直接冲主线'}],[],relevant,{heavenly_stem:'辛',earthly_branch:'酉'},{heavenly_stem:'丙',earthly_branch:'亥'});
  assert.equal(gate.qualified,false);
  assert.equal(gate.status,'no_direct_month_link');
});



test('Timing事实分层：非第一主功节点的流年关系进入全局事实，但不得越级进入主线应期', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','辰','寅','酉']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{
    pillar:'癸酉',heavenly_stem:'癸',earthly_branch:'酉',start_year:2000,start_age:21,
    start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},
    stem_phase:{name:'癸运'},branch_phase:{name:'酉运'},
    liu_nian:[{year:2002,ganzhi:'壬午',heavenly_stem:'壬',earthly_branch:'午',liunian_start_event:{window_start:'2002-02-04 00:00'},liunian_end_event:{window_start:'2003-02-04 00:00'}}]
  }];
  const facts=engine.buildFacts(c),primary={id:'P-SCOPE',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.day.branch'],bridgeNodes:[],resultNodes:['original.day.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2002-06-01T00:00:00Z'});
  const globalClash=t.all_luck_relations.find(x=>x.layer==='liunian'&&x.type==='clash'&&x.targetNodeId==='original.year.branch');
  assert.ok(globalClash);
  assert.equal(globalClash.mainline_relevant,false);
  assert.equal(globalClash.major_conclusion_allowed,false);
  assert.ok(!t.luck_relations.some(x=>x.targetNodeId==='original.year.branch'&&x.type==='clash'));
  assert.ok(!t.triggers.some(x=>x.targetNodeId==='original.year.branch'));
  assert.equal(t.stage_gate.engaged,false);
  assert.notEqual(t.effect,'identity_triggered');
  assert.notEqual(t.effect,'activated');
});

test('Timing事实分层：流年与大运非当运部分的直接关系也保留为全局事实', () => {
  const r=computePaipan({name:'匿名岁运事实A',gender:'male',input_mode:'pillars',direct_pillars:{year:'甲辰',month:'乙亥',day:'癸未',hour:'丙辰'},direct_birth_year:1964,direct_qiyun_year:2,direct_qiyun_month:0});
  assert.equal(r.ok,true);
  const j=new BlindJudgmentEngine().analyze(r.data,{now:'1996-07-01T12:00:00+08:00'}),t=j.timing;
  const rel=t.all_luck_relations.find(x=>x.layer==='liunian'&&x.target_scope==='dayun_branch'&&x.type==='break'&&x.targetChar==='卯');
  assert.ok(rel);
  assert.match(rel.detail,/流年子与大运卯破/);
  assert.equal(rel.dayun_component_active,false);
  assert.equal(rel.major_conclusion_allowed,false);
});

test('Timing事实分层：原局无第一主功时仍返回客观岁运事实，但不生成事件结论', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','辰','寅','酉']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{
    pillar:'癸酉',heavenly_stem:'癸',earthly_branch:'酉',start_year:2000,start_age:21,
    start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},
    stem_phase:{name:'癸运'},branch_phase:{name:'酉运'},
    liu_nian:[{year:2002,ganzhi:'壬午',heavenly_stem:'壬',earthly_branch:'午',liunian_start_event:{window_start:'2002-02-04 00:00'},liunian_end_event:{window_start:'2003-02-04 00:00'}}]
  }];
  const facts=engine.buildFacts(c),t=engine.resolveTiming(c,facts,[],null,{now:'2002-06-01T00:00:00Z'});
  assert.ok(t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='clash'&&x.targetNodeId==='original.year.branch'));
  assert.equal(t.luck_relations.length,0);
  assert.equal(t.triggers.length,0);
  assert.equal(t.effect,'neutral');
  assert.equal(t.timing_fact_scope.mainline_fact_count,0);
});



test('岁运暗合事实：卯申只记 dark_combine，不偷换成六合，也不单独生成重大 trigger', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','辰','午','申']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'癸丑',heavenly_stem:'癸',earthly_branch:'丑',start_year:2000,start_age:21,start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},stem_phase:{name:'癸运'},branch_phase:{name:'丑运'},liu_nian:[{year:2004,ganzhi:'甲申',heavenly_stem:'甲',earthly_branch:'申',liunian_start_event:{window_start:'2004-02-04 00:00'},liunian_end_event:{window_start:'2005-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-DARK',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.month.branch'],bridgeNodes:[],resultNodes:['original.month.branch'],relationIds:[]};
  // 把月支改成卯作为主线节点，直接检验岁运事实层。
  facts.byId['original.month.branch'].char='卯';facts.byId['original.month.branch'].element='木';
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2004-07-01T04:00:00Z'});
  assert.ok(t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='dark_combine'&&x.targetChar==='卯'));
  assert.ok(t.luck_relations.some(x=>x.layer==='liunian'&&x.type==='dark_combine'&&x.targetChar==='卯'));
  assert.ok(!t.triggers.some(x=>x.targetNodeId==='original.month.branch'&&String(x.type).includes('combine')));
});

test('岁运半合事实：亥卯记 half_harmony，不冒充普通六合', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','亥','午','申']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'癸丑',heavenly_stem:'癸',earthly_branch:'丑',start_year:2000,start_age:21,start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},stem_phase:{name:'癸运'},branch_phase:{name:'丑运'},liu_nian:[{year:2004,ganzhi:'甲卯',heavenly_stem:'甲',earthly_branch:'卯',liunian_start_event:{window_start:'2004-02-04 00:00'},liunian_end_event:{window_start:'2005-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-HALF',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.month.branch'],bridgeNodes:[],resultNodes:['original.month.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2004-07-01T04:00:00Z'});
  assert.ok(t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='half_harmony'&&x.targetChar==='亥'));
  assert.ok(!t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='combine'&&x.targetChar==='亥'));
});

test('岁运拱局事实：寅戌记 arch_harmony，不冒充六合', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','戌','午','申']);
  c.birth_year=1980;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'癸丑',heavenly_stem:'癸',earthly_branch:'丑',start_year:2000,start_age:21,start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-01-01 00:00'},end_event:{window_start:'2010-01-01 00:00'},stem_phase:{name:'癸运'},branch_phase:{name:'丑运'},liu_nian:[{year:2004,ganzhi:'甲寅',heavenly_stem:'甲',earthly_branch:'寅',liunian_start_event:{window_start:'2004-02-04 00:00'},liunian_end_event:{window_start:'2005-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-ARCH',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.month.branch'],bridgeNodes:[],resultNodes:['original.month.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2004-07-01T04:00:00Z'});
  assert.ok(t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='arch_harmony'&&x.targetChar==='戌'));
  assert.ok(!t.all_luck_relations.some(x=>x.layer==='liunian'&&x.type==='combine'&&x.targetChar==='戌'));
});

test('组合重演：流年通过拱局叫起非当运运支并补齐三合，只从流年层首次成局', () => {
  const c=fakeChart(['癸','戊','戊','辛'],['丑','午','子','酉']);
  c.birth_year=1973;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'壬戌',heavenly_stem:'壬',earthly_branch:'戌',start_year:2005,start_age:33,start_event:{window_start:'2005-01-01 00:00'},stem_to_branch_event:{window_start:'2011-01-01 00:00'},end_event:{window_start:'2015-01-01 00:00'},stem_phase:{name:'壬运'},branch_phase:{name:'戌运'},liu_nian:[{year:2010,ganzhi:'庚寅',heavenly_stem:'庚',earthly_branch:'寅',liunian_start_event:{window_start:'2010-02-04 00:00'},liunian_end_event:{window_start:'2011-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-COMP',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.month.branch'],bridgeNodes:[],resultNodes:['original.month.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2010-07-01T04:00:00Z'});
  const dy=t.composite_state.snapshots.find(x=>x.stage==='dayun').formations.find(x=>x.kind==='sanhe'&&x.branches.join('')==='寅午戌');
  const ly=t.composite_state.snapshots.find(x=>x.stage==='liunian').formations.find(x=>x.kind==='sanhe'&&x.branches.join('')==='寅午戌');
  assert.equal(dy,undefined);
  assert.ok(ly);
  assert.equal(ly.first_formed_stage,'liunian');
  assert.equal(ly.newly_formed,true);
  assert.equal(ly.uses_inactive_dayun_component,true);
  assert.equal(ly.inactive_dayun_activation_relation,'arch_harmony');
  assert.equal(ly.major_conclusion_allowed,false);
});

test('组合重演：流年冲起非当运运支并补齐丑戌未三刑，只记形成事实不自动定凶', () => {
  const c=fakeChart(['丁','壬','壬','癸'],['酉','子','戌','卯']);
  c.birth_year=1957;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'丁未',heavenly_stem:'丁',earthly_branch:'未',start_year:2005,start_age:49,start_event:{window_start:'2005-01-01 00:00'},stem_to_branch_event:{window_start:'2011-01-01 00:00'},end_event:{window_start:'2015-01-01 00:00'},stem_phase:{name:'丁运'},branch_phase:{name:'未运'},liu_nian:[{year:2009,ganzhi:'己丑',heavenly_stem:'己',earthly_branch:'丑',liunian_start_event:{window_start:'2009-02-04 00:00'},liunian_end_event:{window_start:'2010-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-XING',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.day.branch'],bridgeNodes:[],resultNodes:['original.day.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2009-07-01T04:00:00Z'});
  const f=t.composite_state.snapshots.find(x=>x.stage==='liunian').formations.find(x=>x.kind==='sanxing'&&x.branches.join('')==='丑戌未');
  assert.ok(f);
  assert.equal(f.first_formed_stage,'liunian');
  assert.equal(f.uses_inactive_dayun_component,true);
  assert.equal(f.inactive_dayun_activation_relation,'clash');
  assert.equal(f.transformation,'not_auto_assumed');
  assert.equal(f.major_conclusion_allowed,false);
});

test('原局暗合进入事实与语义层，但不单靠暗合生成做功路径', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','卯','午','申']);
  const j=engine.analyze(c);
  const rel=j.relations.find(r=>r.type==='dark_combine'&&r.nodes.some(id=>j.facts.nodes.find(n=>n.id===id)?.char==='卯')&&r.nodes.some(id=>j.facts.nodes.find(n=>n.id===id)?.char==='申'));
  assert.ok(rel);
  const sem=j.relation_semantics.find(x=>x.relationId===rel.id);
  assert.ok(sem);
  assert.equal(sem.semantic,'dark_combine_link');
  assert.equal(sem.gate,'conditional');
  assert.ok(!j.gong_paths.some(p=>Array.isArray(p.relationIds)&&p.relationIds.includes(rel.id)));
});

test('流年叫起非当运运支后的二段作用只记流年全局事实，不倒灌大运或自动生成重大结论', () => {
  const c=fakeChart(['甲','乙','丙','丁'],['子','卯','辰','酉']);
  c.birth_year=1976;c.blind_daxian={available:true,ranges:[],note:''};
  c.da_yun=[{pillar:'甲午',heavenly_stem:'甲',earthly_branch:'午',start_year:2000,start_age:25,start_event:{window_start:'2000-01-01 00:00'},stem_to_branch_event:{window_start:'2005-12-31 00:00'},end_event:{window_start:'2010-01-01 00:00'},stem_phase:{name:'甲运'},branch_phase:{name:'午运'},liu_nian:[{year:2003,ganzhi:'癸未',heavenly_stem:'癸',earthly_branch:'未',liunian_start_event:{window_start:'2003-02-04 00:00'},liunian_end_event:{window_start:'2004-02-04 00:00'}}]}];
  const facts=engine.buildFacts(c),primary={id:'P-DYN2',title:'测试主线',type:'zhi_yong',status:'effective',actorNodes:['original.day.stem'],targetNodes:['original.day.branch'],bridgeNodes:[],resultNodes:['original.day.branch'],relationIds:[]};
  const t=engine.resolveTiming(c,facts,[],primary,{now:'2003-07-01T04:00:00Z'});
  const act=t.all_luck_relations.find(x=>x.layer==='liunian'&&x.target_scope==='dayun_branch'&&x.type==='combine'&&x.targetChar==='午');
  assert.ok(act);
  const second=t.all_luck_relations.find(x=>x.layer==='liunian'&&x.target_scope==='original_via_reactivated_dayun_branch'&&x.type==='break'&&x.targetChar==='卯');
  assert.ok(second);
  assert.equal(second.reactivated_dayun_char,'午');
  assert.equal(second.activation_relation,'combine');
  assert.equal(second.major_conclusion_allowed,false);
  assert.ok(!t.all_luck_relations.some(x=>x.layer==='dayun'&&x.target_scope==='original_via_reactivated_dayun_branch'));
  assert.ok(!t.triggers.some(x=>x.targetNodeId==='original.month.branch'&&x.type==='break'));
});

console.log(`\nJudgment regression: ${passed}/${passed} passed`);
