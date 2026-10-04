'use strict';
const fs=require('node:fs');
const path=require('node:path');
const OLD_ROOT=process.env.V254_ROOT||'/mnt/data/v254_current/zhenyi-bazi-paipan-v2.5.4-book-validated';
const {LocalChartAdapter:OldAdapter}=require(path.join(OLD_ROOT,'dist/core/LocalChartAdapter'));
const {BlindJudgmentEngine:OldEngine}=require(path.join(OLD_ROOT,'dist/core/judgment/BlindJudgmentEngine'));
const {LocalChartAdapter:NewAdapter}=require('../dist/core/LocalChartAdapter');
const {BlindJudgmentEngine:NewEngine}=require('../dist/core/judgment/BlindJudgmentEngine');
const stems=[...'甲乙丙丁戊己庚辛壬癸'],branches=[...'子丑寅卯辰巳午未申酉戌亥'],monthBranches=[...'寅卯辰巳午未申酉戌亥子丑'];
const jz=Array.from({length:60},(_,i)=>stems[i%10]+branches[i%12]);
const monthStart={甲:'丙',己:'丙',乙:'戊',庚:'戊',丙:'庚',辛:'庚',丁:'壬',壬:'壬',戊:'甲',癸:'甲'},hourStart={甲:'甲',己:'甲',乙:'丙',庚:'丙',丙:'戊',辛:'戊',丁:'庚',壬:'庚',戊:'壬',癸:'壬'};
function stemAt(start,offset){return stems[(stems.indexOf(start)+offset)%10];}
let seed=Number(process.env.V255_DIFF_SEED||0x255c0de)>>>0;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}function pick(a){return a[Math.floor(rnd()*a.length)];}
function legal(){const y=pick(jz),d=pick(jz),mi=Math.floor(rnd()*12),hi=Math.floor(rnd()*12);return [y,stemAt(monthStart[y[0]],mi)+monthBranches[mi],d,stemAt(hourStart[d[0]],hi)+branches[hi]];}
function make(adapter,p,gender){const [year,month,day,hour]=p;return adapter.computeFromPillars({id:0,name:'diff',gender,input_mode:'pillars',direct_pillars:{year,month,day,hour},direct_birth_year:'',direct_qiyun_year:'',direct_qiyun_month:'',birth_region:'diff'});}
function structuralKey(j){const p=j.mainline?.primary;if(!p)return null;return [p.type||'',p.actionMode||'', [...(p.actorNodes||[])].sort().join(','),[...(p.targetNodes||[])].sort().join(','),[...(p.resultNodes||[])].sort().join(',')].join('|');}
function title(j){return j.mainline?.primary?.title||'none';}
function eff(j){const e=j.mainline?.primary?.settlement?.efficiency;return e?.grade||e?.state||e?.class||'none';}
function align(j){const a=j.mainline?.primary?.settlement?.alignment;return (typeof a==='string'?a:a?.state)||'none';}
function actorPos(j){const p=j.mainline?.primary;if(!p||p.type!=='he_yong')return 'non_he_yong';const ids=p.actorNodes||[];if(ids.some(x=>x==='original.day.stem'))return 'day_stem';if(ids.some(x=>x==='original.day.branch'))return 'day_branch';if(ids.some(x=>x?.startsWith('original.hour.')))return 'hour';if(ids.some(x=>x?.startsWith('original.month.')||x?.startsWith('original.year.')))return 'year_month';return 'other';}
function inc(o,k){o[k]=(o[k]||0)+1;}
function reason(o,n){const op=o.mainline?.primary,np=n.mainline?.primary;if(!op&&np)return 'NEW_VALID_PRIMARY';if(op&&!np)return 'OLD_PRIMARY_REMOVED';if(op?.type==='he_yong'&&np?.type!=='he_yong')return 'HE_YONG_SCOPE_NARROWED';if(op?.type==='mu_yong'&&np?.type!=='mu_yong')return 'TOOL_BURIAL_GATE';if(np?.type==='compound')return 'COMPOUND_COMPLETE_GATE';if(op?.type!==np?.type)return 'PRIMARY_TYPE_REARBITRATION';if(op?.actionMode!==np?.actionMode)return 'ACTION_MODE_REARBITRATION';return 'MAINLINE_REARBITRATION';}
const N=Number(process.env.V255_DIFF_N||10000),oldA=new OldAdapter(),newA=new NewAdapter(),oldE=new OldEngine(),newE=new NewEngine();
const r={version:'2.5.5-algorithm-correction',baseline:'2.5.4-book-validated',charts:N,seed,structuralPrimaryChanged:0,labelOnlyChanged:0,formalZhengFanChanged:0,frozenDirectionComparable:0,frozenDirectionChanged:0,oldNoPrimary:0,newNoPrimary:0,oldEfficiency:{},newEfficiency:{},oldAlignment:{},newAlignment:{},oldHeYongActors:{},newHeYongActors:{},reasonCounts:{},examples:[],zfExamples:[]};
for(let i=0;i<N;i++){
 const ps=legal(),g=rnd()<.5?'male':'female';const o=oldE.analyze(make(oldA,ps,g)),n=newE.analyze(make(newA,ps,g));
 const ok=structuralKey(o),nk=structuralKey(n);if(!ok)r.oldNoPrimary++;if(!nk)r.newNoPrimary++;
 if(ok!==nk){r.structuralPrimaryChanged++;const rc=reason(o,n);inc(r.reasonCounts,rc);if(r.examples.length<50)r.examples.push({pillars:ps,gender:g,reason:rc,old:{title:title(o),type:o.mainline?.primary?.type,action:o.mainline?.primary?.actionMode,efficiency:eff(o)},new:{title:title(n),type:n.mainline?.primary?.type,action:n.mainline?.primary?.actionMode,efficiency:eff(n)}});} else if(title(o)!==title(n)){r.labelOnlyChanged++;}
 inc(r.oldEfficiency,eff(o));inc(r.newEfficiency,eff(n));inc(r.oldAlignment,align(o));inc(r.newAlignment,align(n));inc(r.oldHeYongActors,actorPos(o));inc(r.newHeYongActors,actorPos(n));
 const oz=o.chart_zheng_fan?.status||'none',nz=n.chart_zheng_fan?.status||'none';if(oz!==nz){r.formalZhengFanChanged++;if(r.zfExamples.length<30)r.zfExamples.push({pillars:ps,old:oz,new:nz,source:n.chart_zheng_fan?.source_status||null,candidate:n.chart_zheng_fan?.candidate_status||null});}
 const dc=n.chart_zheng_fan?.direction_context?.status||null;if(dc==='zheng'||dc==='fan'){r.frozenDirectionComparable++;if(nz!==dc)r.frozenDirectionChanged++;}
}
r.structuralPrimaryChangedRate=+(r.structuralPrimaryChanged/N).toFixed(4);r.labelOnlyChangedRate=+(r.labelOnlyChanged/N).toFixed(4);r.formalZhengFanChangedRate=+(r.formalZhengFanChanged/N).toFixed(4);
r.note='同盘结构差异审计。标题变化与第一主功结构变化分开统计；差异不等价于现实预测准确率。正式冻结正反方向不得被违规翻转。';
console.log(JSON.stringify(r,null,2));if(process.env.V255_DIFF_OUT){fs.mkdirSync(path.dirname(process.env.V255_DIFF_OUT),{recursive:true});fs.writeFileSync(process.env.V255_DIFF_OUT,JSON.stringify(r,null,2)+'\n');}
if(r.frozenDirectionChanged!==0)process.exitCode=2;
