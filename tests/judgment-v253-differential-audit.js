'use strict';
const fs=require('node:fs');
const path=require('node:path');
const OLD_ROOT=process.env.V252_ROOT||'/mnt/data/zhenyi-bazi-paipan-v2.5.2-original/zhenyi-bazi-paipan-v2.5.2-full-source';
const {LocalChartAdapter:OldAdapter}=require(path.join(OLD_ROOT,'dist/core/LocalChartAdapter'));
const {BlindJudgmentEngine:OldEngine}=require(path.join(OLD_ROOT,'dist/core/judgment/BlindJudgmentEngine'));
const {LocalChartAdapter:NewAdapter}=require('../dist/core/LocalChartAdapter');
const {BlindJudgmentEngine:NewEngine}=require('../dist/core/judgment/BlindJudgmentEngine');
const stems=[...'甲乙丙丁戊己庚辛壬癸'],branches=[...'子丑寅卯辰巳午未申酉戌亥'],monthBranches=[...'寅卯辰巳午未申酉戌亥子丑'];
const jz=Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]);
const monthStart={甲:'丙',己:'丙',乙:'戊',庚:'戊',丙:'庚',辛:'庚',丁:'壬',壬:'壬',戊:'甲',癸:'甲'},hourStart={甲:'甲',己:'甲',乙:'丙',庚:'丙',丙:'戊',辛:'戊',丁:'庚',壬:'庚',戊:'壬',癸:'壬'};
function stemAt(start,offset){return stems[(stems.indexOf(start)+offset)%10];}
let seed=Number(process.env.V253_DIFF_SEED||0x253b00c)>>>0;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}function pick(a){return a[Math.floor(rnd()*a.length)];}
function legal(){const y=pick(jz),d=pick(jz),mi=Math.floor(rnd()*12),hi=Math.floor(rnd()*12);return [y,stemAt(monthStart[y[0]],mi)+monthBranches[mi],d,stemAt(hourStart[d[0]],hi)+branches[hi]];}
function make(adapter,p,gender){const [year,month,day,hour]=p;return adapter.computeFromPillars({id:0,name:'diff',gender,input_mode:'pillars',direct_pillars:{year,month,day,hour},direct_birth_year:'',direct_qiyun_year:'',direct_qiyun_month:'',birth_region:'diff'});}
function pkey(j){const p=j.mainline?.primary;if(!p)return null;return [p.type||'',p.title||'',[...(p.actorNodes||[])].sort().join(','),[...(p.targetNodes||[])].sort().join(','),[...(p.resultNodes||[])].sort().join(',')].join('|');}
function label(j){const p=j.mainline?.primary;return p?`${p.title||p.type} [${p.id}]`:'none';}

