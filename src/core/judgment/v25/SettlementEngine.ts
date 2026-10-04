import type { GongPath } from '../types';
import type {
  AlignmentState, CompletionState, DependencyEdge, EfficiencyResult, ExecutionMode,
  GongSettlement, MagnitudeContribution, MagnitudeResult, ResultIntegrityState,
  SettlementContext, StructureLevel, TargetGraph, TargetResolution
} from './types';

const OUTPUT_GODS = new Set(['食神','伤官']);
const WEALTH_GODS = new Set(['正财','偏财']);
const OFFICIAL_GODS = new Set(['正官','七杀']);
const RESOURCE_GODS = new Set(['正印','偏印']);
const PEER_GODS = new Set(['比肩','劫财']);

const uniq = <T>(arr:T[]):T[] => [...new Set(arr.filter(Boolean as any))];

function family(god?:string):string {
  if(!god)return 'unknown';
  if(WEALTH_GODS.has(god))return 'wealth';
  if(OFFICIAL_GODS.has(god))return 'official';
  if(RESOURCE_GODS.has(god))return 'resource';
  if(OUTPUT_GODS.has(god))return 'output';
  if(PEER_GODS.has(god))return 'peer';
  if(god==='日元')return 'self';
  return god;
}

function semanticsByRelation(ctx:SettlementContext):Map<string,any[]> {
  const m=new Map<string,any[]>();
  for(const s of ctx.semantics||[]){
    if(!m.has(s.relationId))m.set(s.relationId,[]);
    m.get(s.relationId)!.push(s);
  }
  return m;
}

function semanticGate(path:GongPath,ctx:SettlementContext){
  const by=semanticsByRelation(ctx);
  const passed:string[]=[];const conditional:string[]=[];const failed:string[]=[];
  for(const id of path.relationIds||[]){
    const rows=by.get(id)||[];
    if(!rows.length){ conditional.push(id); continue; }
    if(rows.some(x=>x.gate==='failed'))failed.push(id);
    else if(rows.some(x=>x.gate==='passed'))passed.push(id);
    else {
      const rel=ctx.relations.find((r:any)=>r.id===id);
      // 穿的通用 RelationSemantic 保持 conditional；只有枚举器已经通过 A 级“唯一主方制局方向”门的
      // wear_control 路径，才在本路径结算中把该穿关系视为可执行证据。绝不回写全局关系语义。
      const wearGate=(path as any).source_gate;
      const productionWearGates=new Set(['explicit_formation_direction','source_profile_host_direction','day_body_tomb_proxy_direction','qishi_direction','unique_host_control_direction','day_branch_pierces_guest_yangren']);
      const bookPartyGate=(path as any).actionMode==='book_party_control'&&(path as any).bookPartyBased===true&&((path as any).source_gated_relation_ids||[]).includes(id);
      if((path as any).actionMode==='wear_control'&&productionWearGates.has(wearGate)&&rel?.type==='harm')passed.push(id);
      else if(bookPartyGate&&['clash','control','brittle_control','dampen_fire','branch_combine','stem_branch_combine'].includes(rel?.type))passed.push(id);
      else conditional.push(id);
    }
  }
  return {passed:uniq(passed),conditional:uniq(conditional),failed:uniq(failed)};
}

function executionMode(path:any,ctx:SettlementContext):ExecutionMode {
  if(path.type==='hua_yong')return 'serial_transform';
  if(path.type==='sheng_yong'||path.type==='xie_yong')return 'generation_output';
  if(path.type==='mu_yong')return 'storage_capture';
  if(path.type==='he_yong')return 'direct_combine';
  if(path.type==='composite')return 'composite';
  if(path.type==='zhi_yong'){
    // Candidate-only schools/conditional mechanisms must never masquerade as proven direct control.
    if(['piercing_control_candidate','punish_control_candidate','absolute_control_candidate'].includes(path.actionMode))return 'unknown';
    if(path.actionMode==='special_control')return 'special_control';
    if(path.actionMode==='clash_control'||path.actionMode==='clash_take')return 'clash_control';
    if(path.actionMode==='wear_control')return 'penetration_assisted_control';
    if(path.actionMode==='qishi_control'||path.actionMode==='book_party_control'){
      const rels=(path.relationIds||[]).map((id:string)=>ctx.relations.find(r=>r.id===id)).filter(Boolean);
      const hasClash=rels.some((r:any)=>r.type==='clash');
      const hasControl=rels.some((r:any)=>['control','brittle_control','dampen_fire'].includes(r.type));
      const hasHarm=rels.some((r:any)=>r.type==='harm');
      const hasSourceGatedCombine=rels.some((r:any)=>['branch_combine','stem_branch_combine'].includes(r.type)&&((path as any).source_gated_relation_ids||[]).includes(r.id));
      if(hasHarm&&(hasClash||hasControl))return 'penetration_assisted_control';
      if(hasClash)return 'clash_control';
      if(hasControl||hasSourceGatedCombine)return 'formation_control';
      return 'unknown';
    }
    return 'direct_control';
  }
  return 'unknown';
}

