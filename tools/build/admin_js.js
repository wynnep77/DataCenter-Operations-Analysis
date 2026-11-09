/* ============ v2 · ADMINISTRATOR · AI OPERATIONS ANALYST ============
   The dashboard computes every number; the LLM (Ollama via /api) only reasons over them.
   What-if scenarios and AI proposals are evaluated by scnEval(): the v1 formulas run on a copy of S and HALL,
   settled to steady state (no transient fault ramps), so the live hall is never touched until the operator applies. */
var ADM_API = (typeof window!=='undefined' && window.DCOA_API_BASE) || '/api';
var ADM = { mode:'analyse', msgs:{analyse:[],twin:[]}, health:null, runtime:null, conn:'unknown', token:'', busy:false, ctrl:null,
            scn:null, scnSig:'', ev:{}, undo:null, sideTick:0, slidersBuilt:false, checked:false, shown:false, lastPaint:0 };
try { ADM.token = localStorage.getItem('dcoaAdminToken') || ''; } catch(e){}
function admR(v,d){ var p=Math.pow(10,d||0); return Math.round((+v||0)*p)/p; }
function admEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function admStrip(s){ return String(s==null?'':s).replace(/<[^>]*>/g,''); }
function admSetEl(id,prop,val){ var el=document.getElementById(id); if(el) el[prop]=val; }

/* ----- Live snapshot sent in "Live analysis" mode ----- */
function buildSnapshot(){
  var HT=hallTotals(), lc=loadConstraints(), it=HT.it, pl=plantAt(S.tOut);
  var pA = it>0 ? 1+annualOverhead(HT.mix) : 0, annIT=it*8760, facA=annIT*pA, baseA=annIT*1.60;
  var racks=[], thrHall=S.thr;
  HALL.forEach(function(r){ if(!r.on) return; var c=rackCalc(r); if (c.thr>thrHall) thrHall=c.thr;
    var o={id:r.id, platform:r.plat==='AIR'?'air-cooled':r.plat, itKw:admR(c.it,1), demandKw:admR(c.dem,1), limitKw:c.cap,
           peakGpuC:admR(c.peak,1), heatToRoomKw:admR(c.air,1), status:c.st, label:c.lab};
    if (c.isAir) o.servers=c.srv; else o.nodes=c.nodes;
    if (c.thr>0.005) o.throttlePct=admR(c.thr*100,1);
    racks.push(o); });
  var cdu=[0,1].map(function(i){ var v=cduVals(i,true), d=CX.cdu[i];
    return {name:d.name, online:!d.fail, modbusOk:d.mb, loadSharePct:admR(v.share*100), coolingDemandPct:admR(v.dem), pumpPct:admR(v.pump), diffPressureBar:admR(v.dP,2), criticalAlarm:!!v.crit, nonCriticalAlarm:!!v.non}; });
  var crac=CX.u.map(function(u,i){ return {name:u.name, lead:i===CX.lead, enabled:!!u.en, running:!!u.run, runFail:!!u.runFail, leak:!!u.leak, modbusOk:!!u.mb}; });
  return {
    simulated:true, note:'Synthetic data from the Callan Operational Dashboard simulation (not live equipment).',
    time:nowStr(), uptimeS:S.uptime, overallStatus:overallStatus(),
    load:{ mode:S.loadMode, gpuUtilPct:admR(S.util*100), nodesPerRackA1:S.nodeCount, mixedNodeCounts:hallMixed(), racks:HT.n, dlcRacks:HT.dlcN, airRacks:HT.airN,
           dlcNodes:HT.nodes, airServers:HT.srv, gpus:HT.gpus, perNodeKw:admR(nodeDemandKW(),1) },
    power:{ hallItKw:admR(it), hallItDemandKw:admR(HT.dem), facilityKw:admR(HT.fac), pueLive:it>0?admR(HT.fac/it,3):null, pueAnnualised:it>0?admR(pA,3):null,
            airCooledBaselinePue:1.6, rackA1ItKw:admR(rackIT(),1), rackA1DemandKw:admR(rackDemand(),1), computeDeliveredPct:HT.dem>0?admR(it/HT.dem*100,1):null },
    cooling:{ rearDoors:S.rearDoors, coldPlateSharePct:admR(S.dlcShare*100), heatCapturedToWaterPct:admR(HT.mix*100,1), heatToWaterKw:admR(HT.h2w), roomHeatKw:admR(40+HT.air),
              cracCapacityKw:admR(cracCap()), cracActive:!!S.crac.active, cracOutputKw:admR(S.crac.output), roomTempC:admR(S.roomTemp,1), roomRhPct:admR(B.roomRH,1),
              primary:{supplyC:admR(S.primarySupply,1), returnC:admR(S.primaryReturn,1), flowLpm:admR(S.primaryFlow,1)},
              secondary:{supplyC:admR(S.secSupply,1), returnC:admR(S.secReturn,1), flowLpm:admR(S.secFlow), diffPressureBar:admR(S.diffP,2)},
              cduPumpPct:admR(S.pump1), cduN1LoadPct:admR(HT.h2wDem/LIM.cdu*100), cdu:cdu, crac:crac },
    gpu:{ peakC:admR(Math.max(peakGpu(),HT.peak),1), peakRack:HT.peakId||'A1', throttleLimitC:LIM.thr, throttlePct:admR(thrHall*100,1) },
    constraints: lc.items.map(function(c){ return {name:c.name, value:admR(c.val,c.fmt), limit:c.lim, unit:c.unit, pctOfLimit:admR(c.pct*100), status:c.st}; }),
    binding:{ constraint:lc.worst.short, pctOfLimit:admR(lc.worst.pct*100), status:lc.worst.st, headroomKwPerRack:admR(lc.head,1), headroomLimit:lc.headName, extraNodesThatFit:lc.extraNodes },
    racks:racks,
    sustainability:{ outdoorC:S.tOut, freeCoolingPct:admR(pl.fc*100), chillerCop:pl.fc>=1?null:admR(pl.cop,1), annualFacilityMWh:admR(facA/1000), annualCarbonT:admR(facA*0.233/1000),
                     airCooledCarbonT:admR(baseA*0.233/1000), costSavedVsAirEurK:admR((baseA-facA)*0.18/1000), wueLPerKwh:admR(0.18+(1-HT.mix)*0.9,2), heatAvailableForReuseKw:admR(HT.h2w) },
    alarms:{ bmsActive:(B.alarms||[]).map(function(a){ return a.lv+': '+admStrip(a.msg); }), failureScenario:scnRunning?SCENARIOS[selScn].title:null,
             cduFault:!!S.fault, rackOffline:!!S.rackOffline, rackWaterIsolated:!!S.rackWaterIsolated, roomOverTemp:!!S.roomOverTemp },
    digitalTwin:{ mode:S.twinMode, sfnWhatIfSupplyC:S.twinMode==='manual'?admR(S.sfnManual,1):null },
    recentEvents: consoleEvents.slice(0,8).map(function(e){ return e.ts+' '+e.lv+' '+admStrip(e.msg); })
  };
}

