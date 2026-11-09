// Administrator tab tests (no browser, no network). Usage: node v2/tools/test/test_admin.js [path/to/index.html]
const path=require('path');
const {load}=require('./smoke_test.js');
const a=load(process.argv[2]||path.join(__dirname,'../../web/html/index.html')); const E=c=>a.eval(c); let fails=0;
function ok(c,m){ if(!c){fails++; console.log('FAIL',m);} else console.log('ok  ',m); }
a.tick(10); a.click('admin'); a.tick(2);

// --- live snapshot
const snap=E('buildSnapshot()'); const js=JSON.stringify(snap);
ok(snap && snap.simulated && snap.power.hallItKw>0, 'snapshot: hall IT '+snap.power.hallItKw+' kW, PUE '+snap.power.pueLive+', binding '+snap.binding.constraint+' '+snap.binding.pctOfLimit+'%');
ok(js.length<20000, 'snapshot size '+js.length+' chars');
ok(snap.constraints.length>=5 && snap.racks.length===9 && snap.cooling.cdu.length===2, 'constraints '+snap.constraints.length+', racks '+snap.racks.length+', CDUs 2');
ok(E('ADM.conn')==='offline', 'no network API -> Administrator shows offline state, dashboard unaffected');

// --- evaluator agrees with the live model and does not touch it
const live=E('hallTotals()'); const ev=E('scnEval(scnRead())');
ok(Math.abs(ev.power.hallItKw-live.it)/live.it<0.03, `scnEval(current) IT ${ev.power.hallItKw} vs live ${live.it.toFixed(0)} kW (<3%)`);
ok(ev.verdict.level==='good', 'default verdict '+ev.verdict.label+' · binding '+ev.verdict.binding+' '+ev.verdict.bindingPct+'%');
ok(ev.headroom.maxNodesPerRackWithinLimits>=4, 'headroom '+JSON.stringify(ev.headroom).slice(0,150));
const st=E('JSON.stringify({S:S,H:HALL})'); E('scnEval(scnMerge(scnRead(),{nodesPerRack:8,util:1,dlcRacks:16,rearDoors:false}))');
ok(st===E('JSON.stringify({S:S,H:HALL})'), 'scnEval leaves live state untouched');
const t0=Date.now(); E('scnEval(scnRead())'); const ms=Date.now()-t0; ok(ms<1500, 'full evaluation incl. headroom search '+ms+' ms');

// --- physics sanity
const hi=E('scnEval(scnMerge(scnRead(),{nodesPerRack:8,util:1}),true)');
ok(hi.verdict.level==='alarm', '8 nodes @100%: '+hi.verdict.label+' · '+hi.verdict.reason);
const big=E('scnEval(scnMerge(scnRead(),{nodesPerRack:8,util:1,dlcRacks:20}),true)');
ok(big.verdict.level==='alarm' && big.cooling.cduN1Pct>100, '20 racks x 8 nodes @100%: '+big.verdict.label+' · CDU '+big.cooling.cduN1Pct+'%');
const ref=E('scnEval(scnReference(),true)'); ok(ref.config.dlcRacks===8 && ref.config.nodesPerRack===4 && ref.load.racks===9, 'reference layout 8x4 + air rack, PUE annual '+ref.power.pueAnnualised);
const sum=E('scnEval(scnMerge(scnRead(),{tOut:30}),true)'), win=E('scnEval(scnMerge(scnRead(),{tOut:0}),true)');
ok(sum.power.pueLive>win.power.pueLive, `PUE 30 °C ${sum.power.pueLive} > 0 °C ${win.power.pueLive}`);
const nod=E('scnEval(scnMerge(scnRead(),{rearDoors:false}),true)'); ok(nod.cooling.roomHeatKw>ev.cooling.roomHeatKw, 'no rear doors raises room heat '+ev.cooling.roomHeatKw+' -> '+nod.cooling.roomHeatKw+' kW');
const warm=E('scnEval(scnMerge(scnRead(),{secSupply:26}),true)'); ok(warm.cooling.dlcPeakGpuC>ev.cooling.dlcPeakGpuC+5 && warm.sfnWhatIf.estRackCapacityKw<150, 'warmer SFN raises liquid-cooled GPU temp '+ev.cooling.dlcPeakGpuC+' -> '+warm.cooling.dlcPeakGpuC+' °C (air rack A5 unaffected)');
const low=E('scnEval(scnMerge(scnRead(),{util:0.3,nodesPerRack:2}),true)'); ok(low.verdict.level==='good' && low.power.hallItKw<ev.power.hallItKw, 'light load is fine: '+low.power.hallItKw+' kW');
ok(E('scnMerge(scnRead(),{util:95,nodesPerRack:12,dlcRacks:99,tOut:50}).util')===0.95 && E('scnMerge(scnRead(),{nodesPerRack:12}).nodesPerRack')===8 && E('scnMerge(scnRead(),{dlcRacks:99}).dlcRacks')===23, 'scnMerge converts % and clamps levers');

