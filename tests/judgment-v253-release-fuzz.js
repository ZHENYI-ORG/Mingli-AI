'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const node=process.execPath;
const root=path.resolve(__dirname,'..');
const coreSeeds=[391314814,825373492,1259434170,1693494848,2127555526];
const productSeeds=[632356846,1056517532,1480678218,1904838904,2328999590];
function run(file,env,label){
  console.log(`\n=== ${label} ===`);
  const r=spawnSync(node,[path.join(__dirname,file)],{cwd:root,env:{...process.env,...env},stdio:'inherit'});
  if(r.error)throw r.error;
  if(r.status!==0)process.exit(r.status||1);
}
coreSeeds.forEach((seed,i)=>run('judgment-v25-core-fuzz.js',{V25_CORE_FUZZ_N:'10000',V25_CORE_FUZZ_DOUBLE:'1000',V25_CORE_FUZZ_SEED:String(seed)},`core fuzz shard ${i+1}/5 seed=${seed}`));
productSeeds.forEach((seed,i)=>run('judgment-v25-fuzz.js',{V25_FUZZ_N:'1000',V25_FUZZ_DOUBLE:'100',V25_FUZZ_SEED:String(seed)},`product fuzz shard ${i+1}/5 seed=${seed}`));
run('judgment-v252-zhengfan-fuzz.js',{V252_ZF_FUZZ_N:'5000',V252_ZF_FUZZ_DOUBLE:'500'},'Chart/Stage ZhengFan fuzz 5000');
console.log('\nv2.5.5 release fuzz suite passed: 50,000 core + 5,000 product + 5,000 ZhengFan');
