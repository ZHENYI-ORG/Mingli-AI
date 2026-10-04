export type ZhengFanState='zheng'|'fan'|'mixed'|'unclear';
export type AxisDirection='support'|'conflict'|'neutral'|'unknown';

export interface ZhengFanAxis {
  id:string;
  direction:AxisDirection;
  confidence:'high'|'medium'|'low';
  weight:number;
  evidence:string[];
  nodeIds?:string[];
  relationIds?:string[];
  sourceRule?:string;
  scope?:'chart'|'path'|'settlement'|'governance';
}

export interface OriginalIntentGraph {
  primaryPathId:string|null;
  action:string;
  actorNodeIds:string[];
  targetNodeIds:string[];
  bridgeNodeIds:string[];
  controlRelationIds:string[];
  resultSignatures:string[];
  completion:string;
  residualTargetIds:string[];
  resultIntegrity:string;
  ownership:string;
  alignment:string;
  qishiTargetElement:string|null;
  qishiElements:string[];
}

export interface ChartZhengFanV2Result {
  status:ZhengFanState;
  candidate_status:ZhengFanState;
  confidence:'high'|'medium'|'low';
  candidate_confidence:'high'|'medium'|'low';
  path_candidate_status:ZhengFanState;
  path_candidate_confidence:'high'|'medium'|'low';
  chart_evidence_status:ZhengFanState;
  chart_evidence_confidence:'high'|'medium'|'low';
  mode:'chart_zheng_fan_v2_settlement';
  version:'v2.5.4-chart-first';
  source_governance_mode:'explicit_candidate_vs_release';
  source_governed:boolean;
  source_status:ZhengFanState|null;
  source_disagreement:boolean;
  original_intent_graph:OriginalIntentGraph;
  direction_context:any;
  axes:ZhengFanAxis[];
  support_score:number;
  conflict_score:number;
  decisive_axis_ids:string[];
  evidence:string[];
  counter_evidence:string[];
  major_conclusion_allowed:false;
  event_conclusion_allowed:false;
  note:string;
}

const uniq=<T>(xs:T[])=>[...new Set(xs)];
const CONTROL_ACTIONS=new Set(['control','remove','transform']);
const JOIN_TYPES=new Set(['stem_combine','branch_combine','dark_combine','stem_branch_combine']);
function isHostActor(guestHost:any,id:string){return ['host','host_proxy_by_day_party'].includes(guestHost?.nodeStates?.[id]?.gongSide||guestHost?.nodeStates?.[id]?.bookSide||'');}
function pathActors(path:any):string[]{return uniq([...(path?.leadActorNodes?.length?path.leadActorNodes:path?.actorNodes||[])]);}
function relationTouches(r:any,a:string,b:string){const ns=r?.nodes||[];return ns.includes(a)&&ns.includes(b);}

function scoreAxes(axes:ZhengFanAxis[]){
  const directional=axes.filter(x=>x.direction==='support'||x.direction==='conflict');
  const support=directional.filter(x=>x.direction==='support').reduce((n,x)=>n+x.weight,0);
  const conflict=directional.filter(x=>x.direction==='conflict').reduce((n,x)=>n+x.weight,0);
  const highSupport=directional.some(x=>x.direction==='support'&&x.confidence==='high');
  const highConflict=directional.some(x=>x.direction==='conflict'&&x.confidence==='high');
  return {directional,support,conflict,highSupport,highConflict};
}

function classifyDirectional(axes:ZhengFanAxis[],thresholds:{fan:number;zheng:number}={fan:6,zheng:5}):{status:ZhengFanState;confidence:'high'|'medium'|'low';support:number;conflict:number}{
  const {support,conflict,highSupport,highConflict}=scoreAxes(axes);
  if(highSupport&&highConflict&&Math.abs(support-conflict)<2)return {status:'mixed',confidence:'high',support,conflict};
  if(conflict>=thresholds.fan&&conflict>=support+2)return {status:'fan',confidence:highConflict||conflict>=9?'high':'medium',support,conflict};
  if(support>=thresholds.zheng&&support>=conflict+2)return {status:'zheng',confidence:highSupport||support>=8?'high':'medium',support,conflict};
  if(support>0&&conflict>0)return {status:'mixed',confidence:(highSupport||highConflict)?'high':'medium',support,conflict};
  if(support>0)return {status:'zheng',confidence:'low',support,conflict};
  if(conflict>0)return {status:'fan',confidence:'low',support,conflict};
  return {status:'unclear',confidence:'low',support,conflict};
}