function controlEvidence(path:any,ctx:SettlementContext):string[]{
  const actors=new Set(path.leadActorNodes?.length?path.leadActorNodes:path.actorNodes||[]);
  const targets=new Set(path.targetNodes||[]);
  const out:string[]=[];
  for(const id of path.relationIds||[]){
    const r=ctx.relations.find(x=>x.id===id);if(!r)continue;
    if(['control','brittle_control','dampen_fire'].includes(r.type)){
      if(!r.direction){out.push(id);continue;}
      const [from,to]=String(r.direction).split('>');
      if(actors.has(from)&&targets.has(to))out.push(id);
    }else if(r.type==='clash'){
      const ns=r.nodes||[];
      if(ns.some((x:string)=>actors.has(x))&&ns.some((x:string)=>targets.has(x)))out.push(id);
    }else if(['branch_combine','stem_branch_combine'].includes(r.type)&&path.actionMode==='book_party_control'&&((path as any).source_gated_relation_ids||[]).includes(id)){
      // 书本已成立党势 + 来源允许目标类型时，合可以作为该党势落地的制用执行边；只在本路径生效。
      const ns=r.nodes||[];
      if(ns.some((x:string)=>actors.has(x))&&ns.some((x:string)=>targets.has(x)))out.push(id);
    }else if(r.type==='harm'&&path.actionMode==='wear_control'){
      // 穿只有在 GongPathEnumerator 已通过 A 级上下文门并显式标为 wear_control 时，才可作为 Settlement 控制证据。
      // 普通 harm / B级固定方向候选仍不得在这里自动升级。
      const ns=r.nodes||[];
      if(ns.some((x:string)=>actors.has(x))&&ns.some((x:string)=>targets.has(x)))out.push(id);
    }
  }
  return uniq(out);
}

function structuralEligibility(path:any,ctx:SettlementContext,gate:ReturnType<typeof semanticGate>,controls:string[]):{eligibility:'valid'|'candidate'|'invalid';evidence:string[];counter:string[]} {
  const evidence:string[]=[];const counter:string[]=[];
  if(gate.failed.length){counter.push(`存在语义失败关系：${gate.failed.join(',')}`);return {eligibility:'invalid',evidence,counter};}
  if(!(path.relationIds||[]).length){counter.push('路径没有关系事实');return {eligibility:'invalid',evidence,counter};}
  // 结构事实存在不等于执行器有承载能力。沿用 v2.4 Root/GuestHost 已经验证过的 actorCapable 事实，
  // 但把它从粗 status 提升为 Settlement eligibility 门。
  if(['zhi_yong','sheng_yong','xie_yong'].includes(path.type) && path.validation?.actorCapable===false && !path.qishiBased){
    counter.push('执行器缺少足够根气/主位承载，关系存在但暂不具备完成主功的能力');
    return {eligibility:'candidate',evidence,counter};
  }
  if(path.type==='he_yong'){
    // 合用只允许日干/日支标准入口。日干合财需要承载，或满足“财虚透”的书源例外；
    // 日干合官不把日主承载设成同一硬门。日支合按主位关系继续结算。
    if(!['day_master','day_branch'].includes(path.combineActor||'')){
      counter.push('标准合用只接受日干或日支直接参与；其它日时/代理主方之合保留在关系/党势层，不升级通用合用主功');
      return {eligibility:'candidate',evidence,counter};
    }
    if(path.combineActor==='day_master'&&path.combineTargetFamily==='wealth'&&path.wealthCapacityOk!==true){
      counter.push('日干合财存在意向，但当前未满足承载条件，且目标不是可用“财虚透”例外；合关系保留，取得结构暂不成立');
      return {eligibility:'candidate',evidence,counter};
    }
    if(path.combineActor==='day_master')evidence.push(path.combineTargetFamily==='wealth'?'日干合财通过承载/财虚透门':'日干直接合官/合用，进入合用结算');
    else evidence.push('日支直接参与合，按主位合用/收留结构结算');
  }
  if(path.type==='zhi_yong'){
    const relRows=(path.relationIds||[]).map((id:string)=>ctx.relations.find(r=>r.id===id)).filter(Boolean);
    const onlyPlainBranchControl=relRows.length===1&&relRows[0]?.type==='control'&&relRows[0]?.medium==='branch'&&!path.qishiBased;
    if(onlyPlainBranchControl){
      counter.push('仅普通相邻地支五行克，没有冲/成势/其它闭环；保留控制候选，不升级有效制用');
      return {eligibility:'candidate',evidence,counter};
    }
    if(path.actionMode==='qishi_control' && !controls.length){
      counter.push('气势制用缺少独立 control/clash 控制证据；合、穿、刑本身不自动升级为制');
      return {eligibility:'candidate',evidence,counter};
    }
    if(['direct_control','clash_control','clash_take','wear_control'].includes(path.actionMode)||controls.length)evidence.push('制用存在独立控制证据');
  }
  if(path.type==='mu_yong'&&path.toolStorageConstraint===true){
    counter.push(`入墓对象同时是其它有效制局的执行工具（${(path.toolStorageCompetingPathIds||[]).join(',')}）；此墓优先解释为工具受限/效率损失，不独立升级高效墓用主功`);
    return {eligibility:'candidate',evidence,counter};
  }
  if(path.type==='hua_yong'){
    if((path.bridgeNodes||[]).length<1||(path.relationIds||[]).length<2){counter.push('化用缺少桥节点或连续两段关系');return {eligibility:'invalid',evidence,counter};}
    evidence.push('官杀→印→主位连续链结构存在');
  }
  if(path.type==='composite'){
    if(!(path.bridgeNodes||[]).length){counter.push('复合路径缺少共享/桥节点');return {eligibility:'candidate',evidence,counter};}
    if(path.compositeComponentsComplete===false){
      counter.push('复合父链至少一个子路径尚未独立 valid + complete；父链不得越级成为正式主功');
      return {eligibility:'candidate',evidence,counter};
    }
    if(path.compositeComponentsComplete===true)evidence.push('复合父链的直接子路径均已独立完成，允许进入父链结算');
  }
  if(path.forceConditional||gate.conditional.length){
    counter.push(path.forceConditional?'路径被来源规则强制降级为候选':'至少一条关系语义仍为 conditional');
    return {eligibility:'candidate',evidence,counter};
  }
  evidence.push('路径关系语义门全部通过');
  return {eligibility:'valid',evidence,counter};
}

