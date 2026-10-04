const fs = require('fs');
const assert = require('assert');

const home = fs.readFileSync('public/index.html','utf8');
const result = fs.readFileSync('public/result.html','utf8');
let passed = 0;
function ok(cond, msg){ assert.ok(cond, msg); passed++; console.log(`PASS ${passed}: ${msg}`); }

ok(home.includes('id="paipanLoading"'), '首页存在排盘 Loading 覆盖层');
ok(home.includes('setPaipanLoading(true)'), '提交前立即开启 Loading');
ok(home.includes("setPaipanLoading(false)"), '请求失败会关闭 Loading');
ok(home.includes("await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"), '先让浏览器绘制 Loading 再发起排盘请求');
ok(home.includes('命盘正在计算中，请勿关闭页面'), '慢请求有明确的二阶段提示');
ok(!/async function boot\(\)\{[\s\S]{0,220}await window\.ZHENYI_PREVIEW_ENGINE\?\.load\(\)/.test(result), '普通结果启动不等待 AI 预览规则');
ok(result.includes('ensureDeepPreviewRendered()'), 'AI 预览改为按需加载');
ok(!result.includes("$('flowHint').textContent=`${dy.pillar||'—'} → ${ln.ganzhi||'—'} → ${ly.pillar||'—'}`;renderDeepPreview(chartData)"), '专业岁运渲染不再隐式触发 AI 预览');
ok(result.includes('ensureProfessionalRendered()') && result.includes('ensureJudgmentRendered()'), '专业岁运与做功判盘具备延迟渲染门');
ok(result.includes("if(initial==='professional')ensureProfessionalRendered();else if(initial==='judgment')ensureJudgmentRendered();else if(initial==='deep')ensureDeepPreviewRendered()"), '直接打开指定结果页仍按需完成对应渲染');
console.log(`UI loading/performance tests: ${passed}/${passed} passed`);