/* ----- What-if scenario model ----- */
var SCN_KEYS=['util','nodesPerRack','dlcRacks','rearDoors','dlcShare','tOut','secSupply'];
function scnMaxDlc(){ return HALL.filter(function(r){ return r.plat!=='AIR'; }).length; }
function scnLevers(){
  return { util:{min:0.10,max:1,note:'GPU utilisation as a fraction (0.9 = 90 %)'}, nodesPerRack:{min:1,max:LIM.maxNodes,note:'nodes in every DLC rack'},
           dlcRacks:{min:1,max:scnMaxDlc(),note:'number of DLC racks in the hall (air-cooled racks unchanged)'}, rearDoors:{type:'boolean',note:'CL23 rear-door heat exchangers fitted'},
           dlcShare:{min:0,max:1,note:'cold-plate heat capture fraction; matters only without rear doors'}, tOut:{min:-5,max:35,note:'outdoor dry-bulb °C (drives the chiller plant and PUE)'},
           secSupply:{min:16,max:30,note:'SFN supply °C (Digital Twin what-if; applying sets the Twin to Manual)'} };
}
function scnRead(){
  return { util:S.loadMode==='manual'?admR(S.manualUtil,2):admR(S.util,2), nodesPerRack:S.nodeCount, dlcRacks:hallTotals().dlcN, rearDoors:!!S.rearDoors,
           dlcShare:admR(S.dlcShare,2), tOut:S.tOut, secSupply:S.twinMode==='manual'?admR(S.sfnManual,1):SP.secSupply };
}
function scnReference(){ return { util:0.93, nodesPerRack:4, dlcRacks:8, rearDoors:true, dlcShare:0.8, tOut:10, secSupply:SP.secSupply, reference:true }; }
function scnMerge(base, patch){
  var o={}; SCN_KEYS.forEach(function(k){ o[k]=base[k]; }); if (base.reference) o.reference=true;
  Object.keys(patch||{}).forEach(function(k){
    var v=patch[k]; if (SCN_KEYS.indexOf(k)<0 || v===null || v===undefined || v==='') return;
    if (k==='rearDoors'){ o[k] = (v===true || v==='true' || v===1 || v==='1'); return; }
    v=parseFloat(v); if (!isFinite(v)) return;
    if (k==='util'||k==='dlcShare'){ if (v>1) v=v/100; v=admR(clamp(v, k==='util'?0.10:0, 1),2); }
    else if (k==='nodesPerRack') v=clamp(Math.round(v),1,LIM.maxNodes);
    else if (k==='dlcRacks') v=clamp(Math.round(v),1,scnMaxDlc());
    else if (k==='tOut') v=clamp(Math.round(v),-5,35);
    else if (k==='secSupply') v=admR(clamp(v,16,30),1);
    o[k]=v;
  });
  return o;
}
// Switch DLC racks on/off in hall order (A1, B1, A2, B2, …) until n are on. Works on whatever HALL currently is.
function scnSetDlcRacks(n, nodes){
  var dlc=hallOrder().filter(function(r){ return r.plat!=='AIR'; }), on=dlc.filter(function(r){ return r.on; }).length, i, r;
  for (i=0;i<dlc.length && on<n;i++){ r=dlc[i]; if(!r.on){ r.on=true; r.nodes=nodes; on++; } }
  for (i=dlc.length-1;i>=0 && on>n;i--){ r=dlc[i]; if(r.on && r.id!=='A1'){ r.on=false; on--; } }
  return on;
}
function scnEval(sc, skipHeadroom){
  var S0=S, H0=HALL, out;
  try {
    S=JSON.parse(JSON.stringify(S0)); HALL=JSON.parse(JSON.stringify(H0));
    if (sc.reference) HALL.forEach(hallDefault);
    S.fault=false; S.faultRamp=0; S.rackOffline=false; S.rackWaterIsolated=false; S.roomOverTemp=false;
    S.loadMode='manual'; S.util=S.manualUtil=sc.util; S.nodeCount=sc.nodesPerRack;
    S.rearDoors=!!sc.rearDoors; S.dlcShare=sc.dlcShare; S.mixLiquid=S.rearDoors?1:S.dlcShare; S.tOut=sc.tOut;
    S.nodes.forEach(function(n){ n.on=true; });
    scnSetDlcRacks(sc.dlcRacks, sc.nodesPerRack);
    HALL.forEach(function(r){ if(r.on && r.plat!=='AIR') r.nodes=sc.nodesPerRack; });
    scnSettle(sc.secSupply-SP.secSupply);
    out=scnMetrics(sc);
  } finally { S=S0; HALL=H0; }
  if (!skipHeadroom) out.headroom=scnHeadroom(sc);
  return out;
}
// Steady state of the v1 tick() equations (A1 throttle loop, room/CRAC balance), without noise or fault ramps.
function scnSettle(sfnOff){
  var cap=cracCap(), p=a1P(), k, i, D, li;
  S.thr=0; S.roomTemp=22.7; S.crac.active=false; S.crac.power=8; S.crac.output=40;
  for (k=0;k<40;k++){
    D=rackIT()/LIM.nomRack; S.loadD=D; S.loadIdx=0.55*Math.max(D,0.36); li=S.loadIdx;
    S.secSupply=SP.secSupply+(li-0.55)*1.4+sfnOff;
    var E=rackExcess(), peak=0;
    for (i=0;i<LIM.maxNodes;i++){ var n=S.nodes[i];
      if (i>=S.nodeCount){ n.t=28; continue; }
      n.t=clamp(45+p.tK*S.util*(1-S.thr)+(S.secSupply-SP.secSupply)+1.5*E+0.5*Math.max(0,S.roomTemp-22.7)+i*0.4, 30, 98);
      if (n.t>peak) peak=n.t; }
    S.thr=clamp(S.thr*0.6+0.4*(peak>0?clamp((peak-86)/8,0,1)*0.3:0), 0, 0.3);
    var spill=hallTotals().air;
    if (spill>0.5 || cap<40){ var need=40+spill; S.crac.active=true; S.crac.output=clamp(Math.min(need,cap),Math.min(38,cap),cap);
      S.crac.power=clamp(8+(S.crac.output-40)*0.18, cap>0?7.8:0, 22); S.roomTemp=clamp(22.7+Math.max(0,need-cap)*0.08, 22.2, 34); }
    else { S.crac.active=false; S.crac.power=8; S.crac.output=40; S.roomTemp=22.7; }
  }
  if (S.thr<0.003) S.thr=0;
  D=rackIT()/LIM.nomRack; li=S.loadIdx;
  var fq=Math.pow(Math.max(D,0.3),0.6), tq=Math.pow(Math.max(D,0.3),0.4), pfr=clamp(D,0.5,1.25);
  S.primarySupply=SP.primarySupply+(li-0.55)*1.2; S.primaryFlow=21.1*pfr; S.primaryReturn=S.primarySupply+7.0*Math.max(D,0.3)/pfr;
  S.secReturn=S.secSupply+6.03*tq*0.4+0.1; S.secFlow=702*fq; S.diffP=0.35*Math.pow(fq,1.2);
  S.pump1=clamp(50*fq*cduPumpMul(),20,100); S.pump2=clamp(S.pump1+1,20,100);
}
function scnMetrics(sc){
  var HT=hallTotals(), lc=loadConstraints(), it=HT.it, pl=plantAt(S.tOut), thrHall=S.thr, dlcPeak=0;
  HALL.forEach(function(r){ if(r.on){ var c=rackCalc(r); if(c.thr>thrHall) thrHall=c.thr; if(!c.isAir && c.peak>dlcPeak) dlcPeak=c.peak; } });
  var pA=it>0?1+annualOverhead(HT.mix):0, annIT=it*8760, facA=annIT*pA, baseA=annIT*1.60, w=lc.worst;
  var level=w.st; if (thrHall>0.005 || HT.over>0) level='alarm';
  var label=level==='good'?'Can handle':(level==='warn'?'Can handle, near limits':'Cannot handle');
  var reason=level==='good'?'every limit below 90 %':(thrHall>0.005&&w.st!=='alarm'?'GPU throttling engaged':(w.short+' at '+Math.round(w.pct*100)+' % of limit'));
  var cooler=sc.secSupply, gpuEst=clamp(55+(cooler-18)*1.6+S.loadIdx*10,45,92), cfg={};
  SCN_KEYS.forEach(function(k){ cfg[k]=sc[k]; });
  return {
    config:cfg,
    verdict:{ level:level, label:label, reason:reason, binding:w.short, bindingName:w.name, bindingPct:admR(w.pct*100), throttling:thrHall>0.005, racksOverLimit:HT.over },
    load:{ racks:HT.n, dlcRacks:HT.dlcN, airRacks:HT.airN, dlcNodes:HT.nodes, gpus:HT.gpus, gpuUtilPct:admR(sc.util*100) },
    power:{ hallItKw:admR(it), hallItDemandKw:admR(HT.dem), facilityKw:admR(HT.fac), pueLive:it>0?admR(HT.fac/it,3):null, pueAnnualised:it>0?admR(pA,3):null,
            rackA1ItKw:admR(rackIT(),1), computeDeliveredPct:HT.dem>0?admR(it/HT.dem*100,1):null },
    cooling:{ heatToWaterKw:admR(HT.h2w), heatCapturedPct:admR(HT.mix*100,1), roomHeatKw:admR(40+HT.air), cracCapacityKw:admR(cracCap()), cduN1Pct:admR(HT.h2wDem/LIM.cdu*100),
              cduPumpPct:admR(S.pump1), roomTempC:admR(S.roomTemp,1), secSupplyC:admR(S.secSupply,1), secReturnC:admR(S.secReturn,1),
              peakGpuC:admR(Math.max(peakGpu(),HT.peak),1), peakRack:HT.peakId||'A1', dlcPeakGpuC:admR(dlcPeak,1), throttlePct:admR(thrHall*100,1) },
    constraints:lc.items.map(function(c){ return {name:c.short, value:admR(c.val,c.fmt), limit:c.lim, unit:c.unit, pctOfLimit:admR(c.pct*100), status:c.st}; }),
    sustainability:{ freeCoolingPct:admR(pl.fc*100), annualFacilityMWh:admR(facA/1000), annualCarbonT:admR(facA*0.233/1000), carbonSavedVsAirT:admR((baseA-facA)*0.233/1000),
                     costSavedVsAirEurK:admR((baseA-facA)*0.18/1000), wueLPerKwh:admR(0.18+(1-HT.mix)*0.9,2) },
    sfnWhatIf:{ supplyC:cooler, estGpuC:admR(gpuEst), thermalHeadroomC:admR(clamp(88-gpuEst,0,40)), pumpEfficiencyDeltaPct:admR(clamp((24-cooler)*1.1,-8,10),1),
                estRackCapacityKw:admR(clamp(150-(cooler-18)*4,110,150)) }
  };
}
// One lever at a time from the scenario; "within limits" = nothing at or over 100 % and no throttling.
// Binary search: load, node count and rack count only ever make things worse, so each limit has one boundary.
function scnMaxOk(lo, hi, f){ if (!f(lo)) return lo-1; while (lo<hi){ var mid=Math.ceil((lo+hi)/2); if (f(mid)) lo=mid; else hi=mid-1; } return lo; }
function scnHeadroom(sc){
  var memo={};
  function lvl(k,v){ var key=k+v; if (!(key in memo)){ var p={}; p[k]=v; memo[key]=scnEval(scnMerge(sc,p),true).verdict.level; } return memo[key]; }
  var nOk=scnMaxOk(1,LIM.maxNodes,function(n){ return lvl('nodesPerRack',n)!=='alarm'; });
  var nGood=scnMaxOk(1,LIM.maxNodes,function(n){ return lvl('nodesPerRack',n)==='good'; });
  var uOk=scnMaxOk(2,20,function(u){ return lvl('util',u*5/100)!=='alarm'; });
  var rOk=scnMaxOk(1,scnMaxDlc(),function(n){ return lvl('dlcRacks',n)!=='alarm'; });
  return { maxNodesPerRackWithinLimits:Math.max(0,nOk), firstNodesPerRackAt90pct:nGood<LIM.maxNodes?nGood+1:null, maxGpuUtilPctWithinLimits:uOk>=2?uOk*5:0,
           maxDlcRacksWithinLimits:Math.max(0,rOk), note:'Each search varies one lever from this scenario and keeps the others fixed.' };
}
function admEvCompact(e){
  var o={}; ['config','verdict','load','power','cooling','sustainability','sfnWhatIf'].forEach(function(k){ o[k]=e[k]; });
  o.constraints=e.constraints.map(function(c){ return c.name+' '+c.pctOfLimit+'% ('+c.status+')'; });
  return o;
}
function admDelta(a,b){
  function d(x,y,p){ return (x===null||y===null)?null:admR(y-x,p||0); }
  return { hallItKw:d(a.power.hallItKw,b.power.hallItKw), facilityKw:d(a.power.facilityKw,b.power.facilityKw), pueAnnualised:d(a.power.pueAnnualised,b.power.pueAnnualised,3),
           peakGpuC:d(a.cooling.peakGpuC,b.cooling.peakGpuC,1), cduN1Pct:d(a.cooling.cduN1Pct,b.cooling.cduN1Pct), roomHeatKw:d(a.cooling.roomHeatKw,b.cooling.roomHeatKw),
           gpus:d(a.load.gpus,b.load.gpus), annualCarbonT:d(a.sustainability.annualCarbonT,b.sustainability.annualCarbonT) };
}
function admTwinContext(){
  var cur=scnRead(), sc=ADM.scn||cur, eC=scnEval(cur,true), eS=scnEval(sc,false), eB=scnEval(scnReference(),true);
  return { simulated:true, note:'Synthetic Digital Twin evaluations by the dashboard steady-state model (v1 formulas, no transient fault ramps).',
           current:admEvCompact(eC), baseline:admEvCompact(eB), scenario:admEvCompact(eS), scenarioIsCurrent:JSON.stringify(cur)===JSON.stringify(scnMerge(cur,sc)),
           delta:admDelta(eC,eS), headroom:eS.headroom, levers:scnLevers(),
           live:{ overallStatus:overallStatus(), failureScenario:scnRunning?SCENARIOS[selScn].title:null, cracUnitsAvailable:CX.u.filter(cxAvail).length,
                  cdusOnline:CX.cdu.filter(function(c){ return !c.fail; }).length, airRackServers:hallTotals().srv } };
}

