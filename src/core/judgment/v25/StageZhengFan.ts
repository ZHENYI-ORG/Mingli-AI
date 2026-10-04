import type { ChartZhengFanV2Result, ZhengFanState } from './ChartZhengFanV2';

export type StageZhengFanState='maintained_zheng'|'strengthened_zheng'|'partial_fan'|'fan'|'maintained_fan'|'repair_candidate'|'mixed'|'unclear';
export interface StageZhengFanSnapshot{
  stage:'dayun'|'liunian'|'liuyue';
  status:StageZhengFanState;
  confidence:'high'|'medium'|'low';
  base_chart_status:ZhengFanState;
  previous_stage_status?:StageZhengFanState|null;
  effective_direction_after?:ZhengFanState;
  support_axes:string[];
  conflict_axes:string[];
  evidence:string[];
  counter_evidence:string[];
  executor_state:string;
  control_edge_state:string;
  target_state:string;
  completion_before:string|null;
  completion_after_candidate:string|null;
  residual_change_candidate:string|null;
  integrity_after_candidate:string|null;
  ownership_after_candidate:string|null;
  alignment_after_candidate:string|null;
  major_conclusion_allowed:false;
  event_conclusion_allowed:false;
  note:string;
}
const uniq=<T>(xs:T[])=>[...new Set(xs)];

function classify(base:ZhengFanState,snap:any):StageZhengFanSnapshot{
  const d=snap?.settlement_delta||{};
  const changes=snap?.stage_changes||snap?.changes||[];
  const support:string[]=[];const conflict:string[]=[];const ev:string[]=[];const cev:string[]=[];
  const addSupport=(id:string,txt:string)=>{support.push(id);cev.push(txt);};
  const addConflict=(id:string,txt:string)=>{conflict.push(id);ev.push(txt);};

  if(d.control_edge_state==='impaired_candidate')addConflict('STAGE-CONTROL-EDGE-IMPAIRED','岁运直接扰动原主功控制边，属于反向证据。');
  if(d.executor_state==='changed_candidate')addSupport('STAGE-EXECUTOR-CHANGED','原主功执行器承载发生变化；当前 RootState Replay 只在得到新增根气/承载时标记 changed，作为加强候选。');
  if(d.target_state==='disturbed_candidate')addConflict('STAGE-TARGET-DISTURBED','原主功目标被岁运直接扰动，需要重新检查是否出现释放/保护或原控制失效。');
  if(d.target_state==='engaged_candidate')addSupport('STAGE-TARGET-ENGAGED','原主功目标在当前时间层被直接引动，形成同一主线的应期承接候选。');
  if(d.residual_change_candidate==='increase_candidate')addConflict('STAGE-RESIDUAL-INCREASE','Settlement Replay 提示残余目标可能增加。');
  if(['impaired_or_broken_candidate'].includes(d.integrity_after_candidate))addConflict('STAGE-RESULT-INTEGRITY-DAMAGE','原主功结果完整性出现受损/破坏候选。');

  for(const c of changes){
    if(c.type==='original_combine_released_candidate')addConflict('STAGE-ORIGINAL-COMBINE-RELEASED',c.detail||'原合制/合取机制被冲开，控制边释放候选。');
    else if(c.type==='original_clash_met_by_combine')addConflict('STAGE-ORIGINAL-CLASH-PROTECTED',c.detail||'原冲制机制被合类关系牵制，目标保护候选。');
    else if(c.type==='structure_damage_candidate'&&(c.role==='actor'||c.role==='bridge'||c.role==='result'))addConflict('STAGE-MAINLINE-STRUCTURE-DAMAGE',c.detail||'岁运损伤原主功执行器/桥/结果。');
    else if(c.type==='identity_arrival'&&(c.role==='actor'||c.role==='target'))addSupport('STAGE-MAINLINE-IDENTITY-ARRIVAL',c.detail||'原主功关键节点在当前时间层到位。');
    else if(c.type==='actor_capacity_changed')addSupport('STAGE-ACTOR-CAPACITY',c.detail||'原主功执行器承载得到加强。');
    else if(c.type==='composite_formation_change'){
      // 成局本身只说明结构改变，不自动判正反。
      cev.push(c.detail||'当前时间层形成新的复合结构，正反仍需回接原主功。');
    }
  }

  let status:StageZhengFanState='unclear',confidence:'high'|'medium'|'low'='low';
  const hardConflict=conflict.some(x=>['STAGE-ORIGINAL-COMBINE-RELEASED','STAGE-ORIGINAL-CLASH-PROTECTED','STAGE-CONTROL-EDGE-IMPAIRED','STAGE-RESULT-INTEGRITY-DAMAGE'].includes(x));
  if(base==='zheng'){
    if(hardConflict&&support.length){status='partial_fan';confidence='high';}
    else if(hardConflict||conflict.length>=2){status='fan';confidence=hardConflict?'high':'medium';}
    else if(support.length>=2){status='strengthened_zheng';confidence='medium';}
    else if(!conflict.length){status='maintained_zheng';confidence=support.length?'medium':'low';}
    else {status='partial_fan';confidence='medium';}
  }else if(base==='fan'){
    if(conflict.length&&!support.length){status='maintained_fan';confidence=hardConflict?'high':'medium';}
    else if(support.length&&!conflict.length){status='repair_candidate';confidence='medium';}
    else if(conflict.length&&support.length){status='mixed';confidence='medium';}
    else {status='maintained_fan';confidence='low';}
  }else{
    if(hardConflict){status='fan';confidence='medium';}
    else if(conflict.length&&support.length){status='mixed';confidence='medium';}
    else {status='unclear';confidence='low';}
  }

  return {stage:snap.stage,status,confidence,base_chart_status:base,support_axes:uniq(support),conflict_axes:uniq(conflict),evidence:uniq(ev),counter_evidence:uniq(cev),
    executor_state:d.executor_state||'unknown',control_edge_state:d.control_edge_state||'unknown',target_state:d.target_state||'unknown',completion_before:d.completion_before??null,
    completion_after_candidate:d.completion_after_candidate??null,residual_change_candidate:d.residual_change_candidate??null,integrity_after_candidate:d.integrity_after_candidate??null,
    ownership_after_candidate:d.ownership_after_candidate??null,alignment_after_candidate:d.alignment_after_candidate??null,major_conclusion_allowed:false,event_conclusion_allowed:false,
    note:'StageZhengFan 只消费当前时间层 stage_changes，比较同一原局主功的执行器—控制边—目标—结算状态；大运证据不会在流年/流月重复计票。'};
}

