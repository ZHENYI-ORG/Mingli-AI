/**
 * v2.5.3 Book Method Layer
 *
 * 这层只把来源反复一致的“入手法 / 动态体用 / 主辅功神 / 党势目标”程序化。
 * 它不以旺衰总分替代做功，也不把课堂百分比伪装成数学概率。
 */

const OUTPUT_GODS=new Set(['食神','伤官']);
const WEALTH_GODS=new Set(['正财','偏财']);
const OFFICIAL_GODS=new Set(['正官','七杀']);
const RESOURCE_GODS=new Set(['正印','偏印']);
const PEER_GODS=new Set(['比肩','劫财']);
const BODY_GODS=new Set(['日元','比肩','劫财','正印','偏印']);
const USE_GODS=new Set(['正财','偏财','正官','七杀']);
const uniq=<T>(xs:T[])=>[...new Set(xs.filter(Boolean as any))];

export type BookEntryKind='day_stem_combine'|'day_stem_output_downstream'|'day_stem_direct_other'|'day_pillar_self_combine'|'day_branch_work'|'lu_peer_fallback'|'general_valid_path'|'none';

export interface BookEntryAnnotation{
  tier:number;
  kind:BookEntryKind;
  sourceRule:string;
  reason:string;
  upstreamOutputNodeIds:string[];
  directDayStem:boolean;
  directDayBranch:boolean;
}

export interface DynamicTiYongNode{
  nodeId:string;
  role:'body'|'use'|'tool'|'bridge'|'target'|'result'|'collector'|'context';
  basis:string;
}

function relationMap(relations:any[]){return new Map((relations||[]).map(r=>[r.id,r]));}
function includesNode(p:any,id:string){return [...(p.actorNodes||[]),...(p.leadActorNodes||[]),...(p.bridgeNodes||[]),...(p.targetNodes||[]),...(p.resultNodes||[])].includes(id);}

/**
 * 书本入手法的关键不是“路径类型分数”，而是：
 * 先锁定日干意向入口，再追这条意向真正完成的后续功；日干无功才转日支。
 */
export function annotateBookEntry(paths:any[],facts:any,relations:any[]):{mode:string;dayStemCombine:boolean;dayStemOutput:boolean;outputNodeIds:string[];annotations:Record<string,BookEntryAnnotation>;note:string}{
  const dm=facts.dayMasterNodeId, db=facts.dayBranchNodeId;
  const relBy=relationMap(relations);
  const valid=(p:any)=>p?.settlement?.eligibility==='valid'&&!['none','broken','counterproductive'].includes(p?.settlement?.completion||'none');
  const dmCombineRelations=(relations||[]).filter((r:any)=>r.type==='stem_combine'&&(r.nodes||[]).includes(dm));
  const dmCombineIds=new Set(dmCombineRelations.map((r:any)=>r.id));
  const dmOutputEdges=(relations||[]).filter((r:any)=>r.type==='generate'&&r.nodes?.[0]===dm&&OUTPUT_GODS.has(facts.byId?.[r.nodes?.[1]]?.tenGod));
  const outputNodeIds=uniq<string>(dmOutputEdges.map((r:any)=>r.nodes[1]));
  const dmSelfCombineIds=new Set((relations||[]).filter((r:any)=>r.type==='stem_branch_combine'&&(r.nodes||[]).includes(dm)&&(r.nodes||[]).includes(db)).map((r:any)=>r.id));
  const annotations:Record<string,BookEntryAnnotation>={};

  // 只有存在“可结算”的日干五合路径，才把日干合视为当前有效入口；合存在但不成立，不压死后续真实功。
  const hasValidDmCombine=paths.some((p:any)=>valid(p)&&(p.relationIds||[]).some((id:string)=>dmCombineIds.has(id))&&includesNode(p,dm));
  const outputDownstream=paths.filter((p:any)=>valid(p)&&outputNodeIds.some(id=>(p.actorNodes||[]).includes(id)||(p.leadActorNodes||[]).includes(id)||(p.bridgeNodes||[]).includes(id)));
  const hasValidOutputDownstream=outputDownstream.length>0;

  for(const p of paths){
    let a:BookEntryAnnotation={tier:1,kind:'general_valid_path',sourceRule:'BLIND-ENTRY-GENERAL-001',reason:'有效做功路径，但未命中更前置的日柱入手锚点。',upstreamOutputNodeIds:[],directDayStem:false,directDayBranch:false};
    const relIds=p.relationIds||[];
    const directDmCombine=relIds.some((id:string)=>dmCombineIds.has(id))&&includesNode(p,dm);
    const directSelfCombine=relIds.some((id:string)=>dmSelfCombineIds.has(id));
    const usesOutput=outputNodeIds.filter(id=>(p.actorNodes||[]).includes(id)||(p.leadActorNodes||[]).includes(id)||(p.bridgeNodes||[]).includes(id));
    const rawDmOutput=p.type==='xie_yong'&&(p.actorNodes||[]).includes(dm)&&outputNodeIds.some(id=>(p.targetNodes||[]).includes(id));
    const directDmOther=(p.actorNodes||[]).includes(dm)||(p.leadActorNodes||[]).includes(dm);
    const directDb=includesNode(p,db);
    const luPeer=(p.actorNodes||[]).some((id:string)=>PEER_GODS.has(facts.byId?.[id]?.tenGod));

    if(hasValidDmCombine&&directDmCombine){
      a={tier:6,kind:'day_stem_combine',sourceRule:'BLIND-ENTRY-DM-COMBINE-001',reason:'日干存在可结算的标准天干五合，按“先看日干有无合”锁定第一入手意向。',upstreamOutputNodeIds:[],directDayStem:true,directDayBranch:directDb};
    }else if(!hasValidDmCombine&&usesOutput.length&&hasValidOutputDownstream&&!rawDmOutput){
      a={tier:5,kind:'day_stem_output_downstream',sourceRule:'BLIND-ENTRY-DM-OUTPUT-CHAIN-001',reason:'日干无有效五合，日干所生食伤继续完成后续做功；优先追食伤实际功用，而非停在裸泄秀。',upstreamOutputNodeIds:usesOutput,directDayStem:false,directDayBranch:directDb};
    }else if(!hasValidDmCombine&&directSelfCombine){
      a={tier:5,kind:'day_pillar_self_combine',sourceRule:'BLIND-ENTRY-DAY-PILLAR-SELF-COMBINE-001',reason:'日柱存在来源确认的天地/干支自合配置；按日柱内部真实控制方向单独裁决，不与普通五合混写。',upstreamOutputNodeIds:[],directDayStem:true,directDayBranch:true};
    }else if(!hasValidDmCombine&&directDmOther&&!rawDmOutput){
      a={tier:4,kind:'day_stem_direct_other',sourceRule:'BLIND-ENTRY-DM-DIRECT-001',reason:'日干直接承担有效做功执行；作为日干之意保留在日支之前。',upstreamOutputNodeIds:usesOutput,directDayStem:true,directDayBranch:directDb};
    }else if(!hasValidDmCombine&&rawDmOutput){
      // 书本要求“看这个食伤在八字中的功用”，所以有后续有效功时，裸泄秀只是意向载体；无后续时仍可成为生泄功。
      a={tier:hasValidOutputDownstream?3:4,kind:'day_stem_direct_other',sourceRule:'BLIND-ENTRY-DM-OUTPUT-INTENT-001',reason:hasValidOutputDownstream?'日干生食伤只作为意向入口；食伤已有后续有效功，裸泄秀不得越过后续执行链。':'日干无合而生食伤，且没有更完整后续功链，保留泄秀本身作为日干做功候选。',upstreamOutputNodeIds:outputNodeIds,directDayStem:true,directDayBranch:directDb};
    }else if(!hasValidDmCombine&&directDb){
      a={tier:3,kind:'day_branch_work',sourceRule:'BLIND-ENTRY-DAY-BRANCH-001',reason:'日干未形成更前置有效入口，转看日支的刑冲克穿墓合与党势做功。',upstreamOutputNodeIds:usesOutput,directDayStem:false,directDayBranch:true};
    }else if(!hasValidDmCombine&&luPeer){
      a={tier:2,kind:'lu_peer_fallback',sourceRule:'BLIND-ENTRY-LU-PEER-001',reason:'日干、日支没有更清晰有效主功时，禄/比劫做功作为后位入口；不因“是禄”自动抬高层次。',upstreamOutputNodeIds:[],directDayStem:false,directDayBranch:false};
    }
    annotations[p.id]=a;
    p.book_entry=a;
  }
  return {mode:'book_entry_v1',dayStemCombine:hasValidDmCombine,dayStemOutput:dmOutputEdges.length>0,outputNodeIds,annotations,note:'入手层按来源顺序确定“从哪里读盘”，再由 Settlement 比较是否真正做成；不是固定做功类型排行榜。'};
}

