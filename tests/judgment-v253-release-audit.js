'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'../src');
const production=[];
function walk(d){for(const ent of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,ent.name);if(ent.isDirectory())walk(p);else if(/\.(ts|js)$/.test(ent.name))production.push(p);}}
walk(root);
let hits=[];
for(const f of production){const text=fs.readFileSync(f,'utf8');for(const m of text.matchAll(/source-(?:duan|core|intermediate)-\d+/gi))hits.push({file:path.relative(root,f),token:m[0]});}
assert.deepEqual(hits,[],`production source contains case-id special casing: ${JSON.stringify(hits)}`);
const reg=JSON.parse(fs.readFileSync(path.join(root,'core/judgment/rules/book-rule-registry.json'),'utf8'));
assert.equal(reg.version,'2.5.5-algorithm-correction');
assert(new Set(reg.rules.map(r=>r.id)).size===reg.rules.length,'duplicate book rule id');
for(const r of reg.rules){assert(r.id&&r.area&&r.grade&&r.status&&r.statement,`incomplete rule registry row ${r.id||'unknown'}`);}
console.log(`v2.5.5 algorithm-correction release audit passed: ${production.length} source files scanned, ${reg.rules.length} book rules, 0 case-id production hacks`);