function targetGraph(path:any,ctx:SettlementContext):TargetGraph {
  const storages:string[]=[];
  if(path.type==='mu_yong')storages.push(...(path.resultNodes||[]));
  // v2.5：旧 GongPath 的 targetNodes 有时是“结果端”而不是“被处理对象”。
  // 化用中官杀是被转化对象，印是桥，主位是结果端；Settlement 必须恢复真实目标。
  const primaryTargets:string[] = path.type==='hua_yong'
    ? uniq<string>((path.actorNodes||[]) as string[])
    : uniq<string>((path.targetNodes||[]) as string[]);
  const origins:string[]=[];
  const originMap=new Map((ctx.origins||[]).map((x:any)=>[x.nodeId,x]));
  for(const id of primaryTargets){
    const o:any=originMap.get(id);
    for(const x of o?.sourceNodes||o?.sourceNodeIds||[])origins.push(x);
  }
  return {
    primaryTargets,origins:uniq<string>(origins),storages:uniq<string>(storages),
    carriers:uniq<string>((path.resultNodes||[]) as string[]),bridges:uniq<string>((path.bridgeNodes||[]) as string[]),dependentTargets:[]
  };
}

function relationSemanticState(id:string,ctx:SettlementContext):'passed'|'conditional'|'failed'|'unknown'{
  const rows=(ctx.semantics||[]).filter((x:any)=>x.relationId===id);
  if(rows.some((x:any)=>x.gate==='failed'))return 'failed';
  if(rows.some((x:any)=>x.gate==='passed'))return 'passed';
  if(rows.some((x:any)=>x.gate==='conditional'))return 'conditional';
  return 'unknown';
}

function resolveTargets(path:any,targetIds:string[],ctx:SettlementContext,eligibility:'valid'|'candidate'|'invalid',controls:string[]):TargetResolution[]{
  const out:TargetResolution[]=[];
  for(const targetId of uniq<string>(targetIds)){
    const relIds=path.type==='hua_yong'
      ? [...(path.relationIds||[])]
      : (path.relationIds||[]).filter((id:string)=>{
          const r=ctx.relations.find(x=>x.id===id);return r&&(r.nodes||[]).includes(targetId);
        });
    const states=relIds.map((id:string)=>relationSemanticState(id,ctx));
    const evidence:string[]=[];const counterEvidence:string[]=[];
    let state:TargetResolution['state']='acting';
    if(eligibility==='invalid'){state='untouched';counterEvidence.push('结构不合法');}
    else if(path.type==='zhi_yong'){
      const ownControls=controls.filter(id=>relIds.includes(id));
      if(ownControls.length&&eligibility==='valid'){state='resolved';evidence.push('目标存在独立 control/clash 控制证据');}
      else if(ownControls.length){state='residual';evidence.push('存在控制动作但路径仍有条件门');}
      else {state='residual';counterEvidence.push('目标没有独立控制证据');}
    }else if(path.type==='he_yong'){
      if(states.includes('passed')&&eligibility==='valid'){state='resolved';evidence.push(path.acquisitionConfirmed===true?'日干/日支合用通过取得门，结构目标已结算':'合关系已形成收留/连接闭环；这里只确认结构完成，不等同现实取得');}
      else {state='residual';counterEvidence.push('合关系仍有条件，或日干合财尚未通过承载门');}
    }else if(path.type==='hua_yong'){
      if(eligibility==='valid'&&states.length>=1&&!states.includes('conditional')&&!states.includes('failed')){state='resolved';evidence.push('连续化用链语义完整');}
      else {state='residual';counterEvidence.push('化用链存在条件门或结构不完整');}
    }else if(path.type==='sheng_yong'||path.type==='xie_yong'){
      if(states.includes('passed')&&eligibility==='valid'){state='resolved';evidence.push('生泄关系语义通过');}
      else {state='acting';counterEvidence.push('生泄方向存在，但结果完成度未被充分证明');}
    }else if(path.type==='mu_yong'){
      const factual=(path.relationIds||[]).some((id:string)=>{
        const r=ctx.relations.find(x=>x.id===id);return r&&['tomb_enter','multi_tomb_enter'].includes(r.type);
      });
      if(factual&&eligibility==='valid'){state='resolved';evidence.push('真实入墓事实成立');}
      else {state='residual';counterEvidence.push('仅墓库候选或存在条件门');}
    }else if(path.type==='composite'){
      if(eligibility==='valid'&&path.compositeComponentsComplete===true){
        state='resolved';
        evidence.push('两个直接衔接的子路径均已独立结算完成；复合父链据子链结果确认完成，不从标题机械推定。');
      }else{
        state=eligibility==='valid'?'acting':'residual';
        counterEvidence.push('复合父链至少有一个子路径尚未独立完成；保留过程态，不强判完成。');
      }
    }else state='acting';
    out.push({targetId,state,mechanisms:uniq<string>(relIds.map((id:string)=>String(ctx.relations.find(x=>x.id===id)?.type||'')).filter(Boolean)),relationIds:relIds,evidence,counterEvidence});
  }
  return out;
}

