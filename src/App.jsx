import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from "recharts";
import { createClient } from "@supabase/supabase-js";

// ╔═══════════════════════════════════════════════════════════╗
// ║  SUPABASE CONFIG — REPLACE THESE WITH YOUR VALUES        ║
// ║  Find them in: Supabase → Settings → API                 ║
// ╚═══════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://oxrqkgbbccstbetxpnsn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZZTqt5iEvQBsDIomZCIVQw_bvcaJ5_g";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DB HELPERS ────────────────────────────────────────────────
const DB = {
  // Products
  async getProducts() { const {data}=await sb.from("products").select("*").order("id"); return (data||[]).map(r=>({id:r.id,bc:r.barcode,n:r.name,a:r.name_ar,p:+r.price,c:+r.cost,cat:r.category,u:r.unit,s:r.stock,e:r.emoji})); },
  async upsertProduct(p) { await sb.from("products").upsert({id:p.id,barcode:p.bc,name:p.n,name_ar:p.a,price:p.p,cost:p.c,category:p.cat,unit:p.u,stock:p.s,emoji:p.e,updated_at:new Date().toISOString()}); },
  async deleteProduct(id) { await sb.from("products").delete().eq("id",id); },
  async updateStock(id, newStock, newCost) { await sb.from("products").update({stock:newStock, cost:newCost, updated_at:new Date().toISOString()}).eq("id",id); },
  async updateProductPriceStock(id, price, stock) { await sb.from("products").update({price,stock,updated_at:new Date().toISOString()}).eq("id",id); },

  // Users
  async getUsers() { const {data}=await sb.from("pos_users").select("*").order("id"); return (data||[]).map(r=>({id:r.id,un:r.username,fn:r.full_name,fa:r.full_name_ar||r.full_name,role:r.role,st:r.status,pw:r.password})); },
  async addUser(u) { await sb.from("pos_users").insert({username:u.un,full_name:u.fn,full_name_ar:u.fa||u.fn,role:u.role,status:"active",password:u.pw}); },
  async updateUser(id, fields) { await sb.from("pos_users").update(fields).eq("id",id); },
  async deleteUser(id) { await sb.from("pos_users").delete().eq("id",id); },

  // Transactions
  async getTransactions() {
    const {data:txs}=await sb.from("transactions").select("*").order("created_at",{ascending:false}).limit(200);
    if(!txs||!txs.length) return [];
    const ids=txs.map(t=>t.id);
    const {data:items}=await sb.from("transaction_items").select("*").in("transaction_id",ids);
    return txs.map(tx=>({id:tx.id,rn:tx.receipt_no,sub:+tx.subtotal,disc:+tx.discount,dp:+tx.discount_pct,tax:+tx.tax,tot:+tx.total,method:tx.payment_method,ct:+tx.cash_tendered,ch:+tx.change_amount,ts:tx.created_at,time:new Date(tx.created_at).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:new Date(tx.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),custPhone:tx.customer_phone,custName:tx.cashier_name,ptsEarned:tx.points_earned||0,ptsRedeemed:tx.points_redeemed||0,items:(items||[]).filter(i=>i.transaction_id===tx.id).map(i=>({id:i.product_id,n:i.product_name,a:i.product_name_ar||i.product_name,bc:i.barcode,p:+i.unit_price,qty:i.quantity}))}));
  },
  async addTransaction(tx, cashierId, cashierName) {
    await sb.from("transactions").insert({id:tx.id,receipt_no:tx.rn,subtotal:tx.sub,discount:tx.disc,discount_pct:tx.dp,tax:tx.tax,total:tx.tot,payment_method:tx.method,cash_tendered:tx.ct,change_amount:tx.ch,cashier_id:cashierId,cashier_name:cashierName});
    const rows=tx.items.map(i=>({transaction_id:tx.id,product_id:i.id,product_name:i.n,product_name_ar:i.a,barcode:i.bc,quantity:i.qty,unit_price:i.p,line_total:+(i.p*i.qty).toFixed(3)}));
    await sb.from("transaction_items").insert(rows);
    // Decrease stock
    for(const i of tx.items){
      const {data:p}=await sb.from("products").select("stock").eq("id",i.id).single();
      if(p) await sb.from("products").update({stock:Math.max(0,p.stock-i.qty)}).eq("id",i.id);
    }
  },

  // Purchase Invoices
  async getInvoices() {
    const {data:invs}=await sb.from("purchase_invoices").select("*").order("created_at",{ascending:false});
    if(!invs||!invs.length) return [];
    const ids=invs.map(i=>i.id);
    const {data:items}=await sb.from("purchase_invoice_items").select("*").in("invoice_id",ids);
    return invs.map(inv=>({id:inv.id,invoiceNo:inv.invoice_no,supplier:inv.supplier,totalCost:+inv.total_cost,receivedBy:inv.received_by,date:new Date(inv.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),time:new Date(inv.created_at).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),items:(items||[]).filter(i=>i.invoice_id===inv.id).map(i=>({productName:i.product_name,prodId:i.product_id,qty:""+i.quantity,cost:""+i.cost_price}))}));
  },
  async addInvoice(inv) {
    const {data}=await sb.from("purchase_invoices").insert({invoice_no:inv.invoiceNo,supplier:inv.supplier,total_cost:inv.totalCost,received_by:inv.receivedBy}).select().single();
    if(data){
      const rows=inv.items.map(i=>({invoice_id:data.id,product_id:i.prodId||null,product_name:i.productName,quantity:parseInt(i.qty)||0,cost_price:parseFloat(i.cost)||0,line_total:+((parseFloat(i.cost)||0)*(parseInt(i.qty)||0)).toFixed(3)}));
      await sb.from("purchase_invoice_items").insert(rows);
    }
    // Update stock + cost
    for(const i of inv.items){
      if(!i.prodId) continue;
      const {data:p}=await sb.from("products").select("stock").eq("id",i.prodId).single();
      if(p) await sb.from("products").update({stock:p.stock+(parseInt(i.qty)||0),cost:parseFloat(i.cost)||0,updated_at:new Date().toISOString()}).eq("id",i.prodId);
    }
  },

  // Customers / Loyalty
  async getCustomers() { const {data}=await sb.from("customers").select("*").order("name"); return (data||[]).map(r=>({id:r.id,phone:r.phone,name:r.name,nameAr:r.name_ar||r.name,pts:r.points,spent:+r.total_spent,visits:r.total_visits,tier:r.tier,st:r.status,notes:r.notes})); },
  async findCustomer(phone) { const {data}=await sb.from("customers").select("*").eq("phone",phone).single(); if(!data) return null; return{id:data.id,phone:data.phone,name:data.name,nameAr:data.name_ar||data.name,pts:data.points,spent:+data.total_spent,visits:data.total_visits,tier:data.tier,st:data.status}; },
  async addCustomer(c) { const {data}=await sb.from("customers").insert({phone:c.phone,name:c.name,name_ar:c.nameAr||c.name,points:0,total_spent:0,total_visits:0,tier:"bronze",status:"active"}).select().single(); return data?{id:data.id,phone:data.phone,name:data.name,nameAr:data.name_ar,pts:0,spent:0,visits:0,tier:"bronze",st:"active"}:null; },
  async updateCustomerPoints(id, points, spent, visits) { const tier=points>=5000?"vip":points>=1500?"gold":points>=500?"silver":"bronze"; await sb.from("customers").update({points,total_spent:spent,total_visits:visits,tier,updated_at:new Date().toISOString()}).eq("id",id); },
  async addLoyaltyTx(custId, txId, type, points, amount, desc) { await sb.from("loyalty_transactions").insert({customer_id:custId,transaction_id:txId,type,points,amount,description:desc}); },
  async getLoyaltyHistory(custId) { const {data}=await sb.from("loyalty_transactions").select("*").eq("customer_id",custId).order("created_at",{ascending:false}).limit(50); return data||[]; },
  tierMultiplier(tier) { return tier==="vip"?3:tier==="gold"?2:tier==="silver"?1.5:1; },
  calcPoints(total, tier) { return Math.floor(total*10*DB.tierMultiplier(tier)); }, // 10 pts per 1 JD, multiplied by tier
  pointsToJD(pts) { return +(pts*0.005).toFixed(3); } // 100 pts = 0.500 JD
};

