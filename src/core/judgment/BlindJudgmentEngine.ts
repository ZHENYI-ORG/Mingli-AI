import {BlindJudgmentResult} from './types';
import {LocalPaipan} from '../LocalPaipan';
import { settleGongPath, buildDependencyGraph, buildResultLedger } from './v25/SettlementEngine';
import { arbitrateMainlineV2 } from './v25/MainlineArbiterV2';
import { resolveChartZhengFanV2 } from './v25/ChartZhengFanV2';
import { resolveStageZhengFan } from './v25/StageZhengFan';
import { annotateBookEntry, annotateDynamicTiYong, annotatePartyProjection, resolveBookPartyProfiles, resolveGongRoles, resolveControlFields, resolveUnifiedStructures, resolveYinYangEncirclement, annotateGenerationFlow, resolveSpecialNatureProfiles } from './v25/BookMethodEngine';


/**
 * 真一盲派做功判盘引擎 v2.5.3 book-audited
 *
 * 设计目标：
 * 1) 只消费已经排好的命盘，不改动排盘算法；
 * 2) 事实、关系、语义、做功、归属、岁运严格分层；
 * 3) 规则可复算、可审计，不依赖 LLM；
 * 4) 第一版只实现高确定性骨架，争议技法保守降级。
 */

const PILLARS = ["year", "month", "day", "hour"];
const PILLAR_LABEL = { year: "年柱", month: "月柱", day: "日柱", hour: "时柱" };
const STEM_ELEMENT = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
const BRANCH_ELEMENT = { 子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火", 午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水" };
const ELEMENT_GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const ELEMENT_CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };
const STEM_COMBINES = new Set(["甲己", "己甲", "乙庚", "庚乙", "丙辛", "辛丙", "丁壬", "壬丁", "戊癸", "癸戊"]);
const STEM_CLASHES = new Set(["甲庚","庚甲","乙辛","辛乙","丙壬","壬丙","丁癸","癸丁"]);
const BRANCH_COMBINES = new Set(["子丑", "丑子", "寅亥", "亥寅", "卯戌", "戌卯", "辰酉", "酉辰", "巳申", "申巳", "午未", "未午"]);
// 暗合、半合、拱局独立于六合：只作为客观关系事实/组合引动线索，不偷换成普通“合”。
const BRANCH_DARK_COMBINES = new Set(["寅丑","丑寅","午亥","亥午","卯申","申卯"]);
const BRANCH_HALF_HARMONIES = new Set(["亥卯","卯亥","寅午","午寅","巳酉","酉巳","申子","子申","卯未","未卯","午戌","戌午","酉丑","丑酉","子辰","辰子"]);
const BRANCH_ARCH_HARMONIES = new Set(["亥未","未亥","寅戌","戌寅","巳丑","丑巳","申辰","辰申"]);
const BRANCH_CLASHES = new Set(["子午", "午子", "丑未", "未丑", "寅申", "申寅", "卯酉", "酉卯", "辰戌", "戌辰", "巳亥", "亥巳"]);
const BRANCH_HARMS = new Set(["子未", "未子", "丑午", "午丑", "寅巳", "巳寅", "卯辰", "辰卯", "申亥", "亥申", "酉戌", "戌酉"]);
// 段式/真一资料另用“四绝”：先记录为独立关系事实，方向性制用需继续过语义与来源门。
const BRANCH_ABSOLUTES = new Set(["寅酉","酉寅","卯申","申卯","子巳","巳子","午亥","亥午"]);
const DRY_EARTH_BRANCHES = new Set(["未","戌"]);
const WET_EARTH_BRANCHES = new Set(["辰","丑"]);
// 盲派关系白名单：核心资料明确把子卯、卯午归为“破”，而非子卯刑；
// 常见命理中的子酉、丑辰、寅亥、巳申、未戌等“六破”不进入 blind_core_v1 主规则。
const BRANCH_BREAKS = new Set(["子卯", "卯子", "卯午", "午卯"]);
// 午酉破只在部分课堂整理资料出现，保留 B 级研究候选，不进入生产 RelationFact。
const BRANCH_BREAK_CANDIDATES_B = new Set([
  "午酉", "酉午", // 课堂整理候选
  "子酉", "酉子", "丑辰", "辰丑", "寅亥", "亥寅", "巳申", "申巳", "未戌", "戌未" // 常见六破：本流派核心未冻结为生产规则
]);
const SELF_PUNISH_CANDIDATES_B = new Set(["辰","午","酉","亥"]);
const HARM_DIRECTION_PROFILE_B:Record<string,{stronger?:string;weaker?:string;mode:string}> = {
  "子未":{stronger:"未>子",weaker:"子>未",mode:"directional_control_candidate"},
  "丑午":{stronger:"丑>午",weaker:"午>丑",mode:"directional_control_candidate"},
  "酉戌":{stronger:"戌>酉",weaker:"酉>戌",mode:"directional_control_candidate"},
  "卯辰":{mode:"damage_only"},"申亥":{mode:"damage_only"},"寅巳":{mode:"damage_only"}
};
const ABSOLUTE_DIRECTION_PROFILE_B:Record<string,{preferred?:string;reverse?:string;mode:string}> = {
  "寅酉":{preferred:"酉>寅",reverse:"寅>酉",mode:"directional_control_candidate"},
  "卯申":{preferred:"申>卯",reverse:"卯>申",mode:"directional_control_candidate"},
  "子巳":{preferred:"子>巳",reverse:"巳>子",mode:"directional_control_candidate"},
  "午亥":{mode:"relation_only"}
};
// 盲派 pairwise 刑只保留丑戌、未戌；丑未以冲为主。寅巳申仅三字齐全时强化“三刑”，两字分别以穿/冲/合为主。
const PUNISH_PAIRS = new Set(["丑戌", "戌丑", "戌未", "未戌"]);
const SELF_PUNISH = new Set<string>();
const SANHE = [
  { branches: ["申", "子", "辰"], element: "水" },
  { branches: ["亥", "卯", "未"], element: "木" },
  { branches: ["寅", "午", "戌"], element: "火" },
  { branches: ["巳", "酉", "丑"], element: "金" }
];
const SANHUI = [
  { branches: ["寅", "卯", "辰"], element: "木" },
  { branches: ["巳", "午", "未"], element: "火" },
  { branches: ["申", "酉", "戌"], element: "金" },
  { branches: ["亥", "子", "丑"], element: "水" }
];
const SANXING = [
  { branches: ["寅", "巳", "申"], family: "寅巳申三刑" },
  { branches: ["丑", "戌", "未"], family: "丑戌未三刑" }
];
const STORE_BRANCH = { 水: "辰", 火: "戌", 金: "丑", 木: "未" };
// 根气分层只使用核心资料能稳定支持的“坐下/本气/长生/墓库/余气”口径。
// 其它柱出现同干或同五行只记 external_support，不再与“坐下通根”混成一个 root_score。
const LONGSHENG_BRANCH_BY_ELEMENT:Record<string,string> = { 木:"亥", 火:"寅", 金:"巳", 水:"申", 土:"寅" };
const RESIDUAL_QI_BRANCH_BY_ELEMENT:Record<string,string> = { 木:"辰", 火:"未", 金:"戌", 水:"丑" };
const TOMB_QI_BRANCHES_BY_ELEMENT:Record<string,string[]> = { 木:["未"], 火:["戌"], 金:["丑"], 水:["辰"], 土:["辰","戌"] };
const LU_BRANCH = { 甲: "寅", 乙: "卯", 丙: "巳", 丁: "午", 戊: "巳", 己: "午", 庚: "申", 辛: "酉", 壬: "亥", 癸: "子" };
// 羊刃只取阳干固定刃位；阴干不立羊刃。用于穿制反证门，不参与普通十神事实。
const YANG_REN_BRANCH:Record<string,string> = { 甲:"卯", 丙:"午", 戊:"未", 庚:"酉", 壬:"子" };
// v2.4 RealityState：虚实是“一柱内部的存在状态”，与 RootState 的做功能力/根气承载严格分离。
// 采用多份内部资料交叉一致的六十甲子冻结表，不用藏干或普通五行生克现场推导，避免戊申、辛巳等特殊组合被误判。
const REALITY_REAL_PAIRS = new Set([
  "甲寅","甲辰","甲子","乙亥","乙卯","乙未","丙寅","丙午","丙戌","丁巳","丁卯","丁未",
  "戊戌","戊午","戊辰","己巳","己未","己丑","庚申","庚辰","辛丑","辛酉","壬申","壬子","壬辰","癸亥","癸酉","癸丑"
]);
const REALITY_VIRTUAL_PAIRS = new Set([
  "甲申","甲戌","甲午","乙巳","乙酉","乙丑","丙子","丙申","丙辰","丁亥","丁丑","丁酉",
  "戊子","戊申","戊寅","己亥","己酉","己卯","庚子","庚午","庚寅","庚戌","辛巳","辛亥","辛未","辛卯",
  "壬戌","壬午","壬寅","癸巳","癸未","癸卯"
]);
const DAI_XIANG_DISPUTED_PAIRS = new Set(["丙辰","丙戌"]);
const SYMBOL_HOST_LINK_TYPES = new Set(["stem_combine","branch_combine","stem_branch_combine","dark_combine","half_harmony","arch_harmony","sanhe","sanhui","generate","tonglu","tomb_enter","multi_tomb_enter"]);
const SYMBOL_DAMAGE_TYPES = new Set(["clash","harm","break","punish","sanxing"]);
const ORIGIN_STEMS_BY_BRANCH:Record<string,string[]> = { 子:["癸"], 丑:[], 寅:["甲"], 卯:["乙"], 辰:[], 巳:["丙","戊"], 午:["丁","己"], 未:[], 申:["庚"], 酉:["辛"], 戌:[], 亥:["壬"] };
// 地支藏干白名单，用于“原局字在岁运以藏干形式出现”与“原局藏干在岁运透出”的身份事实。
const BRANCH_HIDDEN_STEMS:Record<string,string[]> = { 子:["癸"], 丑:["己","辛","癸"], 寅:["甲","丙","戊"], 卯:["乙"], 辰:["戊","癸","乙"], 巳:["丙","庚","戊"], 午:["丁","己"], 未:["己","乙","丁"], 申:["庚","壬","戊"], 酉:["辛"], 戌:["戊","丁","辛"], 亥:["壬","甲"] };
// 核心资料反复一致的半禄只先开放丁未、癸丑。其它课堂扩展关系保留研究态，不进入重大应期。
const HALF_LU_BRANCH:Record<string,string[]> = { 丁:["未"], 癸:["丑"] };
// 稳定墓库对应：四生支入墓，以及丑/未入辰这一特殊土墓关系。子午卯酉不因见对应墓库就自动入墓。
const DIRECT_TOMB_STORE:Record<string,string> = { 亥:"辰", 寅:"未", 巳:"戌", 申:"丑", 丑:"辰", 未:"辰" };
// 课堂整理笔记明确给出的“乙到”代表顺序，只作为 B 级仲裁覆盖，不泛化到十干。
const YI_REPRESENTATION_PRIORITY:Record<string,number> = { 卯:1, 未:2, 辰:3, 乙:4 };
const STABLE_SELF_COMBINE = new Set(["丁亥", "己亥", "辛巳", "癸巳", "壬午", "甲午", "戊子"]);
// 核心书源：丙戌、壬戌须戌逢刑冲时才按天地合/干支自合完整放行。
const CONDITIONAL_SELF_COMBINE = new Set(["丙戌","壬戌"]);
// 结构化提示词另收录戊辰，核心书未取得同等级交叉证据：只进 B 级候选，不参与生产主功。
const SELF_COMBINE_CANDIDATE_B = new Set(["戊辰"]);
const BODY_GODS = new Set(["比肩", "劫财", "正印", "偏印", "食神"]);
const USE_GODS = new Set(["正财", "偏财", "正官", "七杀", "伤官"]);
const OUTPUT_GODS = new Set(["食神", "伤官"]);
const WEALTH_GODS = new Set(["正财", "偏财"]);
const OFFICIAL_GODS = new Set(["正官", "七杀"]);
const RESOURCE_GODS = new Set(["正印", "偏印"]);
const PEER_GODS = new Set(["比肩", "劫财"]);

function uniq(arr:any[]):any[] { return [...new Set(arr.filter(Boolean))]; }
function pairKey(a, b) { return `${a || ""}${b || ""}`; }
function elementGenerates(a, b) { return !!a && !!b && ELEMENT_GENERATES[a] === b; }
function elementControls(a, b) { return !!a && !!b && ELEMENT_CONTROLS[a] === b; }
function pillarDistance(a, b) { return Math.abs(PILLARS.indexOf(a) - PILLARS.indexOf(b)); }
function nodePositionLabel(n) {
  if (!n) return "";
  if (n.position === "hidden_stem") return `${PILLAR_LABEL[n.pillar] || ""}${n.hiddenLevel || "藏干"}`;
  return `${PILLAR_LABEL[n.pillar] || ""}${n.position === "stem" ? "天干" : "地支"}`;
}
function simpleNodeLabel(n) {
  if (!n) return "—";
  const god = n.tenGod && n.tenGod !== "日元" ? n.tenGod : (n.isDayMaster ? "日主" : "");
  return `${n.char}${god ? ` · ${god}` : ""}`;
}
function typeLabel(type) {
  return ({ zhi_yong: "制用", he_yong: "合用", hua_yong: "化用", sheng_yong: "生用", xie_yong: "泄用", mu_yong: "墓用", composite: "复合做功", xiang_fallback: "象法辅助" })[type] || type;
}
function ownershipLabel(v) {
  return ({ mostly_native: "成果主要归主", shared: "主客共享成果", mostly_external: "成果更多落在外部", unclear: "归属仍需校验" })[v] || "归属仍需校验";
}
function statusLabel(v) {
  return ({ effective: "有效成立", conditional: "条件成立", intent_only: "只有意向", broken: "主线受损", invalid: "不成立" })[v] || v;
}

export class BlindJudgmentEngine {
  version:string;
  ruleVersion:string;
  constructor() {
    this.version = "2.5.5-algorithm-correction";
    this.ruleVersion = "blind-core-2026-09-v15-algorithm-correction";
  }

  analyze(chart:any, options:any = {}):BlindJudgmentResult {
    const facts = this.buildFacts(chart);
    const relations = this.buildRelations(facts);
    const roots = this.resolveRoots(facts);
    const originalTombState = this.resolveTombStateSnapshot(facts, [], new Set<string>());
    const semantics = this.resolveRelationSemantics(facts, relations);
    const guestHost = this.resolveGuestHost(facts, relations, options.context || "general");
    const origins = this.resolveOrigins(facts, roots, guestHost);
    const intents = this.resolveIntents(facts, relations, guestHost);
    const qishi:any = this.resolveQiShi(facts, relations, roots);
    const bookParty = resolveBookPartyProfiles(facts, relations, qishi);
    qishi.book_party = bookParty;
    const realityState = this.resolveRealityState(facts);
    const chartZhengFanDirectionContext = this.resolveChartZhengFan(facts, relations, intents, qishi, guestHost);
    const symbolGraph = this.resolveSymbolGraph(facts, relations, guestHost, qishi);
    const paths = this.enumerateGongPaths(facts, relations, semantics, roots, guestHost, intents, qishi);
    const validated = paths.map(p => this.validatePath(p, facts, relations, roots, guestHost, intents, qishi));
    annotatePartyProjection(validated, facts, bookParty);
    annotateDynamicTiYong(validated, facts);
    for (const path of validated) path.ownership = this.resolveOwnership(path, facts, relations, guestHost, origins);
    for (const path of validated) path.gongDirection = this.resolveGongDirection(path, guestHost);
    // v2.4 path-level zhengFan 仅保留审计；v2.5 Alignment 不再直接拿它做全局排序。
    for (const path of validated) path.zhengFan = this.resolvePathZhengFan(path, facts, intents, qishi, guestHost);
    for (const path of validated) {
      path.legacy_status = path.status;
      path.gong_level = this.resolveGongLevel(path, qishi);
      path.settlement = settleGongPath(path, { facts, relations, semantics, roots, guestHost, intents, qishi, chartZhengFan: chartZhengFanDirectionContext, origins });
      path.execution_mode = path.settlement.executionMode;
      path.structure_level = path.settlement.structureLevel;
      // 兼容旧 API：status 由 Settlement 映射，不再由 direct/布尔门单独决定。
      if (path.settlement.eligibility === 'invalid') path.status = 'invalid';
      else if (path.settlement.completion === 'complete') path.status = 'effective';
      else if (['partial','acting'].includes(path.settlement.completion)) path.status = 'conditional';
      else path.status = 'intent_only';
      path.gong_level = path.structure_level;
    }
    const controlFields = resolveControlFields(validated, facts, bookParty);
    // 墓库还要区分“收取目标”与“把本来要出去做功的工具墓住”。
    // 若食伤节点已经在一条有效制官/制杀路径中承担执行器，同时又被墓用路径收进库，
    // 该墓首先是对工具的约束/效率损失，不再作为独立高效墓用抢第一主功。
    for (const path of validated) {
      if (path.type !== 'mu_yong') continue;
      const stored = new Set(path.targetNodes || []);
      const storedAreOutputs = [...stored].some((id:string)=>OUTPUT_GODS.has(facts.byId[id]?.tenGod));
      if (!storedAreOutputs) continue;
      const competing = validated.filter((q:any)=>q.type==='zhi_yong'&&q.id!==path.id&&q.settlement?.eligibility==='valid'&&!['none','broken','counterproductive'].includes(q.settlement?.completion||'none')&&(q.leadActorNodes?.length?q.leadActorNodes:q.actorNodes||[]).some((id:string)=>stored.has(id))&&((q.settlement?.targetGraph?.primaryTargets||q.targetNodes||[]).some((id:string)=>OFFICIAL_GODS.has(facts.byId[id]?.tenGod))));
      if (competing.length) {
        (path as any).toolStorageConstraint = true;
        (path as any).toolStorageCompetingPathIds = competing.map((q:any)=>q.id);
      }
    }
    // 复合路径的父链不能因为“复合”二字永久停在 acting/unknown。
    // Enumerator 只会在两个已知做功路径于同一节点直接衔接时生成 componentPathIds；
    // 因此可在第一遍 Settlement 后检查两个子链是否都独立 valid + complete。
    // 只有二者均完成时，父链才继承为 complete，并只继承末段动作类别；否则继续保留过程态。
    const byPathId = new Map(validated.map((p:any)=>[p.id,p]));
    for (const path of validated) {
      if (path.type !== 'composite' || !(path.componentPathIds || []).length) continue;
      const components:any[] = (path.componentPathIds || []).map((id:string)=>byPathId.get(id)).filter(Boolean) as any[];
      const complete = components.length === (path.componentPathIds || []).length && components.length >= 2 && components.every((c:any)=>c.settlement?.eligibility==='valid' && c.settlement?.completion==='complete');
      (path as any).compositeComponentsComplete = complete;
      (path as any).compositeComponentSettlementIds = components.map((c:any)=>c.id);
      if (complete) {
        const last:any = components[components.length - 1];
        (path as any).compositeFinalAction = last.settlement?.operationalIntent?.action || 'unknown';
      }
    }
    // ControlField、工具入墓约束与复合子链状态依赖第一遍 Settlement；标注后重算 Settlement。
    for (const path of validated) {
      path.settlement = settleGongPath(path, { facts, relations, semantics, roots, guestHost, intents, qishi, chartZhengFan: chartZhengFanDirectionContext, origins });
      path.execution_mode = path.settlement.executionMode;
      path.structure_level = path.settlement.structureLevel;
      if (path.settlement.eligibility === 'invalid') path.status = 'invalid';
      else if (path.settlement.completion === 'complete') path.status = 'effective';
      else if (['partial','acting'].includes(path.settlement.completion)) path.status = 'conditional';
      else path.status = path.legacy_status === 'invalid' ? 'invalid' : 'intent_only';
    }
    // 书库细节层：生用宾主方向、统局、阴阳围制全部进入机器可读审计层。
    // 统局/围制不会凭格局标题直接下重大结论；必须由真实关系与可结算路径证明。
    annotateGenerationFlow(validated, guestHost);
    const unifiedStructures = resolveUnifiedStructures(facts, relations, validated, guestHost);
    const yinYangEncirclement = resolveYinYangEncirclement(facts, validated, guestHost);
    const specialNatureProfiles = resolveSpecialNatureProfiles(facts, relations, qishi);
    const bookEntry = annotateBookEntry(validated, facts, relations);
    const dependencyGraph = buildDependencyGraph(validated);
    const resultLedger = buildResultLedger(validated);
    // 旧 rank_score 仅保留审计，不参与 v2.5 第一主功。
    const legacyRanked = this.rankPaths(validated, facts, relations, roots, qishi);
    const legacyRankMap = new Map(legacyRanked.map((x:any)=>[x.id,x.rank_score]));
    for (const path of validated) path.legacy_rank_score = legacyRankMap.get(path.id) as number|undefined;
    const mainline = arbitrateMainlineV2(validated, facts, qishi);
    const gongRoles = resolveGongRoles(validated, mainline, facts);
    const order = new Map((mainline.arbitration?.audit || []).map((x:any, i:number)=>[x.pathId,i]));
    const ranked = [...validated].sort((a:any,b:any)=> (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999) || a.id.localeCompare(b.id));
    const xiang = this.resolveXiangFallback(facts, relations, intents, qishi, mainline);
    if (!mainline.primary && xiang.primary) mainline.primary = xiang.primary;
    const chartZhengFan = resolveChartZhengFanV2({ facts, relations, intents, qishi, guestHost, directionContext: chartZhengFanDirectionContext, paths: ranked, mainline });
    const timing:any = this.resolveTiming(chart, facts, relations, mainline.primary, { ...options, _roots: roots });
    timing.stage_zheng_fan = resolveStageZhengFan(chartZhengFan, timing);
    const evidence = this.buildEvidenceTrace(facts, relations, semantics, roots, intents, qishi, ranked, mainline, timing, realityState, chartZhengFan, symbolGraph);
    const result:any = {
      ok: true,
      engine_version: this.version,
      rule_version: this.ruleVersion,
      generated_at: new Date().toISOString(),
      facts: {
        nodes: facts.nodes,
        visible_stems: facts.visible_stems,
        branches: facts.branches,
        hidden_stems: facts.hidden_stems,
        day_master_node_id: facts.dayMasterNodeId,
        month_branch_node_id: facts.monthBranchNodeId
      },
      relations,
      relation_semantics: semantics,
      guest_host: guestHost,
      roots,
      original_tomb_state: originalTombState,
      origins,
      intents,
      qishi,
      book_method: {
        entry: bookEntry,
        party: bookParty,
        gong_roles: gongRoles,
        control_fields: controlFields,
        unified_structures: unifiedStructures,
        yin_yang_encirclement: yinYangEncirclement,
        special_nature_profiles: specialNatureProfiles,
        relation_flow_policy: {
          mode: 'book_relation_flow_v1',
          note: '生用/泄用按宾主方向保存 outward/inward/inner/outer；统局、围制与普通单链分开，不用格局标题替代关系事实。'
        }
      },
      reality_state: realityState,
      chart_zheng_fan: chartZhengFan,
      chart_zheng_fan_direction_context: chartZhengFanDirectionContext,
      symbol_graph: symbolGraph,
      gong_paths: ranked,
      gong_dependency_graph: dependencyGraph,
      gong_result_ledger: resultLedger,
      mainline,
      xiang,
      timing,
      evidence,
      warnings: this.buildWarnings(chart, facts, mainline)
    };
    result.presentation = this.buildPresentation(result, chart);
    return result;
  }

  buildFacts(chart) {
    const b = chart?.bazi || {};
    const ss = chart?.shi_shen || {};
    const hidden = chart?.hidden_stems || {};
    const keyMap = { year: "year_pillar", month: "month_pillar", day: "day_pillar", hour: "hour_pillar" };
    const nodes = [];
    const visibleStems = [];
    const branches = [];
    const hiddenNodes = [];
    for (const pillar of PILLARS) {
      const p = b[keyMap[pillar]] || {};
      const stem = p.heavenly_stem || "";
      const branch = p.earthly_branch || "";
      const stemGod = pillar === "day" ? "日元" : (ss[`${pillar}_stem`] || "");
      const branchGod = ss[`${pillar}_branch`] || hidden[pillar]?.[0]?.shi_shen || "";
      const stemNode = {
        id: `original.${pillar}.stem`, layer: "original", pillar, position: "stem", char: stem,
        element: STEM_ELEMENT[stem] || "", yinYang: ["甲","丙","戊","庚","壬"].includes(stem) ? "阳" : "阴",
        tenGod: stemGod, visibility: "visible", isDayMaster: pillar === "day"
      };
      const branchNode = {
        id: `original.${pillar}.branch`, layer: "original", pillar, position: "branch", char: branch,
        element: BRANCH_ELEMENT[branch] || "", tenGod: branchGod, visibility: "visible", isDayMaster: false
      };
      nodes.push(stemNode, branchNode);
      visibleStems.push(stemNode.id);
      branches.push(branchNode.id);
      (hidden[pillar] || []).forEach((h, idx) => {
        const hn = {
          id: `original.${pillar}.hidden.${idx}`, layer: "original", pillar, position: "hidden_stem", char: h.stem || "",
          element: h.element || STEM_ELEMENT[h.stem] || "", tenGod: h.shi_shen || "", visibility: "hidden",
          hiddenLevel: h.label || (["本气", "中气", "余气"][idx] || "藏干"), parentBranchId: branchNode.id, isDayMaster: false
        };
        nodes.push(hn); hiddenNodes.push(hn.id);
      });
    }
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    return {
      nodes, byId,
      visible_stems: visibleStems,
      branches,
      hidden_stems: hiddenNodes,
      dayMasterNodeId: "original.day.stem",
      dayBranchNodeId: "original.day.branch",
      monthBranchNodeId: "original.month.branch"
    };
  }