export function annotateDynamicTiYong(paths:any[],facts:any):void{
  for(const p of paths){
    const roleMap=p.roleMap||{};const ids=uniq<string>([...(p.actorNodes||[]),...(p.leadActorNodes||[]),...(p.bridgeNodes||[]),...(p.targetNodes||[]),...(p.resultNodes||[])]);
    const rows:DynamicTiYongNode[]=ids.map(id=>{
      const n=facts.byId?.[id]||{};const structural=roleMap[id]||'';
      let role:DynamicTiYongNode['role']='context',basis='按当前功链角色动态判断，不把十神永久固定为体/用。';
      if(structural==='bridge'){role='bridge';basis='当前路径中承担转化/承接桥。';}
      else if(structural==='collector'){role='collector';basis='当前墓用路径中承担收纳控制。';}
      else if((p.targetNodes||[]).includes(id)){role='target';basis=USE_GODS.has(n.tenGod)?'财官为当前追求/被处理之用。':OUTPUT_GODS.has(n.tenGod)?'食伤在当前路径中作为被追求/被处理对象，故此处取用。':'当前路径明确指定为作用目标。';}
      else if((p.resultNodes||[]).includes(id)&&!(p.actorNodes||[]).includes(id)){role='result';basis='当前路径的结果/承接端。';}
      else if((p.actorNodes||[]).includes(id)||(p.leadActorNodes||[]).includes(id)){
        if(OUTPUT_GODS.has(n.tenGod)){role='tool';basis='食伤在当前路径中主动生财/制官杀等，作为做功工具，取体侧。';}
        else if(BODY_GODS.has(n.tenGod)||n.id===facts.dayMasterNodeId){role='body';basis='日主、印、比劫等在当前路径中承担主体/工具。';}
        else if(USE_GODS.has(n.tenGod)){role='tool';basis='财官在当前路径中反向或复合执行做功，按实际角色作工具，不因十神名称永久定用。';}
        else {role='tool';basis='当前路径中实际承担执行。';}
      }
      return {nodeId:id,role,basis};
    });
    p.dynamic_tiyong={mode:'path_contextual_tiyong_v1',nodes:rows,note:'食伤可体可用；体用只对当前功链成立。'};
  }
}

export function resolveGongRoles(paths:any[],mainline:any,facts:any){
  const valid=paths.filter((p:any)=>p?.settlement?.eligibility==='valid'&&!['none','broken','counterproductive'].includes(p?.settlement?.completion||'none'));
  const primaryIds=new Set<string>(mainline?.co_primary_ids?.length?mainline.co_primary_ids:[mainline?.primary?.id].filter(Boolean));
  const primaryActors=new Set<string>(valid.filter((p:any)=>primaryIds.has(p.id)).flatMap((p:any)=>(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[])));
  const auxiliaryNodes=new Set<string>();
  for(const p of valid){
    for(const rid of p.resultNodes||[]) if(primaryActors.has(rid) && !primaryIds.has(p.id)) for(const aid of p.actorNodes||[]) auxiliaryNodes.add(aid);
  }
  const participantNodes=new Set<string>(valid.flatMap((p:any)=>[...(p.actorNodes||[]),...(p.leadActorNodes||[]),...(p.bridgeNodes||[]),...(p.targetNodes||[]),...(p.resultNodes||[])]));
  const primaryNodes=uniq<string>(valid.filter((p:any)=>primaryIds.has(p.id)).flatMap((p:any)=>(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[])));
  const auxiliary=uniq<string>([...auxiliaryNodes].filter(x=>!primaryNodes.includes(x)));
  const secondaryExecutors=uniq<string>(valid.filter((p:any)=>!primaryIds.has(p.id)).flatMap((p:any)=>(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[]))).filter(x=>!primaryNodes.includes(x)&&!auxiliary.includes(x));
  const waste=facts.nodes.filter((n:any)=>n.visibility==='visible'&&!participantNodes.has(n.id)&&n.id!==facts.dayMasterNodeId).map((n:any)=>n.id);
  return {mode:'gong_role_v1',primary_gongshen:primaryNodes,auxiliary_gongshen:auxiliary,secondary_executors:secondaryExecutors,feishen_candidates:waste,note:'辅助功神只指为主要执行器提供生扶/承接而自身未完成同级独立结果者；废神仅标“当前已枚举有效功链未参与”，不等于永久无用。'};
}