// ── EXCEL EXPORT ──────────────────────────────────────────────
function xmlE(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function mkS(n,h,rows){let s='<Worksheet ss:Name="'+xmlE(n)+'"><Table>';s+="<Row>"+h.map(x=>'<Cell><Data ss:Type="String">'+xmlE(x)+'</Data></Cell>').join("")+"</Row>";rows.forEach(r=>{s+="<Row>"+r.map(c=>'<Cell><Data ss:Type="'+(typeof c==="number"?"Number":"String")+'">'+xmlE(c)+'</Data></Cell>').join("")+"</Row>"});return s+"</Table></Worksheet>";}
function exportXL(prods,txns,invs){
const sh=[];
sh.push(mkS("Inventory",["Barcode","Name","Name AR","Cat","Unit","Cost","Price","Margin","Margin %","Stock"],prods.map(p=>{const mg=p.p-p.c;const mgPct=p.c>0?+((p.p-p.c)/p.c*100).toFixed(1):0;return[p.bc,p.n,p.a,p.cat,p.u,p.c,p.p,+mg.toFixed(3),mgPct,p.s]})));
sh.push(mkS("Sales",["Receipt","Date","Time","Items","Qty","Subtotal","Discount","Tax","Total","Method"],txns.map(tx=>[tx.rn,tx.date,tx.time,tx.items.map(i=>i.n+"x"+i.qty).join("; "),tx.items.reduce((s,i)=>s+i.qty,0),+tx.sub.toFixed(3),+tx.disc.toFixed(3),+tx.tax.toFixed(3),+tx.tot.toFixed(3),tx.method])));
sh.push(mkS("Sales Detail",["Receipt","Date","Product","Barcode","Qty","Price","Total"],txns.flatMap(tx=>tx.items.map(i=>[tx.rn,tx.date,i.n,i.bc,i.qty,i.p,+(i.p*i.qty).toFixed(3)]))));
sh.push(mkS("Purchases",["Invoice","Date","Supplier","Product","Qty","Cost","Total"],invs.flatMap(inv=>inv.items.map(it=>[inv.invoiceNo,inv.date,inv.supplier,it.productName,parseInt(it.qty)||0,parseFloat(it.cost)||0,+((parseFloat(it.cost)||0)*(parseInt(it.qty)||0)).toFixed(3)]))));
const xml='<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Font ss:Size="11"/></Style></Styles>'+sh.join("")+"</Workbook>";
const b=new Blob([xml],{type:"application/vnd.ms-excel"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="3045_POS_"+new Date().toISOString().slice(0,10)+".xls";a.click();URL.revokeObjectURL(u);}

// ── I18N (same as before) ─────────────────────────────────────
const T={en:{newSale:"New Sale",held:"Held Orders",dashboard:"Dashboard",admin:"Admin",search:"Search products...",barcode:"Barcode",currentSale:"Current Sale",clear:"Clear All",empty:"Cart is empty",emptyHint:"Scan barcode or tap a product",hold:"Hold Order",subtotal:"Subtotal",discount:"Discount",vat:"VAT (16%)",total:"Total",discPct:"Discount %",apply:"Apply",cash:"Cash",card:"Card",mada:"mada Pay",cashPay:"Cash Payment",cardPay:"Card Payment",madaPay:"mada Pay",tendered:"Amount Received",change:"Change Due",insertCard:"Waiting for card...",scanMada:"Waiting for mada Pay...",confirm:"Confirm Payment",print:"Print Receipt",newSaleBtn:"New Sale",receipt:"Receipt",resume:"Resume",del:"Delete",noHeld:"No held orders",totalSales:"Total Sales",txns:"Transactions",avgTxn:"Average",sold:"items sold",recent:"Recent Transactions",noTxns:"No transactions yet",time:"Time",items:"Items",method:"Payment",done:"Completed",terminal:"Terminal 01",all:"All",snacks:"Snacks",drinks:"Drinks",cigs:"Cigarettes",candy:"Candy",chips:"Chips & Nuts",energy:"Energy",water:"Water & Juice",canned:"Canned",care:"Care",home:"Household",scanner:"Barcode Scanner",scanHint:"Scan or type barcode and press Enter",samples:"Quick test:",none:"No products found",lang:"العربية",inventory:"Inventory",users:"Users",settings:"Settings",purchases:"Purchases",product:"Product",price:"Price",cost:"Cost",stock:"Stock",cat:"Category",act:"Actions",edit:"Edit",save:"Save",cancel:"Cancel",lowStock:"Low Stock Alert",user:"Username",name:"Full Name",role:"Role",on:"Active",off:"Inactive",cashier:"Cashier",manager:"Manager",adminR:"Admin",pass:"Password",newPass:"New Password",setPass:"Set Password",chgPass:"Change",addUser:"Add User",addProd:"Add Product",today:"Today",week:"This Week",month:"This Month",top:"Top Products",qty:"Qty",store:"Store Name",taxR:"Tax Rate %",curr:"Currency",saveSt:"Save",saved:"Saved!",hourly:"Sales by Hour",byCat:"By Category",payments:"Payment Methods",trend:"Weekly Trend",ready:"Barcode scanner active",added:"added to cart",notFound:"Product not found",login:"Sign In",loginErr:"Wrong username or password",logout:"Sign Out",hi:"Welcome back",supplier:"Supplier",invNo:"Invoice #",addInv:"New Invoice",invItems:"Items",addItem:"Add Line",selProd:"Select product...",costPr:"Unit Cost",saveInv:"Save & Update Stock",totCost:"Invoice Total",by:"Received By",noInv:"No invoices yet",updated:"Stock updated!",bc:"Barcode",unit:"Unit",nameEn:"English Name",nameAr:"Arabic Name",prodAdded:"Product added!",excel:"Export Excel",autoSave:"Cloud Database",loading:"Loading data...",dbConnected:"Connected to database",dbError:"Database error — using offline mode",margin:"Margin",marginPct:"Margin %",loyalty:"Loyalty",customers:"Customers",custPhone:"Phone Number",custName:"Customer Name",custNameAr:"Name (AR)",searchCust:"Enter phone number...",custNotFound:"Customer not found",addCust:"Register New Customer",custAdded:"Customer registered!",points:"Points",tier:"Tier",totalSpent:"Total Spent",visits:"Visits",earnPts:"Points to earn",redeemPts:"Redeem Points",redeemAmt:"Redeem value",ptsBalance:"Balance",bronze:"Bronze",silver:"Silver",gold:"Gold",vip:"VIP",custAttached:"Customer attached",noCust:"No customer (guest)",removeCust:"Remove",custSearch:"Customer Lookup",registerNew:"Register",ptHistory:"Points History",earned:"Earned",redeemed:"Redeemed",multiplier:"Multiplier"},
ar:{newSale:"بيع جديد",held:"طلبات معلقة",dashboard:"لوحة التحكم",admin:"الإدارة",search:"بحث عن منتج...",barcode:"باركود",currentSale:"الفاتورة الحالية",clear:"مسح الكل",empty:"السلة فارغة",emptyHint:"امسح الباركود أو اختر منتج",hold:"تعليق الطلب",subtotal:"المجموع الفرعي",discount:"الخصم",vat:"الضريبة (16%)",total:"الإجمالي",discPct:"نسبة الخصم %",apply:"تطبيق",cash:"نقدي",card:"بطاقة",mada:"مدى",cashPay:"الدفع النقدي",cardPay:"الدفع بالبطاقة",madaPay:"الدفع بمدى",tendered:"المبلغ المستلم",change:"المتبقي",insertCard:"بانتظار البطاقة...",scanMada:"بانتظار مدى...",confirm:"تأكيد الدفع",print:"طباعة",newSaleBtn:"بيع جديد",receipt:"إيصال",resume:"استئناف",del:"حذف",noHeld:"لا توجد طلبات معلقة",totalSales:"إجمالي المبيعات",txns:"المعاملات",avgTxn:"المتوسط",sold:"مباعة",recent:"المعاملات الأخيرة",noTxns:"لا توجد معاملات",time:"الوقت",items:"العناصر",method:"الدفع",done:"مكتمل",terminal:"نقطة بيع ٠١",all:"الكل",snacks:"وجبات خفيفة",drinks:"مشروبات",cigs:"سجائر",candy:"حلويات",chips:"شيبس ومكسرات",energy:"مشروبات طاقة",water:"مياه وعصائر",canned:"معلبات",care:"عناية شخصية",home:"منزلية",scanner:"ماسح الباركود",scanHint:"امسح الباركود أو اكتبه واضغط إدخال",samples:"للتجربة:",none:"لا توجد منتجات",lang:"English",inventory:"المخزون",users:"المستخدمين",settings:"الإعدادات",purchases:"المشتريات",product:"المنتج",price:"السعر",cost:"التكلفة",stock:"المخزون",cat:"الفئة",act:"إجراء",edit:"تعديل",save:"حفظ",cancel:"إلغاء",lowStock:"تنبيه مخزون منخفض",user:"اسم المستخدم",name:"الاسم الكامل",role:"الدور",on:"نشط",off:"معطل",cashier:"أمين صندوق",manager:"مدير",adminR:"مسؤول",pass:"كلمة المرور",newPass:"كلمة مرور جديدة",setPass:"تعيين",chgPass:"تغيير",addUser:"إضافة مستخدم",addProd:"إضافة منتج",today:"اليوم",week:"الأسبوع",month:"الشهر",top:"الأكثر مبيعاً",qty:"الكمية",store:"اسم المتجر",taxR:"نسبة الضريبة",curr:"العملة",saveSt:"حفظ",saved:"تم الحفظ!",hourly:"المبيعات بالساعة",byCat:"حسب الفئة",payments:"طرق الدفع",trend:"الاتجاه الأسبوعي",ready:"ماسح الباركود جاهز",added:"أُضيف للسلة",notFound:"المنتج غير موجود",login:"تسجيل الدخول",loginErr:"اسم المستخدم أو كلمة المرور خاطئة",logout:"تسجيل الخروج",hi:"مرحباً بعودتك",supplier:"المورد",invNo:"رقم الفاتورة",addInv:"فاتورة جديدة",invItems:"بنود الفاتورة",addItem:"إضافة بند",selProd:"اختر المنتج...",costPr:"سعر الوحدة",saveInv:"حفظ وتحديث المخزون",totCost:"إجمالي الفاتورة",by:"استلمها",noInv:"لا توجد فواتير",updated:"تم تحديث المخزون!",bc:"باركود",unit:"الوحدة",nameEn:"الاسم بالإنجليزية",nameAr:"الاسم بالعربية",prodAdded:"تمت الإضافة!",excel:"تصدير Excel",autoSave:"قاعدة بيانات سحابية",loading:"جاري التحميل...",dbConnected:"متصل بقاعدة البيانات",dbError:"خطأ — وضع غير متصل",margin:"الهامش",marginPct:"نسبة الهامش",loyalty:"الولاء",customers:"العملاء",custPhone:"رقم الهاتف",custName:"اسم العميل",custNameAr:"الاسم (عربي)",searchCust:"أدخل رقم الهاتف...",custNotFound:"العميل غير موجود",addCust:"تسجيل عميل جديد",custAdded:"تم تسجيل العميل!",points:"النقاط",tier:"المستوى",totalSpent:"إجمالي الإنفاق",visits:"الزيارات",earnPts:"نقاط ستُكتسب",redeemPts:"استبدال النقاط",redeemAmt:"قيمة الاستبدال",ptsBalance:"الرصيد",bronze:"برونزي",silver:"فضي",gold:"ذهبي",vip:"VIP",custAttached:"تم ربط العميل",noCust:"بدون عميل (ضيف)",removeCust:"إزالة",custSearch:"بحث عن عميل",registerNew:"تسجيل",ptHistory:"سجل النقاط",earned:"مكتسبة",redeemed:"مستبدلة",multiplier:"المضاعف"}};

const CATS=[{id:"all",k:"all",i:"📦"},{id:"snacks",k:"snacks",i:"🍿"},{id:"chips",k:"chips",i:"🥜"},{id:"candy",k:"candy",i:"🍬"},{id:"beverages",k:"drinks",i:"🥤"},{id:"energy",k:"energy",i:"⚡"},{id:"water",k:"water",i:"💧"},{id:"cigarettes",k:"cigs",i:"🚬"},{id:"canned",k:"canned",i:"🥫"},{id:"personal",k:"care",i:"🧴"},{id:"household",k:"home",i:"🧹"}];

const TAX=0.16,fm=n=>n.toFixed(3)+" JD",fN=n=>n.toFixed(3);
const gI=()=>"T"+Date.now().toString(36).toUpperCase(),gR=()=>"R"+Math.floor(1e5+Math.random()*9e5);
const CC=["#2563eb","#f97316","#10b981","#8b5cf6","#ef4444","#06b6d4","#eab308"];
// Chart data is now computed from real transactions (see useMemo below)

export default function POS(){
const[lang,setLang]=useState("en");
const[loggedIn,setLI]=useState(false);const[cu,setCU]=useState(null);
const[lu,setLU]=useState("");const[lp,setLP]=useState("");const[le,setLE]=useState(false);
const[tab,setTab]=useState("sale");const[atab,setAT]=useState("inventory");
const[search,setSearch]=useState("");const[cat,setCat]=useState("all");
const[cart,setCart]=useState([]);const[disc,setDisc]=useState("");const[aDisc,setAD]=useState(0);
const[held,setHeld]=useState([]);const[txns,setTxns]=useState([]);
const[pmMod,setPM]=useState(null);const[rcMod,setRM]=useState(null);const[bcMod,setBM]=useState(false);
const[cTend,setCT]=useState("");const[prods,setProds]=useState([]);const[users,setUsers]=useState([]);
const[eProd,setEP]=useState(null);const[ePr,setEPr]=useState("");const[eSt,setESt]=useState("");
const[toast,setToast]=useState(null);const[pwMod,setPWM]=useState(null);const[nPW,setNPW]=useState("");
const[auMod,setAUM]=useState(false);const[nU,setNU]=useState({un:"",fn:"",fa:"",role:"cashier",pw:""});
const[apMod,setAPM]=useState(false);const[nP,setNP]=useState({bc:"",n:"",a:"",p:"",c:"",cat:"snacks",u:"pc",e:"📦"});
const[invs,setInvs]=useState([]);const[invMod,setInvMod]=useState(false);const[invView,setInvView]=useState(null);
const[invSup,setInvSup]=useState("");const[invNo,setInvNo]=useState("");
const[invItems,setInvItems]=useState([{prodId:"",qty:"",cost:""}]);
const[loading,setLoading]=useState(true);const[dbOk,setDbOk]=useState(false);
// Loyalty
const[customers,setCustomers]=useState([]);const[selCust,setSelCust]=useState(null);
const[custMod,setCustMod]=useState(false);const[custPhone,setCustPhone]=useState("");const[custSearch,setCustSearch]=useState(null);
const[custLoading,setCustLoading]=useState(false);const[newCustMod,setNewCustMod]=useState(false);
const[newCust,setNewCust]=useState({phone:"",name:"",nameAr:""});
const[redeemPts,setRedeemPts]=useState(0);const[custViewMod,setCustViewMod]=useState(null);const[custHistory,setCustHistory]=useState([]);
const[custPhoneInput,setCustPhoneInput]=useState("");
const bcRef=useRef(null),bcB=useRef(""),bcTm=useRef(null);
const t=T[lang],rtl=lang==="ar",pN=p=>rtl?p.a:p.n;

// ── LOAD ALL DATA FROM SUPABASE ──────────────────────────────
useEffect(()=>{
  async function load(){
    try{
      const[p,u,tx,inv,cust]=await Promise.all([DB.getProducts(),DB.getUsers(),DB.getTransactions(),DB.getInvoices(),DB.getCustomers()]);
      setProds(p);setUsers(u);setTxns(tx);setInvs(inv);setCustomers(cust);setDbOk(true);
    }catch(e){console.error("DB load error:",e);setDbOk(false);}
    setLoading(false);
  }
  load();
},[]);

// Refresh products periodically (for multi-terminal sync)
useEffect(()=>{
  if(!dbOk||!loggedIn) return;
  const interval=setInterval(async()=>{
    try{const p=await DB.getProducts();setProds(p);}catch{}
  },30000); // every 30 seconds
  return ()=>clearInterval(interval);
},[dbOk,loggedIn]);

// Real-time dashboard refresh — poll every 15 seconds
const[lastRefresh,setLastRefresh]=useState(null);
useEffect(()=>{
  if(!dbOk||!loggedIn) return;
  const poll=async()=>{
    try{
      const[tx,cust,p]=await Promise.all([DB.getTransactions(),DB.getCustomers(),DB.getProducts()]);
      setTxns(tx);setCustomers(cust);setProds(p);setLastRefresh(new Date());
    }catch{}
  };
  const iv=setInterval(poll,15000);
  return ()=>clearInterval(iv);
},[dbOk,loggedIn]);

// Barcode scanner
useEffect(()=>{if(!loggedIn)return;const h=e=>{const tg=e.target.tagName,iB=e.target.classList&&e.target.classList.contains("bsi");if((tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT")&&!iB)return;if(pmMod||rcMod)return;if(e.key==="Enter"){const c=bcB.current.trim();if(c.length>=4){const p=prods.find(x=>x.bc===c);if(p){addToCart(p);sT("✓ "+pN(p)+" "+t.added,"ok");}else sT("✗ "+t.notFound,"err");}bcB.current="";return;}if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){bcB.current+=e.key;clearTimeout(bcTm.current);bcTm.current=setTimeout(()=>{bcB.current=""},200);}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[loggedIn,prods,pmMod,rcMod,lang]);

const sT=(m,ty)=>{setToast({m,ty});setTimeout(()=>setToast(null),2200)};
const fp=useMemo(()=>prods.filter(p=>(cat==="all"||p.cat===cat)&&(!search||p.n.toLowerCase().includes(search.toLowerCase())||p.a.includes(search)||p.bc.includes(search))),[search,cat,prods]);
const sub=cart.reduce((s,i)=>s+i.p*i.qty,0),dA=aDisc>0?sub*(aDisc/100):0,taxable=sub-dA,tax=taxable*TAX,tot=taxable+tax,cCnt=cart.reduce((s,i)=>s+i.qty,0);
const addToCart=useCallback(p=>{setCart(prev=>{const ex=prev.find(i=>i.id===p.id);return ex?prev.map(i=>i.id===p.id?{...i,qty:i.qty+1}:i):[...prev,{...p,qty:1}]})},[]);
const uQ=useCallback((id,d)=>setCart(prev=>prev.map(i=>{if(i.id!==id)return i;const n=i.qty+d;return n>0?{...i,qty:n}:null}).filter(Boolean)),[]);
const rI=useCallback(id=>setCart(prev=>prev.filter(i=>i.id!==id)),[]);
const clr=useCallback(()=>{setCart([]);setAD(0);setDisc("");setSelCust(null);setRedeemPts(0);setCustPhoneInput("")},[]);

// ── CONFIRM PAYMENT → SAVE TO DATABASE ─────────────────────
// Loyalty helpers
const redeemVal=DB.pointsToJD(redeemPts);
const totAfterRedeem=Math.max(0,tot-redeemVal);
const earnablePts=selCust?DB.calcPoints(totAfterRedeem,selCust.tier):0;
const lookupCust=async()=>{if(!custPhone.trim())return;setCustLoading(true);try{const c=await DB.findCustomer(custPhone.trim());setCustSearch(c);if(!c)setCustSearch("notfound");}catch{setCustSearch("notfound");}setCustLoading(false)};
const attachCust=(c)=>{setSelCust(c);setCustMod(false);setCustPhone("");setCustSearch(null);setRedeemPts(0);setCustPhoneInput(c.phone);sT("✓ "+t.custAttached,"ok")};
const inlineLookup=async(phone)=>{if(!phone||phone.length<4)return;try{const c=await DB.findCustomer(phone.trim());if(c){setSelCust(c);setRedeemPts(0);sT("✓ "+c.name+" — "+t.custAttached,"ok")}else{setCustMod(true);setCustPhone(phone);setCustSearch("notfound")}}catch{}};
const registerCust=async()=>{if(!newCust.phone||!newCust.name)return;try{const c=await DB.addCustomer(newCust);if(c){setCustomers(p=>[...p,c]);setSelCust(c);setNewCustMod(false);setCustMod(false);setNewCust({phone:"",name:"",nameAr:""});sT("✓ "+t.custAdded,"ok");}}catch(e){console.error(e);sT("✗ Error","err")}};

const cP=async()=>{
  const finalTot=selCust&&redeemPts>0?totAfterRedeem:tot;
  const now=new Date();
  const tx={id:gI(),rn:gR(),items:[...cart],sub,disc:dA,dp:aDisc,tax,tot:finalTot,method:pmMod,ct:pmMod==="cash"?parseFloat(cTend):finalTot,ch:pmMod==="cash"?parseFloat(cTend)-finalTot:0,ts:now.toISOString(),time:now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),custPhone:selCust?.phone||null,custName:selCust?.name||null,ptsEarned:earnablePts,ptsRedeemed:redeemPts};
  setTxns(p=>[tx,...p]);setRM(tx);setPM(null);
  // Update customer points
  if(selCust){
    const newPts=selCust.pts+earnablePts-redeemPts;
    const newSpent=selCust.spent+finalTot;
    const newVisits=selCust.visits+1;
    setCustomers(p=>p.map(c=>c.id===selCust.id?{...c,pts:newPts,spent:newSpent,visits:newVisits,tier:newPts>=5000?"vip":newPts>=1500?"gold":newPts>=500?"silver":"bronze"}:c));
    try{
      await DB.updateCustomerPoints(selCust.id,newPts,newSpent,newVisits);
      if(earnablePts>0) await DB.addLoyaltyTx(selCust.id,tx.id,"earn",earnablePts,finalTot,"Sale "+tx.rn);
      if(redeemPts>0) await DB.addLoyaltyTx(selCust.id,tx.id,"redeem",redeemPts,redeemVal,"Redeem on "+tx.rn);
    }catch(e){console.error(e)}
  }
  clr();
  try{await DB.addTransaction(tx,cu?.id,cu?.fn);const p=await DB.getProducts();setProds(p);}catch(e){console.error(e);sT("⚠ DB sync error","err");}
};
const canC=pmMod==="cash"?parseFloat(cTend)>=(selCust&&redeemPts>0?totAfterRedeem:tot):true;
useEffect(()=>{if(bcMod&&bcRef.current)bcRef.current.focus()},[bcMod]);
const tT=txns.reduce((s,t2)=>s+t2.tot,0),tC=txns.length,aT=tC>0?tT/tC:0,tIS=txns.reduce((s,t2)=>s+t2.items.reduce((a,i)=>a+i.qty,0),0);
// Today / Week / Month from real data
const nowDate=new Date();
const todayStr=nowDate.toDateString();
const weekAgo=new Date(nowDate);weekAgo.setDate(weekAgo.getDate()-7);
const monthAgo=new Date(nowDate);monthAgo.setDate(monthAgo.getDate()-30);
const todaySales=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===todayStr}catch{return false}}).reduce((s,t2)=>s+t2.tot,0);
const weekSales=txns.filter(tx=>{try{return new Date(tx.ts)>=weekAgo}catch{return false}}).reduce((s,t2)=>s+t2.tot,0);
const monthSales=txns.filter(tx=>{try{return new Date(tx.ts)>=monthAgo}catch{return false}}).reduce((s,t2)=>s+t2.tot,0);
const todayTxns=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===todayStr}catch{return false}}).length;
// Enhanced KPIs
const todayItems=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===todayStr}catch{return false}}).reduce((s,t2)=>s+t2.items.reduce((a,i)=>a+i.qty,0),0);
const avgBasket=todayTxns>0?todaySales/todayTxns:0;
const todayProfit=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===todayStr}catch{return false}}).reduce((s,tx)=>s+tx.items.reduce((a,i)=>{const pr=prods.find(p=>p.id===i.id);return a+(i.p-(pr?pr.c:0))*i.qty},0),0);
const totalPurchases=invs.reduce((s,i)=>s+i.totalCost,0);
// Top products
const topProds=useMemo(()=>{const map={};txns.forEach(tx=>tx.items.forEach(i=>{if(!map[i.id])map[i.id]={name:i.n,nameAr:i.a,qty:0,rev:0};map[i.id].qty+=i.qty;map[i.id].rev+=i.p*i.qty}));return Object.values(map).sort((a,b)=>b.rev-a.rev).slice(0,5)},[txns]);
// Loyalty stats
const totalCustomers=customers.length;
const totalPointsIssued=customers.reduce((s,c)=>s+c.pts,0);
const loyaltySales=txns.filter(tx=>tx.custPhone).length;
const loyaltyPct=tC>0?((loyaltySales/tC)*100).toFixed(0):0;

