const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const {spawn}=require('node:child_process');
const path=require('node:path');

function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
function listen(server){return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));}
async function waitReady(port){for(let i=0;i<80;i++){try{const response=await fetch(`http://127.0.0.1:${port}/robots.txt`);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('App server did not start');}

async function main(){
  const calls=[];
  const model=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    calls.push({url:req.url,headers:req.headers,body:JSON.parse(raw)});
    if(calls.at(-1).body.messages[0]?.content?.startsWith('判断用户是否希望分析')){
      const source=calls.at(-1).body.messages[1].content;
      const intent=/看命|命盘|分析.*八字|出生/.test(source)?'case':'other';
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({intent})}}]}));
    }
    if(calls.at(-1).body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});return res.end('data: {"choices":[{"delta":{"content":"先看日主。"}}]}\n\ndata: [DONE]\n\n');}
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({id:'test',object:'chat.completion',model:'ZHENYI-test',choices:[{message:{content:'先看日主，再看做功主线。'}}]}));
  });
  const modelPort=await listen(model),appPort=await freePort();
  const root=path.resolve(__dirname,'..');
  const app=spawn(process.execPath,['dist/server.js'],{
    cwd:root,
    env:{...process.env,HOST:'127.0.0.1',PORT:String(appPort),ZHENYI_MODEL_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,ZHENYI_MODEL_NAME:'ZHENYI-test',ZHENYI_PUBLIC_MODEL_NAME:'ZHENYI',ZHENYI_MODEL_API_KEY:'local-test'},
    stdio:'ignore',
  });
  try{
    await waitReady(appPort);
    const analyze=async payload=>{
      const response=await fetch(`http://127.0.0.1:${appPort}/api/ai/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      return {status:response.status,body:await response.json()};
    };
    const fromText=await analyze({question:'乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。'});
    assert.equal(fromText.status,200,JSON.stringify(fromText.body));
    assert.equal(fromText.body.data.answer,'先看日主，再看做功主线。');
    assert.deepEqual(Object.values(fromText.body.data.chart.four_pillars),['甲子','甲戌','戊寅','庚申']);
    assert.equal(calls[0].url,'/v1/chat/completions');
    assert.equal(calls[0].headers.authorization,'Bearer local-test');
    assert.match(calls[0].body.messages[1].content,/甲子/);
    assert.ok(JSON.stringify(calls[0].body).length<20000,'Only compact chart facts should reach model');

    const chat=async payload=>fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const models=await fetch(`http://127.0.0.1:${appPort}/v1/models`);
    assert.equal((await models.json()).data[0].id,'ZHENYI');
    const direct=await chat({model:'ZHENYI',messages:[{role:'user',content:'乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。'}]});
    assert.equal(direct.status,200);
    assert.match((await direct.json()).choices[0].message.content,/日主/);
    assert.equal(calls.at(-1).body.messages[1].role,'system');
    assert.match(calls.at(-1).body.messages[1].content,/甲子/);
    assert.equal(calls.at(-1).body.messages[2].role,'user');

    const followup=await chat({model:'ZHENYI',messages:[{role:'user',content:'乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。'},{role:'assistant',content:'先看日主。'},{role:'user',content:'婚姻呢？'}]});
    assert.equal(followup.status,200);
    await followup.json();
    assert.match(calls.at(-1).body.messages[1].content,/甲子/);
    assert.equal(calls.at(-1).body.messages.at(-1).content,'婚姻呢？');

    const ordinary=await chat({model:'ZHENYI',messages:[{role:'user',content:'你好'}]});
    assert.equal(ordinary.status,200);
    await ordinary.json();
    assert.equal(calls.at(-1).body.messages.length,2);

    const missing=await chat({model:'ZHENYI',messages:[{role:'user',content:'帮我看命盘，我是1990年1月1日出生的'}]});
    assert.equal(missing.status,200);
    assert.match((await missing.json()).choices[0].message.content,/出生时间/);
    assert.equal(calls.at(-1).body.messages[0].content.startsWith('判断用户是否希望分析'),true);

    const filled=await chat({model:'ZHENYI',messages:[{role:'user',content:'帮我看命盘，我是1982年9月27日出生的'},{role:'assistant',content:'请补充出生时间和性别。'},{role:'user',content:'15:00，女，东经116.4'}]});
    assert.equal(filled.status,200,await filled.text());
    assert.match(calls.at(-1).body.messages[1].content,/1982-09-27/);

    const missingStream=await chat({model:'ZHENYI',stream:true,messages:[{role:'user',content:'请看命盘，只有生日1990年1月1日'}]});
    assert.equal(missingStream.status,200);
    assert.match(await missingStream.text(),/出生时间.*\[DONE\]/s);

    const birth=await chat({model:'ZHENYI',messages:[{role:'user',content:'公历1982年9月27日15:00，女，东经116.4。请分析。'}]});
    assert.equal(birth.status,200,await birth.text());
    assert.match(calls.at(-1).body.messages[1].content,/1982-09-27/);

    const stream=await chat({model:'ZHENYI',stream:true,messages:[{role:'user',content:'乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。'}]});
    assert.equal(stream.status,200);
    assert.match(stream.headers.get('content-type'),/text\/event-stream/);
    assert.match(await stream.text(),/\[DONE\]/);

    const fromProfile=await analyze({question:'请分析这张命盘。',paipan_input:{gender:'female',birthday:'1982-09-27',birth_time:'15:00',use_true_solar_time:false}});
    assert.equal(fromProfile.status,200,JSON.stringify(fromProfile.body));
    assert.equal(fromProfile.body.data.chart.input_mode,'datetime');

    const invalid=await analyze({question:'请分析这张命盘。'});
    assert.equal(invalid.status,422);
    const page=await fetch(`http://127.0.0.1:${appPort}/analyze.html`);
    assert.equal(page.status,200);
    assert.match(await page.text(),/发送命例/);
    console.log('AI integration: standard chat, follow-up, passthrough, streaming, profile and UI passed');
  }finally{
    app.kill();
    await new Promise(resolve=>model.close(resolve));
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
