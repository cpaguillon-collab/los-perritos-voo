/* mejoras.js — precio en vivo, meta dinámica y análisis de rendimiento
   Se carga DESPUÉS del script principal de index.html */
(function(){
const $ = id => document.getElementById(id);
const fmtUSD = v => '$' + Math.round(v).toLocaleString('en-US');
const fmtCOP = v => 'COP ' + Math.round(v).toLocaleString('es-CO');
const pct = v => (v>=0?'+':'') + (v*100).toFixed(1) + '%';
let hist = [];            // [{t:ms, c:close}]
let marketTime = null, priceSource = 'estático';
let perfChart = null;

/* ───────── 1. Datos de mercado (precio, histórico, TRM) ───────── */
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/VOO?range=5y&interval=1d';
const routes = [
  u => u,
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?' + encodeURIComponent(u)
];
async function fetchYahoo(){
  for (const r of routes){
    try{
      const res = await fetch(r(YF), {cache:'no-store'});
      if(!res.ok) continue;
      const j = await res.json();
      const R = j.chart.result[0];
      const ts = R.timestamp, cl = R.indicators.quote[0].close;
      const h = ts.map((t,i)=>({t:t*1000, c:cl[i]})).filter(x=>x.c!=null);
      return {h, price:R.meta.regularMarketPrice, time:R.meta.regularMarketTime*1000};
    }catch(e){}
  }
  return null;
}
async function fetchFX(){
  try{
    const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    if(j.rates && j.rates.COP) return j.rates.COP;
  }catch(e){}
  return null;
}
async function refreshMarket(){
  const [y, fx] = await Promise.all([fetchYahoo(), fetchFX()]);
  if(y){
    hist = y.h; PRICE = y.price; marketTime = y.time; priceSource = 'Yahoo Finance';
    localStorage.setItem('voo_last', JSON.stringify({p:PRICE, t:marketTime}));
  } else {
    try{ const c = JSON.parse(localStorage.getItem('voo_last')); if(c){ PRICE=c.p; marketTime=c.t; priceSource='último precio guardado'; } }catch(e){}
  }
  if(fx) USD_COP = fx;
  renderLive();
}
function renderLive(){
  refreshDashboard();
  const slider = $('rateSlider'); if(slider) slider.dispatchEvent(new Event('input')); // recalcula gráficas/escenarios
  if($('m-price')) $('m-price').textContent = '$' + PRICE.toFixed(2);
  if($('m-price-cop')) $('m-price-cop').textContent = 'por acción · USD';
  const when = marketTime ? new Date(marketTime).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
  const f = document.querySelector('.footer-insight');
  if(f) f.innerHTML = 'Precio VOO: <b>$'+PRICE.toFixed(2)+'</b> ('+priceSource+', cierre/último dato '+when+'; puede tener ~15 min de retraso). Rendimiento pasado no garantiza resultados futuros.';
  renderGoalPanel(); renderPerformance();
}

/* ───────── 2. Stats corregidas (los dividendos no son "invertido") ───────── */
computeStats = function(){
  const buys = purchases.filter(p=>p.type==='compra');
  const divs = purchases.filter(p=>p.type==='dividendo');
  const totalShares = buys.reduce((s,p)=>s+p.shares,0) + divs.reduce((s,p)=>s+(p.shares||0),0);
  const totalCost = buys.reduce((s,p)=>s+p.cost,0);
  const totalDivs = divs.reduce((s,p)=>s+p.cost,0);
  let camiloShares=0, carlosShares=0;
  buys.forEach(p=>{
    if(p.who==='camilo') camiloShares+=p.shares; else if(p.who==='carlos') carlosShares+=p.shares;
    else { camiloShares+=p.shares/2; carlosShares+=p.shares/2; }
  });
  const camiloCOP = buys.reduce((s,p)=>s+p.camilo,0), carlosCOP = buys.reduce((s,p)=>s+p.carlos,0);
  const bs = camiloShares+carlosShares;
  return {totalShares,totalCost,totalDivs,camiloShares,carlosShares,camiloCOP,carlosCOP,
          camiloPct: bs>0?camiloShares/bs:.5, carlosPct: bs>0?carlosShares/bs:.5};
};

/* ───────── 3. Meta $100K que se recalcula con cada compra ───────── */
const closeAt = d => { // último cierre <= fecha
  const t = new Date(d+'T23:59:59').getTime(); let c = null;
  for(const x of hist){ if(x.t<=t) c=x.c; else break; }
  return c;
};
function renderGoalPanel(){
  let el = $('goal-panel');
  if(!el){
    el = document.createElement('div'); el.id='goal-panel'; el.className='controls';
    el.style.cssText='margin-top:1rem'; document.querySelector('.progress-section').after(el);
  }
  const {totalShares} = computeStats();
  const val = totalShares*PRICE, falta = Math.max(GOAL-val,0), accFalta = falta/PRICE;
  const rate = parseFloat($('rateSlider').value), buy = parseInt($('buySlider').value);
  const sim = simulate(rate, buy);
  // avance del último mes: mismas acciones de hace 30 días a precio de hace 30 días
  const cut = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  const sharesThen = purchases.filter(p=>p.date<=cut).reduce((s,p)=>s+(p.type==='compra'?p.shares:0),0);
  const pThen = closeAt(cut);
  const valThen = pThen ? sharesThen*pThen : null;
  const delta = valThen!=null ? (val-valThen)/GOAL*100 : null;
  const nextHito = [10000,25000,50000,75000,100000].find(h=>h>val) || GOAL;
  const box = (l,v,s)=>`<div><div class="sp-label" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">${l}</div><div style="font-family:var(--font-display);font-size:1.4rem;color:var(--accent)">${v}</div><div style="font-size:.78rem;color:var(--muted)">${s}</div></div>`;
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.25rem" class="goal-grid">
    ${box('Falta para $100K', fmtUSD(falta), '≈ '+accFalta.toFixed(1)+' acciones al precio de hoy')}
    ${box('Avance del último mes', delta!=null?(delta>=0?'+':'')+delta.toFixed(2)+' pts':'—', 'de la meta, por compras + mercado')}
    ${box('Próximo hito', fmtUSD(nextHito), 'faltan '+fmtUSD(nextHito-val))}
    ${box('Llegada (al ritmo actual)', sim.goalMonth>0?(sim.goalMonth/12).toFixed(1)+' años':'>15 años', (sim.goalMonth>0?goalDate(sim.goalMonth):'—')+' · '+rate+'% · '+buy+' acc/mes')}
  </div>`;
}
// los hitos usan la fecha real de hoy
renderMilestones = function(annualRate, monthlyBuy){
  const {totalShares} = computeStats(); const cur = totalShares*PRICE;
  const d = simulate(annualRate, monthlyBuy);
  const ms=[{val:cur,label:'Hoy',reached:true},{val:10000,label:'$10K'},{val:25000,label:'$25K'},{val:50000,label:'$50K'},{val:75000,label:'$75K'},{val:100000,label:'$100K',goal:true}];
  const dots=$('milestoneDots'); dots.innerHTML='';
  ms.forEach(m=>{
    const done = !m.reached && cur>=m.val;
    const month = d.vals.findIndex(v=>v>=m.val);
    const el=document.createElement('div');
    el.className='milestone-dot'+((m.reached||done)?' reached':'')+(m.goal?' goal':'');
    el.innerHTML=`<div class="dot-circle">${(m.reached||done)?'✓':month>0?Math.round(month/12)+'a':'?'}</div><div class="dot-value">${m.label}</div><div class="dot-label">${m.reached?new Date().toLocaleDateString('es-CO',{month:'short',year:'numeric'}):done?'¡Logrado!':month>0?goalDate(month):'—'}</div>`;
    dots.appendChild(el);
  });
};

/* ───────── 4. Rendimiento desde el inicio ───────── */
function xirr(flows){ // [{d:Date, a:number}]
  const t0 = flows[0].d, f = r => flows.reduce((s,x)=>s+x.a/Math.pow(1+r,(x.d-t0)/(365*864e5)),0);
  let lo=-0.99, hi=10; if(f(lo)*f(hi)>0) return null;
  for(let i=0;i<200;i++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; }
  return (lo+hi)/2;
}
function injectTab(){
  if($('page-rendimiento')) return;
  const b=document.createElement('button'); b.className='tab-btn'; b.textContent='Rendimiento';
  b.onclick=function(){ switchTab('rendimiento', b); };
  document.querySelector('.tab-nav-inner .tab-btn:nth-of-type(2)').after(b);
  const p=document.createElement('div'); p.id='page-rendimiento'; p.className='page';
  p.innerHTML=`<div class="container"><div class="registro-header"><h1>Rendimiento <span style="color:var(--accent);font-style:italic">desde el inicio</span></h1><p id="perf-sub"></p></div>
  <div class="reg-summary" id="perf-cards" style="grid-template-columns:repeat(4,1fr)"></div>
  <div class="chart-section"><div class="chart-header"><h2>Valor vs. invertido (USD)</h2></div><div class="chart-wrap"><canvas id="perfChart"></canvas></div></div>
  <div class="ownership-section" id="perf-people"></div>
  <div class="ownership-section" id="perf-insights"></div></div>`;
  $('page-registro').after(p);
}
switchTab = function(tab, btn){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
  $('page-'+tab).classList.add('active');
  (btn || [...document.querySelectorAll('.tab-btn')].find(x=>(x.getAttribute('onclick')||'').includes("'"+tab+"'")))?.classList.add('active');
  if(tab==='registro') renderRegistro();
  if(tab==='rendimiento') renderPerformance();
};
function renderPerformance(){
  injectTab();
  const buys = purchases.filter(p=>p.type==='compra').sort((a,b)=>a.date.localeCompare(b.date));
  if(!buys.length || !$('perf-cards')) return;
  const s = computeStats(), valUSD = s.totalShares*PRICE, valCOP = valUSD*USD_COP;
  const invCOP = s.totalCost, fees = buys.reduce((a,p)=>a+p.fee,0);
  const gainCOP = valCOP + s.totalDivs - invCOP, retCOP = gainCOP/invCOP;
  let costUSD = 0, haveHist = hist.length>0;
  if(haveHist) buys.forEach(p=>{ const c=closeAt(p.date); costUSD += p.shares*(c!=null?c:PRICE); });
  const gainUSD = valUSD-costUSD, retUSD = haveHist&&costUSD>0 ? gainUSD/costUSD : null;
  const avgUSD = haveHist ? costUSD/s.totalShares : null, avgCOP = invCOP/s.totalShares;
  const days = Math.max((Date.now()-new Date(buys[0].date+'T00:00:00'))/864e5,1);
  const flows = buys.map(p=>({d:new Date(p.date+'T00:00:00'),a:-p.cost}))
    .concat(purchases.filter(p=>p.type==='dividendo').map(p=>({d:new Date(p.date+'T00:00:00'),a:p.cost})));
  flows.sort((a,b)=>a.d-b.d); flows.push({d:new Date(),a:valCOP});
  const irr = days>=365 ? xirr(flows) : null;

  $('perf-sub').textContent = `Desde ${new Date(buys[0].date+'T00:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'})} · ${buys.length} compras · ${Math.round(days)} días · precio ${PRICE.toFixed(2)} USD · TRM ${Math.round(USD_COP)}`;
  const card=(l,v,sub,c)=>`<div class="reg-card"><div class="rc-label">${l}</div><div class="rc-value" style="${c?'color:'+c:''}">${v}</div><div class="rc-sub">${sub}</div></div>`;
  const col = v => v>=0?'var(--accent)':'var(--red)';
  $('perf-cards').innerHTML =
    card('Invertido', fmtCOP(invCOP), 'incluye '+fmtCOP(fees)+' en comisiones') +
    card('Valor hoy', fmtCOP(valCOP), fmtUSD(valUSD)+' USD') +
    card('Ganancia en COP', (gainCOP>=0?'+':'')+fmtCOP(gainCOP), pct(retCOP)+' (incluye efecto dólar)', col(gainCOP)) +
    card('Ganancia en USD', retUSD!=null?(gainUSD>=0?'+':'')+fmtUSD(gainUSD):'—', retUSD!=null?pct(retUSD)+' solo por VOO (estimado)':'sin histórico de precios', retUSD!=null?col(gainUSD):'') +
    card('Costo promedio', avgUSD?('$'+avgUSD.toFixed(2)):'—', fmtCOP(avgCOP)+' por acción') +
    card('Precio de equilibrio', avgUSD?('$'+(avgUSD+ (fees/USD_COP)/s.totalShares).toFixed(2)):'—', 'VOO debe superarlo para ganar tras comisiones') +
    card('Retorno anualizado', irr!=null?pct(irr):'—', irr!=null?'XIRR en COP':'se calcula al cumplir 1 año') +
    card('Dividendos', fmtCOP(s.totalDivs), 'recibidos');

  // gráfica mensual
  if(haveHist){
    const start = new Date(buys[0].date+'T00:00:00'); const labels=[], v=[], c=[];
    for(let d=new Date(start.getFullYear(),start.getMonth(),1); d<=new Date(); d.setMonth(d.getMonth()+1)){
      const end = new Date(d.getFullYear(),d.getMonth()+1,0); const cap = end>new Date()?new Date():end;
      const iso = cap.toISOString().slice(0,10), held = buys.filter(p=>p.date<=iso);
      const px = closeAt(iso) ?? PRICE;
      labels.push(cap.toLocaleDateString('es-CO',{month:'short',year:'2-digit'}));
      v.push(Math.round(held.reduce((a,p)=>a+p.shares,0)*px));
      c.push(Math.round(held.reduce((a,p)=>a+p.shares*(closeAt(p.date)??PRICE),0)));
    }
    v[v.length-1]=Math.round(valUSD);
    if(perfChart) perfChart.destroy();
    perfChart = new Chart($('perfChart'),{type:'line',data:{labels,datasets:[
      {label:'Valor',data:v,borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.08)',fill:true,tension:.3,borderWidth:2,pointRadius:2},
      {label:'Invertido (a precio de compra)',data:c,borderColor:'#3b82f6',borderDash:[4,3],tension:.3,borderWidth:1.5,pointRadius:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8'}}},
        scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',callback:x=>'$'+x.toLocaleString()},grid:{color:'#1e293b'}}}}});
  }

  // por persona
  const P=(n,sh,cop,colr)=>{const v=sh*PRICE*USD_COP; return `<div style="flex:1;min-width:200px"><div style="color:${colr};font-weight:600;margin-bottom:.3rem">${n}</div>
    <div style="font-size:.85rem;color:var(--muted)">${sh.toFixed(1)} acciones · aportó ${fmtCOP(cop)}</div>
    <div style="font-family:var(--font-display);font-size:1.3rem">${fmtCOP(v)} <span style="font-size:.9rem;color:${col(v-cop)}">${cop>0?pct((v-cop)/cop):''}</span></div></div>`;};
  $('perf-people').innerHTML = `<h3>Rendimiento por perrito</h3><div style="display:flex;gap:2rem;flex-wrap:wrap">${P('Camilo',s.camiloShares,s.camiloCOP,'var(--camilo)')}${P('Carlos',s.carlosShares,s.carlosCOP,'var(--carlos)')}</div>`;

  // lectura del análisis
  const feePct = fees/invCOP*100, perBuy = fees/buys.length;
  const fxPart = retUSD!=null ? retCOP-retUSD : null;
  const notes = [
    `Llevan <b>${s.totalShares.toFixed(1)} acciones</b> y un retorno de <b style="color:${col(retCOP)}">${pct(retCOP)}</b> en COP sobre ${fmtCOP(invCOP)} aportados.`,
    fxPart!=null ? `De ese resultado, el efecto del dólar (TRM) explica aprox. <b>${(fxPart*100).toFixed(1)} puntos</b>: ${fxPart>=0?'el peso débil les ayudó':'el peso fuerte les restó'}; el resto es el movimiento propio de VOO.` : '',
    `Las comisiones suman <b>${feePct.toFixed(2)}%</b> de lo invertido (${fmtCOP(perBuy)} por compra). Al comprar solo 1 acción por vez la comisión pesa más; comprar 2 acciones cada 2 meses con una sola comisión la reduciría a la mitad.`,
    days<365 ? 'Con menos de 1 año de historia, el % total es más confiable que un retorno anualizado; no proyectes ese número.' : '',
    'Cálculo con cierres diarios de Yahoo Finance y TRM actual (no histórica): es una estimación, no un extracto de Trii.'
  ].filter(Boolean);
  $('perf-insights').innerHTML = '<h3>Lectura del rendimiento</h3><ul style="margin-left:1.2rem;line-height:1.7;color:var(--text);font-size:.92rem">'+notes.map(n=>'<li>'+n+'</li>').join('')+'</ul>';
}

/* ───────── 5. Arranque y refresco en vivo ───────── */
const _init = initDashboard;
initDashboard = function(){
  _init(); injectTab(); renderGoalPanel();
  $('rateSlider').addEventListener('input', renderGoalPanel);
  $('buySlider').addEventListener('input', renderGoalPanel);
  refreshMarket();
  setInterval(()=>{ if(!document.hidden) refreshMarket(); }, 60000);
};
// al registrar una compra: recalcular meta y rendimiento
const _refresh = refreshDashboard;
refreshDashboard = function(){ _refresh(); if(typeof renderGoalPanel==='function' && $('rateSlider')){ renderGoalPanel(); renderPerformance(); } };

/* ───────── 6. Todo en USD ───────── */
const usdCost = p => p.shares>0 ? p.shares*(closeAt(p.date) ?? (p.cost/USD_COP/p.shares)) + (p.fee||0)/USD_COP : p.cost/USD_COP;
const D2 = v => '$' + v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function usdStats(){
  const buys = purchases.filter(p=>p.type==='compra'), divs = purchases.filter(p=>p.type==='dividendo');
  const s = computeStats(); let cam=0, car=0;
  buys.forEach(p=>{ const c=usdCost(p); if(p.who==='camilo') cam+=c; else if(p.who==='carlos') car+=c; else {cam+=c/2; car+=c/2;} });
  return {s, buys, divs, inv:buys.reduce((a,p)=>a+usdCost(p),0), fees:buys.reduce((a,p)=>a+(p.fee||0)/USD_COP,0),
          divUSD:divs.reduce((a,p)=>a+p.cost/USD_COP,0), cam, car, val:s.totalShares*PRICE};
}
renderRegistro = function(){
  const u=usdStats(), s=u.s;
  $('rc-shares').textContent = s.totalShares.toFixed(1);
  $('rc-total').textContent = D2(u.inv);
  $('rc-total-cop').textContent = 'USD · valor hoy ' + D2(u.val);
  $('rc-camilo-shares').textContent = s.camiloShares.toFixed(1);
  $('rc-camilo-cop').textContent = D2(u.cam) + ' USD aportados';
  $('rc-carlos-shares').textContent = s.carlosShares.toFixed(1);
  $('rc-carlos-cop').textContent = D2(u.car) + ' USD aportados';
  $('rc-divs').textContent = D2(u.divUSD);
  document.querySelectorAll('.reg-card .rc-sub').forEach(e=>{ if(e.textContent==='COP recibidos') e.textContent='USD recibidos'; });
  const cp=(s.camiloPct*100).toFixed(1), crp=(s.carlosPct*100).toFixed(1);
  $('own-bar-camilo').style.width=cp+'%'; $('own-bar-carlos').style.width=crp+'%';
  $('own-legend-camilo').textContent=`Camilo — ${cp}% (${s.camiloShares.toFixed(1)} acc · ${D2(s.camiloShares*PRICE)})`;
  $('own-legend-carlos').textContent=`Carlos — ${crp}% (${s.carlosShares.toFixed(1)} acc · ${D2(s.carlosShares*PRICE)})`;
  renderTable();
};
renderPerformance = function(){
  injectTab();
  const u=usdStats(), s=u.s, buys=u.buys.slice().sort((a,b)=>a.date.localeCompare(b.date));
  if(!buys.length || !$('perf-cards')) return;
  const gain=u.val+u.divUSD-u.inv, ret=gain/u.inv, avg=u.inv/s.totalShares;
  const days=Math.max((Date.now()-new Date(buys[0].date+'T00:00:00'))/864e5,1);
  const flows=buys.map(p=>({d:new Date(p.date+'T00:00:00'),a:-usdCost(p)}))
    .concat(u.divs.map(p=>({d:new Date(p.date+'T00:00:00'),a:p.cost/USD_COP}))).sort((a,b)=>a.d-b.d);
  flows.push({d:new Date(),a:u.val});
  const irr=days>=365?xirr(flows):null, col=v=>v>=0?'var(--accent)':'var(--red)';
  $('perf-sub').textContent=`Todo en USD · desde ${new Date(buys[0].date+'T00:00:00').toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'})} · ${buys.length} compras · ${Math.round(days)} días · VOO ${D2(PRICE)}`;
  const card=(l,v,sub,c)=>`<div class="reg-card"><div class="rc-label">${l}</div><div class="rc-value" style="${c?'color:'+c:''}">${v}</div><div class="rc-sub">${sub}</div></div>`;
  $('perf-cards').innerHTML =
    card('Invertido', D2(u.inv), 'incluye '+D2(u.fees)+' en comisiones') +
    card('Valor hoy', D2(u.val), s.totalShares.toFixed(1)+' acciones') +
    card('Ganancia', (gain>=0?'+':'')+D2(gain), pct(ret)+' sobre lo invertido', col(gain)) +
    card('Retorno anualizado', irr!=null?pct(irr):'—', irr!=null?'XIRR en USD':'se calcula al cumplir 1 año') +
    card('Costo promedio', D2(avg), 'por acción') +
    card('Precio de equilibrio', D2(avg), 'VOO debe superarlo para ganar') +
    card('Dividendos', D2(u.divUSD), 'recibidos') +
    card('Comisiones', (u.fees/u.inv*100).toFixed(2)+'%', D2(u.fees/buys.length)+' por compra');
  if(hist.length){
    const start=new Date(buys[0].date+'T00:00:00'), labels=[], v=[], c=[];
    for(let d=new Date(start.getFullYear(),start.getMonth(),1); d<=new Date(); d.setMonth(d.getMonth()+1)){
      const end=new Date(d.getFullYear(),d.getMonth()+1,0), cap=end>new Date()?new Date():end, iso=cap.toISOString().slice(0,10);
      const held=buys.filter(p=>p.date<=iso), px=closeAt(iso)??PRICE;
      labels.push(cap.toLocaleDateString('es-CO',{month:'short',year:'2-digit'}));
      v.push(Math.round(held.reduce((a,p)=>a+p.shares,0)*px)); c.push(Math.round(held.reduce((a,p)=>a+usdCost(p),0)));
    }
    v[v.length-1]=Math.round(u.val);
    if(perfChart) perfChart.destroy();
    perfChart=new Chart($('perfChart'),{type:'line',data:{labels,datasets:[
      {label:'Valor (USD)',data:v,borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.08)',fill:true,tension:.3,borderWidth:2,pointRadius:2},
      {label:'Invertido (USD)',data:c,borderColor:'#3b82f6',borderDash:[4,3],tension:.3,borderWidth:1.5,pointRadius:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8'}}},
        scales:{x:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',callback:x=>'$'+x.toLocaleString()},grid:{color:'#1e293b'}}}}});
  }
  const P=(n,sh,inv,colr)=>{const v=sh*PRICE; return `<div style="flex:1;min-width:200px"><div style="color:${colr};font-weight:600;margin-bottom:.3rem">${n}</div>
    <div style="font-size:.85rem;color:var(--muted)">${sh.toFixed(1)} acciones · aportó ${D2(inv)}</div>
    <div style="font-family:var(--font-display);font-size:1.3rem">${D2(v)} <span style="font-size:.9rem;color:${col(v-inv)}">${inv>0?pct((v-inv)/inv):''}</span></div></div>`;};
  $('perf-people').innerHTML=`<h3>Rendimiento por perrito (USD)</h3><div style="display:flex;gap:2rem;flex-wrap:wrap">${P('Camilo',s.camiloShares,u.cam,'var(--camilo)')}${P('Carlos',s.carlosShares,u.car,'var(--carlos)')}</div>`;
  const notes=[
    `Llevan <b>${s.totalShares.toFixed(1)} acciones</b> con un retorno de <b style="color:${col(ret)}">${pct(ret)}</b> sobre ${D2(u.inv)} invertidos.`,
    `Las comisiones suman <b>${(u.fees/u.inv*100).toFixed(2)}%</b> de lo invertido. Con 1 acción por compra pesan más; 2 acciones cada 2 meses con una sola comisión la reducirían a la mitad.`,
    days<365?'Con menos de 1 año de historia, el % total es más confiable que un retorno anualizado.':'',
    'Costo estimado: acciones × cierre diario de VOO en la fecha de compra + comisión convertida a la TRM de hoy. No es un extracto de Trii.'
  ].filter(Boolean);
  $('perf-insights').innerHTML='<h3>Lectura del rendimiento</h3><ul style="margin-left:1.2rem;line-height:1.7;font-size:.92rem">'+notes.map(n=>'<li>'+n+'</li>').join('')+'</ul>';
};
})();