// ── LOGIN → CHECK DATABASE ──────────────────────────────────
const hL=()=>{const f=users.find(u=>u.un===lu&&u.pw===lp&&u.st==="active");if(f){setCU(f);setLI(true);setLE(false)}else setLE(true)};

// ── SAVE INVOICE → DATABASE ─────────────────────────────────
const saveInv=async()=>{
  if(!invSup||!invNo)return;
  const vi=invItems.filter(x=>x.prodId&&x.qty);
  const inv={invoiceNo:invNo,supplier:invSup,totalCost:vi.reduce((s,x)=>s+(parseFloat(x.cost)||0)*(parseInt(x.qty)||0),0),receivedBy:cu?.fn||"",items:vi.map(x=>{const pr=prods.find(p=>p.id===x.prodId);return{...x,productName:pr?pN(pr):""}})};
  // Optimistic update
  setInvs(p=>[{...inv,id:Date.now(),date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})},...p]);
  setProds(p=>p.map(pr=>{const it=vi.find(x=>x.prodId===pr.id);return it?{...pr,s:pr.s+(parseInt(it.qty)||0),c:parseFloat(it.cost)||pr.c}:pr}));
  setInvMod(false);setInvSup("");setInvNo("");setInvItems([{prodId:"",qty:"",cost:""}]);
  sT("✓ "+t.updated,"ok");
  // Save to DB
  try{await DB.addInvoice(inv);const p=await DB.getProducts();setProds(p);}catch(e){console.error(e)}
};

// ── REAL-TIME CHART DATA FROM TRANSACTIONS ──────────────────
const hrD=useMemo(()=>{
  const hours={};
  for(let i=6;i<=23;i++) hours[i]=0;
  txns.forEach(tx=>{
    const h=parseInt(tx.time);
    if(!isNaN(h)) hours[h]=(hours[h]||0)+tx.tot;
  });
  return Object.entries(hours).map(([h,v])=>({h:h+":00",v:+v.toFixed(3)}));
},[txns]);

const dyD=useMemo(()=>{
  const days={"Sun":0,"Mon":0,"Tue":0,"Wed":0,"Thu":0,"Fri":0,"Sat":0};
  txns.forEach(tx=>{
    try{
      const parts=tx.date.split(" ");
      // date format: "Mon, Mar 25, 2026" or "Mar 25, 2026"
      const d=new Date(tx.date);
      if(!isNaN(d)){const dn=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];days[dn]=(days[dn]||0)+tx.tot;}
    }catch{}
  });
  return["Sat","Sun","Mon","Tue","Wed","Thu","Fri"].map(d=>({d,r:+days[d].toFixed(3)}));
},[txns]);

const ctD=useMemo(()=>{
  const catMap={"chips":"Chips","candy":"Candy","beverages":"Drinks","energy":"Energy","water":"Water","cigarettes":"Cigarettes","snacks":"Snacks","canned":"Canned","personal":"Care","household":"Home"};
  const catMapAr={"chips":"شيبس","candy":"حلويات","beverages":"مشروبات","energy":"طاقة","water":"مياه","cigarettes":"سجائر","snacks":"خفيفة","canned":"معلبات","personal":"عناية","household":"منزلية"};
  const cats={};
  txns.forEach(tx=>{tx.items.forEach(i=>{
    const pr=prods.find(p=>p.id===i.id);
    const c=pr?pr.cat:"other";
    cats[c]=(cats[c]||0)+i.p*i.qty;
  })});
  const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return sorted.map(([k,v])=>({n:catMap[k]||k,a:catMapAr[k]||k,value:+v.toFixed(3)}));
},[txns,prods]);

const ppD=useMemo(()=>{
  const cash=txns.filter(x=>x.method==="cash").reduce((s,x)=>s+x.tot,0);
  const card=txns.filter(x=>x.method==="card").reduce((s,x)=>s+x.tot,0);
  const mobile=txns.filter(x=>x.method==="mobile").reduce((s,x)=>s+x.tot,0);
  if(cash===0&&card===0&&mobile===0) return[{name:t.cash,value:0},{name:t.card,value:0},{name:t.mada,value:0}];
  return[{name:t.cash,value:+cash.toFixed(3)},{name:t.card,value:+card.toFixed(3)},{name:t.mada,value:+mobile.toFixed(3)}];
},[txns,lang]);