function completionFromTargets(path:any,eligibility:'valid'|'candidate'|'invalid',trs:TargetResolution[]):CompletionState{
  if(eligibility==='invalid')return 'none';
  if(!trs.length)return eligibility==='valid'?'acting':'none';
  const s=trs.map(x=>x.state);
  if(s.every(x=>x==='resolved'))return 'complete';
  if(s.some(x=>x==='resolved')&&s.some(x=>x!=='resolved'))return 'partial';
  if(s.some(x=>x==='residual'))return eligibility==='valid'?'partial':'acting';
  if(s.some(x=>x==='acting'))return 'acting';
  return 'none';
}

function integrity(gate:ReturnType<typeof semanticGate>,trs:TargetResolution[],completion:CompletionState):ResultIntegrityState{
  if(gate.failed.length||completion==='broken'||completion==='counterproductive')return 'broken';
  if(gate.conditional.length||trs.some(x=>['residual','escaped'].includes(x.state))||completion==='partial')return 'impaired';
  if(completion==='complete')return 'intact';
  return 'unknown';
}

function efficiency(path:any,ctx:SettlementContext,completion:CompletionState):EfficiencyResult{
  // Efficiency 与“链是否成立”分层：只有 valid/complete 的结构才定级；候选/未完成结构继续 unknown。
  // 定级只使用书中可程序化的结构供需、做功方式与已结算结果，不把课堂百分比伪装成概率。
  const cf=path.control_field;
  const hint=path.efficiencyHint;
  if(hint==='underutilized')return {class:'underutilized',grade:'low',confidence:'high',basis:'source_hint',executorUtilization:'low',targetSupply:'undersupplied',wastedCapacity:'medium',evidence:['来源/Benchmark 明确标记做功效率偏低或捕神过剩']};
  if(hint==='overloaded')return {class:'overloaded',grade:'low',confidence:'high',basis:'source_hint',executorUtilization:'high',targetSupply:'overloaded',wastedCapacity:'low',evidence:['来源/Benchmark 明确标记目标过重、执行能力不足']};
  if(hint==='matched')return {class:'matched',grade:'high',confidence:'high',basis:'source_hint',executorUtilization:'normal',targetSupply:'matched',wastedCapacity:'low',evidence:['来源/Benchmark 明确标记执行与目标匹配']};
  if(completion!=='complete'){
    return {class:'unknown',grade:'unknown',confidence:'high',basis:'insufficient',executorUtilization:'unknown',targetSupply:'unknown',wastedCapacity:'unknown',evidence:['做功链尚未完整结算；按“先判链成立、再判效率”的顺序，本层不提前定效率']};
  }

  // 制用优先消费捕神/贼神 ControlField。这里的“高/低”是结构利用率，不是财富概率。
  if(path.type==='zhi_yong'&&cf){
    if(cf.utilization==='high_utilization_candidate')return {class:'matched',grade:'high',confidence:'high',basis:'book_structural',executorUtilization:'high',targetSupply:'matched',wastedCapacity:'low',evidence:[`同一主要执行端覆盖${cf.targetCount}个独立目标，符合书中“一捕多贼、能量利用率高”的结构`,'效率只描述做功能量利用，不映射固定财富/官阶']};
    if(cf.utilization==='underutilized_candidate')return {class:'underutilized',grade:'low',confidence:'high',basis:'book_structural',executorUtilization:'low',targetSupply:'undersupplied',wastedCapacity:'high',evidence:[`${cf.primaryExecutorCount||cf.executorCount}个主要执行端围绕1个独立目标，符合“捕多贼少、用力多而目标少”的低利用结构`,'链仍可成立；效率低只影响成果与层次，不反推为无功']};
    if(cf.utilization==='balanced_candidate')return {class:'matched',grade:'medium',confidence:'high',basis:'book_structural',executorUtilization:'normal',targetSupply:'matched',wastedCapacity:'low',evidence:['主要执行端与独立目标数量匹配，捕贼供需未见明显浪费']};
  }

  // 其余已完成主功按“做功方式 + 已结算闭环”给定性等级；不做伪精确百分比。
  if(path.type==='zhi_yong'){
    const global=path.bookPartyBased===true||path.qishiBased===true;
    return {class:'matched',grade:global?'high':'medium',confidence:'medium',basis:'book_structural',executorUtilization:global?'high':'normal',targetSupply:'matched',wastedCapacity:'low',evidence:[global?'制用已完成且由成党/成势结构向外落实，结构利用率较高':'制用已形成独立控制闭环；未见捕多贼少等明显浪费证据']};
  }
  if(path.type==='he_yong'){
    const acquire=path.acquisitionConfirmed===true;
    return {class:'matched',grade:acquire?'high':'medium',confidence:'medium',basis:'book_structural',executorUtilization:acquire?'high':'normal',targetSupply:'matched',wastedCapacity:'low',evidence:[acquire?'日干/日支合用通过取得门且结构完成；合用属于直接作用，效率定为较高':'合用结构已完成，但当前更接近收留/连接，不把它夸大成高效取得']};
  }
  if(path.type==='hua_yong')return {class:'matched',grade:'medium',confidence:'medium',basis:'book_structural',executorUtilization:'normal',targetSupply:'matched',wastedCapacity:'low',evidence:['官杀→印→主位连续转化链完整，能量经桥节点转化后落到结果端']};
  if(path.type==='mu_yong'){
    const n=(path.targetNodes||[]).length;
    return {class:'matched',grade:n>=2?'high':'medium',confidence:'medium',basis:'book_structural',executorUtilization:n>=2?'high':'normal',targetSupply:'matched',wastedCapacity:'low',evidence:[n>=2?`同一墓库闭环收纳${n}个独立目标，属于多目标集中收纳的高利用结构`:'真实墓用闭环已完成，未见明显能量浪费']};
  }
  if(path.type==='sheng_yong'||path.type==='xie_yong')return {class:'matched',grade:'low',confidence:'medium',basis:'book_structural',executorUtilization:'normal',targetSupply:'matched',wastedCapacity:'medium',evidence:['生/泄链已完成，但普通能量传递不等同直接制、合、墓的大功；效率定为较低档而不是“证据不足”']};
  if(path.type==='composite')return {class:'matched',grade:'medium',confidence:'low',basis:'book_structural',executorUtilization:'normal',targetSupply:'matched',wastedCapacity:'low',evidence:['复合路径已完成；效率由多段闭环共同形成，暂只做定性中档，不压成伪精确分数']};
  return {class:'unknown',grade:'unknown',confidence:'high',basis:'insufficient',executorUtilization:'unknown',targetSupply:'unknown',wastedCapacity:'unknown',evidence:['当前做功类型没有足够书本结构规则用于效率定级']};
}