const partyTargetKinds:Record<string,string[]>={
  // 核心书原文：单势与相生党各有自己允许的“所制/所坏”对象，不能简化成普通五行克表。
  '木':['土','金'], '火':['金','水'], '金':['木','火'], '水':['火','燥土'],
  '燥土':['水','金','湿土'], '湿土':['火','燥土'],
  '木火':['金'], '火燥土':['水','金','湿土'], '金水':['火','燥土'], '金湿土':['木','火'], '水湿土':['燥土','火'], '水木':['土']
};
function nodeKind(n:any){if(!n)return '';if(n.position==='branch'&&['未','戌'].includes(n.char))return '燥土';if(n.position==='branch'&&['辰','丑'].includes(n.char))return '湿土';return n.element||'';}
function memberKind(n:any,kind:string){if(kind==='燥土'||kind==='湿土')return nodeKind(n)===kind;return n?.element===kind;}

export function resolveBookPartyProfiles(facts:any,relations:any[],qishi?:any){
  const visible=facts.nodes.filter((n:any)=>n.visibility==='visible');
  const month=facts.byId?.[facts.monthBranchNodeId];
  const specs=[
    {id:'木',parts:['木']},{id:'火',parts:['火']},{id:'金',parts:['金']},{id:'水',parts:['水']},{id:'燥土',parts:['燥土']},{id:'湿土',parts:['湿土']},
    {id:'木火',parts:['木','火']},{id:'火燥土',parts:['火','燥土']},{id:'金水',parts:['金','水']},{id:'金湿土',parts:['金','湿土']},{id:'水湿土',parts:['水','湿土']},{id:'水木',parts:['水','木']}
  ];
  const explicitFormations=(relations||[]).filter((r:any)=>['sanhe','sanhui'].includes(r.type));
  const qDom=qishi?.dominant;
  const qElements=new Set<string>(qDom?.elements||[]);
  const qishiMatches=(sp:any,members:any[])=>{
    if(!qDom||!['high','medium'].includes(qDom.confidence)||qElements.size<2)return false;
    const normalized=sp.parts.map((x:string)=>x==='燥土'||x==='湿土'?'土':x);
    const want=new Set<string>(normalized);
    if(want.size!==qElements.size||[...want].some(x=>!qElements.has(x)))return false;
    // 若把“土”映射为燥/湿土，必须在本命局成员里确实出现对应土性证据，不能靠 QiShi 把普通土强行改性。
    if(sp.parts.includes('燥土')&&!members.some((n:any)=>nodeKind(n)==='燥土'||(n.position==='stem'&&n.element==='土'&&['未','戌'].includes(visible.find((b:any)=>b.position==='branch'&&b.pillar===n.pillar)?.char))))return false;
    if(sp.parts.includes('湿土')&&!members.some((n:any)=>nodeKind(n)==='湿土'||(n.position==='stem'&&n.element==='土'&&['辰','丑'].includes(visible.find((b:any)=>b.position==='branch'&&b.pillar===n.pillar)?.char))))return false;
    return true;
  };
  const rows:any[]=[];
  for(const sp of specs){
    const baseMembers=visible.filter((n:any)=>sp.parts.some(k=>memberKind(n,k)));
    // 燥/湿土在书里不仅表现为墓库支，也会通过同柱戊己成为实际执行端。
    // 只在“土干同柱坐对应燥/湿土支”时把该土干纳入同党，避免把所有戊己土一概贴成燥土/湿土。
    const branchByPillar=new Map<string,any>(visible.filter((n:any)=>n.position==='branch').map((n:any)=>[n.pillar,n]));
    const supplementalEarthStems=visible.filter((n:any)=>{
      if(n.position!=='stem'||n.element!=='土')return false;
      const br=branchByPillar.get(n.pillar);
      if(!br)return false;
      return (sp.parts.includes('燥土')&&['未','戌'].includes(br.char)) || (sp.parts.includes('湿土')&&['辰','丑'].includes(br.char));
    });
    const members=[...baseMembers,...supplementalEarthStems.filter((n:any)=>!baseMembers.some((x:any)=>x.id===n.id))];
    const represented=sp.parts.every(k=>members.some((n:any)=>memberKind(n,k) || (['燥土','湿土'].includes(k)&&n.position==='stem'&&n.element==='土')));
    if(!represented)continue;
    const monthIn=sp.parts.some(k=>memberKind(month,k));
    const directLinks=(relations||[]).filter((r:any)=>['generate','control','branch_combine','stem_combine','clash','harm','sanhe','sanhui'].includes(r.type)&&(r.nodes||[]).filter((id:string)=>members.some((n:any)=>n.id===id)).length>=2);
    const explicit=explicitFormations.some((r:any)=>(r.nodes||[]).every((id:string)=>members.some((n:any)=>n.id===id)));
    // 原书未给“几个字=成势”的固定数学阈值，所以这里把操作门公开标为 engineering_gate，绝不冒充原文。
    // 月令支持仍是最稳的成势门；但核心书也存在“月令不在党内、其余多柱同党压倒性成势”的明确命例。
    // 因此允许 4 个以上可见成员 + 至少一条真实党内连接形成 overwhelming-member gate。
    // 这只是公开的工程门，不冒充原书固定数量公式。
    const qishiMatch=qishiMatches(sp,members);
    const overwhelmingMembers=members.length>=4&&directLinks.length>0;
    const formed=explicit || qishiMatch || (members.length>=3&&monthIn&&directLinks.length>0) || overwhelmingMembers;
    const candidate=!formed&&members.length>=2&&directLinks.length>0;
    if(!formed&&!candidate)continue;
    rows.push({id:`book_party_${sp.id}`,label:sp.id,parts:sp.parts,memberNodeIds:members.map((n:any)=>n.id),formation:formed?'formed':'candidate',monthOrderSupport:monthIn,qishiCrossConfirmed:qishiMatch,explicitFormationRelationIds:explicitFormations.filter((r:any)=>(r.nodes||[]).every((id:string)=>members.some((n:any)=>n.id===id))).map((r:any)=>r.id),linkRelationIds:directLinks.map((r:any)=>r.id),targetKinds:partyTargetKinds[sp.id]||[],sourceRule:'BLIND-PARTY-QISHI-001',gateBasis:explicit?'source_explicit_formation':qishiMatch?'independent_qishi_cross_confirmation':monthIn?'source_rule_plus_declared_engineering_gate':'source_rule_plus_overwhelming_member_gate'});
  }
  rows.sort((a,b)=>(b.formation==='formed'?1:0)-(a.formation==='formed'?1:0)||(b.qishiCrossConfirmed?1:0)-(a.qishiCrossConfirmed?1:0)||b.explicitFormationRelationIds.length-a.explicitFormationRelationIds.length||(b.monthOrderSupport?1:0)-(a.monthOrderSupport?1:0)||b.memberNodeIds.length-a.memberNodeIds.length||b.parts.length-a.parts.length);
  return {mode:'book_party_v1',parties:rows,dominant:rows.find(x=>x.formation==='formed')||null,note:'区分木火金水、燥土、湿土及来源明确的相生党；“成势”无原文统一数值阈值，因此非三合/三会时公开 engineering_gate，不伪装成原书百分比。'};
}