// ── LOADING SCREEN ──────────────────────────────────────────
if(loading) return(<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f9fafb",fontFamily:"Plus Jakarta Sans,sans-serif"}}><div style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:16}}>🔄</div><div style={{fontSize:16,fontWeight:600,color:"#374151"}}>{t.loading}</div></div></div>);

// All the same CSS as before + small db indicator
const ttip={background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,fontSize:12};

// Using the same clean white CSS from the previous version
// (abbreviated here — the full CSS string is the same as the white theme version)
const S=`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');:root{--w:#fff;--g50:#f9fafb;--g100:#f3f4f6;--g200:#e5e7eb;--g300:#d1d5db;--g400:#9ca3af;--g500:#6b7280;--g600:#4b5563;--g700:#374151;--g800:#1f2937;--g900:#111827;--blue:#2563eb;--blue50:#eff6ff;--blue100:#dbeafe;--green:#059669;--green50:#ecfdf5;--green100:#d1fae5;--org:#ea580c;--red:#dc2626;--red50:#fef2f2;--purple:#7c3aed;--amber:#d97706;--amber50:#fffbeb;--r:12px;--f:'Plus Jakarta Sans',sans-serif;--m:'JetBrains Mono',monospace;--shadow:0 1px 3px rgba(0,0,0,.08);--shadow2:0 4px 12px rgba(0,0,0,.1);--shadow3:0 10px 40px rgba(0,0,0,.12)}*{margin:0;padding:0;box-sizing:border-box}body,#root{font-family:var(--f);background:var(--g50);color:var(--g900);height:100vh;overflow:hidden}.app{display:flex;flex-direction:column;height:100vh;direction:${rtl?"rtl":"ltr"}}
.login-wrap{height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eff6ff 0%,#f0fdf4 50%,#fff7ed 100%)}.login-card{background:var(--w);border-radius:20px;padding:40px 36px;width:380px;box-shadow:var(--shadow3)}.login-logo{text-align:center;margin-bottom:28px}.login-logo h1{font-size:32px;font-weight:800}.login-logo h1 span{color:var(--blue)}.login-logo p{color:var(--g400);font-size:13px;margin-top:4px}.lf{margin-bottom:16px}.lf label{display:block;font-size:12px;font-weight:600;color:var(--g600);margin-bottom:6px}.lf input{width:100%;padding:12px 16px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g900);font-size:14px;font-family:var(--f);outline:none}.lf input:focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--blue50)}.login-btn{width:100%;padding:14px;background:var(--blue);border:none;border-radius:var(--r);color:var(--w);font-size:15px;font-weight:700;cursor:pointer;font-family:var(--f);margin-top:4px}.login-btn:hover{background:#1d4ed8}.login-err{color:var(--red);font-size:12px;text-align:center;margin-top:10px}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:var(--w);border-bottom:1px solid var(--g200);flex-shrink:0}.logo-a{display:flex;align-items:center;gap:10px}.logo-m{width:36px;height:36px;background:linear-gradient(135deg,var(--blue),var(--green));border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:var(--w)}.logo-t{font-size:18px;font-weight:800}.logo-t span{color:var(--blue)}.hdr-r{display:flex;align-items:center;gap:8px}.hb{display:flex;align-items:center;gap:4px;background:var(--g50);padding:6px 12px;border-radius:20px;border:1px solid var(--g200);cursor:pointer;font-family:var(--f);color:var(--g600);font-size:11px;font-weight:500}.hb:hover{border-color:var(--blue);color:var(--blue);background:var(--blue50)}.hb-blue{background:var(--blue50);border-color:var(--blue100);color:var(--blue)}.hb-red:hover{background:var(--red50);color:var(--red)}.db-badge{font-size:10px;color:var(--green);background:var(--green50);padding:3px 10px;border-radius:20px;font-weight:600;border:1px solid var(--green100);display:flex;align-items:center;gap:4px}.db-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pu 2s ease infinite}
.nav{display:flex;gap:2px;padding:0 20px;background:var(--w);border-bottom:1px solid var(--g200);flex-shrink:0}.nt{padding:10px 18px;font-size:13px;font-weight:600;color:var(--g400);background:none;border:none;cursor:pointer;border-bottom:2.5px solid transparent;font-family:var(--f)}.nt:hover{color:var(--g600)}.nt.a{color:var(--blue);border-bottom-color:var(--blue)}
.mn{display:flex;flex:1;overflow:hidden}.pp{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--g50)}.sb{padding:12px 16px;display:flex;gap:8px;flex-shrink:0;background:var(--w);border-bottom:1px solid var(--g100)}.sw{flex:1;position:relative}.sw-icon{position:absolute;${rtl?"right":"left"}:12px;top:50%;transform:translateY(-50%);color:var(--g400)}.si{width:100%;padding:10px 14px 10px 38px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g900);font-size:13px;font-family:var(--f);outline:none;direction:${rtl?"rtl":"ltr"}}.si:focus{border-color:var(--blue);background:var(--w)}.bb{padding:10px 14px;background:var(--w);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g600);cursor:pointer;font-family:var(--f);font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px}.bb:hover{border-color:var(--blue);color:var(--blue)}
.cats{display:flex;gap:6px;padding:12px 16px;overflow-x:auto;flex-shrink:0}.cats::-webkit-scrollbar{height:0}.ch{padding:6px 14px;background:var(--w);border:1.5px solid var(--g200);border-radius:20px;font-size:12px;font-weight:500;color:var(--g500);cursor:pointer;white-space:nowrap;font-family:var(--f)}.ch:hover{border-color:var(--blue);color:var(--blue)}.ch.a{background:var(--blue);border-color:var(--blue);color:var(--w);font-weight:600}
.pg{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;padding:12px 16px;overflow-y:auto;flex:1}.pg::-webkit-scrollbar{width:5px}.pg::-webkit-scrollbar-thumb{background:var(--g300);border-radius:10px}.pc{background:var(--w);border:1.5px solid var(--g200);border-radius:16px;padding:14px 12px;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;gap:6px;position:relative}.pc:hover{border-color:var(--blue);transform:translateY(-2px);box-shadow:var(--shadow2)}.pc:active{transform:scale(.97)}.pe{font-size:28px}.pn{font-size:12px;font-weight:600;color:var(--g700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pm{display:flex;justify-content:space-between;align-items:center}.pp2{font-family:var(--m);font-size:14px;font-weight:700;color:var(--blue)}.pu{font-size:10px;color:var(--g400)}.pl{position:absolute;top:8px;${rtl?"left":"right"}:8px;width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 6px var(--amber)}
.cp{width:350px;display:flex;flex-direction:column;background:var(--w);border-${rtl?"right":"left"}:1px solid var(--g200);flex-shrink:0}.ch2{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--g100)}.ch2 h3{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}.cc{background:var(--blue);color:var(--w);font-size:11px;padding:2px 8px;border-radius:10px;font-weight:700}.ccl{font-size:12px;color:var(--red);background:none;border:none;cursor:pointer;font-family:var(--f);font-weight:600}.ciw{flex:1;overflow-y:auto;padding:4px 0}.cem{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--g400);gap:8px}.ci{display:flex;align-items:center;gap:10px;padding:10px 16px;animation:sIn .2s ease}.ci:hover{background:var(--g50)}.cif{flex:1;min-width:0}.cin{font-size:13px;font-weight:600;color:var(--g700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cip{font-size:11px;color:var(--g400);font-family:var(--m)}.qc{display:flex;align-items:center;background:var(--g50);border-radius:8px;border:1.5px solid var(--g200)}.qb{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--g500);cursor:pointer;font-size:14px;font-weight:700}.qb:hover{color:var(--blue);background:var(--blue50)}.qv{width:30px;text-align:center;font-size:13px;font-weight:700;font-family:var(--m)}.ct{font-family:var(--m);font-size:13px;font-weight:700;min-width:55px;text-align:${rtl?"left":"right"}}.crm{background:none;border:none;color:var(--g300);cursor:pointer;font-size:14px;opacity:0;border-radius:6px;padding:4px}.ci:hover .crm{opacity:1}.crm:hover{color:var(--red);background:var(--red50)}
.csm{padding:14px 16px;border-top:1px solid var(--g100)}.sr{display:flex;justify-content:space-between;font-size:13px;color:var(--g500);margin-bottom:6px;font-weight:500}.sr span:last-child{font-family:var(--m);font-weight:600;color:var(--g700)}.sr.T{font-size:18px;font-weight:800;color:var(--g900);margin-top:10px;padding-top:10px;border-top:2px solid var(--g200);margin-bottom:0}.sr.T span:last-child{color:var(--blue)}.dr{display:flex;gap:6px;margin-top:8px}.di{flex:1;padding:8px 12px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);font-size:12px;font-family:var(--f);outline:none;color:var(--g900)}.di:focus{border-color:var(--blue)}.da{padding:8px 16px;background:var(--org);border:none;border-radius:var(--r);color:var(--w);font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)}
.pbs{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--g100)}.pb{flex:1;padding:14px;border:none;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--f);display:flex;flex-direction:column;align-items:center;gap:4px}.pb:disabled{opacity:.4;cursor:not-allowed}.pb.c{background:var(--green);color:var(--w)}.pb.d{background:var(--blue);color:var(--w)}.pb.m{background:var(--purple);color:var(--w)}.pb:not(:disabled):hover{transform:translateY(-2px);box-shadow:var(--shadow2)}.pbi{font-size:20px}
.hb2{width:calc(100% - 32px);padding:8px;background:var(--amber50);border:1.5px dashed var(--amber);border-radius:var(--r);color:var(--amber);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--f);margin:0 16px 6px;text-align:center}.hb2:hover{background:#fef3c7}
.ov{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(6px);animation:fIn .2s ease}.md{background:var(--w);border-radius:20px;padding:28px;min-width:380px;max-width:500px;box-shadow:var(--shadow3);direction:${rtl?"rtl":"ltr"};max-height:88vh;overflow-y:auto}.md h2{font-size:18px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:8px}.mc{margin-${rtl?"right":"left"}:auto;background:var(--g100);border:none;color:var(--g500);font-size:14px;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center}.mc:hover{background:var(--g200)}.ptd{font-size:32px;font-weight:800;color:var(--blue);font-family:var(--m);text-align:center;padding:20px;background:var(--blue50);border-radius:16px;margin-bottom:16px}.pf{margin-bottom:12px}.pf label{display:block;font-size:12px;font-weight:600;color:var(--g600);margin-bottom:5px}.pf input,.pf select{width:100%;padding:10px 14px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g900);font-size:13px;font-family:var(--m);outline:none}.pf input:focus,.pf select:focus{border-color:var(--blue)}.pf select{font-family:var(--f)}.chd{text-align:center;padding:12px;background:var(--green50);border-radius:var(--r);margin-bottom:12px}.chl{font-size:12px;color:var(--g500)}.cha{font-size:24px;font-weight:800;color:var(--green);font-family:var(--m)}.cpb{width:100%;padding:14px;background:var(--blue);border:none;border-radius:var(--r);color:var(--w);font-size:14px;font-weight:700;cursor:pointer;font-family:var(--f)}.cpb:hover{background:#1d4ed8}.cpb:disabled{opacity:.4}.cpb-green{background:var(--green)}.cpb-green:hover{background:#047857}
.rcpt{background:var(--w);padding:20px;border-radius:16px;font-size:12px;border:1px solid var(--g200);max-height:55vh;overflow-y:auto;direction:ltr}.rh{text-align:center;margin-bottom:14px;padding-bottom:10px;border-bottom:2px dashed var(--g200)}.rh h2{font-size:18px;font-weight:800}.rh p{color:var(--g400);font-size:11px}.ri{display:flex;justify-content:space-between;padding:3px 0}.rin{flex:1;font-weight:500}.riq{width:30px;text-align:center;color:var(--g400)}.rit{width:60px;text-align:right;font-family:var(--m);font-weight:600}.rd{border:none;border-top:2px dashed var(--g200);margin:8px 0}.rsr{display:flex;justify-content:space-between;padding:3px 0;color:var(--g500)}.rsr.T{font-size:16px;font-weight:800;padding:6px 0;color:var(--g900)}.rf{text-align:center;margin-top:14px;padding-top:10px;border-top:2px dashed var(--g200);color:var(--g400);font-size:11px}.ra{display:flex;gap:8px;margin-top:14px}.rb{flex:1;padding:12px;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--f);border:none}.rb-p{background:var(--org);color:var(--w)}.rb-n{background:var(--blue);color:var(--w)}
.dsh{flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;background:var(--g50)}.dg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.dc{background:var(--w);border:1px solid var(--g200);border-radius:16px;padding:16px}.dcl{font-size:11px;color:var(--g400);font-weight:600;text-transform:uppercase;letter-spacing:.5px}.dcv{font-size:22px;font-weight:800;font-family:var(--m)}.dcv.g{color:var(--green)}.dcv.b{color:var(--blue)}.dcv.p{color:var(--purple)}.dcv.y{color:var(--amber)}.dcc{font-size:11px;color:var(--green);margin-top:2px}.cg{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ck{background:var(--w);border:1px solid var(--g200);border-radius:16px;padding:16px}.ckt{font-size:13px;font-weight:700;margin-bottom:10px;color:var(--g700)}
.tb{background:var(--w);border:1px solid var(--g200);border-radius:16px;overflow:hidden}.tbh{padding:12px 16px;font-size:14px;font-weight:700;border-bottom:1px solid var(--g100);display:flex;justify-content:space-between;align-items:center}.tb table{width:100%;border-collapse:collapse}.tb th{text-align:${rtl?"right":"left"};padding:8px 16px;font-size:11px;color:var(--g400);font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--g100)}.tb td{padding:8px 16px;font-size:12px;border-bottom:1px solid var(--g50);color:var(--g600)}.tb td.mn{font-family:var(--m);font-weight:600;color:var(--g800)}.sbg{padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600}.sbg.c{background:var(--green50);color:var(--green)}
.hld{flex:1;padding:16px;overflow-y:auto;background:var(--g50)}.hc{background:var(--w);border:1px solid var(--g200);border-radius:16px;padding:14px;margin-bottom:8px;cursor:pointer}.hc:hover{border-color:var(--blue);box-shadow:var(--shadow)}.ht2{display:flex;justify-content:space-between;margin-bottom:6px}.hid{font-family:var(--m);font-size:12px;font-weight:700;color:var(--blue)}.htm{font-size:11px;color:var(--g400)}.hti{font-size:12px;color:var(--g500)}.htt{font-family:var(--m);font-size:15px;font-weight:700;color:var(--green)}.has{display:flex;gap:6px;margin-top:8px}.hbn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--f);border:none}.hbn-r{background:var(--blue);color:var(--w)}.hbn-d{background:var(--red50);color:var(--red)}
.bsi{width:100%;padding:14px;background:var(--g50);border:2px solid var(--blue);border-radius:var(--r);color:var(--g900);font-size:20px;font-family:var(--m);text-align:center;letter-spacing:4px;outline:none;margin-bottom:10px}.bsi:focus{box-shadow:0 0 0 4px var(--blue50)}
.ad{flex:1;display:flex;overflow:hidden}.ads{width:180px;background:var(--w);border-${rtl?"left":"right"}:1px solid var(--g200);padding:12px 0}.asb{width:100%;padding:10px 20px;background:none;border:none;text-align:${rtl?"right":"left"};font-size:13px;font-weight:500;color:var(--g500);cursor:pointer;font-family:var(--f);display:flex;align-items:center;gap:8px}.asb:hover{background:var(--g50)}.asb.a{background:var(--blue50);color:var(--blue);font-weight:700;border-${rtl?"left":"right"}:3px solid var(--blue)}.ac{flex:1;padding:16px;overflow-y:auto;background:var(--g50)}.ac h2{font-size:18px;font-weight:800;margin-bottom:14px}
.at{width:100%;border-collapse:collapse;background:var(--w);border-radius:16px;overflow:hidden;border:1px solid var(--g200)}.at th{text-align:${rtl?"right":"left"};padding:10px 14px;font-size:11px;color:var(--g400);font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--g200);background:var(--g50)}.at td{padding:8px 14px;font-size:12px;border-bottom:1px solid var(--g50)}.at input{padding:6px 10px;background:var(--g50);border:1.5px solid var(--g200);border-radius:8px;font-size:12px;font-family:var(--m);outline:none;width:70px;color:var(--g900)}.at input:focus{border-color:var(--blue)}
.ab{padding:5px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--f);border:none;margin:0 2px}.ab-e{background:var(--blue50);color:var(--blue)}.ab-s{background:var(--green);color:var(--w)}.ab-c{background:var(--g100);color:var(--g500)}.ab-d{background:var(--red50);color:var(--red)}.ab-p{background:var(--amber50);color:var(--amber)}.ab-x{background:var(--blue);color:var(--w)}
.lw{background:var(--amber50);border:1.5px solid var(--amber);border-radius:16px;padding:12px 16px;margin-bottom:14px}.lwt{font-size:13px;font-weight:700;color:var(--amber)}.lwi{font-size:12px;color:var(--g500)}.us{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;cursor:pointer}.us-a{background:var(--green50);color:var(--green)}.us-i{background:var(--red50);color:var(--red)}
.sf{max-width:400px}.sf label{display:block;font-size:12px;font-weight:600;color:var(--g600);margin:14px 0 5px}.sf input{width:100%;padding:10px 14px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);font-size:13px;font-family:var(--f);outline:none;color:var(--g900)}.sf input:focus{border-color:var(--blue)}.svb{margin-top:16px;padding:12px 24px;background:var(--blue);border:none;border-radius:var(--r);color:var(--w);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--f)}.rc{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
.inv-row{display:flex;gap:6px;margin-bottom:6px}.inv-row select,.inv-row input{flex:1;padding:8px 10px;background:var(--g50);border:1.5px solid var(--g200);border-radius:8px;font-size:12px;font-family:var(--f);outline:none;color:var(--g900)}.inv-row select:focus,.inv-row input:focus{border-color:var(--blue)}.inv-rm{background:none;border:none;color:var(--red);cursor:pointer;font-size:16px}
.inv-card{background:var(--w);border:1px solid var(--g200);border-radius:16px;padding:12px;margin-bottom:8px;cursor:pointer}.inv-card:hover{border-color:var(--blue);box-shadow:var(--shadow)}
.toast{position:fixed;top:70px;${rtl?"left":"right"}:20px;padding:12px 20px;border-radius:var(--r);font-size:13px;font-weight:600;z-index:2000;animation:sIn .3s ease;box-shadow:var(--shadow3)}.toast-ok{background:var(--green);color:var(--w)}.toast-err{background:var(--red);color:var(--w)}
.bci{position:fixed;bottom:14px;${rtl?"left":"right"}:16px;padding:6px 14px;background:var(--w);border:1px solid var(--g200);border-radius:20px;font-size:11px;color:var(--g500);z-index:500;display:flex;align-items:center;gap:6px;box-shadow:var(--shadow)}.bcd{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pu 2s ease infinite}
@keyframes sIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes fIn{from{opacity:0}to{opacity:1}}@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}
.recharts-text{fill:var(--g500)!important;font-size:10px!important;font-family:var(--f)!important}.recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:var(--g100)!important}`;

// ── RENDER ───────────────────────────────────────────────────
// (Same JSX as white-theme version — login, sale, held, dashboard, admin tabs)
// The key difference: all mutations (confirmPayment, addProduct, saveInvoice, etc.) now call DB.* functions

if(!loggedIn)return(<><style>{S}</style><div className="login-wrap"><div className="login-card"><div className="login-logo"><h1><span>3045</span> Super</h1><p>Grocery Shopping — POS System</p></div><div className="lf"><label>{t.user}</label><input value={lu} onChange={e=>{setLU(e.target.value);setLE(false)}} onKeyDown={e=>{if(e.key==="Enter")hL()}} autoFocus placeholder={rtl?"اسم المستخدم":"Username"}/></div><div className="lf"><label>{t.pass}</label><input type="password" value={lp} onChange={e=>{setLP(e.target.value);setLE(false)}} onKeyDown={e=>{if(e.key==="Enter")hL()}} placeholder="••••••••"/></div><button className="login-btn" onClick={hL}>{t.login}</button>{le&&<div className="login-err">{t.loginErr}</div>}<div style={{textAlign:"center",marginTop:16}}><button onClick={()=>setLang(lang==="en"?"ar":"en")} style={{background:"none",border:"1px solid #e5e7eb",color:"#6b7280",fontSize:12,cursor:"pointer",fontFamily:"var(--f)",padding:"6px 16px",borderRadius:20,fontWeight:600}}>🌐 {t.lang}</button></div><div style={{marginTop:14,fontSize:11,color:"#9ca3af",textAlign:"center"}}>admin / admin123 · khalid / 1234</div>{dbOk?<div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#059669"}}>✓ {t.dbConnected}</div>:<div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#dc2626"}}>⚠ {t.dbError}</div>}</div></div></>);

return(<><style>{S}</style><div className="app">
<header className="hdr"><div className="logo-a"><div className="logo-m">30</div><div className="logo-t"><span>3045</span> Super</div><span className="db-badge"><span className="db-dot"/>☁️ {t.autoSave}</span></div><div className="hdr-r"><div className="hb">📍 {t.terminal}</div><div className="hb">👤 {rtl?(cu.fa||cu.fn):cu.fn}</div><button className="hb hb-blue" onClick={()=>exportXL(prods,txns,invs)}>📥 {t.excel}</button><button className="hb" onClick={()=>setLang(lang==="en"?"ar":"en")}>🌐 {t.lang}</button><button className="hb hb-red" onClick={()=>{setLI(false);setCU(null);setLU("");setLP("")}}>🚪 {t.logout}</button></div></header>

<nav className="nav"><button className={"nt "+(tab==="sale"?"a":"")} onClick={()=>setTab("sale")}>🛒 {t.newSale}</button><button className={"nt "+(tab==="held"?"a":"")} onClick={()=>setTab("held")}>⏸ {t.held}{held.length>0?" ("+held.length+")":""}</button><button className={"nt "+(tab==="dashboard"?"a":"")} onClick={()=>setTab("dashboard")}>📊 {t.dashboard}</button>{(cu.role==="admin"||cu.role==="manager")&&<button className={"nt "+(tab==="admin"?"a":"")} onClick={()=>setTab("admin")}>⚙️ {t.admin}</button>}</nav>

<div className="mn">
{/* SALE TAB */}
{tab==="sale"&&<><div className="pp"><div className="sb"><div className="sw"><span className="sw-icon">🔍</span><input className="si" placeholder={t.search} value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="bb" onClick={()=>setBM(true)}>▦ {t.barcode}</button></div><div className="cats">{CATS.map(c=><button key={c.id} className={"ch "+(cat===c.id?"a":"")} onClick={()=>setCat(c.id)}>{c.i} {t[c.k]}</button>)}</div><div className="pg">{fp.map(p=><div key={p.id} className="pc" onClick={()=>addToCart(p)}>{p.s<30&&<div className="pl"/>}<div className="pe">{p.e}</div><div className="pn">{pN(p)}</div><div className="pm"><span className="pp2">{fN(p.p)}</span><span className="pu">/ {p.u}</span></div></div>)}{!fp.length&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"#9ca3af"}}>{t.none}</div>}</div></div>
<div className="cp"><div className="ch2"><h3>🧾 {t.currentSale}{cCnt>0&&<span className="cc">{cCnt}</span>}</h3>{cart.length>0&&<button className="ccl" onClick={clr}>{t.clear}</button>}</div><div className="ciw">{!cart.length?<div className="cem"><div style={{fontSize:48,opacity:.2}}>🛒</div><div style={{fontSize:14,fontWeight:600}}>{t.empty}</div><div style={{fontSize:12}}>{t.emptyHint}</div></div>:cart.map(i=><div key={i.id} className="ci"><div className="cif"><div className="cin">{pN(i)}</div><div className="cip">{fm(i.p)} × {i.qty}</div></div><div className="qc"><button className="qb" onClick={()=>uQ(i.id,-1)}>−</button><span className="qv">{i.qty}</span><button className="qb" onClick={()=>uQ(i.id,1)}>+</button></div><div className="ct">{fN(i.p*i.qty)}</div><button className="crm" onClick={()=>rI(i.id)}>✕</button></div>)}</div>
{cart.length>0&&<><button className="hb2" onClick={()=>{if(!cart.length)return;setHeld(p=>[...p,{id:gI(),items:[...cart],time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}),disc:aDisc}]);clr()}}>⏸ {t.hold}</button>
{/* CUSTOMER — ALWAYS VISIBLE PHONE INPUT */}
<div style={{padding:"8px 16px",borderTop:"1px solid var(--g100)"}}>
<div style={{display:"flex",gap:6,marginBottom:selCust?8:0}}>
<div style={{position:"relative",flex:1}}>
<span style={{position:"absolute",left:rtl?"auto":10,right:rtl?10:"auto",top:"50%",transform:"translateY(-50%)",fontSize:13}}>📱</span>
<input value={custPhoneInput} onChange={e=>{setCustPhoneInput(e.target.value);if(!e.target.value)setSelCust(null)}} onKeyDown={e=>{if(e.key==="Enter")inlineLookup(custPhoneInput)}} placeholder={t.searchCust} style={{width:"100%",padding:"10px 10px 10px 34px",background:selCust?"#eff6ff":"var(--g50)",border:selCust?"2px solid #2563eb":"1.5px solid var(--g200)",borderRadius:10,fontSize:14,fontFamily:"var(--m)",outline:"none",color:"var(--g900)",letterSpacing:1,direction:"ltr"}}/>
</div>
<button onClick={()=>inlineLookup(custPhoneInput)} disabled={!custPhoneInput.trim()} style={{padding:"10px 16px",background:"#2563eb",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",fontSize:12,opacity:custPhoneInput.trim()?"1":".4"}}>🔍</button>
<button onClick={()=>{setCustMod(true);setCustPhone(custPhoneInput);setCustSearch(null)}} style={{padding:"10px 12px",background:"var(--g100)",border:"none",borderRadius:10,color:"var(--g600)",cursor:"pointer",fontSize:14}}>👤</button>
</div>

{selCust&&<div style={{background:"linear-gradient(135deg,#eff6ff,#f0fdf4)",border:"1.5px solid #bfdbfe",borderRadius:12,padding:10}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#2563eb,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:13}}>{selCust.name.charAt(0)}</div>
<div><div style={{fontSize:13,fontWeight:700,color:"#1e40af"}}>{selCust.name}</div><div style={{fontSize:10,color:"#6b7280"}}>{selCust.phone} · <span style={{textTransform:"uppercase",fontWeight:700,color:selCust.tier==="vip"?"#7c3aed":selCust.tier==="gold"?"#d97706":"#6b7280"}}>{t[selCust.tier]}</span></div></div>
</div>
<button onClick={()=>{setSelCust(null);setRedeemPts(0);setCustPhoneInput("")}} style={{background:"#fee2e2",border:"none",color:"#dc2626",fontSize:9,cursor:"pointer",fontFamily:"var(--f)",fontWeight:600,padding:"4px 10px",borderRadius:6}}>✕</button>
</div>
<div style={{display:"flex",gap:6,fontSize:10}}>
<div style={{flex:1,background:"#fff",borderRadius:8,padding:"6px 8px",textAlign:"center"}}><div style={{color:"#6b7280",fontSize:9}}>{t.points}</div><div style={{fontWeight:800,color:"#2563eb",fontFamily:"var(--m)",fontSize:16}}>{selCust.pts}</div></div>
<div style={{flex:1,background:"#fff",borderRadius:8,padding:"6px 8px",textAlign:"center"}}><div style={{color:"#6b7280",fontSize:9}}>{t.multiplier}</div><div style={{fontWeight:800,color:"#059669",fontFamily:"var(--m)",fontSize:16}}>{DB.tierMultiplier(selCust.tier)}x</div></div>
<div style={{flex:1,background:"#ecfdf5",borderRadius:8,padding:"6px 8px",textAlign:"center"}}><div style={{color:"#6b7280",fontSize:9}}>{t.earnPts}</div><div style={{fontWeight:800,color:"#059669",fontFamily:"var(--m)",fontSize:16}}>+{earnablePts}</div></div>
</div>
{selCust.pts>=20&&<div style={{marginTop:8}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}><span style={{color:"#6b7280"}}>{t.redeemPts} ({t.ptsBalance}: {selCust.pts})</span><span style={{color:"#059669",fontWeight:700}}>{redeemPts>0?"-"+fm(redeemVal):""}</span></div><input type="range" min="0" max={Math.min(selCust.pts,Math.floor(tot/0.005))} step="10" value={redeemPts} onChange={e=>setRedeemPts(+e.target.value)} style={{width:"100%",accentColor:"#2563eb"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#9ca3af"}}><span>0</span><span>{redeemPts} pts = {fm(redeemVal)}</span><span>{Math.min(selCust.pts,Math.floor(tot/0.005))}</span></div></div>}
</div>}
{!selCust&&custPhoneInput.length>0&&<div style={{fontSize:10,color:"#9ca3af",marginTop:4,textAlign:"center"}}>{rtl?"اضغط Enter أو 🔍 للبحث":"Press Enter or 🔍 to search"}</div>}
</div>
<div className="csm"><div className="sr"><span>{t.subtotal}</span><span>{fm(sub)}</span></div>{aDisc>0&&<div className="sr" style={{color:"#ea580c"}}><span>{t.discount} ({aDisc}%)</span><span>−{fm(dA)}</span></div>}<div className="sr"><span>{t.vat}</span><span>{fm(tax)}</span></div>{redeemPts>0&&selCust&&<div className="sr" style={{color:"#7c3aed"}}><span>🎁 {t.redeemPts} ({redeemPts})</span><span>−{fm(redeemVal)}</span></div>}<div className="sr T"><span>{t.total}</span><span>{fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</span></div><div className="dr"><input className="di" placeholder={t.discPct} value={disc} onChange={e=>setDisc(e.target.value)}/><button className="da" onClick={()=>{const v=parseFloat(disc);if(!isNaN(v)&&v>0&&v<=100)setAD(v)}}>{t.apply}</button></div></div><div className="pbs"><button className="pb c" onClick={()=>{setPM("cash");setCT("")}} disabled={!cart.length}><span className="pbi">💵</span>{t.cash}</button><button className="pb d" onClick={()=>{setPM("card");setCT("")}} disabled={!cart.length}><span className="pbi">💳</span>{t.card}</button><button className="pb m" onClick={()=>{setPM("mobile");setCT("")}} disabled={!cart.length}><span className="pbi">📱</span>{t.mada}</button></div></>}</div></>}

{/* HELD */}
{tab==="held"&&<div className="hld"><h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>⏸ {t.held} ({held.length})</h2>{!held.length?<div style={{textAlign:"center",padding:60,color:"#9ca3af"}}><div style={{fontSize:48}}>📋</div>{t.noHeld}</div>:held.map(o=><div key={o.id} className="hc"><div className="ht2"><span className="hid">{o.id}</span><span className="htm">{o.date}</span></div><div className="hti">{o.items.map(i=>pN(i)+" ×"+i.qty).join(", ")}</div><div className="htt">{fm(o.items.reduce((s,i)=>s+i.p*i.qty,0))}</div><div className="has"><button className="hbn hbn-r" onClick={()=>{setCart(o.items);setAD(o.disc);setHeld(p=>p.filter(x=>x.id!==o.id));setTab("sale")}}>{t.resume}</button><button className="hbn hbn-d" onClick={()=>setHeld(p=>p.filter(x=>x.id!==o.id))}>{t.del}</button></div></div>)}</div>}

{/* DASHBOARD — ENHANCED REAL-TIME */}
{tab==="dashboard"&&<div className="dsh">
{/* Header with live indicator */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<h2 style={{fontSize:18,fontWeight:800,margin:0}}>📊 {t.dashboard}</h2>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#059669",background:"#ecfdf5",padding:"4px 12px",borderRadius:20,fontWeight:600,border:"1px solid #d1fae5"}}><span style={{width:7,height:7,borderRadius:"50%",background:"#059669",animation:"pu 2s ease infinite",display:"inline-block"}}/> LIVE</div>
{lastRefresh&&<span style={{fontSize:10,color:"#9ca3af"}}>{lastRefresh.toLocaleTimeString()}</span>}
<button onClick={async()=>{try{const[tx,p,c]=await Promise.all([DB.getTransactions(),DB.getProducts(),DB.getCustomers()]);setTxns(tx);setProds(p);setCustomers(c);setLastRefresh(new Date());sT("✓ Refreshed","ok")}catch{}}} style={{padding:"6px 14px",background:"#2563eb",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>🔄 Refresh</button>
</div></div>

{/* KPI Cards — 2 rows */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
<div className="dc" style={{borderLeft:"4px solid #059669"}}><div className="dcl">📅 {t.today}</div><div className="dcv g">{fm(todaySales)}</div><div className="dcc">{todayTxns} {t.txns.toLowerCase()} · {todayItems} {t.items.toLowerCase()}</div></div>
<div className="dc" style={{borderLeft:"4px solid #2563eb"}}><div className="dcl">📆 {t.week}</div><div className="dcv b">{fm(weekSales)}</div><div className="dcc">{tIS} {t.sold}</div></div>
<div className="dc" style={{borderLeft:"4px solid #7c3aed"}}><div className="dcl">📅 {t.month}</div><div className="dcv p">{fm(monthSales)}</div></div>
<div className="dc" style={{borderLeft:"4px solid #d97706"}}><div className="dcl">💰 {t.totalSales}</div><div className="dcv y">{fm(tT)}</div><div className="dcc">{tC} {t.txns.toLowerCase()}</div></div>
</div>

<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
<div className="dc"><div className="dcl">🧾 {rtl?"متوسط السلة":"Avg Basket"}</div><div className="dcv b">{fm(avgBasket)}</div></div>
<div className="dc"><div className="dcl">📈 {rtl?"الربح اليومي":"Today Profit"}</div><div className="dcv g">{fm(todayProfit)}</div></div>
<div className="dc"><div className="dcl">👥 {t.customers}</div><div className="dcv p">{totalCustomers}</div><div className="dcc">{loyaltyPct}% {rtl?"مع عميل":"with customer"}</div></div>
<div className="dc"><div className="dcl">📦 {rtl?"منتجات منخفضة":"Low Stock"}</div><div className="dcv" style={{color:prods.filter(p=>p.s<30).length>0?"#dc2626":"#059669"}}>{prods.filter(p=>p.s<30).length}</div></div>
</div>

{/* Charts */}
<div className="cg">
<div className="ck"><div className="ckt">📈 {t.hourly}</div><ResponsiveContainer width="100%" height={160}><AreaChart data={hrD}><defs><linearGradient id="aG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={.15}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/><XAxis dataKey="h" tick={{fill:"#9ca3af",fontSize:10}}/><YAxis tick={{fill:"#9ca3af",fontSize:10}}/><Tooltip contentStyle={ttip}/><Area type="monotone" dataKey="v" stroke="#2563eb" fill="url(#aG)" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">📊 {t.trend}</div><ResponsiveContainer width="100%" height={160}><BarChart data={dyD}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/><XAxis dataKey="d" tick={{fill:"#9ca3af",fontSize:10}}/><YAxis tick={{fill:"#9ca3af",fontSize:10}}/><Tooltip contentStyle={ttip}/><Bar dataKey="r" fill="#2563eb" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">🍩 {t.byCat}</div><ResponsiveContainer width="100%" height={160}><PieChart><Pie data={ctD} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" label={d=>rtl?d.a:d.n}>{ctD.map((_,i)=><Cell key={i} fill={CC[i%CC.length]}/>)}</Pie><Tooltip contentStyle={ttip}/></PieChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">💳 {t.payments}</div><ResponsiveContainer width="100%" height={160}><PieChart><Pie data={ppD} cx="50%" cy="50%" outerRadius={60} dataKey="value" label={d=>d.name}>{ppD.map((_,i)=><Cell key={i} fill={CC[i%CC.length]}/>)}</Pie><Tooltip contentStyle={ttip}/></PieChart></ResponsiveContainer></div>
</div>

{/* Top Products + Loyalty Stats side by side */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
<div className="tb"><div className="tbh"><span>🏆 {t.top} 5</span></div><table><thead><tr><th>{t.product}</th><th>{t.qty}</th><th>{t.total}</th></tr></thead><tbody>{topProds.length===0?<tr><td colSpan={3} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{t.noTxns}</td></tr>:topProds.map((tp,i)=><tr key={i}><td style={{fontWeight:600}}><span style={{color:"#d97706",marginRight:4}}>{["🥇","🥈","🥉","4.","5."][i]}</span>{rtl?tp.nameAr:tp.name}</td><td className="mn">{tp.qty}</td><td className="mn" style={{color:"#059669"}}>{fm(tp.rev)}</td></tr>)}</tbody></table></div>

<div className="tb"><div className="tbh"><span>⭐ {t.loyalty}</span></div><table><tbody>
<tr><td style={{fontWeight:600}}>👥 {t.customers}</td><td className="mn" style={{color:"#2563eb"}}>{totalCustomers}</td></tr>
<tr><td style={{fontWeight:600}}>⭐ {rtl?"إجمالي النقاط":"Total Points"}</td><td className="mn" style={{color:"#7c3aed"}}>{totalPointsIssued.toLocaleString()}</td></tr>
<tr><td style={{fontWeight:600}}>📊 {rtl?"مبيعات مع عملاء":"Sales w/ Customer"}</td><td className="mn" style={{color:"#059669"}}>{loyaltySales} ({loyaltyPct}%)</td></tr>
<tr><td style={{fontWeight:600}}>🥉 {t.bronze}</td><td className="mn">{customers.filter(c=>c.tier==="bronze").length}</td></tr>
<tr><td style={{fontWeight:600}}>🥈 {t.silver}</td><td className="mn">{customers.filter(c=>c.tier==="silver").length}</td></tr>
<tr><td style={{fontWeight:600}}>🥇 {t.gold}</td><td className="mn">{customers.filter(c=>c.tier==="gold").length}</td></tr>
<tr><td style={{fontWeight:600}}>💎 {t.vip}</td><td className="mn">{customers.filter(c=>c.tier==="vip").length}</td></tr>
</tbody></table></div>
</div>

{/* Low stock alerts */}
{prods.filter(p=>p.s<30).length>0&&<div style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:16,padding:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#92400e",marginBottom:8}}>⚠️ {t.lowStock}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>{prods.filter(p=>p.s<30).sort((a,b)=>a.s-b.s).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,fontSize:12}}>
<span style={{fontWeight:600}}>{p.e} {pN(p)}</span>
<span style={{fontFamily:"var(--m)",fontWeight:700,color:p.s<10?"#dc2626":p.s<20?"#d97706":"#6b7280"}}>{p.s} {p.u}</span>
</div>)}</div>
</div>}

{/* Recent transactions table */}
<div className="tb"><div className="tbh"><span>{t.recent}</span><button className="ab ab-x" onClick={()=>exportXL(prods,txns,invs)}>📥 {t.excel}</button></div><table><thead><tr><th>{t.receipt}</th><th>{t.time}</th><th>👤</th><th>#</th><th>{t.method}</th><th>{t.total}</th></tr></thead><tbody>{!tC?<tr><td colSpan={6} style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{t.noTxns}</td></tr>:txns.slice(0,15).map(tx=><tr key={tx.id} style={{cursor:"pointer"}} onClick={()=>setRM(tx)}><td className="mn">{tx.rn}</td><td>{tx.date} {tx.time}</td><td style={{fontSize:11,color:tx.custName?"#2563eb":"#d1d5db"}}>{tx.custName||"—"}</td><td>{tx.items.reduce((s,i)=>s+i.qty,0)}</td><td>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</td><td className="mn" style={{color:"#059669"}}>{fm(tx.tot)}</td></tr>)}</tbody></table></div>
</div>}

{/* ADMIN */}
{tab==="admin"&&<div className="ad"><div className="ads"><button className={"asb "+(atab==="inventory"?"a":"")} onClick={()=>setAT("inventory")}>📦 {t.inventory}</button><button className={"asb "+(atab==="purchases"?"a":"")} onClick={()=>setAT("purchases")}>🧾 {t.purchases}</button><button className={"asb "+(atab==="loyalty"?"a":"")} onClick={()=>setAT("loyalty")}>⭐ {t.loyalty}</button><button className={"asb "+(atab==="users"?"a":"")} onClick={()=>setAT("users")}>👥 {t.users}</button><button className={"asb "+(atab==="settings"?"a":"")} onClick={()=>setAT("settings")}>⚙️ {t.settings}</button></div>
<div className="ac">
{atab==="inventory"&&<><h2>📦 {t.inventory}</h2><div style={{display:"flex",gap:8,marginBottom:12}}><button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setAPM(true)}>{t.addProd}</button><button className="ab ab-x" style={{padding:"8px 16px",fontSize:12}} onClick={()=>exportXL(prods,txns,invs)}>{t.excel}</button></div>{prods.filter(p=>p.s<30).length>0&&<div className="lw"><div className="lwt">⚠️ {t.lowStock}</div>{prods.filter(p=>p.s<30).map(p=><div key={p.id} className="lwi">{pN(p)} — {p.s}</div>)}</div>}<div style={{overflowX:"auto"}}><table className="at"><thead><tr><th>{t.bc}</th><th>{t.product}</th><th>{t.cost}</th><th>{t.price}</th><th>{t.stock}</th><th>{t.margin}</th><th>{t.act}</th></tr></thead><tbody>{prods.map(p=>{const mg=p.p-p.c;const mgPct=p.c>0?((p.p-p.c)/p.c*100):0;return<tr key={p.id}><td style={{fontFamily:"var(--m)",fontSize:11}}>{p.bc}</td><td style={{fontWeight:600}}>{pN(p)}</td><td style={{fontFamily:"var(--m)"}}>{fN(p.c)}</td><td>{eProd===p.id?<input value={ePr} onChange={e=>setEPr(e.target.value)}/>:<span style={{fontFamily:"var(--m)",fontWeight:600}}>{fN(p.p)}</span>}</td><td>{eProd===p.id?<input value={eSt} onChange={e=>setESt(e.target.value)}/>:<span style={{fontWeight:600,color:p.s<30?"#d97706":"#059669"}}>{p.s}</span>}</td><td style={{fontFamily:"var(--m)",fontSize:11}}><span style={{fontWeight:600,color:mg>0?"#059669":mg<0?"#dc2626":"#9ca3af"}}>{fN(mg)}</span><br/><span style={{fontSize:9,color:mgPct>=30?"#059669":mgPct>=15?"#d97706":"#dc2626"}}>{mgPct.toFixed(1)}%</span></td><td>{eProd===p.id?<><button className="ab ab-s" onClick={async()=>{const np=parseFloat(ePr)||p.p,ns=parseInt(eSt)||p.s;setProds(prev=>prev.map(x=>x.id===p.id?{...x,p:np,s:ns}:x));setEP(null);try{await DB.updateProductPriceStock(p.id,np,ns)}catch(e){console.error(e)}}}>✓</button><button className="ab ab-c" onClick={()=>setEP(null)}>✕</button></>:<><button className="ab ab-e" onClick={()=>{setEP(p.id);setEPr(p.p.toString());setESt(p.s.toString())}}>✎ {t.edit}</button><button className="ab ab-d" onClick={async()=>{setProds(prev=>prev.filter(x=>x.id!==p.id));try{await DB.deleteProduct(p.id)}catch(e){console.error(e)}}}>✕</button></>}</td></tr>})}</tbody></table></div></>}

{atab==="purchases"&&<><h2>🧾 {t.purchases}</h2><button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>setInvMod(true)}>{t.addInv}</button>{!invs.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>📋 {t.noInv}</div>:invs.map(inv=><div key={inv.id} className="inv-card" onClick={()=>setInvView(inv)}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontFamily:"var(--m)",fontSize:13,fontWeight:700,color:"#2563eb"}}>{inv.invoiceNo}</span><span style={{fontSize:11,color:"#9ca3af"}}>{inv.date}</span></div><div style={{fontSize:13,fontWeight:500}}>🏭 {inv.supplier}</div><div style={{fontSize:12,color:"#9ca3af",marginTop:4}}>{inv.items.length} {t.items} · <span style={{color:"#059669",fontFamily:"var(--m)",fontWeight:700}}>{fm(inv.totalCost)}</span></div></div>)}</>}

{atab==="users"&&<><h2>👥 {t.users}</h2><button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>setAUM(true)}>{t.addUser}</button><table className="at"><thead><tr><th>{t.user}</th><th>{t.name}</th><th>{t.role}</th><th>{t.act}</th><th>{t.pass}</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td style={{fontFamily:"var(--m)",fontWeight:600}}>{u.un}</td><td>{rtl?(u.fa||u.fn):u.fn}</td><td>{u.role==="admin"?t.adminR:u.role==="manager"?t.manager:t.cashier}</td><td><span className={"us "+(u.st==="active"?"us-a":"us-i")} onClick={async()=>{const ns=u.st==="active"?"inactive":"active";setUsers(p=>p.map(x=>x.id===u.id?{...x,st:ns}:x));try{await DB.updateUser(u.id,{status:ns})}catch(e){console.error(e)}}}>{u.st==="active"?t.on:t.off}</span></td><td><button className="ab ab-p" onClick={()=>{setPWM(u);setNPW("")}}>🔐 {t.chgPass}</button></td><td>{u.id!==1&&<button className="ab ab-d" onClick={async()=>{setUsers(p=>p.filter(x=>x.id!==u.id));try{await DB.deleteUser(u.id)}catch(e){console.error(e)}}}>✕</button>}</td></tr>)}</tbody></table></>}

{atab==="loyalty"&&<><h2>⭐ {t.loyalty} — {t.customers}</h2>
<div style={{display:"flex",gap:8,marginBottom:14}}>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>{setNewCustMod(true);setNewCust({phone:"",name:"",nameAr:""})}}>{t.addCust}</button>
<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12}} onClick={async()=>{try{const c=await DB.getCustomers();setCustomers(c);sT("✓ Refreshed","ok")}catch{}}}>🔄 Refresh</button>
</div>

{/* Tier summary cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:16,padding:12,textAlign:"center"}}><div style={{fontSize:11,color:"#92400e"}}>🥉 {t.bronze}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#a16207"}}>{customers.filter(c=>c.tier==="bronze").length}</div></div>
<div style={{background:"var(--g50)",border:"1px solid var(--g200)",borderRadius:16,padding:12,textAlign:"center"}}><div style={{fontSize:11,color:"#6b7280"}}>🥈 {t.silver}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#6b7280"}}>{customers.filter(c=>c.tier==="silver").length}</div></div>
<div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:16,padding:12,textAlign:"center"}}><div style={{fontSize:11,color:"#92400e"}}>🥇 {t.gold}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{customers.filter(c=>c.tier==="gold").length}</div></div>
<div style={{background:"#f5f3ff",border:"1px solid #c4b5fd",borderRadius:16,padding:12,textAlign:"center"}}><div style={{fontSize:11,color:"#6d28d9"}}>💎 {t.vip}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{customers.filter(c=>c.tier==="vip").length}</div></div>
</div>

{!customers.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40,marginBottom:8}}>👥</div>{t.noInv}</div>:
<table className="at"><thead><tr><th>{t.custPhone}</th><th>{t.name}</th><th>{t.points}</th><th>{t.tier}</th><th>{t.totalSpent}</th><th>{t.visits}</th><th>{t.act}</th></tr></thead>
<tbody>{customers.map(c=><tr key={c.id}>
<td style={{fontFamily:"var(--m)",fontWeight:600,direction:"ltr"}}>{c.phone}</td>
<td style={{fontWeight:600}}>{rtl?c.nameAr:c.name}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:"#2563eb"}}>{c.pts}</td>
<td><span style={{background:c.tier==="vip"?"#f5f3ff":c.tier==="gold"?"#fffbeb":c.tier==="silver"?"var(--g50)":"#fffbeb",color:c.tier==="vip"?"#7c3aed":c.tier==="gold"?"#d97706":c.tier==="silver"?"#6b7280":"#a16207",padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,textTransform:"uppercase"}}>{t[c.tier]}</span></td>
<td style={{fontFamily:"var(--m)",color:"#059669"}}>{fm(c.spent)}</td>
<td style={{fontFamily:"var(--m)"}}>{c.visits}</td>
<td><button className="ab ab-e" onClick={async()=>{setCustViewMod(c);try{const h=await DB.getLoyaltyHistory(c.id);setCustHistory(h)}catch{setCustHistory([])}}}>👁 {rtl?"عرض":"View"}</button></td>
</tr>)}</tbody></table>}
</>}

{atab==="settings"&&<><h2>⚙️ {t.settings}</h2><div className="sf"><label>{t.store}</label><input defaultValue="3045 Super Grocery Shopping"/><label>{t.taxR}</label><input defaultValue="16"/><label>{t.curr}</label><input defaultValue="JD"/><button className="svb" onClick={()=>sT("✓ "+t.saved,"ok")}>{t.saveSt}</button></div></>}
</div></div>}
</div>

{/* PAYMENT MODAL */}
{pmMod&&<div className="ov" onClick={()=>setPM(null)}><div className="md" onClick={e=>e.stopPropagation()}><h2>{pmMod==="cash"?"💵":pmMod==="card"?"💳":"📱"} {pmMod==="cash"?t.cashPay:pmMod==="card"?t.cardPay:t.madaPay}<button className="mc" onClick={()=>setPM(null)}>✕</button></h2>
{selCust&&<div style={{background:"var(--blue50)",borderRadius:12,padding:10,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:20}}>👤</span><div><div style={{fontSize:13,fontWeight:700,color:"#1e40af"}}>{selCust.name}</div><div style={{fontSize:10,color:"#6b7280"}}>{selCust.phone} · {t[selCust.tier]}</div></div></div><div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#059669",fontWeight:600}}>+{earnablePts} {t.points}</div>{redeemPts>0&&<div style={{fontSize:10,color:"#7c3aed",fontWeight:600}}>-{redeemPts} {t.points} ({fm(redeemVal)})</div>}</div></div>}
<div className="ptd">{fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</div>
{redeemPts>0&&selCust&&<div style={{textAlign:"center",fontSize:11,color:"#7c3aed",marginTop:-10,marginBottom:10}}>🎁 {t.redeemPts}: -{fm(redeemVal)}</div>}
{pmMod==="cash"&&<><div className="pf"><label>{t.tendered}</label><input type="number" value={cTend} onChange={e=>setCT(e.target.value)} autoFocus placeholder="0.000"/></div>{parseFloat(cTend)>=(selCust&&redeemPts>0?totAfterRedeem:tot)&&<div className="chd"><div className="chl">{t.change}</div><div className="cha">{fm(parseFloat(cTend)-(selCust&&redeemPts>0?totAfterRedeem:tot))}</div></div>}</>}{pmMod==="card"&&<div style={{textAlign:"center",padding:24,color:"#6b7280"}}><div style={{fontSize:48,marginBottom:12}}>💳</div>{t.insertCard}</div>}{pmMod==="mobile"&&<div style={{textAlign:"center",padding:24,color:"#6b7280"}}><div style={{fontSize:48,marginBottom:12}}>📱</div>{t.scanMada}</div>}<button className="cpb cpb-green" onClick={cP} disabled={!canC}>✓ {t.confirm} — {fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</button></div></div>}

{/* RECEIPT */}
{rcMod&&<div className="ov" onClick={()=>setRM(null)}><div className="md" onClick={e=>e.stopPropagation()}><div className="rcpt"><div className="rh"><h2>3045 Super Grocery</h2><p>Jordan · Tax# 123456789</p><p>{rcMod.date} · {rcMod.time} · {rcMod.rn}</p>{rcMod.custName&&<p style={{marginTop:4,fontWeight:600,color:"#1e40af"}}>👤 {rcMod.custName} · {rcMod.custPhone}</p>}</div>{rcMod.items.map((i,x)=><div key={x} className="ri"><span className="rin">{pN(i)}</span><span className="riq">×{i.qty}</span><span className="rit">{fN(i.p*i.qty)}</span></div>)}<hr className="rd"/><div className="rsr"><span>{t.subtotal}</span><span style={{fontFamily:"var(--m)",fontWeight:600}}>{fN(rcMod.sub)}</span></div>{rcMod.dp>0&&<div className="rsr"><span>{t.discount} ({rcMod.dp}%)</span><span style={{fontFamily:"var(--m)"}}>−{fN(rcMod.disc)}</span></div>}<div className="rsr"><span>{t.vat}</span><span style={{fontFamily:"var(--m)"}}>{fN(rcMod.tax)}</span></div>{rcMod.ptsRedeemed>0&&<div className="rsr" style={{color:"#7c3aed"}}><span>🎁 {t.redeemPts} ({rcMod.ptsRedeemed})</span><span style={{fontFamily:"var(--m)"}}>−{fN(DB.pointsToJD(rcMod.ptsRedeemed))}</span></div>}<hr className="rd"/><div className="rsr T"><span>{t.total} (JD)</span><span style={{fontFamily:"var(--m)"}}>{fN(rcMod.tot)}</span></div>{rcMod.ptsEarned>0&&<div style={{textAlign:"center",margin:"8px 0",padding:6,background:"#ecfdf5",borderRadius:8,fontSize:11,color:"#059669",fontWeight:600}}>⭐ +{rcMod.ptsEarned} {t.points} {t.earned}</div>}<div className="rf">Thank you for shopping at 3045!<br/>شكراً لتسوقكم في 3045!</div></div><div className="ra"><button className="rb rb-p" onClick={()=>window.print()}>🖨 {t.print}</button><button className="rb rb-n" onClick={()=>{setRM(null);setTab("sale")}}>➕ {t.newSaleBtn}</button></div></div></div>}

{/* BARCODE */}
{bcMod&&<div className="ov" onClick={()=>setBM(false)}><div className="md" onClick={e=>e.stopPropagation()}><h2>▦ {t.scanner}<button className="mc" onClick={()=>setBM(false)}>✕</button></h2><input ref={bcRef} className="bsi" placeholder="scan..." onKeyDown={e=>{if(e.key==="Enter"){const c=e.target.value.trim();if(c){const p=prods.find(x=>x.bc===c);if(p){addToCart(p);sT("✓ "+pN(p)+" "+t.added,"ok")}else sT("✗ "+t.notFound,"err")}e.target.value=""}}}/><div style={{fontSize:12,color:"#9ca3af",textAlign:"center",marginBottom:12}}>{t.scanHint}</div><div style={{fontSize:12}}><div style={{fontWeight:700,marginBottom:6}}>{t.samples}</div>{prods.slice(0,5).map(p=><div key={p.bc} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",cursor:"pointer"}} onClick={()=>{addToCart(p);sT("✓ "+pN(p),"ok")}}><span style={{fontFamily:"var(--m)",color:"#2563eb"}}>{p.bc}</span><span>{pN(p)}</span></div>)}</div></div></div>}

{/* PASSWORD */}
{pwMod&&<div className="ov" onClick={()=>setPWM(null)}><div className="md" onClick={e=>e.stopPropagation()}><h2>🔐 {t.chgPass} — {pwMod.un}<button className="mc" onClick={()=>setPWM(null)}>✕</button></h2><div className="pf"><label>{t.newPass}</label><input type="password" value={nPW} onChange={e=>setNPW(e.target.value)} autoFocus placeholder="••••••••"/></div><button className="cpb" onClick={async()=>{if(!nPW.trim())return;setUsers(p=>p.map(u=>u.id===pwMod.id?{...u,pw:nPW}:u));setPWM(null);setNPW("");sT("✓ "+t.saved,"ok");try{await DB.updateUser(pwMod.id,{password:nPW})}catch(e){console.error(e)}}} disabled={!nPW.trim()}>✓ {t.setPass}</button></div></div>}

{/* ADD USER */}
{auMod&&<div className="ov" onClick={()=>setAUM(false)}><div className="md" onClick={e=>e.stopPropagation()}><h2>👤 {t.addUser}<button className="mc" onClick={()=>setAUM(false)}>✕</button></h2><div className="pf"><label>{t.user}</label><input value={nU.un} onChange={e=>setNU({...nU,un:e.target.value})}/></div><div className="pf"><label>{t.name} (EN)</label><input value={nU.fn} onChange={e=>setNU({...nU,fn:e.target.value})}/></div><div className="pf"><label>{t.name} (AR)</label><input value={nU.fa} onChange={e=>setNU({...nU,fa:e.target.value})} style={{direction:"rtl"}}/></div><div className="pf"><label>{t.role}</label><select value={nU.role} onChange={e=>setNU({...nU,role:e.target.value})}><option value="cashier">{t.cashier}</option><option value="manager">{t.manager}</option><option value="admin">{t.adminR}</option></select></div><div className="pf"><label>{t.pass}</label><input type="password" value={nU.pw} onChange={e=>setNU({...nU,pw:e.target.value})}/></div><button className="cpb" onClick={async()=>{if(!nU.un||!nU.fn||!nU.pw)return;try{await DB.addUser(nU);const u=await DB.getUsers();setUsers(u)}catch(e){console.error(e)}setAUM(false);setNU({un:"",fn:"",fa:"",role:"cashier",pw:""})}} disabled={!nU.un||!nU.fn||!nU.pw}>✓ {t.addUser}</button></div></div>}

{/* ADD PRODUCT */}
{apMod&&<div className="ov" onClick={()=>setAPM(false)}><div className="md" onClick={e=>e.stopPropagation()}><h2>📦 {t.addProd}<button className="mc" onClick={()=>setAPM(false)}>✕</button></h2><div className="pf"><label>{t.bc}</label><input value={nP.bc} onChange={e=>setNP({...nP,bc:e.target.value})}/></div><div className="pf"><label>{t.nameEn}</label><input value={nP.n} onChange={e=>setNP({...nP,n:e.target.value})}/></div><div className="pf"><label>{t.nameAr}</label><input value={nP.a} onChange={e=>setNP({...nP,a:e.target.value})} style={{direction:"rtl"}}/></div><div style={{display:"flex",gap:8}}><div className="pf" style={{flex:1}}><label>{t.cost} (JD)</label><input type="number" value={nP.c} onChange={e=>setNP({...nP,c:e.target.value})}/></div><div className="pf" style={{flex:1}}><label>{t.price} (JD)</label><input type="number" value={nP.p} onChange={e=>setNP({...nP,p:e.target.value})}/></div></div><div style={{display:"flex",gap:8}}><div className="pf" style={{flex:1}}><label>{t.cat}</label><select value={nP.cat} onChange={e=>setNP({...nP,cat:e.target.value})}>{CATS.filter(c=>c.id!=="all").map(c=><option key={c.id} value={c.id}>{t[c.k]}</option>)}</select></div><div className="pf" style={{flex:1}}><label>{t.unit}</label><input value={nP.u} onChange={e=>setNP({...nP,u:e.target.value})}/></div></div><div className="pf"><label>Emoji</label><input value={nP.e} onChange={e=>setNP({...nP,e:e.target.value})}/></div><button className="cpb" onClick={async()=>{if(!nP.bc||!nP.n||!nP.p)return;const newProd={id:"S"+Date.now().toString(36),bc:nP.bc,n:nP.n,a:nP.a||nP.n,p:parseFloat(nP.p)||0,c:parseFloat(nP.c)||0,cat:nP.cat,u:nP.u,s:0,e:nP.e};setProds(p=>[...p,newProd]);setAPM(false);setNP({bc:"",n:"",a:"",p:"",c:"",cat:"snacks",u:"pc",e:"📦"});sT("✓ "+t.prodAdded,"ok");try{await DB.upsertProduct(newProd)}catch(e){console.error(e)}}} disabled={!nP.bc||!nP.n||!nP.p}>✓ {t.addProd}</button></div></div>}

{/* PURCHASE INVOICE */}
{invMod&&<div className="ov" onClick={()=>setInvMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}><h2>🧾 {t.addInv}<button className="mc" onClick={()=>setInvMod(false)}>✕</button></h2><div style={{display:"flex",gap:8}}><div className="pf" style={{flex:1}}><label>{t.supplier}</label><input value={invSup} onChange={e=>setInvSup(e.target.value)}/></div><div className="pf" style={{flex:1}}><label>{t.invNo}</label><input value={invNo} onChange={e=>setInvNo(e.target.value)}/></div></div><div style={{fontSize:13,fontWeight:700,margin:"10px 0 8px"}}>{t.invItems}:</div>{invItems.map((it,i)=><div key={i} className="inv-row"><select value={it.prodId} onChange={e=>{const v=[...invItems];v[i]={...v[i],prodId:e.target.value};setInvItems(v)}} style={{flex:2}}><option value="">{t.selProd}</option>{prods.map(p=><option key={p.id} value={p.id}>{pN(p)}</option>)}</select><input type="number" value={it.qty} onChange={e=>{const v=[...invItems];v[i]={...v[i],qty:e.target.value};setInvItems(v)}} placeholder={t.qty} style={{flex:1}}/><input type="number" value={it.cost} onChange={e=>{const v=[...invItems];v[i]={...v[i],cost:e.target.value};setInvItems(v)}} placeholder={t.costPr} style={{flex:1}}/>{invItems.length>1&&<button className="inv-rm" onClick={()=>setInvItems(p=>p.filter((_,x)=>x!==i))}>✕</button>}</div>)}<button onClick={()=>setInvItems(p=>[...p,{prodId:"",qty:"",cost:""}])} style={{background:"none",border:"2px dashed #d1d5db",borderRadius:10,color:"#6b7280",padding:"8px",width:"100%",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)",marginBottom:12}}>{t.addItem}</button><div style={{fontSize:14,fontWeight:700,padding:"10px 0",borderTop:"1px solid #e5e7eb"}}>{t.totCost}: <span style={{color:"#059669",fontFamily:"var(--m)"}}>{fm(invItems.reduce((s,x)=>s+(parseFloat(x.cost)||0)*(parseInt(x.qty)||0),0))}</span></div><button className="cpb cpb-green" onClick={saveInv} disabled={!invSup||!invNo}>✓ {t.saveInv}</button></div></div>}

{/* VIEW INVOICE */}
{invView&&<div className="ov" onClick={()=>setInvView(null)}><div className="md" onClick={e=>e.stopPropagation()}><h2>🧾 {invView.invoiceNo}<button className="mc" onClick={()=>setInvView(null)}>✕</button></h2><div style={{fontSize:13,marginBottom:12}}><div>🏭 {t.supplier}: <strong>{invView.supplier}</strong></div><div style={{color:"#9ca3af",marginTop:4}}>📅 {invView.date} · 👤 {invView.receivedBy}</div></div><table className="at"><thead><tr><th>{t.product}</th><th>{t.qty}</th><th>{t.cost}</th><th>{t.total}</th></tr></thead><tbody>{invView.items.map((it,i)=><tr key={i}><td style={{fontWeight:600}}>{it.productName}</td><td style={{fontFamily:"var(--m)"}}>{it.qty}</td><td style={{fontFamily:"var(--m)"}}>{fN(parseFloat(it.cost)||0)}</td><td style={{fontFamily:"var(--m)",color:"#059669",fontWeight:700}}>{fN((parseFloat(it.cost)||0)*(parseInt(it.qty)||0))}</td></tr>)}</tbody></table><div style={{textAlign:"right",marginTop:10,fontSize:16,fontWeight:800,color:"#059669",fontFamily:"var(--m)"}}>{t.totCost}: {fm(invView.totalCost)}</div></div></div>}

{/* CUSTOMER LOOKUP MODAL */}
{custMod&&<div className="ov" onClick={()=>setCustMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>👤 {t.custSearch}<button className="mc" onClick={()=>setCustMod(false)}>✕</button></h2>
<div className="pf"><label>{t.custPhone}</label>
<div style={{display:"flex",gap:8}}><input value={custPhone} onChange={e=>setCustPhone(e.target.value)} placeholder={rtl?"07XXXXXXXX":"07XXXXXXXX"} onKeyDown={e=>{if(e.key==="Enter")lookupCust()}} autoFocus style={{flex:1,padding:"10px 14px",background:"var(--g50)",border:"1.5px solid var(--g200)",borderRadius:"var(--r)",fontFamily:"var(--m)",fontSize:16,letterSpacing:1,outline:"none",color:"var(--g900)",direction:"ltr",textAlign:"center"}}/><button onClick={lookupCust} disabled={custLoading||!custPhone.trim()} style={{padding:"10px 20px",background:"var(--blue)",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",opacity:custLoading?.6:1}}>🔍</button></div></div>

{custLoading&&<div style={{textAlign:"center",padding:20,color:"#6b7280"}}>⏳ ...</div>}

{custSearch&&custSearch!=="notfound"&&<div style={{background:"var(--green50)",border:"1.5px solid var(--green100)",borderRadius:16,padding:16,marginTop:12}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<div><div style={{fontSize:16,fontWeight:800,color:"#065f46"}}>{custSearch.name}</div><div style={{fontSize:12,fontFamily:"var(--m)",color:"#6b7280"}}>{custSearch.phone}</div></div>
<span style={{background:custSearch.tier==="vip"?"#7c3aed":custSearch.tier==="gold"?"#d97706":custSearch.tier==="silver"?"#6b7280":"#a16207",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase"}}>{t[custSearch.tier]}</span>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
<div style={{background:"#fff",borderRadius:10,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.points}</div><div style={{fontSize:18,fontWeight:800,color:"#2563eb",fontFamily:"var(--m)"}}>{custSearch.pts}</div></div>
<div style={{background:"#fff",borderRadius:10,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.totalSpent}</div><div style={{fontSize:14,fontWeight:700,color:"#059669",fontFamily:"var(--m)"}}>{fm(custSearch.spent)}</div></div>
<div style={{background:"#fff",borderRadius:10,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.visits}</div><div style={{fontSize:18,fontWeight:800,color:"#7c3aed",fontFamily:"var(--m)"}}>{custSearch.visits}</div></div>
</div>
<button onClick={()=>attachCust(custSearch)} style={{width:"100%",padding:12,background:"#059669",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>✓ {t.custAttached}</button>
</div>}

{custSearch==="notfound"&&<div style={{background:"var(--amber50)",border:"1.5px solid #fcd34d",borderRadius:16,padding:16,marginTop:12,textAlign:"center"}}>
<div style={{fontSize:32,marginBottom:8}}>🤷</div>
<div style={{fontSize:14,fontWeight:600,color:"#92400e",marginBottom:12}}>{t.custNotFound}</div>
<button onClick={()=>{setNewCustMod(true);setNewCust({phone:custPhone,name:"",nameAr:""})}} style={{padding:"10px 24px",background:"#2563eb",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>➕ {t.registerNew}</button>
</div>}

<div style={{marginTop:16,borderTop:"1px solid var(--g200)",paddingTop:12}}>
<div style={{fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:8}}>ℹ️ {t.loyalty} — {rtl?"القواعد":"Rules"}</div>
<div style={{fontSize:10,color:"#9ca3af",lineHeight:1.8}}>
• 10 {t.points} / 1 JD · 100 {t.points} = 0.500 JD<br/>
• 🥉 {t.bronze}: 1x · 🥈 {t.silver} (500+): 1.5x · 🥇 {t.gold} (1500+): 2x · 💎 {t.vip} (5000+): 3x
</div></div>
</div></div>}

{/* REGISTER NEW CUSTOMER MODAL */}
{newCustMod&&<div className="ov" onClick={()=>setNewCustMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>➕ {t.addCust}<button className="mc" onClick={()=>setNewCustMod(false)}>✕</button></h2>
<div className="pf"><label>{t.custPhone}</label><input value={newCust.phone} onChange={e=>setNewCust({...newCust,phone:e.target.value})} style={{fontFamily:"var(--m)",fontSize:16,letterSpacing:1,textAlign:"center",direction:"ltr"}}/></div>
<div className="pf"><label>{t.custName} ({t.nameEn})</label><input value={newCust.name} onChange={e=>setNewCust({...newCust,name:e.target.value})}/></div>
<div className="pf"><label>{t.custNameAr}</label><input value={newCust.nameAr} onChange={e=>setNewCust({...newCust,nameAr:e.target.value})} style={{direction:"rtl"}}/></div>
<div style={{background:"var(--blue50)",borderRadius:12,padding:12,marginBottom:12,textAlign:"center"}}>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"سيبدأ العميل بـ":"Customer starts with"}</div>
<div style={{fontSize:20,fontWeight:800,color:"#2563eb",marginTop:4}}>0 {t.points} · 🥉 {t.bronze}</div>
</div>
<button className="cpb" onClick={registerCust} disabled={!newCust.phone||!newCust.name}>✓ {t.addCust}</button>
</div></div>}

{/* CUSTOMER VIEW/HISTORY MODAL */}
{custViewMod&&<div className="ov" onClick={()=>setCustViewMod(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>👤 {custViewMod.name}<button className="mc" onClick={()=>setCustViewMod(null)}>✕</button></h2>
<div style={{display:"flex",gap:8,marginBottom:14}}>
<div style={{flex:1,background:"var(--blue50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.custPhone}</div><div style={{fontSize:14,fontWeight:700,fontFamily:"var(--m)",color:"#1e40af"}}>{custViewMod.phone}</div></div>
<div style={{flex:1,background:"var(--green50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.points}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{custViewMod.pts}</div></div>
<div style={{flex:1,background:custViewMod.tier==="vip"?"#f5f3ff":custViewMod.tier==="gold"?"#fffbeb":"var(--g50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.tier}</div><div style={{fontSize:14,fontWeight:800,textTransform:"uppercase",color:custViewMod.tier==="vip"?"#7c3aed":custViewMod.tier==="gold"?"#d97706":custViewMod.tier==="silver"?"#6b7280":"#a16207"}}>{t[custViewMod.tier]}</div></div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
<div style={{background:"var(--g50)",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.totalSpent}</div><div style={{fontSize:16,fontWeight:700,fontFamily:"var(--m)",color:"#059669"}}>{fm(custViewMod.spent)}</div></div>
<div style={{background:"var(--g50)",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.visits}</div><div style={{fontSize:16,fontWeight:700,fontFamily:"var(--m)",color:"#7c3aed"}}>{custViewMod.visits}</div></div>
</div>
<div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{t.ptHistory}</div>
{custHistory.length===0?<div style={{textAlign:"center",padding:20,color:"#9ca3af",fontSize:12}}>{t.noTxns}</div>:
<div style={{maxHeight:200,overflowY:"auto"}}>{custHistory.map(h=><div key={h.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--g100)",fontSize:12}}>
<div><span style={{fontWeight:600,color:h.type==="earn"?"#059669":"#7c3aed"}}>{h.type==="earn"?"⬆ "+t.earned:"⬇ "+t.redeemed}</span><div style={{fontSize:10,color:"#9ca3af"}}>{h.description}</div></div>
<div style={{textAlign:"right"}}><div style={{fontWeight:700,fontFamily:"var(--m)",color:h.type==="earn"?"#059669":"#7c3aed"}}>{h.type==="earn"?"+":"-"}{h.points} pts</div><div style={{fontSize:10,color:"#9ca3af"}}>{new Date(h.created_at).toLocaleDateString()}</div></div>
</div>)}</div>}
</div></div>}
{tab==="sale"&&<div className="bci"><span className="bcd"/> {t.ready}</div>}
</div></>);
}