/* ----- Apply to the Digital Twin (through the v1 controls) and undo ----- */
function admTwinSnap(){
  return { loadMode:S.loadMode, manualUtil:S.manualUtil, util:S.util, nodeCount:S.nodeCount, rearDoors:S.rearDoors, dlcShare:S.dlcShare, tOut:S.tOut,
           sfnManual:S.sfnManual, twinMode:S.twinMode, hall:HALL.map(function(r){ return {on:r.on, nodes:r.nodes}; }) };
}
function admLeverText(k,v){
  return { util:'GPU '+Math.round(v*100)+'%', nodesPerRack:v+' nodes/rack', dlcRacks:v+' DLC racks', rearDoors:v?'rear doors fitted':'no rear doors',
           dlcShare:'cold-plate '+Math.round(v*100)+'%', tOut:'outdoor '+v+' °C', secSupply:'SFN '+(+v).toFixed(1)+' °C (Twin manual)' }[k];
}
function admApply(set, source){
  set=set||{}; var cur=scnRead(), sc=scnMerge(cur,set), snap=admTwinSnap(), parts=[];
  SCN_KEYS.forEach(function(k){ if (source==='ai' ? (k in set) : sc[k]!==cur[k]) parts.push(admLeverText(k,sc[k])); });
  var changed=SCN_KEYS.some(function(k){ return sc[k]!==cur[k]; }) || hallMixed();
  if (!changed){ setTxt('admFoot','Nothing to apply: the Digital Twin already has these settings.'); return false; }
  if (sc.util!==cur.util){ S.loadMode='manual'; S.manualUtil=sc.util; S.util=sc.util; }
  if (sc.nodesPerRack!==S.nodeCount || hallMixed()){ S.nodeCount=sc.nodesPerRack; rackBuilt=false; HALL.forEach(function(r){ if(r.on && r.plat!=='AIR') r.nodes=sc.nodesPerRack; }); }
  scnSetDlcRacks(sc.dlcRacks, sc.nodesPerRack);
  S.dlcShare=sc.dlcShare; admSetEl('mixSlider','value',Math.round(sc.dlcShare*100));
  if (S.rearDoors!==sc.rearDoors) setRearDoors(sc.rearDoors);
  S.tOut=sc.tOut; admSetEl('tOutSlider','value',sc.tOut); admSetEl('tOutVal','textContent',sc.tOut+' °C');
  if (sc.secSupply!==cur.secSupply){ S.sfnManual=sc.secSupply; admSetEl('sfnSlider','value',sc.secSupply); admSetEl('sfnTval','textContent',sc.secSupply.toFixed(1)+' °C'); setTwinMode('manual'); }
  syncCapture(); hallChanged();
  ADM.undo=snap;
  logEvent(consoleEvents,'info','Administrator: '+(source==='ai'?'AI proposal':'what-if scenario')+' applied to Digital Twin · '+parts.join(' · '));
  ADM.scn=scnRead(); admSetEl('admUndo','disabled',false);
  setTxt('admFoot', (source==='ai'?'AI proposal':'Scenario')+' applied to the Digital Twin and logged on the Live Console. Use Undo apply to restore the previous configuration.');
  admRenderSide(true);
  return true;
}
function admUndo(){
  var u=ADM.undo; if(!u) return;
  S.loadMode=u.loadMode; S.manualUtil=u.manualUtil; S.util=u.util; S.nodeCount=u.nodeCount; S.dlcShare=u.dlcShare; S.tOut=u.tOut; S.sfnManual=u.sfnManual;
  HALL.forEach(function(r,i){ r.on=u.hall[i].on; r.nodes=u.hall[i].nodes; }); rackBuilt=false;
  if (S.rearDoors!==u.rearDoors) setRearDoors(u.rearDoors);
  admSetEl('mixSlider','value',Math.round(u.dlcShare*100)); admSetEl('tOutSlider','value',u.tOut); admSetEl('tOutVal','textContent',u.tOut+' °C');
  admSetEl('sfnSlider','value',u.sfnManual); admSetEl('sfnTval','textContent',(+u.sfnManual).toFixed(1)+' °C'); setTwinMode(u.twinMode); syncCapture(); hallChanged();
  logEvent(consoleEvents,'info','Administrator: Digital Twin restored to the configuration before the last apply');
  ADM.undo=null; ADM.scn=scnRead(); admSetEl('admUndo','disabled',true); setTxt('admFoot','Previous Digital Twin configuration restored.');
  ADM.msgs.twin.forEach(function(m){ m.applied=false; });
  admRenderMsgs(); admRenderSide(true);
}
function admApplyProposal(i){ var m=ADM.msgs.twin[i]; if(!m||!m.proposal) return; if (admApply(m.proposal.settings,'ai')){ m.applied=true; admRenderMsgs(); } }
function admLoadProposal(i){ var m=ADM.msgs.twin[i]; if(!m||!m.proposal) return; ADM.scn=scnMerge(scnRead(), m.proposal.settings); admRenderSide(true);
  setTxt('admFoot','Proposal loaded into the what-if panel. Adjust it, then Apply to Digital Twin when ready.'); }

