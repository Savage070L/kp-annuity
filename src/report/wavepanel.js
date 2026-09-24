/* Волны фирменной боковой панели заявления. Компонент взят из
   Document/src/main/frontend/wavepanel.js без изменений логики —
   так узор в отчёте ровно тот же, что в форме онлайн-НСЖ. */
(function(){
  "use strict";
  var NS="http://www.w3.org/2000/svg";

  var CFG = {
    /* охват потока по высоте (доли).
       ⚠️ НЕ КРУТИТЬ РАДИ ЦВЕТА: пробовали 0.12…1.12 и 0.30…1.34, чтобы поднять
       бирюзу и синий в зону шагов, — палитра почти не сдвинулась (она ложится по
       ДЛИНЕ ленты, а не по высоте панели), зато форма ленты поехала. Цвет двигается
       позициями стопов, см. stops ниже. */
    startFlow: -0.12, endFlow: 1.06, bleed: 0.135,
    /* отступ ленты от левого края — свободное место под текст */
    inset: 0.42,
    /* ширина рабочей зоны поперёк: не больше доли ширины и не больше длины·slope */
    fill: 1.06, slope: 0.73,
    /* линии */
    lines: 26, stroke: 1.65, glow: 0.34, glowBlur: 0.048,   /* ⚠️ свечение линий
       приглушено с 0.64: на всю высоту экрана оно давало ореол, из-за которого
       панель выглядела засвеченной (жалоба пользователя, 2026-08-27) */
    ease: 0.5, samples: 83,
    /* форма */
    lead: 0.075, twistAt: 0.42, twistW: 0.185,
    /* тон */
    /* ⚠️ ТОН — ТОТ ЖЕ, ЧТО У ШАПКИ ПОЛИСА (просьба пользователя, 2026-08-27:
       «оттенки в линии полиса и в панели отличаются, перекрась панель как полис»).
       Числа взяты один в один из wavebar.js: без них панель показывала сырую палитру
       и лента читалась блёкло-белёсой, тогда как в шапке она идёт лайм → бирюза → синий. */
    hue: 0, sat: 2, bright: 1.94, colorShift: 0.03,

    /* ось ленты [u, x] */
    mid: [[-0.029,-0.361],[0.08,0.899],[0.196,0.576],[0.33,0.7],[0.45,0.74],
          [0.578,0.588],[0.692,1.157],[0.766,0.847],[0.901,0.427],[1.021,0.227]],
    /* ширина ленты [u, w] */
    env: [[0.02,0.145],[0.107,0.421],[0.24,0.62],[0.41,0.846],[0.558,0.445],
          [0.564,0.384],[0.74,0.597],[0.853,0.883],[0.915,0.657]],
    /* палитра [позиция, цвет, прозрачность].
       ⚠️ ПОЗИЦИИ СЖАТЫ В ПЕРВУЮ ПОЛОВИНУ (жалоба пользователя, 2026-08-27:
       «в боковом больше зелёный акцент, а в шапке полиса цвета ярче»). Цвета те же,
       что в шапке, но раньше весь переход лайм → бирюза → синий приходился на нижнюю
       треть панели — там, где уже нет шагов, — и рядом с подписями оставался только
       зелёный. Теперь сверху идёт лайм, к середине бирюза, а синий тянется хвостом
       до низа. Двигать цвет надо ЗДЕСЬ, а не охватом потока (см. выше). */
    stops: [[0.00,"#7fa8c8",0.00],[0.05,"#8fb4cc",0.05],[0.12,"#a4c6c2",0.18],
            [0.19,"#bcd88f",0.38],[0.26,"#cfe459",0.62],[0.31,"#d8ec44",0.80],
            [0.36,"#d2ea52",0.90],[0.41,"#a8e69c",0.92],[0.46,"#7cdcd6",0.86],
            [0.52,"#5fcbf2",0.74],[0.60,"#4a9cea",0.60],[0.78,"#3d74e2",0.34],
            [1.00,"#3d74e2",0.00]]
  };

  function el(n,a){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);return e;}

  function tint(hex){
    if(CFG.hue===0 && CFG.sat===1) return hex;
    var r=parseInt(hex.substr(1,2),16)/255,g=parseInt(hex.substr(3,2),16)/255,b=parseInt(hex.substr(5,2),16)/255;
    var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,hh=0,ss=0,d=mx-mn;
    if(d){ ss = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
      hh = mx===r ? ((g-b)/d+(g<b?6:0)) : mx===g ? ((b-r)/d+2) : ((r-g)/d+4); hh/=6; }
    hh=(hh+CFG.hue/360+1)%1; ss=Math.max(0,Math.min(1,ss*CFG.sat));
    function f(t){ t=(t+1)%1;
      var q=l<0.5?l*(1+ss):l+ss-l*ss, pp=2*l-q;
      if(t<1/6) return pp+(q-pp)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return pp+(q-pp)*(2/3-t)*6;
      return pp; }
    var o="#";
    [f(hh+1/3),f(hh),f(hh-1/3)].forEach(function(v){
      o+=("0"+Math.round(Math.max(0,Math.min(1,v))*255).toString(16)).slice(-2); });
    return o;
  }

  /* натуральный кубический сплайн (C²-гладкий) */
  function spline(pts){
    var n=pts.length,x=[],y=[],i;
    for(i=0;i<n;i++){ x.push(pts[i][0]); y.push(pts[i][1]); }
    var a=[],b=[],d=[],h=[],al=[],c=new Array(n).fill(0),l=[],mu=[],z=[];
    for(i=0;i<n-1;i++) h[i]=x[i+1]-x[i];
    for(i=1;i<n-1;i++) al[i]=3*((y[i+1]-y[i])/h[i]-(y[i]-y[i-1])/h[i-1]);
    l[0]=1; mu[0]=0; z[0]=0;
    for(i=1;i<n-1;i++){
      l[i]=2*(x[i+1]-x[i-1])-h[i-1]*mu[i-1];
      mu[i]=h[i]/l[i]; z[i]=(al[i]-h[i-1]*z[i-1])/l[i];
    }
    l[n-1]=1; z[n-1]=0; c[n-1]=0;
    for(i=n-2;i>=0;i--){
      c[i]=z[i]-mu[i]*c[i+1];
      b[i]=(y[i+1]-y[i])/h[i]-h[i]*(c[i+1]+2*c[i])/3;
      d[i]=(c[i+1]-c[i])/(3*h[i]); a[i]=y[i];
    }
    return function(t){
      var lo=0,hi=n-2,m;
      if(t<=x[0]) lo=0; else if(t>=x[n-1]) lo=n-2;
      else { while(lo<hi){ m=(lo+hi+1)>>1; if(x[m]<=t) lo=m; else hi=m-1; } }
      var e=t-x[lo];
      return a[lo]+e*(b[lo]+e*(c[lo]+e*d[lo]));
    };
  }

  var MID,ENV;
  function rebuild(){ MID=spline(CFG.mid); ENV=spline(CFG.env); }
  rebuild();

  /* Переопределения CFG по хосту: значение берётся из CSS-переменной --wp-<name>
     (её ставит тема по ярусу), иначе из атрибута data-wp-<name>, иначе — CFG стенда.
     ⚠️ getComputedStyle кэшируется на один draw (host.__cs) и сбрасывается в его начале. */
  function num(host,name,def){
    var cs=host.__cs||(host.__cs=getComputedStyle(host));
    var v=cs.getPropertyValue("--wp-"+name).trim();
    if(v==="") v=host.getAttribute("data-wp-"+name);
    if(v===null||v===""||v===undefined) return def;
    v=parseFloat(v); return isNaN(v)?def:v;
  }
  function opts(host){
    return {
      lines:     Math.round(num(host,"lines",CFG.lines)),
      strokePx:  num(host,"stroke-px",0),        /* 0 = формула стенда wE/380*stroke */
      inset:     num(host,"inset",CFG.inset),
      glow:      num(host,"glow",CFG.glow),
      glowBlur:  num(host,"glow-blur",CFG.glowBlur),
      fill:      num(host,"fill",CFG.fill),
      slope:     num(host,"slope",CFG.slope),
      startFlow: num(host,"start-flow",CFG.startFlow),
      endFlow:   num(host,"end-flow",CFG.endFlow),
      rotate:    num(host,"rotate",0),           /* -90 | 90 | 0 */
      flip:      num(host,"flip",0)===1 || host.hasAttribute("data-wp-flip")
    };
  }

  function surf(u,lam){
    var t=u+CFG.lead*lam;
    return MID(t)+lam*ENV(t)*Math.tanh((CFG.twistAt-t)/CFG.twistW);
  }

  function toBezier(P){
    var d="M"+P[0][0].toFixed(2)+" "+P[0][1].toFixed(2), i, n=P.length;
    for(i=0;i<n-1;i++){
      var p0=P[i>0?i-1:0],p1=P[i],p2=P[i+1],p3=P[i<n-2?i+2:n-1];
      d+="C"+(p1[0]+(p2[0]-p0[0])/6).toFixed(2)+" "+(p1[1]+(p2[1]-p0[1])/6).toFixed(2)
        +" "+(p2[0]-(p3[0]-p1[0])/6).toFixed(2)+" "+(p2[1]-(p3[1]-p1[1])/6).toFixed(2)
        +" "+p2[0].toFixed(2)+" "+p2[1].toFixed(2);
    }
    return d;
  }

  function draw(host){
    var W=Math.round(host.clientWidth), H=Math.round(host.clientHeight);
    if(!W||!H) return;
    host.__cs=null;
    var o=opts(host);
    var key=W+"|"+H+"|"+host.className+"|"+JSON.stringify(o);
    if(host.__k===key && !host.__dirty) return;
    host.__k=key; host.__dirty=false;

    /* ⚠️ ПОВОРОТ: при rotate ±90 лента считается как для вертикальной панели (h × w)
       и поворачивается группой <g transform> в самом конце — см. root ниже */
    var rot=o.rotate, w=rot?H:W, h=rot?W:H;

    var y0=h*o.startFlow, y1=h*o.endFlow;
    if(y1-y0 < h*0.12) y1=Math.min(h, y0+h*0.12);
    var len=y1-y0;
    var xs=w*o.inset, zone=Math.max(24, w-xs);
    var wE=Math.min(zone*o.fill, len*o.slope);
    var x0=xs+(zone-wE)/2;

    var uid="wp"+Math.random().toString(36).slice(2,8);
    /* stroke-px из темы — линия ровно заданной толщины; иначе формула стенда */
    var sw=o.strokePx>0 ? o.strokePx : Math.max(0.25, Math.min(8, wE/380*CFG.stroke));

    var svg=el("svg",{"class":"wp__art","viewBox":"0 0 "+W+" "+H,
                      "preserveAspectRatio":"none","focusable":"false","aria-hidden":"true"});
    var defs=el("defs",{}), gGlow=el("g",{}), gMain=el("g",{});

    /* ⚠️ Область фильтра РАСШИРЕНА против стенда (-14/-10/128/120): размытая дымка
       обрезалась по её краю, и поперёк панели шла отчётливая горизонтальная граница
       (жалоба пользователя, 2026-08-27). В стенде панель низкая и край не попадал
       в кадр; у нас она во всю высоту экрана. С запасом дымка гаснет сама. */
    var f=el("filter",{id:uid+"-g",x:"-60%",y:"-60%",width:"220%",height:"220%"});
    f.appendChild(el("feGaussianBlur",{stdDeviation:Math.max(0.4,wE*o.glowBlur)}));
    defs.appendChild(f);
    gGlow.setAttribute("filter","url(#"+uid+"-g)");
    gGlow.setAttribute("opacity",String(o.glow));

    for(var i=0;i<o.lines;i++){
      var q=o.lines===1?0.5:i/(o.lines-1);
      var v=(1-CFG.ease)*q+CFG.ease*(1-Math.pow(1-q,1.55));
      var lam=v-0.5, gid=uid+"-s"+i;

      var lg=el("linearGradient",{id:gid,gradientUnits:"userSpaceOnUse",
                                  x1:0,y1:y0.toFixed(1),x2:0,y2:y1.toFixed(1)});
      for(var j=0;j<CFG.stops.length;j++){
        var st=CFG.stops[j];
        var off=Math.max(0,Math.min(1, st[0]+CFG.colorShift*(2*v-1)));
        lg.appendChild(el("stop",{offset:off.toFixed(3),"stop-color":tint(st[1]),
          "stop-opacity":Math.max(0,Math.min(1,st[2]*CFG.bright)).toFixed(3)}));
      }
      defs.appendChild(lg);

      var pts=[], N=CFG.samples, uA=-CFG.bleed, uB=1+CFG.bleed, s;
      for(s=0;s<=N;s++){
        var u=uA+(uB-uA)*s/N;
        pts.push([ x0+surf(u,lam)*wE, y0+u*len ]);
      }
      var d=toBezier(pts);
      var a={d:d,fill:"none",stroke:"url(#"+gid+")","stroke-linecap":"round",
             "stroke-width":sw.toFixed(2)};
      gMain.appendChild(el("path",a));
      var b={}; for(var k in a) b[k]=a[k];
      b["stroke-width"]=(sw*2.6).toFixed(2);
      gGlow.appendChild(el("path",b));
    }

    /* группа поворота: виртуальная панель (w=H хоста, h=W хоста) → полоса (W × H).
       rotate(-90): (x,y) → (y, −x); translate(0,H) → (y, H−x): виртуальный ВЕРХ (лайм)
       уходит к ЛЕВОМУ краю полосы, а зона inset (в панели — место под текст слева) —
       вниз полосы, под подпись активного шага. rotate(90) — зеркально: лайм справа,
       inset сверху. flip зеркалит ход потока, не трогая сторону inset. */
    var root=el("g",{});
    if(rot===-90 || rot===90){
      var t = rot===-90 ? "translate(0 "+H+") rotate(-90)" : "translate("+W+" 0) rotate(90)";
      if(o.flip) t = "translate("+W+" 0) scale(-1 1) " + t;
      root.setAttribute("transform", t);
    }
    root.appendChild(gGlow); root.appendChild(gMain);
    svg.appendChild(defs); svg.appendChild(root);
    var old=host.querySelector(".wp__art");
    if(old) old.replaceWith(svg); else host.insertBefore(svg, host.firstChild);
  }

  function render(host){
    if(host.__q) return;
    host.__q=requestAnimationFrame(function(){ host.__q=0; draw(host); });
  }
  function refresh(host){
    rebuild();
    var list=host?[host]:document.querySelectorAll("[data-wp]");
    Array.prototype.forEach.call(list,function(n){ n.__dirty=true; draw(n); });
  }
  function init(root){
    var nodes=(root||document).querySelectorAll("[data-wp]");
    if(!nodes.length) return;
    if(window.ResizeObserver){
      var ro=new ResizeObserver(function(es){ es.forEach(function(e){ render(e.target); }); });
      nodes.forEach(function(n){ draw(n); ro.observe(n); });
    } else {
      nodes.forEach(draw);
      addEventListener("resize",function(){ nodes.forEach(function(n){ n.__dirty=true; render(n); }); });
    }
  }
  if(document.readyState!=="loading") init(); else addEventListener("DOMContentLoaded",function(){init();});
  window.WavePanel={ init:init, render:render, refresh:refresh, config:CFG, spline:spline };
})();