function signatureFor(path:any,targetIds:string[],ctx:SettlementContext):{signature:string;type:string;resultNodeIds:string[]}{
  const targetFamilies=uniq<string>(targetIds.map(id=>family(ctx.facts.byId[id]?.tenGod))).sort();
  const results=uniq<string>((path.resultNodes||[]) as string[]).sort();
  let disposition=path.type;
  if(path.type==='zhi_yong')disposition='control';
  if(path.type==='he_yong')disposition=path.acquisitionConfirmed===true?'combine_acquire':'combine_retain';
  if(path.type==='hua_yong')disposition='transform_to_host';
  if(path.type==='sheng_yong')disposition='generate_result';
  if(path.type==='xie_yong')disposition='output';
  if(path.type==='mu_yong')disposition='store_capture';
  const targetPart=path.type==='mu_yong'?`${targetFamilies.join('+')}@${results.join('+')}`:targetIds.sort().join('+');
  return {signature:`${disposition}:${targetPart}`,type:disposition,resultNodeIds:results};
}

function magnitude(path:any,ctx:SettlementContext,trs:TargetResolution[],completion:CompletionState):MagnitudeResult{
  const contributions:MagnitudeContribution[]=[];
  const resolved=trs.filter(x=>x.state==='resolved').map(x=>x.targetId);
  const partial=trs.filter(x=>['residual','acting'].includes(x.state)).map(x=>x.targetId);
  if(resolved.length){
    if(path.type==='mu_yong'){
      const s=signatureFor(path,resolved,ctx);
      contributions.push({resultSignature:s.signature,resultType:s.type,targetIds:resolved,resultNodeIds:s.resultNodeIds,sourcePathIds:[path.id],sourceRelationIds:uniq(path.relationIds||[]),independent:true,completion:'complete'});
    }else{
      for(const id of resolved){const s=signatureFor(path,[id],ctx);contributions.push({resultSignature:s.signature,resultType:s.type,targetIds:[id],resultNodeIds:s.resultNodeIds,sourcePathIds:[path.id],sourceRelationIds:uniq(path.relationIds||[]),independent:true,completion:'complete'});}
    }
  }else if(partial.length&&completion!=='none'){
    const s=signatureFor(path,partial,ctx);
    contributions.push({resultSignature:s.signature,resultType:s.type,targetIds:partial,resultNodeIds:s.resultNodeIds,sourcePathIds:[path.id],sourceRelationIds:uniq(path.relationIds||[]),independent:true,completion:'partial'});
  }
  const dedup=[...new Map(contributions.map(x=>[x.resultSignature,x])).values()];
  const n=dedup.length;
  const band=n===0?'none':n===1?'small':n===2?'medium':n===3?'large':'very_large';
  return {contributionCount:n,band,contributions:dedup,note:'功量只按独立 ResultSignature 计数；不按关系数量计功，也不映射固定财富金额/官阶。'};
}