// --- twin context for the model
const ctx=E('admSetMode("twin"); admTwinContext()'); const cj=JSON.stringify(ctx);
ok(ctx.current && ctx.baseline && ctx.scenario && ctx.delta && ctx.headroom && ctx.levers.dlcRacks.max===23, 'twin context complete, '+cj.length+' chars');
a.tick(6); ok(E('document.getElementById("admCmp").innerHTML').includes('Scenario'), 'what-if comparison table rendered');

// --- apply + undo
const before=E('JSON.stringify(admTwinSnap())');
E('admApply({nodesPerRack:6, util:0.85, dlcRacks:10, tOut:20, secSupply:22, dlcShare:0.85},"ai")'); a.tick(2);
const after=E('scnRead()');
ok(after.nodesPerRack===6 && after.dlcRacks===10 && after.util===0.85 && after.tOut===20 && after.secSupply===22 && after.dlcShare===0.85, 'apply -> '+JSON.stringify(after));
ok(E('HALL.filter(r=>r.on&&r.plat!=="AIR").every(r=>r.nodes===6)') && E('S.twinMode')==='manual', 'all DLC racks at 6 nodes; Twin set to Manual for SFN');
const applied=E('(consoleEvents.find(e=>e.msg.includes("AI proposal applied"))||{}).msg||""');
ok(applied.includes('6 nodes/rack') && applied.includes('10 DLC racks') && applied.includes('SFN 22.0'), 'apply logged: '+applied.slice(0,140));
ok(E('admApply({nodesPerRack:6},"ai")')===false, 'applying identical settings is a no-op');
E('admUndo()');
ok(before===E('JSON.stringify(admTwinSnap())'), 'undo restores exact twin state (incl. live util) immediately');
ok(E('(consoleEvents.find(e=>e.msg.includes("Digital Twin restored"))||{}).msg||""').length>0, 'undo logged');
a.tick(20);
const cfg=o=>{ const c=Object.assign({},o); if (c.loadMode==='auto') delete c.util; return JSON.stringify(c); };
ok(cfg(JSON.parse(before))===cfg(E('admTwinSnap()')), 'configuration still restored after 20 ticks (auto-cycle util excluded: it varies by design)');
E('admScnSet("dlcRacks",12); admApply(ADM.scn,"scenario")'); a.tick(1);
ok(E('hallTotals().dlcN')===12 && E('consoleEvents[0].msg').includes('what-if scenario applied'), 'what-if panel Apply adds racks: '+E('hallTotals().dlcN')+' DLC racks');
E('admUndo()'); ok(E('hallTotals().dlcN')===8, 'undo removes them again');

// --- proposal card
E(`ADM.msgs.twin.push({role:'assistant',content:'**Verdict** ok',thinking:'',proposal:null,streaming:false}); admOnEvent(ADM.msgs.twin[ADM.msgs.twin.length-1],{type:'proposal',settings:{nodesPerRack:5,util:0.9},rationale:'Stay under 90 %',warnings:[]},'twin'); admRenderMsgs();`);
const html=a.els.admMsgs._st.ih; ok(html.includes('AI proposal') && html.includes('Apply to Digital Twin') && html.includes('Proposed') && html.includes('5 nodes/rack'), 'proposal card rendered with dashboard evaluation');
E(`admApplyProposal(ADM.msgs.twin.length-1)`); ok(E('S.nodeCount')===5 && a.els.admMsgs._st.ih.includes('Applied to Digital Twin'), 'card Apply works and shows applied state');
E('admUndo()'); ok(E('S.nodeCount')===4, 'undo from card');