export function annotatePartyProjection(paths:any[],facts:any,bookParty:any){
  const dominant=bookParty?.dominant;
  if(!dominant)return;
  const memberSet=new Set<string>(dominant.memberNodeIds||[]);
  const targetKinds=new Set<string>(dominant.targetKinds||[]);
  for(const p of paths){
    const actors=p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[];
    const targets=p.targetNodes||[];
    const actorIn=actors.some((id:string)=>memberSet.has(id));
    const targetMatched=targets.some((id:string)=>targetKinds.has(nodeKind(facts.byId?.[id])));
    const actorCanReachTarget=actors.some((aid:string)=>{
      const actor=facts.byId?.[aid];
      const actorKinds=new Set<string>([nodeKind(actor)]);
      // 与成势识别保持同一语义：同柱坐未/戌的戊己可作为燥土执行端，同柱坐辰/丑可作为湿土执行端。
      // 这里仅扩展“该执行字能否代表党势发力”的能力，不修改它客观五行仍为土的事实。
      if(actor?.position==='stem'&&actor?.element==='土'){
        const br=facts.nodes.find((n:any)=>n.visibility==='visible'&&n.position==='branch'&&n.pillar===actor.pillar);
        if(br&&['未','戌'].includes(br.char))actorKinds.add('燥土');
        if(br&&['辰','丑'].includes(br.char))actorKinds.add('湿土');
      }
      const directKinds=new Set<string>();
      for(const ak of actorKinds)for(const k of partyTargetKinds[ak]||[])directKinds.add(k);
      return targets.some((tid:string)=>directKinds.has(nodeKind(facts.byId?.[tid])));
    });
    const internal=actorIn&&targets.length>0&&targets.every((id:string)=>memberSet.has(id));
    const partyHasHost=(dominant.memberNodeIds||[]).some((id:string)=>['day','hour'].includes(facts.byId?.[id]?.pillar));
    const projectsOutside=actorIn&&targetMatched&&actorCanReachTarget&&!internal;
    p.book_party_projection={partyId:dominant.id,actorInParty:actorIn,targetMatched,actorCanReachTarget,partyHasHost,actorActsAsHostProxy:projectsOutside&&partyHasHost,internalCirculation:internal,projectsOutside,sourceRule:'BLIND-PARTY-PROJECTION-003'};
  }
}


function targetFamily(god:string){
  if(WEALTH_GODS.has(god))return 'wealth';
  if(OFFICIAL_GODS.has(god))return 'authority';
  if(RESOURCE_GODS.has(god))return 'resource';
  if(OUTPUT_GODS.has(god))return 'output';
  if(PEER_GODS.has(god))return 'peer';
  return god||'other';
}

/**
 * 贼神/捕神与效率的可执行骨架。
 * 这里只做结构供需：一个主要捕神覆盖多个同类目标 => 高利用候选；多个捕神只围一个目标 => 捕多贼少/低利用候选。
 * 不把课堂百分比换算为概率，也不据此直接断富贵。
 */
export function resolveControlFields(paths:any[],facts:any,bookParty:any){
  const valid=(paths||[]).filter((p:any)=>p.type==='zhi_yong'&&p?.settlement?.eligibility==='valid'&&!['none','broken','counterproductive'].includes(p?.settlement?.completion||'none'));
  const groups=new Map<string,any[]>();
  for(const p of valid){
    const targets=p.settlement?.targetGraph?.primaryTargets||p.targetNodes||[];
    const fams=uniq<string>(targets.map((id:string)=>targetFamily(facts.byId?.[id]?.tenGod)));
    const key=fams.sort().join('+')||'other';
    if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(p);
  }
  const fields:any[]=[];
  for(const [family,ps] of groups){
    const executorIds=uniq<string>(ps.flatMap((p:any)=>(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[])));
    const targetIds=uniq<string>(ps.flatMap((p:any)=>p.settlement?.targetGraph?.primaryTargets||p.targetNodes||[]));
    // 主要捕神不是“所有同党字”。按每个实际执行节点覆盖的独立目标数选最大覆盖者；其余记辅助/并行执行。
    const coverageByExecutor:Record<string,string[]>={};
    for(const p of ps){
      const ts=uniq<string>(p.settlement?.targetGraph?.primaryTargets||p.targetNodes||[]);
      for(const aid of (p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[])) coverageByExecutor[aid]=uniq<string>([...(coverageByExecutor[aid]||[]),...ts]);
    }
    const maxCoverage=Math.max(0,...Object.values(coverageByExecutor).map((xs:any)=>xs.length));
    const primaryExecutorIds=executorIds.filter(id=>(coverageByExecutor[id]||[]).length===maxCoverage);
    const supportExecutorIds=executorIds.filter(id=>!primaryExecutorIds.includes(id));
    const formedParties=(bookParty?.parties||[]).filter((x:any)=>x.formation==='formed');
    const catcherPartyIds=formedParties.filter((x:any)=>executorIds.some(id=>(x.memberNodeIds||[]).includes(id))).map((x:any)=>x.id);
    const thiefPartyIds=formedParties.filter((x:any)=>targetIds.some(id=>(x.memberNodeIds||[]).includes(id))).map((x:any)=>x.id);
    let utilization='unknown';
    if(primaryExecutorIds.length===1&&targetIds.length>=2)utilization='high_utilization_candidate';
    else if(primaryExecutorIds.length>=2&&targetIds.length===1)utilization='underutilized_candidate';
    else if(primaryExecutorIds.length===targetIds.length&&primaryExecutorIds.length)utilization='balanced_candidate';
    const cleanControlCandidate=catcherPartyIds.length>0&&thiefPartyIds.length===0&&targetIds.length>0;
    const id=`control_field_${String(fields.length+1).padStart(2,'0')}`;
    const row={id,family,pathIds:ps.map((p:any)=>p.id),executorIds,primaryExecutorIds,supportExecutorIds,coverageByExecutor,targetIds,executorCount:executorIds.length,primaryExecutorCount:primaryExecutorIds.length,targetCount:targetIds.length,utilization,catcherPartyIds,thiefPartyIds,cleanControlCandidate,
      catcher_thief:{catcherNodeIds:primaryExecutorIds,assistantNodeIds:supportExecutorIds,thiefNodeIds:targetIds,state:cleanControlCandidate?'catcher_party_vs_isolated_thief_candidate':'ordinary_control_field',timing_hint:cleanControlCandidate?'thief_arrival_can_raise_utilization_candidate':'none'},
      sourceRule:'BLIND-CATCHER-THIEF-EFFICIENCY-001',note:'按捕神/贼神的结构供需做审计；数量表示独立节点，不是概率或财富百分比。'};
    fields.push(row);
    for(const p of ps)p.control_field={fieldId:id,family,targetCount:targetIds.length,executorCount:executorIds.length,primaryExecutorCount:primaryExecutorIds.length,primaryExecutorIds,supportExecutorIds,utilization,cleanControlCandidate,sourceRule:row.sourceRule};
  }
  return {mode:'control_field_v1',fields,note:'功神废神之外，额外保存制局的捕神/贼神、捕贼供需和净制候选；不直接映射富贵或事件。'};
}