function structureLevel(path:any,completion:CompletionState,ownership:any,ctx:SettlementContext):StructureLevel{
  if(completion==='none'||completion==='broken'||completion==='counterproductive')return 'L0';
  if(completion==='acting')return 'L2';
  const multi=(path.relationIds||[]).length>=2||path.type==='composite';
  const clear=ownership&&ownership.result&&ownership.result!=='unclear';
  // L5 只能由这条路径实际参与的党势/气势闭环抬升，不能因为整盘别处存在 qishi 就虚高。
  const q=path.qishiBased===true||path.book_party_projection?.projectsOutside===true;
  if(completion==='complete'&&multi&&clear&&q)return 'L5';
  if(completion==='complete'&&multi&&clear)return 'L4';
  if(completion==='complete')return 'L3';
  return 'L2';
}

function alignment(path:any,ctx:SettlementContext,completion:CompletionState,tg:TargetGraph):{state:AlignmentState;evidence:string[]}{
  const evidence:string[]=[];
  const isHost=(id:string)=>['host','host_proxy_by_day_party'].includes(ctx.guestHost?.nodeStates?.[id]?.gongSide||ctx.guestHost?.nodeStates?.[id]?.bookSide||'');
  const targetGods=(tg.primaryTargets||[]).map((id:string)=>ctx.facts.byId[id]?.tenGod).filter(Boolean);
  const dayIntent=(ctx.intents||[]).find((x:any)=>x.nodeId===ctx.facts.dayMasterNodeId)?.intents||[];
  const leadActors:string[]=(path.leadActorNodes?.length?path.leadActorNodes:path.actorNodes||[]);
  const hostActor=leadActors.some((id:string)=>isHost(id));
  let same=false,opposite=false;

  // 日干有明确求财/求官/输出意向时，只比较“同一件事”的路径方向；做成功与否不在此处代替正反。
  if(hostActor&&dayIntent.some((i:any)=>i.type==='seek_wealth')&&targetGods.some((g:string)=>WEALTH_GODS.has(g)))same=true;
  if(hostActor&&dayIntent.some((i:any)=>i.type==='seek_authority')&&targetGods.some((g:string)=>OFFICIAL_GODS.has(g)))same=true;
  if(path.type==='xie_yong'&&leadActors.includes(ctx.facts.dayMasterNodeId)&&dayIntent.some((i:any)=>i.type==='output'))same=true;
  if(hostActor){
    const actorIntents=leadActors.flatMap((id:string)=>((ctx.intents||[]).find((x:any)=>x.nodeId===id)?.intents||[]));
    if(path.type==='sheng_yong'&&actorIntents.some((i:any)=>i.type==='generate_wealth'))same=true;
    if(path.type==='hua_yong'&&actorIntents.some((i:any)=>i.type==='transform_pressure'))same=true;
    if(path.type==='zhi_yong'&&actorIntents.some((i:any)=>['control_authority','control_output','control_resource'].includes(i.type)))same=true;
  }

  // path-level zhengFan 已经只使用主位意向 + 成势目标，不是 Completion 分数；这里将它作为第二条独立方向证据。
  if(path.zhengFan==='zheng')same=true;
  if(path.zhengFan==='fan')opposite=true;

  // 党势向外实际投射是同向；执行器若本身正落在“全局要制的一方”且未形成反向取用闭环，保留逆向证据。
  const bp=path.book_party_projection;
  if(bp?.projectsOutside)same=true;
  const q=ctx.qishi?.dominant;
  if(q){
    const actorEls=leadActors.map((id:string)=>ctx.facts.byId[id]?.element).filter(Boolean);
    const targetEls=(tg.primaryTargets||[]).map((id:string)=>ctx.facts.byId[id]?.element).filter(Boolean);
    if(actorEls.some((e:string)=>e===q.targetElement)&&!targetEls.some((e:string)=>e===q.targetElement)&&path.zhengFan==='fan')opposite=true;
  }

  // 核心书定义“主位之体作用宾位之用”为正向做功；当路径已结算且方向明确为 forward，
  // 可以作为独立 Alignment 证据。反向做功本身仍是有效做功，绝不自动等同反局/冲突。
  if(!same&&!opposite&&completion!=='none'&&path.gongDirection==='forward'){same=true;evidence.push('主位之体实际作用宾位之用，符合书中正向做功定义。');}

  if(same)evidence.push('第一主功与日柱入手意向/主要功神方向或党势向外实际作用同向。');
  if(opposite)evidence.push('第一主功执行方向与已解析的日柱/全局气势之意相反，形成路径级反局证据。');
  if(same&&opposite)return {state:'mixed',evidence};
  if(opposite)return {state:'conflicting',evidence};
  if(same)return {state:'aligned',evidence};
  if(ctx.chartZhengFan?.status==='mixed')evidence.push('chart-level 来源方向混合，但不机械复制到单条 Path。');
  return {state:'unknown',evidence:evidence.length?evidence:['资料/结构不足以把该路径的 Operational Alignment 强判为正或反。']};
}

