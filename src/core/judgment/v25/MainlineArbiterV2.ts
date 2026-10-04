import type { MainlineV2Result, MainlineVector } from './types';

const ELIG:any={valid:3,candidate:2,invalid:0};
const ALIGN:any={aligned:4,unknown:3,mixed:2,conflicting:1};
const COMPLETE:any={complete:6,partial:5,acting:4,none:2,broken:1,counterproductive:0};
const INTEGRITY:any={intact:4,unknown:3,impaired:2,broken:0};
const OWN:any={mostly_native:4,shared:3,unclear:2,mostly_external:1};
const EFF:any={matched:3,unknown:2,underutilized:1,overloaded:1};
const STRUCT:any={L0:0,L1:1,L2:2,L3:3,L4:4,L5:5};
// Closure 只表示结果闭环，不是做功类型贵贱表。输出若已有后续功链，由 BookEntry 追到后续执行链，不靠这里压分。
const CLOSURE:any={control:2,obtain:2,retain:2,transform:2,protect:2,remove:2,output:1,be_controlled:0,unknown:0};

function vector(p:any,facts:any,qishi:any):MainlineVector{
  const s=p.settlement||{};
  const actorIds=(p.leadActorNodes?.length?p.leadActorNodes:p.actorNodes||[]);
  const actorEls=actorIds.map((id:string)=>facts.byId?.[id]?.element).filter(Boolean);
  const qEls=qishi?.dominant?.elements||[];
  const qTarget=qishi?.dominant?.targetElement||'';
  const targetEls=(p.targetNodes||[]).map((id:string)=>facts.byId?.[id]?.element).filter(Boolean);
  // Scope 不是“做功类型分数”：只有这条路径真正把已成立气势投射到其目标，才获得气势范围。
  // 单纯“执行器恰好属于气势元素”不能给裸泄秀/党内流转抬级，否则会压过明确墓用等闭环。
  const bp=p.book_party_projection||{};
  const qProjects=actorEls.some((e:string)=>qEls.includes(e))&&!!qTarget&&targetEls.includes(qTarget);
  const isActualControl=p.type==='zhi_yong'&&(s.controlEvidenceRelationIds||[]).length>0;
  const actorParticipatesInQishiControl=actorEls.some((e:string)=>qEls.includes(e))&&isActualControl;
  // 党势范围只奖励真实控制/制化路径。普通合用、生泄即使涉及党内元素，也不能借“党势”虚抬主功层级；
  // 若合本身是全局制用接点，应由 qishi_control/composite 路径承接，而不是让普通 he_yong 抢主线。
  const scope=bp.projectsOutside&&isActualControl?4:p.qishiBased&&isActualControl?3:qProjects&&isActualControl?2:actorParticipatesInQishiControl?2:bp.internalCirculation&&isActualControl?1:0;
  const bookDominant=qishi?.book_party?.dominant||null;
  const crossConfirmed=bookDominant?.formation==='formed'&&bookDominant?.qishiCrossConfirmed===true;
  const confirmedGlobalWork = crossConfirmed && bp.projectsOutside===true
    ? (p.actionMode==='qishi_control' ? 4 : p.bookPartyBased===true ? 3 : 0)
    : 0;
  const unified=p.unified_structure||null;
  const uCovered=Number(unified?.flowAudit?.coveredNodeIds?.length||0);
  const uInferred=Number(unified?.flowAudit?.inferredNodeIds?.length||0);
  // 统局本身也分强弱：至少两个真实流向锚点，且最多只允许一个同族推断节点，才可成为“已验证统局”。
  // 这样官统财的真实多源汇聚可以压过弱工程党势；反之只有少数真实边、大量族内推断的“统局标签”不能抢原书大功。
  const verifiedUnifiedWork = unified?.status==='formed' && (unified?.controlPathIds||[]).includes(p.id) && uCovered>=2 && uInferred<=1
    ? Math.min(5,uCovered+1)
    : 0;
  const structuralGlobalWork = p.bookPartyBased===true && bp.projectsOutside===true && bookDominant?.formation==='formed' &&
    ['source_explicit_formation','source_rule_plus_overwhelming_member_gate'].includes(bookDominant?.gateBasis||'')
      ? (bookDominant?.gateBasis==='source_explicit_formation'?4:3)
      : 0;
  const sourceTechnique = p.actionMode==='clash_take'&&p.source_gate==='host_body_guest_use'
    ? 3
    : p.actionMode==='wear_control'&&p.source_gate==='day_branch_pierces_guest_yangren'
      ? 3
      : p.actionMode==='wear_control'&&p.source_gate==='explicit_formation_direction'
        ? 2
        : 0;
  return {
    eligibility:ELIG[s.eligibility]??0,
    bookEntry:Number(p.book_entry?.tier||1),
    completion:COMPLETE[s.completion]??0,
    hostRelevance:p.gongDirection==='external'&&!bp.actorActsAsHostProxy?0:1,
    // 已被独立旧 QiShi 交叉确认的书本党势，属于来源更强的全局大功证据；
    // qishi_control 是该交叉确认的直接落地路径，book_party_control 为同党势的补充目标路径。
    // 这一级必须早于多目标覆盖，避免局部墓/合把来源明确的全局制局抢成第一主功。
    confirmedGlobalWork,
    // 未被独立 QiShi 交叉确认的 book party 仍可作为书本结构大功，但它只是工程成势门，
    // 必须排在真实多目标闭环之后，防止弱党势压过双官入墓等已完成结构。
    globalWork:p.bookPartyBased===true&&bp.projectsOutside===true?3:p.bookPartyBased===true?2:0,
    unifiedRange:Number(p.unified_structure?.sourceNodeIds?.length||0),
    scope,
    controlRange:Number(p.control_field?.targetCount||0),
    closure:CLOSURE[s.operationalIntent?.action]??0,
    alignment:ALIGN[s.alignment]??ALIGN.unknown,
    integrity:INTEGRITY[s.resultIntegrity]??INTEGRITY.unknown,
    ownership:OWN[p.ownership?.result]??OWN.unclear,
    magnitude:Number(s.magnitude?.contributionCount||0),
    residual:-Number((s.residualTargetIds||[]).length),
    efficiency:EFF[s.efficiency?.class]??EFF.unknown,
    coverage:Number((s.targetResolutions||[]).filter((x:any)=>x.state==='resolved').length),
    verifiedUnifiedWork,
    sourceTechnique,
    structuralGlobalWork,
    structure:STRUCT[s.structureLevel]??0
  };
}
const ORDER:(keyof MainlineVector)[]=['eligibility','completion','hostRelevance','confirmedGlobalWork','coverage','sourceTechnique','structuralGlobalWork','verifiedUnifiedWork','globalWork','unifiedRange','scope','controlRange','magnitude','closure','integrity','ownership','residual','efficiency','bookEntry','structure'];
function compareV(a:MainlineVector,b:MainlineVector){for(const k of ORDER){if(a[k]!==b[k])return b[k]-a[k];}return 0;}
function equalV(a:MainlineVector,b:MainlineVector){return ORDER.every(k=>a[k]===b[k]);}