function reasonCode(oldJ,newJ){
 const o=oldJ.mainline?.primary,n=newJ.mainline?.primary;
 if(!o&&n)return 'NEW_PRIMARY_FROM_BOOK_AUDIT';
 if(o&&!n)return 'PRIMARY_DOWNGRADED_TO_NO_EFFECTIVE_GONG';
 if(!n)return 'NO_PRIMARY';
 if(n.actionMode==='clash_take')return 'SOURCE_GATED_CLASH_TAKE';
 if(n.actionMode==='wear_control')return 'SOURCE_GATED_WEAR_CONTROL';
 if((n.unified_structures||[]).length||n.unified_structure)return 'UNIFIED_STRUCTURE_SCOPE';
 if(newJ.mainline?.co_primary)return 'CO_PRIMARY_PRESERVATION';
 if(o?.type==='xiang_fallback'&&n.type!=='xiang_fallback')return 'NEW_VALID_SETTLEMENT_PATH';
 if(o?.type!=='xiang_fallback'&&n.type==='xiang_fallback')return 'OLD_PATH_DOWNGRADED_BY_GATES';
 if(n.settlement?.partyProjection?.outwardTargetIds?.length)return 'PARTY_OUTWARD_PROJECTION';
 if(n.book_method?.entry||n.bookMethod?.entry||newJ.book_method?.entry)return 'BOOK_ENTRY_TIEBREAK';
 if(o?.type!==n.type)return 'SETTLEMENT_TYPE_REARBITRATION';
 return 'SETTLEMENT_MAINLINE_REARBITRATION';
}
const N=Number(process.env.V253_DIFF_N||5000), oldA=new OldAdapter(),newA=new NewAdapter(),oldE=new OldEngine(),newE=new NewEngine();
let primaryChanged=0, zfChanged=0, directionContextChanged=0, frozenComparable=0, frozenChanged=0, oldNoPrimary=0,newNoPrimary=0,newUnified=0,newCo=0;
const primaryTransitions={},zfTransitions={},dcTransitions={};
const primaryExamples=[],zfExamples=[],primaryDiffs=[],primaryReasonCounts={};
const start=Date.now();
for(let i=0;i<N;i++){
 const p=legal(),g=rnd()<.5?'male':'female';
 const o=oldE.analyze(make(oldA,p,g)),n=newE.analyze(make(newA,p,g));
 const ok=pkey(o),nk=pkey(n);
 if(!ok)oldNoPrimary++;if(!nk)newNoPrimary++;
 {const k=`${o.mainline?.primary?.title||'none'} => ${n.mainline?.primary?.title||'none'}`;primaryTransitions[k]=(primaryTransitions[k]||0)+1;}
 if(ok!==nk){primaryChanged++;const rc=reasonCode(o,n);primaryReasonCounts[rc]=(primaryReasonCounts[rc]||0)+1;const row={pillars:p,gender:g,old:label(o),new:label(n),reasonCode:rc};primaryDiffs.push(row);if(primaryExamples.length<20)primaryExamples.push({...row,newReason:n.mainline?.reason||''});}
 const oz=o.chart_zheng_fan?.status||null,nz=n.chart_zheng_fan?.status||null;{const k=`${oz} => ${nz}`;zfTransitions[k]=(zfTransitions[k]||0)+1;}if(oz!==nz){zfChanged++;if(zfExamples.length<20)zfExamples.push({pillars:p,old:oz,new:nz,candidate:n.chart_zheng_fan?.candidate_status,source:n.chart_zheng_fan?.source_status||null});}
 const odc=o.chart_zheng_fan?.direction_context?.status||null,dc=n.chart_zheng_fan?.direction_context?.status||null;{const k=`${odc} => ${dc}`;dcTransitions[k]=(dcTransitions[k]||0)+1;}if(odc!==dc)directionContextChanged++;if(dc==='zheng'||dc==='fan'){frozenComparable++;if(nz!==dc)frozenChanged++;}
 if((n.mainline?.primary?.unified_structures||[]).length||n.mainline?.primary?.unified_structure)newUnified++;if(n.mainline?.co_primary)newCo++;
}
const report={version:'2.5.4-book-validated',baseline:'2.5.2-full-source',charts:N,seed:Number(process.env.V253_DIFF_SEED||0x253b00c),primaryChanged,primaryChangedRate:+(primaryChanged/N).toFixed(4),primaryTransitions,primaryReasonCounts,primaryDiffs,zfFormalChanged:zfChanged,zfFormalChangedRate:+(zfChanged/N).toFixed(4),zfTransitions,directionContextChanged,directionContextChangedRate:+(directionContextChanged/N).toFixed(4),directionContextTransitions:dcTransitions,frozenDirectionComparable:frozenComparable,frozenDirectionChanged:frozenChanged,oldNoPrimary,newNoPrimary,newUnifiedPrimary:newUnified,newCoPrimary:newCo,elapsedMs:Date.now()-start,primaryExamples,zfExamples,note:'差异审计衡量算法行为变化，不等价于现实预测准确率。primaryDiffs 对全部主功变化给出机器 reasonCode；这些 reasonCode 是变更来源分类，不等价于逐盘人工正确性认证。冻结来源方向必须保持不翻转。'};
console.log(JSON.stringify(report,null,2));
if(process.env.V253_DIFF_OUT)fs.writeFileSync(process.env.V253_DIFF_OUT,JSON.stringify(report,null,2)+'\n');
if(frozenChanged!==0){console.error('ERROR: frozen source direction changed');process.exit(2);} 