// --- markdown safety
const md=E('admMd("## Head\\n**bold** <script>x</script> <img src=x onerror=alert(1)>\\n| a | b |\\n|---|---|\\n| 1 | 2 |\\n- item\\n1. first\\n```twin-proposal\\n{\\"util\\":0.9}\\n```")');
ok(!md.includes('<script>') && !md.includes('<img') && md.includes('<table') && md.includes('<li>') && md.includes('<ol>') && md.includes('see the card') && !md.includes('"util"'), 'markdown escapes HTML, renders tables/lists, hides proposal JSON');
ok(!E('admMd("```twin-proposal\\n{\\"util\\":")').includes('util'), 'half-streamed proposal block stays hidden');

// --- chat path end-to-end with a fake API (health, SSE stream, proposal, done)
a.ctx.TextEncoder=TextEncoder; a.ctx.TextDecoder=TextDecoder; a.ctx.AbortController=AbortController; a.ctx.location.protocol='http:';
let lastBody=null;
const sse=evs=>evs.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');
a.ctx.fetch=async (url,opts)=>{
  if (url.endsWith('/health')) return {ok:true,status:200,json:async()=>({api:'ok',version:'2.0.0-dev',model:'qwen3:8b',auth_required:false,ollama:true,ollama_version:'0.12.0',model_available:true,num_ctx:12288})};
  if (url.endsWith('/runtime')) return {ok:true,status:200,json:async()=>({loaded:[{name:'qwen3:8b',gpu_pct:100,context_length:12288}]})};
  if (url.endsWith('/chat')){ lastBody=JSON.parse(opts.body);
    const text=sse([{type:'start',model:'qwen3:8b'},{type:'content',text:'**Verdict:** near limits. '},{type:'content',text:'Use 6 nodes.\n```twin-proposal\n{"nodesPerRack":6}\n```'},
                    {type:'proposal',settings:{nodesPerRack:6,util:0.9},rationale:'Keeps CDU below 90 %',warnings:[]},{type:'done',stats:{eval_count:40,tokens_per_s:31.5}}]);
    const bytes=new TextEncoder().encode(text); let sent=false, half=Math.floor(bytes.length/2), step=0;
    return {ok:true,status:200,body:{getReader:()=>({read:async()=>{ step++; if(step===1) return {done:false,value:bytes.slice(0,half)}; if(step===2) return {done:false,value:bytes.slice(half)}; return {done:true}; }})}}; }
  return {ok:false,status:404,json:async()=>({})};
};
(async()=>{
  await a.ctx.admCheck(true);
  ok(E('ADM.conn')==='ok' && a.els.admRt._st.tc.includes('100% GPU'), 'health + runtime: '+a.els.admModel._st.tc+' · '+a.els.admRt._st.tc);
  E('admSetMode("twin")'); a.els.admIn.value='Maximise compute';
  await a.ctx.admSend();
  const last=E('ADM.msgs.twin[ADM.msgs.twin.length-1]');
  ok(lastBody && lastBody.mode==='twin' && lastBody.context.current && lastBody.messages.slice(-1)[0].content==='Maximise compute', 'request carries twin context and the question');
  ok(last.content.includes('Use 6 nodes') && last.proposal && last.proposal.settings.nodesPerRack===6 && !last.streaming && last.stats.tokens_per_s===31.5, 'stream split across chunks parsed: content, proposal, stats');
  ok(a.els.admMsgs._st.ih.includes('31.5 tokens/s') && a.els.admMsgs._st.ih.includes('Apply to Digital Twin'), 'final message shows speed and proposal card');
  E('admSetMode("analyse")'); a.els.admIn.value='Analyse'; await a.ctx.admSend();
  ok(lastBody.mode==='analyse' && lastBody.context.power && lastBody.context.racks, 'analyse mode sends the live snapshot');
  a.tick(200); a.click('twin'); a.tick(5); a.click('admin'); a.tick(20);
  ok(a.errors.length===0, 'runtime errors: '+a.errors.length+(a.errors.length?' '+[...new Set(a.errors)].slice(0,3):''));
  ok(E('overallStatus()')==='good', 'hall still healthy');
  console.log(fails? fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
})();