export function arbitrateMainlineV2(paths:any[],facts:any,qishi:any):MainlineV2Result<any>{
  const allRows=paths.map(p=>{const v=vector(p,facts,qishi);return {p,v};}).filter(x=>x.v.eligibility>0&&x.v.completion>COMPLETE.none);
  allRows.sort((a,b)=>compareV(a.v,b.v)||String(a.p.id).localeCompare(String(b.p.id)));
  const rows=allRows.filter(x=>x.p.settlement?.eligibility==='valid');
  if(!rows.length)return {primary:null,secondary:allRows[0]?.p||null,co_primary:false,co_primary_ids:[],reason:'v2.5 Settlement 没有 valid 做功路径；candidate 保留审计但不强升第一主功，转象法兜底。',arbitration:{mode:'lexicographic-v2',vector_order:ORDER,primary_vector:null,audit:allRows.map(x=>({pathId:x.p.id,vector:x.v,eligible:x.p.settlement?.eligibility==='valid'}))}};
  const primary=rows[0],ties=rows.filter(x=>equalV(x.v,primary.v)),primaryPath=primary.p,secondary=rows.find(x=>x.p.id!==primaryPath.id)?.p||null;
  return {
    primary:primaryPath,secondary,co_primary:ties.length>1,co_primary_ids:ties.map(x=>x.p.id),
    reason:'v2.5.5 第一主功先过 valid 门并优先比较完成态；同完成态先看是否属于“书本党势且被独立 QiShi 交叉确认”的来源级全局大功；若无此强证据，再比较真实解决的独立目标覆盖数；同覆盖下先保留来源明确的主宾冲取/日支穿制羊刃等专门技法；再看三合三会等明确成局或四个以上成员压倒性成党的结构大功；其后才比较至少两条真实流向锚点且推断不超过一处的已验证统局，再比较月令工程门等一般书本党势+真实向外接点的全局做功，以及统局范围、党势/控局范围、同类目标覆盖和独立功量，再看结果动作、完整性与归属；正反 Alignment 独立保存但不参与第一主功排序，书本入手顺序只用于最后同级裁决。这样功量与控局范围优先于局部高效率，也不会让裸泄秀或宫位本身压过真正全局主功。',
    arbitration:{mode:'lexicographic-v2',vector_order:ORDER,primary_vector:primary.v,audit:allRows.map(x=>({pathId:x.p.id,vector:x.v,eligible:x.p.settlement?.eligibility==='valid'}))}
  };
}