/* ----- Markdown (escaped first, so model output can never inject HTML) ----- */
function admMd(src){
  var t=String(src||'').replace(/\r/g,''), blocks=[];
  t=t.replace(/```[ \t]*twin-proposal[\s\S]*?(```|$)/gi, '\n@@PROP@@\n');
  t=t.replace(/```[\w-]*\n([\s\S]*?)(```|$)/g, function(_,code){ blocks.push(code); return '\n@@CODE'+(blocks.length-1)+'@@\n'; });
  var lines=t.split('\n'), out=[], para=[], list=null, i=0, m;
  function inl(s){ return admEsc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g,'$1<i>$2</i>'); }
  function fP(){ if(para.length){ out.push('<p>'+para.map(inl).join('<br>')+'</p>'); para=[]; } }
  function fL(){ if(list){ out.push('<'+list.t+'>'+list.items.map(function(x){ return '<li>'+inl(x)+'</li>'; }).join('')+'</'+list.t+'>'); list=null; } }
  function cells(r){ return r.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){ return c.trim(); }); }
  while (i<lines.length){
    var L=lines[i];
    if (L.trim()==='@@PROP@@'){ fP(); fL(); out.push('<div class="adm-propnote">Proposal received: see the card below.</div>'); i++; continue; }
    if ((m=L.trim().match(/^@@CODE(\d+)@@$/))){ fP(); fL(); out.push('<pre>'+admEsc(blocks[+m[1]])+'</pre>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(L) && i+1<lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i+1])){
      fP(); fL(); var hd=cells(L), rows=[]; i+=2;
      while (i<lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){ rows.push(cells(lines[i])); i++; }
      out.push('<table class="adm-md"><tr>'+hd.map(function(c){ return '<th>'+inl(c)+'</th>'; }).join('')+'</tr>'+rows.map(function(r){ return '<tr>'+r.map(function(c){ return '<td>'+inl(c)+'</td>'; }).join('')+'</tr>'; }).join('')+'</table>');
      continue; }
    if ((m=L.match(/^\s*#{1,6}\s+(.*)$/))){ fP(); fL(); out.push('<h4>'+inl(m[1])+'</h4>'); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(L)){ fP(); fL(); out.push('<hr>'); i++; continue; }
    if ((m=L.match(/^\s*[-*•]\s+(.*)$/))){ fP(); if(!list||list.t!=='ul'){ fL(); list={t:'ul',items:[]}; } list.items.push(m[1]); i++; continue; }
    if ((m=L.match(/^\s*\d+[.)]\s+(.*)$/))){ fP(); if(!list||list.t!=='ol'){ fL(); list={t:'ol',items:[]}; } list.items.push(m[1]); i++; continue; }
    if (!L.trim()){ fP(); fL(); i++; continue; }
    if (list && /^\s{2,}\S/.test(L)){ list.items[list.items.length-1]+=' '+L.trim(); i++; continue; }
    fL(); para.push(L); i++;
  }
  fP(); fL(); return out.join('');
}

/* ----- Chat rendering ----- */
var ADM_CHIPS = {
  analyse:[ {l:'Analyse the current state', q:'Analyse the current state of the hall.'},
            {l:'Binding constraint & headroom', q:'What is the binding constraint right now, and how much headroom is left before it is reached?'},
            {l:'Efficiency & PUE', q:'How efficient is the hall right now? Explain the PUE and what would improve it.'},
            {l:'Explain alarms & events', q:'Explain any active alarms or recent events and what the operator should do.'},
            {l:'Manager summary', q:'Write a three-sentence status summary for a non-technical manager.'} ],
  twin:[ {l:'8 nodes at 100 %', set:{nodesPerRack:8, util:1}, q:'Can the hall handle 8 nodes per rack at 100 % GPU utilisation? Assess the scenario and propose the closest configuration that stays within limits.'},
         {l:'Maximise compute', q:'Propose the configuration that maximises delivered compute (GPUs × utilisation) while keeping every limit below 90 %.'},
         {l:'Lowest PUE', q:'Propose settings that minimise annualised PUE without reducing delivered compute by more than 10 %.'},
         {l:'Hot day 30 °C', set:{tOut:30}, q:'What happens on a 30 °C day? Assess PUE, cooling limits and carbon, and suggest how to optimise.'},
         {l:'No rear doors', set:{rearDoors:false}, q:'What if we run without rear-door heat exchangers? Assess the impact and propose the best configuration without them.'},
         {l:'Add 4 racks', add:4, q:'Can the hall take 4 more DLC racks? Assess the scenario and propose a configuration.'} ]
};
function admChip(i){
  var c=ADM_CHIPS[ADM.mode][i]; if(!c) return;
  if (ADM.mode==='twin'){ var base=ADM.scn||scnRead(); if (c.set) ADM.scn=scnMerge(base,c.set); if (c.add) ADM.scn=scnMerge(base,{dlcRacks:base.dlcRacks+c.add}); if (c.set||c.add) admRenderSide(true); }
  admAsk(c.q);
}
function admEmptyHtml(){
  var off = ADM.conn==='ok' ? '' : '<p style="margin-top:10px"><b>AI not connected.</b> '+admEsc(admConnText())+'</p>';
  return ADM.mode==='analyse'
    ? '<div class="adm-empty"><b>Live analysis.</b> Ask about the hall as it is now. Each question sends a JSON snapshot of the simulated state (power, cooling, limits, racks, alarms, recent events) to the local model. Try a suggestion above.'+off+'</div>'
    : '<div class="adm-empty"><b>Twin advisor.</b> Set a what-if scenario on the right, or pick a suggestion. The dashboard evaluates it with its own model; the AI explains the impact and may propose settings. Proposals are evaluated again before you choose <b>Apply to Digital Twin</b>, and <b>Undo apply</b> restores the previous configuration.'+off+'</div>';
}
function admPropHtml(m,i){
  var p=m.proposal, keys=Object.keys(p.settings||{});
  var warn=(p.warnings||[]).length?'<div class="pw">⚠ '+p.warnings.map(admEsc).join(' · ')+'</div>':'';
  if (!keys.length) return '<div class="adm-prop warn"><div class="pt">AI proposal could not be used</div>'+warn+'</div>';
  var cur=scnRead(), sig=JSON.stringify([cur,p.settings]);
  if (m.propSig!==sig){ var sc=scnMerge(cur,p.settings); m.propEv=[scnEval(cur,true),scnEval(sc,true),sc]; m.propSig=sig; }
  var e0=m.propEv[0], e1=m.propEv[1], sc2=m.propEv[2], v=e1.verdict;
  var rows=keys.map(function(k){ return [admLeverText(k,cur[k]).replace(' (Twin manual)',''), admLeverText(k,sc2[k]).replace(' (Twin manual)','')]; });
  function r(l,a,b){ return '<tr><td>'+l+'</td><td>'+a+'</td><td class="sc">'+b+'</td></tr>'; }
  var tbl='<table class="adm-tbl"><tr><th>Setting / result</th><th>Current</th><th>Proposed</th></tr>'+rows.map(function(x){ return r('',x[0],x[1]); }).join('')
    +r('Hall IT', e0.power.hallItKw+' kW', e1.power.hallItKw+' kW')+r('GPUs', e0.load.gpus, e1.load.gpus)+r('PUE annualised', e0.power.pueAnnualised, e1.power.pueAnnualised)
    +r('Peak GPU', e0.cooling.peakGpuC+' °C', e1.cooling.peakGpuC+' °C')+r('CDU N+1', e0.cooling.cduN1Pct+' %', e1.cooling.cduN1Pct+' %')
    +r('Binding limit', admEsc(e0.verdict.binding)+' '+e0.verdict.bindingPct+' %', admEsc(v.binding)+' '+v.bindingPct+' %')+'</table>';
  var acts = m.applied ? '<span class="applied">✓ Applied to Digital Twin</span><button class="btn" type="button" onclick="admUndo()">Undo apply</button>'
    : '<button class="btn primary" type="button" onclick="admApplyProposal('+i+')">Apply to Digital Twin</button><button class="btn" type="button" onclick="admLoadProposal('+i+')">Load into what-if</button>';
  return '<div class="adm-prop '+v.level+'"><div class="pt">AI proposal · dashboard evaluation <span class="pill '+v.level+'">'+v.label+'</span></div>'
    +(p.rationale?'<div class="pr">'+admEsc(p.rationale)+'</div>':'')+warn+tbl+'<div class="pa">'+acts+'</div></div>';
}
function admMsgInner(m,i,mode){
  var h='';
  if (m.thinking) h+='<details class="adm-thk"'+(m.streaming&&!m.content?' open':'')+'><summary>Model reasoning</summary><pre>'+admEsc(m.thinking)+'</pre></details>';
  h+=admMd(m.content);
  if (m.streaming) h+=(!m.content&&!m.thinking?'<span style="color:var(--text2);font-size:12px">Thinking… (the first answer can take up to a minute while the model loads) </span>':'')+'<span class="adm-cursor"></span>';
  if (m.error) h+='<div class="adm-err">'+admEsc(m.error)+(m.hint?'<small>'+admEsc(m.hint)+'</small>':'')+'</div>';
  if (m.proposal && mode==='twin' && !m.streaming) h+=admPropHtml(m,i);
  if (m.stats && m.stats.tokens_per_s) h+='<div class="adm-meta">'+admEsc(m.model||'')+' · '+(m.stats.eval_count||0)+' tokens · '+m.stats.tokens_per_s+' tokens/s</div>';
  else if (m.stopped) h+='<div class="adm-meta">Stopped.</div>';
  return h;
}
function admRenderMsgs(){
  var el=document.getElementById('admMsgs'); if(!el) return;
  var mode=ADM.mode, list=ADM.msgs[mode];
  if (!list.length){ el.innerHTML=admEmptyHtml(); return; }
  el.innerHTML=list.map(function(m,i){ return m.role==='user' ? '<div class="adm-m user">'+admEsc(m.content)+'</div>'
    : '<div class="adm-m assistant" id="admMsg_'+mode+'_'+i+'">'+admMsgInner(m,i,mode)+'</div>'; }).join('');
  el.scrollTop=el.scrollHeight;
}
function admPaint(mode, idx, final){
  if (mode!==ADM.mode) return;
  var now=Date.now(); if (!final && now-ADM.lastPaint<60) return; ADM.lastPaint=now;
  var el=document.getElementById('admMsg_'+mode+'_'+idx), box=document.getElementById('admMsgs');
  if (el && !final){ el.innerHTML=admMsgInner(ADM.msgs[mode][idx],idx,mode); if (box) box.scrollTop=box.scrollHeight; } else admRenderMsgs();
}

/* ----- Talking to the API ----- */
function admHeaders(){ var h={'Content-Type':'application/json'}; if (ADM.token) h['X-Admin-Token']=ADM.token; return h; }
function admConnText(){
  return { file:'This copy is opened as a local file. Run the Docker deployment (docker compose up) and open it through the web server to use the AI analyst. Everything else works offline.',
           offline:'No connection to the AI analyst API in this environment. Everything else in the dashboard works offline.',
           down:'The AI analyst API is not reachable. Check the deployment: docker compose ps.',
           ollama:'The API is up but cannot reach Ollama. Check: docker compose logs ollama.',
           model:'The model is not pulled yet. On the Docker host run: docker compose run --rm ollama-init',
           token:'Enter the Administrator token to unlock the analyst.',
           unknown:'Checking the connection…' }[ADM.conn] || '';
}
function admLed(id,st){ var el=document.getElementById(id); if(el) el.className='led '+st; }
function admRenderStatus(){
  var h=ADM.health, c=ADM.conn;
  admLed('admLedApi', h?'good':(c==='unknown'?'off':'alarm')); setTxt('admApi', h?('ok · v'+h.version):(c==='file'?'not served (local file)':(c==='unknown'?'checking…':'unreachable')));
  admLed('admLedOll', h&&h.ollama?'good':(h?'alarm':'off')); setTxt('admOll', h&&h.ollama?('v'+h.ollama_version):(h?'unreachable':'—'));
  admLed('admLedModel', h&&h.model_available?'good':(h&&h.ollama?'warn':'off')); setTxt('admModel', h?(h.model+(h.model_available?'':' · not pulled')):'—');
  var rt=ADM.runtime, lm=rt&&rt.loaded&&rt.loaded[0];
  setTxt('admRt', lm?(lm.gpu_pct+'% GPU · ctx '+(lm.context_length||h.num_ctx)):(h&&h.model_available?'loads on first question':'—'));
  setTxt('admBannerModel', h?('Model '+h.model+' · context '+h.num_ctx):'Model —');
  var tok=document.getElementById('admTok'); if (tok) tok.style.display = (h && h.auth_required) ? 'inline-flex' : 'none';
  if (!ADM.msgs[ADM.mode].length) admRenderMsgs();
}
async function admCheck(manual){
  ADM.health=null; ADM.runtime=null;
  if (typeof fetch!=='function'){ ADM.conn='offline'; admRenderStatus(); return; }
  if (typeof location!=='undefined' && location.protocol==='file:' && !window.DCOA_API_BASE){ ADM.conn='file'; admRenderStatus(); return; }
  ADM.conn='unknown'; admRenderStatus();
  try {
    var r=await fetch(ADM_API+'/health',{cache:'no-store'}); if (!r.ok) throw new Error('HTTP '+r.status);
    var h=await r.json(); ADM.health=h;
    ADM.conn = !h.ollama ? 'ollama' : (!h.model_available ? 'model' : 'ok');
    if (h.auth_required && !ADM.token && ADM.conn==='ok') ADM.conn='token';
    if (h.ollama && (!h.auth_required || ADM.token)){
      try { var rr=await fetch(ADM_API+'/runtime',{headers:admHeaders(),cache:'no-store'});
            if (rr.status===401){ ADM.conn='token'; } else if (rr.ok) ADM.runtime=await rr.json(); } catch(e){}
    }
  } catch(e){ ADM.conn='down'; }
  admRenderStatus();
  if (manual) setTxt('admFoot', ADM.conn==='ok'?'Connected to the AI analyst.':admConnText());
}
function admSaveToken(){
  var el=document.getElementById('admTokIn'); var v=el?String(el.value||'').trim():''; if(!v) return;
  ADM.token=v; try { localStorage.setItem('dcoaAdminToken',v); } catch(e){}
  if (typeof fetch!=='function') return;
  fetch(ADM_API+'/auth/check',{method:'POST',headers:admHeaders()}).then(function(r){
    setTxt('admFoot', r.ok?'Administrator token accepted.':'Token rejected.'); if (r.ok && el) el.value=''; if (!r.ok){ ADM.token=''; try{ localStorage.removeItem('dcoaAdminToken'); }catch(e){} }
    admCheck(false);
  }).catch(function(){ setTxt('admFoot','Could not reach the API to check the token.'); });
}
function admBusy(b){ ADM.busy=b; var s=document.getElementById('admSend'), t=document.getElementById('admStop'); if(s) s.disabled=b; if(t) t.style.display=b?'inline-block':'none'; }
function admAsk(q){ admSetEl('admIn','value',q); admSend(); }
function admKey(e){ if (e && e.key==='Enter' && !e.shiftKey){ if (e.preventDefault) e.preventDefault(); admSend(); } }
function admStop(){ if (ADM.ctrl) try { ADM.ctrl.abort(); } catch(e){} }
function admClear(){ if (ADM.busy) admStop(); ADM.msgs[ADM.mode]=[]; admRenderMsgs(); setTxt('admFoot',''); }
function admOnEvent(msg, ev, mode){
  if (ev.type==='start') msg.model=ev.model;
  else if (ev.type==='thinking') msg.thinking+=ev.text||'';
  else if (ev.type==='content') msg.content+=ev.text||'';
  else if (ev.type==='proposal') msg.proposal={settings:ev.settings||{}, rationale:ev.rationale||'', warnings:ev.warnings||[]};
  else if (ev.type==='error'){ msg.error=ev.message||'Error'; msg.hint=ev.hint||''; msg.streaming=false; }
  else if (ev.type==='done'){ msg.stats=ev.stats||null; msg.streaming=false; }
}
async function admSend(){
  var inp=document.getElementById('admIn'), text=inp?String(inp.value||'').trim():'';
  if (!text || ADM.busy) return;
  var mode=ADM.mode, list=ADM.msgs[mode];
  if (inp) inp.value='';
  list.push({role:'user', content:text});
  var msg={role:'assistant', content:'', thinking:'', proposal:null, streaming:true, error:null, hint:'', stats:null, model:''};
  list.push(msg); var idx=list.length-1; admRenderMsgs();
  if (typeof fetch!=='function' || ADM.conn==='file' || ADM.conn==='offline'){
    msg.streaming=false; msg.error='AI analyst not connected.'; msg.hint=admConnText(); admRenderMsgs(); return; }
  var hist=list.slice(0,-1).filter(function(m){ return m.content && !m.error; }).slice(-12).map(function(m){ return {role:m.role, content:m.content}; });
  var body={ mode:mode, messages:hist, think:!!(document.getElementById('admThink')||{}).checked, context: mode==='twin' ? admTwinContext() : buildSnapshot() };
  admBusy(true); ADM.ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
  try {
    var r=await fetch(ADM_API+'/chat',{method:'POST', headers:admHeaders(), signal:ADM.ctrl?ADM.ctrl.signal:undefined, body:JSON.stringify(body)});
    if (!r.ok){ var d=''; try { d=(await r.json()).detail; } catch(e){}
      msg.error = r.status===401 ? 'Administrator token required or rejected.' : ('The API returned HTTP '+r.status+(d?': '+d:''));
      if (r.status===401){ ADM.conn='token'; ADM.token=''; admRenderStatus(); msg.hint=admConnText(); }
    } else {
      var reader=r.body.getReader(), dec=new TextDecoder(), buf='';
      while (true){
        var ch=await reader.read(); if (ch.done) break;
        buf+=dec.decode(ch.value,{stream:true});
        var parts=buf.split('\n\n'); buf=parts.pop();
        parts.forEach(function(p){ p.split('\n').forEach(function(line){ if (line.indexOf('data:')===0){ try { admOnEvent(msg, JSON.parse(line.slice(5)), mode); } catch(e){} } }); });
        admPaint(mode, idx, false);
      }
    }
  } catch(e){
    if (e && e.name==='AbortError') msg.stopped=true; else { msg.error='Connection to the AI analyst failed.'; msg.hint='Check the deployment: docker compose ps'; }
  }
  msg.streaming=false; admBusy(false); ADM.ctrl=null; admPaint(mode, idx, true);
  if (msg.stats && msg.stats.tokens_per_s) setTxt('admFoot','Answer by '+(msg.model||'model')+' · '+msg.stats.tokens_per_s+' tokens/s. AI output is advisory; check it against the dashboard.');
}

/* ----- Mode, side panels, tick hook ----- */
function admSetMode(m){
  ADM.mode=m;
  var a=document.getElementById('admModeA'), t=document.getElementById('admModeT');
  if (a) a.classList.toggle('on', m==='analyse'); if (t) t.classList.toggle('on', m==='twin');
  var ca=document.getElementById('admCtxA'), ct=document.getElementById('admCtxT');
  if (ca) ca.style.display = m==='analyse' ? '' : 'none'; if (ct) ct.style.display = m==='twin' ? '' : 'none';
  var chips=document.getElementById('admChips');
  if (chips) chips.innerHTML=ADM_CHIPS[m].map(function(c,i){ return '<button type="button" onclick="admChip('+i+')">'+admEsc(c.l)+'</button>'; }).join('');
  admSetEl('admIn','placeholder', m==='analyse' ? 'Ask about the current state (Enter to send, Shift+Enter for a new line)' : 'Ask about the what-if scenario or request a proposal');
  if (m==='twin' && !ADM.scn) ADM.scn=scnRead();
  admRenderMsgs(); admRenderSide(true);
}
var ADM_SL=[ ['util','GPU utilisation',10,100,1,function(v){ return Math.round(v*100)+' %'; },function(x){ return x/100; },function(v){ return Math.round(v*100); }],
             ['nodesPerRack','Nodes per DLC rack',1,8,1,function(v){ return v; }],
             ['dlcRacks','DLC racks',1,23,1,function(v){ return v; }],
             ['dlcShare','Cold-plate capture (no doors)',0,100,1,function(v){ return Math.round(v*100)+' %'; },function(x){ return x/100; },function(v){ return Math.round(v*100); }],
             ['tOut','Outdoor temperature',-5,35,1,function(v){ return v+' °C'; }],
             ['secSupply','SFN supply (what-if)',16,30,0.1,function(v){ return (+v).toFixed(1)+' °C'; }] ];
function admBuildSliders(){
  var box=document.getElementById('admSliders'); if(!box) return;
  box.innerHTML='<div class="adm-sl"><div class="h"><span>Rear-door heat exchangers</span><b id="admSlV_rearDoors">—</b></div><div class="mode-toggle"><button type="button" id="admRdOn" onclick="admScnSet(\'rearDoors\',true)">Fitted</button><button type="button" id="admRdOff" onclick="admScnSet(\'rearDoors\',false)">Removed</button></div></div>'
   + ADM_SL.map(function(s){ var max = s[0]==='dlcRacks' ? scnMaxDlc() : s[3];
       return '<div class="adm-sl"><div class="h"><span>'+s[1]+'</span><b id="admSlV_'+s[0]+'">—</b></div><input class="slider" type="range" id="admSl_'+s[0]+'" min="'+s[2]+'" max="'+max+'" step="'+s[4]+'" oninput="admScnSet(\''+s[0]+'\',this.value)" onchange="admScnSet(\''+s[0]+'\',this.value,true)" aria-label="'+s[1]+'"></div>'; }).join('');
  ADM.slidersBuilt=true;
}
function admScnSet(k,v,commit){
  var s=ADM_SL.filter(function(x){ return x[0]===k; })[0], p={};
  p[k] = (s && s[6]) ? s[6](parseFloat(v)) : v;
  ADM.scn=scnMerge(ADM.scn||scnRead(), p);
  ADM.dragging = !!s && !commit;            // sliders: headroom search waits for release (onchange); buttons: immediate
  admRenderSide(true);
}
function admScnFromTwin(){ ADM.scn=scnRead(); admRenderSide(true); setTxt('admFoot','What-if reset to the current Digital Twin configuration.'); }
function admCell(e, k, p){ var o=e; k.split('.').forEach(function(x){ o=o==null?null:o[x]; }); return o==null?'—':o; }
function admRenderTwinSide(force){
  if (!ADM.slidersBuilt) admBuildSliders();
  var cur=scnRead(), sc=ADM.scn=scnMerge(cur, ADM.scn||cur);
  var sig=JSON.stringify([cur,sc,CX.u.map(cxAvail),CX.cdu.map(function(c){ return c.fail; }),HALL.map(function(r){ return r.on?r.plat+r.nodes+(r.plat==='AIR'?JSON.stringify(r.air)+JSON.stringify(r.opt)+r.door:''):''; })]);
  var fresh=false;
  if (sig!==ADM.scnSig){ ADM.ev={cur:scnEval(cur,true), scn:scnEval(sc,true), ref:scnEval(scnReference(),true)}; ADM.scnSig=sig; ADM.hrSig=''; fresh=true; }
  if (ADM.hrSig!==sig && !ADM.dragging){ ADM.ev.scn.headroom=scnHeadroom(sc); ADM.hrSig=sig; fresh=true; }
  if (!fresh && !force) return;
  ADM_SL.forEach(function(s){ var k=s[0], el=document.getElementById('admSl_'+k), v=sc[k];
    if (el) el.value = s[7] ? s[7](v) : v;
    var b=document.getElementById('admSlV_'+k); if (b){ b.textContent=s[5](v); b.className = v!==cur[k] ? 'chg' : ''; } });
  var on=document.getElementById('admRdOn'), off=document.getElementById('admRdOff');
  if (on) on.classList.toggle('on', !!sc.rearDoors); if (off) off.classList.toggle('on', !sc.rearDoors);
  var rb=document.getElementById('admSlV_rearDoors'); if (rb){ rb.textContent=sc.rearDoors?'fitted':'removed'; rb.className = sc.rearDoors!==cur.rearDoors?'chg':''; }
  var E=ADM.ev, v=E.scn.verdict;
  setHtml('admVerdict','<div class="adm-vd"><span class="pill '+v.level+'">'+v.label+'</span><span>Binding: <b>'+admEsc(v.binding)+'</b> at '+v.bindingPct+' % of limit'+(v.throttling?' · GPU throttling':'')+'</span></div>');
  var R=[ ['Racks · GPUs', function(e){ return e.load.racks+' · '+e.load.gpus; }],
          ['GPU utilisation', function(e){ return e.load.gpuUtilPct+' %'; }],
          ['Hall IT (kW)', function(e){ return e.power.hallItKw; }, 'power.hallItKw', 0],
          ['Facility (kW)', function(e){ return e.power.facilityKw; }, 'power.facilityKw', 0],
          ['PUE live', function(e){ return e.power.pueLive; }, 'power.pueLive', 3],
          ['PUE annualised', function(e){ return e.power.pueAnnualised; }, 'power.pueAnnualised', 3],
          ['Peak GPU (°C)', function(e){ return e.cooling.peakGpuC; }, 'cooling.peakGpuC', 1],
          ['CDU N+1 (%)', function(e){ return e.cooling.cduN1Pct; }, 'cooling.cduN1Pct', 0],
          ['Room heat / CRAC (kW)', function(e){ return e.cooling.roomHeatKw+' / '+e.cooling.cracCapacityKw; }],
          ['Carbon (t CO₂/yr)', function(e){ return e.sustainability.annualCarbonT; }, 'sustainability.annualCarbonT', 0],
          ['Saved vs air (€k/yr)', function(e){ return e.sustainability.costSavedVsAirEurK; }] ];
  setHtml('admCmp','<tr><th></th><th>Baseline</th><th>Current</th><th>Scenario</th></tr>'+R.map(function(r){
    var d='';
    if (r[2]){ var a=admCell(E.cur,r[2]), b=admCell(E.scn,r[2]); if (typeof a==='number' && typeof b==='number' && admR(b-a,r[3])!==0){ var dv=admR(b-a,r[3]); d='<span class="dl '+(dv>0?'up':'dn')+'">'+(dv>0?'+':'')+dv+'</span>'; } }
    return '<tr><td>'+r[0]+'</td><td>'+r[1](E.ref)+'</td><td>'+r[1](E.cur)+'</td><td class="sc">'+r[1](E.scn)+d+'</td></tr>'; }).join(''));
  var h=E.scn.headroom;
  setHtml('admHead', !h ? 'Headroom search runs when you release the slider…' : ('Headroom from this scenario (one lever at a time, nothing over 100 %): up to <b>'+h.maxNodesPerRackWithinLimits+'</b> nodes/rack'
     +(h.firstNodesPerRackAt90pct?' (near limits from '+h.firstNodesPerRackAt90pct+')':'')+', up to <b>'+h.maxGpuUtilPctWithinLimits+' %</b> GPU, up to <b>'+h.maxDlcRacksWithinLimits+'</b> DLC racks. Baseline = reference layout (8 DLC racks × 4 nodes, 93 %, rear doors, 10 °C).'));
  var det=document.getElementById('admJsonTDet'); if (det && det.open) setTxt('admJsonT', JSON.stringify(admTwinContext(), null, 1));
}
function setHtml(id,v){ var el=document.getElementById(id); if (el && el.innerHTML!==v) el.innerHTML=v; }
function admRenderAnalyseSide(){
  var s=buildSnapshot(), b=s.binding;
  var it=[ ['Overall status', s.overallStatus.toUpperCase()], ['Hall IT', s.power.hallItKw+' kW'], ['PUE live / annual', s.power.pueLive+' / '+s.power.pueAnnualised],
           ['Binding limit', b.constraint+' '+b.pctOfLimit+' %'], ['Peak GPU', s.gpu.peakC+' °C'+(s.gpu.throttlePct?' · throttling':'')], ['CDU N+1 load', s.cooling.cduN1LoadPct+' %'],
           ['Room', s.cooling.roomTempC+' °C'], ['Heat to water', s.cooling.heatCapturedToWaterPct+' %'], ['Active BMS alarms', String(s.alarms.bmsActive.length)], ['Racks · GPUs', s.load.racks+' · '+s.load.gpus] ];
  setHtml('admSum', it.map(function(x){ return '<div class="cs"><div class="n">'+x[0]+'</div><div class="v mono">'+admEsc(x[1])+'</div></div>'; }).join(''));
  var det=document.getElementById('admJsonDet'); if (det && det.open) setTxt('admJson', JSON.stringify(s, null, 1));
}
function admRenderSide(force){ if (ADM.mode==='twin') admRenderTwinSide(force); else admRenderAnalyseSide(); }
function admOnShow(){
  if (!ADM.shown){ ADM.shown=true; admSetMode(ADM.mode); }
  if (!ADM.checked){ ADM.checked=true; admCheck(false); }
}
function renderAdmin(){
  ADM.sideTick++;
  if (ADM.mode==='analyse') admRenderAnalyseSide();
  else { if (ADM.dragging && ADM.sideTick%2===0) ADM.dragging=false;   // safety net if a slider release event was missed
         if (ADM.sideTick%5===0 || ADM.hrSig!==ADM.scnSig) admRenderTwinSide(false); }   // live changes (auto load cycle, CRAC/CDU faults) refresh the comparison
}