  buildRelations(facts) {
    const out = [];
    const add = (type:any, nodeIds:any[], extra:any = {}) => {
      const id = `R${String(out.length + 1).padStart(3, "0")}`;
      out.push({ id, layer: "original", type, nodes: nodeIds, source: extra.source || "standard", status: extra.status || "fact", ...extra });
      return id;
    };
    const stems = facts.visible_stems.map(id => facts.byId[id]);
    const branches = facts.branches.map(id => facts.byId[id]);

    for (let i = 0; i < stems.length; i++) for (let j = i + 1; j < stems.length; j++) {
      const a = stems[i], b = stems[j];
      const distance = pillarDistance(a.pillar, b.pillar);
      if (STEM_COMBINES.has(pairKey(a.char, b.char))) add("stem_combine", [a.id, b.id], { distance, adjacent: distance <= 1 });
      if (elementGenerates(a.element, b.element)) add("generate", [a.id, b.id], { direction: `${a.id}>${b.id}`, distance, adjacent: distance <= 1, medium: "stem" });
      if (elementGenerates(b.element, a.element)) add("generate", [b.id, a.id], { direction: `${b.id}>${a.id}`, distance, adjacent: distance <= 1, medium: "stem" });
      if (elementControls(a.element, b.element)) add("control", [a.id, b.id], { direction: `${a.id}>${b.id}`, distance, adjacent: distance <= 1, medium: "stem" });
      if (elementControls(b.element, a.element)) add("control", [b.id, a.id], { direction: `${b.id}>${a.id}`, distance, adjacent: distance <= 1, medium: "stem" });
      if (a.char === b.char) add("same_char", [a.id, b.id], { distance, adjacent: distance <= 1 });
    }

    for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
      const a = branches[i], b = branches[j];
      const k = pairKey(a.char, b.char), distance = pillarDistance(a.pillar, b.pillar);
      if (BRANCH_COMBINES.has(k)) add("branch_combine", [a.id, b.id], { distance, adjacent: distance <= 1 });
      if (BRANCH_CLASHES.has(k)) add("clash", [a.id, b.id], { distance, adjacent: distance <= 1 });
      if (BRANCH_HARMS.has(k)) {
        const canonical=[a.char,b.char].sort().join('');
        const profile=HARM_DIRECTION_PROFILE_B[pairKey(a.char,b.char)]||HARM_DIRECTION_PROFILE_B[pairKey(b.char,a.char)]||HARM_DIRECTION_PROFILE_B[canonical];
        add("harm", [a.id, b.id], { distance, adjacent: distance <= 1, school_label: "穿害", school_direction_profile:profile||null, direction_profile_grade:profile?'B':null });
      }
      if (BRANCH_ABSOLUTES.has(k)) {
        const profile=ABSOLUTE_DIRECTION_PROFILE_B[pairKey(a.char,b.char)]||ABSOLUTE_DIRECTION_PROFILE_B[pairKey(b.char,a.char)];
        add("absolute", [a.id, b.id], { distance, adjacent: distance <= 1, source:"school_whitelist", school:"真一盲派", status:"fact", major_conclusion_allowed:false, evidence_grade:"B", school_direction_profile:profile||null });
      }
      if (BRANCH_BREAKS.has(k)) add("break", [a.id, b.id], { distance, adjacent: distance <= 1 });
      else if (BRANCH_BREAK_CANDIDATES_B.has(k)) add("break_candidate",[a.id,b.id],{distance,adjacent:distance<=1,source:'research_note',status:'candidate',evidence_grade:'B',major_conclusion_allowed:false});
      if (PUNISH_PAIRS.has(k) || (a.char === b.char && SELF_PUNISH.has(a.char))) add("punish", [a.id, b.id], { distance, adjacent: distance <= 1 });
      else if(a.char===b.char&&SELF_PUNISH_CANDIDATES_B.has(a.char)) add("self_punish_candidate",[a.id,b.id],{distance,adjacent:distance<=1,source:'research_note',status:'candidate',evidence_grade:'B',major_conclusion_allowed:false});
      if (BRANCH_DARK_COMBINES.has(k)) add("dark_combine", [a.id, b.id], { distance, adjacent: distance <= 1, source:'school_whitelist', school:'真一盲派', major_conclusion_allowed:false });
      if (BRANCH_HALF_HARMONIES.has(k)) add("half_harmony", [a.id, b.id], { distance, adjacent: distance <= 1, source:'school_whitelist', school:'真一盲派', major_conclusion_allowed:false });
      if (BRANCH_ARCH_HARMONIES.has(k)) add("arch_harmony", [a.id, b.id], { distance, adjacent: distance <= 1, source:'school_whitelist', school:'真一盲派', major_conclusion_allowed:false });
      if (a.char === b.char) add("same_char", [a.id, b.id], { distance, adjacent: distance <= 1 });
      // 普通地支生克不跨柱遥推。盲派做功以贴身、实际冲合刑穿墓为优先；
      // 非相邻支之间只有元素生克，不自动生成“做功关系”，避免把全盘变成任意两支都能做功。
      // 辰丑湿土、未戌燥土按书源特殊物性覆盖普通五行机械生克：燥土不生金而脆金；湿土原则不克水，并能晦火。
      const aDry=DRY_EARTH_BRANCHES.has(a.char), bDry=DRY_EARTH_BRANCHES.has(b.char), aWet=WET_EARTH_BRANCHES.has(a.char), bWet=WET_EARTH_BRANCHES.has(b.char);
      if (distance <= 1 && elementGenerates(a.element, b.element) && !(aDry&&b.element==='金')) add("generate", [a.id, b.id], { direction: `${a.id}>${b.id}`, distance, adjacent: true, medium: "branch" });
      if (distance <= 1 && elementGenerates(b.element, a.element) && !(bDry&&a.element==='金')) add("generate", [b.id, a.id], { direction: `${b.id}>${a.id}`, distance, adjacent: true, medium: "branch" });
      if (distance <= 1 && elementControls(a.element, b.element) && !(aWet&&b.element==='水')) add("control", [a.id, b.id], { direction: `${a.id}>${b.id}`, distance, adjacent: true, medium: "branch" });
      if (distance <= 1 && elementControls(b.element, a.element) && !(bWet&&a.element==='水')) add("control", [b.id, a.id], { direction: `${b.id}>${a.id}`, distance, adjacent: true, medium: "branch" });
      if(distance<=1&&aDry&&b.element==='金')add("brittle_control",[a.id,b.id],{direction:`${a.id}>${b.id}`,distance,adjacent:true,medium:'branch',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
      if(distance<=1&&bDry&&a.element==='金')add("brittle_control",[b.id,a.id],{direction:`${b.id}>${a.id}`,distance,adjacent:true,medium:'branch',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
      if(distance<=1&&aWet&&b.element==='火')add("dampen_fire",[a.id,b.id],{direction:`${a.id}>${b.id}`,distance,adjacent:true,medium:'branch',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
      if(distance<=1&&bWet&&a.element==='火')add("dampen_fire",[b.id,a.id],{direction:`${b.id}>${a.id}`,distance,adjacent:true,medium:'branch',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
    }

    // 同柱干支：只让天干向地支输出普通生克；地支克天干不自动成立。
    for (const pillar of PILLARS) {
      const st = facts.byId[`original.${pillar}.stem`], br = facts.byId[`original.${pillar}.branch`];
      if (!st || !br) continue;
      if (elementGenerates(st.element, br.element)) add("generate", [st.id, br.id], { direction: `${st.id}>${br.id}`, distance: 0, adjacent: true, medium: "same_pillar" });
      // 核心资料明确允许干支互生；但未戌燥土不生金、反脆金。地支对天干普通“克”仍不泛化，只开放来源明确的脆/晦专项。
      if (elementGenerates(br.element, st.element) && !(DRY_EARTH_BRANCHES.has(br.char)&&st.element==='金')) add("generate", [br.id, st.id], { direction: `${br.id}>${st.id}`, distance: 0, adjacent: true, medium: "same_pillar" });
      if (elementControls(st.element, br.element)) add("control", [st.id, br.id], { direction: `${st.id}>${br.id}`, distance: 0, adjacent: true, medium: "same_pillar" });
      if(DRY_EARTH_BRANCHES.has(br.char)&&st.element==='金')add("brittle_control",[br.id,st.id],{direction:`${br.id}>${st.id}`,distance:0,adjacent:true,medium:'same_pillar',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
      if(WET_EARTH_BRANCHES.has(br.char)&&st.element==='火')add("dampen_fire",[br.id,st.id],{direction:`${br.id}>${st.id}`,distance:0,adjacent:true,medium:'same_pillar',source:'school_whitelist',school:'真一盲派',evidence_grade:'A'});
      const pillarText = `${st.char}${br.char}`;
      if (STABLE_SELF_COMBINE.has(pillarText)) add("stem_branch_combine", [st.id, br.id], { source: "school_whitelist", school: "真一盲派", distance: 0, adjacent: true, evidence_grade:'A', self_combine_mode:'stable' });
      else if(CONDITIONAL_SELF_COMBINE.has(pillarText)){
        const touched=branches.some((x:any)=>x.id!==br.id&&(BRANCH_CLASHES.has(pairKey(br.char,x.char))||PUNISH_PAIRS.has(pairKey(br.char,x.char))));
        add(touched?"stem_branch_combine":"stem_branch_combine_candidate",[st.id,br.id],{source:'school_whitelist',school:'真一盲派',distance:0,adjacent:true,status:touched?'fact':'candidate',evidence_grade:'A',self_combine_mode:touched?'opened_by_clash_or_punish':'requires_clash_or_punish',major_conclusion_allowed:touched});
      }else if(SELF_COMBINE_CANDIDATE_B.has(pillarText))add("stem_branch_combine_candidate",[st.id,br.id],{source:'derived_prompt',school:'真一盲派整理规则',distance:0,adjacent:true,status:'candidate',evidence_grade:'B',self_combine_mode:'research_only',major_conclusion_allowed:false});
    }

    // 固定禄/原身互通：只作为“来源/延伸”事实，不直接判事件。
    for (const st of stems) {
      const lu = LU_BRANCH[st.char];
      for (const br of branches) if (br.char === lu) add("tonglu", [st.id, br.id], { source: "school_whitelist", school: "真一盲派", distance: pillarDistance(st.pillar, br.pillar), adjacent: pillarDistance(st.pillar, br.pillar) <= 1 });
    }

    const presentBranches = branches.map(n => n.char);
    for (const group of SANHE) if (group.branches.every(z => presentBranches.includes(z))) {
      add("sanhe", group.branches.map(z => branches.find(n => n.char === z)?.id).filter(Boolean), { result_element: group.element, status: "fact" });
    }
    for (const group of SANHUI) if (group.branches.every(z => presentBranches.includes(z))) {
      add("sanhui", group.branches.map(z => branches.find(n => n.char === z)?.id).filter(Boolean), { result_element: group.element, status: "fact" });
    }
    for (const group of SANXING) if (group.branches.every(z => presentBranches.includes(z))) {
      add("sanxing", group.branches.map(z => branches.find(n => n.char === z)?.id).filter(Boolean), { source: "school_whitelist", school: "真一盲派", family: group.family, status: "fact" });
    }

    // 原局墓库先区分“事实入墓”与“仅五行墓库对应候选”。
    // 四生支见墓、丑/未入辰，以及“多而墓之”满足时，生成 tomb_enter 事实；
    // 其它天干/藏干仅保留 tomb_candidate，避免见墓就机械判入。
    const originalTomb=this.resolveTombStateSnapshot(facts,[],new Set<string>());
    for(const st of originalTomb.states||[]){
      if(st.contained!==true||st.inmate_layer!=='original'||st.store_layer!=='original')continue;
      const inmate=facts.byId[st.inmate_id],storeNode=facts.byId[st.store_id];
      if(!inmate||!storeNode)continue;
      add(st.mode==='multi_tomb'?'multi_tomb_enter':'tomb_enter',[inmate.id,storeNode.id],{source:'school_whitelist',school:'真一盲派',status:'fact',tomb_mode:st.mode,evidence_grade:'A'});
    }
    // 天干/藏干的五行墓库对应仍只作候选，不冒充地支真实入墓。
    for (const n of facts.nodes) {
      if (!n.element || n.position === "branch") continue;
      const store = STORE_BRANCH[n.element];
      if (!store) continue;
      const storeNode = branches.find(b => b.char === store);
      if (storeNode && storeNode.id !== n.parentBranchId) add("tomb_candidate", [n.id, storeNode.id], { source: "school_whitelist", school: "真一盲派", status: "candidate", stored_element: n.element });
    }
    return out;
  }

  resolveRoots(facts) {
    const branches = facts.branches.map(id => facts.byId[id]).filter(Boolean);
    const hiddenByBranch:Record<string,any[]> = {};
    for (const br of branches) hiddenByBranch[br.id] = facts.hidden_stems.map(id => facts.byId[id]).filter(h => h.parentBranchId === br.id);
    const result:any[] = [];
    for (const stemId of facts.visible_stems) {
      const stem = facts.byId[stemId];
      const seatBranch = facts.byId[`original.${stem.pillar}.branch`];
      const strata:any[] = [];
      const add=(row:any)=>{const key=`${row.kind}|${row.branchNodeId||''}|${row.hiddenStemNodeId||''}`;if(!strata.some(x=>x._key===key))strata.push({_key:key,...row});};
      const seatHidden = seatBranch ? (hiddenByBranch[seatBranch.id] || []) : [];
      const exactSeat = seatHidden.find((h:any)=>h.char===stem.char);
      if (exactSeat) add({kind:'seat_direct_root',scope:'seat',branchNodeId:seatBranch.id,hiddenStemNodeId:exactSeat.id,level:exactSeat.hiddenLevel,evidence_grade:'A',capacity:'strong',is_direct_root:true,source_rule:'BLIND-ROOT-SEAT-001',detail:`${stem.char}坐${seatBranch.char}，坐下藏同干${exactSeat.char}，记直接坐根`});
      if (seatBranch && LU_BRANCH[stem.char]===seatBranch.char) add({kind:'seat_lu_root',scope:'seat',branchNodeId:seatBranch.id,level:'禄',evidence_grade:'A',capacity:'strong',is_direct_root:true,source_rule:'BLIND-ROOT-LU-001',detail:`${stem.char}坐固定禄${seatBranch.char}，记坐禄根`});
      if (seatBranch && LONGSHENG_BRANCH_BY_ELEMENT[stem.element]===seatBranch.char) add({kind:'seat_longsheng_qi',scope:'seat',branchNodeId:seatBranch.id,level:'长生',evidence_grade:'A',capacity:stem.element==='金'?'medium':'strong',is_direct_root:false,source_rule:'BLIND-QI-LONGSHENG-001',detail:`${stem.char}坐${seatBranch.char}为${stem.element}长生，记坐下长生得气${stem.element==='金'?'（金长生巳为弱长生）':''}`});
      if (seatBranch && (TOMB_QI_BRANCHES_BY_ELEMENT[stem.element]||[]).includes(seatBranch.char)) add({kind:'seat_tomb_qi',scope:'seat',branchNodeId:seatBranch.id,level:'墓库',evidence_grade:'A',capacity:'medium',is_direct_root:false,source_rule:'BLIND-QI-TOMB-001',detail:`${stem.char}坐${seatBranch.char}为${stem.element}墓库，按“坐墓通根得气”记中等承载，不等同禄根`});
      if (seatBranch && RESIDUAL_QI_BRANCH_BY_ELEMENT[stem.element]===seatBranch.char) add({kind:'seat_residual_qi',scope:'seat',branchNodeId:seatBranch.id,level:'余气',evidence_grade:'A',capacity:'weak',is_direct_root:false,source_rule:'BLIND-QI-RESIDUAL-001',detail:`${stem.char}坐${seatBranch.char}为${stem.element}余气，只记弱得气`});

      for (const br of branches) {
        if (!seatBranch || br.id===seatBranch.id) continue;
        const hs=hiddenByBranch[br.id]||[];
        if (LU_BRANCH[stem.char]===br.char) add({kind:'external_lu_support',scope:'external',branchNodeId:br.id,level:'禄',evidence_grade:'A',capacity:'support',is_direct_root:false,source_rule:'BLIND-ROOT-EXTERNAL-SEPARATION-001',detail:`其它柱见${stem.char}固定禄${br.char}，记外部禄援，不与坐下通根合并`});
        const exact=hs.find((h:any)=>h.char===stem.char);
        if (exact) add({kind:'external_same_stem_support',scope:'external',branchNodeId:br.id,hiddenStemNodeId:exact.id,level:exact.hiddenLevel,evidence_grade:'B',capacity:exact.hiddenLevel==='本气'?'support':'weak_support',is_direct_root:false,source_rule:'BLIND-ROOT-EXTERNAL-SEPARATION-001',detail:`其它柱${br.char}藏${stem.char}，只记外部同干支持；严格“坐下通根”口径下不叫直接通根`});
        else {
          const sameEl=hs.find((h:any)=>h.element===stem.element);
          if (sameEl) add({kind:'external_same_element_support',scope:'external',branchNodeId:br.id,hiddenStemNodeId:sameEl.id,level:sameEl.hiddenLevel,evidence_grade:'B',capacity:'weak_support',is_direct_root:false,source_rule:'BLIND-ROOT-EXTERNAL-SEPARATION-001',detail:`其它柱${br.char}仅见${stem.element}同气，记弱外援，不作为直接通根`});
        }
      }
      const rows=strata.map(({_key,...x})=>x);
      const direct=rows.filter((x:any)=>x.scope==='seat');
      const support=rows.filter((x:any)=>x.scope==='external');
      let capacity_status='unsupported', actor_capable=false, stable=false;
      if (direct.some((x:any)=>['seat_direct_root','seat_lu_root'].includes(x.kind))) { capacity_status='strong_direct_root'; actor_capable=true; stable=true; }
      else if (direct.some((x:any)=>x.kind==='seat_longsheng_qi'&&x.capacity==='strong')) { capacity_status='strong_qi'; actor_capable=true; stable=true; }
      else if (direct.some((x:any)=>['seat_longsheng_qi','seat_tomb_qi'].includes(x.kind))) { capacity_status='medium_qi'; actor_capable=true; }
      else if (direct.some((x:any)=>x.kind==='seat_residual_qi')) { capacity_status='weak_qi'; }
      else if (support.length) { capacity_status='external_support_only'; }
      const status = ['strong_direct_root','strong_qi'].includes(capacity_status) ? 'rooted' : ['medium_qi','weak_qi','external_support_only'].includes(capacity_status) ? 'weak_root' : 'rootless';
      result.push({
        stemNodeId:stem.id,roots:rows,root_strata:rows,direct_root_strata:direct,external_support_strata:support,
        direct_source_nodes:uniq(direct.map((x:any)=>x.branchNodeId)),support_nodes:uniq(support.map((x:any)=>x.branchNodeId)),
        capacity_status,actor_capable,status,stable,
        score:null,score_deprecated:true,
        note:'根气不再把所有柱的藏干/同五行相加成 root_score；坐下直接根、长生/墓库/余气得气与其它柱外援分层记录。'
      });
    }
    return result;
  }

  resolveRelationSemantics(facts, relations) {
    const byId = facts.byId;
    const out = [];
    const push = (r, semantic, gate, evidence, counterEvidence, ruleId, meta:any={}) => {
      out.push({ relationId: r.id, semantic, gate, evidence: uniq(evidence || []), counterEvidence: uniq(counterEvidence || []), ruleId, ...meta });
    };
    for (const r of relations) {
      const a = byId[r.nodes[0]], b = byId[r.nodes[1]];
      if (!a || !b) continue;
      if (["stem_combine", "branch_combine", "stem_branch_combine", "stem_branch_combine_candidate"].includes(r.type)) {
        let semantic = "combine_hold";
        const dayActor = a.id === facts.dayMasterNodeId || b.id === facts.dayMasterNodeId;
        const target = a.id === facts.dayMasterNodeId ? b : b.id === facts.dayMasterNodeId ? a : null;
        if (dayActor && target && (WEALTH_GODS.has(target.tenGod) || OFFICIAL_GODS.has(target.tenGod))) semantic = "combine_keep";
        const combineAlternatives = r.type === 'branch_combine'
          ? ['合留','合绊','特殊条件下合去']
          : r.type === 'stem_branch_combine'||r.type === 'stem_branch_combine_candidate'
            ? ['干支自合/合制','合去候选','受刑冲条件影响']
            : ['合去','合伤','合留','合动','合变'];
        push(r, semantic, r.type === "stem_branch_combine_candidate" ? "conditional" : (r.adjacent || r.distance === 0 ? "passed" : "conditional"),
          [dayActor ? "日主直接参与合" : "原局存在真实合关系", r.type === "stem_branch_combine_candidate" ? "该干支自合仍缺来源规定的开库/刑冲条件" : (r.adjacent ? "关系贴身或相邻" : "关系隔位，语义降级")],
          r.type === "stem_branch_combine_candidate" ? ["候选关系不得进入有效主功，满足条件后才升级"] : (r.adjacent ? [] : ["隔位合不直接升级为取得/合去"]), r.type === "stem_branch_combine_candidate" ? "REL-SELF-COMBINE-CONDITIONAL-001" : "REL-COMBINE-001",
          {book_adjudication:{family:'combine',alternatives:combineAlternatives,selected:semantic,selection_status:'context_required',distance:r.distance,adjacent:!!r.adjacent,note:'“合”先是关系事实；合去/合伤/合留/合动/合变等语义必须由原局/岁运层、位置、对象和后续结果共同裁决。'}});
      } else if (r.type === "clash") {
        const storeTouched = [a, b].some(n => Object.values(STORE_BRANCH).includes(n.char));
        push(r, "clash_move", storeTouched ? "conditional" : "passed",
          [storeTouched ? "冲到墓库支，原局层先取冲动/扰动候选" : "原局两支真实相冲"],
          storeTouched ? ["原局冲墓不能直接等同开库", "必须继续检查入墓对象与开后归属"] : [], "REL-CLASH-001",
          {book_adjudication:{family:'clash',alternatives:storeTouched?['冲坏库/库中物','冲开候选','冲制','仅扰动']:['冲制','冲坏','冲破','冲动','冲旺'],selected:'clash_move',selection_status:'context_required',distance:r.distance,adjacent:!!r.adjacent,storeTouched,note:'原局六冲必须继续看远近、强弱、月令/党势及是否冲库；不能由“有冲”一步直译结果。'}});
      } else if (r.type === "harm") {
        const hp=r.school_direction_profile||null;
        push(r, "wear_damage", r.adjacent ? "passed" : "conditional",
          [r.adjacent ? "穿害关系贴身，作用更直接" : "存在穿害，但位置较远"],
          ["穿害本身不是重大事件结论；相生穿/相克穿的制用含义另按方向与对象判断"], "REL-HARM-001",
          {book_adjudication:{family:'piercing',alternatives:hp?.mode==='directional_control_candidate'?['穿制候选','穿坏/无情候选']:['穿坏/无情候选','是否制用待全局'],direction_profile:hp,evidence_grade:hp?'B':'A_relation_only',selection_status:'context_required',note:'核心书确认“穿”属于做功方式，但具体方向与制成效率存在讲义/整理差异；方向表只保留候选，不单独驱动第一主功。'}});
      } else if (r.type === "absolute") {
        const dp=r.school_direction_profile;
        push(r, "absolute_relation", "conditional", ["命中真一/段式资料使用的寅酉、卯申、子巳、午亥四绝关系",dp?.preferred?`B级方向候选：${dp.preferred}`:"方向只保留关系级候选"], ["四绝的方向性制用在现有核心书源中没有统一可执行强度表；先保留关系事实，不凭关系名自动断制成或重大事件"], "REL-ABSOLUTE-B-001");
      } else if (r.type === "break_candidate") {
        push(r,"break_candidate","conditional",["命中研究资料/常见六破候选"],["当前流派核心规则未冻结为生产破法；不得参与第一主功或重大事件"],"REL-BREAK-B-CANDIDATE-001");
      } else if (r.type === "self_punish_candidate") {
        push(r,"self_punish_candidate","conditional",["辰午酉亥同支重复的自刑研究候选"],["当前核心治理明确不把自刑当生产硬规则；仅留可审计候选"],"REL-SELF-PUNISH-B-CANDIDATE-001");
      } else if (["brittle_control","dampen_fire"].includes(r.type)) {
        push(r, r.type === "brittle_control" ? "dry_earth_brittle_metal" : "wet_earth_dampen_fire", "passed",
          [r.type === "brittle_control" ? "未戌燥土对金不按普通土生金，按脆金/制金处理" : "辰丑湿土对火存在晦火作用", r.adjacent || r.distance===0 ? "关系贴身/相邻，可进入做功语义" : "关系较远"],
          ["特殊物性只覆盖对应对象，不扩展为所有土的统一生克规则"], r.type === "brittle_control" ? "REL-DRY-EARTH-BRITTLE-001" : "REL-WET-EARTH-DAMPEN-001");
      } else if (r.type === "punish") {
        const touchesStore=[a,b].some((n:any)=>['丑','未','戌'].includes(n.char));
        push(r, "punish_process", "conditional", ["原局存在核心白名单刑关系"], ["刑既可表示损坏，也可能刑开墓库形成制法；必须看位置、力量和第三支是否到齐"], "REL-PUNISH-001",
          {book_adjudication:{family:'punish',alternatives:touchesStore?['刑开库候选','刑制候选','刑坏候选']:['损坏/责难候选'],storeTouched:touchesStore,selection_status:'context_required',note:'丑戌、未戌按核心刑关系；丑未以冲为主。寅巳申仅三字齐全时强化三刑。'}});
      } else if (r.type === "break") {
        push(r, "break_disrupt", "conditional", ["原局存在破关系"], ["破只记录结构扰动，不单独决定吉凶"], "REL-BREAK-001");
      } else if (r.type === "dark_combine") {
        push(r, "dark_combine_link", "conditional", ["原局命中固定暗合白名单"], ["暗合不等于六合；这里只保留暗中关联/牵动事实，不自动判合留合去或吉凶"], "REL-DARK-COMBINE-001");
      } else if (r.type === "half_harmony") {
        push(r, "half_harmony_link", "conditional", ["原局命中三合体系半合两支"], ["半合不是完整三合，不自动成局、化局或定事件"], "REL-HALF-HARMONY-001");
      } else if (r.type === "arch_harmony") {
        push(r, "arch_harmony_link", "conditional", ["原局命中三合体系拱局两支"], ["拱局只保留组合线索，虚神不自动当实字使用"], "REL-ARCH-HARMONY-001");
      } else if (r.type === "generate") {
        push(r, "generate_flow", r.adjacent || r.distance === 0 ? "passed" : "conditional",
          ["五行相生方向客观成立", r.medium === "same_pillar" ? "同柱作用" : r.adjacent ? "相邻作用" : "隔位作用"],
          ["相生只说明资源/输出流向，不等于成果归主"], "REL-GENERATE-001");
      } else if (r.type === "control") {
        push(r, "control_candidate", r.adjacent || r.distance === 0 ? "passed" : "conditional",
          ["五行克制方向客观成立", r.medium === "same_pillar" ? "同柱作用" : r.adjacent ? "相邻作用" : "隔位作用"],
          ["有克不等于有效制用，必须校验力量、目标和结果"], "REL-CONTROL-001");
      } else if (["tomb_enter","multi_tomb_enter"].includes(r.type)) {
        push(r, r.type==="multi_tomb_enter"?"multi_store_enter":"store_enter", "passed",
          [r.type==="multi_tomb_enter"?"满足多而墓之且墓库实际在局":"满足稳定地支入墓条件", "这是原局墓库事实，不是五行对应猜测"],
          ["入墓事实不自动等于吉凶；仍需看墓在主宾、是否开库及结果归属"], "REL-TOMB-FACT-001");
      } else if (r.type === "tomb_candidate") {
        push(r, "store_enter", "conditional", ["目标五行存在对应固定墓库"], ["仅墓库对应不等于已经有效入墓或归主"], "REL-TOMB-001");
      } else if (["sanhe", "sanhui"].includes(r.type)) {
        push(r, "group_formation", "conditional", [`${r.type === "sanhe" ? "三合" : "三会"}组合齐全`, `组合五行：${r.result_element || "—"}`], ["成局、改性、最终归属分开判断"], "REL-GROUP-001");
      } else if (r.type === "sanxing") {
        push(r, "sanxing_complete", "conditional", [`${r.family || "三刑"}三字齐全`], ["三刑成组后才强化刑的整体语义；仍需看位置、力量与被作用对象"], "REL-SANXING-BLIND-001");
      } else if (r.type === "tonglu") {
        push(r, "source_extension", "passed", ["固定禄/原身互通白名单命中"], ["互通只说明身份延伸与来源，不单独判事件"], "REL-TONGLU-001");
      } else if (r.type === "same_char") {
        push(r, "repeat_identity", "passed", ["原局同字重复出现"], ["同字不自动等于伏吟应事"], "REL-REPEAT-001");
      }
    }
    return out;
  }

  resolveGuestHost(facts, relations, context) {
    const nodeStates:any = {};
    // hostWeight 保留为 v2.4 兼容/展示信号；bookSide / hierarchyFacts 才是 v2.5.3 书本宾主事实。
    const contextBase:any = {
      general:      { year: 0.15, month: 0.35, day: 0.95, hour: 0.80 },
      wealth:       { year: 0.10, month: 0.30, day: 0.95, hour: 0.85 },
      career:       { year: 0.12, month: 0.32, day: 0.95, hour: 0.82 },
      relationship: { year: 0.18, month: 0.38, day: 1.00, hour: 0.78 },
      family:       { year: 0.35, month: 0.48, day: 0.92, hour: 0.75 },
      timing:       { year: 0.78, month: 0.82, day: 0.98, hour: 0.88 }
    };
    const base=contextBase[context]||contextBase.general;
    const dayPartyNodeIds=new Set<string>();
    for(const r of (relations||[])){
      if(!['sanhe','sanhui'].includes(r.type)||(r.nodes||[]).indexOf(facts.dayBranchNodeId)<0)continue;
      for(const id of r.nodes||[])dayPartyNodeIds.add(id);
    }
    const hierarchyFacts:any[]=[];
    for(const n of facts.nodes){
      let weight=base[n.pillar]??0;
      if(n.id===facts.dayMasterNodeId)weight=1;
      if(context==='relationship'&&n.id===facts.dayBranchNodeId)weight=1;
      if(dayPartyNodeIds.has(n.id))weight=Math.max(weight,.72);
      if(n.position==='hidden_stem')weight=Math.max(0,weight-.05);

      // 做功/成果归属层采用“日时为主、年月为宾”的明确层级；不由小数阈值现场发明。
      const bookSide=(n.pillar==='day'||n.pillar==='hour')?'host':'guest';
      const dayPillarSide=n.pillar==='day'?'host':'guest';
      const dayMasterSide=n.id===facts.dayMasterNodeId?'host':'guest';
      const innerOuterSide=(n.pillar==='day'||n.pillar==='hour')?'inner_host':'outer_guest';
      const gongSide=bookSide==='host'?'host':dayPartyNodeIds.has(n.id)?'host_proxy_by_day_party':'guest';
      let reason=n.id===facts.dayMasterNodeId?'日主本体':n.pillar==='day'?'日柱主位':n.pillar==='hour'?'日时层内盘主位':n.pillar==='month'?'年月层宾位':'年月层宾位';
      if(dayPartyNodeIds.has(n.id))reason+=' · 与日支同入完整三合/三会，只提升同党关系，不永久改写其宫位宾主';
      nodeStates[n.id]={nodeId:n.id,context,side:bookSide,bookSide,gongSide,dayMasterSide,dayPillarSide,innerOuterSide,hostWeight:Number(weight.toFixed(2)),weightRole:'compatibility_hint',reason};
      hierarchyFacts.push({nodeId:n.id,levels:{daymaster_vs_others:dayMasterSide,daypillar_vs_others:dayPillarSide,daytime_vs_yearmonth:bookSide,inner_outer:innerOuterSide,gong_side:gongSide},source_rule:'BLIND-GUEST-HOST-HIERARCHY-001'});
    }
    return {
      context,
      mode:'book_hierarchical_guest_host_v1',
      levels:['daymaster_vs_others','daypillar_vs_others','daytime_vs_yearmonth','original_vs_luck','original_dayun_vs_liunian'],
      hierarchyFacts,
      nodeStates,
      note:'宾主按层级事实保存：日主/他干支、日柱/他柱、日时/年月、原局/岁运。hostWeight仅保留兼容，不作为书理本体。'
    };
  }

  resolveOrigins(facts, roots, guestHost) {
    const out = [];
    const rootMap = Object.fromEntries((roots || []).map(r => [r.stemNodeId, r]));
    const sideOf = id => guestHost.nodeStates[id]?.side || "unclear";
    for (const n of facts.nodes) {
      let sourceNodes = [];
      if (n.position === "stem") sourceNodes = (rootMap[n.id]?.direct_source_nodes || rootMap[n.id]?.roots?.map(r => r.branchNodeId) || []);
      else if (n.position === "hidden_stem" && n.parentBranchId) sourceNodes = [n.parentBranchId];
      else if (n.position === "branch") sourceNodes = [n.id];
      sourceNodes = uniq(sourceNodes);
      const sides = uniq(sourceNodes.map(sideOf));
      const sourceSide = !sourceNodes.length ? "none" : sides.length === 1 ? sides[0] : "mixed";
      out.push({
        nodeId: n.id,
        sourceNodes,
        sourceSide,
        hasSource: sourceNodes.length > 0,
        note: n.position === "stem" ? (sourceNodes.length ? "按根气追踪来源位置" : "未见明确根源") : n.position === "hidden_stem" ? "来源于所属地支" : "地支实体自身"
      });
    }
    return out;
  }

  resolveIntents(facts, relations, guestHost) {
    const byId = facts.byId, out = [];
    const addIntent = (nodeId, type, via, confidence = "medium", note = "") => {
      let row = out.find(x => x.nodeId === nodeId);
      if (!row) { row = { nodeId, baseIdentity: byId[nodeId]?.tenGod || (nodeId === facts.dayMasterNodeId ? "日主" : ""), intents: [] }; out.push(row); }
      if (!row.intents.some(x => x.type === type && x.viaRelationIds.join() === [via].filter(Boolean).join())) row.intents.push({ type, confidence, viaRelationIds: [via].filter(Boolean), note });
    };
    const dayId = facts.dayMasterNodeId;
    for (const r of relations) {
      const a = byId[r.nodes[0]], b = byId[r.nodes[1]];
      if (!a || !b) continue;
      if (["stem_combine", "stem_branch_combine"].includes(r.type) && r.nodes.includes(dayId)) {
        const t = r.nodes.map(id => byId[id]).find(n => n.id !== dayId);
        if (WEALTH_GODS.has(t?.tenGod)) addIntent(dayId, "seek_wealth", r.id, "high", "日主直接合财");
        else if (OFFICIAL_GODS.has(t?.tenGod)) addIntent(dayId, "seek_authority", r.id, "high", "日主直接合官杀");
        else addIntent(dayId, "connect_target", r.id, "medium", "日主直接参与合");
      }
      if (r.type === "generate" && r.nodes[0] === dayId) {
        const t = byId[r.nodes[1]];
        if (OUTPUT_GODS.has(t?.tenGod)) addIntent(dayId, "output", r.id, r.adjacent ? "high" : "medium", "日主生食伤/输出");
      }
      if (r.type === "control" && r.nodes[0] === dayId) {
        const t = byId[r.nodes[1]];
        if (WEALTH_GODS.has(t?.tenGod)) addIntent(dayId, "seek_wealth", r.id, "medium", "日主直接克财");
      }
      if (r.type === "generate") {
        const from = byId[r.nodes[0]], to = byId[r.nodes[1]];
        if (OUTPUT_GODS.has(from?.tenGod) && WEALTH_GODS.has(to?.tenGod)) addIntent(from.id, "generate_wealth", r.id, r.adjacent ? "high" : "medium", "食伤生财");
        if (OFFICIAL_GODS.has(from?.tenGod) && RESOURCE_GODS.has(to?.tenGod)) addIntent(from.id, "transform_pressure", r.id, "medium", "官杀生印");
      }
      if (r.type === "control") {
        const from = byId[r.nodes[0]], to = byId[r.nodes[1]];
        if (OUTPUT_GODS.has(from?.tenGod) && OFFICIAL_GODS.has(to?.tenGod)) addIntent(from.id, "control_authority", r.id, r.adjacent ? "high" : "medium", "食伤制官杀");
        if (RESOURCE_GODS.has(from?.tenGod) && OUTPUT_GODS.has(to?.tenGod)) addIntent(from.id, "control_output", r.id, "medium", "印制食伤");
        if (WEALTH_GODS.has(from?.tenGod) && RESOURCE_GODS.has(to?.tenGod)) addIntent(from.id, "control_resource", r.id, "medium", "财制印");
      }
    }
    return out;
  }

  resolveQiShi(facts, relations, roots) {
    const score = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
    for (const n of facts.nodes) {
      if (!n.element) continue;
      let w = n.position === "stem" ? 1 : n.position === "branch" ? 1.7 : n.hiddenLevel === "本气" ? 0.45 : n.hiddenLevel === "中气" ? 0.25 : 0.15;
      if (n.id === facts.monthBranchNodeId) w += 0.9;
      score[n.element] += w;
    }
    const comboBoost = [];
    for (const r of relations) if (["sanhe", "sanhui"].includes(r.type) && r.result_element) {
      score[r.result_element] += 2.2;
      comboBoost.push({ relationId: r.id, element: r.result_element, type: r.type });
    }

    const ordered = Object.entries(score).sort((a:any, b:any) => b[1] - a[1]);
    const groups:any[] = [];

    // A. 单一元素形成明显优势。
    const [top, second] = ordered as any;
    const ratio = second?.[1] ? top[1] / second[1] : 9;
    if (top[1] >= 4.5 && ratio >= 1.22) {
      groups.push({
        id: `qishi_${top[0]}`,
        elements: [top[0]],
        score: Number(top[1].toFixed(2)),
        support: {
          monthOrder: facts.byId[facts.monthBranchNodeId]?.element === top[0],
          combination: comboBoost.some(x => x.element === top[0]),
          weightedDominance: true,
          alliedChain: false
        },
        targetElement: ELEMENT_CONTROLS[top[0]] || "",
        confidence: ratio >= 1.5 ? "high" : "medium"
      });
    }

    // B. 两个相生元素结成一党。核心命例中“火与燥土之势”“金水之势”不能被单元素阈值漏掉。
    // 仅在两者都具有明显实体、且合计显著压过第三方时成立，避免仅凭数量机械成势。
    let bestAlliance:any = null;
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const [e1, s1]:any = ordered[i], [e2, s2]:any = ordered[j];
        if (s1 < 3.0 || s2 < 3.0) continue;
        let upstream = "", downstream = "";
        if (ELEMENT_GENERATES[e1] === e2) { upstream = e1; downstream = e2; }
        else if (ELEMENT_GENERATES[e2] === e1) { upstream = e2; downstream = e1; }
        else continue;
        const rest = ordered.filter((_, k) => k !== i && k !== j).map((x:any) => x[1]);
        const third = Math.max(...rest, 0.01);
        const total = s1 + s2;
        const dominance = total / third;
        if (dominance < 1.72) continue;
        const candidate = {
          id: `qishi_${upstream}_${downstream}`,
          elements: [upstream, downstream],
          score: Number(total.toFixed(2)),
          support: {
            monthOrder: [upstream, downstream].includes(facts.byId[facts.monthBranchNodeId]?.element),
            combination: comboBoost.some(x => [upstream, downstream].includes(x.element)),
            weightedDominance: true,
            alliedChain: true
          },
          // 相生党以“承接端”作为最终发力面，例如火→土之势主要可制水。
          targetElement: ELEMENT_CONTROLS[downstream] || "",
          confidence: dominance >= 2.25 ? "high" : "medium",
          dominance: Number(dominance.toFixed(2))
        };
        if (!bestAlliance || candidate.score > bestAlliance.score) bestAlliance = candidate;
      }
    }
    if (bestAlliance) groups.push(bestAlliance);

    // 优先选择有相生闭环的党势；否则用单元素优势。
    groups.sort((a, b) => (b.support.alliedChain ? 1 : 0) - (a.support.alliedChain ? 1 : 0) || b.score - a.score);
    return {
      elementScore: Object.fromEntries(Object.entries(score).map(([k, v]:any) => [k, Number(v.toFixed(2))])),
      groups,
      dominant: groups[0] || null,
      note: "气势只作为做功裁决的结构辅助；支持单一强势与相生党势，不以元素数量单独判吉凶。"
    };
  }

  enumerateGongPaths(facts, relations, semantics, roots, guestHost, intents, qishi) {
    const byId = facts.byId, out = [];
    const dayMasterChar=byId[facts.dayMasterNodeId]?.char || '';
    const gh = (id:string) => guestHost.nodeStates[id]?.hostWeight ?? 0; // compatibility only; not used as book-side ontology
    const gongHost=(id:string)=>['host','host_proxy_by_day_party'].includes(guestHost.nodeStates[id]?.gongSide||'');
    const semanticMap = new Map((semantics || []).map((x:any)=>[x.relationId,x]));
    const rootMap = new Map((roots || []).map((x:any)=>[x.stemNodeId,x]));
    const semanticUsable = (relationId:string) => (semanticMap.get(relationId) as any)?.gate !== 'failed';
    const add = p => {
      const signature = `${p.type}|${(p.actorNodes || []).join(",")}|${(p.targetNodes || []).join(",")}|${(p.relationIds || []).join(",")}`;
      if (out.some(x => x.signature === signature)) return;
      out.push({ id: `G${String(out.length + 1).padStart(3, "0")}`, signature, bridgeNodes: [], resultNodes: [], relationIds: [], ...p });
    };
    const classifyZhiCoreTitle = (actor, target) => {
      if (!actor || !target) return "";
      if (PEER_GODS.has(actor.tenGod) && WEALTH_GODS.has(target.tenGod)) return "比劫制财";
      if (WEALTH_GODS.has(actor.tenGod) && PEER_GODS.has(target.tenGod)) return "财制比劫";
      if (OFFICIAL_GODS.has(actor.tenGod) && PEER_GODS.has(target.tenGod)) return "官杀制比劫";
      if (PEER_GODS.has(actor.tenGod) && OFFICIAL_GODS.has(target.tenGod)) return "比劫去官杀";
      if (OUTPUT_GODS.has(actor.tenGod) && OFFICIAL_GODS.has(target.tenGod)) return target.tenGod === "七杀" ? "食伤制杀" : "食伤制官";
      if (RESOURCE_GODS.has(actor.tenGod) && OUTPUT_GODS.has(target.tenGod)) return "印制食伤";
      if (WEALTH_GODS.has(actor.tenGod) && RESOURCE_GODS.has(target.tenGod)) return "财制印";
      return "";
    };
    const classifyZhiTitle = (actor, target) => {
      const core=classifyZhiCoreTitle(actor,target); if(core)return core;
      if (actor?.id !== facts.dayMasterNodeId && gongHost(actor?.id) && BODY_GODS.has(actor?.tenGod) && USE_GODS.has(target?.tenGod)) return `${actor.tenGod || "主位之体"}制${target.tenGod || "宾位之用"}`;
      return "";
    };
    const godFamily = (god:string) => WEALTH_GODS.has(god)?"财":OFFICIAL_GODS.has(god)?"官杀":RESOURCE_GODS.has(god)?"印":OUTPUT_GODS.has(god)?"食伤":PEER_GODS.has(god)?"比劫":god||"对象";
    // “制局类型存在”不等于任意同名五行作用都自动成为命主之功。
    // 对新增的“官杀/财制比劫”尤其要区分：宾位之用直接打主位之体，若未被主方掌控/代理，
    // 只是受制事实，不可因为标题像经典制局就升成有效主功（来源反例锁定此边界）。
    const needsUseControlsBodyGate = (title:string,actor:any,target:any) =>
      ['官杀制比劫','财制比劫'].includes(title) && !gongHost(actor?.id) && gongHost(target?.id);

    // 1. 制用：十神组合必须与真实克制关系同时存在。
    for (const r of relations.filter(x => ["control","brittle_control","dampen_fire"].includes(x.type))) {
      const actor = byId[r.nodes[0]], target = byId[r.nodes[1]];
      if (!actor || !target) continue;
      const title = classifyZhiTitle(actor, target);
      if (!title) continue;
      const useControlsBodyUnowned=needsUseControlsBodyGate(title,actor,target);
      add({ type: "zhi_yong", ruleId: "GONG-ZHI-001", title, actorNodes: [actor.id], targetNodes: [target.id], resultNodes: [target.id], relationIds: [r.id], roleMap: { [actor.id]: "tool", [target.id]: "target" }, rawReason: useControlsBodyUnowned ? "宾位之用直接制主位之体，但未证明该用已被主方掌控；只保留受制候选" : (r.type === "brittle_control" ? "未戌燥土脆金专项 + 体用对象成立" : r.type === "dampen_fire" ? "辰丑湿土晦火专项 + 体用对象成立" : "真实克制关系 + 体用对象成立"), actionMode: r.type === "control" ? "direct_control" : "special_control", forceConditional: useControlsBodyUnowned || undefined });
    }

    // 1B. 主宾冲取 + 冲制。
    // 原书基准明确：冲是双向作用；在“主位之体 ↔ 宾位之用”且主宾明确时，允许主位取用。
    // 但“日禄被宾位官杀冲”属于反例：若无另一条主方制化/党势闭环，不得倒解释成日禄取杀。
    const hasHostClosureAgainst = (target:any, excludeRelationId:string) => {
      const direct = relations.some((rel:any) => {
        if (rel.id === excludeRelationId || !semanticUsable(rel.id)) return false;
        if (!['control','brittle_control','dampen_fire','clash','stem_combine','branch_combine','stem_branch_combine','tomb_enter','multi_tomb_enter'].includes(rel.type)) return false;
        if (!(rel.nodes || []).includes(target.id)) return false;
        return (rel.nodes || []).some((id:string) => id !== target.id && gongHost(id));
      });
      if (direct) return true;
      const q=qishi?.dominant;
      if (!q || !['high','medium'].includes(q.confidence) || q.targetElement !== target.element) return false;
      return facts.nodes.some((n:any)=>n.position!=='hidden_stem' && gongHost(n.id) && (q.elements||[]).includes(n.element));
    };
    const addClashTake = (r:any, actor:any, target:any) => {
      if (!actor || !target || !gongHost(actor.id) || gongHost(target.id)) return false;
      if (!BODY_GODS.has(actor.tenGod) || !USE_GODS.has(target.tenGod)) return false;
      // 若该方向已经能被核心制局分类（食伤制杀、比劫制财等）解释，就保留更具体的制局语义；
      // clash_take 只补“体冲用但非普通五行制局”的来源缺口，避免泛化抢主线。
      if (classifyZhiCoreTitle(actor,target)) return false;
      const isDayLu = actor.id===facts.dayBranchNodeId && LU_BRANCH[dayMasterChar]===actor.char;
      const killAttacksLu = isDayLu && OFFICIAL_GODS.has(target.tenGod) && elementControls(target.element, actor.element);
      if (killAttacksLu && !hasHostClosureAgainst(target,r.id)) return false;
      add({
        type:'zhi_yong', ruleId:'GONG-CLASH-TAKE-001', title:`${actor.tenGod || '主位之体'}冲${target.tenGod || '宾位之用'}`,
        actorNodes:[actor.id],targetNodes:[target.id],resultNodes:[target.id],relationIds:[r.id],
        roleMap:{[actor.id]:'body',[target.id]:'use'},
        rawReason:'真实地支冲 + 主位之体对宾位之用；按冲的双向取用门生成主宾冲取。',
        actionMode:'clash_take',evidence_grade:'A',source_gate:'host_body_guest_use'
      });
      return true;
    };

    for (const r of relations.filter(x => x.type === "clash")) {
      const a = byId[r.nodes[0]], b = byId[r.nodes[1]];
      if (!a || !b) continue;
      // 先生成来源明确的主宾冲取；若五行克制方向相同，signature 去重会保留更具体的 clash_take 语义。
      addClashTake(r,a,b); addClashTake(r,b,a);

      let actor:any = null, target:any = null, via = "";
      // 冲是双向事实，方向不能永远退化为单字五行克制。核心书明确存在“成党成势后，
      // 原本被克的一方反借全党之势冲制对方”的命例（如木火党寅申冲、申子辰局子未穿）。
      // 因此先看已经成立的书本党势是否对这组冲给出唯一战略方向；只有没有党势方向时，
      // 才退回旧 QiShi 与普通五行克制。这里不改变成果归属，归属仍由 Settlement 单独裁决。
      const bp = qishi?.book_party?.dominant;
      if (bp && bp.formation === 'formed') {
        const memberSet = new Set<string>(bp.memberNodeIds || []);
        const targetKinds = new Set<string>(bp.targetKinds || []);
        const kindOf = (n:any) => n?.position === 'branch' && ['未','戌'].includes(n?.char) ? '燥土'
          : n?.position === 'branch' && ['辰','丑'].includes(n?.char) ? '湿土'
          : n?.element || '';
        const ab = memberSet.has(a.id) && !memberSet.has(b.id) && targetKinds.has(kindOf(b));
        const ba = memberSet.has(b.id) && !memberSet.has(a.id) && targetKinds.has(kindOf(a));
        if (ab !== ba) {
          actor = ab ? a : b; target = ab ? b : a; via = 'book_party';
        }
      }
      const q = qishi?.dominant;
      if (!actor && q && ["high", "medium"].includes(q.confidence) && q.targetElement) {
        if (q.elements.includes(a.element) && b.element === q.targetElement) { actor = a; target = b; via = "qishi"; }
        else if (q.elements.includes(b.element) && a.element === q.targetElement) { actor = b; target = a; via = "qishi"; }
      }
      if (!actor) {
        if (elementControls(a.element, b.element)) { actor = a; target = b; via = "element"; }
        else if (elementControls(b.element, a.element)) { actor = b; target = a; via = "element"; }
      }
      if (!actor || !target) continue;
      const title = classifyZhiTitle(actor, target);
      if (!title) continue;
      const useControlsBodyUnowned=needsUseControlsBodyGate(title,actor,target);
      add({
        type: "zhi_yong", ruleId: "GONG-CLASH-ZHI-001", title,
        actorNodes: [actor.id], targetNodes: [target.id], resultNodes: [target.id], relationIds: [r.id],
        roleMap: { [actor.id]: "tool", [target.id]: "target" },
        rawReason: useControlsBodyUnowned ? "冲克事实成立，但为宾位之用直接制主位之体且未证明归主；不自动视为命主有效制局" : (via === "book_party" ? "地支相冲 + 已成立书本党势决定战略制用方向" : via === "qishi" ? "地支相冲 + 已成立党势决定制用方向" : "地支相冲 + 五行克制方向形成冲制"),
        actionMode: "clash_control", qishiBased: via === "qishi" || via === "book_party", forceConditional: useControlsBodyUnowned || undefined
      });
    }

    // 1B.1 穿制：方向与归属严格分离。
    // 核心书反复说明：同一穿对可以双向表现，谁真正“穿倒/穿制”取决于成势、旺衰与具体结构；
    // 不能因为某字在主位，就自动把主位当穿的主动方。
    // 生产方向按以下证据层次解析：
    //   A. 已成立的高/中置信党势，且该成员真实指向当前目标；
    //   B. 书源稳定方向 + 主方执行/“日主体墓库代理”结构；
    // 其它方向一律只保留 candidate。成果归谁仍交给 Ownership/Settlement，绝不由穿方向替代。
    const hasYangRenRestraint=(blade:any,excludeRelationId:string)=>relations.some((rel:any)=>{
      if(rel.id===excludeRelationId||!semanticUsable(rel.id)||!(rel.nodes||[]).includes(blade.id))return false;
      if(!['control','clash','harm','stem_branch_combine','branch_combine'].includes(rel.type))return false;
      const other=(rel.nodes||[]).map((id:string)=>byId[id]).find((n:any)=>n&&n.id!==blade.id);
      return !!other&&OFFICIAL_GODS.has(other.tenGod);
    });
    const hiddenChildren=(branch:any)=>facts.nodes.filter((n:any)=>n.parentBranchId===branch?.id);
    const dayMasterElement=byId[facts.dayMasterNodeId]?.element||'';
    // 例如甲日见未：未是木墓并藏乙劫，可在“羊刃/比劫库”语境中代理日主体一党。
    // 这里只承认“本五行墓库 + 藏比劫”这一可复算结构，不按具体命例 ID 特判。
    const isDayBodyTombProxy=(branch:any)=>!!branch&&branch.position==='branch'&&STORE_BRANCH[dayMasterElement]===branch.char&&hiddenChildren(branch).some((n:any)=>PEER_GODS.has(n.tenGod));
    const wearTitle=(actor:any,target:any)=>{
      if(isDayBodyTombProxy(actor)){
        if(RESOURCE_GODS.has(target?.tenGod))return '比劫羊刃库制印';
        if(WEALTH_GODS.has(target?.tenGod))return '比劫库制财';
        if(OFFICIAL_GODS.has(target?.tenGod))return '比劫库去官杀';
        if(OUTPUT_GODS.has(target?.tenGod))return '比劫库制食伤';
      }
      return classifyZhiTitle(actor,target);
    };
    const explicitFormationSupportsWear=(actor:any,target:any)=>relations.some((rel:any)=>
      ['sanhe','sanhui'].includes(rel.type)&&
      (rel.nodes||[]).includes(actor?.id)&&!(rel.nodes||[]).includes(target?.id)&&
      rel.result_element===actor?.element
    );
    const qishiSupportsWear=(actor:any,target:any)=>{
      const q=qishi?.dominant;
      return !!q&&['high','medium'].includes(q.confidence)&&(q.elements||[]).includes(actor?.element)&&q.targetElement===target?.element;
    };
    const sourceProfileDirection=(r:any,a:any,b:any)=>{
      const preferred=String(r.school_direction_profile?.stronger||'');
      if(!preferred.includes('>'))return null;
      const [fromChar,toChar]=preferred.split('>');
      const actor=a.char===fromChar?a:b.char===fromChar?b:null;
      const target=a.char===toChar?a:b.char===toChar?b:null;
      return actor&&target?{actor,target}:null;
    };
    for (const r of relations.filter(x => x.type === 'harm')) {
      const a=byId[r.nodes[0]],b=byId[r.nodes[1]]; if(!a||!b)continue;
      const directional:[[any,any],[any,any]]=[[a,b],[b,a]];

      // A. 三合/三会是最强的方向反转证据：书例明确“本来未克子，但子入申子辰强局后反成子穿未”。
      const formationDirections=directional.filter(([actor,target])=>explicitFormationSupportsWear(actor,target)&&!!wearTitle(actor,target));
      let production:any=null;
      if(formationDirections.length===1){
        const [actor,target]=formationDirections[0];
        production={actor,target,title:wearTitle(actor,target),gate:'explicit_formation_direction',qishiBased:true};
      }else{
        // A2. 核心书明确例：日支主位通过穿去制宾位羊刃（林彪造“子未穿，穿制刃星，做功”）。
        // 这是“目标身份 + 宾主位置”优先于通用穿方向表的上下文规则，不按具体四柱/case-id 特判。
        const dayBranch=byId[facts.dayBranchNodeId];
        const yangRenChar=YANG_REN_BRANCH[dayMasterChar];
        const other=a?.id===dayBranch?.id?b:b?.id===dayBranch?.id?a:null;
        if(dayBranch&&other&&['year','month'].includes(other.pillar)&&other.char===yangRenChar&&PEER_GODS.has(other.tenGod)&&!!wearTitle(dayBranch,other)){
          production={actor:dayBranch,target:other,title:wearTitle(dayBranch,other),gate:'day_branch_pierces_guest_yangren',qishiBased:false};
        }
        // B. 没有来源上下文反转时，才尊重方向校准表；
        // 执行端还必须属于主方，或是日主体墓库代理。方向事实与成果归属仍然分开。
        if(!production){
        // 执行端还必须属于主方，或是日主体墓库代理。方向事实与成果归属仍然分开。
        const pref=sourceProfileDirection(r,a,b);
        if(pref){
          const title=wearTitle(pref.actor,pref.target);
          if(title&&(gongHost(pref.actor.id)||isDayBodyTombProxy(pref.actor))){
            production={...pref,title,gate:isDayBodyTombProxy(pref.actor)?'day_body_tomb_proxy_direction':'source_profile_host_direction',qishiBased:false};
          }
        }else{
          // C. 没有稳定方向表（如卯辰、寅巳、申亥）时，只有已成立气势能唯一解释方向才晋级；否则保持候选。
          const qishiDirections=directional.filter(([actor,target])=>qishiSupportsWear(actor,target)&&!!wearTitle(actor,target));
          if(qishiDirections.length===1){
            const [actor,target]=qishiDirections[0];
            production={actor,target,title:wearTitle(actor,target),gate:'qishi_direction',qishiBased:true};
          }
        }
        }
      }

      if(production){
        const {actor,target,title}=production;
        const isYangRen=YANG_REN_BRANCH[dayMasterChar]===actor.char&&PEER_GODS.has(actor.tenGod);
        const bladePiercesWealth=isYangRen&&WEALTH_GODS.has(target.tenGod);
        const restrained=!bladePiercesWealth||hasYangRenRestraint(actor,r.id)||hasHostClosureAgainst(target,r.id);
        add({
          type:'zhi_yong',ruleId:'GONG-WEAR-CONTROL-002',title,
          actorNodes:[actor.id],targetNodes:[target.id],resultNodes:[target.id],relationIds:[r.id],
          roleMap:{[actor.id]:'tool',[target.id]:'target'},
          rawReason: restrained
            ? `穿方向已由${production.gate==='qishi_direction'?'成势/成局':'来源方向+主方/体墓代理'}证据解析；方向与归属分离后进入正式穿制。`
            : '羊刃/比劫穿财但缺少官杀约束或其它闭环；穿事实成立，不自动解释成成功取财。',
          actionMode:'wear_control',forceConditional:restrained?undefined:true,evidence_grade:'A',
          qishiBased:production.qishiBased||undefined,
          source_gate: restrained?production.gate:'yangren_wealth_unrestrained'
        });
      }

      // 所有未晋级方向继续保留为机器可审计候选。方向表本身是校准层，不直接等于现实“取得”。
      const preferred=String(r.school_direction_profile?.stronger||'');
      if(preferred.includes('>')){
        const [fromChar,toChar]=preferred.split('>');
        const actor=a.char===fromChar?a:b.char===fromChar?b:null;const target=a.char===toChar?a:b.char===toChar?b:null;
        if(actor&&target){
          const sameAsProd=production&&production.actor.id===actor.id&&production.target.id===target.id;
          if(!sameAsProd){
            const base=wearTitle(actor,target); const title=base?`${base}·穿制候选`:`${godFamily(actor.tenGod)}穿${godFamily(target.tenGod)}候选`;
            add({type:'zhi_yong',ruleId:'GONG-PIERCING-CANDIDATE-002',title,actorNodes:[actor.id],targetNodes:[target.id],resultNodes:[target.id],relationIds:[r.id],roleMap:{[actor.id]:'tool',[target.id]:'target'},rawReason:'来源方向校准命中，但尚无成势/主方代理等生产级上下文；只保留条件候选。',actionMode:'piercing_control_candidate',forceConditional:true,evidence_grade:'B',major_conclusion_allowed:false});
          }
        }
      }
    }
    // 丑戌、未戌是核心白名单刑；在没有“位置/力量/开库结果”完整证据时，两向都只生成候选，不假定谁必制谁。
    for (const r of relations.filter(x => x.type === 'punish')) {
      const a=byId[r.nodes[0]],b=byId[r.nodes[1]];if(!a||!b)continue;
      for(const [actor,target] of [[a,b],[b,a]]){
        const base=classifyZhiTitle(actor,target); if(!base&&!actor.tenGod&&!target.tenGod)continue;
        add({type:'zhi_yong',ruleId:'GONG-PUNISH-CANDIDATE-001',title:base?`${base}·刑制候选`:`${godFamily(actor.tenGod)}刑${godFamily(target.tenGod)}候选`,actorNodes:[actor.id],targetNodes:[target.id],resultNodes:[target.id],relationIds:[r.id],roleMap:{[actor.id]:'tool',[target.id]:'target'},rawReason:'核心书允许丑戌/未戌刑作为损坏、刑制或开库机制；方向与结果不足时只保留条件候选。',actionMode:'punish_control_candidate',forceConditional:true,evidence_grade:'A',major_conclusion_allowed:false});
      }
    }
    // 四绝方向存在于系统整理层，但核心书没有同等级统一强度表：机器生成候选，绝不直接完成 Settlement。
    for (const r of relations.filter(x => x.type === 'absolute')) {
      const a=byId[r.nodes[0]],b=byId[r.nodes[1]];if(!a||!b)continue;
      const preferred=String(r.school_direction_profile?.preferred||''); if(!preferred.includes('>'))continue;
      const [fromChar,toChar]=preferred.split('>');
      const actor=a.char===fromChar?a:b.char===fromChar?b:null;const target=a.char===toChar?a:b.char===toChar?b:null;if(!actor||!target)continue;
      add({type:'zhi_yong',ruleId:'GONG-ABSOLUTE-CANDIDATE-001',title:`${godFamily(actor.tenGod)}绝制${godFamily(target.tenGod)}候选`,actorNodes:[actor.id],targetNodes:[target.id],resultNodes:[target.id],relationIds:[r.id],roleMap:{[actor.id]:'tool',[target.id]:'target'},rawReason:'命中B级四绝方向候选；关系事实保留，未取得核心来源金标准前不升级正式制用。',actionMode:'absolute_control_candidate',forceConditional:true,evidence_grade:'B',major_conclusion_allowed:false});
    }

    // 1C. 气势制用：只在气势与目标之间存在真实冲/合制/克制接点时生成，不能凭“成势”空断。
    if (qishi?.dominant?.targetElement && (qishi.dominant.elements || []).length) {
      const q = qishi.dominant;
      const visible = facts.nodes.filter(n => n.position !== "hidden_stem");
      const memberIds = new Set(visible.filter(n => q.elements.includes(n.element)).map(n => n.id));
      const targets = visible.filter(n => n.element === q.targetElement && n.id !== facts.dayMasterNodeId);
      for (const target of targets) {
        const connector = relations.filter(r => {
          if (!(r.nodes || []).includes(target.id)) return false;
          if (!["clash", "control", "brittle_control", "dampen_fire", "stem_branch_combine", "branch_combine", "harm", "punish"].includes(r.type)) return false;
          if (!semanticUsable(r.id)) return false;
          const members = (r.nodes || []).filter(id => memberIds.has(id) && id !== target.id);
          if (!members.length) return false;
          // 有方向的普通克制必须真的是“党势成员 → 目标”，不能把目标反过来克成员也算成党势制用。
          if (["control","brittle_control","dampen_fire"].includes(r.type) && r.direction) return members.some(id => r.direction === `${id}>${target.id}`);
          return true;
        });
        if (!connector.length) continue;
        const actors = uniq(connector.flatMap(r => (r.nodes || []).filter(id => memberIds.has(id) && id !== target.id && (r.type !== "control" || !r.direction || r.direction === `${id}>${target.id}`))));
        if (!actors.length) continue;
        // 直接承担“制”的成员与仅提供党势/合刑支持的成员分开。做功方向以 leadActorNodes 为准。
        const leadActors = uniq(connector.flatMap(r => {
          if (["control","brittle_control","dampen_fire"].includes(r.type) && r.direction) return (r.nodes || []).filter(id => memberIds.has(id) && r.direction === `${id}>${target.id}`);
          if (r.type === "clash") return (r.nodes || []).filter(id => memberIds.has(id) && id !== target.id);
          return [];
        }));
        // v2.5 P0：合、穿、刑可作为党势/损伤辅助证据，但不能独立充当“制”的执行边。
        if (!leadActors.length) continue;
        // 正向做功要求主位/同党参与；反向做功则允许宾位之体直接制主位之用。
        if (!actors.some(id => gh(id) >= 0.65) && gh(target.id) < 0.65) continue;
        let objectLabel = target.tenGod || target.element;
        if (WEALTH_GODS.has(target.tenGod)) objectLabel = "财";
        else if (OFFICIAL_GODS.has(target.tenGod)) objectLabel = target.tenGod === "七杀" ? "杀" : "官";
        else if (RESOURCE_GODS.has(target.tenGod)) objectLabel = "印";
        const title = `${q.elements.join("、")}成势制${objectLabel}`;
        add({
          type: "zhi_yong", ruleId: "GONG-QISHI-ZHI-001", title,
          actorNodes: actors, leadActorNodes: leadActors.length ? leadActors : actors, targetNodes: [target.id], resultNodes: [target.id], relationIds: connector.map(r => r.id),
          roleMap: Object.fromEntries([...actors.map(id => [id, "tool"]), [target.id, "target"]]),
          rawReason: `${q.elements.join("、")}形成党势，并通过真实作用接点指向${target.char}${target.tenGod ? `·${target.tenGod}` : ""}`,
          actionMode: "qishi_control", qishiBased: true
        });
      }
    }

    // 1D. 书本党势制用（生产层）：正式做功优先消费 BookMethodEngine 已解析的成势结构，
    // 不再只依赖旧的元素数值 qishi。书中“火燥土势经巳申合去申”“金水势经巳申合去巳”等，
    // 合本身就是党势落地的制用接点；但只有目标类型在来源白名单内、且存在真实接点时才生成。
    const bookDominant:any = qishi?.book_party?.dominant;
    if (bookDominant?.formation === 'formed' && (bookDominant.memberNodeIds || []).length && (bookDominant.targetKinds || []).length) {
      const visible = facts.nodes.filter((n:any) => n.position !== 'hidden_stem');
      const memberIds = new Set<string>(bookDominant.memberNodeIds || []);
      const targetKinds = new Set<string>(bookDominant.targetKinds || []);
      const kindOf = (n:any) => {
        if (!n) return '';
        if (n.position === 'branch' && ['未','戌'].includes(n.char)) return '燥土';
        if (n.position === 'branch' && ['辰','丑'].includes(n.char)) return '湿土';
        return n.element || '';
      };
      const targets = visible.filter((n:any) => n.id !== facts.dayMasterNodeId && !memberIds.has(n.id) && targetKinds.has(kindOf(n)));
      const allowedConnectorTypes = new Set(['clash','control','brittle_control','dampen_fire','branch_combine','stem_branch_combine','harm','punish']);
      const executionBySource = new Set(['clash','control','brittle_control','dampen_fire','branch_combine','stem_branch_combine']);
      for (const target of targets) {
        const connectors = relations.filter((r:any) => {
          if (!allowedConnectorTypes.has(r.type) || !(r.nodes || []).includes(target.id) || !semanticUsable(r.id)) return false;
          const members=(r.nodes || []).filter((id:string)=>memberIds.has(id) && id!==target.id);
          if (!members.length) return false;
          if (['control','brittle_control','dampen_fire'].includes(r.type) && r.direction) return members.some((id:string)=>r.direction===`${id}>${target.id}`);
          return true;
        });
        if (!connectors.length) continue;
        const actors=uniq(connectors.flatMap((r:any)=>(r.nodes || []).filter((id:string)=>memberIds.has(id) && id!==target.id)));
        // 主要功神优先取“真正完成制/冲”的直接接点；合只在没有更直接制点时承担主执行。
        // 这对应书中“寅申冲的寅为主要功神，巳申合是后续制而得到”的层级，而不是把全党成员平铺为同级。
        const hardExecutionTypes=new Set(['clash','control','brittle_control','dampen_fire']);
        const hardConnectors=connectors.filter((r:any)=>hardExecutionTypes.has(r.type));
        const leadSource=hardConnectors.length?hardConnectors:connectors.filter((r:any)=>executionBySource.has(r.type));
        const leadActors=uniq(leadSource.flatMap((r:any)=>{
          if (!executionBySource.has(r.type)) return [];
          if (['control','brittle_control','dampen_fire'].includes(r.type) && r.direction) return (r.nodes || []).filter((id:string)=>memberIds.has(id)&&r.direction===`${id}>${target.id}`);
          return (r.nodes || []).filter((id:string)=>memberIds.has(id) && id!==target.id);
        }));
        if (!leadActors.length) continue;
        const relationIds=uniq(connectors.filter((r:any)=>executionBySource.has(r.type)).map((r:any)=>r.id));
        let objectLabel=target.tenGod || kindOf(target) || target.element;
        if (WEALTH_GODS.has(target.tenGod)) objectLabel='财';
        else if (OFFICIAL_GODS.has(target.tenGod)) objectLabel=target.tenGod==='七杀'?'杀':'官';
        else if (RESOURCE_GODS.has(target.tenGod)) objectLabel='印';
        else if (PEER_GODS.has(target.tenGod)) objectLabel='比劫';
        else if (OUTPUT_GODS.has(target.tenGod)) objectLabel='食伤';
        add({
          type:'zhi_yong', ruleId:'GONG-BOOK-PARTY-ZHI-001', title:`${bookDominant.label}成势制${objectLabel}`,
          actorNodes:actors, leadActorNodes:leadActors, targetNodes:[target.id], resultNodes:[target.id], relationIds,
          roleMap:Object.fromEntries([...actors.map((id:string)=>[id,'tool']),[target.id,'target']]),
          rawReason:`书本党势${bookDominant.label}已成立，目标${target.char}${target.tenGod?`·${target.tenGod}`:''}属于该党势来源允许的所制对象，并存在真实${connectors.map((r:any)=>r.type).join('/')}接点。`,
          actionMode:'book_party_control', qishiBased:true, bookPartyBased:true,
          source_party_id:bookDominant.id, source_gated_relation_ids:relationIds,
          sourceRule:'BLIND-PARTY-QISHI-001', evidence_grade:'A'
        });
      }
    }

    // 2. 合用：按核心书本入手法，只把“日干 / 日支实际参与的合”枚举为标准 he_yong。
    // 时柱虽然属于日时主位，但不能因为 hostWeight 较高就自动等同“日主合财/合官”；
    // 年月节点即使与日支成党，也不能借 host_proxy 权重生成通用“主位合财/合官”。
    // 这类关系仍保留在 RelationFact / 党势 / 复合结构里，由其它正式规则消费。
    for (const r of relations.filter(x => ["stem_combine", "branch_combine", "stem_branch_combine"].includes(x.type))) {
      const ns = r.nodes.map(id => byId[id]).filter(Boolean);
      for (const actor of ns) {
        const target = ns.find(n => n.id !== actor.id);
        if (!target) continue;
        const isDayMaster = actor.id === facts.dayMasterNodeId;
        const isDayBranch = actor.id === facts.dayBranchNodeId;
        if (!isDayMaster && !isDayBranch) continue;
        if (!(WEALTH_GODS.has(target.tenGod) || OFFICIAL_GODS.has(target.tenGod) || (isDayBranch && USE_GODS.has(target.tenGod)))) continue;

        const targetFamily = WEALTH_GODS.has(target.tenGod) ? 'wealth' : OFFICIAL_GODS.has(target.tenGod) ? 'official' : 'use';
        const title = isDayMaster
          ? (targetFamily === 'wealth' ? "日干合财" : targetFamily === 'official' ? "日干合官" : "日干合用")
          : (targetFamily === 'wealth' ? "日支合财" : targetFamily === 'official' ? "日支合官" : "日支合用");
        // 日干合财官是“做功意向 + 合关系”，是否取得要继续看承载、语义、目标是否受损；
        // 日支合先按收留/连接型合用处理，不能机械等同“日主已经取得”。
        const combineIntent = isDayMaster ? 'acquire_intent' : 'retain_or_acquire';
        const dayRoot:any = rootMap.get(facts.dayMasterNodeId);
        const targetRoot:any = target.position === 'stem' ? rootMap.get(target.id) : null;
        // 日干合财：核心资料要求有承载；高级讲义同时保留“身弱而财虚透也能取”的例外。
        // 日干合官不以日主承载作为同一硬门，但所合之官后续受损仍由 Settlement/Integrity 继续核查。
        // 日支合财官只有在从日支主位指向年月宾位之用时，才记“取得倾向”；日时内部合先按收留/连接。
        const wealthCapacityOk = targetFamily !== 'wealth' || dayRoot?.actor_capable === true || (target.position === 'stem' && targetRoot?.status === 'rootless');
        const targetSide = guestHost.nodeStates[target.id]?.bookSide || 'unclear';
        const acquisitionConfirmed = isDayMaster
          ? (targetFamily === 'official' || (targetFamily === 'wealth' && wealthCapacityOk))
          : (targetSide === 'guest' && (targetFamily === 'wealth' || targetFamily === 'official'));
        add({
          type: "he_yong", ruleId: "GONG-HE-001", title, actorNodes: [actor.id], targetNodes: [target.id], resultNodes: [target.id], relationIds: [r.id],
          roleMap: { [actor.id]: "body", [target.id]: "use" },
          rawReason: isDayMaster ? "日干直接参与真实合关系；按书本先记做功意向，再由承载/目标状态/归属裁决是否真正取得" : "日支直接参与真实合关系；按书本记合用/收留结构，不把六合自动翻译为现实取得",
          combineIntent, combineActor: isDayMaster ? 'day_master' : 'day_branch', combineTargetFamily: targetFamily,
          acquisitionConfirmed, wealthCapacityOk, targetRootStatus: targetRoot?.status || null
        });
      }
    }

    // 3. 生用：食伤 -> 财。
    for (const r of relations.filter(x => x.type === "generate")) {
      const actor = byId[r.nodes[0]], target = byId[r.nodes[1]];
      if (!actor || !target) continue;
      if (OUTPUT_GODS.has(actor.tenGod) && WEALTH_GODS.has(target.tenGod)) {
        add({ type: "sheng_yong", ruleId: "GONG-SHENG-001", title: "食伤生财", actorNodes: [actor.id], targetNodes: [target.id], resultNodes: [target.id], relationIds: [r.id], roleMap: { [actor.id]: "tool", [target.id]: "result" }, rawReason: "食伤与财之间存在真实相生方向" });
      }
      if ((actor.id === facts.dayMasterNodeId || gh(actor.id) >= 0.8) && OUTPUT_GODS.has(target.tenGod)) {
        add({ type: "xie_yong", ruleId: "GONG-XIE-001", title: "食伤泄秀", actorNodes: [actor.id], targetNodes: [target.id], resultNodes: [target.id], relationIds: [r.id], roleMap: { [actor.id]: "body", [target.id]: "result" }, rawReason: "主位向食伤形成真实输出" });
      }
    }

    // 4. 化用：官杀 -> 印 -> 日主/主位体。
    const gens = relations.filter(x => x.type === "generate");
    for (const r1 of gens) {
      const official = byId[r1.nodes[0]], resource = byId[r1.nodes[1]];
      if (!OFFICIAL_GODS.has(official?.tenGod) || !RESOURCE_GODS.has(resource?.tenGod)) continue;
      if (!(r1.adjacent || r1.distance === 0)) continue;
      const nextEdges = gens.filter(x => x.nodes[0] === resource.id && (x.adjacent || x.distance === 0)).sort((x, y) => (x.nodes[1] === facts.dayMasterNodeId ? -1 : 0) - (y.nodes[1] === facts.dayMasterNodeId ? -1 : 0));
      for (const r2 of nextEdges) {
        const result = byId[r2.nodes[1]];
        if (!result) continue;
        if (result.id !== facts.dayMasterNodeId && !PEER_GODS.has(result.tenGod)) continue;
        if (result.id !== facts.dayMasterNodeId && gh(result.id) < 0.65) continue;
        add({ type: "hua_yong", ruleId: "GONG-HUA-001", title: official.tenGod === "七杀" ? "杀印相生" : "官印相生", actorNodes: [official.id], bridgeNodes: [resource.id], targetNodes: [result.id], resultNodes: [result.id], relationIds: [r1.id, r2.id], roleMap: { [official.id]: "use", [resource.id]: "bridge", [result.id]: "result" }, rawReason: "官杀生印、印再入主位形成连续转化链" });
        break; // 同一官印链优先收束到日主/最近主位，不重复计功。
      }
    }

    // 5. 墓用：真实地支入墓可成为有效做功；“多而墓之”按同一墓库+同类十神聚合成一条结构，
    // 避免双丑/双酉被重复计算成两条独立主功。仅五行墓库对应仍保留条件候选。
    const factualTombs = relations.filter(x => ["tomb_enter","multi_tomb_enter"].includes(x.type));
    const groupedTombs = new Map<string, any[]>();
    for (const r of factualTombs) {
      const target = byId[r.nodes[0]], store = byId[r.nodes[1]];
      if (!target || !store || !target.tenGod || target.tenGod === "日元") continue;
      // “真实入墓”先是事实；只有财官印食伤等可用对象入墓才进入标准墓用主线。
      // 比劫/禄根/日主体入墓优先解释为承载受限、失能或人物状态，不把“被收”误写成“我取得”。
      if (PEER_GODS.has(target.tenGod)) continue;
      if (gh(store.id) < 0.65 && gh(target.id) < 0.65) continue;
      const key = `${store.id}|${godFamily(target.tenGod)}|${target.element}|${r.type === "multi_tomb_enter" ? "multi" : "direct"}`;
      if (!groupedTombs.has(key)) groupedTombs.set(key, []);
      groupedTombs.get(key)!.push(r);
    }
    for (const rows of groupedTombs.values()) {
      const first = rows[0], store = byId[first.nodes[1]];
      const targets = uniq(rows.map(r => r.nodes[0]));
      const target = byId[targets[0]];
      if (!target || !store) continue;
      const isMulti = rows.some(r => r.type === "multi_tomb_enter");
      const count = targets.length;
      const gods=uniq(targets.map(id=>byId[id]?.tenGod));
      const objectLabel=gods.length===1?gods[0]:godFamily(target.tenGod);
      const roleMap:any = { [store.id]: "collector" };
      for (const id of targets) roleMap[id] = "target";
      add({
        type: "mu_yong", ruleId: isMulti ? "GONG-MU-MULTI-001" : "GONG-MU-FACT-001",
        title: `墓用做功 · ${count > 1 ? `${count}处` : ""}${objectLabel || target.element}入${store.char}墓`,
        actorNodes: [store.id], targetNodes: targets, resultNodes: [store.id], relationIds: rows.map(r => r.id),
        roleMap,
        rawReason: isMulti ? `原局满足多而墓之，${count > 1 ? `${count}处同类目标` : "目标"}被同一墓库实际收取` : "原局满足稳定地支入墓条件，墓库实际收取目标",
        tombFact: true, multiTomb: isMulti, multiTombCount: count
      });
    }
    // 两级墓库链：若“对象→中间墓库”与“中间墓库→外层墓库”都已是事实入墓，
    // 则允许把中间墓库视为承载桥，最终成果归到外层墓库；不对候选墓关系做链式推断。
    for (const [groupKey, rows] of groupedTombs.entries()) {
      const first=rows[0], mid=byId[first.nodes[1]];
      if(!mid)continue;
      const outerRows=factualTombs.filter(r=>r.nodes[0]===mid.id);
      if(!outerRows.length)continue;
      const targets=uniq(rows.map(r=>r.nodes[0]));
      const target=byId[targets[0]];if(!target)continue;
      const gods=uniq(targets.map(id=>byId[id]?.tenGod));
      const objectLabel=gods.length===1?gods[0]:godFamily(target.tenGod);
      for(const outerRel of outerRows){
        const outer=byId[outerRel.nodes[1]];if(!outer||outer.id===mid.id)continue;
        if(gh(outer.id)<0.65&&gh(mid.id)<0.65&&!targets.some(id=>gh(id)>=0.65))continue;
        const roleMap:any={[outer.id]:'collector',[mid.id]:'bridge'};for(const id of targets)roleMap[id]='target';
        add({
          type:'mu_yong',ruleId:'GONG-MU-CHAIN-001',title:`墓用做功 · ${objectLabel}入${mid.char}墓再归${outer.char}墓`,
          actorNodes:[outer.id],bridgeNodes:[mid.id],targetNodes:targets,resultNodes:[outer.id],relationIds:uniq([...rows.map(r=>r.id),outerRel.id]),roleMap,
          rawReason:`原局先由${mid.char}墓收取${objectLabel}，且${mid.char}自身又事实入${outer.char}墓，形成两级墓库收取链`,
          tombFact:true,multiTomb:rows.some(r=>r.type==='multi_tomb_enter')||targets.length>1,tombChain:true,multiTombCount:targets.length
        });
      }
    }

    for (const r of relations.filter(x => x.type === "tomb_candidate")) {
      const target = byId[r.nodes[0]], store = byId[r.nodes[1]];
      if (!target || !store || !target.tenGod || target.tenGod === "日元") continue;
      if (PEER_GODS.has(target.tenGod)) continue;
      if (gongHost(store.id) || gongHost(target.id)) {
        add({
          type: "mu_yong", ruleId: "GONG-MU-CANDIDATE-001",
          title: `${target.tenGod || target.element}入${store.char}库候选`,
          actorNodes: [store.id], targetNodes: [target.id], resultNodes: [store.id], relationIds: [r.id],
          roleMap: { [store.id]: "collector", [target.id]: "target" },
          rawReason: "仅存在五行墓库对应，尚未证明真实入墓",
          forceConditional: true, tombFact: false, multiTomb: false
        });
      }
    }

    // 6. 复合路径：两条有效候选共用中间节点时合并，后续 Validator 决定是否成立。
    const simple = [...out];
    const compositeWhitelist = new Set(["sheng_yong>zhi_yong", "zhi_yong>sheng_yong", "zhi_yong>hua_yong"]);
    const allDirect = p => (p.relationIds || []).every(id => { const r = relations.find(x => x.id === id); return r && (r.adjacent || r.distance === 0 || ["sanhe", "sanhui", "stem_branch_combine"].includes(r.type)); });
    for (const a of simple) for (const b of simple) {
      if (a.id === b.id || !compositeWhitelist.has(`${a.type}>${b.type}`)) continue;
      if (!allDirect(a) || !allDirect(b)) continue;
      const aEnd = a.resultNodes?.[a.resultNodes.length - 1] || a.targetNodes?.[0];
      const bStart = b.actorNodes?.[0];
      if (!aEnd || !bStart || aEnd !== bStart) continue;
      add({ type: "composite", ruleId: "GONG-COMPOSITE-001", title: `${a.title} → ${b.title}`, actorNodes: uniq(a.actorNodes), bridgeNodes: uniq([...(a.bridgeNodes || []), aEnd, ...(b.bridgeNodes || [])]), targetNodes: uniq(b.targetNodes), resultNodes: uniq(b.resultNodes), relationIds: uniq([...(a.relationIds || []), ...(b.relationIds || [])]), componentPathIds: [a.id, b.id], roleMap: { ...(a.roleMap || {}), ...(b.roleMap || {}) }, rawReason: "两条已知做功类型在同一节点直接衔接，形成复合候选" });
    }
    return out;
  }

  validatePath(path, facts, relations, roots, guestHost, intents, qishi) {
    const byId = facts.byId;
    const actor = byId[path.actorNodes?.[0]], target = byId[path.targetNodes?.[0]];
    const relationRows = (path.relationIds || []).map(id => relations.find(r => r.id === id)).filter(Boolean);
    const direct = relationRows.some(r => r.adjacent || r.distance === 0 || ["clash", "brittle_control", "dampen_fire", "sanhe", "sanhui", "stem_branch_combine", "tonglu", "tomb_enter", "multi_tomb_enter"].includes(r.type));
    const actorRoot = roots.find(r => r.stemNodeId === actor?.id);
    const actorCapable = actor?.position === "branch" || actor?.position === "hidden_stem" || actorRoot?.actor_capable === true;
    const targetReachable = !!target && relationRows.length > 0;
    const pathContinuous = path.type !== "composite" || (path.bridgeNodes || []).length > 0;
    const resultExists = (path.resultNodes || []).length > 0;
    let status = "conditional";
    if (path.forceConditional) status = "conditional";
    else if (targetReachable && pathContinuous && resultExists && (direct || path.type === "hua_yong") && actorCapable) status = "effective";
    else if (targetReachable && resultExists) status = "conditional";
    else status = "intent_only";

    // 只有相邻地支的普通五行相克、却没有冲合刑穿墓或党势支持时，只能算“有作用候选”，
    // 不能直接升级成有效制用。这样避免把寅克未、土克水等普通邻支关系机械当成主功。
    const onlyPlainBranchControl = relationRows.length === 1 && relationRows[0]?.type === "control" && relationRows[0]?.medium === "branch";
    if (onlyPlainBranchControl && !path.qishiBased) status = "conditional";

    // 日主明确有追求但工具无根：只保留意向，不硬判做成。
    if (actor?.position === "stem" && actorRoot?.actor_capable !== true) status = "intent_only";

    return {
      ...path,
      status,
      validation: {
        relationReal: relationRows.length > 0,
        actorCapable,
        targetReachable,
        pathContinuous,
        resultExists,
        resultIntact: true,
        direct
      }
    };
  }

  resolveOwnership(path, facts, relations, guestHost, origins) {
    const side=(id:string)=>guestHost.nodeStates[id]?.gongSide||guestHost.nodeStates[id]?.bookSide||'unclear';
    const isHost=(id:string)=>['host','host_proxy_by_day_party'].includes(side(id));
    const isGuest=(id:string)=>side(id)==='guest';
    const resultIds=path.resultNodes?.length?path.resultNodes:path.targetNodes||[];
    const actorIds=path.actorNodes||[];
    const allResultHost=resultIds.length>0&&resultIds.every(isHost);
    const anyResultHost=resultIds.some(isHost);
    const anyActorGuest=actorIds.some(isGuest);
    const hasDirectHostTake=((path.type==='zhi_yong')||(path.type==='he_yong'&&path.acquisitionConfirmed===true))&&actorIds.some(isHost);
    let result='unclear';const reasons:string[]=[];
    if(allResultHost){result=(path.type==='hua_yong'||path.type==='he_yong')?'mostly_native':(anyActorGuest?'shared':'mostly_native');reasons.push('结果节点落日时主位/日支完整党势代理主方');}
    else if(hasDirectHostTake){result=anyActorGuest?'shared':'mostly_native';reasons.push(path.type==='he_yong'?'日干/日支合用已通过取得门，结果按主方取得处理':'主位直接控制目标');}
    else if(anyResultHost){result='shared';reasons.push('结果同时连接主位与宾位');}
    else if(resultIds.length&&resultIds.every(isGuest)){result='mostly_external';reasons.push('结果节点主要停留在年月宾位');}
    const originMap=Object.fromEntries((origins||[]).map(o=>[o.nodeId,o]));
    const originSides=uniq(resultIds.map(id=>originMap[id]?.sourceSide).filter(x=>x&&x!=='none'));
    if(result==='mostly_native'&&originSides.some(x=>x==='guest'||x==='mixed')){result='shared';reasons.push('结果落主位，但根源仍跨主客，按共享降级');}
    if(result==='mostly_external'&&originSides.some(x=>x==='host'||x==='mixed')){result='shared';reasons.push('结果表面落宾位，但来源连接主位，按主客共享处理');}
    return {result,resultNodes:resultIds,reasonChain:uniq(reasons),originSides,confidence:reasons.length?'medium':'low',mode:'book_hierarchical_ownership_v1'};
  }

  resolveGongDirection(path, guestHost) {
    const side=(id:string)=>guestHost.nodeStates[id]?.gongSide||guestHost.nodeStates[id]?.bookSide||guestHost.nodeStates[id]?.side||'unclear';
    const directionActors=(path.leadActorNodes?.length?path.leadActorNodes:path.actorNodes)||[];
    const actorSides=directionActors.map(side),targetSides=(path.targetNodes||[]).map(side);
    const actorHost=actorSides.some((x:string)=>x==='host'||x==='host_proxy_by_day_party');
    const actorGuest=actorSides.length>0&&actorSides.every((x:string)=>x==='guest');
    const targetHost=targetSides.some((x:string)=>x==='host'||x==='host_proxy_by_day_party');
    const targetGuest=targetSides.length>0&&targetSides.every((x:string)=>x==='guest');
    if(actorHost&&targetGuest)return 'forward';
    if(actorGuest&&targetHost)return 'reverse';
    if(actorHost&&targetHost)return 'internal';
    if(actorGuest&&targetGuest)return 'external';
    return 'mixed';
  }

  resolveGongLevel(path, qishi) {
    if (!path || path.status === "invalid" || path.status === "broken") return "L0";
    if (path.status === "intent_only") return "L1";
    if (path.status === "conditional") return "L2";
    if (path.status === "effective") {
      const ownershipClear = path.ownership?.result && path.ownership.result !== "unclear";
      const multi = (path.relationIds || []).length >= 2 || path.type === "composite";
      // Legacy field must obey the same invariant as Settlement: only THIS path's real party projection / qishi work may lift L5.
      // A dominant formation elsewhere in the chart is not evidence for this path.
      const qishiSupport = path.qishiBased === true || path.book_party_projection?.projectsOutside === true;
      if (multi && ownershipClear && qishiSupport) return "L5";
      if (multi && ownershipClear) return "L4";
      return "L3";
    }
    return "L1";
  }

  private realityStateForPair(stem:string, branch:string):'real'|'virtual'|'unknown' {
    const pair=`${stem||''}${branch||''}`;
    if(REALITY_REAL_PAIRS.has(pair))return 'real';
    if(REALITY_VIRTUAL_PAIRS.has(pair))return 'virtual';
    return 'unknown';
  }

  private resolveRealityState(facts:any):any {
    const rows:any[]=[];
    for(const pillar of PILLARS){
      const st=facts.byId[`original.${pillar}.stem`],br=facts.byId[`original.${pillar}.branch`];
      if(!st||!br||!st.char||!br.char)continue;
      rows.push({
        pillar,pair:`${st.char}${br.char}`,stemNodeId:st.id,branchNodeId:br.id,stem:st.char,branch:br.char,
        state:this.realityStateForPair(st.char,br.char),
        ten_god:st.tenGod||'',
        rule_id:'REALITY-60-JIAZI-001',evidence_grade:'A',
        note:'虚实只描述该柱干支内部的存在状态，不等同旺衰、RootState或做功能力。'
      });
    }
    return {mode:'pillar_internal_reality_state',original:rows,note:'采用冻结六十甲子表；不以其它柱藏干/同五行外援改写原局虚实。'};
  }

  private resolveRealityStageManifestations(facts:any,dy:any,ln:any,ly:any,activeComponent:string):any[] {
    const out:any[]=[];
    const original=this.resolveRealityState(facts).original||[];
    const stages:any[]=[];
    if(dy)stages.push({layer:'dayun',stem:dy.heavenly_stem,branch:dy.earthly_branch,pillar:dy.pillar,active_component:activeComponent});
    if(ln)stages.push({layer:'liunian',stem:ln.heavenly_stem||String(ln.ganzhi||'')[0],branch:ln.earthly_branch||String(ln.ganzhi||'')[1],pillar:ln.ganzhi});
    if(ly)stages.push({layer:'liuyue',stem:ly.heavenly_stem,branch:ly.earthly_branch,pillar:ly.pillar});
    const branchToOrigin=(branch:string)=>ORIGIN_STEMS_BY_BRANCH[branch]||[];
    for(const row of original){
      for(const st of stages){
        if(!st.stem&&!st.branch)continue;
        // 同一原局天干在岁运以完整干支柱出现：比较该岁运柱本身的虚实。
        if(st.stem===row.stem){
          const stageState=this.realityStateForPair(st.stem,st.branch);
          if(stageState!=='unknown')out.push({subject_node_id:row.stemNodeId,subject_char:row.stem,source_pillar:row.pillar,layer:st.layer,stage_pillar:st.pillar,manifestation:'same_stem_in_stage_pillar',natal_state:row.state,stage_state:stageState,transition:row.state===stageState?'state_repeated':`${row.state}_to_${stageState}`,major_conclusion_allowed:false,rule_id:'REALITY-STAGE-MANIFEST-001'});
        }
        // 虚干见固定禄支/原身支：只记“落地/变实事实”，不直接断吉凶。
        if(st.branch&&LU_BRANCH[row.stem]===st.branch){
          out.push({subject_node_id:row.stemNodeId,subject_char:row.stem,source_pillar:row.pillar,layer:st.layer,stage_pillar:st.pillar,manifestation:'lu_branch_arrival',natal_state:row.state,stage_state:'real',transition:row.state==='virtual'?'virtual_to_real':'real_reinforced',major_conclusion_allowed:false,rule_id:'REALITY-LU-ARRIVAL-001'});
        }
        // 原局地支实体在岁运透出其固定原身天干：记录“实体→虚透表达”。
        if(st.stem&&branchToOrigin(row.branch).includes(st.stem)){
          const stagePairState=this.realityStateForPair(st.stem,st.branch);
          out.push({subject_node_id:row.branchNodeId,subject_char:row.branch,source_pillar:row.pillar,layer:st.layer,stage_pillar:st.pillar,manifestation:'branch_origin_stem_manifested',natal_state:'real_entity',stage_state:stagePairState==='unknown'?'stem_manifestation':stagePairState,transition:stagePairState==='virtual'?'real_to_virtual_expression':'entity_to_stem_expression',major_conclusion_allowed:false,rule_id:'REALITY-BRANCH-STEM-MANIFEST-001'});
        }
      }
    }
    // 去重，避免同一主体同一层同一机制重复输出。
    const seen=new Set<string>();
    return out.filter(x=>{const k=`${x.subject_node_id}|${x.layer}|${x.manifestation}|${x.stage_pillar}`;if(seen.has(k))return false;seen.add(k);return true;});
  }

  private resolveSymbolGraph(facts:any,relations:any[],guestHost:any,qishi:any):any {
    const byId=facts.byId,edges:any[]=[];
    let seq=0;
    const push=(row:any)=>edges.push({id:`SX${String(++seq).padStart(3,'0')}`,major_eligible:false,...row});
    const dayIds=new Set([facts.dayMasterNodeId,'original.day.branch']);
    const relTouches=(r:any,id:string)=>Array.isArray(r.nodes)&&r.nodes.includes(id);

    // A. 天干五合的信息转移：五合成立即可记录，但只是象法事实，不自动等同控制完成。
    for(const r of relations.filter((x:any)=>x.type==='stem_combine')){
      push({type:'stem_combine_symbol_transfer',nodes:r.nodes,gate:'passed',source_relation_id:r.id,evidence_grade:'A',rule_id:'SYMBOL-STEM-COMBINE-001',semantics:['define_each_other','substitute_information','shared_information'],note:'天干五合的信息互换独立于“制过后换象”。'});
    }

    // B. 制过后换象：必须能确认一方实际压过/控制另一方。优先使用明确 control 方向或强势党势。
    for(const r of relations.filter((x:any)=>['clash','branch_combine'].includes(x.type))){
      const [a,b]=r.nodes.map((id:string)=>byId[id]); if(!a||!b)continue;
      let controller:any=null,target:any=null,basis='';
      const ctrl=relations.find((x:any)=>x.type==='control'&&x.nodes?.includes(a.id)&&x.nodes?.includes(b.id));
      if(ctrl?.direction){const [from,to]=String(ctrl.direction).split('>');controller=byId[from];target=byId[to];basis='explicit_control_direction';}
      if(!controller&&qishi?.dominant){
        const qe=new Set(qishi.dominant.elements||[]),qt=qishi.dominant.targetElement;
        if(qe.has(a.element)&&b.element===qt){controller=a;target=b;basis='dominant_qishi_control';}
        else if(qe.has(b.element)&&a.element===qt){controller=b;target=a;basis='dominant_qishi_control';}
      }
      if(controller&&target)push({type:'exchange_after_control',nodes:[controller.id,target.id],gate:'passed',source_relation_id:r.id,evidence_grade:'A',rule_id:'SYMBOL-EXCHANGE-CONTROL-001',direction:`${controller.id}>${target.id}`,basis,note:'只在冲制/合制方向已确认时允许信息换象；并不自动把所有含义无限互换。'});
      else push({type:'exchange_after_control_candidate',nodes:r.nodes,gate:'conditional',source_relation_id:r.id,evidence_grade:'B',rule_id:'SYMBOL-EXCHANGE-CONTROL-001',note:'存在冲/合关系，但尚未证明哪一方真正制过另一方，不放行换象。'});
    }

    // C. 带象：干生支形成候选；需接回主位，且不能被明显破坏，才获得解释资格。
    for(const pillar of PILLARS){
      const st=byId[`original.${pillar}.stem`],br=byId[`original.${pillar}.branch`]; if(!st||!br||!elementGenerates(st.element,br.element))continue;
      const pair=`${st.char}${br.char}`;
      const disputed=DAI_XIANG_DISPUTED_PAIRS.has(pair);
      let connected=pillar==='day'; const linkIds:string[]=[];
      if(!connected){
        // 主位连接允许沿“相生 / 合 / 三合半合暗合 / 禄原身 / 墓”等正向关联链传递，
        // 但不把冲、刑、穿、破当成建立缘分的连接。最多 4 跳，防止全图泛滥。
        const allowed=relations.filter((r:any)=>SYMBOL_HOST_LINK_TYPES.has(r.type)&&(r.adjacent||r.distance===0||['sanhe','sanhui','dark_combine','half_harmony','arch_harmony','tomb_enter','multi_tomb_enter'].includes(r.type)));
        const queue:any[]=[{id:st.id,path:[]},{id:br.id,path:[]}],seen=new Set<string>([st.id,br.id]);
        while(queue.length&&!connected){
          const cur=queue.shift(); if(cur.path.length>=4)continue;
          for(const r of allowed){
            if(!(r.nodes||[]).includes(cur.id))continue;
            for(const nid of (r.nodes||[])){
              if(nid===cur.id)continue;
              const path=[...cur.path,r.id];
              if(dayIds.has(nid)){connected=true;linkIds.push(...path);break;}
              if(!seen.has(nid)){seen.add(nid);queue.push({id:nid,path});}
            }
            if(connected)break;
          }
        }
      }
      const damage=relations.filter((r:any)=>SYMBOL_DAMAGE_TYPES.has(r.type)&&(relTouches(r,st.id)||relTouches(r,br.id)));
      const broken=damage.length>0 && !connected;
      push({type:connected?'dai_xiang_connected':'dai_xiang_candidate',nodes:[st.id,br.id],pair,gate:disputed?'conditional':connected&&!broken?'passed':'conditional',connected_to_host:connected,host_relation_ids:uniq(linkIds),broken,damage_relation_ids:damage.map((r:any)=>r.id),source_disputed:disputed,evidence_grade:disputed?'B':'A',rule_id:'SYMBOL-DAI-XIANG-001',interpretation_eligible:connected&&!broken&&!disputed,note:disputed?'该柱在来源中存在明确疑义，只保留候选。':connected?'干生支复合象已通过主位连接门；仍只进入象法解释层。':'干生支只形成带象候选；未连接主位，不进入现实解释。'});
    }

    // D. 借象：固定禄/原身是 A 级事实；同五行阴阳不同保留来源允许、生产候选两层。
    for(const r of relations.filter((x:any)=>x.type==='tonglu'))push({type:'borrow_lu_origin',nodes:r.nodes,gate:'passed',source_relation_id:r.id,evidence_grade:'A',rule_id:'SYMBOL-BORROW-LU-001',production_scope:'fact_edge',note:'固定禄/原身关系可互借已确定之象；借象本身不创造新人物/事件。'});
    const branches=(facts.branches||[]).map((id:string)=>byId[id]).filter(Boolean);
    for(let i=0;i<branches.length;i++)for(let j=i+1;j<branches.length;j++){
      const a=branches[i],b=branches[j]; if(a.element!==b.element||a.char===b.char)continue;
      push({type:'borrow_same_element_candidate',nodes:[a.id,b.id],gate:'conditional',evidence_grade:'B',rule_id:'SYMBOL-BORROW-SAME-ELEMENT-001',source_allows:true,production_scope:'candidate_only',note:'来源允许同五行阴阳不同互借，但程序无法仅凭同五行证明哪一端已先定象，因此不自动放行。'});
    }
    return {mode:'symbol_graph_v1',edges,note:'象法事实与做功事实分层；所有 SymbolEdge 默认 major_eligible=false，不参与第一主功排序。'};
  }

  private resolveChartZhengFan(facts:any,relations:any[],intents:any[],qishi:any,guestHost:any):any {
    const byId=facts.byId,evidence:string[]=[],counterEvidence:string[]=[],hits:any[]=[];
    const dayStem=byId[facts.dayMasterNodeId],dayBranch=byId['original.day.branch'];
    const yearBranch=byId['original.year.branch'],monthBranch=byId['original.month.branch'],hourBranch=byId['original.hour.branch'];
    const rel=(a:string,b:string,types?:string[])=>relations.filter((r:any)=>(r.nodes||[]).includes(a)&&(r.nodes||[]).includes(b)&&(!types||types.includes(r.type)));
    const hit=(id:string,side:'fan'|'zheng',detail:string,weight:number)=>{hits.push({id,side,detail,weight});(side==='fan'?evidence:counterEvidence).push(detail);};
    const q=qishi?.dominant;

    // 1. 日主合时柱财官：来源要求继续追到所合天干坐支；该坐支若被局中别支制坏/与日支方向冲突，判反局候选。
    const hourStem=byId['original.hour.stem'];
    const dayHourCombine=hourStem?rel(dayStem.id,hourStem.id,['stem_combine']):[];
    if(dayHourCombine.length&&(OFFICIAL_GODS.has(hourStem.tenGod)||WEALTH_GODS.has(hourStem.tenGod)||USE_GODS.has(hourStem.tenGod))){
      const directDamage=rel(dayBranch.id,hourBranch.id,['clash','harm','break','punish']);
      const incomingControl=relations.filter((r:any)=>r.type==='control'&&String(r.direction||'').endsWith(`>${hourBranch.id}`)&&!String(r.direction||'').startsWith('original.day.'));
      if(directDamage.length||incomingControl.length)hit('ZF-DAY-HOUR-SEAT-CONFLICT','fan',`日主合时柱${hourStem.char}后需承接其坐支${hourBranch.char}，但该坐支又被局中作用制坏/冲突`,5);
      else hit('ZF-DAY-HOUR-SEAT-COHERENT','zheng',`日主合时柱${hourStem.char}，其坐支未见明确反向破坏`,2);
    }

    // 2. 日主合年月官：来源明确存在“管理/控制外部”例外，不机械追坐支判反。
    for(const pillar of ['year','month']){
      const st=byId[`original.${pillar}.stem`]; if(!st)continue;
      if(rel(dayStem.id,st.id,['stem_combine']).length&&OFFICIAL_GODS.has(st.tenGod))hit('ZF-OUTER-OFFICIAL-MANAGE','zheng',`日主合${pillar==='year'?'年':'月'}柱官星，按外部管理/控制意向处理，不因坐支另有作用就自动反局`,3);
    }

    // 3. 日支的动作若保护/追求全局气势明确要制的目标，属于方向冲突。
    if(q&&dayBranch){
      const targetBranches=(facts.branches||[]).map((id:string)=>byId[id]).filter((n:any)=>n&&n.id!==dayBranch.id&&n.element===q.targetElement);
      for(const t of targetBranches){
        const protect=rel(dayBranch.id,t.id,['branch_combine','dark_combine']);
        const dayControlsTarget=relations.some((r:any)=>r.type==='control'&&String(r.direction||'')===`${dayBranch.id}>${t.id}`);
        if(protect.length&&!dayControlsTarget)hit('ZF-DAY-BRANCH-PROTECTS-TARGET','fan',`全局${(q.elements||[]).join('、')}之势指向${q.targetElement}，但日支${dayBranch.char}反与目标${t.char}形成合类连接且未见日支制过目标`,5);
      }
      // 日支本身就是全局欲制元素，却反向控制气势成员，也视为强冲突。
      if(dayBranch.element===q.targetElement){
        const attacks=relations.filter((r:any)=>['control','clash'].includes(r.type)&&(r.nodes||[]).includes(dayBranch.id)&&String(r.direction||`${dayBranch.id}>`).startsWith(`${dayBranch.id}>`));
        if(attacks.some((r:any)=>{const other=(r.nodes||[]).find((id:string)=>id!==dayBranch.id);return (q.elements||[]).includes(byId[other]?.element);})){hit('ZF-DAY-BRANCH-COUNTER-QISHI','fan',`日支${dayBranch.char}属于全局欲制元素，却反向作用于成势一方`,5);}
      }
      // 日支若以气势成员身份直接控制全局目标，记同向。
      const aligned=relations.some((r:any)=>r.type==='control'&&String(r.direction||'').startsWith(`${dayBranch.id}>`)&&byId[String(r.direction||'').split('>')[1]]?.element===q.targetElement&&(q.elements||[]).includes(dayBranch.element));
      if(aligned)hit('ZF-DAY-BRANCH-ALIGNS-QISHI','zheng',`日支${dayBranch.char}直接参与${(q.elements||[]).join('、')}之势并作用于目标${q.targetElement}`,4);
    }

    // 4. 日支与同一对手重复冲突、数量明显处劣势，视为“想制却反被制”的结构候选。
    if(dayBranch){
      const clashes=relations.filter((r:any)=>r.type==='clash'&&(r.nodes||[]).includes(dayBranch.id));
      const opp=clashes.map((r:any)=>(r.nodes||[]).find((id:string)=>id!==dayBranch.id)).map((id:string)=>byId[id]).filter(Boolean);
      const counts:Record<string,number>={}; for(const n of opp)counts[n.char]=(counts[n.char]||0)+1;
      const repeated=Object.entries(counts).find(([,c])=>c>=2);
      if(repeated)hit('ZF-DAY-BRANCH-OUTNUMBERED','fan',`日支${dayBranch.char}同时对抗${repeated[1]}处${repeated[0]}，原意难以完成，形成反制候选`,4);
    }

    // 5. 同柱“干生支”若一端属于当前成势、而该支又被主位明确制，说明同柱内部表达与主位动作相反。
    if(q){
      for(const pillar of ['year','month','hour']){
        const st=byId[`original.${pillar}.stem`],br=byId[`original.${pillar}.branch`]; if(!st||!br||!elementGenerates(st.element,br.element))continue;
        if(!(q.elements||[]).includes(st.element)||!(q.elements||[]).includes(br.element))continue;
        const hostControls=relations.some((r:any)=>r.type==='control'&&String(r.direction||'').endsWith(`>${br.id}`)&&String(r.direction||'').startsWith('original.day.'));
        if(hostControls)hit('ZF-PILLAR-INTERNAL-COUNTER','fan',`${st.char}${br.char}同柱相生把${br.char}扶起，但主位又明确制${br.char}，同一结构出现相反方向`,4);
      }
    }

    // 6. 年月党与日时党“合/冲方式相反”只作为候选；若日时动作明确顺着全局制向，则取消机械反局。
    const outerMode=rel(yearBranch.id,monthBranch.id,['branch_combine','dark_combine','clash']).map((r:any)=>r.type);
    const innerMode=rel(dayBranch.id,hourBranch.id,['branch_combine','dark_combine','clash']).map((r:any)=>r.type);
    if(outerMode.length&&innerMode.length){
      const outerIsJoin=outerMode.some((t:string)=>['branch_combine','dark_combine'].includes(t)),outerIsClash=outerMode.includes('clash');
      const innerIsJoin=innerMode.some((t:string)=>['branch_combine','dark_combine'].includes(t)),innerIsClash=innerMode.includes('clash');
      if((outerIsJoin&&innerIsClash)||(outerIsClash&&innerIsJoin)){
        const innerAligned=q&&relations.some((r:any)=>r.type==='control'&&String(r.direction||'').startsWith(`${dayBranch.id}>`)&&byId[String(r.direction||'').split('>')[1]]?.element===q.targetElement&&(q.elements||[]).includes(dayBranch.element));
        if(innerAligned)hit('ZF-PARTY-MODE-EXCEPTION','zheng','年月与日时表面一合一冲，但主位一党的实际控制方向与全局目标一致，不机械判反局',5);
        else hit('ZF-PARTY-MODE-CONFLICT','fan','年月党与日时党分别以合与冲表达相反做功方式，且未见统一控制方向',4);
      }
    }

    const fanScore=hits.filter(x=>x.side==='fan').reduce((a,x)=>a+x.weight,0),zhengScore=hits.filter(x=>x.side==='zheng').reduce((a,x)=>a+x.weight,0);
    let status:'zheng'|'fan'|'mixed'|'unclear'='unclear',confidence:'high'|'medium'|'low'='low';
    if(fanScore>=4&&fanScore>=zhengScore+2){status='fan';confidence=fanScore>=8?'high':'medium';}
    else if(zhengScore>=3&&zhengScore>=fanScore+2){status='zheng';confidence=zhengScore>=7?'high':'medium';}
    else if(fanScore&&zhengScore){status='mixed';confidence='medium';}
    return {status,confidence,fan_score:fanScore,zheng_score:zhengScore,rule_hits:hits,evidence,counter_evidence:counterEvidence,mode:'chart_level_direction_graph_v1',major_conclusion_allowed:false,note:'正反局比较日主/日支/全局势与两党动作方向；表面一冲一合不自动判反。当前只输出结构仲裁，不直接生成灾福事件。'};
  }

  resolvePathZhengFan(path, facts, intents, qishi, guestHost) {
    const day = intents.find(x => x.nodeId === facts.dayMasterNodeId);
    const targetGods = (path.targetNodes || []).map(id => facts.byId[id]?.tenGod).filter(Boolean);
    let intentMatch = false;
    if (day?.intents?.some(i => i.type === "seek_wealth") && targetGods.some(g => WEALTH_GODS.has(g))) intentMatch = true;
    if (day?.intents?.some(i => i.type === "seek_authority") && targetGods.some(g => OFFICIAL_GODS.has(g))) intentMatch = true;
    if (day?.intents?.some(i => i.type === "output") && (path.type === "sheng_yong" || path.type === "xie_yong")) intentMatch = true;
    const actorEl = facts.byId[path.actorNodes?.[0]]?.element;
    const q = qishi.dominant;
    if (q && actorEl && q.targetElement === actorEl && q.confidence === "high" && !intentMatch) return "fan";
    if (intentMatch) return "zheng";
    if (q && actorEl && q.elements.includes(actorEl)) return "zheng";
    return "unclear";
  }

  rankPaths(paths, facts, relations, roots, qishi) {
    const statusWeight = { effective: 50, conditional: 32, intent_only: 12, broken: 4, invalid: 0 };
    const typeWeight = { composite: 16, zhi_yong: 15, he_yong: 14, hua_yong: 13, mu_yong: 11, sheng_yong: 10, xie_yong: 6 };
    const ownWeight = { mostly_native: 12, shared: 7, mostly_external: 1, unclear: 0 };
    const levelWeight = { L0: 0, L1: 2, L2: 5, L3: 9, L4: 13, L5: 17 };
    const ranked = paths.map(p => {
      let score = (statusWeight[p.status] || 0) + (typeWeight[p.type] || 0) + (ownWeight[p.ownership?.result] || 0) + (levelWeight[p.gong_level] || 0);
      if (p.validation?.direct) score += 7;
      else score -= 7;
      if (p.zhengFan === "zheng") score += 6;
      if (p.zhengFan === "fan") score -= 10;
      const actorEl = facts.byId[p.actorNodes?.[0]]?.element;
      if (qishi.dominant?.elements?.includes(actorEl)) score += 5;
      if ((p.relationIds || []).length >= 2) score += 3;
      if (p.tombFact) score += 4;
      // “多而墓之”只提高入墓事实确定性，不等于功更大、结果更吉，因此不再额外加排名分。
      // 两级墓库链的优势由真实关系链长度与最终成果归属自然体现。
      if (p.forceConditional) score -= 4;
      return { ...p, rank_score: score };
    }).sort((a, b) => b.rank_score - a.rank_score || a.id.localeCompare(b.id));
    return ranked;
  }

  resolveMainline(ranked, facts, intents, qishi) {
    // 第一主线只允许 effective。仅有 conditional 时宁可降级到象法，也不把“可能成立”包装成主线。
    const effective = ranked.filter(p => p.status === "effective");
    if (!effective.length) return { primary: null, secondary: null, co_primary: false, reason: "未发现足够闭合的高置信做功路径；条件候选保留在 gong_paths，不强升第一主线" };
    const primary = effective[0];
    const key = p => `${p.title}|${p.type}|${p.ownership?.result || ""}`;
    const primaryKey = key(primary);
    const second = ranked.find(p => p.id !== primary.id && ["effective", "conditional"].includes(p.status) && key(p) !== primaryKey) || null;
    const coPrimary = !!second && second.status === "effective" && Math.abs(primary.rank_score - second.rank_score) <= 2 && primary.type !== second.type;
    return { primary, secondary: second, co_primary: coPrimary, reason: "第一主线仅从有效闭环中选取；按路径闭合、主位参与、成果归属、气势与反证稳定排序" };
  }

  resolveXiangFallback(facts, relations, intents, qishi, mainline) {
    if (mainline.primary) return { primary: null, candidates: [], note: "已有明确做功主线，象法只作为后续细化。" };
    const day = facts.byId[facts.dayMasterNodeId];
    const dayIntent = intents.find(x => x.nodeId === day.id)?.intents?.[0];
    const title = dayIntent?.type === "output" ? "象法辅助 · 日主向外输出" : qishi.dominant ? `象法辅助 · ${qishi.dominant.elements.join("、")}成势` : "命局意向尚未形成闭环";
    const primary = {
      id: "XG001", type: "xiang_fallback", title, status: "intent_only", actorNodes: [day.id], targetNodes: [], bridgeNodes: [], resultNodes: [], relationIds: dayIntent?.viaRelationIds || [],
      roleMap: { [day.id]: "body" }, ownership: { result: "unclear", resultNodes: [], reasonChain: [], confidence: "low" }, zhengFan: "unclear", rank_score: 0,
      validation: { relationReal: false, actorCapable: true, targetReachable: false, pathContinuous: false, resultExists: false, resultIntact: true, direct: false }
    };
    return { primary, candidates: [primary], note: "做功并非唯一分析入口；此处只提供保守象法兜底，不直接扩展重大现实事件。" };
  }

  private resolveLuckIdentities(luck:any, facts:any, relevantIds:Set<string>):any {
    const claims:any[]=[];
    const add=(type:string,target:any,component:'stem'|'branch',incoming:string,extra:any={})=>{
      if(!target||!incoming)return;
      const key=`${type}|${target.id}|${component}|${incoming}`;
      if(claims.some(x=>x._key===key))return;
      claims.push({
        _key:key,id:`LI${String(claims.length+1).padStart(3,'0')}`,layer:luck.layer,incoming_component:component,incoming_char:incoming,
        targetNodeId:target.id,targetChar:target.char,targetPosition:target.position,targetPillar:target.pillar,
        type,evidence_grade:extra.evidence_grade||'A',source_status:extra.source_status||'school_specific',priority:extra.priority??100,
        major_eligible:extra.major_eligible!==false,detail:extra.detail||'',source_rule:extra.source_rule||'BLIND-IDENTITY-CORE',selected:false,selection_reason:''
      });
    };
    const nodes=(facts.nodes||[]).filter((n:any)=>n.layer==='original'&&n.char);
    if(luck.stem){
      for(const n of nodes){
        if(n.position==='branch'&&(ORIGIN_STEMS_BY_BRANCH[n.char]||[]).includes(luck.stem)){
          add('yuanshen_appearance',n,'stem',luck.stem,{priority:120,detail:`${luck.stem}为原局${n.char}的固定原身，岁运天干取得该支身份`,source_rule:'BLIND-YUANSHEN-001'});
        }
        if(n.position==='stem'&&n.char===luck.stem){
          add('same_stem_appearance',n,'stem',luck.stem,{priority:120,detail:`岁运${luck.stem}与原局明透${n.char}同字到位`,source_rule:'BLIND-APPEAR-001'});
        }
        if(n.position==='hidden_stem'&&n.char===luck.stem){
          add('hidden_stem_manifestation',n,'stem',luck.stem,{priority:115,detail:`原局${n.pillar}支所藏${n.char}在岁运天干透出`,source_rule:'BLIND-HIDDEN-APPEAR-001'});
        }
      }
      // 仅实现课堂笔记明确给出的“乙到：卯→未→辰→乙”B级代表序列；不泛化十干。
      if(luck.stem==='乙'){
        for(const n of nodes){
          if(n.position!=='branch'||!['未','辰'].includes(n.char))continue;
          add(n.char==='未'?'tomb_qi_representative':'residual_qi_representative',n,'stem',luck.stem,{priority:n.char==='未'?80:70,evidence_grade:'B',source_status:'class_note',major_eligible:false,detail:`课堂整理规则：乙到可代表${n.char}${n.char==='未'?'墓气':'余气'}，仅作B级身份候选`,source_rule:'BLIND-IDENTITY-YI-ORDER-B'});
        }
      }
    }
    if(luck.branch){
      for(const n of nodes){
        if((n.position==='stem'||n.position==='hidden_stem')&&LU_BRANCH[n.char]===luck.branch){
          add('tonglu_appearance',n,'branch',luck.branch,{priority:120,detail:`岁运${luck.branch}为原局${n.char}固定禄，原局天干以禄形态到位`,source_rule:'BLIND-TONGLU-001'});
        }
        if(n.position==='branch'&&n.char===luck.branch){
          add('same_branch_appearance',n,'branch',luck.branch,{priority:120,detail:`岁运${luck.branch}与原局${n.char}同支到位`,source_rule:'BLIND-APPEAR-001'});
        }
        if(n.position==='stem'&&(BRANCH_HIDDEN_STEMS[luck.branch]||[]).includes(n.char)&&LU_BRANCH[n.char]!==luck.branch){
          add('hidden_form_appearance',n,'branch',luck.branch,{priority:100,detail:`原局${n.char}在岁运${luck.branch}中以藏干形式出现`,source_rule:'BLIND-HIDDEN-FORM-001'});
        }
        if((n.position==='stem'||n.position==='hidden_stem')&&(HALF_LU_BRANCH[n.char]||[]).includes(luck.branch)){
          add('half_lu_candidate',n,'branch',luck.branch,{priority:60,evidence_grade:'B',source_status:'school_specific',major_eligible:false,detail:`${n.char}见${luck.branch}为半禄候选，只作辅助身份，不单独升重大应期`,source_rule:'BLIND-HALF-LU-B'});
        }
      }
    }

    // 身份解析必须先于主线相关性：先按来源等级与直接性选身份，再把结果交给主线仲裁。
    // 禁止“主线想看谁，就从多个身份候选里挑谁”的自证偏差。
    for(const component of ['stem','branch']){
      const pool=claims.filter(x=>x.incoming_component===component);if(!pool.length)continue;
      const high=pool.filter(x=>x.evidence_grade==='A');
      const base=high.length?high:pool,top=Math.max(...base.map(x=>x.priority));
      const selected=base.filter(x=>x.priority===top);
      for(const c of selected){
        c.selected=true;
        c.selection_reason=high.length?'独立身份解析：不参考当前主线，先取A级直接身份中的最高优先级':'独立身份解析：无A级直接身份，仅保留最高优先级降级候选';
      }
    }
    if(luck.layer==='liuyue')for(const c of claims)c.major_eligible=false;
    for(const c of claims)c.mainline_relevant=relevantIds.has(c.targetNodeId);
    let schoolPriorityHint:any=null;
    if(luck.stem==='乙'){
      const yiClaims=claims.filter(x=>x.incoming_component==='stem'&&YI_REPRESENTATION_PRIORITY[x.targetChar]!=null)
        .sort((a,b)=>(YI_REPRESENTATION_PRIORITY[a.targetChar]??99)-(YI_REPRESENTATION_PRIORITY[b.targetChar]??99));
      if(yiClaims.length)schoolPriorityHint={evidence_grade:'B',source_status:'class_note',source_rule:'BLIND-IDENTITY-YI-ORDER-B',ordered_target_chars:uniq(yiClaims.map(x=>x.targetChar)),note:'课堂整理仅提示乙到时卯→未→辰→乙的代表顺序；生产默认不允许该B级顺序覆盖A级直接身份。'};
    }
    return {
      layer:luck.layer,incoming:{stem:luck.stem||null,branch:luck.branch||null},
      claims:claims.map(({_key,...x})=>x),selected:claims.filter(x=>x.selected).map(({_key,...x})=>x),school_priority_hint:schoolPriorityHint,
      resolution_order:'identity_first_then_mainline',
      note:luck.layer==='liuyue'?'流月身份只用于具体月份定位；即使A类身份成立，也不得单独升级重大事件。':'身份先独立解析，再判断是否命中主线。A=核心资料稳定身份；B=半禄/课堂代表顺序，默认不得覆盖A级身份或单独制造重大事件。'
    };
  }

  private resolveTombStates(facts:any,luckChars:any[],relevantIds:Set<string>):any[] {
    const out:any[]=[];const seen=new Set<string>();
    const push=(row:any)=>{const key=`${row.layer}|${row.inmateNodeId||row.inmate_id||''}|${row.storeNodeId||row.store_id||''}|${row.incoming_branch||''}|${row.action||row.status||''}`;if(seen.has(key))return;seen.add(key);out.push({id:`TS${String(out.length+1).padStart(3,'0')}`,...row});};
    const prefixes:any[][]=[[]];
    for(let i=0;i<(luckChars||[]).length;i++)prefixes.push(luckChars.slice(0,i+1));
    for(let i=0;i<prefixes.length;i++){
      const snap=this.resolveTombStateSnapshot(facts,prefixes[i],relevantIds);
      const stage=i===0?'original':luckChars[i-1]?.layer||'original';
      for(const st of snap.states||[]){
        const newest=stage==='original'?(st.inmate_layer==='original'&&st.store_layer==='original'):(st.inmate_layer===stage||st.store_layer===stage);
        if(!newest)continue;
        push({layer:stage,inmateNodeId:st.inmate_id,inmateChar:st.inmate_char,storeNodeId:st.store_id,storeChar:st.store_char,contained:st.contained,status:st.status,action:st.mode==='multi_tomb'?'multi_tomb_enter':'tomb_enter',evidence_grade:st.evidence_grade,relevant:st.relevant,detail:st.detail,source_rule:st.source_rule});
      }
      for(const a of snap.store_actions||[]){
        if(stage!=='original'&&a.layer===stage)push({layer:a.layer,incoming_branch:a.incoming_branch,storeNodeId:a.store_id,storeChar:a.store_char,contained:null,status:a.status,action:a.action,evidence_grade:a.evidence_grade,relevant:a.relevant,detail:a.detail,source_rule:a.source_rule});
      }
    }
    return out;
  }

  private resolveTombStateSnapshot(facts:any,luckChars:any[],relevantIds:Set<string>):any {
    const originalBranches=(facts.branches||[]).map((id:string)=>facts.byId[id]).filter(Boolean).map((n:any)=>({id:n.id,char:n.char,element:n.element||BRANCH_ELEMENT[n.char],layer:'original',pillar:n.pillar,relevant:relevantIds.has(n.id)}));
    const originalStems=(facts.visible_stems||[]).map((id:string)=>facts.byId[id]).filter(Boolean).map((n:any)=>({id:n.id,char:n.char,element:n.element||STEM_ELEMENT[n.char],layer:'original',pillar:n.pillar,relevant:relevantIds.has(n.id)}));
    const activeBranches=[...originalBranches];
    const activeStems=[...originalStems];
    for(const luck of luckChars||[]){
      if(luck?.branch)activeBranches.push({id:`luck.${luck.layer}.branch`,char:luck.branch,element:BRANCH_ELEMENT[luck.branch],layer:luck.layer,pillar:null,relevant:false});
      if(luck?.stem)activeStems.push({id:`luck.${luck.layer}.stem`,char:luck.stem,element:STEM_ELEMENT[luck.stem],layer:luck.layer,pillar:null,relevant:false});
    }
    const chars=activeBranches.map((x:any)=>x.char),has=(c:string)=>chars.includes(c);
    const middleBranches=new Set(['子','午','卯','酉']);
    const states:any[]=[];const seen=new Set<string>();
    const sameLayerStemSupports=(inmate:any,element:string)=>{
      if(inmate.layer==='original')return activeStems.some((s:any)=>s.layer==='original'&&s.pillar===inmate.pillar&&s.element===element);
      return activeStems.some((s:any)=>s.layer===inmate.layer&&s.element===element);
    };
    for(const inmate of activeBranches){
      let store=DIRECT_TOMB_STORE[inmate.char]||'';
      let mode='direct_tomb';
      if(store){
        const sameElementNonStore=activeBranches.filter((x:any)=>x.element===inmate.element&&x.char!==store);
        if(sameElementNonStore.length>=2)mode='multi_tomb';
      }
      if(!store&&middleBranches.has(inmate.char)){
        const element=inmate.element||BRANCH_ELEMENT[inmate.char],candidateStore=STORE_BRANCH[element];
        if(!candidateStore)continue;
        const sameElementBranches=activeBranches.filter((x:any)=>x.element===element&&x.char!==candidateStore);
        const multi=sameElementBranches.length>=2||sameLayerStemSupports(inmate,element);
        if(!multi)continue;
        store=candidateStore;mode='multi_tomb';
      }
      if(!store)continue;
      for(const storeNode of activeBranches.filter((x:any)=>x.char===store&&x.id!==inmate.id)){
        const key=`${inmate.id}|${storeNode.id}`;if(seen.has(key))continue;seen.add(key);
        const earthConflict=store==='辰'&&['丑','未'].includes(inmate.char)&&has('丑')&&has('未')&&has('辰');
        const contained=!earthConflict;
        const modeLabel=mode==='multi_tomb'?'满足多而墓之':'满足稳定地支入墓';
        states.push({
          id:`TSS${String(states.length+1).padStart(3,'0')}`,inmate_id:inmate.id,inmate_char:inmate.char,inmate_layer:inmate.layer,store_id:storeNode.id,store_char:storeNode.char,store_layer:storeNode.layer,
          contained,status:earthConflict?'blocked_by_chou_wei_clash':'contained',active:true,evidence_grade:'A',mode,
          relevant:!!inmate.relevant||!!storeNode.relevant,
          detail:earthConflict?'当前时间层丑、未、辰同见，按生产口径取消丑/未直接入辰墓状态':`当前时间层${inmate.char}与${storeNode.char}${mode==='multi_tomb'?'满足“多而墓之”':'构成稳定墓库对应'}，记为有效入墓状态`,
          source_rule:mode==='multi_tomb'?'BLIND-TOMB-MULTI-001':'BLIND-TOMB-SNAPSHOT-001'
        });
      }
    }
    const storeActions:any[]=[];
    for(const luck of luckChars||[]){
      if(!luck?.branch)continue;
      for(const storeNode of originalBranches.filter((x:any)=>['辰','戌','丑','未'].includes(x.char))){
        const k=pairKey(luck.branch,storeNode.char);
        if(BRANCH_CLASHES.has(k))storeActions.push({layer:luck.layer,incoming_branch:luck.branch,store_id:storeNode.id,store_char:storeNode.char,action:'clash_tomb_candidate',status:'needs_arbitration',evidence_grade:'A',relevant:storeNode.relevant,detail:`${this.luckLayerName(luck.layer)}${luck.branch}冲原局墓库${storeNode.char}；只生成冲墓候选，不自动把当前 contained 改成 released`,source_rule:'BLIND-TOMB-CLASH-DISPUTED'});
        if(BRANCH_COMBINES.has(k))storeActions.push({layer:luck.layer,incoming_branch:luck.branch,store_id:storeNode.id,store_char:storeNode.char,action:'combine_tomb_candidate',status:'needs_arbitration',evidence_grade:'B',relevant:storeNode.relevant,detail:`${this.luckLayerName(luck.layer)}${luck.branch}合原局墓库${storeNode.char}；只生成闭/绊候选，不自动改变墓库状态`,source_rule:'BLIND-TOMB-COMBINE-B'});
      }
    }
    return {
      mode:'current_state_recompute',active_branches:activeBranches,states,store_actions:storeActions,
      note:'墓库快照区分四生/土墓的稳定入墓与“多而墓之”；子午卯酉单见墓仍不机械入墓。岁运按时间层重算，冲墓/合墓只做语义候选，不自动开闭。'
    };
  }

  private luckLayerName(layer:string):string{return layer==='dayun'?'大运':layer==='liunian'?'流年':'流月';}

  private resolveLiuYueGate(facts:any,stageGate:any,luckRelations:any[],identityResolutions:any[],relevantIds:Set<string>,ln:any,ly:any):any {
    if(!ln||!ly)return {available:false,qualified:false,status:'unavailable',flow_year_ready:false,links:[],clues:[],note:'缺少当前流年或流月，不生成流月定位结论。'};
    const identityTypes=new Set(['same_stem_appearance','same_branch_appearance','tonglu_appearance','yuanshen_appearance','hidden_stem_manifestation','hidden_form_appearance']);
    const directTypes=new Set(['same_char','combine','clash','harm','break','punish']);
    const liunianDirect=(luckRelations||[]).filter((r:any)=>{
      if(r.layer!=='liunian'||!relevantIds.has(r.targetNodeId))return false;
      if(directTypes.has(r.type))return true;
      if(identityTypes.has(r.type))return r.selected===true&&r.major_eligible===true;
      return false;
    });
    const liunianIdentity=(identityResolutions||[]).find((x:any)=>x.layer==='liunian');
    const selectedIdentity=(liunianIdentity?.selected||[]).filter((x:any)=>x.major_eligible&&relevantIds.has(x.targetNodeId));
    const flowYearReady=!!stageGate?.engaged&&(liunianDirect.length>0||selectedIdentity.length>0);

    const dm=facts.byId?.[facts.dayMasterNodeId];
    const stemRel=(a:string,b:string)=>{if(!a||!b)return '';if(a===b)return 'same_char';const k=pairKey(a,b);if(STEM_COMBINES.has(k))return 'combine';if(STEM_CLASHES.has(k))return 'clash';return '';};
    const branchRel=(a:string,b:string)=>{if(!a||!b)return '';if(a===b)return 'same_char';const k=pairKey(a,b);if(BRANCH_COMBINES.has(k))return 'combine';if(BRANCH_CLASHES.has(k))return 'clash';if(BRANCH_HARMS.has(k))return 'harm';if(BRANCH_BREAKS.has(k))return 'break';if(PUNISH_PAIRS.has(k))return 'punish';return '';};
    const links:any[]=[];const clues:any[]=[];
    const dmRel=stemRel(ly.heavenly_stem,dm?.char);
    if(dmRel)links.push({route:'month_stem_to_day_master',relation:dmRel,month_char:ly.heavenly_stem,target_char:dm?.char,detail:`流月${ly.heavenly_stem}与日主${dm?.char}${this.luckRelationLabel(dmRel)}，满足流月直接关联日主的定位条件。`,evidence_grade:'A'});
    const fyRel=branchRel(ly.earthly_branch,ln.earthly_branch);
    if(['same_char','combine','clash'].includes(fyRel))links.push({route:'month_branch_to_flow_year',relation:fyRel,month_char:ly.earthly_branch,target_char:ln.earthly_branch,detail:`流月${ly.earthly_branch}与流年${ln.earthly_branch}${this.luckRelationLabel(fyRel)}，形成同支/合/冲的直接定位关系。`,evidence_grade:'A'});
    else if(fyRel)clues.push({route:'month_branch_to_flow_year',relation:fyRel,month_char:ly.earthly_branch,target_char:ln.earthly_branch,detail:`流月${ly.earthly_branch}与流年${ln.earthly_branch}${this.luckRelationLabel(fyRel)}，先保留月份线索；当前核心证据不足以仅凭此关系打开流月定位门。`,evidence_grade:'B'});
    const qualified=flowYearReady&&links.length>0;
    const status=qualified?'qualified':!flowYearReady?'blocked_by_flow_year':'no_direct_month_link';
    return {
      available:true,qualified,status,flow_year_ready:flowYearReady,links,clues,
      flow_year_evidence:uniq([...liunianDirect.map((x:any)=>x.detail),...selectedIdentity.map((x:any)=>x.detail)]).slice(0,8),
      note:qualified?'流年已具备应期承接，且本流月与日主或流年形成A级直接关联；本月只获得“定位资格”，仍不得脱离原局与大运单独定吉凶。':!flowYearReady?'当前流年尚未在已承接的大运阶段形成直接应期线索，流月不得越级制造事件。':'当前流年具备应期线索，但本流月未满足与日主或流年同支/合/冲的A级直接定位条件，只保留普通月份线索。',
      source_rule:'BLIND-LIUYUE-GATE-001'
    };
  }

  private buildDayunStageGate(identityResolutions:any[],luckRelations:any[],relevantIds:Set<string>,dayunReplay:any=null):any {
    const dayunIdentity=identityResolutions.find(x=>x.layer==='dayun');
    const selected=(dayunIdentity?.selected||[]).filter((x:any)=>x.major_eligible&&relevantIds.has(x.targetNodeId));
    const directStructuralTypes=new Set(['same_char','combine','clash','harm','break','punish','tonglu_appearance','yuanshen_appearance','hidden_stem_manifestation','hidden_form_appearance']);
    const directStructural=luckRelations.filter((x:any)=>x.layer==='dayun'&&relevantIds.has(x.targetNodeId)&&directStructuralTypes.has(x.type));
    const shengKe=luckRelations.filter((x:any)=>x.layer==='dayun'&&relevantIds.has(x.targetNodeId)&&['generate','control'].includes(x.type));
    // 阶段门保持收紧：普通生克只做 context，不能单独把大运“开门”。
    // 只有直接身份/结构命中，或 State Replay 确认原主线状态被改变/补足时，才允许进入重大流年应期仲裁。
    const replayEngaged=!!dayunReplay?.engaged;
    const engaged=selected.length>0||directStructural.length>0||replayEngaged;
    const strength=selected.length||directStructural.length?'explicit':replayEngaged?'replay_confirmed':shengKe.length?'shengke_context_only':'quiet';
    return {
      status:engaged?'engaged':shengKe.length?'context_only':'quiet',engaged,strength,
      evidence:[...selected.map((x:any)=>x.detail),...directStructural.map((x:any)=>x.detail),...(dayunReplay?.evidence||[])].filter(Boolean).slice(0,12),
      context_evidence:shengKe.map((x:any)=>x.detail).filter(Boolean).slice(0,8),
      identity_evidence_count:selected.length,direct_structure_count:directStructural.length,shengke_context_count:shengKe.length,replay_engaged:replayEngaged,
      note:engaged?'当前大运已通过直接身份/结构，或经主功状态重演确认真正改变原局主线，可进入流年应期仲裁。':shengKe.length?'当前大运只有普通生克背景，尚不足以证明原局大事进入应验阶段；流年只保留线索。':'当前大运未承接原局第一主线；流年不得凭空制造重大事件。'
    };
  }

  private resolveLuckRootState(facts:any,roots:any[],luckChars:any[]):any {
    const stages=['dayun','liunian','liuyue'];
    const states:any[]=[];
    for(const base of roots||[]){
      const stem=facts.byId[base.stemNodeId];if(!stem)continue;
      const additions:any[]=[];
      for(const luck of luckChars||[]){
        const br=luck?.branch;if(!br)continue;
        const hidden=BRANCH_HIDDEN_STEMS[br]||[];
        const add=(kind:string,capacity:string,grade:string,detail:string,rule:string)=>additions.push({layer:luck.layer,branch:br,kind,capacity,evidence_grade:grade,detail,source_rule:rule,localization_only:luck.layer==='liuyue'});
        if(LU_BRANCH[stem.char]===br)add('luck_lu_root','strong','A',`${this.luckLayerName(luck.layer)}${br}为${stem.char}固定禄，形成岁运见实/禄根支持`,'BLIND-LUCK-ROOT-LU-001');
        else if(hidden.includes(stem.char))add('luck_same_stem_root','strong','A',`${this.luckLayerName(luck.layer)}${br}藏${stem.char}，形成岁运同干见实支持`,'BLIND-LUCK-ROOT-HIDDEN-001');
        else if(LONGSHENG_BRANCH_BY_ELEMENT[stem.element]===br)add('luck_longsheng_qi',stem.element==='金'?'medium':'strong','A',`${this.luckLayerName(luck.layer)}${br}为${stem.element}长生，增加当前得气`,'BLIND-LUCK-QI-LONGSHENG-001');
        else if((TOMB_QI_BRANCHES_BY_ELEMENT[stem.element]||[]).includes(br))add('luck_tomb_qi','medium','A',`${this.luckLayerName(luck.layer)}${br}为${stem.element}墓库，只增加墓库得气/承载，不自动等同禄根`,'BLIND-LUCK-QI-TOMB-001');
        else if(RESIDUAL_QI_BRANCH_BY_ELEMENT[stem.element]===br)add('luck_residual_qi','weak','A',`${this.luckLayerName(luck.layer)}${br}为${stem.element}余气，仅作弱得气`,'BLIND-LUCK-QI-RESIDUAL-001');
      }
      const calc=(until:string,includeLocalization=false)=>{
        const max=stages.indexOf(until),rows=additions.filter(x=>stages.indexOf(x.layer)<=max&&(includeLocalization||!x.localization_only));
        let cap=base.capacity_status;
        if(rows.some(x=>x.capacity==='strong'))cap=['strong_direct_root','strong_qi'].includes(cap)?cap:'luck_strengthened';
        else if(rows.some(x=>x.capacity==='medium')&&['unsupported','external_support_only','weak_qi'].includes(cap))cap='luck_medium_qi';
        else if(rows.some(x=>x.capacity==='weak')&&['unsupported','external_support_only'].includes(cap))cap='luck_weak_qi';
        return {capacity:cap,changed:cap!==base.capacity_status,additions:rows};
      };
      const dayun=calc('dayun'),liunian=calc('liunian'),liuyue=calc('liuyue',true);
      states.push({stemNodeId:base.stemNodeId,stemChar:stem.char,original_capacity:base.capacity_status,current_capacity:liunian.capacity,stage_capacities:{dayun,liunian,liuyue},original_strata:base.root_strata||base.roots||[],luck_additions:additions,changed:liunian.changed,note:'岁运根气按阶段分别计算；大运状态不会被后来的流年反写，流月只进入 localization 容量。'});
    }
    return {mode:'root_strata_snapshot',states,note:'坐下根与外部支持分开；大运/流年见禄、同干见实、长生/墓库/余气只作为当前状态增量，并按时间层分别快照。'};
  }

  private resolveCompositeLuckState(facts:any,luckChars:any[],relevantIds:Set<string>,context:any={}):any {
    const original=(facts.branches||[]).map((id:string)=>facts.byId[id]).filter(Boolean).map((n:any)=>({id:n.id,char:n.char,layer:'original',source:'original'}));
    const stages=['dayun','liunian','liuyue'],layerRank=(l:string)=>l==='original'?-1:stages.indexOf(l);
    const {dy,ln,activeComponent}=context||{};
    const relationForBranch=(a:string,b:string)=>{
      if(!a||!b)return '';
      if(a===b)return 'same_char';
      const k=pairKey(a,b);
      if(BRANCH_COMBINES.has(k))return 'combine';
      if(BRANCH_CLASHES.has(k))return 'clash';
      if(BRANCH_HARMS.has(k))return 'harm';
      if(BRANCH_BREAKS.has(k))return 'break';
      if(PUNISH_PAIRS.has(k))return 'punish';
      if(BRANCH_DARK_COMBINES.has(k))return 'dark_combine';
      if(BRANCH_HALF_HARMONIES.has(k))return 'half_harmony';
      if(BRANCH_ARCH_HARMONIES.has(k))return 'arch_harmony';
      return '';
    };
    // 大运非当运地支不能在“大运阶段”提前参与组合；只有流年真正把它叫起来时，才从流年层加入。
    // 核心资料明确支持冲合提前引动；同支到位、暗合/半合/拱局在这里仅作为“组合链到位”候选，
    // 只用于确认完整三合/三刑是否在该流年形成，不单独给吉凶或化局结论。
    const flowToInactiveBranchRel=(ln&&dy&&activeComponent==='stem')?relationForBranch(ln.earthly_branch,dy.earthly_branch):'';
    const compositeActivationTypes=new Set(['same_char','combine','clash','dark_combine','half_harmony','arch_harmony']);
    const inactiveDayunBranchActivated=!!flowToInactiveBranchRel&&compositeActivationTypes.has(flowToInactiveBranchRel);
    const snapshots:any[]=[];
    for(let si=0;si<stages.length;si++){
      const stage=stages[si];
      const active=[...original];
      // 生产 Timing 有 dy/activeComponent 上下文时，不直接消费 luckChars 里的 dayun branch，因为 cross-phase 激活可能由流年产生；必须保持时间层不反写。
      // 独立单元测试/研究调用若没有上下文，则维持传统累计输入语义。
      if(dy){
        if(dy?.earthly_branch&&activeComponent==='branch')active.push({id:'luck.dayun.branch',char:dy.earthly_branch,layer:'dayun',source:'active_dayun_branch'});
        if(si>=1&&dy?.earthly_branch&&activeComponent==='stem'&&inactiveDayunBranchActivated)active.push({id:'luck.dayun.branch.reactivated',char:dy.earthly_branch,layer:'liunian',source:'inactive_dayun_branch_reactivated',activation_relation:flowToInactiveBranchRel});
        for(const l of luckChars||[]){
          if(!l?.branch||l.layer==='dayun')continue;
          if(stages.indexOf(l.layer)<=si)active.push({id:`luck.${l.layer}.branch`,char:l.branch,layer:l.layer,source:l.layer});
        }
      }else{
        for(const l of luckChars||[]){if(l?.branch&&stages.indexOf(l.layer)<=si)active.push({id:`luck.${l.layer}.branch`,char:l.branch,layer:l.layer,source:l.layer});}
      }
      const chars=active.map(x=>x.char);
      const formations:any[]=[];
      const check=(kind:string,groups:any[])=>{for(const g of groups){if(g.branches.every((z:string)=>chars.includes(z))){const members=g.branches.map((z:string)=>active.find(x=>x.char===z)).filter(Boolean);const firstRank=Math.max(...members.map((m:any)=>layerRank(m.layer)));const firstStage=firstRank<0?'original':stages[firstRank];const usesInactive=members.some((m:any)=>m.source==='inactive_dayun_branch_reactivated');formations.push({kind,branches:g.branches,result_element:g.element||null,family:g.family||null,formed:true,first_formed_stage:firstStage,newly_formed:firstStage===stage,relevant:members.some((m:any)=>m.layer==='original'&&relevantIds.has(m.id)),member_layers:members.map((m:any)=>({char:m.char,layer:m.layer,source:m.source,activation_relation:m.activation_relation||null})),uses_inactive_dayun_component:usesInactive,inactive_dayun_activation_relation:usesInactive?flowToInactiveBranchRel:null,transformation:'not_auto_assumed',major_conclusion_allowed:false,source_rule:kind==='sanxing'?'BLIND-SANXING-COMPLETE-001':'BLIND-COMPOSITE-FORMATION-001'});}}};
      check('sanhe',SANHE);check('sanhui',SANHUI);check('sanxing',SANXING);
      snapshots.push({stage,active_branches:active,formations,note:'只确认组合是否形成及首次形成时间层；非当运大运支若由流年组合关系叫起，仅从流年层进入。是否“化”、节点是否改性及成果归属继续分开。'});
    }
    return {mode:'cumulative_composite_state',snapshots,inactive_dayun_branch_reactivation:inactiveDayunBranchActivated?{activated:true,branch:dy?.earthly_branch,relation:flowToInactiveBranchRel,stage:'liunian',major_conclusion_allowed:false}:null};
  }

  private replayMainlineState(primary:any,facts:any,relations:any[],luckRelations:any[],timingSemantics:any[],identityResolutions:any[],tombReplay:any,rootState:any,compositeState:any):any {
    if(!primary)return {available:false,note:'无原局第一主线，不执行状态重演。'};
    const settlementTargets=primary.settlement?.targetGraph?.primaryTargets||primary.targetNodes||[];
    const settlementBridges=primary.settlement?.targetGraph?.bridges||primary.bridgeNodes||[];
    const settlementCarriers=primary.settlement?.targetGraph?.carriers||primary.resultNodes||[];
    const relevantIds=new Set(uniq([...(primary.actorNodes||[]),...settlementTargets,...settlementBridges,...settlementCarriers]));
    const roleOf=(id:string)=>primary.actorNodes?.includes(id)?'actor':settlementTargets.includes(id)?'target':settlementBridges.includes(id)?'bridge':settlementCarriers.includes(id)?'result':'context';
    const originalPathRelations=(primary.relationIds||[]).map((id:string)=>relations.find((r:any)=>r.id===id)).filter(Boolean);
    const originalCombineNodeIds=new Set(originalPathRelations.filter((r:any)=>['stem_combine','branch_combine','stem_branch_combine'].includes(r.type)).flatMap((r:any)=>r.nodes||[]));
    const originalClashNodeIds=new Set(originalPathRelations.filter((r:any)=>r.type==='clash').flatMap((r:any)=>r.nodes||[]));
    const stages=['dayun','liunian','liuyue'];
    const snapshots:any[]=[];
    const stageIndex=(l:string)=>stages.indexOf(l);
    const originalSettlement=primary.settlement||null;

    for(let si=0;si<stages.length;si++){
      const stage=stages[si],changes:any[]=[];
      // identity candidate 本体过去不带 layer，flatMap 后会丢层级；这里显式继承父 resolution.layer。
      const ids=(identityResolutions||[]).filter((x:any)=>stageIndex(x.layer)<=si).flatMap((x:any)=>(x.selected||[]).filter((c:any)=>c.evidence_grade==='A'&&relevantIds.has(c.targetNodeId)).map((c:any)=>({...c,layer:c.layer||x.layer})));
      for(const c of ids)changes.push({type:'identity_arrival',layer:c.layer,targetNodeId:c.targetNodeId,role:roleOf(c.targetNodeId),certainty:'fact',detail:c.detail,source_rule:c.source_rule});
      const sems=(timingSemantics||[]).filter((x:any)=>stageIndex(x.layer)<=si&&(!x.targetNodeId||relevantIds.has(x.targetNodeId)));
      for(const sem of sems){
        let type='relation_context',certainty='candidate';
        if(sem.semantic==='appearance_arrival')type='identity_arrival';
        else if(String(sem.semantic).startsWith('clash')){
          if(sem.targetNodeId&&originalCombineNodeIds.has(sem.targetNodeId))type='original_combine_released_candidate';
          else type='clash_impact_candidate';
        }else if(String(sem.semantic).startsWith('combine')){
          if(sem.targetNodeId&&originalClashNodeIds.has(sem.targetNodeId))type='original_clash_met_by_combine';
          else type='combine_impact_candidate';
        }else if(['wear_damage_candidate','break_symbolic_disruption','punish_candidate'].includes(sem.semantic))type='structure_damage_candidate';
        else if(['dayun_generate_context','dayun_control_context'].includes(sem.semantic))type='shengke_context';
        if(sem.status==='fact')certainty='fact';
        changes.push({type,layer:sem.layer,targetNodeId:sem.targetNodeId||null,role:sem.targetNodeId?roleOf(sem.targetNodeId):'dayun_context',certainty,detail:sem.detail,source_rule:sem.source_rule});
      }
      const comp=(compositeState?.snapshots||[]).find((x:any)=>x.stage===stage);
      for(const f of comp?.formations||[])if(f.newly_formed&&f.relevant)changes.push({type:'composite_formation_change',layer:stage,role:'structure',certainty:'fact',detail:`${f.kind} ${f.branches.join('')} 在当前时间层形成；只确认成局，是否改性另判`,source_rule:f.source_rule,formation:f});
      const stageTomb=tombReplay?.[stage]||{states:[],store_actions:[]};
      for(const a of stageTomb.store_actions||[])if(a.relevant)changes.push({type:'tomb_action_candidate',layer:a.layer||stage,role:'structure',certainty:'candidate',detail:a.detail,source_rule:a.source_rule});
      for(const ts of stageTomb.states||[]){
        const luckFormed=ts.relevant&&ts.contained===true&&(ts.inmate_layer!=='original'||ts.store_layer!=='original');
        if(luckFormed)changes.push({type:'tomb_containment_changed',layer:stage,role:'structure',certainty:'fact',detail:ts.detail,source_rule:ts.source_rule});
      }
      const actorRoots=(rootState?.states||[]).filter((r:any)=>primary.actorNodes?.includes(r.stemNodeId));
      for(const r of actorRoots){const sc=r.stage_capacities?.[stage];if(sc?.changed)changes.push({type:'actor_capacity_changed',layer:stage,role:'actor',certainty:'fact',detail:`主功执行者${r.stemChar}承载在${this.luckLayerName(stage)}层由${r.original_capacity}变为${sc.capacity}`,source_rule:'BLIND-ROOT-STATE-REPLAY-001'});}

      // changes 保留累计审计；所有“本层正反/Settlement 变化”只消费当前层新增变化，防止大运证据在流年、流月重复计票。
      const cumulativeChanges=changes.filter(x=>stageIndex(x.layer)<=si);
      const stageChanges=cumulativeChanges.filter(x=>x.layer===stage);
      const direct=stageChanges.filter(x=>!['shengke_context','relation_context'].includes(x.type));
      let state='maintained';
      if(direct.some(x=>x.type==='original_combine_released_candidate'||x.type==='structure_damage_candidate'||x.type==='tomb_action_candidate'))state='altered_candidate';
      else if(direct.some(x=>x.type==='composite_formation_change'))state='transformed_candidate';
      else if(direct.some(x=>x.type==='identity_arrival'||x.type==='original_clash_met_by_combine'))state='stage_engaged';
      else if(direct.some(x=>x.type==='actor_capacity_changed'))state='strengthened_candidate';
      const engaged=stage==='dayun'&&direct.some(x=>['identity_arrival','original_combine_released_candidate','original_clash_met_by_combine','structure_damage_candidate','composite_formation_change','tomb_action_candidate','tomb_containment_changed','actor_capacity_changed','clash_impact_candidate','combine_impact_candidate'].includes(x.type));
      const hasDamage=direct.some(x=>['original_combine_released_candidate','structure_damage_candidate','clash_impact_candidate'].includes(x.type));
      const mechanismAltered=direct.some(x=>['original_clash_met_by_combine','combine_impact_candidate','composite_formation_change','tomb_action_candidate','tomb_containment_changed'].includes(x.type));
      const actorChanged=direct.some(x=>x.type==='actor_capacity_changed');
      const targetEngaged=direct.some(x=>x.role==='target'&&(x.type==='identity_arrival'||x.type==='combine_impact_candidate'||x.type==='clash_impact_candidate'));
      const settlementDelta={
        mode:'settlement_replay_candidate',version:'v2.5.3-stage-incremental',scope:'stage_delta',stage,
        executor_state:actorChanged?'changed_candidate':'maintained',
        control_edge_state:hasDamage?'impaired_candidate':mechanismAltered?'altered_candidate':'maintained',
        target_state:targetEngaged?'engaged_candidate':hasDamage&&direct.some(x=>x.role==='target')?'disturbed_candidate':'maintained',
        completion_before:originalSettlement?.completion||null,
        completion_after_candidate:hasDamage?'partial_or_broken_candidate':mechanismAltered?'recheck_required':actorChanged||targetEngaged?'maintained_or_strengthened_candidate':originalSettlement?.completion||'unknown',
        residual_before:originalSettlement?.residualTargetIds||[],
        residual_change_candidate:hasDamage?'increase_candidate':mechanismAltered?'recheck_required':'unchanged_candidate',
        integrity_before:originalSettlement?.resultIntegrity||null,
        integrity_after_candidate:hasDamage?'impaired_or_broken_candidate':mechanismAltered?'recheck_required':originalSettlement?.resultIntegrity||'unknown',
        ownership_before:primary.ownership?.result||'unclear',ownership_after_candidate:mechanismAltered||hasDamage?'recheck_required':'unchanged_candidate',
        alignment_before:originalSettlement?.alignment||'unknown',alignment_after_candidate:hasDamage||mechanismAltered?'recheck_required':'unchanged_candidate',
        evidence:uniq(direct.map(x=>x.detail)).slice(0,12),
        note:'仅生成当前时间层的 Settlement 候选增量，不伪造新的原局结算值；大运既有证据不在流年/流月重复计票。'
      };
      snapshots.push({stage,state,engaged,evidence:uniq(direct.map(x=>x.detail)).slice(0,12),changes:cumulativeChanges,stage_changes:stageChanges,cumulative_changes:cumulativeChanges,settlement_delta:settlementDelta,note:'State Replay只重演原局第一主功；changes供累计审计，stage_changes才进入本层Settlement/正反裁决。'});
    }
    return {available:true,mode:'original_mainline_state_replay',version:'v2.5.3-incremental',original:{path_id:primary.id,title:primary.title,type:primary.type,status:primary.status,relation_ids:primary.relationIds||[],settlement:primary.settlement||null},dayun:snapshots.find(x=>x.stage==='dayun'),liunian:snapshots.find(x=>x.stage==='liunian'),liuyue:snapshots.find(x=>x.stage==='liuyue'),snapshots,note:'原局→大运→流年→流月重演同一第一主功；每层裁决只消费该层增量，累计事实另存审计。'};
  }

  resolveTiming(chart, facts, relations, primary, options:any = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const chinaParts = this.getChinaClockParts(now), currentYear = chinaParts[0], nowClock = this.partsClockNumber(chinaParts);
    const dys = chart?.da_yun || [];
    const eventClock=(e:any)=>this.parseLocalClock(e?.window_start||'');
    let di=-1;
    for(let i=0;i<dys.length;i++){
      const st=eventClock(dys[i]?.start_event),en=eventClock(dys[i]?.end_event);
      if(st&&nowClock>=st&&(!en||nowClock<en)){di=i;break;}
    }
    const allLn=dys.flatMap((d:any)=>(d.liu_nian||[]).map((y:any)=>({d,y})));
    const anyLn=allLn.find((x:any)=>{const st=eventClock(x.y?.liunian_start_event),en=eventClock(x.y?.liunian_end_event);return st?nowClock>=st&&(!en||nowClock<en):Number(x.y?.year)===currentYear;})||allLn.find((x:any)=>Number(x.y?.year)===currentYear);
    if(di<0){
      const daxian=this.resolveBlindDaXian(chart,currentYear);
      return { available:false,current_year:currentYear,dayun:null,liunian:anyLn?{year:anyLn.y.year,ganzhi:anyLn.y.ganzhi,start_event:anyLn.y.liunian_start_event,end_event:anyLn.y.liunian_end_event}:null,liuyue:null,daxian,effect:'unknown',triggers:[],luck_relations:[],future:[],note:chart?.input_mode==='pillars'?'四柱直排未提供完整年份/起运信息，或尚未到首个交运窗口，不虚构当前大运。':'当前时间尚未进入已生成的大运交运区间。' };
    }
    const dy=dys[di],ln=anyLn?.y||null,ly=ln?this.resolveCurrentLiuYue(Number(ln.year),nowClock):null,branchSwitch=eventClock(dy?.stem_to_branch_event),activeComponent=branchSwitch&&nowClock>=branchSwitch?'branch':'stem';
    const realityStateManifestations=this.resolveRealityStageManifestations(facts,dy,ln,ly,activeComponent);
    const daxian=this.resolveBlindDaXian(chart,currentYear);
    const branchRel=(a:string,b:string)=>{
      if(!a||!b)return '';
      if(a===b)return 'same_char';
      const k=pairKey(a,b);
      if(BRANCH_COMBINES.has(k))return 'combine';if(BRANCH_CLASHES.has(k))return 'clash';if(BRANCH_HARMS.has(k))return 'harm';if(BRANCH_BREAKS.has(k))return 'break';if(PUNISH_PAIRS.has(k)||(a===b&&SELF_PUNISH.has(a)))return 'punish';if(BRANCH_DARK_COMBINES.has(k))return 'dark_combine';if(BRANCH_HALF_HARMONIES.has(k))return 'half_harmony';if(BRANCH_ARCH_HARMONIES.has(k))return 'arch_harmony';return '';
    };
    const stemRel=(a:string,b:string)=>{if(!a||!b)return '';if(a===b)return 'same_char';const k=pairKey(a,b);if(STEM_COMBINES.has(k))return 'combine';if(STEM_CLASHES.has(k))return 'clash';return '';};
    const allVisible=uniq([...(facts.visible_stems||[]),...(facts.branches||[])]).map((id:string)=>facts.byId[id]).filter(Boolean);
    const baseLuckChars=[{layer:'dayun',stem:activeComponent==='stem'?dy.heavenly_stem:null,branch:activeComponent==='branch'?dy.earthly_branch:null},...(ln?[{layer:'liunian',stem:ln.heavenly_stem,branch:ln.earthly_branch}]:[]),...(ly?[{layer:'liuyue',stem:ly.heavenly_stem,branch:ly.earthly_branch}]:[])];
    const allLuckRelations:any[]=[];
    const addAllLuck=(luck:any,n:any,type:string,detail:string)=>{const id=`ALR${String(allLuckRelations.length+1).padStart(3,'0')}`;allLuckRelations.push({id,layer:luck.layer,type,targetNodeId:n.id,targetChar:n.char,detail,mainline_relevant:false,scope:'global_timing_fact',major_conclusion_allowed:false});};
    const layerName=(layer:string)=>this.luckLayerName(layer);
    for(const luck of baseLuckChars){
      for(const n of allVisible){
        const isStem=n.position==='stem',lc=isStem?luck.stem:luck.branch;if(!lc)continue;
        const rel=isStem?stemRel(lc,n.char):branchRel(lc,n.char);
        if(rel)addAllLuck(luck,n,rel,`${layerName(luck.layer)}${lc}与原局${n.char}${this.luckRelationLabel(rel)}`);
        const luckEl=isStem?STEM_ELEMENT[lc]:BRANCH_ELEMENT[lc],nodeEl=n.element;
        if(luckEl&&nodeEl&&luckEl!==nodeEl){
          if(elementGenerates(luckEl,nodeEl))addAllLuck(luck,n,'generate',`${layerName(luck.layer)}${lc}生原局${n.char}`);
          if(elementControls(luckEl,nodeEl))addAllLuck(luck,n,'control',`${layerName(luck.layer)}${lc}克原局${n.char}`);
        }
      }
    }
    // 流年与当前十年大运本身的直接关系也是客观应期事实。这里只记录事实，不直接赋吉凶；
    // 当前是否当运、是否冲起/冲去仍由 cross-phase / semantic 层继续仲裁。
    if(ln){
      const dsr=stemRel(ln.heavenly_stem,dy.heavenly_stem);
      if(dsr)allLuckRelations.push({id:`ALR${String(allLuckRelations.length+1).padStart(3,'0')}`,layer:'liunian',type:dsr,targetNodeId:'',targetChar:dy.heavenly_stem,target_scope:'dayun_stem',dayun_component_active:activeComponent==='stem',detail:`流年${ln.heavenly_stem}与大运${dy.heavenly_stem}${this.luckRelationLabel(dsr)}`,mainline_relevant:false,scope:'global_timing_fact',major_conclusion_allowed:false});
      const dbr=branchRel(ln.earthly_branch,dy.earthly_branch);
      if(dbr)allLuckRelations.push({id:`ALR${String(allLuckRelations.length+1).padStart(3,'0')}`,layer:'liunian',type:dbr,targetNodeId:'',targetChar:dy.earthly_branch,target_scope:'dayun_branch',dayun_component_active:activeComponent==='branch',detail:`流年${ln.earthly_branch}与大运${dy.earthly_branch}${this.luckRelationLabel(dbr)}`,mainline_relevant:false,scope:'global_timing_fact',major_conclusion_allowed:false});
    }
    // 流年若把非当运的大运另一半叫起，进一步记录“被叫起的大运字 → 原局”的二段客观事实。
    // 这些关系发生在流年层，不得反写为大运阶段已经成立；也不单独升级吉凶。
    if(ln&&activeComponent==='stem'){
      const activationRel=branchRel(ln.earthly_branch,dy.earthly_branch);
      if(activationRel){
        for(const n of allVisible.filter((x:any)=>x.position==='branch')){
          const rel=branchRel(dy.earthly_branch,n.char);if(!rel)continue;
          allLuckRelations.push({id:`ALR${String(allLuckRelations.length+1).padStart(3,'0')}`,layer:'liunian',type:rel,targetNodeId:n.id,targetChar:n.char,target_scope:'original_via_reactivated_dayun_branch',reactivated_dayun_component:'branch',reactivated_dayun_char:dy.earthly_branch,activation_relation:activationRel,detail:`流年${ln.earthly_branch}${this.luckRelationLabel(activationRel)}非当运运支${dy.earthly_branch}并将其叫起；${dy.earthly_branch}与原局${n.char}${this.luckRelationLabel(rel)}`,mainline_relevant:false,scope:'global_timing_fact',major_conclusion_allowed:false});
        }
      }
    }
    if(ln&&activeComponent==='branch'){
      const activationRel=stemRel(ln.heavenly_stem,dy.heavenly_stem);
      if(activationRel){
        for(const n of allVisible.filter((x:any)=>x.position==='stem')){
          const rel=stemRel(dy.heavenly_stem,n.char);if(!rel)continue;
          allLuckRelations.push({id:`ALR${String(allLuckRelations.length+1).padStart(3,'0')}`,layer:'liunian',type:rel,targetNodeId:n.id,targetChar:n.char,target_scope:'original_via_reactivated_dayun_stem',reactivated_dayun_component:'stem',reactivated_dayun_char:dy.heavenly_stem,activation_relation:activationRel,detail:`流年${ln.heavenly_stem}${this.luckRelationLabel(activationRel)}非当运运干${dy.heavenly_stem}并将其叫起；${dy.heavenly_stem}与原局${n.char}${this.luckRelationLabel(rel)}`,mainline_relevant:false,scope:'global_timing_fact',major_conclusion_allowed:false});
        }
      }
    }
    if(!primary)return {available:true,current_year:currentYear,dayun:{index:di,pillar:dy.pillar,start_year:dy.start_year,start_age:dy.start_age,phase:activeComponent==='stem'?dy.stem_phase?.name:dy.branch_phase?.name,active_component:activeComponent,active_value:activeComponent==='stem'?dy.heavenly_stem:dy.earthly_branch,start_event:dy.start_event,stem_to_branch_event:dy.stem_to_branch_event},liunian:ln?{year:ln.year,ganzhi:ln.ganzhi,start_event:ln.liunian_start_event,end_event:ln.liunian_end_event}:null,liuyue:ly?{pillar:ly.pillar,heavenly_stem:ly.heavenly_stem,earthly_branch:ly.earthly_branch,start_event:ly.start_event,end_event:ly.end_event}:null,daxian,effect:'neutral',triggers:[],luck_relations:[],all_luck_relations:allLuckRelations,timing_fact_scope:{global_fact_count:allLuckRelations.length,mainline_fact_count:0,note:'全局岁运事实独立于第一主功记录；无第一主线时不把这些事实升级为事件结论。'},reality_state_manifestations:realityStateManifestations,future:[],note:'原局第一主线未明确，因此仅保留全局客观岁运事实，不强行解释事件。'};

    const settlementTargets=primary.settlement?.targetGraph?.primaryTargets||primary.targetNodes||[];
    const settlementBridges=primary.settlement?.targetGraph?.bridges||primary.bridgeNodes||[];
    const settlementCarriers=primary.settlement?.targetGraph?.carriers||primary.resultNodes||[];
    const relevant=uniq([...(primary.actorNodes||[]),...settlementTargets,...settlementBridges,...settlementCarriers]).map(id=>facts.byId[id]).filter(Boolean);
    const relevantIds=new Set(relevant.map((n:any)=>n.id));
    for(const r of allLuckRelations)r.mainline_relevant=relevantIds.has(r.targetNodeId);
    const triggers:any[]=[],luckRelations:any[]=[];
    let activeDayunStem=activeComponent==='stem'?dy.heavenly_stem:null,activeDayunBranch=activeComponent==='branch'?dy.earthly_branch:null;
    const crossRelation=ln?(activeComponent==='stem'?branchRel(ln.earthly_branch,dy.earthly_branch):stemRel(ln.heavenly_stem,dy.heavenly_stem)):'';
    if(ln&&activeComponent==='stem'&&crossRelation){activeDayunBranch=dy.earthly_branch;triggers.push({layer:'dayun',type:'cross_phase_activate',relation:crossRelation,targetNodeId:'',detail:`流年${ln.earthly_branch}与非当运运支${dy.earthly_branch}发生${this.luckRelationLabel(crossRelation)}，提前引动${dy.earthly_branch}运`});}
    if(ln&&activeComponent==='branch'&&crossRelation){activeDayunStem=dy.heavenly_stem;triggers.push({layer:'dayun',type:'cross_phase_activate',relation:crossRelation,targetNodeId:'',detail:`流年${ln.heavenly_stem}与非当运运干${dy.heavenly_stem}发生${this.luckRelationLabel(crossRelation)}，重新引动${dy.heavenly_stem}运`});}
    // 除冲合外，固定禄/原身身份也可把另一半运重新叫出来；只开放直接白名单，不用半禄扩展。
    if(ln&&activeComponent==='branch'&&!activeDayunStem&&LU_BRANCH[dy.heavenly_stem]===ln.earthly_branch){
      activeDayunStem=dy.heavenly_stem;triggers.push({layer:'dayun',type:'cross_phase_identity_activate',relation:'tonglu',targetNodeId:'',detail:`流年${ln.earthly_branch}为非当运运干${dy.heavenly_stem}之固定禄，重新引动${dy.heavenly_stem}运`,evidence_grade:'A',source_rule:'BLIND-CROSS-PHASE-TONGLU-001'});
    }
    if(ln&&activeComponent==='stem'&&!activeDayunBranch&&(ORIGIN_STEMS_BY_BRANCH[dy.earthly_branch]||[]).includes(ln.heavenly_stem)){
      activeDayunBranch=dy.earthly_branch;triggers.push({layer:'dayun',type:'cross_phase_identity_activate',relation:'yuanshen',targetNodeId:'',detail:`流年${ln.heavenly_stem}为非当运运支${dy.earthly_branch}之固定原身，提前引动${dy.earthly_branch}运`,evidence_grade:'A',source_rule:'BLIND-CROSS-PHASE-YUANSHEN-001'});
    }

    const luckChars=[{layer:'dayun',stem:activeDayunStem,branch:activeDayunBranch},...(ln?[{layer:'liunian',stem:ln.heavenly_stem,branch:ln.earthly_branch}]:[]),...(ly?[{layer:'liuyue',stem:ly.heavenly_stem,branch:ly.earthly_branch}]:[])];
    const identityResolutions=luckChars.map((luck:any)=>this.resolveLuckIdentities(luck,facts,relevantIds));
    const addLuck=(luck:any,n:any,type:string,detail:string,extra:any={})=>{const id=`LR${String(luckRelations.length+1).padStart(3,'0')}`;luckRelations.push({id,layer:luck.layer,type,targetNodeId:n.id,targetChar:n.char,detail,mainline_relevant:true,scope:'mainline_timing_fact',...extra});return id;};
    for(const luck of luckChars){
      for(const n of relevant){
        const isStem=n.position==='stem'||n.position==='hidden_stem',lc=isStem?luck.stem:luck.branch;if(!lc)continue;
        const rel=isStem?stemRel(lc,n.char):branchRel(lc,n.char);
        if(rel){
          addLuck(luck,n,rel,`${layerName(luck.layer)}${lc}与原局${n.char}${this.luckRelationLabel(rel)}`);
          if(!['dark_combine','half_harmony','arch_harmony'].includes(rel)){
            const type=rel==='same_char'?'appearance':rel==='combine'?'combine_activate':rel==='clash'?'clash_activate':rel==='harm'?'harm_activate':rel==='break'?'break_activate':'punish_activate';
            triggers.push({layer:luck.layer,type,targetNodeId:n.id,detail:`${layerName(luck.layer)}${lc}${this.luckRelationLabel(rel)}原局${n.char}，引动主线节点`});
          }
        }
        const luckEl=isStem?STEM_ELEMENT[lc]:BRANCH_ELEMENT[lc],nodeEl=n.element;
        if(luckEl&&nodeEl&&luckEl!==nodeEl){
          if(elementGenerates(luckEl,nodeEl))addLuck(luck,n,'generate',`${layerName(luck.layer)}${lc}生原局${n.char}`);
          if(elementControls(luckEl,nodeEl))addLuck(luck,n,'control',`${layerName(luck.layer)}${lc}克原局${n.char}`);
        }
        // 墓库与干支身份不再在这里用“五行=墓库”粗判；统一交给 IdentityResolver / TombStateResolver。
      }
    }
    // 将身份解析结果转成结构化岁运事实。只让 selected 且允许重大应期的身份进入 trigger；B级候选保留在 identity_resolutions。
    for(const ir of identityResolutions){
      const luck=luckChars.find((x:any)=>x.layer===ir.layer)||{layer:ir.layer};
      for(const c of ir.claims){
        const n=facts.byId[c.targetNodeId];if(!n)continue;
        addLuck(luck,n,c.type,c.detail,{identity_claim_id:c.id,evidence_grade:c.evidence_grade,source_status:c.source_status,selected:c.selected,major_eligible:c.major_eligible,source_rule:c.source_rule});
      }
      for(const c of ir.selected.filter((x:any)=>x.major_eligible&&relevantIds.has(x.targetNodeId))){
        triggers.push({layer:ir.layer,type:'identity_appearance',identity_type:c.type,targetNodeId:c.targetNodeId,detail:c.detail,evidence_grade:c.evidence_grade,source_rule:c.source_rule});
      }
    }
    const tombHistory=this.resolveTombStates(facts,luckChars,relevantIds);
    const luckUpTo=(stage:string)=>{const order=['dayun','liunian','liuyue'],i=order.indexOf(stage);return luckChars.filter((x:any)=>order.indexOf(x.layer)<=i);};
    const tombStateReplay={dayun:this.resolveTombStateSnapshot(facts,luckUpTo('dayun'),relevantIds),liunian:this.resolveTombStateSnapshot(facts,luckUpTo('liunian'),relevantIds),liuyue:this.resolveTombStateSnapshot(facts,luckUpTo('liuyue'),relevantIds)};
    const tombStateSnapshot=tombStateReplay.liuyue;
    const tombStates=tombStateSnapshot.states;
    const timingRelationSemantics=this.resolveTimingRelationSemantics(luckRelations,facts,primary,{dy,ln,activeComponent,crossRelation,tombSnapshot:tombStateSnapshot});
    const rootStateSnapshot=this.resolveLuckRootState(facts,options?._roots||this.resolveRoots(facts),luckChars);
    const compositeState=this.resolveCompositeLuckState(facts,luckChars,relevantIds,{dy,ln,activeComponent});
    const stateReplay=this.replayMainlineState(primary,facts,relations,luckRelations,timingRelationSemantics,identityResolutions,tombStateReplay,rootStateSnapshot,compositeState);
    const stageGate=this.buildDayunStageGate(identityResolutions,luckRelations,relevantIds,stateReplay?.dayun);
    const liuyueGate=this.resolveLiuYueGate(facts,stageGate,luckRelations,identityResolutions,relevantIds,ln,ly);
    const dayunIdentity=identityResolutions.find((x:any)=>x.layer==='dayun');
    const liunianIdentity=identityResolutions.find((x:any)=>x.layer==='liunian');
    const directDayunTypes=new Set(['same_char','combine','clash','harm','break','punish','tonglu_appearance','yuanshen_appearance','hidden_stem_manifestation','hidden_form_appearance']);
    const dayunEngagedTargets=new Set([
      ...(dayunIdentity?.selected||[]).filter((x:any)=>x.major_eligible&&relevantIds.has(x.targetNodeId)).map((x:any)=>x.targetNodeId),
      ...luckRelations.filter((x:any)=>x.layer==='dayun'&&relevantIds.has(x.targetNodeId)&&directDayunTypes.has(x.type)).map((x:any)=>x.targetNodeId),
      ...(stateReplay?.dayun?.changes||[]).filter((x:any)=>x.targetNodeId&&x.type!=='shengke_context').map((x:any)=>x.targetNodeId)
    ]);
    const fanKeClaims=(liunianIdentity?.selected||[]).filter((x:any)=>x.major_eligible&&relevantIds.has(x.targetNodeId)&&['tonglu_appearance','yuanshen_appearance','same_stem_appearance','same_branch_appearance'].includes(x.type));
    const fanKeQualified=fanKeClaims.filter((x:any)=>stageGate.engaged&&dayunEngagedTargets.has(x.targetNodeId));
    const dynamicDayunClaims:any[]=[];
    if(ln){
      if(LU_BRANCH[dy.heavenly_stem]===ln.earthly_branch)dynamicDayunClaims.push({type:'liunian_tonglu_dayun_stem',dayun_component:'stem',dayun_char:dy.heavenly_stem,liunian_char:ln.earthly_branch,evidence_grade:'A',detail:`流年${ln.earthly_branch}为大运${dy.heavenly_stem}之固定禄，太岁取得大运${dy.heavenly_stem}身份`});
      if((ORIGIN_STEMS_BY_BRANCH[dy.earthly_branch]||[]).includes(ln.heavenly_stem))dynamicDayunClaims.push({type:'liunian_yuanshen_dayun_branch',dayun_component:'branch',dayun_char:dy.earthly_branch,liunian_char:ln.heavenly_stem,evidence_grade:'A',detail:`流年${ln.heavenly_stem}为大运${dy.earthly_branch}之固定原身，太岁取得大运${dy.earthly_branch}身份`});
      if(ln.heavenly_stem===dy.heavenly_stem)dynamicDayunClaims.push({type:'liunian_same_dayun_stem',dayun_component:'stem',dayun_char:dy.heavenly_stem,liunian_char:ln.heavenly_stem,evidence_grade:'A',detail:`流年天干与大运天干同字，太岁取得大运${dy.heavenly_stem}身份`});
      if(ln.earthly_branch===dy.earthly_branch)dynamicDayunClaims.push({type:'liunian_same_dayun_branch',dayun_component:'branch',dayun_char:dy.earthly_branch,liunian_char:ln.earthly_branch,evidence_grade:'A',detail:`流年地支与大运地支同字，太岁取得大运${dy.earthly_branch}身份`});
    }
    const fanKeWeiZhu=dynamicDayunClaims.length&&stageGate.engaged?{status:'qualified_by_dayun_identity',qualified:true,mode:'dayun_identity',claims:dynamicDayunClaims,note:'太岁取得当前大运某一字身份，且大运已通过 State Replay/直接结构承接原局第一主线，可进入反客为主应期仲裁；最终事件仍须回接原局。'}:dynamicDayunClaims.length?{status:'dayun_identity_candidate',qualified:false,mode:'dayun_identity',claims:dynamicDayunClaims,note:'太岁取得大运字身份，但当前大运尚未证明承接原局第一主线；只保留反客为主候选，不单独升重大事件。'}:fanKeQualified.length?{status:'qualified',qualified:true,mode:'original_identity',claims:fanKeQualified,note:'太岁取得原局主线身份，且当前大运在同一目标上形成阶段承接，可进入“反客为主”应期仲裁。'}:fanKeClaims.length?{status:'blocked_by_dayun_stage',qualified:false,mode:'original_identity',claims:fanKeClaims,note:'流年虽取得原局身份，但当前大运未在同一目标上形成阶段承接；保留应期线索，不单独升重大事件。'}:{status:'not_triggered',qualified:false,mode:null,claims:[],note:'当前流年未形成高置信的反客为主身份条件。'};
    for(const t of triggers){
      if(t.layer==='liuyue'){t.major_eligible=false;t.localization_eligible=liuyueGate.qualified;t.scope=liuyueGate.qualified?'localization_eligible':'localization_clue_only';continue;}
      if(t.layer==='liunian'){t.major_eligible=stageGate.engaged;t.scope=stageGate.engaged?'major_timing_eligible':'timing_clue_only';continue;}
      t.major_eligible=true;t.scope='stage';
    }

    const liunianSemantics=timingRelationSemantics.filter((x:any)=>x.layer==='liunian');
    let effect='neutral';
    if(fanKeWeiZhu.qualified)effect='identity_triggered';
    else if(stageGate.engaged&&stateReplay?.liunian?.state&&stateReplay.liunian.state!=='maintained')effect='state_changed';
    else if(stageGate.engaged&&liunianSemantics.length)effect='activated';
    else if(stageGate.engaged)effect='stage_context';

    // 未来年份只列“应期候选理由”，不再按冲合数量加权评分。
    const future:any[]=[];
    const flowBaseYear=Number(ln?.year||currentYear);
    for(let year=flowBaseYear;year<flowBaseYear+5;year++){
      let foundDy:any=null,foundLn:any=null;for(const d of dys){const y=(d.liu_nian||[]).find(x=>Number(x.year)===year);if(y){foundDy=d;foundLn=y;break;}}
      if(!foundLn)continue;const labels:any[]=[];
      for(const n of relevant){
        if((n.position==='stem'||n.position==='hidden_stem')&&foundLn.heavenly_stem===n.char)labels.push(`${n.char}到位`);
        if(n.position==='branch'){const rel=branchRel(foundLn.earthly_branch,n.char);if(rel)labels.push(`${foundLn.earthly_branch}${this.luckRelationLabel(rel)}${n.char}`);}
      }
      if(foundLn.is_transition_year)labels.unshift('交运年');
      const reasons=uniq(labels).slice(0,6);
      future.push({year,ganzhi:foundLn.ganzhi,dayun:foundDy?.pillar||'',dayun_phase:foundLn.dayun_phase||'',transition_event:foundLn.transition_event||null,status:reasons.length?'timing_candidate':'no_direct_trigger',labels:reasons,note:reasons.length?'仅列候选应期理由，不按关系数量评强弱；是否应事仍需当年重新做身份、阶段门与关系语义仲裁。':'当前未发现与第一主线的直接到位/关系线索，不据此断平稳或无事。'});
    }
    return {available:true,current_year:currentYear,dayun:{index:di,pillar:dy.pillar,start_year:dy.start_year,start_age:dy.start_age,phase:activeComponent==='stem'?dy.stem_phase?.name:dy.branch_phase?.name,active_component:activeComponent,active_value:activeComponent==='stem'?dy.heavenly_stem:dy.earthly_branch,whole_context:dy.pillar,inactive_component:activeComponent==='stem'?'branch':'stem',inactive_value:activeComponent==='stem'?dy.earthly_branch:dy.heavenly_stem,start_event:dy.start_event,stem_to_branch_event:dy.stem_to_branch_event},liunian:ln?{year:ln.year,ganzhi:ln.ganzhi,start_event:ln.liunian_start_event,end_event:ln.liunian_end_event}:null,liuyue:ly?{pillar:ly.pillar,heavenly_stem:ly.heavenly_stem,earthly_branch:ly.earthly_branch,start_event:ly.start_event,end_event:ly.end_event}:null,daxian,effect,triggers,luck_relations:luckRelations,all_luck_relations:allLuckRelations,timing_fact_scope:{global_fact_count:allLuckRelations.length,mainline_fact_count:luckRelations.length,note:'all_luck_relations记录所有原局明干明支的客观岁运关系；luck_relations仍只服务原局第一主功。非主线事实默认major_conclusion_allowed=false，不得越级生成重大事件。'},timing_relation_semantics:timingRelationSemantics,reality_state_manifestations:realityStateManifestations,identity_resolutions:identityResolutions,stage_gate:stageGate,liuyue_gate:liuyueGate,fan_ke_wei_zhu:fanKeWeiZhu,root_state_snapshot:rootStateSnapshot,composite_state:compositeState,state_replay:stateReplay,tomb_state_replay:tombStateReplay,tomb_states:tombStates,tomb_state_snapshot:tombStateSnapshot,tomb_history:tombHistory,future,note:'v2.2将“客观岁运事实”与“第一主功应期事实”分层：全局冲合刑穿破生克完整保留，但只有第一主功相关关系才进入阶段门、State Replay和重大应期仲裁。大运定阶段、流年取应期、流月只定位。'};
  }

  private resolveTimingRelationSemantics(luckRelations:any[],facts:any,primary:any,context:any):any[] {
    const out:any[]=[];
    const actorIds=new Set(primary?.actorNodes||[]),targetIds=new Set(primary?.targetNodes||[]);
    const tombSnapshot=context?.tombSnapshot||{states:[],store_actions:[]};
    const add=(r:any,semantic:string,extra:any={})=>out.push({
      id:`TRS${String(out.length+1).padStart(3,'0')}`,relation_id:r?.id||null,layer:r?.layer||extra.layer||'',raw_type:r?.type||extra.raw_type||'',targetNodeId:r?.targetNodeId||extra.targetNodeId||'',
      semantic,evidence_grade:extra.evidence_grade||'A',status:extra.status||'candidate',major_conclusion_allowed:extra.major_conclusion_allowed===true,
      affects_role:r?.targetNodeId?(actorIds.has(r.targetNodeId)?'actor':targetIds.has(r.targetNodeId)?'target':'mainline_context'):(extra.affects_role||'dayun_context'),
      detail:extra.detail||r?.detail||'',source_rule:extra.source_rule||'BLIND-TIMING-SEMANTIC-001',alternatives:extra.alternatives||[]
    });
    for(const r of luckRelations){
      if(r.layer==='liuyue')continue;
      if(r.type==='same_char'||['same_stem_appearance','same_branch_appearance','tonglu_appearance','yuanshen_appearance','hidden_stem_manifestation','hidden_form_appearance'].includes(r.type)){
        add(r,'appearance_arrival',{status:'fact',major_conclusion_allowed:false,detail:`${r.detail}；这里只确认“到位/身份出现”，事件吉凶仍由原局与大运决定。`,source_rule:'BLIND-APPEAR-SEMANTIC-001'});
      }else if(r.type==='clash'){
        const node=facts.byId[r.targetNodeId];
        const touchesStore=!!node&&((tombSnapshot.store_actions||[]).some((x:any)=>x.store_id===node.id&&x.layer===r.layer&&x.action==='clash_tomb_candidate'));
        add(r,touchesStore?'clash_tomb_candidate':'clash_move_candidate',{
          detail:touchesStore?`${r.detail}；冲到当前墓库，只生成“冲墓候选”，不可直接写开库。`:`${r.detail}；原书需继续辨冲动、冲旺、冲出、冲去、冲破/冲凶，当前证据不足时默认只记“冲动候选”。`,
          alternatives:touchesStore?['冲开候选','冲出候选','破库候选','仅扰动']:['冲动','冲旺','冲出','冲去','冲破','冲凶'],source_rule:touchesStore?'BLIND-TOMB-CLASH-DISPUTED':'BLIND-CLASH-SEMANTICS-001'
        });
      }else if(r.type==='combine'){
        add(r,'combine_candidate',{detail:`${r.detail}；太岁合原局不能统一翻译成“合绊”，需辨合留、合动、合绊、合去、合伤。`,alternatives:['合留','合动','合绊','合去','合伤'],source_rule:'BLIND-COMBINE-SEMANTICS-001'});
      }else if(r.type==='dark_combine'){
        add(r,'dark_combine_candidate',{detail:`${r.detail}；暗合只确认藏干层存在暗合联系，不等同六合，不自动推出合留/合去或吉凶。`,alternatives:['暗中关联','暗中牵动','合制候选'],source_rule:'BLIND-DARK-COMBINE-001'});
      }else if(r.type==='half_harmony'){
        add(r,'half_harmony_candidate',{detail:`${r.detail}；半合只确认三合体系已有两支呼应，力度低于完整三合，不自动视为成局或化局。`,alternatives:['半合牵动','等待第三支补齐'],source_rule:'BLIND-HALF-HARMONY-001'});
      }else if(r.type==='arch_harmony'){
        add(r,'arch_harmony_candidate',{detail:`${r.detail}；拱局只确认两佐神存在拱中神的组合线索，不自动把虚神当实字使用。`,alternatives:['拱局牵动','第三支到位后成局'],source_rule:'BLIND-ARCH-HARMONY-001'});
      }else if(r.type==='harm'){
        add(r,'wear_damage_candidate',{detail:`${r.detail}；穿/害先记破坏、穿倒候选，不单凭一条穿直接下重大事件。`,source_rule:'BLIND-WEAR-SEMANTIC-001'});
      }else if(r.type==='break'){
        add(r,'break_symbolic_disruption',{detail:`${r.detail}；盲派核心“破”以子卯、卯午为主，主要表无情、破坏、废弃、破耗等象，默认不当作独立做功完成。`,source_rule:'BLIND-BREAK-CORE-001'});
      }else if(r.type==='punish'){
        add(r,'punish_candidate',{detail:`${r.detail}；刑需结合位置、力量及是否三刑成组，不机械等于刑灾。`,source_rule:'BLIND-PUNISH-CORE-001'});
      }else if(r.type==='generate'||r.type==='control'){
        add(r,r.type==='generate'?'dayun_generate_context':'dayun_control_context',{status:'context',detail:`${r.detail}；生克可参与大运阶段判断，但本身不是具体流年事件结论。`,source_rule:'BLIND-DAYUN-SHENGKE-001'});
      }
    }
    const {dy,ln,activeComponent,crossRelation}=context||{};
    if(ln&&dy&&crossRelation){
      if(crossRelation==='clash'){
        const activeChar=activeComponent==='stem'?dy.heavenly_stem:dy.earthly_branch;
        const inactiveChar=activeComponent==='stem'?dy.earthly_branch:dy.heavenly_stem;
        const incoming=activeComponent==='stem'?ln.earthly_branch:ln.heavenly_stem;
        add(null,activeComponent==='stem'?'clash_activate_inactive_dayun':'clash_activate_inactive_dayun',{layer:'liunian',raw_type:'clash_dayun_cross_phase',status:'fact',affects_role:'dayun_context',detail:`流年${incoming}冲非当运部分${inactiveChar}，按盲派体用先取“冲起/提前引动”语义，不直接判凶。`,source_rule:'BLIND-DAYUN-CROSS-PHASE-001'});
      }else if(crossRelation==='combine'){
        add(null,'combine_activate_dayun',{layer:'liunian',raw_type:'combine_dayun_cross_phase',status:'fact',affects_role:'dayun_context',detail:'流年与非当运的大运部分发生合，先按“合动/提前引动”处理，再回到整柱大运与原局解释。',source_rule:'BLIND-DAYUN-CROSS-PHASE-001'});
      }
    }
    if(ln&&dy){
      const directActiveRel=activeComponent==='stem'?pairKey(ln.heavenly_stem,dy.heavenly_stem):pairKey(ln.earthly_branch,dy.earthly_branch);
      const activeIsStem=activeComponent==='stem';
      const isClash=activeIsStem?STEM_CLASHES.has(directActiveRel):BRANCH_CLASHES.has(directActiveRel);
      const isCombine=activeIsStem?STEM_COMBINES.has(directActiveRel):BRANCH_COMBINES.has(directActiveRel);
      if(isClash)add(null,'clash_active_dayun_candidate',{layer:'liunian',raw_type:'clash_active_dayun',status:'candidate',affects_role:'dayun_context',detail:`流年冲当前当运${activeIsStem?'运干':'运支'}，核心资料先允许“冲去/暂时离开”候选，但是否为凶仍须看原局。`,alternatives:['冲去','暂时失效','冲动'],source_rule:'BLIND-DAYUN-ACTIVE-CLASH-001'});
      if(isCombine)add(null,'combine_activate_active_dayun',{layer:'liunian',raw_type:'combine_active_dayun',status:'fact',affects_role:'dayun_context',detail:'流年合当前大运，先按合动处理；整柱大运仍需回接原局。',source_rule:'BLIND-DAYUN-ACTIVE-COMBINE-001'});
    }
    return out;
  }

  private resolveCurrentLiuYue(flowYear:number,nowClock:number):any{
    const p=new LocalPaipan(),branches=['寅','卯','辰','巳','午','未','申','酉','戌','亥','子','丑'],terms=['立春','惊蛰','清明','立夏','芒种','小暑','立秋','白露','寒露','立冬','大雪','小寒'];
    const yearStemIndex=((flowYear-4)%10+10)%10,tigerStart=[2,4,6,8,0][yearStemIndex%5];
    for(let i=0;i<12;i++){
      const sy=i===11?flowYear+1:flowYear,ey=i>=10?flowYear+1:flowYear,startParts=p.getSolarTermParts(sy,terms[i]),endParts=p.getSolarTermParts(ey,i===11?'立春':terms[i+1]);
      if(!startParts||!endParts)continue;
      const st=this.partsClockNumber(startParts),en=this.partsClockNumber(endParts);
      if(nowClock>=st&&nowClock<en){const stem=p.ctg[(tigerStart+i)%10],branch=branches[i];return {pillar:stem+branch,heavenly_stem:stem,earthly_branch:branch,start_event:this.termPartsEvent(terms[i],startParts),end_event:this.termPartsEvent(i===11?'立春':terms[i+1],endParts),rule:'以节令交接为流月边界，不按公历月初或农历初一切换'};}
    }
    return null;
  }
  private termPartsEvent(term:string,parts:number[]):any{const fmt=(p:number[])=>`${String(p[0]).padStart(4,'0')}-${String(p[1]).padStart(2,'0')}-${String(p[2]).padStart(2,'0')} ${String(p[3]||0).padStart(2,'0')}:${String(p[4]||0).padStart(2,'0')}:${String(p[5]||0).padStart(2,'0')}`;return {term,window_start:fmt(parts),event_start_parts:[...parts],precision:'exact_solar_term',time_basis:'solar_term'};}
  private getChinaClockParts(date:Date):number[]{
    const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),parts:any={};
    for(const p of f.formatToParts(date))if(p.type!=='literal')parts[p.type]=p.value;
    return [Number(parts.year),Number(parts.month),Number(parts.day),Number(parts.hour),Number(parts.minute),0];
  }
  private partsClockNumber(p:number[]):number{return (((((p[0]*100+p[1])*100+p[2])*100+p[3])*100+p[4])*100+(p[5]||0));}
  private parseLocalClock(v:string):number{const m=/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(String(v||''));return m?this.partsClockNumber(m.slice(1).map(Number).concat([0])):0;}
  private luckRelationLabel(type:string):string{return ({same_char:'同字并临',combine:'合',dark_combine:'暗合',half_harmony:'半合',arch_harmony:'拱局',clash:'冲',harm:'穿',break:'破',punish:'刑',generate:'生',control:'克',tomb_reach:'入墓候选',tonglu_appearance:'通禄到位',yuanshen_appearance:'原身到位',same_stem_appearance:'同干到位',same_branch_appearance:'同支到位',hidden_stem_manifestation:'藏干透出',hidden_form_appearance:'藏干形态到位',half_lu_candidate:'半禄候选',tomb_qi_representative:'墓气代表候选',residual_qi_representative:'余气代表候选'} as any)[type]||type;}
  private resolveBlindDaXian(chart:any,currentYear:number):any{
    const birthYear=Number(chart?.birth_year||0),rule=chart?.blind_daxian;if(!birthYear||!rule?.available)return {available:false,current_virtual_age:null,candidates:[],note:'缺少出生年份，不生成大限阶段'};
    const age=currentYear-birthYear+1,cands=(rule.ranges||[]).filter((r:any)=>age>=Number(r.start_age||0)&&(r.end_age==null||age<=Number(r.end_age)));
    return {available:true,current_virtual_age:age,candidates:cands,primary:cands[cands.length-1]||null,note:rule.note||'大限只作原局应期背景，不替代大运流年。'};
  }

  buildEvidenceTrace(facts, relations, semantics, roots, intents, qishi, ranked, mainline, timing, realityState:any=null, chartZhengFan:any=null, symbolGraph:any=null) {
    const out = [];
    const push = (type, title, details, ruleIds = []) => out.push({ id: `E${String(out.length + 1).padStart(3, "0")}`, type, title, details: details.filter(Boolean), rule_ids: ruleIds });
    if (mainline.primary) {
      const p = mainline.primary;
      push("mainline", "第一做功主线", [p.title, statusLabel(p.status), `做功层级 ${p.gong_level || "—"}`, `做功方向 ${p.gongDirection || "—"}`, ownershipLabel(p.ownership?.result), p.rawReason], uniq(["MAINLINE-ARBITER-001", p.ruleId]));
      const relTexts = (p.relationIds || []).map(id => {
        const r = relations.find(x => x.id === id); if (!r) return "";
        const ns = r.nodes.map(nid => facts.byId[nid]).filter(Boolean).map(simpleNodeLabel).join(" ↔ ");
        return `${r.type}: ${ns}`;
      });
      push("relation", "主线关系依据", relTexts, p.relationIds || []);
      const own = p.ownership;
      if (own) push("ownership", "成果归属", own.reasonChain || [], ["OWNERSHIP-001"]);
      const st=p.settlement;
      if(st) push("settlement","做功结算",[
        `结构资格：${st.eligibility}`,`完成度：${st.completion}`,`执行方式：${st.executionMode}`,
        `目标结算：${(st.targetResolutions||[]).map((x:any)=>`${facts.byId[x.targetId]?.char||x.targetId}=${x.state}`).join('、')||'—'}`,
        `残余目标：${(st.residualTargetIds||[]).length}`,`结果完整性：${st.resultIntegrity}`,
        `相对功量：${st.magnitude?.band||'none'} · ${st.magnitude?.contributionCount||0} 个独立结果`,
        `效率：${st.efficiency?.class||'unknown'}`,`方向一致性：${st.alignment||'unknown'}`,
        p.book_entry?`书本入手：${p.book_entry.kind} · ${p.book_entry.reason}`:'',
        p.dynamic_tiyong?`动态体用：${(p.dynamic_tiyong.nodes||[]).map((x:any)=>`${facts.byId[x.nodeId]?.char||x.nodeId}=${x.role}`).join('、')}`:''
      ],["GONG-SETTLEMENT-V25-001"]);
    }
    if (qishi.dominant || qishi.book_party?.dominant) push("qishi", "气势/党势辅助", [
      qishi.dominant?`${qishi.dominant.elements.join("、")}为旧兼容层加权优势气势`:'',
      qishi.book_party?.dominant?`书本党势：${qishi.book_party.dominant.label} · ${qishi.book_party.dominant.formation} · 目标=${(qishi.book_party.dominant.targetKinds||[]).join('、')||'—'}`:'',
      qishi.book_party?.dominant?.gateBasis?`成势门：${qishi.book_party.dominant.gateBasis}`:''
    ], ["QISHI-001","BLIND-PARTY-QISHI-001"]);
    if (realityState?.original?.length) push("reality_state", "原局虚实状态", realityState.original.map((x:any)=>`${PILLAR_LABEL[x.pillar]||x.pillar}${x.pair}：${x.state==='real'?'实':x.state==='virtual'?'虚':'未定'}`), ["REALITY-60-JIAZI-001"]);
    if (chartZhengFan?.status && chartZhengFan.status!=='unclear') push("chart_zheng_fan", "全局正反局仲裁", [
      `正式结论：${chartZhengFan.status==='zheng'?'正局':chartZhengFan.status==='fan'?'反局候选':'方向混合'}`,
      chartZhengFan.candidate_status?`V2独立候选：${chartZhengFan.candidate_status} · support=${chartZhengFan.support_score||0} / conflict=${chartZhengFan.conflict_score||0}`:'',
      chartZhengFan.source_governed?`来源治理：启用${chartZhengFan.source_disagreement?' · 与候选存在张力':''}`:'来源治理：未锁定',
      ...(chartZhengFan.axes||[]).map((x:any)=>`${x.id} [${x.direction}] ${(x.evidence||[]).join('；')}`)
    ], uniq((chartZhengFan.axes||[]).map((x:any)=>x.id)));
    const symbolPassed=(symbolGraph?.edges||[]).filter((x:any)=>x.gate==='passed');
    if(symbolPassed.length)push("symbol_graph","象法关系图",symbolPassed.slice(0,10).map((x:any)=>`${x.type}：${(x.nodes||[]).map((id:string)=>facts.byId[id]?.char||id).join('↔')}`),uniq(symbolPassed.map((x:any)=>x.rule_id)));
    if (timing.available) {
      push("timing", "当前岁运", [timing.dayun?.pillar ? `大运 ${timing.dayun.pillar}` : "", timing.liunian?.ganzhi ? `流年 ${timing.liunian.year} ${timing.liunian.ganzhi}` : "", timing.liuyue?.pillar ? `流月 ${timing.liuyue.pillar}` : "", ...timing.triggers.map(t => t.detail)], ["TIMING-001"]);
      if(timing.stage_gate)push("timing_gate","大运阶段门",[timing.stage_gate.status,timing.stage_gate.note,...(timing.stage_gate.evidence||[])],["BLIND-DAYUN-STAGE-GATE-001"]);
      if(timing.state_replay?.available){
        const sr=timing.state_replay;
        push("state_replay","第一主功状态重演",[
          `原局：${sr.original?.title||'—'} · ${sr.original?.status||'—'}`,
          sr.dayun?`大运：${sr.dayun.state}`:'',sr.liunian?`流年：${sr.liunian.state}`:'',sr.liuyue?`流月：${sr.liuyue.state}`:'',
          ...(sr.liunian?.evidence||sr.dayun?.evidence||[]).slice(0,5)
        ],["BLIND-STATE-REPLAY-001"]);
      }
      const rootChanges=(timing.root_state_snapshot?.states||[]).filter((x:any)=>x.changed);
      if(rootChanges.length)push("root_state","岁运根气状态",rootChanges.map((x:any)=>`${x.stemChar}：${x.original_capacity} → ${x.current_capacity}`),["BLIND-ROOT-STATE-REPLAY-001"]);
      const selectedIds=(timing.identity_resolutions||[]).flatMap((x:any)=>(x.selected||[]));
      if(selectedIds.length)push("timing_identity","岁运身份解析",selectedIds.map((x:any)=>`${this.luckLayerName(x.layer)}：${x.detail} [${x.evidence_grade}]`),uniq(selectedIds.map((x:any)=>x.source_rule)));
      if(timing.fan_ke_wei_zhu?.qualified)push("timing_identity","反客为主",[timing.fan_ke_wei_zhu.note,...(timing.fan_ke_wei_zhu.claims||[]).map((x:any)=>x.detail)],["BLIND-FAN-KE-WEI-ZHU-001"]);
      const timingSem=(timing.timing_relation_semantics||[]).filter((x:any)=>x.layer==='liunian');
      if(timingSem.length)push("timing_semantic","岁运关系语义",timingSem.map((x:any)=>`${x.semantic}：${x.detail}`),uniq(timingSem.map((x:any)=>x.source_rule)));
      const tombEvidence=(timing.tomb_states||[]).filter((x:any)=>x.relevant);
      const tombActions=(timing.tomb_state_snapshot?.store_actions||[]).filter((x:any)=>x.relevant);
      if(tombEvidence.length||tombActions.length)push("tomb_state","墓库当前状态",[...tombEvidence.map((x:any)=>x.detail),...tombActions.map((x:any)=>x.detail)],uniq([...tombEvidence,...tombActions].map((x:any)=>x.source_rule)));
    }
    return out;
  }

  buildWarnings(chart, facts, mainline) {
    const out = [];
    if (!mainline.primary) out.push("未形成足够清晰的第一做功主线，系统已保守降级。 ");
    if (chart?.input_mode === "pillars" && !(chart.da_yun || []).some(d => d.start_year)) out.push("四柱直排缺少完整出生年份/起运信息，当前岁运与具体流年不参与判定。 ");
    out.push("v2.5.5 在 v2.5.4 书本程序化基础上修正合用入口、效率定级、工具入墓与复合父链越级问题；做功链成立、效率、成果归属、正反局方向继续严格分层。争议规则保留来源等级，不以工程猜测伪装成定论。 ");
    return out;
  }

  buildPresentation(result, chart) {
    const p = result.mainline.primary;
    const byId = result.facts.nodes.reduce((m, n) => (m[n.id] = n, m), {});
    const actor = byId[p?.actorNodes?.[0]], target = byId[p?.targetNodes?.[0]], bridge = byId[p?.bridgeNodes?.[0]], final = byId[p?.resultNodes?.[p?.resultNodes?.length - 1]];
    const timing = result.timing;
    const replayState=timing.state_replay?.liunian?.state||timing.state_replay?.dayun?.state||null;
    const replayLabel=({maintained:'主功维持',stage_engaged:'主功进入应验阶段',strengthened_candidate:'主功承载增强候选',altered_candidate:'主功结构改变候选',transformed_candidate:'组合结构改变候选'} as any)[replayState]||'';
    const timingText = !timing.available ? "当前岁运未参与" : timing.stage_gate?.engaged===false ? "当前大运尚未承接主线，流年只保留应期线索" : timing.fan_ke_wei_zhu?.qualified ? `${replayLabel?replayLabel+' · ':''}当前流年形成反客为主身份候选，仍需回接原局裁决` : timing.effect === "identity_triggered" ? `${replayLabel?replayLabel+' · ':''}当前流年出现明确身份应期线索` : timing.effect === "state_changed" ? `${replayLabel||'主功状态已变化'}，具体吉凶仍按冲合语义、宾主与归属裁决` : timing.effect === "activated" ? `${replayLabel?replayLabel+' · ':''}当前流年已引动主线关系，具体属于冲动、冲去、合留等需继续裁决` : timing.effect === "stage_context" ? `${replayLabel?replayLabel+' · ':''}当前大运已承接主线，流年尚未形成足够直接的应期语义` : replayLabel || "当前岁运暂未形成明确应期结论";
    const summary = p ? this.pathSummary(p, actor, target, bridge, final) : "当前命局没有形成足够清晰的做功闭环，系统不强行套格局。";
    const st=p?.settlement||null;
    const completionLabel=({complete:'做功完成',partial:'部分完成',acting:'正在作用',none:'未形成结算',broken:'结构已破',counterproductive:'作用反向'} as any)[st?.completion]||'完成度未判';
    const efficiencyLabel=st?.efficiency?.grade==='high'?'效率较高':st?.efficiency?.grade==='medium'?'效率中等':st?.efficiency?.grade==='low'?'效率偏低':({matched:'效率已定级',underutilized:'效率偏低',overloaded:'目标过重',unknown:'效率暂不定级'} as any)[st?.efficiency?.class]||'效率暂不定级';
    const magnitudeLabel=({none:'未形成独立成果',small:'单一独立成果',medium:'双重独立成果',large:'多重独立成果',very_large:'高复合独立成果'} as any)[st?.magnitude?.band]||'功量未判';
    return {
      title: p?.title || "命局意向尚未形成闭环",
      type_label: p ? typeLabel(p.type) : "保守判定",
      status_label: p ? statusLabel(p.status) : "待校验",
      gong_level_label: p?.gong_level || "L0",
      structure_level_label: st?.structureLevel || p?.gong_level || "L0",
      completion_label: completionLabel,
      execution_mode_label: st?.executionMode || 'unknown',
      residual_label: st ? `${st.residualTargetIds?.length||0} 个残余目标` : '残余未判',
      efficiency_label: efficiencyLabel,
      magnitude_label: magnitudeLabel,
      alignment_label: st?.alignment || 'unknown',
      summary,
      actor: actor ? { id: actor.id, label: simpleNodeLabel(actor), position: nodePositionLabel(actor) } : null,
      target: target ? { id: target.id, label: simpleNodeLabel(target), position: nodePositionLabel(target) } : null,
      bridge: bridge ? { id: bridge.id, label: simpleNodeLabel(bridge), position: nodePositionLabel(bridge) } : null,
      result: final ? { id: final.id, label: simpleNodeLabel(final), position: nodePositionLabel(final) } : null,
      ownership_label: p ? ownershipLabel(p.ownership?.result) : "归属未判",
      gong_direction_label: p?.gongDirection === "forward" ? "正向做功 · 主取宾" : p?.gongDirection === "reverse" ? "反向做功 · 宾制主用" : p?.gongDirection === "internal" ? "主位内部做功" : p?.gongDirection === "external" ? "宾位外部作用" : "主客混合作用",
      zheng_fan_label: result.chart_zheng_fan?.status === "zheng" ? "全局方向一致 · 正局" : result.chart_zheng_fan?.status === "fan" ? "全局方向冲突 · 反局候选" : result.chart_zheng_fan?.status === "mixed" ? "全局方向混合 · 需仲裁" : p?.zhengFan === "zheng" ? "主线与命主意向同向" : p?.zhengFan === "fan" ? "主线存在反局风险" : "正反局暂不强判",
      timing_label: timingText,
      qishi_label: result.qishi.dominant ? `${result.qishi.dominant.elements.join("、")}气势较集中` : "未形成单一强势",
      secondary: result.mainline.secondary ? { title: result.mainline.secondary.title, type_label: typeLabel(result.mainline.secondary.type), status_label: statusLabel(result.mainline.secondary.status) } : null,
      evidence_count: result.evidence.length,
      engine_note: "v2.5 Gong Settlement 确定性规则引擎 · 不依赖 AI 生成主线"
    };
  }

  pathSummary(path, actor, target, bridge, final) {
    const own = ownershipLabel(path.ownership?.result);
    if (path.type === "sheng_yong") return `${simpleNodeLabel(actor)}向${simpleNodeLabel(target)}形成真实相生，属于“食伤生财”路径；${own}。`;
    if (path.type === "zhi_yong") return `${simpleNodeLabel(actor)}对${simpleNodeLabel(target)}形成真实克制，当前按“${path.title}”识别；${own}。`;
    if (path.type === "he_yong") return `${simpleNodeLabel(actor)}直接合到${simpleNodeLabel(target)}，命主与目标存在直接取得/连接意向；${own}。`;
    if (path.type === "hua_yong") return `${simpleNodeLabel(actor)}经${simpleNodeLabel(bridge)}向主位转化，形成连续的官杀—印—主位路径；${own}。`;
    if (path.type === "mu_yong") {
      if (path.tombFact) return `${(path.targetNodes||[]).length>1?`${(path.targetNodes||[]).length}处同类对象`:simpleNodeLabel(target)}已满足有效入墓事实，由${simpleNodeLabel(actor)}承担收取/收藏作用；是否为吉、是否真正归主仍需结合宾主与后续开闭判断。`;
      return `${simpleNodeLabel(target)}与对应墓库仅形成候选关系，“入墓、开闭、归属”仍按条件式处理，不直接等同得失。`;
    }
    if (path.type === "composite") return `多条作用在同一节点衔接成复合做功，主线不是单一十神口诀，而是连续作用的结果；${own}。`;
    if (path.type === "xie_yong") return `${simpleNodeLabel(actor)}向${simpleNodeLabel(target)}形成输出，当前更接近“泄秀/表达”而非直接取财；${own}。`;
    return "当前以象法辅助理解，不强行把单一符号扩展为现实事件。";
  }
}