export function resolveStageZhengFan(chartZF:ChartZhengFanV2Result,timing:any){
  if(!timing?.state_replay?.available)return {available:false,mode:'stage_zheng_fan_v1',snapshots:[],note:'没有可重演的原局第一主功，StageZhengFan 不强判。'};
  const snaps=(timing.state_replay.snapshots||[]).filter((x:any)=>['dayun','liunian','liuyue'].includes(x.stage));
  const rows:StageZhengFanSnapshot[]=[];
  let effective:ZhengFanState=chartZF?.status||'unclear';
  let previous:StageZhengFanState|null=null;
  for(const snap of snaps){
    const row=classify(effective,snap);
    row.previous_stage_status=previous;
    if(['fan','maintained_fan'].includes(row.status))effective='fan';
    else if(['maintained_zheng','strengthened_zheng'].includes(row.status))effective='zheng';
    else if(['partial_fan','mixed'].includes(row.status))effective='mixed';
    // repair_candidate 只是“修复候选”，证据不足以把正式反局直接翻成正局；下一层仍沿上一正式方向继续看。
    row.effective_direction_after=effective;
    rows.push(row);previous=row.status;
  }
  return {available:true,mode:'stage_zheng_fan_v1',version:'v2.5.3-incremental',original_chart_status:chartZF?.status||'unclear',dayun:rows.find(x=>x.stage==='dayun')||null,liunian:rows.find(x=>x.stage==='liunian')||null,liuyue:rows.find(x=>x.stage==='liuyue')||null,snapshots:rows,
    major_conclusion_allowed:false,event_conclusion_allowed:false,note:'按原局→大运→流年→流月顺序传递上一层有效方向；每层只消费本层增量。修复候选不会在证据不足时自动翻转正式方向。'};
}