function edgeFunctionalStates(path:any,ctx:SettlementContext,controls:string[],pathGate?:{passed:string[];conditional:string[];failed:string[]}){
  const controlSet=new Set(controls||[]);
  const passedSet=new Set(pathGate?.passed||[]), conditionalSet=new Set(pathGate?.conditional||[]), failedSet=new Set(pathGate?.failed||[]);
  return uniq<string>((path.relationIds||[]) as string[]).map((relationId:string)=>{
    // Edge state must reflect the path-local semantic gate. Example: generic harm remains
    // conditional globally, while a source-gated wear_control path may consume that same
    // relation as active evidence without mutating the global RelationSemantic.
    const gate=failedSet.has(relationId)?'failed':passedSet.has(relationId)?'passed':conditionalSet.has(relationId)?'conditional':relationSemanticState(relationId,ctx);
    const r:any=ctx.relations.find(x=>x.id===relationId);
    let role:'control'|'bridge'|'support'|'result'|'context'='context';
    if(controlSet.has(relationId))role='control';
    else if((path.bridgeNodes||[]).some((id:string)=>(r?.nodes||[]).includes(id)))role='bridge';
    else if(path.type==='sheng_yong'||path.type==='xie_yong')role='result';
    else if(['generate','stem_combine','branch_combine','stem_branch_combine','half_harmony','arch_harmony'].includes(r?.type))role='support';
    const status:'active'|'constrained'|'blocked'|'unknown'=gate==='passed'?'active':gate==='conditional'?'constrained':gate==='failed'?'blocked':'unknown';
    return {relationId,semanticGate:gate,status,role,evidence:[`关系${r?.type||relationId}语义门=${gate}；Settlement 只按该状态使用，不越级把关系事实自动解释为做功结果。`]};
  });
}

function operationalIntent(path:any):{action:'obtain'|'control'|'retain'|'remove'|'transform'|'output'|'protect'|'be_controlled'|'unknown';confidence:'high'|'medium'|'low';evidence:string[]}{
  if(path.type==='zhi_yong')return {action:'control',confidence:'high',evidence:['制用的结构动作是控制目标；十神主题与动作方向分层保存。']};
  if(path.type==='he_yong'){
    if(path.acquisitionConfirmed===true)return {action:'obtain',confidence:'high',evidence:['日干/日支合用已通过取得门；结构动作按取得处理，现实成果仍由 Ownership/Integrity 单独裁决。']};
    return {action:'retain',confidence:'medium',evidence:['合关系已经形成，但书中合留/合绊/合去等语义需分辨；当前只确认收留/连接，不机械写成“已经取得”。']};
  }
  if(path.type==='hua_yong')return {action:'transform',confidence:'high',evidence:['化用的结构动作是把官杀压力经印桥转化到主位。']};
  if(path.type==='mu_yong')return {action:'retain',confidence:'high',evidence:['墓用的结构动作是收纳/留存；事实入墓与结果归属保持分离。']};
  if(path.type==='sheng_yong'||path.type==='xie_yong')return {action:'output',confidence:'medium',evidence:['生泄结构首先表达输出/流转；后续现实成果不能由十神名称直接替代。']};
  if(path.type==='composite'){
    const a=path.compositeFinalAction;
    if(['obtain','control','retain','remove','transform','output','protect','be_controlled'].includes(a)){
      return {action:a,confidence:'medium',evidence:['复合路径的末段子链已经独立结算；父链只继承最终动作类别，前置子动作仍保留在 componentPathIds 中。']};
    }
    return {action:'unknown',confidence:'low',evidence:['复合路径包含多个子动作且子链尚未全部结算，不把标题压缩成单一意向。']};
  }
  return {action:'unknown',confidence:'low',evidence:['没有足够结构证据生成 Operational Intent。']};
}

export function settleGongPath(path:GongPath,ctx:SettlementContext):GongSettlement {
  const gate=semanticGate(path,ctx);
  const controls=controlEvidence(path,ctx);
  const se=structuralEligibility(path,ctx,gate,controls);
  const tg=targetGraph(path,ctx);
  const edgeStates=edgeFunctionalStates(path,ctx,controls,gate);
  const opIntent=operationalIntent(path);
  const trs=resolveTargets(path,tg.primaryTargets,ctx,se.eligibility,controls);
  const completion=completionFromTargets(path,se.eligibility,trs);
  const residualTargetIds=trs.filter(x=>x.state!=='resolved').map(x=>x.targetId);
  const resultIntegrity=integrity(gate,trs,completion);
  const efficiencyResult=efficiency(path,ctx,completion);
  const magnitudeResult=magnitude(path,ctx,trs,completion);
  const alignmentResult=alignment(path,ctx,completion,tg);
  const structure=structureLevel(path,completion,(path as any).ownership,ctx);
  return {
    pathId:path.id,eligibility:se.eligibility,executionMode:executionMode(path,ctx),structureLevel:structure,
    targetGraph:tg,edgeFunctionalStates:edgeStates,operationalIntent:opIntent,targetResolutions:trs,completion,residualTargetIds,resultIntegrity,efficiency:efficiencyResult,
    magnitude:magnitudeResult,alignment:alignmentResult.state,alignmentEvidence:alignmentResult.evidence,
    semanticGate:gate,controlEvidenceRelationIds:controls,evidence:uniq(se.evidence),counterEvidence:uniq(se.counter)
  };
}