function validSettledPath(p:any){
  return p?.settlement?.eligibility==='valid'&&!['none','broken','counterproductive'].includes(p?.settlement?.completion||'none');
}
function relationDirected(relations:any[],type:string,from:string,to:string){
  return (relations||[]).filter((r:any)=>r.type===type&&r.nodes?.[0]===from&&r.nodes?.[1]===to);
}
function hostControlledNode(nodeId:string,paths:any[],guestHost:any,facts:any){
  const controlling:any[]=[];
  const controlActions=new Set(['obtain','control','retain','transform','protect','remove']);
  for(const p of paths||[]){
    if(!validSettledPath(p))continue;
    const targets=p?.settlement?.targetGraph?.primaryTargets||p.targetNodes||[];
    if(!targets.includes(nodeId))continue;
    const action=p.settlement?.operationalIntent?.action||'unknown';
    // “主方路径碰到该节点”不等于“主方控制该节点”。尤其食伤生财只是流向，不能冒充财已被擒住。
    if(!controlActions.has(action))continue;
    const actors=p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[];
    const hostActors=actors.filter((id:string)=>id===facts.dayMasterNodeId||['host','host_proxy_by_day_party'].includes(guestHost?.nodeStates?.[id]?.gongSide||guestHost?.nodeStates?.[id]?.bookSide||''));
    if(hostActors.length)controlling.push({pathId:p.id,actorIds:hostActors,completion:p.settlement?.completion,action});
  }
  return controlling;
}
function visibleFamilyNodes(facts:any,set:Set<string>){
  return (facts.nodes||[]).filter((n:any)=>n.visibility==='visible'&&set.has(n.tenGod));
}
const GENERATES_ELEMENT:Record<string,string>={木:'火',火:'土',土:'金',金:'水',水:'木'};
function canElementGenerate(a:any,b:any){return !!a?.element&&GENERATES_ELEMENT[a.element]===b?.element;}

interface FamilyFlowAudit{ok:boolean;mode:'explicit_edges'|'single_pivot_family_convergence'|'insufficient';flowRelationIds:string[];coveredNodeIds:string[];inferredNodeIds:string[];}
function familyFlowTo(nodes:any[],pivot:any,pivotPool:any[],relations:any[]):FamilyFlowAudit{
  if(nodes.length<2)return {ok:false,mode:'insufficient',flowRelationIds:[],coveredNodeIds:[],inferredNodeIds:[]};
  const ids:string[]=[];const covered:string[]=[];const inferred:string[]=[];
  for(const n of nodes){
    const rs=relationDirected(relations,'generate',n.id,pivot.id);
    if(rs.length){covered.push(n.id);ids.push(...rs.map((r:any)=>r.id));}
    else if(canElementGenerate(n,pivot))inferred.push(n.id);
  }
  if(covered.length===nodes.length)return {ok:true,mode:'explicit_edges',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:[]};
  // “所有某类都去生一个枢纽”属于全局统摄结构。若该类目标只有唯一枢纽、五行方向全部一致，
  // 允许跨柱的同类节点按 family convergence 汇入，但必须至少有两条独立真实 generate 边作锚，避免只凭十神名称成局。
  if(pivotPool.length===1&&covered.length>=2&&covered.length+inferred.length===nodes.length){
    return {ok:true,mode:'single_pivot_family_convergence',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:inferred};
  }
  return {ok:false,mode:'insufficient',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:inferred};
}

function familyFlowFrom(pivot:any,nodes:any[],pivotPool:any[],relations:any[]):FamilyFlowAudit{
  if(nodes.length<2)return {ok:false,mode:'insufficient',flowRelationIds:[],coveredNodeIds:[],inferredNodeIds:[]};
  const ids:string[]=[];const covered:string[]=[];const inferred:string[]=[];
  for(const n of nodes){
    const rs=relationDirected(relations,'generate',pivot.id,n.id);
    if(rs.length){covered.push(n.id);ids.push(...rs.map((r:any)=>r.id));}
    else if(canElementGenerate(pivot,n))inferred.push(n.id);
  }
  if(covered.length===nodes.length)return {ok:true,mode:'explicit_edges',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:[]};
  // 与 familyFlowTo 对称：同类目标由唯一枢纽生出时，跨柱不要求人为补造相邻边。
  // 至少保留两条独立真实 generate 边作为结构锚，并要求所有剩余目标的五行方向一致。
  if(pivotPool.length===1&&covered.length>=2&&covered.length+inferred.length===nodes.length){
    return {ok:true,mode:'single_pivot_family_convergence',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:inferred};
  }
  return {ok:false,mode:'insufficient',flowRelationIds:uniq(ids),coveredNodeIds:covered,inferredNodeIds:inferred};
}

