'use strict';
const assert=require('node:assert/strict');
const {TrueSolarTimeCalculator}=require('../dist/core/TrueSolarTimeCalculator');

function pad(n){return String(n).padStart(2,'0');}
function dim(y,m){return [31,(y%400===0||(y%4===0&&y%100!==0))?29:28,31,30,31,30,31,31,30,31,30,31][m-1];}
const dates=[];
for(let i=0;i<100;i++){
  const y=1900+i, m=(i%12)+1;
  // 交替压月初/月末，并周期性覆盖闰年2月末。
  let d=(i%2===0)?1:dim(y,m);
  if(i%20===0){ const yy=2000+i; dates.push(`${yy}-02-${pad(dim(yy,2))}`); continue; }
  dates.push(`${y}-${pad(m)}-${pad(d)}`);
}
assert.equal(dates.length,100);
const longitudes=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,180];
const times=['00:00','00:01','11:59','12:00','22:59','23:59'];
let cases=0;
for(const date of dates)for(const longitude of longitudes)for(const time of times){
  const tz=Math.max(-12,Math.min(12,longitude/15));
  const a=TrueSolarTimeCalculator.calculate(date,time,longitude,tz);
  const b=TrueSolarTimeCalculator.calculate(date,time,longitude,tz);
  assert.deepEqual(a,b,`nondeterministic true-solar result ${date} ${time} ${longitude}`);
  assert.equal(a.parts.length,6); assert(Number.isFinite(a.offset_seconds));
  assert(TrueSolarTimeCalculator.isValidCivilDate(a.parts[0],a.parts[1],a.parts[2]));
  assert(a.parts[3]>=0&&a.parts[3]<=23&&a.parts[4]>=0&&a.parts[4]<=59&&a.parts[5]>=0&&a.parts[5]<=59);
  cases++;
}
// DST 重复时刻：必须明确标歧义并稳定选择较早一次。
const fall=TrueSolarTimeCalculator.calculate('2024-11-03','01:30',-74.006,'America/New_York');
assert.equal(fall.civil_time_ambiguous,true); assert((fall.civil_time_candidates||[]).length>=2); cases++;
// DST 跳时：不存在的民用时刻必须拒绝，不能静默修正。
assert.throws(()=>TrueSolarTimeCalculator.calculate('2024-03-10','02:30',-74.006,'America/New_York'),/不存在|夏令时跳时/); cases++;
assert.equal(cases,7202);
console.log(`True-solar/time boundary regression passed: ${cases}/${cases}`);