export function buildDependencyGraph(paths:Array<any>):DependencyEdge[]{
  const out:DependencyEdge[]=[];const seen=new Set<string>();
  const add=(e:DependencyEdge)=>{const k=`${e.fromPathId}|${e.toPathId}|${e.type}|${e.viaNodeIds.slice().sort().join(',')}`;if(!seen.has(k)){seen.add(k);out.push(e);}};
  const byId=new Map(paths.map((p:any)=>[p.id,p]));
  // 只有 Enumerator 明确生成的 composite 子链，才记为 requires。
  // “A 的结果节点碰巧也是 B 的执行器”只说明潜在支持，不足以证明严格串行。
  for(const c of paths.filter((p:any)=>p.type==='composite'&&(p.componentPathIds||[]).length>=2)){
    const [aId,bId]=c.componentPathIds; const a:any=byId.get(aId), b:any=byId.get(bId);
    if(!a||!b)continue;
    const via=uniq<string>((a.resultNodes||[]).filter((x:string)=>(b.actorNodes||[]).includes(x)));
    add({fromPathId:aId,toPathId:bId,type:'requires',viaNodeIds:via.length?via:uniq<string>(c.bridgeNodes||[]),evidence:[`复合路径 ${c.id} 明确由两个子路径直接衔接生成；这里只记录结构前置，不假定现实时间先后。`]});
  }
  for(const a of paths)for(const b of paths){
    if(a.id===b.id)continue;
    const aResults=new Set<string>((a.resultNodes||[]) as string[]);const bActors=new Set<string>((b.actorNodes||[]) as string[]);
    const sharedAB:string[]=[...aResults].filter((x:string)=>bActors.has(x));
    const explicit=(paths.some((c:any)=>c.type==='composite'&&(c.componentPathIds||[])[0]===a.id&&(c.componentPathIds||[])[1]===b.id));
    if(sharedAB.length&&!explicit)add({fromPathId:a.id,toPathId:b.id,type:'supports',viaNodeIds:sharedAB,evidence:['前一路径结果节点与后一路径执行节点重合，只标记潜在支持；没有复合路径明证时不升级为 requires。']});
    const sharedResults=(a.resultNodes||[]).filter((x:string)=>(b.resultNodes||[]).includes(x));
    if(sharedResults.length)add({fromPathId:a.id,toPathId:b.id,type:'shares_result',viaNodeIds:uniq(sharedResults),evidence:['两条路径共享结果节点，Magnitude 应按 ResultSignature 去重，而不是按路径数量累加。']});
    const support=(a.actorNodes||[]).filter((x:string)=>(b.actorNodes||[]).includes(x)||(b.bridgeNodes||[]).includes(x));
    if(support.length&&!sharedAB.length)add({fromPathId:a.id,toPathId:b.id,type:'coexists',viaNodeIds:uniq(support),evidence:['两条路径共享执行/桥节点，但没有证明严格先后顺序。']});
  }
  return out;
}

export function buildResultLedger(paths:Array<any>){
  const map=new Map<string,any>();
  for(const p of paths){
    if(p.settlement?.eligibility!=='valid')continue;
    for(const c of p.settlement?.magnitude?.contributions||[]){
      const old=map.get(c.resultSignature);
      if(!old){map.set(c.resultSignature,{...c,sourcePathIds:uniq(c.sourcePathIds||[p.id]),sourceRelationIds:uniq(c.sourceRelationIds||p.relationIds||[])});continue;}
      old.targetIds=uniq([...(old.targetIds||[]),...(c.targetIds||[])]);
      old.resultNodeIds=uniq([...(old.resultNodeIds||[]),...(c.resultNodeIds||[])]);
      old.sourcePathIds=uniq([...(old.sourcePathIds||[]),...(c.sourcePathIds||[p.id])]);
      old.sourceRelationIds=uniq([...(old.sourceRelationIds||[]),...(c.sourceRelationIds||p.relationIds||[])]);
      old.completion=(old.completion==='complete'||c.completion==='complete')?'complete':old.completion||c.completion||'unknown';
    }
  }
  const contributions=[...map.values()].sort((a:any,b:any)=>String(a.resultSignature).localeCompare(String(b.resultSignature)));
  const n=contributions.length;const band=n===0?'none':n===1?'small':n===2?'medium':n===3?'large':'very_large';
  return {contributionCount:n,band,contributions,note:'全局 Result Ledger 按 ResultSignature 跨路径去重；同一成果由冲、克、合等多机制共同完成时只保留一个结果条目，并合并证据来源。'};
}
