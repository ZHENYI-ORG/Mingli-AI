import http from 'node:http';
import {AnalyzeError,chartContextFromMessage,inputFromMessage,systemPrompt} from './ZhenyiAnalyzer';

function error(res:http.ServerResponse,status:number,message:string){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:{message,type:'invalid_request_error',code:status}}));
}

function messageText(content:any):string {
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n');
  return '';
}

function clarification(source:string):string {
  const hasDate=/(?:18|19|20|21)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/.test(source);
  const hasTime=/\d{1,2}[:：时]\d{1,2}/.test(source);
  const pillars=[...source.matchAll(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g)];
  if(pillars.length>0&&pillars.length<4)return '请补齐年柱、月柱、日柱、时柱四组干支，并按这个顺序发送；有性别也请一并说明。';
  if(hasDate&&!hasTime)return '请补充出生时间（几点几分）和性别；有出生地经度也请一并提供，才能准确排盘。';
  if(hasDate&&hasTime&&!/(?:乾造|坤造|男命|女命|男性|女性|性别[:：]?[男女]|(?:^|[，,\s])[男女](?:[，,\s]|$))/.test(source))return '请再补充性别；如需按真太阳时排盘，也请提供出生地经度。';
  return '请提供完整命例：按年、月、日、时顺序给出四柱；或提供公历出生日期、几点几分、性别。有出生地经度也请一并发来。';
}

function answerDirectly(res:http.ServerResponse,model:string,content:string,stream:boolean){
  const id=`chatcmpl-zhenyi-${Date.now()}`,created=Math.floor(Date.now()/1000);
  if(stream){
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'});
    res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
    return;
  }
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
}

async function isCaseAnalysis(source:string,target:URL,model:string,headers:Record<string,string>):Promise<boolean>{
  const instruction='判断用户是否希望分析某个人的八字、四柱、命盘或运势。只回答 JSON：{"intent":"case"} 或 {"intent":"other"}。询问“什么是八字”等概念属于 other；要求看命、分析自己或某个命例、继续补充出生资料属于 case。不要推测或补造出生资料。';
  let response:Response;
  try{response=await fetch(target,{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'system',content:instruction},{role:'user',content:source.slice(-6000)}],temperature:0,max_tokens:50,stream:false}),signal:AbortSignal.timeout(45000)});}
  catch{throw new AnalyzeError('意图识别服务连接失败或超时',502);}
  if(!response.ok)throw new AnalyzeError(`意图识别服务返回 ${response.status}`,502);
  let payload:any;try{payload=await response.json();}catch{throw new AnalyzeError('意图识别服务返回格式无效',502);}
  const output=messageText(payload?.choices?.[0]?.message?.content);
  const found=/"intent"\s*:\s*"(case|other)"/.exec(output);
  if(!found)throw new AnalyzeError('意图识别结果格式无效',502);
  return found[1]==='case';
}

export function modelList(res:http.ServerResponse){
  const name=process.env.ZHENYI_PUBLIC_MODEL_NAME||'ZHENYI';
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({object:'list',data:[{id:name,object:'model',created:0,owned_by:'zhenyi'}]}));
}

export async function chatCompletion(req:http.IncomingMessage,res:http.ServerResponse,request:any){
  if(!request||!Array.isArray(request.messages)||request.messages.length===0)return error(res,400,'messages 必须是非空数组');
  const publicKey=process.env.ZHENYI_PUBLIC_API_KEY;
  if(publicKey&&req.headers.authorization!==`Bearer ${publicKey}`)return error(res,401,'API 密钥无效');
  const publicName=process.env.ZHENYI_PUBLIC_MODEL_NAME||'ZHENYI';
  if(request.model&&request.model!==publicName)return error(res,404,`模型 ${request.model} 不存在`);
  const base=(process.env.ZHENYI_MODEL_BASE_URL||'').replace(/\/+$/,'');
  const model=process.env.ZHENYI_MODEL_NAME||'';
  if(!base||!model)return error(res,503,'模型服务尚未配置');
  let target:URL;
  try{target=new URL(`${base}/chat/completions`);}
  catch{return error(res,503,'模型服务地址无效');}
  if(!['http:','https:'].includes(target.protocol))return error(res,503,'模型服务地址必须使用 HTTP 或 HTTPS');

  const messages=request.messages;
  const userTexts=messages.filter((item:any)=>item?.role==='user').map((item:any)=>messageText(item.content)).filter(Boolean);
  const allUserText=userTexts.join('\n');
  let chartContext='';
  for(let i=messages.length-1;i>=0;i--){
    const item=messages[i];
    if(item?.role!=='user')continue;
    const content=messageText(item.content);
    const hasMarker=/(?:四柱|八字|乾造|坤造)/.test(content);
    const pillars=[...content.matchAll(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g)];
    const hasBirthTime=/(?:18|19|20|21)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/.test(content)&&/\d{1,2}[:：时]\d{1,2}/.test(content);
    if(!hasBirthTime&&(!hasMarker&&pillars.length!==4))continue;
    if(!hasBirthTime&&pillars.length<4)continue;
    try{
      const input=inputFromMessage(content);
      if(input.birthday&&input.gender_unspecified)return answerDirectly(res,publicName,clarification(content),request.stream===true);
      chartContext=chartContextFromMessage(content);
    }
    catch(e:any){return error(res,e instanceof AnalyzeError?e.status:422,e?.message||'排盘失败');}
    break;
  }
  if(!chartContext&&userTexts.length>1){
    try{
      const input=inputFromMessage(allUserText);
      if(input.birthday&&input.gender_unspecified)return answerDirectly(res,publicName,clarification(allUserText),request.stream===true);
      chartContext=chartContextFromMessage(allUserText);
    }catch{/* Continue to intent classification and ask for missing details if needed. */}
  }
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(process.env.ZHENYI_MODEL_API_KEY)headers.Authorization=`Bearer ${process.env.ZHENYI_MODEL_API_KEY}`;
  if(!chartContext){
    let caseAnalysis:boolean;
    try{caseAnalysis=await isCaseAnalysis(allUserText,target,model,headers);}
    catch(e:any){return error(res,e instanceof AnalyzeError?e.status:502,e?.message||'意图识别失败');}
    if(caseAnalysis)return answerDirectly(res,publicName,clarification(allUserText),request.stream===true);
  }
  let prompt:string;
  try{prompt=systemPrompt();}catch(e:any){return error(res,503,e?.message||'系统提示词未配置');}
  const forwarded={...request,model,messages:[
    {role:'system',content:prompt},
    ...(chartContext?[{role:'system',content:chartContext}]:[]),
    ...messages,
  ]};
  let upstream:Response;
  try{upstream=await fetch(target,{method:'POST',headers,body:JSON.stringify(forwarded),signal:AbortSignal.timeout(180000)});}
  catch{return error(res,502,'模型服务连接失败或超时');}
  if(!upstream.ok){
    const detail=(await upstream.text()).slice(0,1000);
    return error(res,502,`模型服务返回 ${upstream.status}${detail?`: ${detail}`:''}`);
  }
  const streaming=request.stream===true;
  res.writeHead(200,{'Content-Type':streaming?'text/event-stream; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store',...(streaming?{'Connection':'keep-alive'}:{})});
  if(!upstream.body)return res.end();
  try{
    for await(const chunk of upstream.body as any){if(!res.write(chunk))await new Promise<void>(resolve=>res.once('drain',resolve));}
  }catch{if(streaming)res.write('data: [DONE]\n\n');}
  res.end();
}