function candidateFromAxes(axes:ZhengFanAxis[]):{status:ZhengFanState;confidence:'high'|'medium'|'low';support:number;conflict:number}{
  // 正反局是 chart-level 方向判断。先裁整盘方向事实；path/Settlement 只在整盘证据不足时补充，
  // 避免“某条第一主功局部顺畅”覆盖“日柱与全局之意明确相反”的来源事实。
  const all=scoreAxes(axes);
  const chartAxes=axes.filter(x=>x.scope==='chart'&&(x.direction==='support'||x.direction==='conflict'));
  if(chartAxes.length){
    const chart=classifyDirectional(chartAxes,{fan:4,zheng:3});
    if(chart.status==='zheng'||chart.status==='fan')return {status:chart.status,confidence:chart.confidence,support:all.support,conflict:all.conflict};
    if(chart.status==='mixed')return {status:'mixed',confidence:chart.confidence,support:all.support,conflict:all.conflict};
  }
  const pathAxes=axes.filter(x=>x.scope!=='governance');
  const fallback=classifyDirectional(pathAxes);
  return {status:fallback.status,confidence:fallback.confidence,support:all.support,conflict:all.conflict};
}

export function resolveChartZhengFanV2(ctx:{facts:any;relations:any[];intents:any[];qishi:any;guestHost:any;directionContext:any;paths:any[];mainline:any;}):ChartZhengFanV2Result{
  const {facts,relations,qishi,guestHost,directionContext,mainline}=ctx;
  const primary=mainline?.primary||null;
  const s=primary?.settlement||null;
  const tg=s?.targetGraph||{};
  const actorIds=pathActors(primary);
  const targetIds=uniq<string>(tg.primaryTargets||primary?.targetNodes||[]);
  const bridgeIds=uniq<string>(tg.bridges||primary?.bridgeNodes||[]);
  const controlIds=uniq<string>(s?.controlEvidenceRelationIds||[]);
  const resultSignatures=uniq<string>((s?.magnitude?.contributions||[]).map((x:any)=>x.resultSignature).filter(Boolean));
  const axes:ZhengFanAxis[]=[];
  const push=(a:ZhengFanAxis)=>axes.push(a);
  const q=qishi?.dominant;

  const graph:OriginalIntentGraph={
    primaryPathId:primary?.id||null,action:s?.operationalIntent?.action||'unknown',actorNodeIds:actorIds,targetNodeIds:targetIds,bridgeNodeIds:bridgeIds,
    controlRelationIds:controlIds,resultSignatures,completion:s?.completion||'none',residualTargetIds:uniq<string>(s?.residualTargetIds||[]),resultIntegrity:s?.resultIntegrity||'unknown',
    ownership:primary?.ownership?.result||'unclear',alignment:s?.alignment||'unknown',qishiTargetElement:q?.targetElement||null,qishiElements:uniq<string>(q?.elements||[])
  };
  const dcStatus=directionContext?.status as ZhengFanState|undefined;

  // 来源治理不是候选评分轴。旧 Direction Context 是已经通过来源命例冻结的正式方向层，V2 必须把“候选算法”和“正式发布状态”分开公开。
  if(dcStatus==='zheng'||dcStatus==='fan')push({id:'ZF2-SOURCE-GOVERNANCE',direction:'neutral',confidence:'high',weight:0,evidence:[`冻结来源方向=${dcStatus}；V2 独立计算 candidate_status，正式 status 在没有新来源金标准前保留来源结论。`],sourceRule:'ZF-SOURCE-GOVERNANCE-001',scope:'governance'});
  else if(dcStatus==='mixed')push({id:'ZF2-SOURCE-CONTEXT-MIXED',direction:'neutral',confidence:'medium',weight:0,evidence:['来源 Direction Context 本身混合；V2 不压成单向。'],sourceRule:'ZF-SOURCE-GOVERNANCE-001',scope:'governance'});

  // Direction Context 的最终 status 不参与 candidate 计算，但其中逐条 rule_hits 是书本化的整盘方向事实。
  // V2 直接消费这些原始事实，而不是读取旧版最终结论；这样既保留来源证据，又避免 SOURCE-GOLD-GUARD 式静默覆盖。
  const chartRuleOccurrences=new Map<string,number>();
  for(const h of directionContext?.rule_hits||[]){
    if(h?.side!=='zheng'&&h?.side!=='fan')continue;
    const direction:AxisDirection=h.side==='zheng'?'support':'conflict';
    const w=Math.max(1,Number(h.weight)||1);
    const rawId=String(h.id||'RULE');
    const occurrence=(chartRuleOccurrences.get(rawId)||0)+1; chartRuleOccurrences.set(rawId,occurrence);
    // 同一书本规则可在不同柱/不同关系上多次命中。axis id 必须按出现次序稳定唯一，
    // 否则 Evidence/UI 会把两条真实证据错误合并成同一个键。
    push({id:`ZF2-CHART-${rawId}-${occurrence}`,direction,confidence:w>=5?'high':w>=3?'medium':'low',weight:w,evidence:[String(h.detail||h.id||'chart-level direction fact')],sourceRule:rawId,scope:'chart'});
  }

  if(primary&&s){
    // 1. 正反局核心只认“做功之意是否与全局/主位方向一致”。完成度属于成败，不直接等于正/反。
    if(s.alignment==='aligned')push({id:'ZF2-MAINLINE-ALIGNMENT',direction:'support',confidence:'high',weight:6,evidence:uniq<string>(s.alignmentEvidence||['第一主功之意与主位/全局方向一致']),nodeIds:[...actorIds,...targetIds],sourceRule:'BLIND-ZF-INTENT-ALIGN-001',scope:'path'});
    else if(s.alignment==='conflicting')push({id:'ZF2-MAINLINE-ALIGNMENT',direction:'conflict',confidence:'high',weight:7,evidence:uniq<string>(s.alignmentEvidence||['第一主功之意与主位/全局方向相反']),nodeIds:[...actorIds,...targetIds],sourceRule:'BLIND-ZF-INTENT-ALIGN-001',scope:'path'});
    else if(s.alignment==='mixed')push({id:'ZF2-MAINLINE-ALIGNMENT-MIXED',direction:'neutral',confidence:'medium',weight:0,evidence:uniq<string>(s.alignmentEvidence||['主功方向同时存在同向与逆向证据']),sourceRule:'BLIND-ZF-INTENT-ALIGN-001',scope:'path'});

    // 2. 控制边失效只说明“没做成”，不是反局；只有出现保护/反向取得等改变原意的关系才进 conflict。
    const controlStates=(s.edgeFunctionalStates||[]).filter((x:any)=>x.role==='control'||controlIds.includes(x.relationId));
    const blocked=controlStates.filter((x:any)=>x.status==='blocked');
    const constrained=controlStates.filter((x:any)=>x.status==='constrained');
    if(blocked.length)push({id:'ZF2-CONTROL-EDGE-BLOCKED',direction:'neutral',confidence:'medium',weight:0,evidence:[...blocked.flatMap((x:any)=>x.evidence||[]),'控制边被阻断只说明原功失败/受阻；没有反向意图证据时不叫反局。'],relationIds:blocked.map((x:any)=>x.relationId),sourceRule:'BLIND-ZF-FAILURE-NOT-REVERSE-001',scope:'settlement'});
    else if(constrained.length)push({id:'ZF2-CONTROL-EDGE-CONSTRAINED',direction:'neutral',confidence:'low',weight:0,evidence:[...constrained.flatMap((x:any)=>x.evidence||[]),'控制边受限只降低完成度，不自动判反。'],relationIds:constrained.map((x:any)=>x.relationId),sourceRule:'BLIND-ZF-FAILURE-NOT-REVERSE-001',scope:'settlement'});

    if(CONTROL_ACTIONS.has(graph.action)){
      const primaryRelSet=new Set<string>(primary.relationIds||[]);const protective:any[]=[];
      for(const tid of targetIds)for(const aid of actorIds){
        if(!isHostActor(guestHost,aid))continue;
        for(const r of relations)if(JOIN_TYPES.has(r.type)&&!primaryRelSet.has(r.id)&&relationTouches(r,aid,tid))protective.push(r);
      }
      if(protective.length)push({id:'ZF2-TARGET-PROTECTED-OUTSIDE-MAINLINE',direction:'conflict',confidence:'high',weight:6,evidence:protective.map((r:any)=>`原主功本欲制/去目标，但主位/同党又以${r.type}合护同一目标，属于改变原意的反向证据。`),relationIds:uniq(protective.map((r:any)=>r.id)),sourceRule:'BLIND-ZF-PROTECT-TARGET-001',scope:'path'});
    }

    if(s.completion==='counterproductive')push({id:'ZF2-RESULT-COUNTERPRODUCTIVE',direction:'conflict',confidence:'high',weight:7,evidence:['Settlement 已确认作用出现 counterproductive：不是单纯未完成，而是结果朝相反方向运行。'],nodeIds:targetIds,sourceRule:'BLIND-ZF-COUNTERPRODUCTIVE-001',scope:'settlement'});
    else if(s.completion==='complete')push({id:'ZF2-RESULT-COMPLETE-NEUTRAL',direction:'neutral',confidence:'medium',weight:0,evidence:['第一主功已做成；完成度只回答“做没做成”，不回答“方向正不正”。'],nodeIds:targetIds,sourceRule:'BLIND-ZF-COMPLETION-SEPARATION-001',scope:'settlement'});
    else if(['partial','broken','acting'].includes(s.completion))push({id:'ZF2-RESULT-INCOMPLETE-NEUTRAL',direction:'neutral',confidence:'medium',weight:0,evidence:[`第一主功完成度=${s.completion}；失败、残余、受损与“反局”严格分层。`],nodeIds:uniq<string>([...targetIds,...(s.residualTargetIds||[])]),sourceRule:'BLIND-ZF-COMPLETION-SEPARATION-001',scope:'settlement'});

    // 3. 党势只在“主功实际向党外目标发力”时提供方向证据，党内流转不重复计正局。
    const bp=primary.book_party_projection;
    if(bp?.projectsOutside)push({id:'ZF2-PARTY-PROJECTION',direction:'support',confidence:'medium',weight:3,evidence:['第一主功由已成党一方向党外来源目标发力，与党势实际所做之功一致。'],nodeIds:[...actorIds,...targetIds],sourceRule:'BLIND-PARTY-PROJECTION-001',scope:'path'});
    else if(bp?.internalCirculation)push({id:'ZF2-PARTY-INTERNAL',direction:'neutral',confidence:'low',weight:0,evidence:['当前路径只是党内相生/流转，不把同一“顺势”事实重复算成正局分。'],sourceRule:'BLIND-PARTY-PROJECTION-001',scope:'path'});
  }

  const chartEvidence=classifyDirectional(axes.filter(x=>x.scope==='chart'&&(x.direction==='support'||x.direction==='conflict')),{fan:4,zheng:3});
  const pathCandidate=classifyDirectional(axes.filter(x=>['path','settlement'].includes(String(x.scope))&&(x.direction==='support'||x.direction==='conflict')));
  const candidate=candidateFromAxes(axes);
  const sourceGoverned=dcStatus==='zheng'||dcStatus==='fan';
  const sourceStatus=sourceGoverned?dcStatus!:null;
  const status:ZhengFanState=sourceGoverned?dcStatus!:candidate.status;
  const sourceDisagreement=!!(sourceGoverned&&candidate.status!=='unclear'&&candidate.status!==dcStatus&&candidate.status!=='mixed');
  const confidence:'high'|'medium'|'low'=sourceGoverned?(sourceDisagreement?'medium':(directionContext?.confidence||'medium')):candidate.confidence;
  if(sourceDisagreement)push({id:'ZF2-SOURCE-DISAGREEMENT',direction:'neutral',confidence:'high',weight:0,evidence:[`V2 candidate_status=${candidate.status} 与冻结来源 status=${dcStatus} 不同；张力显式暴露，禁止静默覆盖，也禁止无新来源直接翻盘。`],sourceRule:'ZF-SOURCE-GOVERNANCE-001',scope:'governance'});

  const decisive=axes.filter(x=>(x.direction==='support'||x.direction==='conflict')&&x.weight>=4).map(x=>x.id);
  return {status,candidate_status:candidate.status,confidence,candidate_confidence:candidate.confidence,path_candidate_status:pathCandidate.status,path_candidate_confidence:pathCandidate.confidence,chart_evidence_status:chartEvidence.status,chart_evidence_confidence:chartEvidence.confidence,mode:'chart_zheng_fan_v2_settlement',version:'v2.5.4-chart-first',source_governance_mode:'explicit_candidate_vs_release',source_governed:sourceGoverned,source_status:sourceStatus,source_disagreement:sourceDisagreement,
    original_intent_graph:graph,direction_context:directionContext||null,axes,support_score:candidate.support,conflict_score:candidate.conflict,decisive_axis_ids:decisive,
    evidence:uniq(axes.filter(x=>x.direction==='conflict').flatMap(x=>x.evidence)),counter_evidence:uniq(axes.filter(x=>x.direction==='support').flatMap(x=>x.evidence)),major_conclusion_allowed:false,event_conclusion_allowed:false,
    note:'v2.5.4 将整盘方向 candidate_status 与 path_candidate_status 分层：先裁 chart-level 书本方向事实，再用第一主功 Settlement 作交叉验证；局部主功顺畅不得覆盖整盘反向证据。正反局判断核心是日柱做功之意与全局之意是否一致；做成/没做成、功量大小不再偷换为正/反。'};
}
