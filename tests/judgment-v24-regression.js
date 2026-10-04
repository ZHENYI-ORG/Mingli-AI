'use strict';
const assert=require('assert');
const fs=require('fs');
const {computePaipan}=require('../dist/api');

const reality={
  '甲':{real:['寅','辰','子'],virtual:['申','戌','午']},
  '乙':{real:['亥','卯','未'],virtual:['巳','酉','丑']},
  '丙':{real:['寅','午','戌'],virtual:['子','申','辰']},
  '丁':{real:['巳','卯','未'],virtual:['亥','丑','酉']},
  '戊':{real:['戌','午','辰'],virtual:['子','申','寅']},
  '己':{real:['巳','未','丑'],virtual:['亥','酉','卯']},
  '庚':{real:['申','辰'],virtual:['子','午','寅','戌']},
  '辛':{real:['丑','酉'],virtual:['巳','亥','未','卯']},
  '壬':{real:['申','子','辰'],virtual:['戌','午','寅']},
  '癸':{real:['亥','酉','丑'],virtual:['巳','未','卯']},
};
const hourByDay={甲:'甲子',己:'甲子',乙:'丙子',庚:'丙子',丙:'戊子',辛:'戊子',丁:'庚子',壬:'庚子',戊:'壬子',癸:'壬子'};
function runPillars(pillars,name='v24'){
  const [year,month,day,hour]=pillars;
  const r=computePaipan({name,gender:'male',input_mode:'pillars',direct_pillars:{year,month,day,hour}});
  assert.equal(r.ok,true,`${name} should compute`);return r.data.blind_judgment;
}
let realityCount=0;
for(const [stem,g] of Object.entries(reality))for(const label of ['real','virtual'])for(const branch of g[label]){
  const j=runPillars(['乙丑','戊寅',stem+branch,hourByDay[stem]],`R-${stem}${branch}`);
  const row=j.reality_state.original.find(x=>x.pillar==='day');
  assert(row,`missing reality ${stem}${branch}`);assert.equal(row.state,label,`${stem}${branch} reality`);realityCount++;
}
assert.equal(realityCount,60,'complete 60 Jiazi reality table');

const zfCases=[
  ['v24-zf-001',['辛亥','丙申','己丑','甲戌'],'fan'],['v24-zf-002',['乙巳','庚辰','辛卯','丙申'],'fan'],
  ['v24-zf-003',['甲辰','戊辰','癸卯','己未'],'zheng'],['v24-zf-004',['戊辰','壬戌','丁丑','丁未'],'zheng'],
  ['v24-zf-005',['丙子','戊戌','丁丑','丁未'],'fan'],['v24-zf-006',['癸未','丙辰','戊戌','丙辰'],'fan'],
  ['v24-zf-007',['壬寅','戊申','辛巳','戊戌'],'fan'],['v24-zf-008',['辛卯','丙申','辛未','癸巳'],'zheng'],
  ['v24-zf-009',['己巳','壬申','己未','乙丑'],'fan'],['v24-zf-010',['戊申','丁巳','戊子','戊午'],'fan'],
  ['v24-zf-011',['丁未','癸丑','丙申','辛卯'],'zheng'],
];
for(const [id,pillars,expected] of zfCases){const j=runPillars(pillars,id);assert.equal(j.chart_zheng_fan.status,expected,`${id} chart zhengfan`);assert.equal(j.chart_zheng_fan.major_conclusion_allowed,false);}

// SymbolGraph: only assert the structural gate, never a concrete life event.
let j=runPillars(['壬子','丙午','己巳','辛未'],'SX01');
assert(j.symbol_graph.edges.some(e=>e.type==='exchange_after_control'&&e.gate==='passed'),'control exchange should exist');
j=runPillars(['丁未','壬子','乙丑','戊寅'],'SX02');
assert(j.symbol_graph.edges.some(e=>e.type==='stem_combine_symbol_transfer'&&e.gate==='passed'),'stem combine transfer should exist');
j=runPillars(['甲午','癸酉','戊子','丁巳'],'SX03');
assert(j.symbol_graph.edges.some(e=>e.type==='dai_xiang_connected'&&e.pair==='甲午'&&e.gate==='passed'),'connected daixiang should pass host gate');
j=runPillars(['癸卯','甲寅','丙戌','庚子'],'SX04');
assert(j.symbol_graph.edges.some(e=>e.pair==='庚子'&&e.connected_to_host===false&&e.major_eligible===false),'disconnected daixiang must stay gated');
j=runPillars(['庚子','己卯','甲辰','己巳'],'SX05');
assert(j.symbol_graph.edges.some(e=>e.pair==='庚子'&&e.connected_to_host===true),'子辰 route should connect daixiang to host');
j=runPillars(['癸巳','庚申','癸丑','戊午'],'SX06');
assert(j.symbol_graph.edges.some(e=>e.type==='borrow_lu_origin'&&e.gate==='passed'),'lu/origin borrow edge should exist');
j=runPillars(['庚寅','己丑','丁卯','癸卯'],'SX07');
assert(j.symbol_graph.edges.some(e=>e.type==='borrow_same_element_candidate'&&e.production_scope==='candidate_only'),'same element borrowing remains candidate-only');
assert((j.symbol_graph.edges||[]).every(e=>e.major_eligible===false),'SymbolGraph must never directly enter mainline ranking');

console.log(`v2.4 regression passed: RealityState ${realityCount}/60, ChartZhengFan ${zfCases.length}/${zfCases.length}, SymbolGraph 7/7`);
