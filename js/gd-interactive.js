// Common library for 1D Euler gas-dynamics interactives.
// Provides: exact Riemann, Toro tests, solver runner with snapshots, plot/animation controls.
// Usage: call window.GDI.buildInteractive(container, { title, fluxFn, schemeLabel, withRecon }).
// fluxFn(rL,uL,pL,rR,uR,pR,gamma, opts) -> [F_rho, F_mom, F_E]

(function(){
'use strict';

function exactRiemann(rL,uL,pL,rR,uR,pR,gamma,xot){
  var g1=gamma,g2=(g1-1)/(2*g1),g3=(g1+1)/(2*g1),g4=2/(g1-1),g5=2/(g1+1),g6=(g1-1)/(g1+1),g7=(g1-1)/2;
  var aL=Math.sqrt(g1*pL/rL),aR=Math.sqrt(g1*pR/rR);
  function fK(p,pk,rhok,ak){ if(p>pk){ var A=g5/rhok,B=g6*pk; return(p-pk)*Math.sqrt(A/(p+B)); } return g4*ak*(Math.pow(p/pk,g2)-1); }
  function dfK(p,pk,rhok,ak){ if(p>pk){ var A=g5/rhok,B=g6*pk,sq=Math.sqrt(A/(p+B)); return sq*(1-(p-pk)/(2*(p+B))); } return 1/(rhok*ak)*Math.pow(p/pk,-g3); }
  var ps=.5*(pL+pR);
  for(var i=0;i<80;i++){ var f=fK(ps,pL,rL,aL)+fK(ps,pR,rR,aR)+(uR-uL); var df=dfK(ps,pL,rL,aL)+dfK(ps,pR,rR,aR); var dp=-f/df; ps+=dp; if(ps<1e-10)ps=1e-10; if(Math.abs(dp)<1e-12*ps)break; }
  var us=.5*(uL+uR)+.5*(fK(ps,pR,rR,aR)-fK(ps,pL,rL,aL));
  var S=xot, rho,u,p;
  if(S<us){
    if(ps<=pL){ var asL=aL*Math.pow(ps/pL,g2),sHL=uL-aL,sTL=us-asL;
      if(S<=sHL){rho=rL;u=uL;p=pL;}
      else if(S>=sTL){rho=rL*Math.pow(ps/pL,1/g1);u=us;p=ps;}
      else{u=g5*(aL+g7*uL+S); var a=g5*(aL+g7*(uL-S)); rho=rL*Math.pow(a/aL,g4); p=pL*Math.pow(a/aL,2*g1/(g1-1));} }
    else{ var sL=uL-aL*Math.sqrt(g3*ps/pL+g2); if(S<=sL){rho=rL;u=uL;p=pL;} else{rho=rL*(ps/pL+g6)/(g6*ps/pL+1);u=us;p=ps;} }
  } else {
    if(ps<=pR){ var asR=aR*Math.pow(ps/pR,g2),sHR=uR+aR,sTR=us+asR;
      if(S>=sHR){rho=rR;u=uR;p=pR;}
      else if(S<=sTR){rho=rR*Math.pow(ps/pR,1/g1);u=us;p=ps;}
      else{u=g5*(-aR+g7*uR+S); var a=g5*(aR-g7*(uR-S)); rho=rR*Math.pow(a/aR,g4); p=pR*Math.pow(a/aR,2*g1/(g1-1));} }
    else{ var sR=uR+aR*Math.sqrt(g3*ps/pR+g2); if(S>=sR){rho=rR;u=uR;p=pR;} else{rho=rR*(ps/pR+g6)/(g6*ps/pR+1);u=us;p=ps;} }
  }
  return {rho:rho,u:u,p:p};
}

var TESTS = {
  sod:   { rL:1.0, uL:0.0, pL:1.0, rR:0.125, uR:0.0, pR:0.1, tend:0.20, x0:0.5, xmin:0, xmax:1, name:'Sod' },
  '123': { rL:1.0, uL:-2.0, pL:0.4, rR:1.0, uR:2.0, pR:0.4, tend:0.15, x0:0.5, xmin:0, xmax:1, name:'1-2-3' },
  blast: { rL:1.0, uL:0.0, pL:1000.0, rR:1.0, uR:0.0, pR:0.01, tend:0.012, x0:0.5, xmin:0, xmax:1, name:'Left blast' },
  trans: { rL:1.0, uL:0.75, pL:1.0, rR:0.125, uR:0.0, pR:0.1, tend:0.035, x0:0.3, xmin:0, xmax:1, name:'Transonic' }
};

function minmod(a,b){ return a*b<=0 ? 0 : (Math.abs(a)<Math.abs(b) ? a : b); }

function runSolver(fluxFn, T, params){
  var N = params.N, CFL = params.CFL, recon = params.recon, fluxOpts = params.fluxOpts || {};
  var gamma = 1.4, gm1 = gamma - 1;
  var xmin = T.xmin, xmax = T.xmax, dx = (xmax-xmin)/N, tend = T.tend;
  var Ng = 2, Nt = N + 2*Ng;
  var U = [new Float64Array(Nt), new Float64Array(Nt), new Float64Array(Nt)];
  for (var i=0;i<Nt;i++){
    var x = xmin + (i-Ng+0.5)*dx;
    var rr = x < T.x0 ? T.rL : T.rR;
    var uu = x < T.x0 ? T.uL : T.uR;
    var pp = x < T.x0 ? T.pL : T.pR;
    U[0][i] = rr; U[1][i] = rr*uu; U[2][i] = pp/gm1 + 0.5*rr*uu*uu;
  }
  function applyBC(V){
    for (var g=0;g<Ng;g++){
      for (var k=0;k<3;k++){ V[k][g] = V[k][Ng]; V[k][N+Ng+g] = V[k][N+Ng-1]; }
    }
  }
  function prim(V,i){
    var rr = V[0][i], uu = V[1][i]/rr, EE = V[2][i];
    var pp = gm1*(EE - 0.5*rr*uu*uu);
    if (pp < 1e-10) pp = 1e-10;
    if (rr < 1e-10) rr = 1e-10;
    return {r:rr, u:uu, p:pp, a:Math.sqrt(gamma*pp/rr)};
  }
  function computeRHS(V){
    applyBC(V);
    var RHS = [new Float64Array(Nt), new Float64Array(Nt), new Float64Array(Nt)];
    for (var i=Ng-1; i<N+Ng; i++){
      var pL = prim(V,i), pR = prim(V,i+1);
      var rL2=pL.r, uL2=pL.u, pL2=pL.p;
      var rR2=pR.r, uR2=pR.u, pR2=pR.p;
      if (recon === 'muscl'){
        var pIM = prim(V,i-1), pIP = prim(V,i+2);
        var sr1 = minmod(pL.r-pIM.r, pR.r-pL.r);
        var su1 = minmod(pL.u-pIM.u, pR.u-pL.u);
        var sp1 = minmod(pL.p-pIM.p, pR.p-pL.p);
        var sr2 = minmod(pR.r-pL.r, pIP.r-pR.r);
        var su2 = minmod(pR.u-pL.u, pIP.u-pR.u);
        var sp2 = minmod(pR.p-pL.p, pIP.p-pR.p);
        rL2 = pL.r + 0.5*sr1; uL2 = pL.u + 0.5*su1; pL2 = pL.p + 0.5*sp1;
        rR2 = pR.r - 0.5*sr2; uR2 = pR.u - 0.5*su2; pR2 = pR.p - 0.5*sp2;
        if (rL2<1e-10) rL2=1e-10; if (rR2<1e-10) rR2=1e-10;
        if (pL2<1e-10) pL2=1e-10; if (pR2<1e-10) pR2=1e-10;
      }
      var F = fluxFn(rL2,uL2,pL2, rR2,uR2,pR2, gamma, fluxOpts);
      for (var k=0;k<3;k++){ RHS[k][i] -= F[k]/dx; RHS[k][i+1] += F[k]/dx; }
    }
    return RHS;
  }
  // Snapshots
  var Nsnap = 80;
  var snapInterval = tend / Nsnap;
  var xc = [];
  for (var i=Ng;i<N+Ng;i++) xc.push(xmin + (i-Ng+0.5)*dx);
  var snaps = [{t:0, rc:[], uc:[], pc:[]}];
  for (var i=Ng;i<N+Ng;i++){
    var p0 = prim(U,i);
    snaps[0].rc.push(p0.r); snaps[0].uc.push(p0.u); snaps[0].pc.push(p0.p);
  }
  var nextSnap = snapInterval;
  var t=0, ns=0;
  while (t < tend){
    applyBC(U);
    var mx = 0;
    for (var i=Ng;i<N+Ng;i++){ var p = prim(U,i); var l = Math.abs(p.u) + p.a; if (l>mx) mx = l; }
    var dt = CFL*dx/mx;
    if (t + dt > tend) dt = tend - t;
    if (recon === 'muscl'){
      // SSP-RK2
      var R1 = computeRHS(U);
      var U1 = [new Float64Array(Nt), new Float64Array(Nt), new Float64Array(Nt)];
      for (var k=0;k<3;k++) for (var i=0;i<Nt;i++) U1[k][i] = U[k][i] + dt*R1[k][i];
      var R2 = computeRHS(U1);
      for (var k=0;k<3;k++) for (var i=0;i<Nt;i++) U[k][i] = 0.5*U[k][i] + 0.5*(U1[k][i] + dt*R2[k][i]);
    } else {
      var R = computeRHS(U);
      for (var k=0;k<3;k++) for (var i=0;i<Nt;i++) U[k][i] += dt*R[k][i];
    }
    t += dt; ns++;
    if (t >= nextSnap - 1e-9 || t >= tend - 1e-9){
      var snap = {t:t, rc:[], uc:[], pc:[]};
      for (var i=Ng;i<N+Ng;i++){
        var p = prim(U,i);
        snap.rc.push(p.r); snap.uc.push(p.u); snap.pc.push(p.p);
      }
      snaps.push(snap);
      nextSnap += snapInterval;
    }
    if (ns > 2e5) break;
  }
  return {xc:xc, snaps:snaps, ns:ns, xmin:xmin, xmax:xmax, T:T, gamma:gamma};
}

function plotField(c, xc, yc, xe, ye, yl, xmin, xmax){
  if (!c) return;
  var ctx = c.getContext('2d'), W = c.width, H = c.height;
  var P = {l:45, r:12, t:12, b:28}, pw = W-P.l-P.r, ph = H-P.t-P.b;
  var mn=1e9, mx=-1e9;
  for (var i=0;i<yc.length;i++){ if (yc[i]<mn) mn=yc[i]; if (yc[i]>mx) mx=yc[i]; }
  for (var i=0;i<ye.length;i++){ if (ye[i]<mn) mn=ye[i]; if (ye[i]>mx) mx=ye[i]; }
  var pad = (mx-mn)*0.08 || 0.1; mn -= pad; mx += pad;
  ctx.fillStyle='#fdf9f3'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#e8e0d4'; ctx.lineWidth=0.5;
  for (var i=0;i<=5;i++){ var y = P.t + ph*i/5; ctx.beginPath(); ctx.moveTo(P.l,y); ctx.lineTo(P.l+pw,y); ctx.stroke(); }
  for (var i=0;i<=10;i++){ var x = P.l + pw*i/10; ctx.beginPath(); ctx.moveTo(x,P.t); ctx.lineTo(x,P.t+ph); ctx.stroke(); }
  ctx.fillStyle='#8b7d6e'; ctx.font='10px JetBrains Mono'; ctx.textAlign='center';
  for (var i=0;i<=10;i+=2){ var xv = xmin + (xmax-xmin)*i/10; ctx.fillText(xv.toFixed(1), P.l+pw*i/10, H-6); }
  ctx.textAlign='right';
  for (var i=0;i<=5;i++){ var v = mx - (mx-mn)*i/5; ctx.fillText(v.toFixed(2), P.l-3, P.t+ph*i/5+3); }
  ctx.save(); ctx.translate(9, P.t+ph/2); ctx.rotate(-Math.PI/2); ctx.textAlign='center'; ctx.fillText(yl, 0, 0); ctx.restore();
  ctx.strokeStyle='#b44a2d'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
  ctx.beginPath();
  for (var i=0;i<xe.length;i++){
    var cx = P.l + (xe[i]-xmin)/(xmax-xmin)*pw;
    var cy = P.t + (1 - (ye[i]-mn)/(mx-mn))*ph;
    i===0 ? ctx.moveTo(cx,cy) : ctx.lineTo(cx,cy);
  }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle='#3a5ba0'; ctx.lineWidth=1.8;
  ctx.beginPath();
  for (var i=0;i<xc.length;i++){
    var cx = P.l + (xc[i]-xmin)/(xmax-xmin)*pw;
    var cy = P.t + (1 - (yc[i]-mn)/(mx-mn))*ph;
    i===0 ? ctx.moveTo(cx,cy) : ctx.lineTo(cx,cy);
  }
  ctx.stroke();
  if (xc.length <= 150){
    ctx.fillStyle='#3a5ba0';
    for (var i=0;i<xc.length;i++){
      var cx = P.l + (xc[i]-xmin)/(xmax-xmin)*pw;
      var cy = P.t + (1 - (yc[i]-mn)/(mx-mn))*ph;
      ctx.beginPath(); ctx.arc(cx,cy,2,0,Math.PI*2); ctx.fill();
    }
  }
}

function buildInteractive(container, cfg){
  // cfg: {id, fluxFn, schemeLabel, withRecon?, description?}
  var id = cfg.id;
  container.innerHTML =
    '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1.2rem;margin:1.5rem 0">'+
      '<div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:.8rem;align-items:end">'+
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<label style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text2)">Тест Торо</label>'+
          '<select id="'+id+'_test" style="background:#fff;border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-family:\'JetBrains Mono\',monospace;font-size:.82rem">'+
            '<option value="sod">Тест 1 (Sod)</option>'+
            '<option value="123">Тест 2 (1-2-3)</option>'+
            '<option value="blast">Тест 3 (бласт)</option>'+
            '<option value="trans">Тест 4 (трансзвук)</option>'+
          '</select>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<label style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text2)">N ячеек</label>'+
          '<input type="number" id="'+id+'_N" value="200" min="50" max="1000" style="width:80px;background:#fff;border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-family:\'JetBrains Mono\',monospace;font-size:.82rem">'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<label style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text2)">CFL</label>'+
          '<input type="number" id="'+id+'_CFL" value="0.8" min="0.1" max="1.0" step="0.05" style="width:70px;background:#fff;border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-family:\'JetBrains Mono\',monospace;font-size:.82rem">'+
        '</div>'+
        (cfg.withRecon ?
        '<div style="display:flex;flex-direction:column;gap:3px">'+
          '<label style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text2)">Реконстр.</label>'+
          '<select id="'+id+'_recon" style="background:#fff;border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-family:\'JetBrains Mono\',monospace;font-size:.82rem">'+
            '<option value="const">Кусочно-пост. (1-й)</option>'+
            '<option value="muscl" selected>MUSCL (2-й)</option>'+
          '</select>'+
        '</div>' : '')+
        '<button id="'+id+'_run" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:8px 20px;font-family:\'Source Serif 4\',serif;font-size:.88rem;font-weight:600;cursor:pointer">▶ Запустить '+cfg.schemeLabel+'</button>'+
      '</div>'+
      '<div id="'+id+'_status" style="font-family:\'JetBrains Mono\',monospace;font-size:.78rem;color:var(--text2);margin-bottom:.4rem">Готов</div>'+
      '<div id="'+id+'_anim" style="display:none;margin-bottom:.5rem;gap:.6rem;align-items:center;flex-wrap:wrap">'+
        '<button id="'+id+'_play" style="background:var(--accent);color:#fff;border:none;border-radius:5px;padding:5px 12px;font-family:\'Source Serif 4\',serif;font-size:.82rem;font-weight:600;cursor:pointer">▶ Воспроизвести</button>'+
        '<button id="'+id+'_reset" style="background:#6b5d4f;color:#fff;border:none;border-radius:5px;padding:5px 10px;font-family:\'Source Serif 4\',serif;font-size:.82rem;cursor:pointer">↻ В начало</button>'+
        '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;color:var(--text2)">t = <span id="'+id+'_tv">0.000</span></span>'+
        '<input type="range" id="'+id+'_t" min="0" max="1000" value="1000" style="flex:1;min-width:180px">'+
      '</div>'+
      '<div style="display:flex;gap:1.2rem;justify-content:center;margin:.5rem 0;font-size:.78rem;color:var(--text2);font-family:\'JetBrains Mono\',monospace;flex-wrap:wrap">'+
        '<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:20px;height:2px;background:#b44a2d"></span>точное</span>'+
        '<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:20px;height:2px;background:#3a5ba0"></span>'+cfg.schemeLabel+'</span>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem">'+
        '<div style="background:#fff;border-radius:6px;padding:.4rem;border:1px solid var(--border)"><div style="text-align:center;font-size:.78rem;font-weight:600;color:var(--accent);margin-bottom:.2rem;font-family:\'JetBrains Mono\',monospace">ρ(x)</div><canvas id="'+id+'_rho" width="480" height="300" style="width:100%;height:auto"></canvas></div>'+
        '<div style="background:#fff;border-radius:6px;padding:.4rem;border:1px solid var(--border)"><div style="text-align:center;font-size:.78rem;font-weight:600;color:var(--accent);margin-bottom:.2rem;font-family:\'JetBrains Mono\',monospace">p(x)</div><canvas id="'+id+'_p" width="480" height="300" style="width:100%;height:auto"></canvas></div>'+
        '<div style="background:#fff;border-radius:6px;padding:.4rem;border:1px solid var(--border)"><div style="text-align:center;font-size:.78rem;font-weight:600;color:var(--accent);margin-bottom:.2rem;font-family:\'JetBrains Mono\',monospace">v(x)</div><canvas id="'+id+'_u" width="480" height="300" style="width:100%;height:auto"></canvas></div>'+
      '</div>'+
    '</div>';

  // responsive grid on small screens
  var grid = container.querySelector('[style*="grid-template-columns:1fr 1fr 1fr"]');
  if (grid && window.innerWidth < 900) grid.style.gridTemplateColumns = '1fr';

  var state = { anim:null, playId:null };

  function renderFrame(idx){
    if (!state.anim) return;
    var A = state.anim;
    var i = Math.max(0, Math.min(idx, A.snaps.length-1));
    var snap = A.snaps[i];
    var ex = exactAt(A.T, A.gamma, snap.t);
    plotField(document.getElementById(id+'_rho'), A.xc, snap.rc, ex.xe, ex.re, 'ρ', A.xmin, A.xmax);
    plotField(document.getElementById(id+'_p'),   A.xc, snap.pc, ex.xe, ex.pe, 'p', A.xmin, A.xmax);
    plotField(document.getElementById(id+'_u'),   A.xc, snap.uc, ex.xe, ex.ue, 'v', A.xmin, A.xmax);
    document.getElementById(id+'_tv').textContent = snap.t.toFixed(4);
  }

  function play(){
    if (!state.anim) return;
    if (state.playId){
      cancelAnimationFrame(state.playId); state.playId=null;
      document.getElementById(id+'_play').textContent = '▶ Воспроизвести';
      return;
    }
    var slider = document.getElementById(id+'_t');
    if (+slider.value >= 995) slider.value = 0;
    document.getElementById(id+'_play').textContent = '⏸ Пауза';
    var last = performance.now();
    var totalMs = 4000;
    function tick(now){
      var dtMs = now - last; last = now;
      var v = +slider.value + dtMs * 1000/totalMs;
      if (v >= 1000){
        slider.value = 1000;
        renderFrame(state.anim.snaps.length - 1);
        state.playId=null;
        document.getElementById(id+'_play').textContent = '▶ Воспроизвести';
        return;
      }
      slider.value = v;
      renderFrame(Math.round(v/1000 * (state.anim.snaps.length-1)));
      state.playId = requestAnimationFrame(tick);
    }
    state.playId = requestAnimationFrame(tick);
  }
  function reset(){
    if (state.playId){ cancelAnimationFrame(state.playId); state.playId=null; document.getElementById(id+'_play').textContent='▶ Воспроизвести'; }
    document.getElementById(id+'_t').value = 0;
    if (state.anim) renderFrame(0);
  }

  function exactAt(T, gamma, tt){
    if (tt < 1e-6) tt = 1e-6;
    var Ne = 400, xe=[], re=[], ue=[], pe=[];
    for (var i=0;i<Ne;i++){
      var x = T.xmin + (T.xmax - T.xmin) * (i+0.5)/Ne;
      var s = exactRiemann(T.rL, T.uL, T.pL, T.rR, T.uR, T.pR, gamma, (x - T.x0)/tt);
      xe.push(x); re.push(s.rho); ue.push(s.u); pe.push(s.p);
    }
    return {xe:xe, re:re, ue:ue, pe:pe};
  }

  function run(){
    var btn = document.getElementById(id+'_run'); btn.disabled = true;
    document.getElementById(id+'_status').textContent = 'Считаю...';
    requestAnimationFrame(function(){ setTimeout(function(){
      try {
        var testKey = document.getElementById(id+'_test').value;
        var N = +document.getElementById(id+'_N').value;
        var CFL = +document.getElementById(id+'_CFL').value;
        var reconEl = document.getElementById(id+'_recon');
        var recon = reconEl ? reconEl.value : 'const';
        var T = TESTS[testKey];
        var t0 = performance.now();
        var result = runSolver(cfg.fluxFn, T, { N:N, CFL:CFL, recon:recon });
        var el = (performance.now() - t0).toFixed(1);
        state.anim = result;
        document.getElementById(id+'_anim').style.display = 'flex';
        document.getElementById(id+'_t').value = 1000;
        renderFrame(result.snaps.length - 1);
        document.getElementById(id+'_status').textContent = '✓ '+T.name+': '+result.ns+' шагов, '+el+' мс, '+result.snaps.length+' кадров';
      } catch(err){
        document.getElementById(id+'_status').textContent = 'Ошибка: '+err.message;
      }
      btn.disabled = false;
    }, 20); });
  }

  document.getElementById(id+'_run').addEventListener('click', run);
  document.getElementById(id+'_play').addEventListener('click', play);
  document.getElementById(id+'_reset').addEventListener('click', reset);
  document.getElementById(id+'_t').addEventListener('input', function(){
    if (state.playId){ cancelAnimationFrame(state.playId); state.playId=null; document.getElementById(id+'_play').textContent='▶ Воспроизвести'; }
    if (state.anim) renderFrame(Math.round(+this.value/1000 * (state.anim.snaps.length-1)));
  });
}

// Export
window.GDI = {
  exactRiemann: exactRiemann,
  TESTS: TESTS,
  minmod: minmod,
  buildInteractive: buildInteractive
};
})();
