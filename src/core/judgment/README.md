# 真一盲派做功判盘引擎

此模块只消费已经排好的 `chart`，不改动排盘算法。核心判断不依赖 LLM。

当前生产链：

`FactGraph → RelationFact → RelationSemantic → Guest/Host → TenGod Intent → QiShi → RealityState → DirectionContext → SymbolGraph → Gong Paths → Settlement → Mainline → ChartZhengFan V2 → Timing Replay → StageZhengFan → EvidenceTrace`

## 当前版本边界

已实现高确定性骨架；暗合只开放固定白名单并作为独立事实，争议暗冲、复杂换象、特殊墓法未通过白名单时不进入主判断。功量只用于内部序位，不输出财富金额或官阶硬映射。

## 关键原则

- 明透与藏干分层。
- Root / Origin / Ownership 不混为一谈。
- 体用属于路径角色，不是十神永久属性。
- 同一“冲/合”先记录事实，再按语境判断语义。
- 没有明确主线时允许保守降级，不强套格局。


## v1.8.0 Timing 规则

- Identity First：先解析岁运身份，再判断是否命中主线。
- 盲派专属刑/破 profile，不混用普通六破与自刑。
- 冲、合先解析语义，不直接映射吉凶或“完成/削弱”。
- 墓库按当前时间层重算 snapshot；历史 facts 仅审计。
- 未来年份不做关系数量评分。


## v1.9.0 State Replay / Root Strata

- 第一主功是岁运重演的主题锚点，岁运不允许凭空生成新的原局大事；
- `state_replay` 按大运→流年→流月累计重演同一主功；
- 普通大运生克只作背景，不单独打开重大应期门；
- 根气拆成坐下直接根/禄根、长生、墓库、余气与其它柱外援；
- `root_score` 已废弃，禁止用根气数量简单相加决定做功能力。


## v2.1.0 Tomb Arbitration / LiuYue Gate

- 入墓事实与墓用做功分离；比劫/禄根入墓不自动解释成取得。
- 多而墓之只确认事实，不额外增加主线排名权重；同墓多对象聚合，避免重复计功。
- 两级墓库只有两段都为事实入墓才允许继续传递成果归属。
- `liuyue_gate` 要求大运已承接、流年已有直接应期线索、本月再与日主或流年形成A级直接关联；流月始终只负责定位。


## v2.2.0 Timing Fact Scope

Timing 现在明确区分两种事实范围：

- `all_luck_relations`：全局客观关系，不参与重大结论自动升级；
- `luck_relations`：第一主功相关关系，供语义仲裁、阶段门与 State Replay 使用。

非主线身份仍可出现在 `identity_resolutions` 中用于审计，但不能直接进入 `triggers`。


## v2.3.0 Composite Link Replay

- 原局与岁运均独立记录暗合、半合、拱局，不把它们偷换成六合或完整三合；
- 暗合/半合/拱局属于客观关系事实，默认不能单独生成重大事件；
- 流年可叫起非当运的大运另一半，但被叫起的运字只从流年层参加后续关系与组合重演；
- `all_luck_relations` 会保留“流年 → 非当运运字 → 原局”的二段事实，重大结论仍受第一主功、阶段门和 State Replay 约束；
- 三合/三刑首次形成层级不可回写，formation / transformation / ownership / 吉凶继续分离。


## v2.4.0 RealityState / ChartZhengFan / SymbolGraph

### RealityState

- 使用冻结六十甲子表判断每一柱的 `real / virtual`；
- `RealityState` 与 `RootState` 是两个概念：前者描述柱内存在状态，后者描述做功能力与根气承载；
- 岁运只新增 `stage_manifestation_state`，不得回写原局；
- 虚→实、实→虚只作为应期状态事实，不能直接写吉凶。

### ChartZhengFan

- 新增独立 `chart_zheng_fan`，不再把 path-level `zhengFan` 当作完整正反局；
- 比较日主之意、日支动作、全局气势与年月/日时两党方向；
- 日主合年月官存在“管理外部”的独立口径，不机械追坐支判反；
- 年月与日时一冲一合只是反局候选，若实际控制方向一致可以仍判正局；
- 当前字段只作结构仲裁，`major_conclusion_allowed=false`。

### SymbolGraph

首版只事实化：

- `stem_combine_symbol_transfer`；
- `exchange_after_control` / `exchange_after_control_candidate`；
- `dai_xiang_candidate` / `dai_xiang_connected`；
- `borrow_lu_origin`；
- `borrow_same_element_candidate`。

普通相生/通禄的多跳图搜索只允许同柱/相邻；三合、半合、暗合、拱局、墓等结构关系可跨位连接。这样避免把任意远距离生克串成“与主位有关”。所有 SymbolEdge 默认不参与第一主功排序。

## v2.5.2 ChartZhengFan V2 / StageZhengFan

- `ChartZhengFan V2` 不再只看单条冲合，而以 v2.4 Direction Context 为前置事实，并读取第一主功的 Settlement、真实目标、独立控制边与结算结果。
- `Completion=partial` / `Residual>0` 只说明未做净，不自动判反局。
- `StageZhengFan` 只重演原局第一主功：破原控制边、保护/释放原目标属于反向证据；执行器增强、关键节点到位属于加强/修复候选。
- 原局与岁运正反局都只裁决结构方向，不直接输出现实灾福事件。

## v2.5.3 Book-Audited

- 书本入手法只负责识别意向与同级裁决，不能越过 Settlement 抢第一主功；
- 宾主宫位事实与当前功链归属分离，党势 / 通禄只能在证据成立时形成主方代理；
- Mainline v2 优先有效性、完成态、统局/党势控局范围、目标覆盖、独立功量、结果完整性与归属；真正同级保留 co-primary；
- `clash_take` / `wear_control` 恢复为来源门禁动作，并保留七杀冲日禄、无约束羊刃穿财反例门；
- ChartZhengFan 正式 `status` 与独立 `candidate_status` 分离，`SOURCE-GOLD-GUARD` 不再作为隐藏覆盖；
- StageZhengFan 改为原局→大运→流年→流月增量重演，累计事实只作审计；
- 争议技法全部机器注册，但 B/争议等级只进入 candidate / metadata，不伪装成生产定律。

详见 `docs/V2.5.3_BOOK_AUDIT.md` 与根目录 `FINAL-ACCEPTANCE.md`。