/**
 * 统局：先证明“同类节点实际汇入/由同一枢纽统摄”，再证明这个枢纽被日主/主方控制。
 * 不把“有两个同类十神”直接叫统局；同一财生官链命中官化财/官统财时只记一个 canonical 结构。
 */
export function resolveUnifiedStructures(facts:any,relations:any[],paths:any[],guestHost:any){
  const wealth=visibleFamilyNodes(facts,WEALTH_GODS), official=visibleFamilyNodes(facts,OFFICIAL_GODS), output=visibleFamilyNodes(facts,OUTPUT_GODS), resource=visibleFamilyNodes(facts,RESOURCE_GODS), peer=visibleFamilyNodes(facts,PEER_GODS);
  const rows:any[]=[];
  const add=(row:any)=>{ if(!rows.some(x=>x.signature===row.signature)) rows.push(row); };
  const gen=(from:string,to:string)=>relationDirected(relations,'generate',from,to);
  const flowIds=(nodes:any[],pivot:any)=>uniq<string>(nodes.flatMap(n=>gen(n.id,pivot.id).map((r:any)=>r.id)));
  const controls=(pivot:any)=>hostControlledNode(pivot.id,paths,guestHost,facts);
  const hostSide=(id:string)=>['host','host_proxy_by_day_party'].includes(guestHost?.nodeStates?.[id]?.gongSide||guestHost?.nodeStates?.[id]?.bookSide||'');

  // 财统食伤：两个及以上可见食伤都汇向同一财，且财被主方取得/控制。
  for(const pivot of wealth){
    const flow=familyFlowTo(output,pivot,wealth,relations); if(!flow.ok)continue;
    const ctl=controls(pivot),native=hostSide(pivot.id); if(!ctl.length&&!native)continue;
    add({id:`unified_${rows.length+1}`,type:'wealth_unifies_output',label:'财统食伤',signature:`wealth_unifies_output|${pivot.id}|${output.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:output.map(n=>n.id),flowRelationIds:flow.flowRelationIds,flowAudit:flow,controlPathIds:ctl.map(x=>x.pathId),nativeHostPivot:native,aliases:[],sourceRule:'BLIND-UNIFIED-WEALTH-OUTPUT-001',evidence_grade:'A',major_conclusion_allowed:false,note:'全部可见食伤汇入同一财枢纽，且该财在主位或由主方通过合/制/墓/化等有效方式控制；单纯食伤生财不冒充“财已被擒住”。'});
  }
  // 官统财 / 官化财：两个及以上财汇向同一官，且官被主方控制；别名同链去重。
  for(const pivot of official){
    const flow=familyFlowTo(wealth,pivot,official,relations); if(!flow.ok)continue;
    const ctl=controls(pivot),native=hostSide(pivot.id); if(!ctl.length)continue;
    add({id:`unified_${rows.length+1}`,type:'official_unifies_wealth',label:'官统财',signature:`official_unifies_wealth|${pivot.id}|${wealth.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:wealth.map(n=>n.id),flowRelationIds:flow.flowRelationIds,flowAudit:flow,controlPathIds:ctl.map(x=>x.pathId),nativeHostPivot:native,aliases:['官化财星'],sourceRule:'BLIND-UNIFIED-OFFICIAL-WEALTH-001',evidence_grade:'A',major_conclusion_allowed:false,note:'多财实际/家族汇聚到唯一官枢纽，且官在主位或由日主/主方控制；官化财星与官统财同链只计一次。'});
  }
  // 财统官：多个官由唯一财枢纽生出；跨柱允许“唯一枢纽 + 至少一条真实生边 + 同类五行方向一致”。
  for(const pivot of wealth){
    const flow=familyFlowFrom(pivot,official,wealth,relations); if(!flow.ok)continue;
    const ctl=controls(pivot); if(!ctl.length)continue;
    add({id:`unified_${rows.length+1}`,type:'wealth_unifies_official',label:'财统官',signature:`wealth_unifies_official|${pivot.id}|${official.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:official.map(n=>n.id),flowRelationIds:flow.flowRelationIds,flowAudit:flow,controlPathIds:ctl.map(x=>x.pathId),aliases:[],sourceRule:'BLIND-UNIFIED-WEALTH-OFFICIAL-001',evidence_grade:'A',major_conclusion_allowed:false,note:'唯一财枢纽实际/家族生出多个官杀，且财由主方控制；只记录结构，不自动推导富贵。'});
  }
  // 伤统劫财：多比劫汇向同一食伤，食伤在主位或被主方控制；官杀直接制多比劫作为另一成立方式。
  for(const pivot of output){
    const flow=familyFlowTo(peer,pivot,output,relations);
    if(peer.length>=2&&flow.ok){
      const ctl=controls(pivot), native=hostSide(pivot.id);
      if(ctl.length||native)add({id:`unified_${rows.length+1}`,type:'output_unifies_peers',label:'伤统劫财',signature:`output_unifies_peers|${pivot.id}|${peer.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:peer.map(n=>n.id),flowRelationIds:flow.flowRelationIds,flowAudit:flow,controlPathIds:ctl.map(x=>x.pathId),nativeHostPivot:native,aliases:[],sourceRule:'BLIND-UNIFIED-OUTPUT-PEER-001',evidence_grade:'A',major_conclusion_allowed:false,note:'多比劫实际/家族汇向同一食伤枢纽，且食伤在主位或被主方真正控制，形成“比劫为我所用”的结构候选。'});
    }
  }
  for(const off of official){
    const zhi=(paths||[]).filter((p:any)=>validSettledPath(p)&&p.type==='zhi_yong'&&(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[]).includes(off.id));
    const peerTargets=uniq<string>(zhi.flatMap((p:any)=>p?.settlement?.targetGraph?.primaryTargets||p.targetNodes||[]).filter((id:string)=>PEER_GODS.has(facts.byId?.[id]?.tenGod)));
    if(peerTargets.length>=2&&(hostSide(off.id)||hostControlledNode(off.id,paths,guestHost,facts).length))add({id:`unified_${rows.length+1}`,type:'official_controls_peers',label:'伤统劫财·官杀制比劫支路',signature:`official_controls_peers|${off.id}|${peerTargets.sort().join(',')}`,status:'formed',pivotNodeId:off.id,sourceNodeIds:peerTargets,flowRelationIds:uniq<string>(zhi.flatMap((p:any)=>p.relationIds||[])),controlPathIds:zhi.map((p:any)=>p.id),aliases:['官杀制比劫'],sourceRule:'BLIND-UNIFIED-OUTPUT-PEER-001',evidence_grade:'A',major_conclusion_allowed:false,note:'来源把“官杀制比劫”列为统摄比劫的另一条支路；与比劫生食伤模式分开记录。'});
  }
  // 印星统官：多官生同一印，印再真实生入日主/主位。
  for(const pivot of resource){
    const flow=familyFlowTo(official,pivot,resource,relations); if(!flow.ok)continue;
    const toDm=gen(pivot.id,facts.dayMasterNodeId);
    if(!toDm.length)continue;
    add({id:`unified_${rows.length+1}`,type:'resource_unifies_official',label:'印星统官',signature:`resource_unifies_official|${pivot.id}|${official.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:official.map(n=>n.id),flowRelationIds:uniq<string>([...flow.flowRelationIds,...toDm.map((r:any)=>r.id)]),flowAudit:flow,controlPathIds:[],aliases:[],sourceRule:'BLIND-UNIFIED-RESOURCE-OFFICIAL-001',evidence_grade:'A',major_conclusion_allowed:false,note:'多个官杀汇入同一印，且该印存在实际生入日主的承接边；仅“印在主位”而无生身关系不能冒充印统官。'});
  }
  // 官统印：唯一官枢纽生出多个印，且官被日主/主方控制。
  for(const pivot of official){
    const flow=familyFlowFrom(pivot,resource,official,relations); if(!flow.ok)continue;
    const ctl=controls(pivot); if(!ctl.length)continue;
    add({id:`unified_${rows.length+1}`,type:'official_unifies_resource',label:'官统印',signature:`official_unifies_resource|${pivot.id}|${resource.map(n=>n.id).sort().join(',')}`,status:'formed',pivotNodeId:pivot.id,sourceNodeIds:resource.map(n=>n.id),flowRelationIds:flow.flowRelationIds,flowAudit:flow,controlPathIds:ctl.map(x=>x.pathId),aliases:['印统官·反向链'],sourceRule:'BLIND-UNIFIED-OFFICIAL-RESOURCE-001',evidence_grade:'A',major_conclusion_allowed:false,note:'唯一官杀枢纽实际/家族生出多个印，且官杀被主方控制；与印星统官按实际流向分开。'});
  }

  // 同一路径可能同时控制多个真实统局枢纽；完整保留数组，兼容字段只指向统摄范围最大的结构。
  for(const row of rows)for(const pid of row.controlPathIds||[]){
    const p=(paths||[]).find((x:any)=>x.id===pid);if(!p)continue;
    const u={id:row.id,type:row.type,label:row.label,status:row.status,pivotNodeId:row.pivotNodeId,sourceNodeIds:row.sourceNodeIds,flowRelationIds:row.flowRelationIds,flowAudit:row.flowAudit,controlPathIds:row.controlPathIds,nativeHostPivot:row.nativeHostPivot,sourceRule:row.sourceRule,evidence_grade:row.evidence_grade};
    p.unified_structures=[...(p.unified_structures||[]),u].filter((x:any,i:number,a:any[])=>a.findIndex(y=>y.id===x.id)===i);
    p.unified_structures.sort((a:any,b:any)=>(b.sourceNodeIds?.length||0)-(a.sourceNodeIds?.length||0)||String(a.id).localeCompare(String(b.id)));
    p.unified_structure=p.unified_structures[0];
  }
  return {mode:'unified_structure_v1',structures:rows,note:'统局必须同时满足“同类真实汇聚/发散 + 枢纽由主方控制或主位承接”；同一实际链的别名不重复计功。重大财富/权力结论仍由上层证据门控制。'};
}

function yinYangSchoolSide(n:any){
  if(!n)return 'neutral';
  if(n.position==='branch'&&['未','戌'].includes(n.char))return 'yang';
  if(n.position==='branch'&&['辰','丑'].includes(n.char))return 'yin';
  if(['木','火'].includes(n.element))return 'yang';
  if(['金','水'].includes(n.element))return 'yin';
  return 'neutral';
}

/** 阴阳围制：学校化细则完整程序识别，但当前来源等级不足以单独驱动重大结论。 */
export function resolveYinYangEncirclement(facts:any,paths:any[],guestHost:any){
  const visible=(facts.nodes||[]).filter((n:any)=>n.visibility==='visible');
  const storeIds=new Set(visible.filter((n:any)=>n.position==='branch'&&['辰','戌','丑','未'].includes(n.char)).map((n:any)=>n.id));
  const rows:any[]=[];
  for(const side of ['yang','yin']){
    const actors=visible.filter((n:any)=>yinYangSchoolSide(n)===side);
    if(actors.length<2)continue;
    const opposite=side==='yang'?'yin':'yang';
    const targetIds=new Set<string>(), pathIds:string[]=[];const executorIds=new Set<string>();
    for(const p of paths||[]){
      if(!validSettledPath(p)||p.type!=='zhi_yong')continue;
      const pas=(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[]).filter((id:string)=>yinYangSchoolSide(facts.byId?.[id])===side);
      const pts=(p?.settlement?.targetGraph?.primaryTargets||p.targetNodes||[]).filter((id:string)=>yinYangSchoolSide(facts.byId?.[id])===opposite);
      if(!pas.length||!pts.length)continue;
      pas.forEach((x:string)=>executorIds.add(x));pts.forEach((x:string)=>targetIds.add(x));pathIds.push(p.id);
    }
    if(executorIds.size<2||targetIds.size<1||!pathIds.length)continue;
    const participatingStoreIds=uniq<string>([...executorIds,...targetIds].filter(id=>storeIds.has(id)));
    if(!participatingStoreIds.length)continue;
    const hostAligned=[...executorIds].some(id=>['host','host_proxy_by_day_party'].includes(guestHost?.nodeStates?.[id]?.gongSide||guestHost?.nodeStates?.[id]?.bookSide||''));
    rows.push({id:`encirclement_${side}`,type:'yin_yang_encirclement',actorSide:side,targetSide:opposite,executorIds:[...executorIds],targetIds:[...targetIds],storeCoreIds:participatingStoreIds,pathIds:uniq<string>(pathIds),hostAligned,status:'school_specific_candidate',sourceRule:'BLIND-YINYANG-ENCIRCLEMENT-B-001',evidence_grade:'B',major_conclusion_allowed:false,note:'已程序识别“群阳/群阴 + 四库核心 + 对侧实际制化”，但该细则来自系统整理层，未用作无条件富贵裁决。'});
  }
  return {mode:'yin_yang_encirclement_v1',structures:rows,note:'所有细节进入机器可读层；B级围制只做候选和审计，不越级覆盖核心书/来源金标准。'};
}

export function annotateGenerationFlow(paths:any[],guestHost:any){
  for(const p of paths||[]){
    if(!['sheng_yong','xie_yong'].includes(p.type))continue;
    const actor=(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[])[0], target=(p.targetNodes||[])[0];
    const as=guestHost?.nodeStates?.[actor]?.bookSide||'unclear', ts=guestHost?.nodeStates?.[target]?.bookSide||'unclear';
    const flow=as==='host'&&ts==='guest'?'outward_generation':as==='guest'&&ts==='host'?'inward_generation':as==='host'&&ts==='host'?'inner_generation':as==='guest'&&ts==='guest'?'outer_generation':'unclear';
    p.book_generation_flow={flow,sourceRule:'BLIND-GENERATION-GUEST-HOST-001',note:flow==='outward_generation'?'主方生向年月宾位：记录为外生，成果归属需再审计。':flow==='inward_generation'?'年月宾位生入日时主位：记录为外来生，主位承接较直接。':'按当前宾主层级记录生用方向。'};
  }
}


/**
 * 干支特殊物性：活木/死木、水的生木差异、巳火双重性。
 * 先形成可审计状态，不在缺少来源金标准时直接改写主功。
 */
export function resolveSpecialNatureProfiles(facts:any,relations:any[],qishi:any){
  const visible=(facts.nodes||[]).filter((n:any)=>n.visibility==='visible');
  const branches=visible.filter((n:any)=>n.position==='branch');
  const byId=facts.byId||{};
  const rels=relations||[];
  const relationStrength=(r:any)=>r?.distance===0||r?.adjacent?'direct':'remote';

  const waterNodes=visible.filter((n:any)=>n.element==='水');
  const water_behavior=waterNodes.map((n:any)=>({
    nodeId:n.id,char:n.char,
    mode:['癸','亥'].includes(n.char)?'still_water_strong_wood_nourish':['壬','子'].includes(n.char)?'flowing_water_weak_wood_nourish':'water_general',
    wood_generation_grade:['癸','亥'].includes(n.char)?'strong':['壬','子'].includes(n.char)?'weak':'ordinary',
    sourceRule:'BLIND-WATER-NATURE-001',evidence_grade:'A',major_conclusion_allowed:false,
    note:['癸','亥'].includes(n.char)?'静水/雨露类，书源认为生木较直接。':['壬','子'].includes(n.char)?'流动水，书源认为一般生木较弱；子见寅等仍需按具体组合重判。':'普通水性记录。'
  }));

  const wood_profiles:any[]=[];
  for(const w of visible.filter((n:any)=>n.position==='stem'&&n.element==='木')){
    const roots=branches.filter((b:any)=>['寅','卯'].includes(b.char));
    const strongWaterEvidence:any[]=[];const weakWaterEvidence:any[]=[];
    for(const r of rels){
      if(r.type!=='generate'||r.nodes?.[1]!==w.id)continue;
      const src=byId[r.nodes?.[0]]; if(!src||src.element!=='水')continue;
      const row={relationId:r.id,sourceNodeId:src.id,char:src.char,strength:relationStrength(r)};
      if(['癸','亥'].includes(src.char)&&relationStrength(r)==='direct')strongWaterEvidence.push(row);else weakWaterEvidence.push(row);
    }
    // 地支水直接生木根也属于“根得到水”的证据；子生卯明确降级，子见寅可作为增强候选。
    for(const r of rels){
      if(r.type!=='generate')continue;const src=byId[r.nodes?.[0]],dst=byId[r.nodes?.[1]];
      if(!src||!dst||src.element!=='水'||!roots.some((x:any)=>x.id===dst.id))continue;
      const row={relationId:r.id,sourceNodeId:src.id,targetRootId:dst.id,char:src.char,strength:relationStrength(r)};
      if(src.char==='亥'&&relationStrength(r)==='direct')strongWaterEvidence.push(row);
      else if(src.char==='子'&&dst.char==='寅'&&relationStrength(r)==='direct')strongWaterEvidence.push({...row,special:'子见寅可生'});
      else weakWaterEvidence.push(row);
    }
    const live=roots.length>0&&strongWaterEvidence.length>0;
    wood_profiles.push({nodeId:w.id,char:w.char,status:live?'live_wood':'dead_wood_candidate',rootNodeIds:roots.map((x:any)=>x.id),strongWaterEvidence,weakWaterEvidence,
      crossYinYangRootAllowed:live,sourceRule:'BLIND-WOOD-LIFE-001',evidence_grade:'A',major_conclusion_allowed:false,
      counterEvidence:live?[]:[roots.length?'有木根但缺少贴近且有效的强水生证据':'未见木根',strongWaterEvidence.length?'':'未见有效强水生'].filter(Boolean),
      note:'活木必须同时满足“有根 + 有效水生”；只有根或只有水不升级为活木。当前状态用于能力审计，重大健康/寿命含义不由本层直接推出。'});
  }

  const qEls=new Set<string>(qishi?.dominant?.elements||[]);
  const si_profiles=branches.filter((n:any)=>n.char==='巳').map((si:any)=>{
    const hasMetalPartners=branches.some((b:any)=>b.id!==si.id&&['酉','丑'].includes(b.char));
    const fireSide=qEls.has('火')||qEls.has('木');
    const metalSide=qEls.has('金')||(hasMetalPartners&&branches.filter((b:any)=>['酉','丑'].includes(b.char)).length>=1);
    let status='dual_unresolved';
    if(fireSide&&!qEls.has('金'))status='fire_mode_candidate';
    else if(metalSide&&!qEls.has('火'))status='metal_assimilation_candidate';
    else if(qEls.has('火')&&qEls.has('金'))status='contested_dual_state';
    return {nodeId:si.id,status,hasMetalPartners,qishiElements:[...qEls],sourceRule:'BLIND-SI-DUAL-NATURE-001',evidence_grade:'A',major_conclusion_allowed:false,
      note:'巳兼火性与金长生属性；木火势强时偏火，金势并见酉/丑时可归金。原局与岁运都应重算，不把巳永久固定成一种性质。'};
  });
  return {mode:'special_nature_profiles_v1',wood_profiles,water_behavior,si_profiles,note:'特殊物性全部机器化保存，但在来源校准不足时先作为能力/关系语义审计，不直接制造重大结论。'};
}
