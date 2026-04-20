<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>3045 سوبر ماركت — تسوق الآن</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f8fafc;--card:#fff;--accent:#059669;--accent2:#047857;--text:#1e293b;--muted:#64748b;--border:#e2e8f0;--r:14px}
body{font-family:'Tajawal',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.hdr{background:linear-gradient(135deg,#065f46,#059669);color:#fff;padding:14px 20px;position:sticky;top:0;z-index:100;box-shadow:0 2px 20px rgba(0,0,0,.15)}
.hdr-inner{max-width:1200px;margin:0 auto;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:22px;font-weight:900}.logo span{background:#fff;color:#059669;padding:2px 10px;border-radius:8px;margin-left:6px}
.cart-btn{background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.4);padding:8px 18px;border-radius:25px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;position:relative}
.cart-badge{position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
.search-bar{max-width:1200px;margin:14px auto;padding:0 16px}
.search-bar input{width:100%;padding:12px 20px;border-radius:25px;border:2px solid var(--border);font-size:15px;font-family:inherit;outline:none}
.search-bar input:focus{border-color:var(--accent)}
.cats{max-width:1200px;margin:0 auto 12px;padding:0 16px;display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch}.cats::-webkit-scrollbar{display:none}
.cat-btn{padding:8px 16px;border-radius:20px;border:1.5px solid var(--border);background:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;color:var(--muted)}
.cat-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.grid{max-width:1200px;margin:0 auto;padding:0 16px 100px;display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px}
.prod{background:var(--card);border-radius:var(--r);overflow:hidden;border:1.5px solid var(--border);transition:all .2s;position:relative}
.prod:hover{border-color:var(--accent);transform:translateY(-2px)}
.prod-img{height:100px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);display:flex;align-items:center;justify-content:center;font-size:36px}
.prod-body{padding:10px}
.prod-name{font-size:12px;font-weight:700;line-height:1.4;margin-bottom:6px;min-height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.prod-price{font-size:17px;font-weight:900;color:var(--accent)}.prod-price small{font-size:10px;font-weight:500;color:var(--muted)}
.add-btn{width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:0 0 12px 12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.add-btn:hover{background:var(--accent2)}
.prod-qty{position:absolute;top:8px;left:8px;background:var(--accent);color:#fff;width:24px;height:24px;border-radius:50%;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;opacity:0;visibility:hidden;transition:all .3s}.overlay.open{opacity:1;visibility:visible}
.drawer{position:fixed;top:0;left:0;width:min(400px,90vw);height:100vh;background:#fff;z-index:201;transform:translateX(-100%);transition:transform .3s;display:flex;flex-direction:column}.drawer.open{transform:translateX(0)}
.drawer-hdr{padding:16px;background:var(--accent);color:#fff;display:flex;justify-content:space-between;align-items:center}
.drawer-body{flex:1;overflow-y:auto;padding:12px}
.cart-item{display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid #f1f5f9}
.cart-item-info{flex:1}.cart-item-name{font-size:12px;font-weight:700}.cart-item-price{font-size:11px;color:var(--accent);font-weight:600}
.qty-ctrl{display:flex;align-items:center;border:1.5px solid var(--border);border-radius:8px;overflow:hidden}
.qty-ctrl button{width:30px;height:30px;border:none;background:#f8fafc;font-size:16px;font-weight:700;cursor:pointer}
.qty-ctrl span{width:30px;text-align:center;font-size:13px;font-weight:700}
.drawer-footer{padding:14px;border-top:2px solid var(--border)}
.total-row{display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:6px}
.total-row.big{font-size:18px;font-weight:900;color:var(--accent)}
.checkout-btn{width:100%;padding:14px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit}
.form-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px}
.form-card{background:#fff;border-radius:20px;width:min(500px,95vw);max-height:90vh;overflow-y:auto;padding:24px}
.form-card h2{font-size:18px;font-weight:800;margin-bottom:16px;text-align:center}
.field{margin-bottom:12px}.field label{display:block;font-size:12px;font-weight:700;margin-bottom:4px;color:var(--muted)}
.field input,.field textarea{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;outline:none}
.submit-btn{width:100%;padding:14px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:8px}
.submit-btn:disabled{background:#d1d5db}
.success-card{text-align:center;padding:40px 20px}.success-card .check{font-size:60px;margin-bottom:12px}
.empty{text-align:center;padding:60px 20px;color:var(--muted)}.empty .icon{font-size:60px;margin-bottom:12px}
.loading{text-align:center;padding:60px;color:var(--muted)}
.spin{display:inline-block;width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@media(max-width:480px){.grid{grid-template-columns:repeat(2,1fr);gap:8px}.prod-img{height:80px;font-size:28px}.prod-name{font-size:11px;min-height:28px}.prod-price{font-size:14px}}
</style>
</head>
<body>
<div id="app"><div class="loading"><div class="spin"></div><p style="margin-top:12px">جاري تحميل المنتجات...</p></div></div>
<script>
const SB_URL="https://oxrqkgbbccstbetxpnsn.supabase.co",SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cnFrZ2JiY2NzdGJldHhwbnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzE2MjQsImV4cCI6MjA5MDA0NzYyNH0.19Sp_A1S17RXMG3jzSvKSdPKhaQE_ZEDx-JIJIUCsi8";
const db=supabase.createClient(SB_URL,SB_KEY);
const CE={snacks:"\u{1F37F}",drinks:"\u{1F964}",candy:"\u{1F36C}",chips:"\u{1F35F}",energy:"\u26A1",water:"\u{1F4A7}",canned:"\u{1F96B}",care:"\u{1F9F4}",household:"\u{1F3E0}",chocolate:"\u{1F36B}",biscuits:"\u{1F36A}",cake:"\u{1F382}",nuts:"\u{1F95C}",soda:"\u{1F964}",juice:"\u{1F9C3}",coffee:"\u2615",dairy:"\u{1F9C0}",meat:"\u{1F357}",food:"\u{1F37D}",frozen:"\u{1F9CA}",breakfast:"\u{1F963}",baby:"\u{1F476}",personal:"\u{1F486}",electronics:"\u{1F4F1}"};
const CL={snacks:"\u0648\u062C\u0628\u0627\u062A \u062E\u0641\u064A\u0641\u0629",drinks:"\u0645\u0634\u0631\u0648\u0628\u0627\u062A",candy:"\u062D\u0644\u0648\u064A\u0627\u062A",chips:"\u0634\u064A\u0628\u0633",energy:"\u0637\u0627\u0642\u0629",water:"\u0645\u064A\u0627\u0647",canned:"\u0645\u0639\u0644\u0628\u0627\u062A",care:"\u0639\u0646\u0627\u064A\u0629",household:"\u0645\u0646\u0632\u0644\u064A\u0629",chocolate:"\u0634\u0648\u0643\u0648\u0644\u0627\u062A\u0629",biscuits:"\u0628\u0633\u0643\u0648\u064A\u062A",cake:"\u0643\u064A\u0643",nuts:"\u0645\u0643\u0633\u0631\u0627\u062A",soda:"\u063A\u0627\u0632\u064A\u0629",juice:"\u0639\u0635\u0627\u0626\u0631",coffee:"\u0642\u0647\u0648\u0629",dairy:"\u0623\u0644\u0628\u0627\u0646",meat:"\u0644\u062D\u0648\u0645",food:"\u0623\u063A\u0630\u064A\u0629",frozen:"\u0645\u062C\u0645\u062F\u0627\u062A",breakfast:"\u0641\u0637\u0648\u0631",baby:"\u0623\u0637\u0641\u0627\u0644",personal:"\u0639\u0646\u0627\u064A\u0629 \u0634\u062E\u0635\u064A\u0629",electronics:"\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A\u0627\u062A"};
let P=[],cart=[],selCat="all",sq="",drO=false,coO=false,okO=false,sub=false,oNo="";
async function load(){const{data}=await db.from("products").select("*").gt("stock",0).gt("price",0);P=(data||[]).map(p=>({id:p.id,bc:p.barcode,n:p.name,a:p.name_ar,p:+p.price||0,s:+p.stock||0,cat:p.category||""})).filter(p=>p.p>0&&p.s>0&&p.cat!=="cigarettes");R()}
function addC(p){const e=cart.find(c=>c.id===p.id);if(e){if(e.q<p.s)e.q++}else cart.push({id:p.id,n:p.a||p.n,p:p.p,q:1,mx:p.s});R()}
function uQ(id,d){const i=cart.find(c=>c.id===id);if(!i)return;i.q+=d;if(i.q<=0)cart=cart.filter(c=>c.id!==id);else if(i.q>i.mx)i.q=i.mx;R()}
function gT(){return cart.reduce((s,c)=>s+c.p*c.q,0)}
function gC(){return cart.reduce((s,c)=>s+c.q,0)}
async function submit(){
  const nm=document.getElementById("cn").value.trim(),ph=document.getElementById("cp").value.trim(),ad=document.getElementById("ca").value.trim(),nt=document.getElementById("cno").value.trim();
  if(!nm||!ph||!ad){alert("\u064A\u0631\u062C\u0649 \u062A\u0639\u0628\u0626\u0629 \u062C\u0645\u064A\u0639 \u0627\u0644\u062D\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629");return}
  if(ph.length<9){alert("\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D");return}
  sub=true;R();
  try{const no="ORD-"+Date.now().toString(36).toUpperCase();
  const{error}=await db.from("online_orders").insert({order_no:no,customer_name:nm,customer_phone:ph,customer_address:ad,customer_notes:nt,items:JSON.stringify(cart.map(c=>({id:c.id,name:c.n,price:c.p,qty:c.q}))),subtotal:gT(),delivery_fee:0,total:gT(),status:"pending"});
  if(error)throw error;oNo=no;okO=true;cart=[];coO=false}catch(e){alert("\u0641\u0634\u0644: "+(e.message||""))}sub=false;R()}
function R(){
  const fp=selCat==="all"?P:P.filter(p=>p.cat===selCat);
  const fl=sq?fp.filter(p=>(p.n+p.a+(p.bc||"")).toLowerCase().includes(sq.toLowerCase())):fp;
  const cs={};P.forEach(p=>{if(p.cat)cs[p.cat]=(cs[p.cat]||0)+1});
  const cc=gC(),ct=gT(),qm={};cart.forEach(c=>{qm[c.id]=c.q});
  document.getElementById("app").innerHTML=`
<div class="hdr"><div class="hdr-inner"><div class="logo"><span>3045</span> \u0633\u0648\u0628\u0631 \u0645\u0627\u0631\u0643\u062A</div><button class="cart-btn" onclick="drO=true;R()">\u{1F6D2} \u0627\u0644\u0633\u0644\u0629 ${cc?`<span class="cart-badge">${cc}</span>`:""}</button></div></div>
<div class="search-bar"><input placeholder="\u{1F50D} \u0627\u0628\u062D\u062B \u0639\u0646 \u0645\u0646\u062A\u062C..." value="${sq}" oninput="sq=this.value;R()"/></div>
<div class="cats"><button class="cat-btn ${selCat==="all"?"active":""}" onclick="selCat='all';R()">\u0627\u0644\u0643\u0644 (${P.length})</button>${Object.entries(cs).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`<button class="cat-btn ${selCat===c?"active":""}" onclick="selCat='${c}';R()">${CE[c]||"\u{1F4E6}"} ${CL[c]||c} (${n})</button>`).join("")}</div>
${fl.length===0?`<div class="empty"><div class="icon">\u{1F50D}</div><p>\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0646\u062A\u062C\u0627\u062A</p></div>`:`<div class="grid">${fl.map(p=>`<div class="prod">${qm[p.id]?`<div class="prod-qty">${qm[p.id]}</div>`:""}<div class="prod-img">${CE[p.cat]||"\u{1F4E6}"}</div><div class="prod-body"><div class="prod-name">${p.a||p.n}</div><div class="prod-price">${p.p.toFixed(3)} <small>JD</small></div></div><button class="add-btn" onclick="addC(P.find(x=>x.id==='${p.id}'))">+ \u0623\u0636\u0641</button></div>`).join("")}</div>`}
${drO?`<div class="overlay open" onclick="drO=false;R()"></div><div class="drawer open"><div class="drawer-hdr"><h3>\u{1F6D2} \u0633\u0644\u0629 \u0627\u0644\u062A\u0633\u0648\u0642 (${cc})</h3><button style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer" onclick="drO=false;R()">\u2715</button></div><div class="drawer-body">${cart.length===0?`<div class="empty"><div class="icon">\u{1F6D2}</div><p>\u0627\u0644\u0633\u0644\u0629 \u0641\u0627\u0631\u063A\u0629</p></div>`:cart.map(c=>`<div class="cart-item"><div class="cart-item-info"><div class="cart-item-name">${c.n}</div><div class="cart-item-price">${c.p.toFixed(3)} \u00D7 ${c.q} = ${(c.p*c.q).toFixed(3)} JD</div></div><div class="qty-ctrl"><button onclick="uQ('${c.id}',-1)">\u2212</button><span>${c.q}</span><button onclick="uQ('${c.id}',1)">+</button></div></div>`).join("")}</div>${cart.length?`<div class="drawer-footer"><div class="total-row big"><span>\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A</span><span>${ct.toFixed(3)} JD</span></div><button class="checkout-btn" onclick="drO=false;coO=true;R()">\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0637\u0644\u0628</button></div>`:""}</div>`:""}
${coO?`<div class="form-overlay" onclick="coO=false;R()"><div class="form-card" onclick="event.stopPropagation()"><h2>\u{1F4CD} \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u062A\u0648\u0635\u064A\u0644</h2><div class="field"><label>\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 *</label><input id="cn" placeholder="\u0623\u062F\u062E\u0644 \u0627\u0633\u0645\u0643"/></div><div class="field"><label>\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062A\u0641 *</label><input id="cp" type="tel" placeholder="07XXXXXXXX"/></div><div class="field"><label>\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062A\u0641\u0635\u064A\u0644\u064A *</label><textarea id="ca" rows="3" placeholder="\u0627\u0644\u0645\u0646\u0637\u0642\u0629\u060C \u0627\u0644\u0634\u0627\u0631\u0639\u060C \u0631\u0642\u0645 \u0627\u0644\u0628\u0646\u0627\u064A\u0629..."></textarea></div><div class="field"><label>\u0645\u0644\u0627\u062D\u0638\u0627\u062A (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)</label><textarea id="cno" rows="2" placeholder="\u0645\u062B\u0627\u0644: \u0627\u0644\u062F\u0648\u0631 \u0627\u0644\u062B\u0627\u0644\u062B..."></textarea></div><div style="background:#f0fdf4;border-radius:10px;padding:12px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800"><span>\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A</span><span style="color:#059669">${ct.toFixed(3)} JD</span></div><div style="font-size:10px;color:#6b7280;margin-top:4px">${cc} \u0645\u0646\u062A\u062C \u2014 \u0627\u0644\u062F\u0641\u0639 \u0639\u0646\u062F \u0627\u0644\u0627\u0633\u062A\u0644\u0627\u0645</div></div><button class="submit-btn" onclick="submit()" ${sub?"disabled":""}>${sub?"\u23F3 \u062C\u0627\u0631\u064A \u0627\u0644\u0625\u0631\u0633\u0627\u0644...":"\u2705 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0637\u0644\u0628"}</button><button style="width:100%;padding:10px;background:none;border:1px solid #e5e7eb;border-radius:10px;margin-top:8px;cursor:pointer;font-family:inherit;font-size:13px;color:#6b7280" onclick="coO=false;R()">\u21A9 \u0631\u062C\u0648\u0639</button></div></div>`:""}
${okO?`<div class="form-overlay"><div class="form-card" style="text-align:center;padding:40px 20px"><div style="font-size:60px;margin-bottom:12px">\u2705</div><h2 style="color:#059669;margin-bottom:8px">\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628\u0643 \u0628\u0646\u062C\u0627\u062D!</h2><p style="color:#6b7280;margin-bottom:16px">\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: <strong>${oNo}</strong></p><p style="color:#6b7280;font-size:13px;margin-bottom:20px">\u0633\u0646\u062A\u0648\u0627\u0635\u0644 \u0645\u0639\u0643 \u0642\u0631\u064A\u0628\u0627\u064B</p><button class="submit-btn" onclick="okO=false;R()">\u{1F6D2} \u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u062A\u0633\u0648\u0642</button></div></div>`:""}`}
load();
</script>
</body>
</html>
