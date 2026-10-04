'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {computePaipan}=require('../dist/api');
const {LocalChartAdapter}=require('../dist/core/LocalChartAdapter');
const {LocalPaipan}=require('../dist/core/LocalPaipan');
const {TrueSolarTimeCalculator}=require('../dist/core/TrueSolarTimeCalculator');
const {BlindJudgmentEngine}=require('../dist/core/judgment/BlindJudgmentEngine');
const FAST=process.env.V253_BIRTH_AUDIT_FAST!=='0';
const NATAL_ONLY=process.env.V253_BIRTH_AUDIT_NATAL_ONLY!=='0';
function runPaipan(input){
  if(!FAST)return computePaipan(input);
  try{
    const gender=(input.gender==='male'||input.gender===0)?0:1;
    let parts;
    if(input.use_true_solar_time){parts=TrueSolarTimeCalculator.calculate(input.birthday,input.birth_time,input.longitude,input.timezone_id||'Asia/Shanghai').parts;}
    else {const [y,m,d]=input.birthday.split('-').map(Number),[hh,mi]=input.birth_time.split(':').map(Number);parts=[y,m,d,hh,mi,0];}
    const [yy,mm,dd,hh,mi]=parts;
    const lp=new LocalPaipan();const info=lp.GetInfo(gender,yy,mm,dd,hh,mi,0);
    const ps=[0,1,2,3].map(i=>lp.ctg[info.tg[i]]+lp.cdz[info.dz[i]]);
    const adapter=new LocalChartAdapter();const chart=adapter.computeFromPillars({gender:input.gender,direct_pillars:{year:ps[0],month:ps[1],day:ps[2],hour:ps[3]}});
    chart.effective_time=`${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')} ${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
    chart.civil_time=`${input.birthday} ${input.birth_time}`;
    chart.true_solar_time=input.use_true_solar_time?chart.effective_time:'';
    chart.time_basis=input.use_true_solar_time?'true_solar':'civil';
    if(NATAL_ONLY){chart.da_yun=[];chart.xiao_yun=[];}
    chart.blind_judgment=new BlindJudgmentEngine().analyze(chart);return {ok:true,data:chart};
  }catch(e){return {ok:false,message:e&&e.message?e.message:String(e)};}
}

const N=Number(process.env.V253_BIRTH_AUDIT_N||3000);
const SEED=(Number(process.env.V253_BIRTH_AUDIT_SEED||20260910)>>>0);
const OUT=process.env.V253_BIRTH_AUDIT_OUT||'';
let state=SEED||1;
function rnd(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;}
function ri(a,b){return a+Math.floor(rnd()*(b-a+1));}
function pick(a){return a[ri(0,a.length-1)];}
const pad=n=>String(n).padStart(2,'0');

const STEMS=['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES=['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const STEM_EL={甲:'木',乙:'木',丙:'火',丁:'火',戊:'土',己:'土',庚:'金',辛:'金',壬:'水',癸:'水'};
const STEM_YY={甲:'阳',乙:'阴',丙:'阳',丁:'阴',戊:'阳',己:'阴',庚:'阳',辛:'阴',壬:'阳',癸:'阴'};
const GENERATES={木:'火',火:'土',土:'金',金:'水',水:'木'};
const CONTROLS={木:'土',土:'水',水:'火',火:'金',金:'木'};
const STEM_COMB=new Set(['甲己','己甲','乙庚','庚乙','丙辛','辛丙','丁壬','壬丁','戊癸','癸戊']);
function pairset(xs){const s=new Set();for(const [a,b] of xs){s.add(a+b);s.add(b+a);}return s;}
const B_COMB=pairset([['子','丑'],['寅','亥'],['卯','戌'],['辰','酉'],['巳','申'],['午','未']]);
const B_CLASH=pairset([['子','午'],['丑','未'],['寅','申'],['卯','酉'],['辰','戌'],['巳','亥']]);
const B_HARM=pairset([['子','未'],['丑','午'],['寅','巳'],['卯','辰'],['申','亥'],['酉','戌']]);
const SEX60=new Set(Array.from({length:60},(_,i)=>STEMS[i%10]+BRANCHES[i%12]));
const VISIBLE_IDS=['original.year.stem','original.year.branch','original.month.stem','original.month.branch','original.day.stem','original.day.branch','original.hour.stem','original.hour.branch'];
const HOST_IDS=new Set(['original.day.stem','original.day.branch','original.hour.stem','original.hour.branch']);
const GUEST_IDS=new Set(['original.year.stem','original.year.branch','original.month.stem','original.month.branch']);
function tenGod(dm,x){if(dm===x)return '比肩';const de=STEM_EL[dm],xe=STEM_EL[x],same=STEM_YY[dm]===STEM_YY[x];if(de===xe)return same?'比肩':'劫财';if(GENERATES[de]===xe)return same?'食神':'伤官';if(CONTROLS[de]===xe)return same?'偏财':'正财';if(CONTROLS[xe]===de)return same?'七杀':'正官';if(GENERATES[xe]===de)return same?'偏印':'正印';return '?';}
function expectedHourBranch(h){return BRANCHES[Math.floor(((h+1)%24)/2)];}
function expectedHourStem(dayStem,hourBranch){const di=STEMS.indexOf(dayStem),bi=BRANCHES.indexOf(hourBranch);const starts=[0,2,4,6,8];const start=starts[di%5];return STEMS[(start+bi)%10];}
function relationHas(j,type,a,b,dir){return (j.relations||[]).some(r=>r.type===type&&(r.nodes||[]).includes(a)&&(r.nodes||[]).includes(b)&&(!dir||r.direction===dir));}
function validDate(){while(true){const y=ri(1940,2025),m=ri(1,12),d=ri(1,31);const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d)return [y,m,d];}}
function sampleInput(i){const [y,m,d]=validDate();const hh=ri(0,23),mm=ri(0,59);return {name:`BT-${SEED}-${i}`,gender:rnd()<0.5?'male':'female',birthday:`${y}-${pad(m)}-${pad(d)}`,birth_time:`${pad(hh)}:${pad(mm)}`,longitude:Number((73.5+rnd()*61.5).toFixed(6)),birth_region:'随机审计',is_lunar:false,use_true_solar_time:rnd()<0.82,timezone_id:'Asia/Shanghai'};}
function pillarStrings(d){const b=d.bazi;return [b.year_pillar,b.month_pillar,b.day_pillar,b.hour_pillar].map(p=>p.heavenly_stem+p.earthly_branch);}
function addIssue(arr,sev,code,msg,ctx){arr.push({sev,code,msg,...ctx});}
function auditOne(input,res){const issues=[];if(!res?.ok){addIssue(issues,'hard','PAIPAN_FAIL',res?.message||'unknown',{input});return issues;}const d=res.data,j=d.blind_judgment;if(!j?.ok){addIssue(issues,'hard','JUDGMENT_FAIL',j?.message||'unknown',{input});return issues;}
  const ps=pillarStrings(d);for(const p of ps)if(!SEX60.has(p))addIssue(issues,'hard','INVALID_60',`非法六十甲子 ${p}`,{input,ps});
  if(j.engine_version!=='2.5.5-algorithm-correction')addIssue(issues,'hard','ENGINE_VERSION',j.engine_version,{input,ps});
  const by=Object.fromEntries((j.facts?.nodes||[]).map(n=>[n.id,n]));const dm=by['original.day.stem']?.char;
  if(dm!==d.bazi.day_pillar.heavenly_stem)addIssue(issues,'hard','DM_MISMATCH',`${dm} != ${d.bazi.day_pillar.heavenly_stem}`,{input,ps});
  // 独立重算可见天干五行/十神。
  for(const id of ['original.year.stem','original.month.stem','original.hour.stem']){const n=by[id];if(!n)continue;if(n.element!==STEM_EL[n.char])addIssue(issues,'hard','STEM_ELEMENT',`${id} ${n.char} ${n.element}`,{input,ps});const tg=tenGod(dm,n.char);if(n.tenGod!==tg)addIssue(issues,'hard','TEN_GOD',`${id} ${n.char}: ${n.tenGod} != ${tg}`,{input,ps});}
  // 独立重算时支/时干，以 effective_time 为基准。
  const mt=/ (\d{2}):(\d{2})$/.exec(String(d.effective_time||''));if(mt){const h=Number(mt[1]),eb=expectedHourBranch(h),ab=d.bazi.hour_pillar.earthly_branch;if(eb!==ab)addIssue(issues,'hard','HOUR_BRANCH',`${d.effective_time}: ${ab} != ${eb}`,{input,ps});const stemForHour=d.zi_hour_variant==='night'?STEMS[(STEMS.indexOf(d.bazi.day_pillar.heavenly_stem)+1)%10]:d.bazi.day_pillar.heavenly_stem;const es=expectedHourStem(stemForHour,ab),as=d.bazi.hour_pillar.heavenly_stem;if(es!==as)addIssue(issues,'hard','HOUR_STEM',`${as}${ab} != ${es}${ab}`,{input,ps});}
  // 独立重算可见天干五合事实。
  const stemIds=['original.year.stem','original.month.stem','original.day.stem','original.hour.stem'];for(let a=0;a<stemIds.length;a++)for(let b=a+1;b<stemIds.length;b++){const A=by[stemIds[a]],B=by[stemIds[b]];if(A&&B&&STEM_COMB.has(A.char+B.char)&&!relationHas(j,'stem_combine',A.id,B.id))addIssue(issues,'hard','MISS_STEM_COMB',`${A.char}${B.char}`,{input,ps});}
  // 独立重算六合/六冲/六穿基础事实。
  const branchIds=['original.year.branch','original.month.branch','original.day.branch','original.hour.branch'];for(let a=0;a<branchIds.length;a++)for(let b=a+1;b<branchIds.length;b++){const A=by[branchIds[a]],B=by[branchIds[b]];if(!A||!B)continue;const key=A.char+B.char;if(B_COMB.has(key)&&!relationHas(j,'branch_combine',A.id,B.id))addIssue(issues,'hard','MISS_BRANCH_COMB',key,{input,ps});if(B_CLASH.has(key)&&!relationHas(j,'clash',A.id,B.id))addIssue(issues,'hard','MISS_CLASH',key,{input,ps});if(B_HARM.has(key)&&!relationHas(j,'harm',A.id,B.id))addIssue(issues,'hard','MISS_HARM',key,{input,ps});}
  // ID/签名唯一。
  for(const [code,rows,key] of [['REL_DUP',j.relations||[],'id'],['PATH_DUP',j.gong_paths||[],'id'],['SIG_DUP',j.gong_paths||[],'signature']]){const seen=new Set();for(const x of rows){if(!x?.[key])continue;if(seen.has(x[key]))addIssue(issues,'hard',code,String(x[key]),{input,ps});seen.add(x[key]);}}
  // 第一主功必须是真实可结算路径。
  const p=j.mainline?.primary;if(p&&p.type!=='xiang_fallback'){const found=(j.gong_paths||[]).find(x=>x.id===p.id);if(!found)addIssue(issues,'hard','PRIMARY_MISSING',p.id,{input,ps});if(p.settlement?.eligibility!=='valid')addIssue(issues,'hard','PRIMARY_NOT_VALID',`${p.id}:${p.settlement?.eligibility}`,{input,ps,title:p.title});if(['none','broken','counterproductive'].includes(p.settlement?.completion))addIssue(issues,'hard','PRIMARY_BAD_COMPLETION',`${p.id}:${p.settlement?.completion}`,{input,ps,title:p.title});for(const rid of p.relationIds||[])if(!(j.relations||[]).some(r=>r.id===rid))addIssue(issues,'hard','PRIMARY_BAD_REL',`${p.id}:${rid}`,{input,ps,title:p.title});
    const relTypes=(p.relationIds||[]).map(id=>(j.relations||[]).find(r=>r.id===id)?.type).filter(Boolean);const am=p.actionMode||'';const type=p.type||'';
    const needs=(allowed)=>allowed.some(x=>relTypes.includes(x));if(am==='direct_control'&&!needs(['control']))addIssue(issues,'hard','ACTION_BASIS','direct_control without control',{input,ps,title:p.title,relTypes});if(am==='special_control'&&!needs(['brittle_control','dampen_fire']))addIssue(issues,'hard','ACTION_BASIS','special_control without special relation',{input,ps,title:p.title,relTypes});if(['clash_control','clash_take'].includes(am)&&!needs(['clash']))addIssue(issues,'hard','ACTION_BASIS',`${am} without clash`,{input,ps,title:p.title,relTypes});if(am==='wear_control'&&!needs(['harm']))addIssue(issues,'hard','ACTION_BASIS','wear_control without harm',{input,ps,title:p.title,relTypes});if(['sheng_yong','xie_yong'].includes(type)&&!needs(['generate']))addIssue(issues,'hard','ACTION_BASIS',`${type} without generate`,{input,ps,title:p.title,relTypes});if(type==='he_yong'&&!needs(['stem_combine','branch_combine','stem_branch_combine']))addIssue(issues,'hard','ACTION_BASIS','he_yong without combine',{input,ps,title:p.title,relTypes});if(type==='hua_yong'&&relTypes.filter(x=>x==='generate').length<2)addIssue(issues,'hard','ACTION_BASIS','hua_yong without 2 generate edges',{input,ps,title:p.title,relTypes});if(type==='mu_yong'&&!needs(['tomb_enter','multi_tomb_enter']))addIssue(issues,'hard','ACTION_BASIS','mu_yong without tomb',{input,ps,title:p.title,relTypes});
    const s=p.settlement||{};if(s.completion==='complete'&&(s.residualTargetIds||[]).length)addIssue(issues,'hard','COMPLETE_WITH_RESIDUAL',p.id,{input,ps,title:p.title});if(s.resultIntegrity==='intact'&&(s.residualTargetIds||[]).length)addIssue(issues,'hard','INTACT_WITH_RESIDUAL',p.id,{input,ps,title:p.title});const pg=s.semanticGate||{};for(const e of s.edgeFunctionalStates||[]){const exp=(pg.passed||[]).includes(e.relationId)?'active':(pg.conditional||[]).includes(e.relationId)?'constrained':(pg.failed||[]).includes(e.relationId)?'blocked':null;if(exp&&e.status!==exp)addIssue(issues,'hard','EDGE_GATE_MISMATCH',`${p.id}:${e.relationId}:${e.status} != ${exp}`,{input,ps,title:p.title});}if(s.structureLevel==='L5'&&!p.qishiBased&&!p.book_party_projection?.projectsOutside&&!(p.unified_structures||[]).length)addIssue(issues,'warn','L5_NO_GLOBAL_BASIS',p.id,{input,ps,title:p.title});
    // 归属：全部结果停在年月且没有任何主位结果，只允许 external/shared/unclear，不应 mostly_native。
    const rr=p.resultNodes||[];if(rr.length&&rr.every(id=>GUEST_IDS.has(id))&&p.ownership?.result==='mostly_native'){const hostActs=[...(p.actorNodes||[]),...(p.leadActorNodes||[])].some(id=>HOST_IDS.has(id));const hasAcquisition=hostActs||p.book_party_projection?.projectsOutside===true||['he_yong','zhi_yong','mu_yong','hua_yong'].includes(p.type);if(!hasAcquisition)addIssue(issues,'hard','OWNERSHIP_GUEST_AS_NATIVE',p.id,{input,ps,title:p.title,results:rr});}
  }
  // 日干五合/食伤输出入手法独立核验存在性。
  const dmId='original.day.stem';const dmComb=(j.relations||[]).filter(r=>r.type==='stem_combine'&&(r.nodes||[]).includes(dmId));const validDmComb=(j.gong_paths||[]).some(p=>p.settlement?.eligibility==='valid'&&(p.relationIds||[]).some(id=>dmComb.some(r=>r.id===id))&&[...(p.actorNodes||[]),...(p.targetNodes||[]),...(p.bridgeNodes||[])].includes(dmId));if(Boolean(j.book_method?.entry?.dayStemCombine)!==Boolean(validDmComb))addIssue(issues,'hard','BOOK_ENTRY_COMBINE',`${j.book_method?.entry?.dayStemCombine} != ${validDmComb}`,{input,ps});
  const dmOut=(j.relations||[]).filter(r=>r.type==='generate'&&r.nodes?.[0]===dmId&&['食神','伤官'].includes(by[r.nodes?.[1]]?.tenGod));if(Boolean(j.book_method?.entry?.dayStemOutput)!==Boolean(dmOut.length))addIssue(issues,'hard','BOOK_ENTRY_OUTPUT',`${j.book_method?.entry?.dayStemOutput} != ${!!dmOut.length}`,{input,ps});
  // 正反局：完成度必须中性；来源治理有分歧时必须显式。
  const z=j.chart_zheng_fan||{};for(const a of z.axes||[])if(String(a.id).includes('COMPLETE')&&a.direction!=='neutral')addIssue(issues,'hard','ZF_COMPLETION_DIRECTION',`${a.id}:${a.direction}`,{input,ps});if(z.source_governed&&z.source_status&&z.status!==z.source_status)addIssue(issues,'hard','ZF_SOURCE_RELEASE',`${z.status} != ${z.source_status}`,{input,ps});if(z.source_disagreement&&z.candidate_status===z.source_status)addIssue(issues,'hard','ZF_FALSE_DISAGREEMENT',`${z.candidate_status}/${z.source_status}`,{input,ps});
  // Stage：本层增量只能含本层；累计单调不小于本层。
  const sr=j.timing?.state_replay;if(sr?.available){for(const s of sr.snapshots||[]){if(s.settlement_delta?.scope!=='stage_delta')addIssue(issues,'hard','STAGE_SCOPE',`${s.stage}:${s.settlement_delta?.scope}`,{input,ps});for(const c of s.stage_changes||[])if(c.layer&&c.layer!==s.stage)addIssue(issues,'hard','STAGE_LEAK',`${s.stage} got ${c.layer}`,{input,ps});if((s.cumulative_changes||[]).length<(s.stage_changes||[]).length)addIssue(issues,'hard','STAGE_CUMULATIVE_SHORT',s.stage,{input,ps});}}
  return issues;
}

const stats={seed:SEED,n:N,attempts:0,skippedInvalidLocalTime:0,ok:0,failed:0,hard:0,warn:0,issueCodes:{},primaryTypes:{},primaryActions:{},ownership:{},chartStatus:{},candidateStatus:{},unified:0,coPrimary:0,rareSamples:{clash_take:[],wear_control:[],mu_yong:[],hua_yong:[],unified:[],fan:[],mixed:[],external:[]},issues:[]};
for(let accepted=0,i=0;accepted<N;i++){
  stats.attempts++;
  const input=sampleInput(i);const res=runPaipan(input);
  if(!res.ok&&/不存在，可能处于夏令时跳时区间/.test(String(res.message||''))){stats.skippedInvalidLocalTime++;continue;}
  accepted++;
  const issues=auditOne(input,res);if(res.ok&&res.data?.blind_judgment?.ok)stats.ok++;else stats.failed++;
  for(const e of issues){stats[e.sev]++;stats.issueCodes[e.code]=(stats.issueCodes[e.code]||0)+1;if(stats.issues.length<80)stats.issues.push(e);}
  if(res.ok&&res.data?.blind_judgment?.ok){const j=res.data.blind_judgment,p=j.mainline?.primary;const ps=pillarStrings(res.data);if(p){stats.primaryTypes[p.type]=(stats.primaryTypes[p.type]||0)+1;const ac=p.actionMode||p.type||'none';stats.primaryActions[ac]=(stats.primaryActions[ac]||0)+1;const ow=p.ownership?.result||'none';stats.ownership[ow]=(stats.ownership[ow]||0)+1;if(j.mainline?.co_primary)stats.coPrimary++;if((p.unified_structures||[]).length){stats.unified++;if(stats.rareSamples.unified.length<12)stats.rareSamples.unified.push({input,ps,title:p.title,type:p.type,action:p.actionMode,ownership:ow,unified:p.unified_structures.map(x=>x.label)});}if(p.actionMode==='clash_take'&&stats.rareSamples.clash_take.length<12)stats.rareSamples.clash_take.push({input,ps,title:p.title,ownership:ow});if(p.actionMode==='wear_control'&&stats.rareSamples.wear_control.length<12)stats.rareSamples.wear_control.push({input,ps,title:p.title,ownership:ow});if(p.type==='mu_yong'&&stats.rareSamples.mu_yong.length<12)stats.rareSamples.mu_yong.push({input,ps,title:p.title,ownership:ow});if(p.type==='hua_yong'&&stats.rareSamples.hua_yong.length<12)stats.rareSamples.hua_yong.push({input,ps,title:p.title,ownership:ow});if(ow==='mostly_external'&&stats.rareSamples.external.length<12)stats.rareSamples.external.push({input,ps,title:p.title,type:p.type,action:p.actionMode});}
    const z=j.chart_zheng_fan||{};stats.chartStatus[z.status||'none']=(stats.chartStatus[z.status||'none']||0)+1;stats.candidateStatus[z.candidate_status||'none']=(stats.candidateStatus[z.candidate_status||'none']||0)+1;if(z.candidate_status==='fan'&&stats.rareSamples.fan.length<12)stats.rareSamples.fan.push({input,ps,title:p?.title,axes:z.axes});if(z.candidate_status==='mixed'&&stats.rareSamples.mixed.length<12)stats.rareSamples.mixed.push({input,ps,title:p?.title,axes:z.axes});
  }
}
if(OUT){fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(stats,null,2));}
console.log(JSON.stringify({...stats,issues:stats.issues.slice(0,20),rareSamples:undefined},null,2));
if(stats.hard>0)process.exitCode=2;
