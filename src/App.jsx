import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from "recharts";
import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

// ╔═══════════════════════════════════════════════════════════╗
// ║  SUPABASE CONFIG — REPLACE THESE WITH YOUR VALUES        ║
// ║  Find them in: Supabase → Settings → API                 ║
// ╚═══════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://oxrqkgbbccstbetxpnsn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94cnFrZ2JiY2NzdGJldHhwbnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzE2MjQsImV4cCI6MjA5MDA0NzYyNH0.19Sp_A1S17RXMG3jzSvKSdPKhaQE_ZEDx-JIJIUCsi8";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── DB HELPERS ────────────────────────────────────────────────
const DB = {
  // App Settings (key-value store in database)
  async getSetting(key, defaultValue) {
    try {
      const {data} = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
      return data ? data.value : defaultValue;
    } catch { return defaultValue; }
  },
  async setSetting(key, value) {
    try {
      await sb.from("app_settings").upsert({key, value, updated_at: new Date().toISOString()});
    } catch(e) { console.error("setSetting error:", e); }
  },
  async getAllSettings() {
    try {
      const {data} = await sb.from("app_settings").select("*");
      const result = {};
      if(data) data.forEach(r => { result[r.key] = r.value; });
      return result;
    } catch { return {}; }
  },
  // Products
  async getProducts() {
    // Supabase default limit is 1000, so paginate for large catalogs
    let all=[], from=0, pageSize=1000, done=false;
    while(!done){
      const {data}=await sb.from("products").select("*").order("id").range(from, from+pageSize-1);
      if(data&&data.length>0){all=all.concat(data);from+=pageSize;if(data.length<pageSize)done=true}else{done=true}
    }
    return all.map(r=>({id:r.id,bc:r.barcode,n:r.name,a:r.name_ar,p:+r.price,c:+r.cost,cat:r.category,u:r.unit,s:r.stock,e:r.emoji,exp:r.expiry_date||null,img:r.image||null,supplier:r.supplier||"",linkedTo:r.linked_parent_id||null,linkedQty:r.linked_qty||1}));
  },
  async upsertProduct(p) { await sb.from("products").upsert({id:p.id,barcode:p.bc,name:p.n,name_ar:p.a,price:p.p,cost:p.c,category:p.cat,unit:p.u,stock:p.s,emoji:p.e,expiry_date:p.exp||null,image:p.img||null,supplier:p.supplier||null,linked_parent_id:p.linkedTo||null,linked_qty:p.linkedQty||1,updated_at:new Date().toISOString()}); },
  async deleteProduct(id) { await sb.from("products").delete().eq("id",id); },
  async updateStock(id, newStock, newCost) { await sb.from("products").update({stock:newStock, cost:newCost, updated_at:new Date().toISOString()}).eq("id",id); },
  async updateProductPriceStock(id, price, stock, expiry) { const u={price,stock,updated_at:new Date().toISOString()}; if(expiry!==undefined) u.expiry_date=expiry||null; await sb.from("products").update(u).eq("id",id); },

  // Users
  async getUsers() { const {data}=await sb.from("pos_users").select("*").order("id"); return (data||[]).map(r=>({id:r.id,un:r.username,fn:r.full_name,fa:r.full_name_ar||r.full_name,role:r.role,st:r.status,pw:r.password,perms:r.permissions||{pos:true,dashboard:false,inventory:false,purchases:false,sales_view:false,users:false,loyalty:false,settings:false,excel_export:false},avatar:r.avatar||null})); },
  async addUser(u) { const perms=u.role==="admin"?{pos:true,dashboard:true,inventory:true,purchases:true,sales_view:true,users:true,loyalty:true,settings:true,excel_export:true}:u.role==="manager"?{pos:true,dashboard:true,inventory:true,purchases:true,sales_view:true,users:false,loyalty:true,settings:false,excel_export:true}:{pos:true,dashboard:false,inventory:false,purchases:false,sales_view:false,users:false,loyalty:false,settings:false,excel_export:false}; await sb.from("pos_users").insert({username:u.un,full_name:u.fn,full_name_ar:u.fa||u.fn,role:u.role,status:"active",password:u.pw,permissions:perms}); },
  async updateUser(id, fields) { await sb.from("pos_users").update(fields).eq("id",id); },
  async deleteUser(id) { await sb.from("pos_users").delete().eq("id",id); },

  // Transactions
  async getTransactions() {
    const {data:txs}=await sb.from("transactions").select("*").order("created_at",{ascending:false}).limit(200);
    if(!txs||!txs.length) return [];
    const ids=txs.map(t=>t.id);
    // Fetch ALL items in batches to avoid Supabase 1000-row default limit
    let items=[];
    const batchSize=50;
    for(let i=0;i<ids.length;i+=batchSize){
      const batch=ids.slice(i,i+batchSize);
      const {data:batchItems}=await sb.from("transaction_items").select("*").in("transaction_id",batch).limit(5000);
      if(batchItems)items=items.concat(batchItems);
    }
    return txs.map(tx=>({id:tx.id,rn:tx.receipt_no,seq:tx.seq_number||0,voidStatus:tx.void_status||"active",voidReason:tx.void_reason||null,voidBy:tx.void_by||null,voidAt:tx.void_at||null,sub:+tx.subtotal,disc:+tx.discount,dp:+tx.discount_pct,tax:+tx.tax,tot:+tx.total,method:tx.payment_method,ct:+tx.cash_tendered,ch:+tx.change_amount,ts:tx.created_at,time:new Date(tx.created_at).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:new Date(tx.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),custPhone:tx.customer_phone,custName:tx.cashier_name,cashierId:tx.cashier_id,cashierName:tx.cashier_name,ptsEarned:tx.points_earned||0,ptsRedeemed:tx.points_redeemed||0,items:items.filter(i=>i.transaction_id===tx.id).map(i=>({id:i.product_id||"misc_"+i.id,n:i.product_name||"—",a:i.product_name_ar||i.product_name||"—",bc:i.barcode||"MISC",p:+i.unit_price,qty:i.quantity,_isMisc:!i.product_id}))}));
  },
  async addTransaction(tx, cashierId, cashierName, pkgs) {
    // Generate sequential receipt number: KH-130426-001
    const today=new Date();
    const dateStr=String(today.getDate()).padStart(2,"0")+String(today.getMonth()+1).padStart(2,"0")+String(today.getFullYear()).slice(2);
    // Get cashier prefix (first 2 chars of name, uppercase)
    const cashierPrefix=(cashierName||"XX").substring(0,2).toUpperCase();
    // Get next sequence number for this cashier today
    const todayStart=new Date();todayStart.setHours(0,0,0,0);
    const{data:todayTxs}=await sb.from("transactions").select("seq_number").eq("cashier_id",cashierId).gte("created_at",todayStart.toISOString());
    const maxSeq=(todayTxs||[]).reduce((m,t)=>Math.max(m,t.seq_number||0),0);
    const nextSeq=maxSeq+1;
    const seqStr=String(nextSeq).padStart(3,"0");
    const newRn=cashierPrefix+"-"+dateStr+"-"+seqStr;
    tx.rn=newRn; // override the receipt number
    
    await sb.from("transactions").insert({id:tx.id,receipt_no:tx.rn,seq_number:nextSeq,subtotal:tx.sub,discount:tx.disc,discount_pct:tx.dp,tax:tx.tax,total:tx.tot,payment_method:tx.method,cash_tendered:tx.ct,change_amount:tx.ch,cashier_id:cashierId,cashier_name:cashierName,void_status:"active"});
    // Detect misc/weight items: their id starts with "misc_" or contains "_w" (weight clones)
    const isMisc=(i)=>(i._isMisc||(typeof i.id==="string"&&(i.id.startsWith("misc_"))));
    const rows=tx.items.map(i=>({
      transaction_id:tx.id,
      product_id:isMisc(i)?null:(typeof i.id==="string"&&i.id.includes("_w")?i.id.split("_w")[0]:i.id),
      product_name:i.n,
      product_name_ar:i.a,
      barcode:i.bc,
      quantity:i.qty,
      unit_price:i.p,
      line_total:+(i.p*i.qty).toFixed(3)
    }));
    const{error:itemsErr}=await sb.from("transaction_items").insert(rows);
    if(itemsErr){console.error("transaction_items insert error:",itemsErr);throw new Error("Items save failed: "+itemsErr.message);}
    // Decrease stock — for packages, deduct from PARENT (Model A: shared stock)
    pkgs=pkgs||{};
    for(const i of tx.items){
      if(isMisc(i))continue; // skip misc items, they have no real product
      const pkg=pkgs[i.bc];
      if(pkg&&pkg.parentId&&pkg.packSize){
        const{data:p}=await sb.from("products").select("stock").eq("id",pkg.parentId).single();
        if(p) await sb.from("products").update({stock:p.stock-(i.qty*pkg.packSize)}).eq("id",pkg.parentId);
      }else{
        // Strip _w suffix for weight items (use real product id)
        const realId=typeof i.id==="string"&&i.id.includes("_w")?i.id.split("_w")[0]:i.id;
        const{data:p}=await sb.from("products").select("stock").eq("id",realId).single();
        if(p) await sb.from("products").update({stock:p.stock-(i._weight||i.qty)}).eq("id",realId);
      }
    }
  },

  // Purchase Invoices
  async getInvoices() {
    const {data:invs}=await sb.from("purchase_invoices").select("*").order("created_at",{ascending:false});
    if(!invs||!invs.length) return [];
    const ids=invs.map(i=>i.id);
    // Fetch ALL items in batches to avoid Supabase 1000-row default limit
    let items=[];
    const batchSize=50;
    for(let i=0;i<ids.length;i+=batchSize){
      const batch=ids.slice(i,i+batchSize);
      const {data:batchItems}=await sb.from("purchase_invoice_items").select("*").in("invoice_id",batch).limit(5000);
      if(batchItems)items=items.concat(batchItems);
    }
    return invs.map(inv=>({id:inv.id,invoiceNo:inv.invoice_no,supplier:inv.supplier,totalCost:+inv.total_cost,receivedBy:inv.received_by,is_reconciliation:inv.is_reconciliation||false,reconciliation_status:inv.reconciliation_status||"normal",reconciled_at:inv.reconciled_at,reconciled_by_name:inv.reconciled_by_name,reconciliation_notes:inv.reconciliation_notes,date:new Date(inv.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),time:new Date(inv.created_at).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),items:items.filter(i=>i.invoice_id===inv.id).map(i=>({productName:i.product_name,prodId:i.product_id,qty:""+i.quantity,cost:""+i.cost_price}))}));
  },
  async addInvoice(inv) {
    const insertData = {invoice_no:inv.invoiceNo,supplier:inv.supplier,total_cost:inv.totalCost,received_by:inv.receivedBy};
    // Reconciliation fields (if provided)
    if(inv.is_reconciliation) insertData.is_reconciliation = true;
    if(inv.reconciliation_status) insertData.reconciliation_status = inv.reconciliation_status;
    const {data}=await sb.from("purchase_invoices").insert(insertData).select().single();
    if(data){
      const rows=inv.items.map(i=>({invoice_id:data.id,product_id:i.prodId||null,product_name:i.productName,quantity:parseInt(i.qty)||0,cost_price:parseFloat(i.cost)||0,line_total:+((parseFloat(i.cost)||0)*(parseInt(i.qty)||0)).toFixed(3)}));
      await sb.from("purchase_invoice_items").insert(rows);
    }
    // Update stock + cost (SKIP in reconciliation mode)
    if(!inv.is_reconciliation){
      for(const i of inv.items){
        if(!i.prodId) continue;
        const {data:p}=await sb.from("products").select("stock").eq("id",i.prodId).single();
        if(p) await sb.from("products").update({stock:p.stock+(parseInt(i.qty)||0),cost:parseFloat(i.cost)||0,updated_at:new Date().toISOString()}).eq("id",i.prodId);
      }
    }
    return data;
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
  pointsToJD(pts) { return +(pts*0.005).toFixed(3); }, // 100 pts = 0.500 JD

  // HR — Contracts
  async getContracts() { const {data}=await sb.from("employee_contracts").select("*").order("id"); return data||[]; },
  async addContract(c) { const {data}=await sb.from("employee_contracts").insert(c).select().single(); return data; },
  async updateContract(id,fields) { await sb.from("employee_contracts").update({...fields,updated_at:new Date().toISOString()}).eq("id",id); },
  async deleteContract(id) { await sb.from("employee_contracts").delete().eq("id",id); },

  // HR — Salary
  async getSalaries() { const {data}=await sb.from("salary_payments").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addSalary(s) { const {data}=await sb.from("salary_payments").insert(s).select().single(); return data; },
  async updateSalary(id,fields) { await sb.from("salary_payments").update(fields).eq("id",id); },

  // HR — Leaves
  async getLeaves() { const {data}=await sb.from("leave_requests").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addLeave(l) { const {data}=await sb.from("leave_requests").insert(l).select().single(); return data; },
  async updateLeave(id,fields) { await sb.from("leave_requests").update(fields).eq("id",id); },

  // HR — Attendance
  async getAttendance(date) { const d=date||new Date().toISOString().slice(0,10); const {data}=await sb.from("attendance").select("*").eq("date",d); return data||[]; },
  async getAttendanceRange(from,to) { const {data}=await sb.from("attendance").select("*").gte("date",from).lte("date",to).order("date",{ascending:false}); return data||[]; },
  async clockIn(userId) { const d=new Date().toISOString().slice(0,10); const now=new Date().toISOString(); const {data:ex}=await sb.from("attendance").select("*").eq("user_id",userId).eq("date",d).single(); if(ex) return ex; const {data}=await sb.from("attendance").insert({user_id:userId,date:d,clock_in:now,status:"present"}).select().single(); return data; },
  async clockOut(userId) { const d=new Date().toISOString().slice(0,10); const now=new Date(); const {data:ex}=await sb.from("attendance").select("*").eq("user_id",userId).eq("date",d).single(); if(!ex) return null; const ci=new Date(ex.clock_in); const hrs=+((now-ci)/3600000).toFixed(1); await sb.from("attendance").update({clock_out:now.toISOString(),hours_worked:hrs}).eq("id",ex.id); return{...ex,clock_out:now.toISOString(),hours_worked:hrs}; },
  async getTodayAttendance(userId) { const d=new Date().toISOString().slice(0,10); const {data}=await sb.from("attendance").select("*").eq("user_id",userId).eq("date",d).maybeSingle(); return data; },

  // Finance
  async getExpenseCategories() { const {data}=await sb.from("expense_categories").select("*").order("id"); return data||[]; },
  async getExpenses() { const {data}=await sb.from("expenses").select("*").order("expense_date",{ascending:false}); return data||[]; },
  async addExpense(e) { const {data}=await sb.from("expenses").insert(e).select().single(); return data; },
  async deleteExpense(id) { await sb.from("expenses").delete().eq("id",id); },
  async deleteSalary(id) { await sb.from("salary_payments").delete().eq("id",id); },
  async deleteLeave(id) { await sb.from("leave_requests").delete().eq("id",id); },
  async deleteAttendance(id) { await sb.from("attendance").delete().eq("id",id); },
  async deleteMovement(id) { await sb.from("money_movements").delete().eq("id",id); },
  async deleteCustomer(id) { await sb.from("customers").delete().eq("id",id); },
  async deleteTransaction(id) {
    // Restore stock first - get items, then add back
    try {
      const {data:items} = await sb.from("transaction_items").select("*").eq("transaction_id",id);
      if(items) {
        for(const item of items) {
          const {data:p} = await sb.from("products").select("stock").eq("id",item.product_id).single();
          if(p) await sb.from("products").update({stock: (p.stock||0) + (item.quantity||0)}).eq("id",item.product_id);
        }
      }
    } catch(e) { console.error("Stock restore error:",e); }
    await sb.from("transaction_items").delete().eq("transaction_id",id);
    await sb.from("transactions").delete().eq("id",id);
  },
  async deleteInvoice(id) { await sb.from("purchase_invoice_items").delete().eq("invoice_id",id); await sb.from("purchase_invoices").delete().eq("id",id); },
  async markInvoiceReconciled(id, userId, userName, notes){
    const{error}=await sb.from("purchase_invoices").update({reconciliation_status:"reconciled",reconciled_at:new Date().toISOString(),reconciled_by:userId,reconciled_by_name:userName,reconciliation_notes:notes||null}).eq("id",id);
    if(error)throw error;
  },
  // Invoice Attachments (multi-page images)
  async addInvoiceAttachment(attachment){
    const{data,error}=await sb.from("invoice_attachments").insert(attachment).select().single();
    if(error){console.error("Attachment error:",error);return null}
    return data;
  },
  async getInvoiceAttachments(invoiceId){
    const{data}=await sb.from("invoice_attachments").select("*").eq("invoice_id",invoiceId).order("page_number",{ascending:true});
    return data||[];
  },
  async deleteInvoiceAttachment(id){
    await sb.from("invoice_attachments").delete().eq("id",id);
  },
  // ── STOCKTAKE ──
  async createStocktakeSession(session){
    const{data,error}=await sb.from("stocktake_sessions").insert(session).select().single();
    if(error){console.error("Stocktake session:",error);return null}
    return data;
  },
  async getStocktakeSessions(){
    const{data}=await sb.from("stocktake_sessions").select("*").order("started_at",{ascending:false});
    return data||[];
  },
  async updateStocktakeSession(id,updates){
    const{error}=await sb.from("stocktake_sessions").update(updates).eq("id",id);
    if(error)throw error;
  },
  async deleteStocktakeSession(id){
    await sb.from("stocktake_items").delete().eq("session_id",id);
    await sb.from("stocktake_sessions").delete().eq("id",id);
  },
  async addStocktakeItem(item){
    const{data,error}=await sb.from("stocktake_items").insert(item).select().single();
    if(error){console.error("Stocktake item:",error);return null}
    return data;
  },
  async getStocktakeItems(sessionId){
    const{data}=await sb.from("stocktake_items").select("*").eq("session_id",sessionId).order("counted_at",{ascending:true});
    return data||[];
  },
  async updateStocktakeItem(id,updates){
    const{error}=await sb.from("stocktake_items").update(updates).eq("id",id);
    if(error)throw error;
  },
  async deleteStocktakeItem(id){
    await sb.from("stocktake_items").delete().eq("id",id);
  },
  // ── BATCH TRACKING ──
  async getBatches(productId) { const q=sb.from("product_batches").select("*").order("expiry_date",{ascending:true}); if(productId)q.eq("product_id",productId); const{data}=await q; return data||[]; },
  async getAllBatches() { const{data}=await sb.from("product_batches").select("*").order("expiry_date",{ascending:true}); return data||[]; },
  async addBatch(b) { const{data}=await sb.from("product_batches").insert(b).select().single(); return data; },
  async updateBatch(id,u) { await sb.from("product_batches").update({...u,updated_at:new Date().toISOString()}).eq("id",id); },
  async deleteBatch(id) { await sb.from("product_batches").delete().eq("id",id); },
  async deductBatchFIFO(productId,qty) { const{data}=await sb.rpc("deduct_batch_fifo",{p_product_id:productId,p_quantity:qty}); return data||[]; },
  // ── SALES RETURNS ──
  async getSalesReturns() { const{data}=await sb.from("sales_returns").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addSalesReturn(r) { const{data,error}=await sb.from("sales_returns").insert(r).select().single(); if(error){console.error("addSalesReturn error:",error);throw new Error(error.message||"DB insert failed");} return data; },
  async addSalesReturnItems(items) { const{error}=await sb.from("sales_return_items").insert(items); if(error){console.error("addSalesReturnItems error:",error);throw new Error(error.message||"Items insert failed");} },
  async getSalesReturnItems(returnId) { const{data}=await sb.from("sales_return_items").select("*").eq("return_id",returnId); return data||[]; },
  async deleteSalesReturn(id) { await sb.from("sales_return_items").delete().eq("return_id",id); await sb.from("sales_returns").delete().eq("id",id); },
  // ── PURCHASE RETURNS ──
  async getPurchaseReturns() { const{data}=await sb.from("purchase_returns").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addPurchaseReturn(r) { const{data}=await sb.from("purchase_returns").insert(r).select().single(); return data; },
  async addPurchaseReturnItems(items) { await sb.from("purchase_return_items").insert(items); },
  async deletePurchaseReturn(id) { await sb.from("purchase_return_items").delete().eq("return_id",id); await sb.from("purchase_returns").delete().eq("id",id); },
  // ── DEAD STOCK ──
  async getDeadStock() { const{data}=await sb.from("v_dead_stock").select("*"); return data||[]; },
  async getExpiringBatches() { const{data}=await sb.from("v_expiring_batches").select("*"); return data||[]; },
  // ── CASH SHIFTS ──
  async getShifts(date) { const q=sb.from("cash_shifts").select("*").order("created_at",{ascending:false}); if(date)q.eq("shift_date",date); const{data}=await q.limit(50); return data||[]; },
  async openShift(s) { const{data}=await sb.from("cash_shifts").insert(s).select().single(); return data; },
  async closeShift(id,u) { await sb.from("cash_shifts").update(u).eq("id",id); },
  async deleteShift(id) { await sb.from("cash_shifts").delete().eq("id",id); },
  // ── EOD REPORTS ──
  async getEODReports() { const{data}=await sb.from("eod_reports").select("*").order("report_date",{ascending:false}).limit(30); return data||[]; },
  async addEODReport(r) { const{data}=await sb.from("eod_reports").upsert(r,{onConflict:"report_date"}).select().single(); return data; },
  async deleteEODReport(id) { await sb.from("eod_reports").delete().eq("id",id); },
  // ── PROFITABILITY ──
  async getProductProfitability() { const{data}=await sb.from("v_product_profitability").select("*"); return data||[]; },
  // ── PROMOTIONS ──
  async getPromotions() { const{data}=await sb.from("promotions").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addPromotion(p) { const{data}=await sb.from("promotions").insert(p).select().single(); return data; },
  async updatePromotion(id,u) { await sb.from("promotions").update(u).eq("id",id); },
  async deletePromotion(id) { await sb.from("promotions").delete().eq("id",id); },
  // ── COUPONS ──
  async getCoupons() { const{data}=await sb.from("coupons").select("*").order("created_at",{ascending:false}); return data||[]; },
  async addCoupon(c) { const{data}=await sb.from("coupons").insert(c).select().single(); return data; },
  async updateCoupon(id,u) { await sb.from("coupons").update(u).eq("id",id); },
  async deleteCoupon(id) { await sb.from("coupons").delete().eq("id",id); },
  async findCoupon(code) { const{data}=await sb.from("coupons").select("*").eq("code",code).eq("status","active").single(); return data; },
  // ── COUPON REDEMPTIONS ──
  async addRedemption(r) { const{data}=await sb.from("coupon_redemptions").insert(r).select().single(); return data; },
  async getRedemptions() { const{data}=await sb.from("coupon_redemptions").select("*").order("redeemed_at",{ascending:false}).limit(50); return data||[]; },
  async getBankAccounts() { const {data}=await sb.from("bank_accounts").select("*").order("id"); return data||[]; },
  async updateBankBalance(id,bal) { await sb.from("bank_accounts").update({balance:bal,updated_at:new Date().toISOString()}).eq("id",id); },
  async addMoneyMovement(m) { const {data}=await sb.from("money_movements").insert(m).select().single(); return data; },
  async getMoneyMovements(accountId) { let q=sb.from("money_movements").select("*").order("created_at",{ascending:false}).limit(100); if(accountId)q=q.eq("account_id",accountId); const {data}=await q; return data||[]; },

  // Audit Log
  async addAuditLog(entry) {
    try { await sb.from("audit_log").insert(entry); }
    catch(e) { console.error("Audit log error:", e); }
  },
  async getAuditLog(limit=200) {
    const {data} = await sb.from("audit_log").select("*").order("created_at",{ascending:false}).limit(limit);
    return data||[];
  },
  async cleanupOldLogs() {
    const cutoff = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    await sb.from("audit_log").delete().lt("created_at", cutoff);
  },

  // Void Transaction (admin only — soft delete)
  async voidTransaction(txId, reason, adminId, adminName) {
    const{error}=await sb.from("transactions").update({void_status:"voided",void_reason:reason,void_by:adminId,void_at:new Date().toISOString()}).eq("id",txId);
    if(error) throw error;
    await sb.from("audit_log").insert({user_id:adminId,user_name:adminName,action:"void_transaction",entity_type:"transaction",entity_id:txId,field_name:"void_status",old_value:"active",new_value:"voided",notes:reason});
  },

  // Cash Reconciliation
  async getReconciliations(limit=50) {
    const{data}=await sb.from("cash_reconciliation").select("*").order("created_at",{ascending:false}).limit(limit);
    return data||[];
  },
  async addReconciliation(r) {
    const{data,error}=await sb.from("cash_reconciliation").insert(r).select().single();
    if(error) throw error;
    return data;
  },

  // Daily Closing Reports
  async getClosingReports(limit=30) {
    const{data}=await sb.from("daily_closing_reports").select("*").order("report_date",{ascending:false}).limit(limit);
    return data||[];
  },
  async saveClosingReport(r) {
    const{data,error}=await sb.from("daily_closing_reports").upsert(r,{onConflict:"report_date"}).select().single();
    if(error) throw error;
    return data;
  },

  // Sequence Gap Detection
  async detectGaps(date) {
    const startD=new Date(date);startD.setHours(0,0,0,0);
    const endD=new Date(date);endD.setHours(23,59,59,999);
    const{data:txs}=await sb.from("transactions").select("seq_number,cashier_id,cashier_name,receipt_no").gte("created_at",startD.toISOString()).lte("created_at",endD.toISOString()).order("created_at",{ascending:true});
    if(!txs||txs.length===0) return [];
    // Group by cashier and check gaps
    const byCashier={};
    txs.forEach(t=>{
      const k=t.cashier_id||0;
      if(!byCashier[k]) byCashier[k]={name:t.cashier_name,seqs:[]};
      byCashier[k].seqs.push(t.seq_number||0);
    });
    const gaps=[];
    Object.entries(byCashier).forEach(([cid,info])=>{
      const sorted=[...info.seqs].sort((a,b)=>a-b);
      for(let i=1;i<sorted.length;i++){
        if(sorted[i]-sorted[i-1]>1){
          for(let m=sorted[i-1]+1;m<sorted[i];m++){
            gaps.push({cashier_id:cid,cashier_name:info.name,missing_seq:m,date:date});
          }
        }
      }
    });
    return gaps;
  }
};

// ── EXCEL EXPORT ──────────────────────────────────────────────
function xmlE(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function mkS(n,h,rows){let s='<Worksheet ss:Name="'+xmlE(n)+'"><Table>';s+="<Row>"+h.map(x=>'<Cell><Data ss:Type="String">'+xmlE(x)+'</Data></Cell>').join("")+"</Row>";rows.forEach(r=>{s+="<Row>"+r.map(c=>'<Cell><Data ss:Type="'+(typeof c==="number"?"Number":"String")+'">'+xmlE(c)+'</Data></Cell>').join("")+"</Row>"});return s+"</Table></Worksheet>";}
function exportXL(prods,txns,invs){
const sh=[];
sh.push(mkS("Inventory",["Barcode","Name","Name AR","Cat","Unit","Cost","Price","Margin","Margin %","Stock","Expiry Date"],prods.map(p=>{const mg=p.p-p.c;const mgPct=p.c>0?+((p.p-p.c)/p.c*100).toFixed(1):0;return[p.bc,p.n,p.a,p.cat,p.u,p.c,p.p,+mg.toFixed(3),mgPct,p.s,p.exp||""]})));
sh.push(mkS("Sales",["Receipt","Date","Time","Items","Qty","Subtotal","Discount","Tax","Total","Method"],txns.map(tx=>[tx.rn,tx.date,tx.time,tx.items.map(i=>i.n+"x"+i.qty).join("; "),tx.items.reduce((s,i)=>s+i.qty,0),+tx.sub.toFixed(3),+tx.disc.toFixed(3),+tx.tax.toFixed(3),+tx.tot.toFixed(3),tx.method])));
sh.push(mkS("Sales Detail",["Receipt","Date","Product","Barcode","Qty","Price","Total"],txns.flatMap(tx=>tx.items.map(i=>[tx.rn,tx.date,i.n,i.bc,i.qty,i.p,+(i.p*i.qty).toFixed(3)]))));
sh.push(mkS("Purchases",["Invoice","Date","Supplier","Product","Qty","Cost","Total"],invs.flatMap(inv=>inv.items.map(it=>[inv.invoiceNo,inv.date,inv.supplier,it.productName,parseInt(it.qty)||0,parseFloat(it.cost)||0,+((parseFloat(it.cost)||0)*(parseInt(it.qty)||0)).toFixed(3)]))));
const xml='<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Font ss:Size="11"/></Style></Styles>'+sh.join("")+"</Workbook>";
const b=new Blob([xml],{type:"application/vnd.ms-excel"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="3045_POS_"+new Date().toISOString().slice(0,10)+".xls";a.click();URL.revokeObjectURL(u);}

// ── I18N (same as before) ─────────────────────────────────────
const T={en:{newSale:"New Sale",held:"Held Orders",dashboard:"Dashboard",admin:"Admin",search:"Search products...",barcode:"Barcode",currentSale:"Current Sale",clear:"Clear All",empty:"Cart is empty",emptyHint:"Scan barcode or tap a product",hold:"Hold Order",subtotal:"Subtotal",discount:"Discount",vat:"VAT",total:"Total",discPct:"Discount %",apply:"Apply",cash:"Cash",card:"Visa",mada:"CliQ",cashPay:"Cash Payment",cardPay:"Visa Payment",madaPay:"CliQ Payment",tendered:"Amount Received",change:"Change Due",insertCard:"Processing Visa payment...",scanMada:"Processing CliQ transfer...",confirm:"Confirm Payment",print:"Print Receipt",newSaleBtn:"New Sale",receipt:"Receipt",resume:"Resume",del:"Delete",noHeld:"No held orders",totalSales:"Total Sales",txns:"Transactions",avgTxn:"Average",sold:"items sold",recent:"Recent Transactions",noTxns:"No transactions yet",time:"Time",items:"Items",method:"Payment",done:"Completed",terminal:"Terminal 01",all:"All",snacks:"Snacks",drinks:"Drinks",cigs:"Cigarettes",candy:"Candy",chips:"Chips & Nuts",energy:"Energy",water:"Water & Juice",canned:"Canned",care:"Care",home:"Household",chocolate:"Chocolate",biscuits:"Biscuits & Wafers",cake:"Cake & Pastry",nuts:"Nuts & Seeds",soda:"Soft Drinks",juice:"Juice & Drinks",coffee:"Coffee & Tea",dairy:"Dairy & Cheese",meat:"Meat & Poultry",food:"Food & Grocery",frozen:"Frozen & Ice Cream",breakfast:"Breakfast",baby:"Baby",personal:"Personal Care",electronics:"Electronics",scanner:"Barcode Scanner",scanHint:"Scan or type barcode and press Enter",samples:"Quick test:",none:"No products found",lang:"العربية",inventory:"Inventory",users:"Users",settings:"Settings",purchases:"Purchases",product:"Product",price:"Price",cost:"Cost",stock:"Stock",cat:"Category",act:"Actions",edit:"Edit",save:"Save",cancel:"Cancel",lowStock:"Low Stock Alert",user:"Username",name:"Full Name",role:"Role",on:"Active",off:"Inactive",cashier:"Cashier",manager:"Manager",adminR:"Admin",pass:"Password",newPass:"New Password",setPass:"Set Password",chgPass:"Change",addUser:"Add User",addProd:"Add Product",today:"Today",week:"This Week",month:"This Month",top:"Top Products",qty:"Qty",store:"Store Name",taxR:"Tax Rate %",curr:"Currency",saveSt:"Save",saved:"Saved!",hourly:"Sales by Hour",byCat:"By Category",payments:"Payment Methods",trend:"Weekly Trend",ready:"Barcode scanner active",added:"added to cart",notFound:"Product not found",login:"Sign In",loginErr:"Wrong username or password",logout:"Sign Out",hi:"Welcome back",supplier:"Supplier",invNo:"Invoice #",addInv:"New Invoice",invItems:"Items",addItem:"Add Line",selProd:"Select product...",costPr:"Unit Cost",saveInv:"Save & Update Stock",totCost:"Invoice Total",by:"Received By",noInv:"No invoices yet",updated:"Stock updated!",bc:"Barcode",unit:"Unit",nameEn:"English Name",nameAr:"Arabic Name",prodAdded:"Product added!",excel:"Export Excel",autoSave:"Cloud Database",loading:"Loading data...",dbConnected:"Connected to database",dbError:"Database error — using offline mode",margin:"Margin",marginPct:"Margin %",loyalty:"Loyalty",customers:"Customers",custPhone:"Phone Number",custName:"Customer Name",custNameAr:"Name (AR)",searchCust:"Enter phone number...",custNotFound:"Customer not found",addCust:"Register New Customer",custAdded:"Customer registered!",points:"Points",tier:"Tier",totalSpent:"Total Spent",visits:"Visits",earnPts:"Points to earn",redeemPts:"Redeem Points",redeemAmt:"Redeem value",ptsBalance:"Balance",bronze:"Bronze",silver:"Silver",gold:"Gold",vip:"VIP",custAttached:"Customer attached",noCust:"No customer (guest)",removeCust:"Remove",custSearch:"Customer Lookup",registerNew:"Register",ptHistory:"Points History",earned:"Earned",redeemed:"Redeemed",multiplier:"Multiplier",salesView:"Sales History",searchSales:"Search receipt, customer...",filterAll:"All",filterCash:"Cash",filterCard:"Visa",filterMada:"CliQ",sortNewest:"Newest",sortOldest:"Oldest",sortHighest:"Highest",sortLowest:"Lowest",dateFrom:"From",dateTo:"To",clearFilter:"Clear Filters",showing:"Showing",of:"of",salesTotal:"Sales Total",editUser:"Edit User",permissions:"Permissions",permPOS:"Point of Sale",permDashboard:"Dashboard",permInventory:"Inventory",permPurchases:"Purchases",permSalesView:"Sales History",permUsers:"User Management",permLoyalty:"Loyalty Program",permSettings:"Settings",permExport:"Excel Export",savePerms:"Save Changes",accessDenied:"Access Denied",home:"Home",hr:"HR & Payroll",contracts:"Contracts",salaries:"Salaries",leaves:"Leaves",attendance:"Attendance",contractType:"Contract Type",fullTime:"Full-time",partTime:"Part-time",temporary:"Temporary",probation:"Probation",startDate:"Start Date",endDate:"End Date",basicSalary:"Basic Salary",housingAllow:"Housing",transportAllow:"Transport",otherAllow:"Other Allow.",totalSalary:"Total Salary",workHours:"Hours/Day",workDays:"Days/Week",annualLeave:"Annual Leave Days",addContract:"Add Contract",editContract:"Edit Contract",payMonth:"Month",payYear:"Year",deductions:"Deductions",overtime:"Overtime",overtimeHrs:"OT Hours",bonus:"Bonus",netSalary:"Net Salary",payMethod:"Pay Method",bank:"Bank Transfer",check:"Check",pending:"Pending",paid:"Paid",cancelled:"Cancelled",markPaid:"Mark Paid",addSalary:"Process Salary",leaveType:"Leave Type",annual:"Annual",sick:"Sick",unpaid:"Unpaid",emergency:"Emergency",otherLeave:"Other",leaveDays:"Days",leaveReason:"Reason",approved:"Approved",rejected:"Rejected",approve:"Approve",reject:"Reject",addLeave:"Request Leave",clockIn:"Clock In",clockOut:"Clock Out",clockedIn:"Clocked In",clockedOut:"Clocked Out",hoursWorked:"Hours",present:"Present",late:"Late",absent:"Absent",halfDay:"Half Day",holiday:"Holiday",todayAtt:"Today's Attendance",welcome2:"Welcome to 3045 Supermarket",quickActions:"Quick Actions",systemOverview:"System Overview",recentActivity:"Recent Activity",noContracts:"No contracts",noSalaries:"No salary records",noLeaves:"No leave requests",employee:"Employee",finance:"Finance",expenses:"Expenses",bankAccounts:"Bank Accounts",moneyMovements:"Transactions",addExpense:"Add Expense",expCategory:"Category",expAmount:"Amount",expDesc:"Description",expDate:"Date",expRecurring:"Recurring",none2:"One-time",monthly2:"Monthly",weekly2:"Weekly",yearly2:"Yearly",refNo:"Reference #",deposit:"Deposit",withdrawal:"Withdrawal",transfer:"Transfer",salesDeposit:"Sales Deposit",currentBalance:"Current Balance",totalExpenses:"Total Expenses",netProfit:"Net Profit",grossRevenue:"Gross Revenue",costOfGoods:"Cost of Goods",grossProfit:"Gross Profit",opExpenses:"Operating Expenses",profitMargin:"Profit Margin",cashFlow:"Cash Flow",pnl:"Profit & Loss",financialOverview:"Financial Overview",thisMonth:"This Month",allTime2:"All Time",movementType:"Type",balAfter:"Balance After",expiryDate:"Expiry Date",expiring:"Expiring Soon",expired:"Expired",daysLeft:"days left",noExpiry:"No expiry",expiringItems:"Items Near Expiry",dailyTarget:"Daily Sales Target",weeklyTarget:"Weekly Sales Target",monthlyTarget:"Monthly Sales Target",goals:"Goals & Targets",storeInfo:"Store Information",bonusProgram:"Bonus Program",bonusRules:"Bonus Rules",salesBonus:"Sales Bonus",attendanceBonus:"Attendance Bonus",performanceBonus:"Performance Bonus",customBonus:"Custom Bonus",awardBonus:"Award Bonus",bonusAmount:"Bonus Amount",bonusReason:"Reason",bonusHistory:"Bonus History",empPerformance:"Employee Performance",salesTarget:"Sales Target",salesAchieved:"Achieved",txnCount:"Transactions",perfectAttendance:"Perfect Attendance",topSeller:"Top Seller",bonusAwarded:"Bonus Awarded!",noBonuses:"No bonuses awarded yet",bonusCriteria:"Criteria",bonusThreshold:"Threshold",bonusReward:"Reward",editRules:"Edit Rules",saveRules:"Save Rules",perTxn:"per transaction",ifAbove:"if above",daysPresent:"days present",configure:"Configure",dailyChecklist:"Daily Checklist",opening:"Opening",duringShift:"During Shift",closing:"Closing",completed2:"completed",resetChecklist:"Reset",debitFrom:"Debit From",noDebit:"No debit",attachInvoice:"Attach Invoice",documents:"Documents",addDoc:"Add Document",docTitle:"Title",docType:"Type",rentContract:"Rent Contract",license:"License",insurance:"Insurance",agreement:"Agreement",otherDoc:"Other",uploadFile:"Upload File",noDocuments:"No documents yet",viewDoc:"View"},
ar:{newSale:"بيع جديد",held:"طلبات معلقة",dashboard:"لوحة التحكم",admin:"الإدارة",search:"بحث عن منتج...",barcode:"باركود",currentSale:"الفاتورة الحالية",clear:"مسح الكل",empty:"السلة فارغة",emptyHint:"امسح الباركود أو اختر منتج",hold:"تعليق الطلب",subtotal:"المجموع الفرعي",discount:"الخصم",vat:"الضريبة",total:"الإجمالي",discPct:"نسبة الخصم %",apply:"تطبيق",cash:"نقدي",card:"فيزا",mada:"كليك",cashPay:"الدفع النقدي",cardPay:"الدفع بفيزا",madaPay:"الدفع بكليك",tendered:"المبلغ المستلم",change:"المتبقي",insertCard:"بانتظار فيزا...",scanMada:"جاري التحويل بكليك...",confirm:"تأكيد الدفع",print:"طباعة",newSaleBtn:"بيع جديد",receipt:"إيصال",resume:"استئناف",del:"حذف",noHeld:"لا توجد طلبات معلقة",totalSales:"إجمالي المبيعات",txns:"المعاملات",avgTxn:"المتوسط",sold:"مباعة",recent:"المعاملات الأخيرة",noTxns:"لا توجد معاملات",time:"الوقت",items:"العناصر",method:"الدفع",done:"مكتمل",terminal:"نقطة بيع ٠١",all:"الكل",snacks:"وجبات خفيفة",drinks:"مشروبات",cigs:"سجائر",candy:"حلويات",chips:"شيبس ومكسرات",energy:"مشروبات طاقة",water:"مياه وعصائر",canned:"معلبات",care:"عناية شخصية",home:"منزلية",chocolate:"شوكولاتة",biscuits:"بسكويت وويفر",cake:"كيك ومعجنات",nuts:"مكسرات وتسالي",soda:"مشروبات غازية",juice:"عصائر ومشروبات",coffee:"قهوة وشاي",dairy:"ألبان وأجبان",meat:"لحوم ودواجن",food:"أغذية ومعلبات",frozen:"مجمدات وبوظة",breakfast:"فطور وحبوب",baby:"أطفال",personal:"عناية شخصية",electronics:"إلكترونيات",scanner:"ماسح الباركود",scanHint:"امسح الباركود أو اكتبه واضغط إدخال",samples:"للتجربة:",none:"لا توجد منتجات",lang:"English",inventory:"المخزون",users:"المستخدمين",settings:"الإعدادات",purchases:"المشتريات",product:"المنتج",price:"السعر",cost:"التكلفة",stock:"المخزون",cat:"الفئة",act:"إجراء",edit:"تعديل",save:"حفظ",cancel:"إلغاء",lowStock:"تنبيه مخزون منخفض",user:"اسم المستخدم",name:"الاسم الكامل",role:"الدور",on:"نشط",off:"معطل",cashier:"أمين صندوق",manager:"مدير",adminR:"مسؤول",pass:"كلمة المرور",newPass:"كلمة مرور جديدة",setPass:"تعيين",chgPass:"تغيير",addUser:"إضافة مستخدم",addProd:"إضافة منتج",today:"اليوم",week:"الأسبوع",month:"الشهر",top:"الأكثر مبيعاً",qty:"الكمية",store:"اسم المتجر",taxR:"نسبة الضريبة",curr:"العملة",saveSt:"حفظ",saved:"تم الحفظ!",hourly:"المبيعات بالساعة",byCat:"حسب الفئة",payments:"طرق الدفع",trend:"الاتجاه الأسبوعي",ready:"ماسح الباركود جاهز",added:"أُضيف للسلة",notFound:"المنتج غير موجود",login:"تسجيل الدخول",loginErr:"اسم المستخدم أو كلمة المرور خاطئة",logout:"تسجيل الخروج",hi:"مرحباً بعودتك",supplier:"المورد",invNo:"رقم الفاتورة",addInv:"فاتورة جديدة",invItems:"بنود الفاتورة",addItem:"إضافة بند",selProd:"اختر المنتج...",costPr:"سعر الوحدة",saveInv:"حفظ وتحديث المخزون",totCost:"إجمالي الفاتورة",by:"استلمها",noInv:"لا توجد فواتير",updated:"تم تحديث المخزون!",bc:"باركود",unit:"الوحدة",nameEn:"الاسم بالإنجليزية",nameAr:"الاسم بالعربية",prodAdded:"تمت الإضافة!",excel:"تصدير Excel",autoSave:"قاعدة بيانات سحابية",loading:"جاري التحميل...",dbConnected:"متصل بقاعدة البيانات",dbError:"خطأ — وضع غير متصل",margin:"الهامش",marginPct:"نسبة الهامش",loyalty:"الولاء",customers:"العملاء",custPhone:"رقم الهاتف",custName:"اسم العميل",custNameAr:"الاسم (عربي)",searchCust:"أدخل رقم الهاتف...",custNotFound:"العميل غير موجود",addCust:"تسجيل عميل جديد",custAdded:"تم تسجيل العميل!",points:"النقاط",tier:"المستوى",totalSpent:"إجمالي الإنفاق",visits:"الزيارات",earnPts:"نقاط ستُكتسب",redeemPts:"استبدال النقاط",redeemAmt:"قيمة الاستبدال",ptsBalance:"الرصيد",bronze:"برونزي",silver:"فضي",gold:"ذهبي",vip:"VIP",custAttached:"تم ربط العميل",noCust:"بدون عميل (ضيف)",removeCust:"إزالة",custSearch:"بحث عن عميل",registerNew:"تسجيل",ptHistory:"سجل النقاط",earned:"مكتسبة",redeemed:"مستبدلة",multiplier:"المضاعف",salesView:"سجل المبيعات",searchSales:"بحث إيصال، عميل...",filterAll:"الكل",filterCash:"نقدي",filterCard:"فيزا",filterMada:"كليك",sortNewest:"الأحدث",sortOldest:"الأقدم",sortHighest:"الأعلى",sortLowest:"الأقل",dateFrom:"من",dateTo:"إلى",clearFilter:"مسح الفلاتر",showing:"عرض",of:"من",salesTotal:"إجمالي المبيعات",editUser:"تعديل المستخدم",permissions:"الصلاحيات",permPOS:"نقطة البيع",permDashboard:"لوحة التحكم",permInventory:"المخزون",permPurchases:"المشتريات",permSalesView:"سجل المبيعات",permUsers:"إدارة المستخدمين",permLoyalty:"برنامج الولاء",permSettings:"الإعدادات",permExport:"تصدير Excel",savePerms:"حفظ التغييرات",accessDenied:"غير مصرح",home:"الرئيسية",hr:"الموارد البشرية",contracts:"العقود",salaries:"الرواتب",leaves:"الإجازات",attendance:"الحضور",contractType:"نوع العقد",fullTime:"دوام كامل",partTime:"دوام جزئي",temporary:"مؤقت",probation:"تجريبي",startDate:"تاريخ البداية",endDate:"تاريخ النهاية",basicSalary:"الراتب الأساسي",housingAllow:"بدل سكن",transportAllow:"بدل نقل",otherAllow:"بدل آخر",totalSalary:"إجمالي الراتب",workHours:"ساعات/يوم",workDays:"أيام/أسبوع",annualLeave:"أيام الإجازة السنوية",addContract:"إضافة عقد",editContract:"تعديل عقد",payMonth:"الشهر",payYear:"السنة",deductions:"الخصومات",overtime:"إضافي",overtimeHrs:"ساعات إضافية",bonus:"مكافأة",netSalary:"صافي الراتب",payMethod:"طريقة الدفع",bank:"تحويل بنكي",check:"شيك",pending:"معلق",paid:"مدفوع",cancelled:"ملغي",markPaid:"تم الدفع",addSalary:"معالجة الراتب",leaveType:"نوع الإجازة",annual:"سنوية",sick:"مرضية",unpaid:"بدون راتب",emergency:"طارئة",otherLeave:"أخرى",leaveDays:"أيام",leaveReason:"السبب",approved:"موافق",rejected:"مرفوض",approve:"موافقة",reject:"رفض",addLeave:"طلب إجازة",clockIn:"تسجيل حضور",clockOut:"تسجيل انصراف",clockedIn:"تم الحضور",clockedOut:"تم الانصراف",hoursWorked:"ساعات",present:"حاضر",late:"متأخر",absent:"غائب",halfDay:"نصف يوم",holiday:"عطلة",todayAtt:"حضور اليوم",welcome2:"مرحباً بك في نظام 3045 سوبر",quickActions:"إجراءات سريعة",systemOverview:"نظرة عامة",recentActivity:"النشاط الأخير",noContracts:"لا عقود",noSalaries:"لا سجلات رواتب",noLeaves:"لا طلبات إجازة",employee:"الموظف",finance:"المالية",expenses:"المصروفات",bankAccounts:"الحسابات البنكية",moneyMovements:"الحركات المالية",addExpense:"إضافة مصروف",expCategory:"الفئة",expAmount:"المبلغ",expDesc:"الوصف",expDate:"التاريخ",expRecurring:"متكرر",none2:"مرة واحدة",monthly2:"شهري",weekly2:"أسبوعي",yearly2:"سنوي",refNo:"رقم المرجع",deposit:"إيداع",withdrawal:"سحب",transfer:"تحويل",salesDeposit:"إيداع مبيعات",currentBalance:"الرصيد الحالي",totalExpenses:"إجمالي المصروفات",netProfit:"صافي الربح",grossRevenue:"إجمالي الإيرادات",costOfGoods:"تكلفة البضاعة",grossProfit:"الربح الإجمالي",opExpenses:"مصاريف تشغيلية",profitMargin:"هامش الربح",cashFlow:"التدفق النقدي",pnl:"الأرباح والخسائر",financialOverview:"النظرة المالية",thisMonth:"هذا الشهر",allTime2:"الإجمالي",movementType:"النوع",balAfter:"الرصيد بعد",expiryDate:"تاريخ الانتهاء",expiring:"قريب الانتهاء",expired:"منتهي الصلاحية",daysLeft:"يوم متبقي",noExpiry:"بدون تاريخ",expiringItems:"منتجات قاربت على الانتهاء",dailyTarget:"هدف المبيعات اليومي",weeklyTarget:"هدف المبيعات الأسبوعي",monthlyTarget:"هدف المبيعات الشهري",goals:"الأهداف",storeInfo:"معلومات المتجر",bonusProgram:"برنامج المكافآت",bonusRules:"قواعد المكافآت",salesBonus:"مكافأة المبيعات",attendanceBonus:"مكافأة الحضور",performanceBonus:"مكافأة الأداء",customBonus:"مكافأة مخصصة",awardBonus:"منح مكافأة",bonusAmount:"مبلغ المكافأة",bonusReason:"السبب",bonusHistory:"سجل المكافآت",empPerformance:"أداء الموظف",salesTarget:"هدف المبيعات",salesAchieved:"تحقق",txnCount:"المعاملات",perfectAttendance:"حضور كامل",topSeller:"الأعلى مبيعاً",bonusAwarded:"تم منح المكافأة!",noBonuses:"لم تمنح مكافآت بعد",bonusCriteria:"المعايير",bonusThreshold:"الحد الأدنى",bonusReward:"المكافأة",editRules:"تعديل القواعد",saveRules:"حفظ القواعد",perTxn:"لكل معاملة",ifAbove:"إذا أعلى من",daysPresent:"يوم حضور",configure:"إعداد",dailyChecklist:"قائمة المهام اليومية",opening:"الافتتاح",duringShift:"أثناء الوردية",closing:"الإغلاق",completed2:"مكتمل",resetChecklist:"إعادة تعيين",debitFrom:"خصم من",noDebit:"بدون خصم",attachInvoice:"إرفاق فاتورة",documents:"المستندات",addDoc:"إضافة مستند",docTitle:"العنوان",docType:"النوع",rentContract:"عقد إيجار",license:"رخصة",insurance:"تأمين",agreement:"اتفاقية",otherDoc:"أخرى",uploadFile:"رفع ملف",noDocuments:"لا يوجد مستندات بعد",viewDoc:"عرض"}};

const STORE_LOGO="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAAfNUlEQVR42u3de5xdVXnw8d+z9j5nzkwyud8JmUsQfCcXxSAggU6w1aJVa8ETq2IVtLkBXqq+rdV2GFtqW60XIgkZkJbyqph5kWK98NZLMigEkIgQGEDD5ELS3EgymcncztlrPe8f+0wyuRIsmUzi8/18zieTOXPO2Wfv9ay1nrXXXhuMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHmIFGQBnBqj5f1KO0zURArRmeI9KDmo1XUxwrO9sgrt19XUR+voj5uOMP36xlXGyjIauqj1bSERgiHPpeP1g5vGx2iwgh1rlxVYihaiX8JTiLvvO9xIdMR9kftF7C2eKL73AJk6ASGg7wIzb7/d+tGzzi7GDIXBdGLAzpboUbRccBwQWJnvYUTElBAE1XpEmG3wCansg4nj2SDf3j2vnVt/X+7knyUp1nlDAkUOQMCQyDv+gPj52PPn1Lh9Z0evUrhogpxwxyQoBRVSVAUgqIqoFb8T3Q/i3PgYoSMCDFCALrV9zl4zCn3CnLP+fue2JgGCtHToKd7iyKn90HLR/2B8ejo2TOdcj3I/ApxoxOUbg0o9KVfVOMIF8UiRIC1Hi93Xyse+iuZQKlvKlBWLo4MQreG/U65N1FZemHHr35x+DGyABnUVgMRCC2jZ5xdqdFnAnJNhbjsfvV46AN1GVymXNIccr96gB2KbgPZFdBOB4k1ISdUQCJgOMh4lMkIk4ZLJAL0aqBASEC8g7LhEtGjQUX0W0lC40WdT/5aQW4EOR1bk9MuQFZCNB88wCOjZy/OqHwuJ25ch3pU6UPIVkokAaU3hM3AKhVdFQm/TKRn08V71ndYsf/trRpfN3yELzs7aPJaVOYpvDEr7pwMQueAYzBCIunVsD8If//6vU/8M6AryUfzT7PW5LQKkFXUx5fTkvx42MyJo+NoRblzf9ylgSJaEIhHSOS61XuB/wzov3Zl/E8v39W6/1gJvRX3l6O5P2fTQ49JVa5yxKjfI+IDqF5ZLlGuUz0BCjFkKyWiW/3qbtUPXbZvXVv/MbQAOUnB8eCIGa8vd/G3c+Jq9mmSKGiFRJmAEpRvBdUvXLjvyccH5imr2SnzaAmAJeavUPd2NfVuHhN0YH7x2NiZrxbv/kKRa7MiUZf6BNBKiTMFDTu7gr/6so6nfnQ6BYmcTsHx89Ez31qh8UonDOtWXxQkGimR69HwuCqfuGDfE6v6u2GQJ09zsIA4+QHTTN4B9HeffjHiNRc64Yvlzl3WoV4DmpSJyzjFd6PXzG1/8q7TJUiGfID091t/PmLGm4e7+PsJxAVCEiNxThwF1X/Z2d71mbeyvk/JR5xBY/CnmwZw86h3pYIvj4ya/dmMyOeCQumYRTlx0hnCh+bue/KO0yFIZIjXTk4gPDxydk1GZC0wuo9QLMNlBHoLEq69eO+6bw0MJCumQ2Mgpf8cyJrRs95Spu4bIjK6R30SI65MnOsIfv5l+9Y1D/UgGcoBIivJO2hm2sjZDwx30SX7tFgslyijqu296B/PbV/3gFIfQ4u3rtTQ8xhzMhewtvjAqJmzh+F+EIk7q1t9kkFchBR7A793SccTjw4cmRxqhuxEMyXv5tPsp46c9YlRLr6kQ32hjChG6ez2+pa57eseeIw5GaElseAYmi5gbXEFczK/1/7Ukx1J+AOvuj0nLi6iQUTKYtHmh0bUjcmDDtVJjzI0gwMH6EOjzp+WJTwNmlPQGHHdIXnLpR1P/1d/7WTF8DQaZBkx84IKF7V4NFdE/SiJM+3q/+8l7U/mh+oZ9yEZtc3kRUBR3zhM3LAiJMMlinvxHxv84FCBfJQ+6uP00eBeXuXS4A6+Rz56BSomSbfjeO+Tj05gOyX9m4aTWg4upyV5jDmZSzueeqw76LU5iVwE0qFJMlKidz00clZeaPYr031jLciJJOaPVM4+N4p4KkFluMRxpyb3vqF93ZWDl9TlI16yRstH0Bw4Zhevv+A1ht/u/V/JIJ9/WBDU6dG36+TnJGtGzlo+0sWL9qkvlCGZourWYtxX96Pdz3XdOMTOVcVDLUBWU++gJQSn1w+XONOtPulVv5uiLm4Atzo94XeSNThoTAvvOTfUkTAVF8YQdCRCESe/ItnfyqY7ewdUNHpkAJTeY/qSGag7DyUCbSfs/1n6WpVSHaUvr0LLO2rGXUm2736eu6PzKJ8vVC+4jEzFFkZ0v8BaKXLUJLjBcd6Lk+jlXDaNe+BkB8wc1iYryUfluec+2dnr35JzUtWjWhjtoqntPvuRRrhpXjroMmRGtYZUC6LpBER9eMw5IzSUr3fI+OES0a7J9XPb190yOK1Hg4PGQM2HLxON36ninkZZj7heQjJWnLwfl30PIWkT4c7g3D+xfmnfoYW01DpUX3ueRJVfRH1Wg96CyF7QS0XkalVdxoZbbjl2gB3tWOUdNHupXnQXccXVWuiZzublbQe2+cD75COpHrcJicZD8gLITpR20J7SW2URhgOTcNlX4/tu0o23/k3/+5/Mvds/HP/QyFl/UOGiH/VpKMZIVET3FFXPvXTfuvbSlx0SrciQakFWUx9BS4Ivf/MwF40vqGqHJr/Z2u5vSxP3lpPcJSnV+jUL3yUSf1t9MovNy1oPC+IfSvXiHuLyaxVtFN83TycveBvbJvdCI9Ag0OiZtuD3JSq/B01U9/VMY/cdnaW3+JlWLw6SHfk1apZcpuXj/4xWkvS1xysUpeCoWfzPROVX43u6IdIjqhgEaseORakAH4ObjrjpiKTPSSn1dDEED773H3XjrZ89pNU8iebT7FdRH1+yr+XHPx85q2mMixe0q+8bLdG4dpI/E/jqqiHUigzVobV3AFomTlC+OJ/Wwmrq3UmuVQSaA1UfHSUqy5DISRQ3cc7CulLCG0M+Cw1OI5YR+gK+p5eo/HJy0UehMVDXkIFGper6V0uUuRfJjMQnX2X3HZ2cc0PZgSS9zy+l2L6deNi7pWf77Wntnz/OsWiIodm76sX/G5f9FL7Ho5oFf1gPoJRneM7C5UbjyhwuCxKBuFL7DGhxH0nvvardl+rG5Z8e0AINUkXYEhScU//p/ep3ZZG4F1WUD68kH8076RXh6RcgAnD5tLrKS6e9d7RDLwKR/cFv93HhbgU5+Tst7wAlKs7EZcbj+3qIcnPFy2cPdjtWFqExIL2bCX4/SI5QCKL6VgDGp1NcxCW34qJKQq9qFD0KCOu3J+n71CnbmrqBZ/C9Hpd7P7XX/Un63Mro6MHRmFCz8H2KjMAXOkol/jiVhVSpFj+voe+zhMJSQqGJUFyqofBZJVylRLN1w9eupG3Fg6VWc1CT9UYIq6l3l3S07vHKP1aIi3rU+zLnZk4Z/cyFUpoab12sAV0DhxDKKid9eO8vKwJSHacdhu9cuvu5zsHJPepKBS7ZjGqBKFeOOEB2HZGyFXIJkRZLE1tLqRPQ0phQtfhyJFNPKHqQCAmb06/S//7pOR7gBcRFqFcJ4TNKw33w9GGFvj4Njuol89EQaxx9VXzymZeu9nQc2vNVNnx9hx63OwmconMP82jxCrI6mzRJgU/EIpPKcBRV3wmsGc/OIZEfD5EWRPSqqflyVCe8pth1drmLs70acHCPguxiwiAkbI0BGhxtTZtVwp+gej/J/ttU9CbqG0oVyYIYGmLKQgVQASHBZSN1+r0D30TC1YhTUEFDH4RDL9CqP5As7AWBkHhEXkftizMObMOBAtySULPwTThq2XjrnVAYf/w8pRSEKuVEFYHj1sLNp3RCp4Cupj66fFfrfkVvHyaR600vkf4DBqXHcPq0IALoahk9BZepGKWFKYnkeDEkW3uz/lEB1UE7mKWRoLYVP1D4wYFftx32Z8WF7yIzshwtgO+6j9DzlfR7NAiy42LUC4ggWsTHhfRFN2opEe9vNLvTpFkSXDbGFy4G1lGPoyUv0OypWfx6gbnaNv5zgFB0evwqrTGkXbKdsH7pLuYsyPDiklk4mQphFEoFzu3CJ4+zacXGUushAzL8wW5FAkACd3ap/0uQMpS6h8fMOkv2rNvSAO5UX6Y7BAKkQaBRuyKmo0Fi1QkRgsAv09olPXE4uKPNpZr3vMoK+rLX4KSAZztOI8Fdiri34ntuV5K72bD8J2nucKcydctoyE5G/YmM3IaBdYSITleArXsiaO6j5rpzhXCVFnONB7cr0uPM6Us/8NxtoyhEjqolV7jdYVaI3BZC2IroPpycI6qfIsq+gZrrHlG0iQ3L7ngZQ82vdM0YFJzsW9e2ZtTsn1eI/H4QyRU0zAS23EheGmn+Xe9irXYAXuUcNEmCyGgRQeHx0tDvKdjG5gDNnvbRwcFIkFFpDezGoAxHtRvVYSATmXLdWJjvQYWcVAC53yomleEArF/ax7QFk0XDAi1zX2DLl3tKx0mOGLVSXxq7bU1bL4BeMgKvBwhx5mbavvYtNi57gA23/oy25f+qG5ZdgiYriXIXict+XWqW3MvUj5eXXj/o/f7+4+vgPkdpOaHAjPS5U5+HnPoWpH4etLQQnFThomeLyLCMKuJ49pS2avVEtDR2Bfi7w4rybUxfMkOC/6W4iveQ69mmVQs+ySb5Jv4jRbSYvPxiJiClJR6rPjBKnPuYir+ZZ5fvTp9sTEqpWjikDDvx6SYNSLQ3792p9XUfpKX0GvLRgdxkzraItU1F9f5jQs9bUM0RV7xTdP/Nypf/fHCnvwzsZqn08boWUZ8MlygWqB0qw7ynPkBaSgVPmYIP6hAppjXqFoDBSdAPCQEBCbSUukBzFmRYO1mhNd2OqooMzy97WqsX/o1ochOqkyWu+IbWLmynbfT9VO9oR6LKdOmoE/9QRTZT3xDLpp2f0qB3s6lpM3UNWVpbPRDBzoB3MfHA3aE56hqydHRETOxKWNtUhJWBlv4h4MNO/q0lHQTY3LiN6sVPEmXmknQXkehDVC/6IhtvfW6Qz4mIQKD2kxP+smvG9pt7f9UWu/hcRCelwTNBLUD6Cx6MQ6KMU+0toHiRvQB5mgdzJwmIcvaHZ1BWeT7a8TBrm9Yf0j/flE8Lntv+IOpjNBQgZCS4zymNP4BFv0KiqaU8JCYTlfbxjYf38V0pNBx4wekDbNp1FiJ/IZCnelE53TsD1eMO7B5EM/TPwhBiIWqhZ0eBbByx2z2r8EYQZerCs8hlc6xvfP4o+zvtSglbwYHgcdkMoXcu8Fw6SDBYOV965r9S941aM7KqmOt9/IkYdy7IiFJX95QHyJA5ky4wHJLKMsLuAIhPegd3C/IRoFRdN0/i3FpB7hLNPUbtopkHa+P+odTGgNPthGKCSBZNBLS61BR8s3TKOgBlFJPKY3zjEWlBdzG+sJXnW5+AkEsbE2qBSaBTDn0w4bCR0jEo41EZB4wFoHrhQslmn5Ggz0r14qVpi/iS09kVkewpq6UTMuCmlKt/2qXxnwW4cQiUy6E01SRCw5RKTTafmo+vEwBx/hpcpoykuxOXG0mQKwCl/rB9FXLF0kiUgguIvAiA330foW9jujZ2JDjOGlBzQ0upxRTORn3AZZ0KX4aWBO3ZpBRqNIonq+MsjTNTNM5MUclOVcdZKlE9/SvvKEVN5BKNM2dr8NM0KV7OxKuHichNCJVoEuHi66la8upDz6/Ulda20okQ0hZMvRD844ds32DKJI7QU1OhxQ2nZLx5aHexDlRiPag/b1jSs1KyKFFUPriDBf35kKQBKi6H7+0jYhWo0DK/NBNwWwQN4HdMIYpjQlIgKitT390EwJbmHq1dfL3gvoc4JRRfB/yEOaNdmgPUKfUNMZu21xFlHb77EconLoUGx6bGXuDYLWf1wsm4jKBJQCQiCrtYv/Tgmf7JCypQ8QSfIJmYkHSivj1tRW4stZKtcN61lRRkJiEpEldk8d33s7Hp0cGasHhQ2u0MSZwlk0wb4f3aXRkQodDfgjT+zrcg9WnNHZAdqL8AKTxf0CAaZDykVxcOzmDBjR4Q9X4ZvncXEmU0FF/L88vXptNJmksjRk1FaAwiXIfLOaJcGUn3HWyY8JUDVw62Lf+++sLHkVhEomsATRNo0u7Zxh1vIjPyHHzvUxqHq2htLBw6SND/ODyjddcikQfpxWXAufcd8gfbmrpVuJm4Mgb/a1UuYnPTtnT7G9Oha5o9fdmPEpWPxZVl8L0Pa6bi/aey3k5gJKqThoVCR6kFaS91e22Y90CPRXQ9hCvnDf/9fV8oPrsH3DnATwdvTo5o/wiPnr3kchH/JaL4zdRcPwIpbEd9Hy6bRaVKkIXgrsb3PKyiN7Nx+bc4OP6aTvHYdOtXtGrBZonLvyS1S25X4s+RFDuJo/MFvRXfd5f68FE2rNh76MiR6IFBgbolw+nWS3A6ToL8Ca7sXRBAMhVpI5f9e2qWTFUX3U9INrBhwlNsaLxJaq+PVfUyIqmh6nrFub0kPiJOpgrRNbjsInzfFuDrGrr+kV8v64UvCYN+1jrtdvoomoyEEUgoppeP6Taw8yCHDvMGaY2zFWUtYy44a8T2p3+yW+QC4LbB3ZjGACq8IE8r/CFV170BkWo0fg3E5XjNOigPImuI3T/wm6XPDBhOHVC4mn0aJE3f0an5H1I26V2E8A5ilxBCpYrLs+Grjx79tQMUIgfFHOoKCs34vtuObFncSFQc4rP9uUZoa2ykaskkIncJTi9FkgpihgvRSJBdGpI3ke15pHQ1Yv/Q9uA3IfV1Qgt4eHVpDqdLE0FZbznIgMYjTdGjp1GFZOfbzvZdd78Yj/prQOe9zEts+5cd/Z+Mp/2YOW4yw/XvNt2yBlhzrH7p3eSj5jqifGurP9rEwOa6fPae1uYe4K7Dn/vwnAWZyWuf0xk06pGvbQby/On6pR3Ad090y+8u5Rjp5y7bDnznGCOGAFxVl8/Wte4MM5iv/7N9dqSnaX7pm+e0zOgPyteDPIOLRnggqD4NQ+M8yFCYUpx2JyYvqHBlbltAtrfuXnVJR5T9WacvXPamzmd368FLfcwZp8HFNTt2J67ib/ft/I/9bfHIO7oLfuLcrid32mTFUvsODY5tjd1avfiBODPsbXVnv3/ir1/495/2RbkrFL55otdKN4B784jXzsk5KS+SqLdbFg+6CLSSWDo0bH7Dvic2HrtyK01rqd1Rh6sYRTTsqb2SeXtX8Jsv7Xpyp/afZbcuFvSfvVXhhyrR2+jd/hevCl1f2RGVf0LgGytfsluVLgTw1lGzLh3lXEtRlTJii45TMiKljJKI/T75GnDDgXUGjpF/iJJXgOyw33RIdKE4+X6aoB/jdb+TAdI/tcFHPwx09kXiPiBTP/T3z2xfue1HIy+ofdO+5rbjdbP6e8+qEveFsLVbQ6IQWbfslHQIwh6HBHGPwDHn0gktjT6de7bjg9737F6872ddvbhXBfSv0te1DIljN4Qq2XQ0R2oW/dDFI67wvvsO3frtz68un3LF5e1PfO1EVm9XcGumXlxmhfTUmQo8v2WbXs6m40wVKl1nX73oHVFmxH3e996l2+/78prsqG++of2JGQyhxeOG0rI/DggqclsIvVc4uFam/VnTnu3f2XjPmAunXrWnectLJesCgS0P91gxHRKJ5XGOVasCIqKfFoB42He2u8ybi8pKgWDL/hxVY+mioxe/Ryg8g2RUij1NbfGYn1WHntqGE1w/VkurKNjj1D6OHRzpEkZULXo3rvxin3R2nRX2P7Y9yp3fF7sVkC7oMJRq7SFU6dwY0dpcUOXziheJMrMvGH3R376ufd1D0yf+17j0+vTjdwvl0Lkar+QDOfL9OezfAT83yDGeP+zRIEf+fMhrS/8f+Hf9zymHfoaWHkds36A/jnGI07P159wwQkT+yYlTlcw9bf9934ROida9effj/72SvOWOL52L5COpXvyY1N7gpfYjSvXid8eQXrx0qtU1ZE/sOxw+atNQWhn+Zb9Wjv6zygm9R35ldHBVlmO91yApHT+pXnSHTP+oRrU3KK/61GVbKl/1wf8cc/FZ/a3PUCqNQ3AktDQ+XnXdGySSh9DgEVfUUJjHxqZHDiR4g72PqpZMFNEbVGiju/NudvyfLle96P0hztxPMUkvNtq0/BlqF/8RrmIOvms3Xr7J5uV7Xc3iD4V4+ESSjl+wYcWPGHttJZXZT+My+wh9a9jY9ABVC6udc+8JG5Z/nuolfw48ycZljwC42sXXBLSPtlu/CUD1kouI4rcRinuJw7f5zYqt1C7+I7TwApo5n0R/zJYVW6lZ+D6i4dPx3Y+zYcL3mba1irjsBlSE2C/lN8s3HGy9ByE41jYVqV70AYmy/yaqIQT/YNeO777n8ezYcy/d98SqoXBicCh3sUr65zHdsoZQ/BdcNkJDViT7vfTipcZkcFuSUtmJNYNoJaI9VI6O0jpcZtG5txvHFMSPByDodChsEaWO0rXVCuehweOitEAOzw0DqUR1qyOaB0BGI1XeS+3iK0XCNbgwDIDaBSM1yFxRqaduSbqwg+g0gt8LOpKizCx97jiR3LdR2ceWFVtLjUwtqBBYT75V2Hz7BvCPgV/Lb5a3HVhN8uT3CmLWNhWZtnCuSLyCUPQq4iJHY4Xs8d8eP/khBWkcgjdfHaK3YGsOkI+0Ys9f4wu/QCKH6Fgh+jHTFryOtU3FwQuSUiNbZL+KWyMq70aTVwGohuepGLUAtAYtXUeC9hHc/9JIvkFN6xPprzQByvDJFACiEECHQZgbHGvTAp6pUHSlC8xUcd8lkH6/4N6pTnapyH56eXtpkzwS1QoyCR+tS4+klCtyjxOdxbQFkweMWWSJdPKBrxPEE2TwkuA5CzLpkO7C10iUuQ9CBpeN1Bf+I7Qt+8nC7qt3L11/f99QzTvioRkgpaU6WxsLWrVwvqg8SnpJ6USJsz/V2sXvY+3y7x//BjWvcBMScr1o7y4N0sCGZU8AwsZJt1G79wq83M+mWzeWavLvsvHnL8LaIs83OGhBg9yOuiokagfA93Tg4k+z4es7mLY4XcEjpxvYl/xr2Hr7Fs5dMO7Ap0fuQZ6/5U4Api85J92iwoNEG76vvWcNI1eRTnQshP9ky/KtYfris9H+lR3cXairxdNOc+kcUhz/9NCK6GTWLAvSlqNm4YVC/D2EsSgJmnQSyUcUpIkVCTQN2Yx4iM/GKOUj0/78EonLfoJqBoJDIlHVv2bDLZ8/OHTY6Dm1tdBhizL8tquDHHXquXBajewMuPNW7eIrRaM7EYYTkj6iXJkmPe9l04pvnYplhs6wADlQ+BOqF/2hSHwfhLJ0TdzymFD8fxr4GJu+9uzBv73Rn7xrG/rXmBpY8I/43VGW8mxw6cVBA/+u/+5SysGLpAb+3P8eAwPmwM9yZCt3yPsN+N1899Lb90qOQLamy6bOWZCRvXEjRJ+GAMH3EVeUkXR9RTeu+PgpGGw5UwNkQJBMW/RGiePvgIxEi724shzB7xfhiyHxN7N5+d6DhfZAF8LG1E96Geq/t0mpNaheXC/OfQHJvJ7QG1CS9Nr3nnt1w/IrX/rejhYgv32Q1HxotkhuJZI9D99TQCSLy4EWNissIyn+e3od9oAavr5O0tU6VoaXeU9Ac9Ty0iDpAE/roas6Vi15rUTySZD3IQ58MV0tMi7P4Ht/qOW73klrXZIu5C16Gn3h00Vpjs60xaMlipbh4j9FixCSPlxchmQgFPYg8h/qtZncsAd57gudx+4KmBN3jLvinvepSpKuN0qQDwJvx2UiQq+iFHEurbx830ot3/l+WpuLpcXKw2lWI5xOBiR21dd9QET+AZeZQugF1T7EleGy6bptmmxFZY0Kq1F9jDhqY/2Y3afTARpypn58DGWFaoKcL+ovR6QeF09Np4oWSsdAynBlEJLdijYcvFnpKbr2/XcrQPq3u1QT1S6aIER/hbIAlxmWHqTQB+JwLoPEpfw3IV0jih0oLyLaiZYWjBaxLtdRB9RK01lEYpThCGOBSYgbg5ROQ2kRQiiChgOVUygWQP5NpXATbU2bSyN6ejp2bU/zbsaA1mT6knNEZQnoe5HsRFBIj1sBkYBqjLg4vZmlw67GfdnRUmqVA2hIEElQdYjL4uI0JQnFPSArVZJbaLv1qSOO0embdJ0JoyilgzDlurHk5O0CV6FhLi4eDRHpMpuBdFFpJf2PtRwnGBxSuk1u6Z+IA0PKodiB8Iji7sGH+9i0bPvBwFh52u/jM6gaHTAG36920QRwF4jqxeBmo6EWmIBQCWRBnRX+EyomClpAZT/CLkQ2AE9q4BG8/IIXbvnvQ1v1YyT0FiBD5TvVRzAvHHPUpbu7kjJXjg8RklgrctzGwwtRuUcKvWi2k3StrqNUTriTe5LWnKSuQb50PcTQuO/2mWHgPtUzOpn7XcxUD97Pz7xMp+dIlDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wx5uT5/7gi53TsI3ivAAAAAElFTkSuQmCC";
const CATS=[{id:"all",k:"all",i:"📦"},{id:"chocolate",k:"chocolate",i:"🍫"},{id:"biscuits",k:"biscuits",i:"🍪"},{id:"cake",k:"cake",i:"🧁"},{id:"candy",k:"candy",i:"🍬"},{id:"snacks",k:"snacks",i:"🍿"},{id:"nuts",k:"nuts",i:"🥜"},{id:"soda",k:"soda",i:"🥤"},{id:"juice",k:"juice",i:"🧃"},{id:"energy",k:"energy",i:"⚡"},{id:"water",k:"water",i:"💧"},{id:"coffee",k:"coffee",i:"☕"},{id:"dairy",k:"dairy",i:"🥛"},{id:"meat",k:"meat",i:"🥩"},{id:"food",k:"food",i:"🫙"},{id:"frozen",k:"frozen",i:"🧊"},{id:"breakfast",k:"breakfast",i:"🥣"},{id:"baby",k:"baby",i:"👶"},{id:"personal",k:"personal",i:"🧴"},{id:"household",k:"household",i:"🧹"},{id:"cigarettes",k:"cigs",i:"🚬"},{id:"electronics",k:"electronics",i:"📱"}];

const TAX=0,fm=n=>n.toFixed(3)+" JD",fN=n=>n.toFixed(3);
const gI=()=>"T"+Date.now().toString(36).toUpperCase(),gR=()=>"R"+Math.floor(1e5+Math.random()*9e5);
const CC=["#2563eb","#f97316","#10b981","#8b5cf6","#ef4444","#06b6d4","#eab308"];
// Chart data is now computed from real transactions (see useMemo below)

export default function POS(){
const[lang,setLang]=useState("en");
const[loggedIn,setLI]=useState(false);const[cu,setCU]=useState(null);
const[lu,setLU]=useState("");const[lp,setLP]=useState("");const[le,setLE]=useState(false);
const[tab,setTab]=useState("sale");const[atab,setAT]=useState("inventory");
// Bulk Supplier Assignment state
const[bulkSelected,setBulkSelected]=useState(new Set());
const[bulkSearch,setBulkSearch]=useState("");
const[bulkCatFilter,setBulkCatFilter]=useState("all");
const[bulkSupplierMod,setBulkSupplierMod]=useState(false);
const[chosenSupplier,setChosenSupplier]=useState("");
const[showSuggestions,setShowSuggestions]=useState(false);
const[suggestions,setSuggestions]=useState({});
// Category Manager state
const[catMgrSearch,setCatMgrSearch]=useState("");
const[catMergeMod,setCatMergeMod]=useState(false);
const[catMergeFrom,setCatMergeFrom]=useState([]);
const[catMergeTo,setCatMergeTo]=useState({en:"",ar:"",emoji:"📦",parent:""});
const[catEditMod,setCatEditMod]=useState(null);
const[catNewMod,setCatNewMod]=useState(false);
const[newCatData,setNewCatData]=useState({en:"",ar:"",emoji:"📦",parent:""});
const[catAutoSuggMod,setCatAutoSuggMod]=useState(false);
const[catSuggestions,setCatSuggestions]=useState([]);
const[catSuggApprove,setCatSuggApprove]=useState(new Set());
// Smart Audit state
const[auditFilter,setAuditFilter]=useState("all"); // all, critical, warning, info
const[auditFixMod,setAuditFixMod]=useState(null);
const[auditLog,setAuditLog]=useState([]);
const[showAuditLog,setShowAuditLog]=useState(false);
const[bulkEditMod,setBulkEditMod]=useState(false);
const[bulkEditSel,setBulkEditSel]=useState(new Set());
const[bulkEditMode,setBulkEditMode]=useState("price_pct"); // price_pct, price_fixed, cost_pct, cost_fixed, margin_pct
const[bulkEditValue,setBulkEditValue]=useState("");
// Linked Products state
const[linkMod,setLinkMod]=useState(null); // {product, parentId, qty}
// Pack Manager state
const[packMgrSearch,setPackMgrSearch]=useState("");
const[newPackMod,setNewPackMod]=useState(false);
const[newPack,setNewPack]=useState({parentId:"",packBc:"",packName:"",packSize:"",packPrice:""});
// Reconciliation & Closing
const[reconMod,setReconMod]=useState(false);
const[reconActualCash,setReconActualCash]=useState("");
const[reconNotes,setReconNotes]=useState("");
const[closingReports,setClosingReports]=useState([]);
const[gapsList,setGapsList]=useState([]);
const[voidMod,setVoidMod]=useState(null); // {tx, reason}
const[voidReason,setVoidReason]=useState("");
// Quick Product Search + Product Card
const[quickSearchMod,setQuickSearchMod]=useState(false);
const[quickSearchInput,setQuickSearchInput]=useState("");
const[selectedProdCard,setSelectedProdCard]=useState(null); // product being viewed
const[printLabelQty,setPrintLabelQty]=useState(10);
// QA: Lock to prevent double-submit on payment
const[processing,setProcessing]=useState(false);
const[search,setSearch]=useState("");const[cat,setCat]=useState("all");
const[cart,setCart]=useState([]);const[disc,setDisc]=useState("");const[aDisc,setAD]=useState(0);
const[held,setHeld]=useState([]);const[txns,setTxns]=useState([]);
const[pmMod,setPM]=useState(null);const[rcMod,setRM]=useState(null);const[bcMod,setBM]=useState(false);const[camScan,setCamScan]=useState(false);
const[paperSize,setPaperSize]=useState("80mm");
const camRef=useRef(null);
const[cTend,setCT]=useState("");const[prods,setProds]=useState([]);const[users,setUsers]=useState([]);
const[eProd,setEP]=useState(null);const[ePr,setEPr]=useState("");const[eSt,setESt]=useState("");const[eExp,setEExp]=useState("");const[eCost,setECost]=useState("");const[eSup,setESup]=useState("");
// Advanced product editor (admin only - edit name & barcode)
const[editProdMod,setEditProdMod]=useState(null); // product being edited
const[editProdBc,setEditProdBc]=useState("");
const[editProdN,setEditProdN]=useState("");
const[editProdA,setEditProdA]=useState("");
const[toast,setToast]=useState(null);
const[voiceOn,setVoiceOn]=useState(false);
const speak=(text)=>{if(!voiceOn||typeof window==="undefined"||!window.speechSynthesis)return;try{const u=new SpeechSynthesisUtterance(text);u.lang="ar-SA";u.rate=1;window.speechSynthesis.speak(u)}catch(e){}};const[pwMod,setPWM]=useState(null);const[nPW,setNPW]=useState("");
const[auMod,setAUM]=useState(false);const[nU,setNU]=useState({un:"",fn:"",fa:"",role:"cashier",pw:""});
const[apMod,setAPM]=useState(false);const[nP,setNP]=useState({bc:"",n:"",a:"",p:"",c:"",cat:"food",u:"pc",e:"📦",exp:"",img:null,supplier:"",initQty:"",batches:[],isPackage:false,parentBarcode:"",packSize:"",individualPrice:""});
const[invCamScan,setInvCamScan]=useState(false);const invCamRef=useRef(null);
const[bcLookup,setBcLookup]=useState(false);
// Barcode lookup — checks LOCAL CATALOG first (23K+ items), then Open Food Facts
const lookupBarcode=async(code)=>{
  if(!code||code.length<4)return;
  setBcLookup(true);sT("🔍 "+(rtl?"جاري البحث...":"Searching..."),"ok");
  try{
    // 1. Check local product_catalog table first
    const{data:catItem}=await sb.from("product_catalog").select("*").eq("barcode",code).single();
    if(catItem){
      setNP(prev=>({...prev,
        n:catItem.name||prev.n,
        a:catItem.name_ar||prev.a,
        cat:catItem.category||prev.cat,
        p:catItem.price||prev.p,
        c:catItem.cost||prev.c,
        e:catItem.emoji||prev.e
      }));
      sT("✓ "+(rtl?"تم العثور في الكتالوج":"Found in catalog")+": "+catItem.name_ar,"ok");
      setBcLookup(false);
      return;
    }
  }catch{}
  // 2. Fallback: Open Food Facts API
  try{
    const res=await fetch("https://world.openfoodfacts.org/api/v2/product/"+code+".json");
    const data=await res.json();
    if(data.status===1&&data.product){
      const p=data.product;
      const name=p.product_name||p.product_name_en||"";
      const nameAr=p.product_name_ar||"";
      const brand=p.brands||"";
      const qty=p.quantity||"";
      const fullName=brand?(name+" "+qty).trim()+" ("+brand+")":name;
      const cats=p.categories_tags||[];
      let cat="food";
      if(cats.some(c=>c.includes("chocolate")))cat="chocolate";
      else if(cats.some(c=>c.includes("biscuit")||c.includes("wafer")))cat="biscuits";
      else if(cats.some(c=>c.includes("cake")||c.includes("pastry")))cat="cake";
      else if(cats.some(c=>c.includes("candy")||c.includes("sweet")||c.includes("gum")))cat="candy";
      else if(cats.some(c=>c.includes("chip")||c.includes("snack")||c.includes("crisp")))cat="snacks";
      else if(cats.some(c=>c.includes("nut")||c.includes("seed")))cat="nuts";
      else if(cats.some(c=>c.includes("soda")||c.includes("carbonat")))cat="soda";
      else if(cats.some(c=>c.includes("juice")||c.includes("drink")||c.includes("beverage")))cat="juice";
      else if(cats.some(c=>c.includes("energy")))cat="energy";
      else if(cats.some(c=>c.includes("water")))cat="water";
      else if(cats.some(c=>c.includes("coffee")||c.includes("tea")))cat="coffee";
      else if(cats.some(c=>c.includes("milk")||c.includes("dairy")||c.includes("cheese")||c.includes("yogurt")))cat="dairy";
      else if(cats.some(c=>c.includes("meat")||c.includes("chicken")||c.includes("sausage")))cat="meat";
      else if(cats.some(c=>c.includes("frozen")||c.includes("ice cream")))cat="frozen";
      else if(cats.some(c=>c.includes("cereal")||c.includes("breakfast")))cat="breakfast";
      else if(cats.some(c=>c.includes("baby")))cat="baby";
      else if(cats.some(c=>c.includes("care")||c.includes("hygiene")||c.includes("soap")||c.includes("shampoo")))cat="personal";
      else if(cats.some(c=>c.includes("clean")||c.includes("house")||c.includes("tissue")))cat="household";
      let img=null;
      if(p.image_front_small_url){try{const ir=await fetch(p.image_front_small_url);const ib=await ir.blob();img=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(ib)})}catch{}}
      setNP(prev=>({...prev,n:fullName||prev.n,a:nameAr||prev.a,cat,e:"📦",img:img||prev.img}));
      sT("✓ "+(rtl?"تم العثور على المنتج":"Product found")+": "+fullName,"ok");
    }else{sT("⚠ "+(rtl?"المنتج غير موجود — أدخل البيانات يدوياً":"Not found — enter details manually"),"err")}
  }catch(e){console.error(e);sT("✗ "+(rtl?"خطأ في البحث":"Lookup error"),"err")}
  setBcLookup(false);
};
const[invs,setInvs]=useState([]);const[invMod,setInvMod]=useState(false);const[invView,setInvView]=useState(null);
const[invViewAttachments,setInvViewAttachments]=useState([]); // Attachments for current invView
const[invViewAttachLoading,setInvViewAttachLoading]=useState(false);
const[invAttachLightbox,setInvAttachLightbox]=useState(null); // {src, name} for full-screen view
const[invSup,setInvSup]=useState("");const[invNo,setInvNo]=useState("");
const[invItems,setInvItems]=useState([{prodId:"",qty:"",cost:""}]);
// NEW: Redesigned invoice form - category-grouped rows
const[invRows,setInvRows]=useState([{cat:"",bc:"",prodId:"",name:"",qty:"",cost:"",price:"",expDates:[""],isNew:false}]);
// OCR state (multi-page support)
const[ocrMod,setOcrMod]=useState(false);
const[ocrPages,setOcrPages]=useState([]); // [{id, file, preview, ocrText, rows, processed}]
// Stocktake state
const[stocktakeSessions,setStocktakeSessions]=useState([]);
const[activeStocktake,setActiveStocktake]=useState(null); // Current session
const[stocktakeItems,setStocktakeItems]=useState([]); // Items in current session
const[stocktakeMode,setStocktakeMode]=useState(false); // Full-screen mode
const[stocktakeScanBc,setStocktakeScanBc]=useState("");
const[stocktakeCurrentProd,setStocktakeCurrentProd]=useState(null); // {product, step}
const[stocktakeStep,setStocktakeStep]=useState("scan"); // scan, exists, qty_correct, qty_input, expiry_correct, expiry_input, save
const[stocktakeActualQty,setStocktakeActualQty]=useState("");
const[stocktakeVarianceReason,setStocktakeVarianceReason]=useState("");
const[stocktakeNewExpiries,setStocktakeNewExpiries]=useState([""]);
const[stocktakeUnregPrompt,setStocktakeUnregPrompt]=useState(false);
const[stocktakeSessionDetail,setStocktakeSessionDetail]=useState(null); // for admin view
const[ocrProcessing,setOcrProcessing]=useState(false);
const[ocrProgress,setOcrProgress]=useState(0);
const[ocrCurrentPage,setOcrCurrentPage]=useState(0);
const[ocrExtractedRows,setOcrExtractedRows]=useState([]); // merged from all pages
// Reconciliation invoice state
const[invIsReconciliation,setInvIsReconciliation]=useState(false);
const[reconReportMod,setReconReportMod]=useState(null); // {invoice, comparisons}
const[reconDecisions,setReconDecisions]=useState({}); // {rowIndex: "keep_current" | "match_invoice"}
const[newProdMod,setNewProdMod]=useState(null); // {rowIndex, barcode}
const[newProdData,setNewProdData]=useState({bc:"",n:"",a:"",cat:"",u:"pc",e:"📦"});
// Inventory view mode: "table" (default) or "category" (grouped with inline edit)
const[invViewMode,setInvViewMode]=useState("table");
const[invExpandedCats,setInvExpandedCats]=useState(new Set());
const[invPayMethod,setInvPayMethod]=useState("bank");const[invBankAcct,setInvBankAcct]=useState("");const[invAttachment,setInvAttachment]=useState(null);const[invAttName,setInvAttName]=useState("");
const[loading,setLoading]=useState(true);const[dbOk,setDbOk]=useState(false);
// Loyalty
const[customers,setCustomers]=useState([]);const[selCust,setSelCust]=useState(null);
const[custMod,setCustMod]=useState(false);const[custPhone,setCustPhone]=useState("");const[custSearch,setCustSearch]=useState(null);
const[custLoading,setCustLoading]=useState(false);const[newCustMod,setNewCustMod]=useState(false);
const[newCust,setNewCust]=useState({phone:"",name:"",nameAr:""});
const[redeemPts,setRedeemPts]=useState(0);const[custViewMod,setCustViewMod]=useState(null);const[custHistory,setCustHistory]=useState([]);
// Promotions & Coupons
const[promotions,setPromotions]=useState([]);const[promoMod,setPromoMod]=useState(false);
const[coupons,setCoupons]=useState([]);const[couponMod,setCouponMod]=useState(false);
const[loyaltyTab,setLoyaltyTab]=useState("customers");const[couponQR,setCouponQR]=useState(null);
const[appliedCoupon,setAppliedCoupon]=useState(null);const[couponInput,setCouponInput]=useState("");
const genCode=()=>"3045-"+Math.random().toString(36).substring(2,8).toUpperCase();
const[custPhoneInput,setCustPhoneInput]=useState("");
// Sales view
const[salesSearch,setSalesSearch]=useState("");const[salesMethod,setSalesMethod]=useState("all");const[salesSort,setSalesSort]=useState("newest");const[salesDateFrom,setSalesDateFrom]=useState("");const[salesDateTo,setSalesDateTo]=useState("");
// Advanced sales filters
const[salesTimeFrom,setSalesTimeFrom]=useState(""); // HH:MM
const[salesTimeTo,setSalesTimeTo]=useState("");
const[salesProductFilter,setSalesProductFilter]=useState(""); // product id or barcode
const[salesCategoryFilter,setSalesCategoryFilter]=useState("");
const[salesReceiptFilter,setSalesReceiptFilter]=useState("");
const[salesCashierFilter,setSalesCashierFilter]=useState("");
const[salesCustomerFilter,setSalesCustomerFilter]=useState("");
const[salesAmountMin,setSalesAmountMin]=useState("");
const[salesAmountMax,setSalesAmountMax]=useState("");
const[salesStatusFilter,setSalesStatusFilter]=useState("all"); // all, normal, full_return, partial_return, voided
const[salesGroupBy,setSalesGroupBy]=useState("none"); // none, cashier, category, method, date, hour, customer, product
const[expandedGroups,setExpandedGroups]=useState(new Set()); // groups expanded to show transactions
const[dupBcPicker,setDupBcPicker]=useState(null); // {barcode, products[]} when scan finds multiple matches
const[mergeMod,setMergeMod]=useState(null); // {barcode, products[], targetId, isMerging} for product merge
const[showOnlyDups,setShowOnlyDups]=useState(false); // filter inventory to show only dup products
const[hideUnGroupedTable,setHideUnGroupedTable]=useState(true); // when grouping, hide the main txns table by default
const[salesShowAdvanced,setSalesShowAdvanced]=useState(false);
// User edit modal
const[editUserMod,setEditUserMod]=useState(null);const[editUserData,setEditUserData]=useState(null);
// HR
const[contracts,setContracts]=useState([]);const[salPayments,setSalPayments]=useState([]);
const[leaveReqs,setLeaveReqs]=useState([]);const[attRecords,setAttRecords]=useState([]);
const[myAtt,setMyAtt]=useState(null);const[hrTab,setHrTab]=useState("contracts");
const[weather,setWeather]=useState(null);
const[clockTime,setClockTime]=useState(new Date());
useEffect(()=>{const timer=setInterval(()=>setClockTime(new Date()),1000);return()=>clearInterval(timer)},[]);

// Load attachments when viewing an invoice
useEffect(()=>{
  if(invView && invView.id){
    setInvViewAttachLoading(true);
    DB.getInvoiceAttachments(invView.id).then(atts => {
      setInvViewAttachments(atts || []);
      setInvViewAttachLoading(false);
    }).catch(e => {
      console.error("Attachments load:",e);
      setInvViewAttachments([]);
      setInvViewAttachLoading(false);
    });
  } else {
    setInvViewAttachments([]);
  }
},[invView?.id]);
// Store settings & bonus
const[storeSettings,setStoreSettings]=useState({storeName:"3045 Supermarket",taxRate:0,currency:"JD",dailyTarget:500,weeklyTarget:3000,monthlyTarget:12000});
const[bonusRules,setBonusRules]=useState({salesPerTxn:0.100,salesThreshold:50,salesReward:10,attendanceTarget:26,attendanceReward:15,topSellerReward:25});
const[bonusMod,setBonusMod]=useState(false);const[bonusEditRules,setBonusEditRules]=useState(false);
const[newBonus,setNewBonus]=useState({user_id:"",amount:"",reason:"",type:"custom"});
// Expiring products
const today2=new Date();today2.setHours(0,0,0,0);
const expiringProds=useMemo(()=>prods.filter(p=>{if(!p.exp||p.s<=0)return false;const d=new Date(p.exp);const diff=Math.ceil((d-today2)/86400000);return diff<=30}).map(p=>{const d=new Date(p.exp);const diff=Math.ceil((d-today2)/86400000);return{...p,daysLeft:diff}}).sort((a,b)=>a.daysLeft-b.daysLeft),[prods]);
const[contractMod,setContractMod]=useState(false);const[salaryMod,setSalaryMod]=useState(false);const[leaveMod,setLeaveMod]=useState(false);
const[newContract,setNewContract]=useState({user_id:"",contract_type:"full-time",start_date:"",end_date:"",basic_salary:"",housing_allowance:"",transport_allowance:"",other_allowance:"",working_hours_per_day:8,working_days_per_week:6,annual_leave_days:21,notes:""});
const[newSalary,setNewSalary]=useState({user_id:"",month:"",year:new Date().getFullYear(),basic_salary:"",allowances:"",deductions:"",overtime_hours:"",bonus:"",payment_method:"bank",notes:""});
const[newLeave,setNewLeave]=useState({user_id:"",leave_type:"annual",start_date:"",end_date:"",reason:""});
// Finance
const[expCats,setExpCats]=useState([]);const[expensesList,setExpensesList]=useState([]);
const[bankAccts,setBankAccts]=useState([]);const[movements,setMovements]=useState([]);
const[finTab,setFinTab]=useState("overview");const[expMod,setExpMod]=useState(false);const[movMod,setMovMod]=useState(false);
// Cash Shifts & EOD
const[cashShifts,setCashShifts]=useState([]);const[shiftMod,setShiftMod]=useState(false);const[activeShift,setActiveShift]=useState(null);
const[closeShiftMod,setCloseShiftMod]=useState(false);const[shiftCashCount,setShiftCashCount]=useState("");
// Cashier features state
const[cashOps,setCashOps]=useState([]);const[stockSearch,setStockSearch]=useState("");
const[eodReports,setEODReports]=useState([]);const[eodViewMod,setEODViewMod]=useState(null);
const[prodProfitability,setProdProfitability]=useState([]);
// Enterprise Inventory
const[batches,setBatches]=useState([]);const[batchMod,setBatchMod]=useState(false);const[batchProdId,setBatchProdId]=useState(null);
const[packages,setPackages]=useState({});
const[miscMod,setMiscMod]=useState(false);const[miscItem,setMiscItem]=useState({name:"",price:"",qty:"1",mode:"qty"});
const[invSearch,setInvSearch]=useState("");const[invSupFilter,setInvSupFilter]=useState("");const[invSortKey,setInvSortKey]=useState("");const[invSortDir,setInvSortDir]=useState("asc");
const[prEdits,setPrEdits]=useState({});const[prFilter,setPrFilter]=useState("all");const[prSearch,setPrSearch]=useState("");
const[venProdMod,setVenProdMod]=useState(null);const[venProdSearch,setVenProdSearch]=useState("");const[venProdSort,setVenProdSort]=useState({k:"",d:"asc"});const[venProdEdits,setVenProdEdits]=useState({});
const sortInv=(key)=>{if(invSortKey===key){setInvSortDir(d=>d==="asc"?"desc":"asc")}else{setInvSortKey(key);setInvSortDir("asc")}};
const sortIcon=(key)=>invSortKey===key?(invSortDir==="asc"?" ▲":" ▼"):"";
const[setupMod,setSetupMod]=useState(false);const[setupStep,setSetupStep]=useState(1);const[setupData,setSetupData]=useState({storeName:"",address:"إربد، شارع المدينة المنورة - مقابل SOS",phone:"0791191244",taxRate:"0",dailyTarget:"500",cashBalance:"100",pettyCash:"50",bankBalance:"0",adminPwd:"",wipeTest:true});
const[suppliers,setSuppliers]=useState([]);
const[customCats,setCustomCats]=useState([]);
const CATS_ALL=[...CATS,...customCats.map(c=>({id:c.id,k:c.id,i:c.emoji||"📁"}))];
const[newBatch,setNewBatch]=useState({product_id:"",batch_number:"",supplier_name:"",received_date:new Date().toISOString().slice(0,10),expiry_date:"",quantity_received:"",cost_per_unit:"",notes:""});
const[salesReturns,setSalesReturns]=useState([]);const[salesReturnMod,setSalesReturnMod]=useState(false);
const[purchaseReturns,setPurchaseReturns]=useState([]);const[purchaseReturnMod,setPurchaseReturnMod]=useState(false);
const[deadStock,setDeadStock]=useState([]);const[expiringBatches,setExpiringBatches]=useState([]);
const[invSubTab,setInvSubTab]=useState("products");
const[returnItems,setReturnItems]=useState([]);const[returnTxn,setReturnTxn]=useState(null);
const[newExp,setNewExp]=useState({category_id:"",amount:"",description:"",payment_method:"cash",expense_date:new Date().toISOString().slice(0,10),recurring:"none",reference_no:"",debit_account:"",attachment:null});
const[newMov,setNewMov]=useState({account_id:"",type:"deposit",amount:"",description:"",reference_no:"",to_account_id:""});
// Documents
const[documents,setDocuments]=useState([]);
const[docMod,setDocMod]=useState(false);const[newDoc,setNewDoc]=useState({title:"",type:"other",description:"",date:new Date().toISOString().slice(0,10),file:null,fileName:""});
const[viewDocMod,setViewDocMod]=useState(null);
const saveDocuments=(docs)=>{setDocuments(docs);DB.setSetting("documents",docs)};
// Store settings
const bcRef=useRef(null),bcB=useRef(""),bcTm=useRef(null);
const t=T[lang],rtl=lang==="ar",pN=p=>rtl?p.a:p.n;
const hasP=key=>cu&&(cu.role==="admin"||cu.perms?.[key]===true);

// ── SMART ANALYTICS ENGINE ──
const analytics=useMemo(()=>{
if(!prods.length)return null;
const now=new Date();const msDay=86400000;

// ── Daily sales map (last 90 days) ──
const dailyMap={};
txns.forEach(tx=>{try{const d=new Date(tx.ts).toISOString().slice(0,10);dailyMap[d]=(dailyMap[d]||0)+tx.tot}catch{}});
const last30=[];const last7=[];
for(let i=0;i<90;i++){const d=new Date(now-i*msDay).toISOString().slice(0,10);if(i<30)last30.push(dailyMap[d]||0);if(i<7)last7.push(dailyMap[d]||0)}

// ── Product-level analytics ──
const prodStats=prods.map(p=>{
  const itemSales=txns.flatMap(tx=>tx.items.filter(i=>i.id===p.id).map(i=>({qty:i.qty,date:tx.ts,tot:i.p*i.qty})));
  const last30Sales=itemSales.filter(s=>{try{return(now-new Date(s.date))/msDay<=30}catch{return false}});
  const totalQty30=last30Sales.reduce((s,x)=>s+x.qty,0);
  const avgDailySales=totalQty30/30;
  const daysRemaining=avgDailySales>0?Math.floor(p.s/avgDailySales):999;
  const totalRevenue=itemSales.reduce((s,x)=>s+x.tot,0);
  const unitMargin=p.p-p.c;const marginPct=p.p>0?((p.p-p.c)/p.p*100):0;
  
  // Trend (last 7 vs prev 7)
  const last7Sales=itemSales.filter(s=>{try{const d=(now-new Date(s.date))/msDay;return d<=7}catch{return false}}).reduce((s,x)=>s+x.qty,0);
  const prev7Sales=itemSales.filter(s=>{try{const d=(now-new Date(s.date))/msDay;return d>7&&d<=14}catch{return false}}).reduce((s,x)=>s+x.qty,0);
  const trend=prev7Sales>0?((last7Sales-prev7Sales)/prev7Sales*100):0;

  // Reorder suggestion
  const leadDays=3; // assume 3 day lead time
  const safetyStock=Math.ceil(avgDailySales*2);
  const reorderPoint=Math.ceil(avgDailySales*leadDays)+safetyStock;
  const suggestedQty=Math.max(0,Math.ceil(avgDailySales*14)-p.s); // 2 weeks supply
  const urgency=p.s<=0?"critical":p.s<=reorderPoint?"high":daysRemaining<=7?"medium":"low";

  return{...p,avgDailySales,daysRemaining,totalRevenue,unitMargin,marginPct,totalQty30,last7Sales,trend,reorderPoint,suggestedQty,urgency,safetyStock};
});

// ── ABC Classification ──
const sortedByRev=[...prodStats].sort((a,b)=>b.totalRevenue-a.totalRevenue);
const totalRev=sortedByRev.reduce((s,p)=>s+p.totalRevenue,0);
let cumRev=0;
sortedByRev.forEach(p=>{cumRev+=p.totalRevenue;const pct=totalRev>0?(cumRev/totalRev*100):0;p.abc=pct<=80?"A":pct<=95?"B":"C"});
const abcMap={};sortedByRev.forEach(p=>{abcMap[p.id]=p.abc});
prodStats.forEach(p=>{p.abc=abcMap[p.id]||"C"});

// ── Sales Forecasting (weighted moving average) ──
const avgDaily=last30.reduce((s,v)=>s+v,0)/30;
const avgWeekly=last7.reduce((s,v)=>s+v,0);
// Weekday pattern weights
const dayWeights={};txns.forEach(tx=>{try{const d=new Date(tx.ts).getDay();dayWeights[d]=(dayWeights[d]||0)+tx.tot}catch{}});
const dayCount={};txns.forEach(tx=>{try{const d=new Date(tx.ts).getDay();dayCount[d]=(dayCount[d]||0)+1}catch{}});
const dayAvg={};for(let i=0;i<7;i++)dayAvg[i]=dayCount[i]?dayWeights[i]/dayCount[i]:avgDaily;
const tmrwDay=(now.getDay()+1)%7;
const forecastTomorrow=dayAvg[tmrwDay]||avgDaily;
const forecastWeek=Object.values(dayAvg).reduce((s,v)=>s+v,0);
const forecastMonth=avgDaily*30;
// Trend adjustment
const recentAvg=last7.reduce((s,v)=>s+v,0)/7;
const olderAvg=last30.slice(7).reduce((s,v)=>s+v,0)/23||avgDaily;
const trendMultiplier=olderAvg>0?(recentAvg/olderAvg):1;

// ── Stock metrics ──
const totalStockValue=prods.reduce((s,p)=>s+p.s*p.c,0);
const totalRetailValue=prods.reduce((s,p)=>s+p.s*p.p,0);
const totalCOGS30=prodStats.reduce((s,p)=>s+p.totalQty30*p.c,0);
const stockTurnover=totalStockValue>0?(totalCOGS30/totalStockValue*12):0; // annualized

// ── Smart Recommendations ──
const actions=[];
prodStats.filter(p=>p.urgency==="critical").forEach(p=>actions.push({icon:"🔴",priority:1,en:"RESTOCK NOW: "+p.n+" — Out of stock",ar:"إعادة تعبئة فوراً: "+p.a+" — نفد المخزون",type:"reorder"}));
prodStats.filter(p=>p.urgency==="high"&&p.s>0).slice(0,5).forEach(p=>actions.push({icon:"🟡",priority:2,en:"Reorder "+p.n+" — "+p.daysRemaining+"d remaining, order "+p.suggestedQty+" units",ar:"اطلب "+p.a+" — "+p.daysRemaining+" يوم متبقي، اطلب "+p.suggestedQty+" وحدة",type:"reorder"}));
prodStats.filter(p=>p.abc==="C"&&p.s>10&&p.totalQty30<3).slice(0,3).forEach(p=>actions.push({icon:"🏷️",priority:3,en:"Discount "+p.n+" — only "+p.totalQty30+" sold in 30d, "+p.s+" in stock",ar:"خصم على "+p.a+" — "+p.totalQty30+" مباع فقط في 30 يوم، "+p.s+" بالمخزون",type:"discount"}));
prodStats.filter(p=>p.daysRemaining>90&&p.s>5).slice(0,2).forEach(p=>actions.push({icon:"💀",priority:4,en:"Remove/discount "+p.n+" — "+p.daysRemaining+"d supply, consider clearance",ar:"إزالة/تخفيض "+p.a+" — مخزون "+p.daysRemaining+" يوم، فكر في تصفية",type:"deadstock"}));
const expSoon=prods.filter(p=>p.exp&&Math.ceil((new Date(p.exp)-now)/msDay)<=7&&Math.ceil((new Date(p.exp)-now)/msDay)>0);
expSoon.slice(0,3).forEach(p=>{const d=Math.ceil((new Date(p.exp)-now)/msDay);actions.push({icon:"⚠️",priority:1,en:"EXPIRING: "+p.n+" in "+d+"d — discount or pull from shelf",ar:"ينتهي: "+p.a+" خلال "+d+" يوم — خصم أو سحب",type:"expiry"})});
actions.sort((a,b)=>a.priority-b.priority);

// ── Hourly pattern ──
const hourly=Array(24).fill(0);const hourCount=Array(24).fill(0);
txns.forEach(tx=>{try{const h=new Date(tx.ts).getHours();hourly[h]+=tx.tot;hourCount[h]++}catch{}});
const peakHour=hourly.indexOf(Math.max(...hourly));

return{prodStats,avgDaily,avgWeekly:avgWeekly||0,forecastTomorrow:+(forecastTomorrow*trendMultiplier).toFixed(3),forecastWeek:+(forecastWeek*trendMultiplier).toFixed(3),forecastMonth:+(forecastMonth*trendMultiplier).toFixed(3),trendMultiplier,stockTurnover:+stockTurnover.toFixed(1),totalStockValue,totalRetailValue,actions,peakHour,abcA:prodStats.filter(p=>p.abc==="A"),abcB:prodStats.filter(p=>p.abc==="B"),abcC:prodStats.filter(p=>p.abc==="C"),dailyMap,last30};
},[prods,txns]);
const PERM_KEYS=[{k:"pos",i:"🛒"},{k:"dashboard",i:"📊"},{k:"inventory",i:"📦"},{k:"purchases",i:"🧾"},{k:"sales_view",i:"📋"},{k:"users",i:"👥"},{k:"loyalty",i:"⭐"},{k:"hr",i:"🏢"},{k:"finance",i:"💰"},{k:"settings",i:"⚙️"},{k:"excel_export",i:"📥"}];
const PERM_LABELS={pos:"permPOS",dashboard:"permDashboard",inventory:"permInventory",purchases:"permPurchases",sales_view:"permSalesView",users:"permUsers",loyalty:"permLoyalty",hr:"hr",finance:"finance",settings:"permSettings",excel_export:"permExport"};

// ── LOAD ALL DATA FROM SUPABASE ──────────────────────────────
useEffect(()=>{
  // Safety net: force loading=false after 30s (only if critical data didn't load)
  const safetyTimeout=setTimeout(()=>{console.warn("⚠ Load timeout — forcing app to continue");setLoading(false)},30000);
  async function load(){
    try{
      console.log("[load] Starting critical data...");
      console.log("[load] Testing getProducts...");
      const testP=await DB.getProducts().catch(e=>{console.error("[getProducts FAILED]",e);throw e});
      console.log("[load] getProducts OK:",testP.length,"products");
      console.log("[load] Testing getUsers...");
      const testU=await DB.getUsers().catch(e=>{console.error("[getUsers FAILED]",e);throw e});
      console.log("[load] getUsers OK:",testU.length,"users");
      setProds(testP);setUsers(testU);setDbOk(true);
      clearTimeout(safetyTimeout);
      setLoading(false);
      console.log("[load] ✅ App ready — loading secondary data in background...");

      // Step 2: Secondary data (loaded in background, doesn't block app)
      try{const[tx,inv,cust]=await Promise.all([DB.getTransactions(),DB.getInvoices(),DB.getCustomers()]);
        const supMap={};inv.forEach(invoice=>{(invoice.items||[]).forEach(it=>{if(it.prodId&&!supMap[it.prodId]&&invoice.supplier)supMap[it.prodId]=invoice.supplier})});
        setProds(prev=>prev.map(pr=>({...pr,supplier:pr.supplier||supMap[pr.id]||""})));
        setTxns(tx);setInvs(inv);setCustomers(cust);
      }catch(e){console.error("[secondary]",e)}
      try{const pkgs=await DB.getSetting("packages",{})||{};setPackages(pkgs)}catch(e){console.error("[pkgs]",e)}
      // Load HR data
      try{const[ct,sp,lv]=await Promise.all([DB.getContracts(),DB.getSalaries(),DB.getLeaves()]);setContracts(ct);setSalPayments(sp);setLeaveReqs(lv);}catch{}
      try{const[ec,ex,ba,mv]=await Promise.all([DB.getExpenseCategories(),DB.getExpenses(),DB.getBankAccounts(),DB.getMoneyMovements()]);setExpCats(ec);setExpensesList(ex);setBankAccts(ba);setMovements(mv);}catch{}
      // Enterprise inventory data
      try{const[bt,sr,pr,ds,eb]=await Promise.all([DB.getAllBatches(),DB.getSalesReturns(),DB.getPurchaseReturns(),DB.getDeadStock(),DB.getExpiringBatches()]);setBatches(bt);setSalesReturns(sr);setPurchaseReturns(pr);setDeadStock(ds);setExpiringBatches(eb);}catch{}
      // Financial controls data
      try{const[sh,eod,pp]=await Promise.all([DB.getShifts(),DB.getEODReports(),DB.getProductProfitability()]);setCashShifts(sh);setEODReports(eod);setProdProfitability(pp);const openS=sh.find(s=>s.status==="open"&&s.user_id===f.id);if(openS){setActiveShift(openS);
        // Show welcome back message for resumed shift
        const startTime=new Date(openS.shift_start);
        const hrs=Math.floor((new Date()-startTime)/3600000);
        const mins=Math.floor(((new Date()-startTime)%3600000)/60000);
        setTimeout(()=>{sT("🟢 "+(rtl?`استئناف وردية مفتوحة — منذ ${hrs}س ${mins}د`:`Resuming open shift — ${hrs}h ${mins}m ago`),"ok")},800);
      }}catch{}
      try{const[pr2,cp]=await Promise.all([DB.getPromotions(),DB.getCoupons()]);setPromotions(pr2);setCoupons(cp)}catch{}
      try{const sks=await DB.getStocktakeSessions();setStocktakeSessions(sks)}catch{}
      // Load all settings from DB
      try{
        const allSettings = await DB.getAllSettings();
        if(allSettings.store_settings) setStoreSettings(allSettings.store_settings);
        if(allSettings.bonus_rules) setBonusRules(allSettings.bonus_rules);
        if(allSettings.paper_size) setPaperSize(allSettings.paper_size);
        if(allSettings.custom_categories) setCustomCats(allSettings.custom_categories);
        if(allSettings.suppliers) setSuppliers(allSettings.suppliers);
        if(allSettings.voice_on !== undefined) setVoiceOn(!!allSettings.voice_on);
        if(allSettings.documents) setDocuments(allSettings.documents);
        if(allSettings.held_orders) setHeld(allSettings.held_orders);
      }catch(e){console.error("Settings load error:",e);}
    }catch(e){console.error("DB load error:",e);setDbOk(false);clearTimeout(safetyTimeout);setLoading(false);}
    console.log("[load] Done, all data loaded");
  }
  load();
},[]);

// Auto-persist held orders to DB whenever they change
useEffect(()=>{
  if(!dbOk||!loggedIn)return;
  const t=setTimeout(()=>{try{DB.setSetting("held_orders",held)}catch(e){console.error("Held save:",e)}},500);
  return()=>clearTimeout(t);
},[held,dbOk,loggedIn]);

// Refresh products periodically (for multi-terminal sync)
useEffect(()=>{
  if(!dbOk||!loggedIn) return;
  const interval=setInterval(async()=>{
    try{const p=await DB.getProducts();setProds(prev=>{const supMap={};prev.forEach(x=>{if(x.supplier)supMap[x.id]=x.supplier});return p.map(pr=>({...pr,supplier:pr.supplier||supMap[pr.id]||""}))});}catch{}
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
      setTxns(tx);setCustomers(cust);setProds(prev=>{const supMap={};prev.forEach(x=>{if(x.supplier)supMap[x.id]=x.supplier});return p.map(pr=>({...pr,supplier:pr.supplier||supMap[pr.id]||""}))});setLastRefresh(new Date());
    }catch{}
  };
  const iv=setInterval(poll,15000);
  return ()=>clearInterval(iv);
},[dbOk,loggedIn]);

// Barcode scanner — moved below addToCart definition

const sT=(m,ty)=>{setToast({m,ty});setTimeout(()=>setToast(null),2200)};
const[posPage,setPosPage]=useState(0);const POS_PAGE_SIZE=60;
useEffect(()=>setPosPage(0),[cat,search]);
const fp=useMemo(()=>prods.filter(p=>(cat==="all"||p.cat===cat)&&(!search||p.n.toLowerCase().includes(search.toLowerCase())||p.a.includes(search)||p.bc.includes(search))),[search,cat,prods]);
const fpVisible=useMemo(()=>fp.slice(0,(posPage+1)*POS_PAGE_SIZE),[fp,posPage]);
const sub=cart.reduce((s,i)=>s+i.p*i.qty,0),dA=aDisc>0?sub*(aDisc/100):0,taxable=sub-dA,tax=taxable*(storeSettings.taxRate/100),tot=taxable+tax,cCnt=cart.reduce((s,i)=>s+i.qty,0);
// Beep sound using Web Audio API (no external file)
const beep=useCallback(()=>{try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=1200;o.type="sine";g.gain.value=0.15;o.start();o.stop(ctx.currentTime+0.08);setTimeout(()=>ctx.close(),200)}catch{}},[]);
// Re-fetch items for a transaction if missing/empty
const openReceiptWithItems=useCallback(async(tx)=>{
  if(tx&&(!tx.items||tx.items.length===0)){
    try{
      const{data:items}=await sb.from("transaction_items").select("*").eq("transaction_id",tx.id).limit(5000);
      if(items&&items.length>0){
        const fixed={...tx,items:items.map(i=>({id:i.product_id||"misc_"+i.id,n:i.product_name||"—",a:i.product_name_ar||i.product_name||"—",bc:i.barcode||"MISC",p:+i.unit_price,qty:i.quantity,_isMisc:!i.product_id}))};
        setRM(fixed);
        // Also update the txns array
        setTxns(prev=>prev.map(x=>x.id===tx.id?fixed:x));
        return;
      }
    }catch(e){console.error("Refetch items:",e)}
  }
  setRM(tx);
},[]);

// Auto-refetch items if receipt modal opens with empty items (safety net)
useEffect(()=>{
  if(rcMod&&(!rcMod.items||rcMod.items.length===0)){
    (async()=>{
      try{
        const{data:items}=await sb.from("transaction_items").select("*").eq("transaction_id",rcMod.id).limit(5000);
        if(items&&items.length>0){
          const fixed={...rcMod,items:items.map(i=>({id:i.product_id||"misc_"+i.id,n:i.product_name||"—",a:i.product_name_ar||i.product_name||"—",bc:i.barcode||"MISC",p:+i.unit_price,qty:i.quantity,_isMisc:!i.product_id}))};
          setRM(fixed);
          setTxns(prev=>prev.map(x=>x.id===rcMod.id?fixed:x));
        }
      }catch(e){console.error("Auto-refetch:",e)}
    })();
  }
},[rcMod?.id]);

const addToCart=useCallback(p=>{
// Check if expired before adding
if(p.exp){try{const expDate=new Date(p.exp);const today3=new Date();today3.setHours(0,0,0,0);if(expDate<today3){if(!confirm((rtl?"⛔ منتهي الصلاحية!\n":"⛔ EXPIRED!\n")+pN(p)+"\n"+(rtl?"تاريخ الانتهاء: ":"Expired on: ")+p.exp+"\n\n"+(rtl?"هل أنت متأكد من البيع؟":"Are you sure you want to sell?"))){sT("✗ "+(rtl?"تم إلغاء البيع":"Sale cancelled"),"err");return}}}catch(e){}}
// Weight product: prompt for weight
if(p.u==="kg"||p.u==="g"){
  const w=prompt((rtl?"⚖ أدخل الوزن (كغ) لـ ":"⚖ Enter weight (kg) for ")+pN(p)+"\n"+(rtl?"سعر الكيلو: ":"Price per kg: ")+p.p+" JD","1");
  if(!w)return;
  const wt=parseFloat(w);
  if(isNaN(wt)||wt<=0){sT("✗ "+(rtl?"وزن غير صالح":"Invalid weight"),"err");return}
  beep();speak((p.a||p.n)+" "+wt+" kg");
  const newItem={...p,id:p.id+"_w"+Date.now(),qty:1,p:+(p.p*wt).toFixed(3),_weight:wt,_origPrice:p.p,_addedAt:Date.now()};
  setCart(prev=>[newItem,...prev]);  // ← TOP
  sT("⚖ "+pN(p)+" — "+wt+" kg = "+(p.p*wt).toFixed(3)+" JD","ok");
  return;
}
beep();speak(p.a||p.n);
// Expiry warning for batches
try{const pBatches=batches.filter(b=>b.product_id===p.id&&b.status==="active"&&b.quantity_remaining>0);if(pBatches.length>0){const nearest=pBatches.sort((a,b)=>new Date(a.expiry_date)-new Date(b.expiry_date))[0];if(nearest&&nearest.expiry_date){const dLeft=Math.ceil((new Date(nearest.expiry_date)-new Date())/86400000);if(dLeft<=7&&dLeft>0)sT("⚠️ "+(rtl?"قارب على الانتهاء — ":"Near expiry — ")+dLeft+(rtl?" أيام":" days left"),"err")}}}catch(e){}
// Add to cart — latest on TOP, move existing to top
// Updater is PURE: reads fresh state from prev, no external closures
setCart(prev=>{
  const ex=prev.find(i=>i.id===p.id);
  if(ex){
    const updated={...ex,qty:ex.qty+1,_addedAt:Date.now()};
    return [updated,...prev.filter(i=>i.id!==p.id)];
  }
  return [{...p,qty:1,_addedAt:Date.now()},...prev];
})},[beep,voiceOn,batches,rtl]);
const uQ=useCallback((id,d)=>setCart(prev=>prev.map(i=>{if(i.id!==id)return i;const n=i.qty+d;return n>0?{...i,qty:n}:null}).filter(Boolean)),[]);
const rI=useCallback(id=>{
  // FIX #9: Confirm before removing item from cart
  setCart(prev=>{
    const item=prev.find(i=>i.id===id);
    if(!item) return prev;
    const itemName=item.a||item.n;
    if(!confirm((rtl?"حذف من السلة؟\n":"Remove from cart?\n")+itemName+" × "+item.qty)) return prev;
    return prev.filter(i=>i.id!==id);
  });
},[rtl]);
const clr=useCallback(()=>{
  // FIX #14: Log cart cancellation if had items (helps detect suspicious behavior)
  if(cart.length>0&&cu){
    const total=cart.reduce((s,i)=>s+i.p*i.qty,0);
    DB.addAuditLog({user_id:cu.id,user_name:cu.fn,action:"clear_cart",entity_type:"cart",entity_id:"",field_name:"items",old_value:String(cart.length)+" items",new_value:"0",notes:"Cart cleared - total was "+total.toFixed(3)}).catch(()=>{});
  }
  setCart([]);setAD(0);setDisc("");setSelCust(null);setRedeemPts(0);setCustPhoneInput("");setAppliedCoupon(null);setCouponInput("");
},[cart,cu]);

// Barcode scanner — MUST be after addToCart definition
// FIX: Uses capture phase to intercept Enter BEFORE focused buttons receive it.
// When scanner emits characters fast (< 200ms gaps), we treat it as a scan stream
// and prevent Enter from activating any focused button (e.g. +/- qty buttons).
useEffect(()=>{
  if(!loggedIn) return;
  const h = e => {
    const tg = e.target.tagName;
    if(tg==="INPUT"||tg==="TEXTAREA"||tg==="SELECT") return;
    if(pmMod||rcMod) return;
    
    if(e.key==="Enter"){
      const c = bcB.current.trim();
      
      // CRITICAL FIX: If buffer has content (scan in progress), 
      // prevent default to stop focused buttons from activating
      if(c.length >= 4){
        e.preventDefault();
        e.stopPropagation();
        // Also blur any focused element to prevent future accidents
        if(document.activeElement && document.activeElement.blur){
          try{document.activeElement.blur()}catch{}
        }
      }
      
      bcB.current = "";
      if(c.length >= 4){
        const matches = prods.filter(x=>x.bc===c);
        if(matches.length === 0){sT("✗ "+t.notFound,"err");}
        else if(matches.length === 1){addToCart(matches[0]);sT("✓ "+pN(matches[0])+" "+t.added,"ok");}
        else {setDupBcPicker({barcode:c,products:matches});}
      }
      return;
    }
    
    if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey){
      // If buffer is empty and we're adding first char, check if focus is on a button
      // that could trigger on Enter — blur it proactively to be safe
      if(bcB.current.length === 0){
        const ae = document.activeElement;
        if(ae && (ae.tagName === "BUTTON" || ae.getAttribute("role") === "button")){
          try{ae.blur()}catch{}
        }
      }
      bcB.current += e.key;
      clearTimeout(bcTm.current);
      bcTm.current = setTimeout(()=>{bcB.current=""},200);
    }
  };
  // Use capture phase (true) to intercept before buttons handle it
  window.addEventListener("keydown", h, true);
  return () => window.removeEventListener("keydown", h, true);
},[loggedIn,prods,pmMod,rcMod,lang,addToCart]);


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
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // QA HARDENED PAYMENT FUNCTION
  // Order: Validate → Lock → Save to DB → Update UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // FIX #6: Lock to prevent double-submit
  if(processing){console.warn("[PAY] Already processing, ignoring duplicate click");return}
  
  // FIX #7: Validate tax rate
  const taxRate=parseFloat(storeSettings.taxRate);
  if(isNaN(taxRate)||taxRate<0){alert((rtl?"⚠️ معدل الضريبة غير صالح في الإعدادات. القيمة الحالية: ":"⚠️ Tax rate invalid in settings. Current: ")+storeSettings.taxRate);return}
  
  // FIX #4: Validate cash amount
  const finalTot=selCust&&redeemPts>0?totAfterRedeem:tot;
  if(pmMod==="cash"){
    const tendered=parseFloat(cTend);
    if(isNaN(tendered)){alert(rtl?"⚠️ أدخل المبلغ المستلم":"⚠️ Enter cash amount received");return}
    if(tendered<finalTot){alert((rtl?"⚠️ المبلغ المستلم أقل من الإجمالي!\nالإجمالي: ":"⚠️ Cash less than total!\nTotal: ")+finalTot.toFixed(3)+(rtl?"\nالمستلم: ":"\nReceived: ")+tendered.toFixed(3));return}
  }
  if(!cart||cart.length===0){alert(rtl?"⚠️ السلة فارغة":"⚠️ Cart is empty");return}
  
  // FIX #6: ENGAGE LOCK
  setProcessing(true);
  
  // FIX #10: Deep copy cart to prevent mutation during async
  const cartSnapshot=JSON.parse(JSON.stringify(cart));
  const now=new Date();
  const tx={id:gI(),rn:gR(),items:cartSnapshot,sub,disc:dA,dp:aDisc,tax,tot:finalTot,method:pmMod,ct:pmMod==="cash"?parseFloat(cTend):finalTot,ch:pmMod==="cash"?Math.max(0,parseFloat(cTend)-finalTot):0,ts:now.toISOString(),time:now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),custPhone:selCust?.phone||null,custName:selCust?.name||null,ptsEarned:earnablePts,ptsRedeemed:redeemPts};
  
  console.log("[PAY] Starting payment for",tx.rn,"total:",finalTot);
  
  // FIX #1: SAVE TO DB FIRST (with timeout per FIX #11)
  let savedToDb=false;
  try{
    const pkgs=await DB.getSetting("packages",{})||{};
    
    // FIX #11: Add timeout (15 seconds)
    const dbPromise=DB.addTransaction(tx,cu?.id,cu?.fn,pkgs);
    const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error(rtl?"انتهى وقت الانتظار - تحقق من الاتصال":"Timeout - check connection")),15000));
    await Promise.race([dbPromise,timeoutPromise]);
    
    savedToDb=true;
    console.log("[PAY] ✓ Saved to DB:",tx.rn);
    
    // Now safe to update UI - DB confirmed
    setTxns(p=>[tx,...p]);
    setRM(tx);
    setPM(null);
    
    // FIX #2: Decrement local stock ONLY after DB save confirmed
    setProds(prev=>prev.map(p=>{
      const item=cartSnapshot.find(i=>{
        const realId=typeof i.id==="string"&&i.id.includes("_w")?i.id.split("_w")[0]:i.id;
        return realId===p.id;
      });
      if(!item) return p;
      const pkg=pkgs[item.bc];
      if(pkg&&pkg.parentId&&pkg.packSize){
        // Pack item: deduct from parent
        return p.id===pkg.parentId?{...p,s:p.s-(item.qty*pkg.packSize)}:p;
      }
      return {...p,s:p.s-(item._weight||item.qty)};
    }));
    
    clr(); // Clear cart only after success
    
  }catch(e){
    console.error("[PAY] ✗ DB SAVE FAILED:",e);
    alert((rtl?"❌ فشل حفظ الفاتورة!\n":"❌ Save failed!\n")+(e.message||"Unknown")+(rtl?"\n\nلم يتم خصم المخزون. حاول مرة أخرى أو تحقق من الإنترنت.":"\n\nStock NOT deducted. Try again or check connection."));
    setProcessing(false);
    return; // STOP - no receipt, no stock deduction
  }
  
  // ━━━ Background tasks - non-critical, safe to fail ━━━
  
  // Customer points
  if(selCust){
    try{
      const newPts=selCust.pts+earnablePts-redeemPts;
      const newSpent=selCust.spent+finalTot;
      const newVisits=selCust.visits+1;
      setCustomers(p=>p.map(c=>c.id===selCust.id?{...c,pts:newPts,spent:newSpent,visits:newVisits,tier:newPts>=5000?"vip":newPts>=1500?"gold":newPts>=500?"silver":"bronze"}:c));
      await DB.updateCustomerPoints(selCust.id,newPts,newSpent,newVisits);
      if(earnablePts>0) await DB.addLoyaltyTx(selCust.id,tx.id,"earn",earnablePts,finalTot,"Sale "+tx.rn);
      if(redeemPts>0) await DB.addLoyaltyTx(selCust.id,tx.id,"redeem",redeemPts,redeemVal,"Redeem on "+tx.rn);
    }catch(e){console.error("[PAY] Loyalty error (non-critical):",e)}
  }
  
  // FIFO batch deduction
  try{
    const pkgs2=await DB.getSetting("packages",{})||{};
    for(const item of cartSnapshot){
      const pkg=pkgs2[item.bc];
      if(pkg&&pkg.parentId&&pkg.packSize){
        try{await DB.deductBatchFIFO(pkg.parentId,item.qty*pkg.packSize)}catch(er){console.error("Batch FIFO err:",er)}
      }else{
        try{await DB.deductBatchFIFO(item.id,item.qty)}catch(er){console.error("Batch FIFO err:",er)}
      }
    }
  }catch(e){console.error("[PAY] Batch error (non-critical):",e)}
  
  // Coupon redemption
  if(appliedCoupon){
    try{
      await DB.addRedemption({coupon_id:appliedCoupon.id,coupon_code:appliedCoupon.code,transaction_id:tx.id,receipt_no:tx.rn,customer_id:selCust?.id||null,discount_applied:dA,cashier_id:cu?.id,cashier_name:cu?.fn,branch_id:"main"});
      await DB.updateCoupon(appliedCoupon.id,{used_count:(appliedCoupon.used_count||0)+1,status:(appliedCoupon.used_count||0)+1>=appliedCoupon.max_uses?"used":"active"});
      setCoupons(p=>p.map(c=>c.id===appliedCoupon.id?{...c,used_count:(c.used_count||0)+1}:c));
      setAppliedCoupon(null);setCouponInput("");
    }catch(e){console.error("[PAY] Coupon error (non-critical):",e)}
  }
  
  // Refresh products & batches
  try{
    const p=await DB.getProducts();setProds(p);
    const bt=await DB.getAllBatches();setBatches(bt);
  }catch(e){console.error("[PAY] Refresh error (non-critical):",e)}
  
  // Auto-deposit to bank
  try{
    const targetAcct=bankAccts.find(a=>tx.method==="cash"
      ?(a.name.toLowerCase().includes("cash register")||a.name.includes("صندوق النقد"))
      :(a.name.toLowerCase().includes("main bank")||a.name.includes("الحساب البنكي"))
    );
    if(targetAcct){
      const newBal=+(+targetAcct.balance+finalTot).toFixed(3);
      setBankAccts(prev=>prev.map(a=>a.id===targetAcct.id?{...a,balance:newBal}:a));
      await DB.updateBankBalance(targetAcct.id,newBal);
      await DB.addMoneyMovement({account_id:targetAcct.id,type:"deposit",amount:finalTot,balance_after:newBal,description:(tx.method==="cash"?"💵":"💳")+" Sale "+tx.rn,reference_no:tx.rn,created_by:cu?.id});
    }
  }catch(e){console.error("[PAY] Bank deposit error (non-critical):",e)}
  
  // FIX #6: Release lock
  setProcessing(false);
  console.log("[PAY] ✓ All done for",tx.rn);
};
const canC=pmMod==="cash"?parseFloat(cTend)>=(selCust&&redeemPts>0?totAfterRedeem:tot):true;
useEffect(()=>{if(bcMod&&bcRef.current)bcRef.current.focus()},[bcMod]);
// ── KEYBOARD SHORTCUTS ──
useEffect(()=>{
const handleKey=(e)=>{
  // Don't trigger when typing in inputs
  const tag=document.activeElement?.tagName;
  if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA")return;
  // Only work when logged in
  if(!loggedIn)return;

  // F1 = New Sale
  if(e.key==="F1"){e.preventDefault();setTab("sale")}
  // F2 = Barcode Scanner
  else if(e.key==="F2"){e.preventDefault();setBM(true)}
  // F3 = Camera Scanner
  else if(e.key==="F3"){e.preventDefault();setBM(true);setCamScan(true)}
  // F4 = Hold Order
  else if(e.key==="F4"&&cart.length>0){e.preventDefault();setHeld(p=>[...p,{id:gI(),items:[...cart],time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}),disc:aDisc}]);clr()}
  // F5 = Cash Payment
  else if(e.key==="F5"&&cart.length>0){e.preventDefault();setPM("cash");setCT("")}
  // F6 = Card Payment
  else if(e.key==="F6"&&cart.length>0){e.preventDefault();setPM("card");setCT("")}
  // F7 = mada Payment
  else if(e.key==="F7"&&cart.length>0){e.preventDefault();setPM("mobile");setCT("")}
  // F8 = Dashboard
  else if(e.key==="F8"){e.preventDefault();setTab("dashboard")}
  // F9 = Home
  else if(e.key==="F9"){e.preventDefault();setTab("home")}
  // Escape = Close modals / go to sale
  else if(e.key==="Escape"){
    if(rcMod)setRM(null);
    else if(bcMod){setBM(false);setCamScan(false)}
    else if(pmMod)setPM(null);
    else setTab("sale");
  }
  // Delete = Clear cart
  else if(e.key==="Delete"&&cart.length>0&&tab==="sale"){e.preventDefault();clr()}
  // + = Increase last item qty
  else if(e.key==="+"&&cart.length>0&&tab==="sale"){e.preventDefault();uQ(cart[cart.length-1].id,1)}
  // - = Decrease last item qty
  else if(e.key==="-"&&cart.length>0&&tab==="sale"){e.preventDefault();uQ(cart[cart.length-1].id,-1)}
};
window.addEventListener("keydown",handleKey);
return()=>window.removeEventListener("keydown",handleKey);
},[loggedIn,cart,tab,rcMod,bcMod,pmMod,aDisc]);
// Camera barcode scanner
useEffect(()=>{
  if(!camScan)return;
  let scanner=null;
  const startCam=async()=>{
    try{
      scanner=new Html5Qrcode("cam-reader");
      camRef.current=scanner;
      await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:150},aspectRatio:1.5},
        (code)=>{
          const p=prods.find(x=>x.bc===code);
          if(p){addToCart(p);sT("✓ "+pN(p)+" "+t.added,"ok")}else{sT("✗ "+code+" — "+t.notFound,"err")}
          try{scanner.stop().catch(()=>{})}catch{}
          setCamScan(false);setBM(false);
        },()=>{});
    }catch(e){console.error("Camera error:",e);sT("✗ Camera access denied","err");setCamScan(false)}
  };
  startCam();
  return()=>{if(camRef.current){try{camRef.current.stop().catch(()=>{})}catch{}camRef.current=null}};
},[camScan]);
// Inventory barcode camera scanner
useEffect(()=>{
  if(!invCamScan)return;
  let scanner=null;
  const startCam=async()=>{
    try{
      scanner=new Html5Qrcode("inv-cam-reader");
      invCamRef.current=scanner;
      await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:150},aspectRatio:1.5},
        (code)=>{
          setNP(prev=>({...prev,bc:code}));
          sT("✓ "+code,"ok");
          try{scanner.stop().catch(()=>{})}catch{}
          setInvCamScan(false);
          // Auto-lookup from internet
          lookupBarcode(code);
        },()=>{});
    }catch(e){console.error("Camera error:",e);sT("✗ Camera access denied","err");setInvCamScan(false)}
  };
  startCam();
  return()=>{if(invCamRef.current){try{invCamRef.current.stop().catch(()=>{})}catch{}invCamRef.current=null}};
},[invCamScan]);
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
// Top 5 by margin (profit)
const topMargin=useMemo(()=>{const map={};txns.forEach(tx=>tx.items.forEach(i=>{const pr=prods.find(p=>p.id===i.id);const cost=pr?pr.c:0;const margin=(i.p-cost)*i.qty;if(!map[i.id])map[i.id]={name:i.n,nameAr:i.a,qty:0,rev:0,cost:0,margin:0,unitMargin:i.p-cost,marginPct:cost>0?((i.p-cost)/cost*100):0};map[i.id].qty+=i.qty;map[i.id].rev+=i.p*i.qty;map[i.id].cost+=cost*i.qty;map[i.id].margin+=margin}));return Object.values(map).sort((a,b)=>b.margin-a.margin).slice(0,5)},[txns,prods]);
// Total inventory value
const invCostTotal=useMemo(()=>prods.reduce((s,p)=>s+p.c*p.s,0),[prods]);
const invRetailTotal=useMemo(()=>prods.reduce((s,p)=>s+p.p*p.s,0),[prods]);
const invPotentialProfit=invRetailTotal-invCostTotal;
// Loyalty stats
const totalCustomers=customers.length;
const totalPointsIssued=customers.reduce((s,c)=>s+c.pts,0);
const loyaltySales=txns.filter(tx=>tx.custPhone).length;
const loyaltyPct=tC>0?((loyaltySales/tC)*100).toFixed(0):0;

// ── LOGIN → CHECK DATABASE ──────────────────────────────────
const hL=()=>{const f=users.find(u=>u.un===lu&&u.pw===lp&&u.st==="active");if(f){setCU(f);setLI(true);setLE(false);setTab("home");DB.getTodayAttendance(f.id).then(a=>setMyAtt(a)).catch(()=>{});
// Fetch weather (Open-Meteo API — free, no key)
fetch("https://api.open-meteo.com/v1/forecast?latitude=32.55&longitude=35.85&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Asia/Amman&forecast_days=3").then(r=>r.json()).then(d=>{if(d.current)setWeather(d)}).catch(()=>{})
}else setLE(true)};

// ── SAVE INVOICE → DATABASE ─────────────────────────────────
// NEW: Compute return status for a transaction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIVERSAL EXPORT & PRINT SYSTEM
// Usage: exportScreen({title, headers, rows, summary, filters, mode})
// mode: 'pdf' | 'excel' | 'print'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Build official store header HTML (bilingual)
const buildStoreHeader = (docTitle) => {
  const storeName = storeSettings.storeName || "3045 Supermarket";
  const storeNameAr = storeSettings.storeNameAr || "3045 سوبر ماركت";
  const address = storeSettings.address || "Irbid, Jordan · إربد - الأردن";
  const phone = storeSettings.phone || "";
  const taxNo = storeSettings.taxNumber || "";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB") + " · " + now.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
  
  return `
    <div class="official-header">
      <div class="header-top">
        <img src="${STORE_LOGO}" alt="logo" class="store-logo"/>
        <div class="store-info">
          <h1 class="store-name-en">${storeName}</h1>
          <h2 class="store-name-ar">${storeNameAr}</h2>
          <div class="store-details">
            ${address ? '<div>📍 '+address+'</div>' : ''}
            ${phone ? '<div>📞 '+phone+'</div>' : ''}
            ${taxNo ? '<div>🔢 Tax # / الرقم الضريبي: '+taxNo+'</div>' : ''}
          </div>
        </div>
        <div class="doc-meta">
          <div class="doc-type">OFFICIAL DOCUMENT<br/>مستند رسمي</div>
          <div class="doc-date">${dateStr}</div>
          <div class="doc-by">Generated by: ${cu?.fn || "—"}</div>
        </div>
      </div>
      <h2 class="doc-title">${docTitle}</h2>
    </div>
  `;
};

const universalCSS = `
<style>
@page { size: A4; margin: 12mm 10mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  font-family: 'Tahoma', 'Arial', sans-serif;
  color: #111827;
  background: #fff;
  font-size: 11px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body {
  padding: 0;
  margin: 0 auto;
  max-width: 1100px;
}
.official-header {
  border-bottom: 3px double #1e40af;
  padding-bottom: 10px;
  margin-bottom: 14px;
  page-break-after: avoid;
}
.header-top {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 12px;
}
.store-logo {
  width: 80px;
  height: 80px;
  object-fit: contain;
  flex-shrink: 0;
}
.store-info {
  flex: 1;
  text-align: center;
}
.store-name-en {
  font-size: 22px;
  font-weight: 900;
  color: #1e40af;
  letter-spacing: 1px;
  margin-bottom: 2px;
}
.store-name-ar {
  font-size: 20px;
  font-weight: 800;
  color: #1e3a8a;
  direction: rtl;
  margin-bottom: 6px;
}
.store-details {
  font-size: 10px;
  color: #6b7280;
  line-height: 1.5;
}
.store-details > div { display: inline-block; margin: 0 8px; }
.doc-meta {
  text-align: right;
  font-size: 10px;
  color: #6b7280;
  line-height: 1.5;
}
.doc-type {
  background: #1e40af;
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 9px;
  margin-bottom: 6px;
  white-space: nowrap;
}
.doc-date { font-family: monospace; font-weight: 600; }
.doc-by { font-style: italic; }
.doc-title {
  font-size: 18px;
  font-weight: 800;
  color: #111827;
  background: linear-gradient(90deg, #eff6ff, #fff);
  padding: 10px 16px;
  border-left: 5px solid #1e40af;
  border-radius: 4px;
  margin-top: 8px;
}
.filters-box {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 14px;
  font-size: 11px;
  color: #92400e;
}
.filters-box strong { color: #78350f; margin-right: 6px; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
  padding: 14px;
  background: linear-gradient(135deg, #f9fafb, #fff);
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}
.summary-card {
  text-align: center;
  padding: 8px;
}
.summary-card .label {
  font-size: 10px;
  color: #6b7280;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}
.summary-card .value {
  font-size: 18px;
  font-weight: 800;
  color: #1e40af;
  font-family: 'Courier New', monospace;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 9.5px;
  table-layout: auto;
}
thead { display: table-header-group; }
thead th {
  background: #1e40af !important;
  color: white !important;
  padding: 6px 8px;
  text-align: left;
  font-weight: 700;
  font-size: 9px;
  text-transform: uppercase;
  border: 1px solid #1e3a8a;
  vertical-align: middle;
  white-space: nowrap;
}
tbody td {
  padding: 5px 8px;
  border: 1px solid #e5e7eb;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: break-word;
  line-height: 1.4;
}
tbody tr {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}
tbody tr:nth-child(even) { background: #f9fafb; }
tfoot {
  display: table-footer-group;
  background: #f3f4f6;
  font-weight: 800;
}
tfoot td {
  padding: 8px;
  border-top: 3px double #1e40af;
  color: #1e40af;
}
.num { font-family: monospace; text-align: right; }
.center { text-align: center; }
.footer-box {
  margin-top: 30px;
  padding: 12px;
  border-top: 2px solid #e5e7eb;
  text-align: center;
  font-size: 10px;
  color: #9ca3af;
}
.signature-area {
  margin-top: 40px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
}
.signature-box {
  border-top: 1px solid #111827;
  padding-top: 6px;
  font-size: 10px;
  color: #374151;
  text-align: center;
  font-weight: 600;
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 8px;
  font-weight: 700;
  color: white;
}
@media print {
  html, body { 
    margin: 0 !important; 
    padding: 0 !important; 
    max-width: none !important;
    width: 100% !important;
  }
  body { padding: 0 !important; }
  .no-print { display: none !important; }
  thead { display: table-header-group !important; }
  tfoot { display: table-footer-group !important; }
  tr, .summary-card, .filters-box { 
    page-break-inside: avoid !important; 
    break-inside: avoid !important;
  }
  .official-header {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
  table { page-break-inside: auto !important; }
  .doc-title { page-break-after: avoid !important; }
}
</style>
`;

// Escape HTML
const esc = (v) => String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// Universal export function
const exportScreen = ({title, headers, rows, summary, filters, mode, showSignatures}) => {
  if(mode === "excel"){
    // CSV export with BOM for Arabic
    let csv = "\uFEFF";
    // Store header info
    csv += (storeSettings.storeName||"3045 Supermarket") + "\n";
    csv += (title||"") + "\n";
    csv += (rtl?"تاريخ التقرير":"Report Date") + "," + new Date().toLocaleString() + "\n";
    csv += (rtl?"أنشئ بواسطة":"Generated by") + "," + (cu?.fn||"—") + "\n\n";
    // Filters
    if(filters && filters.length){
      csv += (rtl?"الفلاتر المطبقة":"Applied Filters") + "\n";
      filters.forEach(f => { csv += f + "\n"; });
      csv += "\n";
    }
    // Summary
    if(summary && summary.length){
      csv += (rtl?"الملخص":"Summary") + "\n";
      summary.forEach(s => { csv += s.label + "," + s.value + "\n"; });
      csv += "\n";
    }
    // Data
    csv += headers.join(",") + "\n";
    rows.forEach(r => {
      csv += r.map(cell => {
        const s = String(cell==null?"":cell);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? '"'+s.replace(/"/g,'""')+'"' : s;
      }).join(",") + "\n";
    });
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (title||"export").replace(/[^a-z0-9]/gi,"_") + "_" + new Date().toISOString().slice(0,10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    sT("✓ "+(rtl?"تم تصدير Excel":"Excel exported"),"ok");
    return;
  }
  
  // PDF or Print mode - open new window
  const w = window.open("", "_blank", "width=1000,height=700");
  if(!w){sT("✗ "+(rtl?"فشل فتح النافذة":"Popup blocked"),"err");return}
  
  let filtersHtml = "";
  if(filters && filters.length){
    filtersHtml = '<div class="filters-box"><strong>🔍 '+(rtl?"الفلاتر المطبقة":"Applied Filters")+':</strong> ' + filters.map(f=>esc(f)).join(" | ") + '</div>';
  }
  
  let summaryHtml = "";
  if(summary && summary.length){
    summaryHtml = '<div class="summary-grid">' + summary.map(s => 
      '<div class="summary-card"><div class="label">'+esc(s.label)+'</div><div class="value" style="color:'+(s.color||"#1e40af")+'">'+esc(s.value)+'</div></div>'
    ).join("") + '</div>';
  }
  
  const headersHtml = headers.map(h => '<th>'+esc(h)+'</th>').join("");
  const rowsHtml = rows.map(r => 
    '<tr>' + r.map((cell, i) => {
      if(typeof cell === "object" && cell && cell.html) return '<td'+(cell.className?' class="'+cell.className+'"':'')+'>'+cell.html+'</td>';
      return '<td>'+esc(cell)+'</td>';
    }).join("") + '</tr>'
  ).join("");
  
  const signatures = showSignatures ? `
    <div class="signature-area">
      <div class="signature-box">${rtl?"توقيع المعد":"Prepared by"}<br/><small>${cu?.fn||""}</small></div>
      <div class="signature-box">${rtl?"توقيع المدير":"Manager Signature"}</div>
    </div>
  ` : "";
  
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title||"Report")}</title>${universalCSS}</head><body>
    ${buildStoreHeader(esc(title||""))}
    ${filtersHtml}
    ${summaryHtml}
    <table>
      <thead><tr>${headersHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${signatures}
    <div class="footer-box">
      ${rtl?"تم إنشاء هذا التقرير تلقائياً بواسطة نظام نقطة البيع":"This report was generated automatically by the POS system"}
      <br/>
      <small>© ${new Date().getFullYear()} ${storeSettings.storeName||"3045 Supermarket"} — ${rtl?"جميع الحقوق محفوظة":"All rights reserved"}</small>
    </div>
    ${mode==="print" ? '<script>setTimeout(()=>window.print(),700)</script>' : ''}
  </body></html>`;
  
  w.document.write(html);
  w.document.close();
  sT("✓ "+(mode==="print"?(rtl?"جاري الطباعة...":"Printing..."):(rtl?"تم إنشاء PDF":"PDF generated")),"ok");
};

// Universal Export Buttons Component (can be used in any screen)
const ExportButtons = ({title, getExportData}) => {
  const handleExport = (mode) => {
    try{
      const data = getExportData();
      exportScreen({...data, title, mode});
    }catch(e){console.error("Export error:",e);sT("✗ "+e.message,"err")}
  };
  return (
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      <button onClick={()=>handleExport("print")} style={{padding:"7px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:7,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>🖨 {rtl?"طباعة":"Print"}</button>
      <button onClick={()=>handleExport("pdf")} style={{padding:"7px 12px",background:"#dc2626",color:"#fff",border:"none",borderRadius:7,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📄 PDF</button>
      <button onClick={()=>handleExport("excel")} style={{padding:"7px 12px",background:"#10b981",color:"#fff",border:"none",borderRadius:7,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📊 Excel</button>
    </div>
  );
};

const getTxnReturnStatus = (tx) => {
  if(!tx || !tx.rn) return {status:"none", totalReturned:0, refundAmount:0};
  const myReturns = salesReturns.filter(r => r.receipt_no === tx.rn);
  if(myReturns.length === 0) return {status:"none", totalReturned:0, refundAmount:0};
  const totalRefund = myReturns.reduce((s,r) => s + +r.total_refund, 0);
  const isFullReturn = myReturns.some(r => r.return_type === "full");
  // If refund is close to total (within 0.01) → full, else partial
  if(isFullReturn || Math.abs(totalRefund - tx.tot) < 0.01) {
    return {status:"full", totalReturned:totalRefund, refundAmount:totalRefund, returnCount:myReturns.length};
  }
  return {status:"partial", totalReturned:totalRefund, refundAmount:totalRefund, returnCount:myReturns.length};
};

// NEW: Generate sequential invoice number format INV-DDMMYY-NNN
const generateInvoiceNo = () => {
  const now = new Date();
  const dateStr = String(now.getDate()).padStart(2,"0") + String(now.getMonth()+1).padStart(2,"0") + String(now.getFullYear()).slice(2);
  // Count today's invoices to get next sequence
  const todayPrefix = "INV-" + dateStr + "-";
  const todayCount = invs.filter(i => (i.invoiceNo||"").startsWith(todayPrefix)).length;
  const seq = String(todayCount + 1).padStart(3,"0");
  return todayPrefix + seq;
};

// NEW: Open new invoice modal with auto-generated number
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OCR - Image to Invoice (Tesseract.js - Arabic + English)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Parse OCR text into rows (smart heuristic)
const parseOCRText = (text) => {
  if(!text) return [];
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 3);
  const rows = [];
  
  for(const line of lines){
    // Skip lines that don't look like product rows (headers/totals/etc)
    const lowerLine = line.toLowerCase();
    if(lowerLine.match(/^(total|subtotal|invoice|date|supplier|الإجمالي|المجموع|المورد|التاريخ|رقم|فاتورة)/)) continue;
    
    // Extract all numbers from the line (supports Arabic numerals too)
    const numRegex = /[\d٠-٩]+(?:[.,][\d٠-٩]+)?/g;
    const matches = line.match(numRegex) || [];
    
    // Convert Arabic numerals to English
    const convertArabic = (s) => s.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString()).replace(/,/g,".");
    const numbers = matches.map(convertArabic).map(n => parseFloat(n)).filter(n => !isNaN(n));
    
    // Need at least 2 numbers (qty + price typical)
    if(numbers.length < 2) continue;
    
    // Extract name: everything that's NOT a number
    let name = line;
    matches.forEach(m => { name = name.replace(m, ""); });
    // Clean up separators
    name = name.replace(/[|│┃\-—=:]/g, " ").replace(/\s+/g, " ").trim();
    
    if(name.length < 2) continue; // Need a product name
    
    // Smart guess for quantity, cost, total:
    // Usually format: NAME | QTY | COST | TOTAL
    // QTY is usually smallest integer, COST is decimal, TOTAL = QTY × COST
    
    let qty = 1, cost = 0, total = 0;
    
    if(numbers.length >= 3){
      // Try: first num = qty (integer), second = cost (decimal), third = total
      const maybeQty = numbers[0];
      const maybeCost = numbers[1];
      const maybeTotal = numbers[2];
      // Validate: qty × cost ≈ total
      if(Math.abs(maybeQty * maybeCost - maybeTotal) < 0.1){
        qty = Math.round(maybeQty);
        cost = maybeCost;
        total = maybeTotal;
      } else {
        // Fallback: assume first is qty
        qty = Math.round(numbers[0]) || 1;
        cost = numbers[1] || 0;
        total = numbers[numbers.length-1] || qty * cost;
      }
    } else if(numbers.length === 2){
      // QTY and (COST or TOTAL)
      qty = Math.round(numbers[0]) || 1;
      cost = numbers[1] || 0;
    }
    
    // Sanity checks
    if(qty <= 0 || qty > 10000) qty = 1;
    if(cost < 0 || cost > 100000) cost = 0;
    
    rows.push({
      name: name.substring(0, 100),
      qty: qty,
      cost: cost.toFixed(3),
      rawLine: line
    });
  }
  
  return rows;
};

// ━━━ Multi-page OCR ━━━

// Compress image to reduce Base64 size (target ~500KB)
const compressImage = (file, maxWidth = 1600) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > maxWidth){
          h = h * (maxWidth/w);
          w = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", 0.75); // 75% quality
        resolve(compressed);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

// Add one or more images to OCR queue
const handleOCRImages = async (files) => {
  if(!files || files.length === 0) return;
  const filesArr = Array.from(files);
  
  // Max 10 pages
  if(ocrPages.length + filesArr.length > 10){
    sT("✗ "+(rtl?"الحد الأقصى 10 صور":"Max 10 images"),"err");
    return;
  }
  
  const newPages = [];
  for(const file of filesArr){
    if(file.size > 15 * 1024 * 1024){
      sT("✗ "+(rtl?"صورة كبيرة: "+file.name:"Image too large: "+file.name),"err");
      continue;
    }
    const compressed = await compressImage(file);
    newPages.push({
      id: Date.now()+"_"+Math.random().toString(36).slice(2,7),
      fileName: file.name,
      fileSize: file.size,
      preview: compressed, // Base64 (compressed)
      ocrText: "",
      rows: [],
      processed: false
    });
  }
  
  setOcrPages([...ocrPages, ...newPages]);
  sT("✓ "+(rtl?`تمت إضافة ${newPages.length} صفحة`:`Added ${newPages.length} page(s)`),"ok");
};

// Remove one page
const removeOCRPage = (pageId) => {
  setOcrPages(prev => prev.filter(p => p.id !== pageId));
  // Re-merge rows
  setTimeout(()=>{
    setOcrExtractedRows(prev => {
      const pages = ocrPages.filter(p => p.id !== pageId);
      return pages.flatMap(p => p.rows);
    });
  }, 50);
};

// Process OCR for ALL unprocessed pages
const processOCRAll = async () => {
  if(ocrPages.length === 0){sT("✗ "+(rtl?"أضف صوراً أولاً":"Add images first"),"err");return}
  if(typeof Tesseract === "undefined"){sT("✗ "+(rtl?"مكتبة OCR غير محملة":"OCR library not loaded"),"err");return}
  
  setOcrProcessing(true);
  setOcrProgress(0);
  
  try{
    const unprocessed = ocrPages.filter(p => !p.processed);
    const totalPages = unprocessed.length;
    const allRows = [...ocrPages.filter(p => p.processed).flatMap(p => p.rows)];
    
    for(let idx=0; idx<unprocessed.length; idx++){
      const page = unprocessed[idx];
      setOcrCurrentPage(idx+1);
      
      const result = await Tesseract.recognize(page.preview, "ara+eng", {
        logger: m => {
          if(m.status === "recognizing text" && m.progress){
            const pageProgress = m.progress * 100;
            const overallProgress = ((idx * 100) + pageProgress) / totalPages;
            setOcrProgress(Math.round(overallProgress));
          }
        }
      });
      
      const text = result.data.text;
      const parsedRows = parseOCRText(text);
      
      // Update this page
      setOcrPages(prev => prev.map(p => p.id === page.id ? {
        ...p,
        ocrText: text,
        rows: parsedRows,
        processed: true
      } : p));
      
      allRows.push(...parsedRows);
    }
    
    setOcrExtractedRows(allRows);
    setOcrProgress(100);
    sT("✓ "+(rtl?`تم تحليل ${totalPages} صفحة — ${allRows.length} صف`:`Analyzed ${totalPages} pages — ${allRows.length} rows`),"ok");
  }catch(e){
    console.error("OCR error:",e);
    sT("✗ "+(rtl?"فشل التحليل: ":"OCR failed: ")+e.message,"err");
  }finally{
    setOcrProcessing(false);
    setOcrCurrentPage(0);
  }
};

// Apply extracted rows + save images to DB
const applyOCRRows = async () => {
  if(ocrExtractedRows.length === 0){sT("✗ "+(rtl?"لا توجد بيانات للتطبيق":"No data to apply"),"err");return}
  
  // Convert OCR rows to invoice rows
  const newInvRows = ocrExtractedRows.map(r => {
    const matchedProd = prods.find(p => 
      (p.n||"").toLowerCase().includes(r.name.toLowerCase().substring(0,10)) ||
      (p.a||"").includes(r.name.substring(0,10))
    );
    return {
      cat: matchedProd ? matchedProd.cat : "",
      bc: matchedProd ? matchedProd.bc : "",
      prodId: matchedProd ? matchedProd.id : "",
      name: matchedProd ? (rtl ? (matchedProd.a || matchedProd.n) : matchedProd.n) : r.name,
      qty: String(r.qty),
      cost: r.cost,
      price: matchedProd ? String(matchedProd.p) : "",
      expDates: [""],
      isNew: !matchedProd
    };
  });
  
  setInvRows(newInvRows);
  
  // Save OCR images to a temporary state — will be attached when invoice saves
  // We keep ocrPages; they'll be picked up by saveNewInvoice
  window._pendingOcrPages = [...ocrPages]; // stash for saveNewInvoice
  
  sT("✓ "+(rtl?`تم تطبيق ${newInvRows.length} صف — راجع وعدّل ثم احفظ (سيتم حفظ ${ocrPages.length} صورة)`:`Applied ${newInvRows.length} rows — review & save (${ocrPages.length} images will be saved)`),"ok");
  setOcrMod(false);
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STOCKTAKE FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Generate session code: STKT-DDMMYY-NNN
const generateStocktakeCode = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yy = String(d.getFullYear()).slice(-2);
  const today = stocktakeSessions.filter(s => {
    try{return new Date(s.started_at).toDateString() === d.toDateString()}catch{return false}
  });
  const n = String(today.length + 1).padStart(3,"0");
  return `STKT-${dd}${mm}${yy}-${n}`;
};

// Start a new stocktake session
const startStocktake = async () => {
  try{
    const newSession = {
      session_code: generateStocktakeCode(),
      started_by: cu?.id,
      started_by_name: cu?.fn || "—",
      status: "in_progress"
    };
    const saved = await DB.createStocktakeSession(newSession);
    if(!saved){sT("✗ "+(rtl?"فشل الإنشاء":"Creation failed"),"err");return}
    setStocktakeSessions(prev => [saved, ...prev]);
    setActiveStocktake(saved);
    setStocktakeItems([]);
    setStocktakeMode(true);
    resetStocktakeScreen();
    sT("✓ "+(rtl?"جلسة جديدة: "+saved.session_code:"New session: "+saved.session_code),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Resume existing session
const resumeStocktake = async (session) => {
  try{
    const items = await DB.getStocktakeItems(session.id);
    setStocktakeItems(items);
    setActiveStocktake(session);
    setStocktakeMode(true);
    resetStocktakeScreen();
    sT("✓ "+(rtl?"استئناف الجلسة":"Resumed session"),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Reset scan screen
const resetStocktakeScreen = () => {
  setStocktakeScanBc("");
  setStocktakeCurrentProd(null);
  setStocktakeStep("scan");
  setStocktakeActualQty("");
  setStocktakeVarianceReason("");
  setStocktakeNewExpiries([""]);
  setStocktakeUnregPrompt(false);
};

// Handle barcode scan in stocktake mode
const onStocktakeScan = (barcode) => {
  const bc = (barcode || stocktakeScanBc).trim();
  if(!bc) return;
  
  // Find product
  const prod = prods.find(p => p.bc === bc);
  if(prod){
    // Check if already counted in this session
    const alreadyCounted = stocktakeItems.find(i => i.product_id === prod.id);
    if(alreadyCounted){
      if(!confirm(rtl?`هذا المنتج جُرد مسبقاً (الكمية: ${alreadyCounted.actual_stock}). هل تريد إعادة جرده؟`:`Already counted (qty: ${alreadyCounted.actual_stock}). Re-count?`)){
        resetStocktakeScreen();
        return;
      }
    }
    setStocktakeCurrentProd(prod);
    setStocktakeStep("exists"); // Show: exists / not exists choice
    setStocktakeScanBc(bc);
  } else {
    // Unregistered product
    setStocktakeCurrentProd(null);
    setStocktakeScanBc(bc);
    setStocktakeUnregPrompt(true);
    setStocktakeStep("unregistered");
  }
};

// Confirm product exists → show quantity check
const stocktakeConfirmExists = () => {
  setStocktakeStep("qty_correct");
  setStocktakeActualQty(String(stocktakeCurrentProd.s));
};

// Mark product as "not in store" (skip)
const stocktakeMarkNotPresent = async () => {
  try{
    const item = {
      session_id: activeStocktake.id,
      product_id: stocktakeCurrentProd.id,
      barcode: stocktakeCurrentProd.bc,
      product_name: stocktakeCurrentProd.n,
      system_stock: stocktakeCurrentProd.s,
      actual_stock: 0,
      difference: -stocktakeCurrentProd.s,
      system_expiry: stocktakeCurrentProd.exp || null,
      variance_reason: rtl ? "المنتج غير موجود فعلياً" : "Product not physically present",
      status: "variance"
    };
    const saved = await DB.addStocktakeItem(item);
    if(saved) setStocktakeItems(prev => [...prev, saved]);
    sT("✓ "+(rtl?"تم التسجيل":"Recorded"),"ok");
    resetStocktakeScreen();
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Quantity is correct → go to expiry check
const stocktakeQtyCorrect = () => {
  setStocktakeStep("expiry_correct");
};

// Quantity is wrong → show input
const stocktakeQtyWrong = () => {
  setStocktakeStep("qty_input");
  setStocktakeActualQty("");
};

// After entering actual qty
const stocktakeSubmitQty = () => {
  const n = parseInt(stocktakeActualQty);
  if(isNaN(n) || n < 0){sT("✗ "+(rtl?"كمية غير صالحة":"Invalid qty"),"err");return}
  setStocktakeStep("expiry_correct");
};

// Expiry is correct → save and move to next
const stocktakeExpiryCorrect = async () => {
  await saveStocktakeItem(stocktakeCurrentProd.exp ? [stocktakeCurrentProd.exp] : []);
};

// Expiry is wrong → show input
const stocktakeExpiryWrong = () => {
  setStocktakeStep("expiry_input");
  setStocktakeNewExpiries([""]);
};

// After entering new expiries
const stocktakeSubmitExpiries = async () => {
  const validExpiries = stocktakeNewExpiries.filter(d => d);
  await saveStocktakeItem(validExpiries);
};

// Save the item to DB
const saveStocktakeItem = async (expiries) => {
  try{
    const actualQty = parseInt(stocktakeActualQty) || stocktakeCurrentProd.s;
    const diff = actualQty - stocktakeCurrentProd.s;
    const item = {
      session_id: activeStocktake.id,
      product_id: stocktakeCurrentProd.id,
      barcode: stocktakeCurrentProd.bc,
      product_name: stocktakeCurrentProd.n,
      system_stock: stocktakeCurrentProd.s,
      actual_stock: actualQty,
      difference: diff,
      system_expiry: stocktakeCurrentProd.exp || null,
      new_expiries: expiries.length > 0 ? JSON.stringify(expiries) : null,
      variance_reason: stocktakeVarianceReason || null,
      status: diff === 0 ? "match" : "variance"
    };
    const saved = await DB.addStocktakeItem(item);
    if(saved) setStocktakeItems(prev => [...prev, saved]);
    sT("✓ "+(rtl?"تم حفظ":"Saved"),"ok");
    resetStocktakeScreen();
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Save unregistered product
const stocktakeSaveUnregistered = async () => {
  const actualQty = parseInt(stocktakeActualQty);
  if(isNaN(actualQty) || actualQty < 0){sT("✗ "+(rtl?"كمية غير صالحة":"Invalid qty"),"err");return}
  try{
    const item = {
      session_id: activeStocktake.id,
      product_id: null,
      barcode: stocktakeScanBc,
      product_name: rtl?"— منتج غير مسجل —":"— Unregistered product —",
      system_stock: 0,
      actual_stock: actualQty,
      difference: actualQty,
      system_expiry: null,
      new_expiries: stocktakeNewExpiries.filter(d=>d).length > 0 ? JSON.stringify(stocktakeNewExpiries.filter(d=>d)) : null,
      status: "unregistered"
    };
    const saved = await DB.addStocktakeItem(item);
    if(saved) setStocktakeItems(prev => [...prev, saved]);
    sT("✓ "+(rtl?"تم تسجيل منتج غير معروف":"Unregistered product saved"),"ok");
    resetStocktakeScreen();
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// End stocktake session (complete)
const endStocktake = async () => {
  if(!activeStocktake) return;
  if(stocktakeItems.length === 0){
    if(!confirm(rtl?"لا توجد منتجات — هل تريد إلغاء الجلسة؟":"No items counted — cancel session?")){return}
    try{
      await DB.deleteStocktakeSession(activeStocktake.id);
      setStocktakeSessions(prev => prev.filter(s => s.id !== activeStocktake.id));
      setActiveStocktake(null);
      setStocktakeMode(false);
      sT("✓ "+(rtl?"تم الإلغاء":"Cancelled"),"ok");
    }catch(e){console.error(e)}
    return;
  }
  if(!confirm(rtl?`إنهاء الجلسة؟ (${stocktakeItems.length} منتج)`:`End session? (${stocktakeItems.length} items)`)) return;
  try{
    await DB.updateStocktakeSession(activeStocktake.id, {
      status: "completed",
      completed_at: new Date().toISOString()
    });
    setStocktakeSessions(prev => prev.map(s => s.id === activeStocktake.id ? {...s, status:"completed", completed_at: new Date().toISOString()} : s));
    setActiveStocktake(null);
    setStocktakeMode(false);
    sT("✓ "+(rtl?"تم إنهاء الجلسة":"Session ended"),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Admin: approve individual stocktake item
const approveStocktakeItem = async (item, action) => {
  // action: accept (apply to inventory) or reject (ignore)
  try{
    if(action === "accept" && item.product_id){
      // Apply: update product stock + primary expiry
      const newExp = item.new_expiries ? (()=>{try{return JSON.parse(item.new_expiries)[0]}catch{return null}})() : item.system_expiry;
      const updates = {stock: item.actual_stock, updated_at: new Date().toISOString()};
      if(newExp) updates.expiry_date = newExp;
      await sb.from("products").update(updates).eq("id", item.product_id);
      
      // Create batch entries for multiple expiries
      const expiries = item.new_expiries ? (()=>{try{return JSON.parse(item.new_expiries)}catch{return []}})() : [];
      if(expiries.length > 1 && item.actual_stock > 0){
        const qtyPer = Math.floor(item.actual_stock / expiries.length);
        for(const expDate of expiries){
          try{
            await DB.addBatch({
              product_id: item.product_id,
              batch_number: "STKT-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,5),
              supplier_name: null,
              received_date: new Date().toISOString().slice(0,10),
              expiry_date: expDate,
              quantity_received: qtyPer,
              quantity_remaining: qtyPer,
              cost_per_unit: 0,
              notes: "From stocktake "+activeStocktake?.session_code
            });
          }catch(er){console.error(er)}
        }
      }
      
      // Update local state
      setProds(prev => prev.map(p => p.id === item.product_id ? {...p, s: item.actual_stock, exp: newExp || p.exp} : p));
      
      // Audit log
      await DB.addAuditLog({
        user_id: cu?.id, user_name: cu?.fn,
        action: "stocktake_adjustment",
        entity_type: "product", entity_id: item.product_id,
        field_name: "stock",
        old_value: String(item.system_stock),
        new_value: String(item.actual_stock),
        notes: "Stocktake session approved by "+cu?.fn
      }).catch(()=>{});
    }
    
    await DB.updateStocktakeItem(item.id, {
      status: action === "accept" ? "approved" : "rejected",
      admin_decision: action,
      admin_action_at: new Date().toISOString(),
      admin_action_by: cu?.id,
      admin_action_by_name: cu?.fn
    });
    
    // Refresh items in detail view
    if(stocktakeSessionDetail){
      const refreshed = await DB.getStocktakeItems(stocktakeSessionDetail.id);
      setStocktakeSessionDetail(prev => ({...prev, items: refreshed}));
    }
    sT("✓ "+(rtl?(action==="accept"?"تم القبول":"تم الرفض"):(action==="accept"?"Accepted":"Rejected")),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Admin: approve entire session
const approveStocktakeSession = async (session) => {
  if(!confirm(rtl?"اعتماد الجلسة بالكامل؟ سيتم قبول كل المنتجات التي لم يُتخذ قرار بها.":"Approve entire session? All pending items will be accepted.")) return;
  try{
    const items = await DB.getStocktakeItems(session.id);
    const pending = items.filter(i => !i.admin_decision);
    for(const item of pending){
      await approveStocktakeItem(item, "accept");
    }
    await DB.updateStocktakeSession(session.id, {
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: cu?.id,
      approved_by_name: cu?.fn
    });
    setStocktakeSessions(prev => prev.map(s => s.id === session.id ? {...s, status:"approved", approved_at: new Date().toISOString(), approved_by_name: cu?.fn} : s));
    if(stocktakeSessionDetail?.id === session.id){
      const refreshed = await DB.getStocktakeItems(session.id);
      setStocktakeSessionDetail(prev => ({...prev, status:"approved", items: refreshed}));
    }
    sT("✓ "+(rtl?"تم اعتماد الجلسة":"Session approved"),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// Open session detail for admin
const openStocktakeSessionDetail = async (session) => {
  try{
    const items = await DB.getStocktakeItems(session.id);
    setStocktakeSessionDetail({...session, items});
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

const openNewInvoice = () => {
  setInvMod(true);
  setInvSup("");
  setInvNo(generateInvoiceNo());
  setInvRows([{cat:"",bc:"",prodId:"",name:"",qty:"",cost:"",price:"",expDates:[""],isNew:false}]);
  setInvPayMethod("bank");
  setInvBankAcct("");
  setInvAttachment(null);
  setInvAttName("");
  setInvIsReconciliation(false); // Reset reconciliation flag
};

// NEW: When barcode is scanned/entered, lookup product
const onBarcodeEntered = (rowIndex, barcode) => {
  const bc = barcode.trim();
  if(!bc) return;
  const existing = prods.find(p => p.bc === bc);
  if(existing){
    // Product found - auto-fill row
    setInvRows(prev => prev.map((r,i) => i===rowIndex ? {
      ...r,
      bc: bc,
      prodId: existing.id,
      name: rtl ? (existing.a||existing.n) : existing.n,
      cat: existing.cat || r.cat,
      cost: r.cost || existing.c.toString(),
      price: r.price || existing.p.toString(),
      isNew: false
    } : r));
    sT("✓ "+(rtl?"تم استرجاع المنتج":"Product loaded"),"ok");
  } else {
    // Product not found - show "Quick Add" option
    setInvRows(prev => prev.map((r,i) => i===rowIndex ? {...r, bc: bc, isNew: true, prodId:"", name:""} : r));
  }
};

// NEW: Quick-add new product from invoice row
const quickAddProduct = async (rowIndex) => {
  if(!newProdData.bc || !newProdData.n){sT("✗ "+(rtl?"الاسم والباركود مطلوبان":"Name & barcode required"),"err");return}
  // Check duplicate
  if(prods.find(p => p.bc === newProdData.bc)){sT("✗ "+(rtl?"الباركود موجود":"Barcode exists"),"err");return}
  try{
    const newId = "P_" + Date.now().toString(36).toUpperCase();
    const newProd = {
      id: newId,
      bc: newProdData.bc,
      n: newProdData.n,
      a: newProdData.a || newProdData.n,
      p: 0, c: 0, s: 0,
      cat: newProdData.cat || invRows[rowIndex]?.cat || "",
      u: newProdData.u || "pc",
      e: newProdData.e || "📦",
      exp: null, img: null, supplier: invSup || "", linkedTo: null, linkedQty: 1
    };
    await DB.upsertProduct(newProd);
    setProds(p => [...p, newProd]);
    // Update the row with new product
    setInvRows(prev => prev.map((r,i) => i===rowIndex ? {
      ...r,
      bc: newProd.bc,
      prodId: newProd.id,
      name: rtl ? newProd.a : newProd.n,
      cat: newProd.cat,
      isNew: false
    } : r));
    sT("✓ "+(rtl?"تم إضافة المنتج":"Product added"),"ok");
    setNewProdMod(null);
    setNewProdData({bc:"",n:"",a:"",cat:"",u:"pc",e:"📦"});
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

// NEW: Save invoice with new structure
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECONCILIATION FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Open reconciliation report for a pending/reconciled invoice
const openReconciliationReport = (inv) => {
  // Build comparison data: invoice items vs current stock
  const comparisons = (inv.items||[]).map((item, idx) => {
    const prod = prods.find(p => p.id === item.prodId);
    const invoiceQty = parseInt(item.qty) || 0;
    const currentStock = prod ? prod.s : 0;
    const invoiceCost = parseFloat(item.cost) || 0;
    const currentCost = prod ? prod.c : 0;
    const diff = invoiceQty - currentStock;
    const costDiff = invoiceCost - currentCost;
    return {
      idx,
      prodId: item.prodId,
      productName: item.productName || (prod?pN(prod):"—"),
      barcode: prod?.bc || "—",
      invoiceQty,
      currentStock,
      diff,
      invoiceCost,
      currentCost,
      costDiff,
      prod,
      status: diff === 0 ? "match" : diff > 0 ? "invoice_more" : "stock_more"
    };
  });
  setReconReportMod({invoice: inv, comparisons});
  // Initialize decisions: default to "keep_current" for matched, user picks for others
  const defaults = {};
  comparisons.forEach(c => {
    defaults[c.idx] = c.status === "match" ? "match_invoice" : null; // user must pick
  });
  setReconDecisions(defaults);
};

// Apply reconciliation decisions
const applyReconciliation = async () => {
  if(!reconReportMod) return;
  const {invoice, comparisons} = reconReportMod;
  
  // Validate all decisions made
  const undecided = comparisons.filter(c => !reconDecisions[c.idx]);
  if(undecided.length > 0){
    if(!confirm(rtl?`${undecided.length} منتج بدون قرار. سيتم قبولهم كما هو في المخزون. متابعة؟`:`${undecided.length} products without decision. They will be kept as current stock. Continue?`)) return;
  }
  
  try{
    let changesCount = 0;
    // Apply each decision
    for(const c of comparisons){
      const decision = reconDecisions[c.idx] || "keep_current";
      if(!c.prod) continue; // Skip products not in inventory
      
      if(decision === "match_invoice"){
        // Update stock and cost to match invoice
        const updates = {};
        let changed = false;
        if(c.currentStock !== c.invoiceQty){
          updates.stock = c.invoiceQty;
          changed = true;
        }
        if(c.currentCost !== c.invoiceCost && c.invoiceCost > 0){
          updates.cost = c.invoiceCost;
          changed = true;
        }
        if(changed){
          updates.updated_at = new Date().toISOString();
          await sb.from("products").update(updates).eq("id", c.prodId);
          // Audit log
          if(updates.stock !== undefined){
            await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"reconciliation_stock_adjust",entity_type:"product",entity_id:c.prodId,field_name:"stock",old_value:String(c.currentStock),new_value:String(c.invoiceQty),notes:"Reconciled from invoice "+invoice.invoiceNo}).catch(()=>{});
          }
          if(updates.cost !== undefined){
            await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"reconciliation_cost_adjust",entity_type:"product",entity_id:c.prodId,field_name:"cost",old_value:String(c.currentCost),new_value:String(c.invoiceCost),notes:"Reconciled from invoice "+invoice.invoiceNo}).catch(()=>{});
          }
          changesCount++;
        }
      }
      
      // Always update supplier (from invoice) regardless of decision
      if(invoice.supplier && (!c.prod.supplier || c.prod.supplier !== invoice.supplier)){
        await sb.from("products").update({supplier: invoice.supplier, updated_at: new Date().toISOString()}).eq("id", c.prodId);
      }
    }
    
    // Mark invoice as reconciled
    const notes = `Reconciled by ${cu?.fn}. ${changesCount} products adjusted.`;
    await DB.markInvoiceReconciled(invoice.id, cu?.id, cu?.fn, notes);
    
    // Refresh data
    const [refreshedProds, refreshedInvs] = await Promise.all([DB.getProducts(), DB.getInvoices()]);
    setProds(refreshedProds);
    setInvs(refreshedInvs);
    
    sT("✓ "+(rtl?`تمت المطابقة - ${changesCount} تعديل`:`Reconciled - ${changesCount} adjustments`),"ok");
    setReconReportMod(null);
    setReconDecisions({});
  }catch(e){
    console.error("Reconciliation error:", e);
    sT("✗ "+e.message,"err");
  }
};

// Print/Export reconciliation report
const exportReconciliationReport = (mode) => {
  if(!reconReportMod) return;
  const {invoice, comparisons} = reconReportMod;
  
  const headers = [rtl?"الباركود":"Barcode", rtl?"المنتج":"Product", rtl?"الفاتورة":"Invoice Qty", rtl?"المخزون":"Stock", rtl?"الفرق":"Difference", rtl?"سعر الفاتورة":"Invoice Cost", rtl?"السعر الحالي":"Current Cost", rtl?"القرار":"Decision", rtl?"الحالة":"Status"];
  
  const rows = comparisons.map(c => {
    const decision = reconDecisions[c.idx];
    const decisionLabel = decision === "match_invoice" ? (rtl?"تعديل للفاتورة":"Match Invoice") : decision === "keep_current" ? (rtl?"إبقاء الحالي":"Keep Current") : (rtl?"بدون قرار":"No decision");
    const statusLabel = c.status === "match" ? (rtl?"مطابق ✓":"Match ✓") : c.status === "invoice_more" ? (rtl?"نقص +"+c.diff:"Short +"+c.diff) : (rtl?"زيادة "+c.diff:"Extra "+c.diff);
    return [c.barcode, c.productName, c.invoiceQty, c.currentStock, c.diff, c.invoiceCost.toFixed(3), c.currentCost.toFixed(3), decisionLabel, statusLabel];
  });
  
  const matchCount = comparisons.filter(c => c.status === "match").length;
  const diffCount = comparisons.length - matchCount;
  
  const summary = [
    {label:rtl?"عدد المنتجات":"Products", value:comparisons.length, color:"#1e40af"},
    {label:rtl?"مطابق":"Matched", value:matchCount, color:"#059669"},
    {label:rtl?"فروقات":"Differences", value:diffCount, color:"#dc2626"},
    {label:rtl?"تكلفة الفاتورة":"Invoice Cost", value:fm(+invoice.totalCost), color:"#7c3aed"}
  ];
  
  const filters = [
    (rtl?"رقم الفاتورة":"Invoice#")+": "+invoice.invoiceNo,
    (rtl?"المورد":"Supplier")+": "+invoice.supplier,
    (rtl?"التاريخ":"Date")+": "+invoice.date,
    (rtl?"الحالة":"Status")+": "+(invoice.reconciliation_status==="reconciled" ? (rtl?"تم المطابقة":"Reconciled") : (rtl?"بانتظار المطابقة":"Pending"))
  ];
  
  exportScreen({
    title: (rtl?"تقرير مطابقة فاتورة":"Invoice Reconciliation Report")+" - "+invoice.invoiceNo,
    headers, rows, summary, filters,
    mode,
    showSignatures: true
  });
};

const saveNewInvoice = async () => {
  if(!invSup){sT("✗ "+(rtl?"اختر المورد":"Select supplier"),"err");return}
  if(!invNo){sT("✗ "+(rtl?"رقم الفاتورة مطلوب":"Invoice number required"),"err");return}
  const validRows = invRows.filter(r => r.prodId && r.qty && parseInt(r.qty)>0);
  if(!validRows.length){sT("✗ "+(rtl?"أضف منتج واحد على الأقل":"Add at least one product"),"err");return}
  
  const totalCost = validRows.reduce((s,r) => s + (parseFloat(r.cost)||0)*(parseInt(r.qty)||0), 0);
  const debitAcctObj = invBankAcct ? bankAccts.find(a => a.id === +invBankAcct) : null;
  const debitAcctLabel = debitAcctObj ? (rtl?(debitAcctObj.name_ar||debitAcctObj.name):debitAcctObj.name) : "";
  
  // Build invoice items
  const items = validRows.map(r => ({
    prodId: r.prodId,
    productName: r.name,
    qty: r.qty,
    cost: r.cost,
    price: r.price,
    category: r.cat,
    expiry_dates: r.expDates.filter(d => d).join(", ")
  }));
  
  const inv = {
    invoiceNo: invNo,
    supplier: invSup,
    totalCost,
    receivedBy: cu?.fn || "",
    items,
    attachment: invAttachment,
    attachName: invAttName,
    payMethod: invPayMethod,
    debitAcct: debitAcctLabel,
    is_reconciliation: invIsReconciliation,
    reconciliation_status: invIsReconciliation ? "pending_reconciliation" : "normal"
  };
  
  try{
    // 1) Save invoice to DB (returns the new invoice with id)
    const savedInv = await DB.addInvoice(inv);
    const newInvoiceId = savedInv?.id;
    
    // 1b) Save OCR page images as attachments (if any)
    if(newInvoiceId && window._pendingOcrPages && window._pendingOcrPages.length > 0){
      for(let i=0; i<window._pendingOcrPages.length; i++){
        const page = window._pendingOcrPages[i];
        try{
          await DB.addInvoiceAttachment({
            invoice_id: newInvoiceId,
            file_name: page.fileName || ("page_"+(i+1)+".jpg"),
            file_type: "image/jpeg",
            file_size: page.fileSize || null,
            image_data: page.preview, // Base64
            page_number: i+1,
            ocr_text: page.ocrText || null,
            uploaded_by: cu?.id,
            uploaded_by_name: cu?.fn
          });
        }catch(er){console.error("Attachment save err:",er)}
      }
      window._pendingOcrPages = null; // Clear stash
    }
    
    // 2) Update each product: stock, cost, price, supplier
    // In RECONCILIATION mode: skip ALL updates (just save invoice for matching later)
    if(!invIsReconciliation){
    for(const r of validRows){
      const prod = prods.find(p => p.id === r.prodId);
      if(!prod) continue;
      const qty = parseInt(r.qty) || 0;
      const newCost = parseFloat(r.cost) || prod.c;
      const newPrice = parseFloat(r.price) || prod.p;
      const newStock = prod.s + qty;
      
      // Pick earliest expiry as primary
      const validExps = r.expDates.filter(d => d).sort();
      const primaryExp = validExps[0] || prod.exp;
      
      await DB.upsertProduct({
        ...prod,
        s: newStock,
        c: newCost,
        p: newPrice,
        exp: primaryExp,
        supplier: invSup
      });
      
      // 3) Create batch for each expiry date
      for(const expDate of validExps){
        try{
          await DB.addBatch({
            product_id: r.prodId,
            batch_number: "B-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,5),
            supplier_name: invSup,
            received_date: new Date().toISOString().slice(0,10),
            expiry_date: expDate,
            quantity_received: Math.floor(qty / validExps.length),
            quantity_remaining: Math.floor(qty / validExps.length),
            cost_per_unit: newCost,
            notes: "From invoice "+invNo
          });
        }catch(er){console.error("Batch err:",er)}
      }
      
      // Audit log for price/cost changes
      if(prod.c !== newCost){
        await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"invoice_cost_update",entity_type:"product",entity_id:r.prodId,field_name:"cost",old_value:String(prod.c),new_value:String(newCost),notes:"From invoice "+invNo}).catch(()=>{});
      }
      if(prod.p !== newPrice){
        await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"invoice_price_update",entity_type:"product",entity_id:r.prodId,field_name:"price",old_value:String(prod.p),new_value:String(newPrice),notes:"From invoice "+invNo}).catch(()=>{});
      }
    }
    } // end !invIsReconciliation
    

    // 4) Refresh state
    const refreshedProds = await DB.getProducts();
    setProds(refreshedProds);
    const refreshedBatches = await DB.getAllBatches();
    setBatches(refreshedBatches);
    
    // 5) Auto-create expense (SKIP in reconciliation mode)
    if(!invIsReconciliation){
      const suppliesCat = expCats.find(c => c.name === "Supplies") || expCats[0];
      if(suppliesCat && totalCost > 0){
        const exp = {category_id:suppliesCat.id, amount:totalCost, description:"Purchase: "+invNo+" — "+invSup+" ("+validRows.length+" items)", payment_method:invPayMethod, expense_date:new Date().toISOString().slice(0,10), recurring:"none", reference_no:invNo, created_by:cu?.id};
        const er = await DB.addExpense(exp);
        if(er) setExpensesList(prev => [er,...prev]);
      }
      
      // 6) Auto-withdraw from bank
      if(invBankAcct && totalCost > 0){
        const acct = bankAccts.find(a => a.id === +invBankAcct);
        if(acct){
          const newBal = +acct.balance - totalCost;
          await DB.updateBankBalance(acct.id, newBal);
          await DB.addMoneyMovement({account_id:acct.id, type:"withdrawal", amount:totalCost, balance_after:newBal, description:"Purchase: "+invNo+" — "+invSup, reference_no:invNo, created_by:cu?.id});
          setBankAccts(prev => prev.map(a => a.id===acct.id ? {...a,balance:newBal} : a));
          const mv = await DB.getMoneyMovements(); setMovements(mv);
        }
      }
    }
    
    // 7) Refresh invoices list
    const allInvs = await DB.getInvoices();
    setInvs(allInvs);
    
    // 8) Close modal and reset
    setInvMod(false);
    setInvSup(""); setInvNo(""); setInvRows([{cat:"",bc:"",prodId:"",name:"",qty:"",cost:"",price:"",expDates:[""],isNew:false}]);
    setInvPayMethod("bank"); setInvBankAcct("");
    setInvAttachment(null); setInvAttName("");
    
    sT("✓ "+(invIsReconciliation?(rtl?"فاتورة مطابقة محفوظة - ":"Reconciliation invoice saved - "):(rtl?"تم حفظ الفاتورة - ":"Invoice saved - "))+validRows.length+(rtl?" منتج":" products"),"ok");
  }catch(e){
    console.error("Invoice save error:",e);
    sT("✗ "+(rtl?"فشل الحفظ: ":"Save failed: ")+e.message,"err");
  }
};

const saveInv=async()=>{
  if(!invSup||!invNo)return;
  const vi=invItems.filter(x=>x.prodId&&x.qty);
  const totalCost=vi.reduce((s,x)=>s+(parseFloat(x.cost)||0)*(parseInt(x.qty)||0),0);
  const debitAcctObj=invBankAcct?bankAccts.find(a=>a.id===+invBankAcct):null;
  const debitAcctLabel=debitAcctObj?(rtl?(debitAcctObj.name_ar||debitAcctObj.name):debitAcctObj.name):"";
  const inv={invoiceNo:invNo,supplier:invSup,totalCost,receivedBy:cu?.fn||"",items:vi.map(x=>{const pr=prods.find(p=>p.id===x.prodId);return{...x,productName:pr?pN(pr):""}}),attachment:invAttachment,attachName:invAttName,payMethod:invPayMethod,debitAcct:debitAcctLabel};  // Optimistic update
  setInvs(p=>[{...inv,id:Date.now(),date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})},...p]);
  setProds(p=>p.map(pr=>{const it=vi.find(x=>x.prodId===pr.id);return it?{...pr,s:pr.s+(parseInt(it.qty)||0),c:parseFloat(it.cost)||pr.c}:pr}));
  setInvMod(false);setInvSup("");setInvNo("");setInvItems([{prodId:"",qty:"",cost:""}]);setInvPayMethod("bank");setInvBankAcct("");setInvAttachment(null);setInvAttName("");
  sT("✓ "+(rtl?"تم حفظ الفاتورة":"Invoice saved")+(debitAcctObj?" · "+(rtl?"خُصم من ":"Debited from ")+debitAcctLabel:""),"ok");
  // Save to DB + auto-create expense + bank withdrawal
  try{
    await DB.addInvoice(inv);const p=await DB.getProducts();setProds(p);
    // Auto-create expense under "Supplies" category
    const suppliesCat=expCats.find(c=>c.name==="Supplies")||expCats[0];
    if(suppliesCat&&totalCost>0){
      const exp={category_id:suppliesCat.id,amount:totalCost,description:"Purchase: "+invNo+" — "+invSup+" ("+vi.length+" items)",payment_method:invPayMethod,expense_date:new Date().toISOString().slice(0,10),recurring:"none",reference_no:invNo,created_by:cu?.id};
      const er=await DB.addExpense(exp);
      if(er)setExpensesList(prev=>[er,...prev]);
    }
    // Auto-withdraw from bank account if selected
    if(invBankAcct&&totalCost>0){
      const acct=bankAccts.find(a=>a.id===+invBankAcct);
      if(acct){
        const newBal=+acct.balance-totalCost;
        await DB.updateBankBalance(acct.id,newBal);
        await DB.addMoneyMovement({account_id:acct.id,type:"withdrawal",amount:totalCost,balance_after:newBal,description:"Purchase: "+invNo+" — "+invSup,reference_no:invNo,created_by:cu?.id});
        setBankAccts(prev=>prev.map(a=>a.id===acct.id?{...a,balance:newBal}:a));
        const mv=await DB.getMoneyMovements();setMovements(mv);
      }
    }
  }catch(e){console.error(e)}
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
.nav{display:flex;gap:2px;padding:0 20px;background:var(--w);border-bottom:1px solid var(--g200);flex-shrink:0}.nt{padding:10px 18px;font-size:14px;font-weight:600;color:var(--g400);background:none;border:none;cursor:pointer;border-bottom:2.5px solid transparent;font-family:var(--f)}.nt:hover{color:var(--g600)}.nt.a{color:var(--blue);border-bottom-color:var(--blue)}
.mn{display:flex;flex:1;overflow:hidden}.pp{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--g50)}.sb{padding:12px 16px;display:flex;gap:8px;flex-shrink:0;background:var(--w);border-bottom:1px solid var(--g100)}.sw{flex:1;position:relative}.sw-icon{position:absolute;${rtl?"right":"left"}:12px;top:50%;transform:translateY(-50%);color:var(--g400)}.si{width:100%;padding:12px 16px 12px 40px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g900);font-size:13px;font-family:var(--f);outline:none;direction:${rtl?"rtl":"ltr"}}.si:focus{border-color:var(--blue);background:var(--w)}.bb{padding:10px 14px;background:var(--w);border:1.5px solid var(--g200);border-radius:var(--r);color:var(--g600);cursor:pointer;font-family:var(--f);font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px}.bb:hover{border-color:var(--blue);color:var(--blue)}
.cats{display:flex;gap:6px;padding:12px 16px;overflow-x:auto;flex-shrink:0}.cats::-webkit-scrollbar{height:0}.ch{padding:8px 16px;background:var(--w);border:1.5px solid var(--g200);border-radius:20px;font-size:12px;font-weight:500;color:var(--g500);cursor:pointer;white-space:nowrap;font-family:var(--f)}.ch:hover{border-color:var(--blue);color:var(--blue)}.ch.a{background:var(--blue);border-color:var(--blue);color:var(--w);font-weight:600}
.pg{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:12px 16px;overflow-y:auto;flex:1}.pg::-webkit-scrollbar{width:5px}.pg::-webkit-scrollbar-thumb{background:var(--g300);border-radius:10px}.pc{background:var(--w);border:1.5px solid var(--g200);border-radius:16px;padding:14px 12px;cursor:pointer;transition:all .2s;display:flex;flex-direction:column;gap:6px;position:relative}.pc:hover{border-color:var(--blue);transform:translateY(-2px);box-shadow:var(--shadow2)}.pc:active{transform:scale(.97)}.pe{font-size:34px}.pn{font-size:12px;font-weight:600;color:var(--g700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pm{display:flex;justify-content:space-between;align-items:center}.pp2{font-family:var(--m);font-size:16px;font-weight:700;color:var(--blue)}.pu{font-size:10px;color:var(--g400)}.pl{position:absolute;top:8px;${rtl?"left":"right"}:8px;width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 6px var(--amber)}
.cp{width:420px;display:flex;flex-direction:column;background:var(--w);border-${rtl?"right":"left"}:1px solid var(--g200);flex-shrink:0}.ch2{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--g100)}.ch2 h3{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}.cc{background:var(--blue);color:var(--w);font-size:11px;padding:2px 8px;border-radius:10px;font-weight:700}.ccl{font-size:12px;color:var(--red);background:none;border:none;cursor:pointer;font-family:var(--f);font-weight:600}.ciw{flex:1;overflow-y:auto;padding:4px 0}.cem{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--g400);gap:8px}.ci{display:flex;align-items:center;gap:10px;padding:10px 16px;animation:sIn .2s ease}.ci:hover{background:var(--g50)}.cif{flex:1;min-width:0}.cin{font-size:13px;font-weight:600;color:var(--g700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cip{font-size:11px;color:var(--g400);font-family:var(--m)}.qc{display:flex;align-items:center;background:var(--g50);border-radius:8px;border:1.5px solid var(--g200)}.qb{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:var(--g500);cursor:pointer;font-size:14px;font-weight:700}.qb:hover{color:var(--blue);background:var(--blue50)}.qv{width:30px;text-align:center;font-size:13px;font-weight:700;font-family:var(--m)}.ct{font-family:var(--m);font-size:13px;font-weight:700;min-width:55px;text-align:${rtl?"left":"right"}}.crm{background:none;border:none;color:var(--g300);cursor:pointer;font-size:14px;opacity:0;border-radius:6px;padding:4px}.ci:hover .crm{opacity:1}.crm:hover{color:var(--red);background:var(--red50)}
.csm{padding:14px 16px;border-top:1px solid var(--g100)}.sr{display:flex;justify-content:space-between;font-size:13px;color:var(--g500);margin-bottom:6px;font-weight:500}.sr span:last-child{font-family:var(--m);font-weight:600;color:var(--g700)}.sr.T{font-size:18px;font-weight:800;color:var(--g900);margin-top:10px;padding-top:10px;border-top:2px solid var(--g200);margin-bottom:0}.sr.T span:last-child{color:var(--blue)}.dr{display:flex;gap:6px;margin-top:8px}.di{flex:1;padding:8px 12px;background:var(--g50);border:1.5px solid var(--g200);border-radius:var(--r);font-size:12px;font-family:var(--f);outline:none;color:var(--g900)}.di:focus{border-color:var(--blue)}.da{padding:8px 16px;background:var(--org);border:none;border-radius:var(--r);color:var(--w);font-size:12px;font-weight:700;cursor:pointer;font-family:var(--f)}
.pbs{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--g100)}.pb{flex:1;padding:18px;border:none;border-radius:var(--r);font-size:13px;font-weight:700;cursor:pointer;font-family:var(--f);display:flex;flex-direction:column;align-items:center;gap:4px}.pb:disabled{opacity:.4;cursor:not-allowed}.pb.c{background:var(--green);color:var(--w)}.pb.d{background:var(--blue);color:var(--w)}.pb.m{background:var(--purple);color:var(--w)}.pb:not(:disabled):hover{transform:translateY(-2px);box-shadow:var(--shadow2)}.pbi{font-size:20px}
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
.toast{position:fixed;top:70px;${rtl?"left":"right"}:20px;padding:12px 20px;border-radius:var(--r);font-size:13px;font-weight:600;z-index:999999;animation:sIn .3s ease;box-shadow:var(--shadow3);max-width:90vw;word-wrap:break-word}.toast-ok{background:var(--green);color:var(--w)}.toast-err{background:var(--red);color:var(--w)}
.bci{position:fixed;bottom:14px;${rtl?"left":"right"}:16px;padding:6px 14px;background:var(--w);border:1px solid var(--g200);border-radius:20px;font-size:11px;color:var(--g500);z-index:500;display:flex;align-items:center;gap:6px;box-shadow:var(--shadow)}.bcd{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pu 2s ease infinite}
@keyframes sIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes fIn{from{opacity:0}to{opacity:1}}@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}
.recharts-text{fill:var(--g500)!important;font-size:10px!important;font-family:var(--f)!important}.recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:var(--g100)!important}
@media(max-width:768px){
.hdr{padding:8px 12px}.logo-t{font-size:14px}.logo-m{width:30px;height:30px;font-size:10px}.hdr-r{gap:4px}.hb{padding:4px 8px;font-size:10px}.db-badge{font-size:9px;padding:2px 8px}
.nav{padding:0 8px;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:0}.nav::-webkit-scrollbar{height:0}.nt{padding:8px 12px;font-size:11px;white-space:nowrap;flex-shrink:0}
.mn{flex-direction:column}.pp{min-height:40vh}.cp{width:100%;border-left:none;border-top:1px solid var(--g200);max-height:55vh}
.pg{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;padding:8px}.pc{padding:10px 8px;border-radius:12px}.pe{font-size:22px}.pn{font-size:11px}.pp2{font-size:12px}
.sb{padding:8px}.si{font-size:12px;padding:8px 12px 8px 34px}.bb{padding:8px 10px;font-size:11px}
.cats{padding:8px;gap:4px}.ch{padding:5px 10px;font-size:11px}
.ch2{padding:10px 12px}.ch2 h3{font-size:13px}.ciw{max-height:150px}
.csm{padding:10px 12px}.sr{font-size:12px}.sr.T{font-size:15px}
.pbs{padding:8px 12px;gap:6px}.pb{padding:10px;font-size:11px}.pbi{font-size:16px}
.md{min-width:auto;width:92vw;max-width:none;padding:20px;border-radius:16px;max-height:92vh}.md h2{font-size:16px}
.ov{padding:10px;align-items:flex-start;padding-top:4vh}
.rcpt{max-height:50vh}.ra{flex-direction:column;gap:6px}
.dsh{padding:10px;gap:8px}
.ad{flex-direction:column}.ads{flex-direction:row;overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%;border-right:none;border-bottom:1px solid var(--g200);padding:8px;gap:4px}.ads::-webkit-scrollbar{height:0}.asb{white-space:nowrap;font-size:11px;padding:8px 12px}.ac{padding:10px;width:100%}
.at{font-size:11px}.at th,.at td{padding:6px 8px}
.tb{margin-bottom:8px;border-radius:12px}.tbh{padding:8px 12px;font-size:12px}
.sf label{font-size:11px}.sf input{padding:8px 12px;font-size:12px}.svb{font-size:12px;padding:10px}
.dc{padding:10px}.dcl{font-size:9px}.dcv{font-size:16px}
.toast{top:auto;bottom:20px;${rtl?"left":"right"}:10px;font-size:12px;padding:10px 16px}
.login-card{width:90vw;max-width:360px;padding:28px 24px}.login-logo h1{font-size:26px}
.bci{bottom:8px;${rtl?"left":"right"}:8px;font-size:10px;padding:4px 10px}
.inv-row{flex-wrap:wrap}.inv-row select,.inv-row input{min-width:80px}
.pf input,.pf select{font-size:14px;padding:12px 14px}
}
@media(max-width:480px){
.pg{grid-template-columns:repeat(3,1fr);gap:4px;padding:6px}.pc{padding:8px 6px}.pe{font-size:18px}.pn{font-size:10px}.pp2{font-size:11px}
.cp{max-height:40vh}
.pb{padding:8px;font-size:10px}.pbi{font-size:14px}
}`;

// ── RENDER ───────────────────────────────────────────────────
// (Same JSX as white-theme version — login, sale, held, dashboard, admin tabs)
// The key difference: all mutations (confirmPayment, addProduct, saveInvoice, etc.) now call DB.* functions

if(!loggedIn)return(<><style>{S}</style><div className="login-wrap"><div className="login-card"><div className="login-logo"><img src={STORE_LOGO} alt="3045" style={{width:200,marginBottom:18}}/><h1><span>3045</span> Supermarket</h1><p>Point of Sale System</p></div><div className="lf"><label>{t.user}</label><input value={lu} onChange={e=>{setLU(e.target.value);setLE(false)}} onKeyDown={e=>{if(e.key==="Enter")hL()}} autoFocus placeholder={rtl?"اسم المستخدم":"Username"}/></div><div className="lf"><label>{t.pass}</label><input type="password" value={lp} onChange={e=>{setLP(e.target.value);setLE(false)}} onKeyDown={e=>{if(e.key==="Enter")hL()}} placeholder="••••••••"/></div><button className="login-btn" onClick={hL}>{t.login}</button>{le&&<div className="login-err">{t.loginErr}</div>}<div style={{textAlign:"center",marginTop:16}}><button onClick={()=>setLang(lang==="en"?"ar":"en")} style={{background:"none",border:"1px solid #e5e7eb",color:"#6b7280",fontSize:12,cursor:"pointer",fontFamily:"var(--f)",padding:"6px 16px",borderRadius:20,fontWeight:600}}>🌐 {t.lang}</button></div><div style={{marginTop:14,fontSize:11,color:"#9ca3af",textAlign:"center"}}></div>{dbOk?<div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#059669"}}>✓ {t.dbConnected}</div>:<div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#dc2626"}}>⚠ {t.dbError}</div>}</div></div></>);

return(<><style>{S}</style><div className="app">
<header className="hdr"><div className="logo-a"><img src={STORE_LOGO} alt="3045" style={{height:60,marginRight:12}}/><div className="logo-t"><span>3045</span> Supermarket</div><span className="db-badge"><span className="db-dot"/>☁️ {t.autoSave}</span></div><div className="hdr-r"><div className="hb">📍 {t.terminal}</div><div className="hb" style={{display:"flex",alignItems:"center",gap:6}}>{cu.avatar?<img src={cu.avatar} style={{width:22,height:22,borderRadius:"50%",objectFit:"cover"}}/>:<span>👤</span>} {rtl?(cu.fa||cu.fn):cu.fn}</div>{hasP("excel_export")&&<button className="hb hb-blue" onClick={()=>exportXL(prods,txns,invs)}>📥 {t.excel}</button>}<button className="hb" onClick={()=>{setQuickSearchMod(true);setQuickSearchInput("");setSelectedProdCard(null)}} style={{background:"#fffbeb",color:"#d97706",borderColor:"#fcd34d"}}>🔍 {rtl?"بحث سريع":"Quick Search"}</button><button className="hb" onClick={()=>{const nv=!voiceOn;setVoiceOn(nv);DB.setSetting("voice_on",nv);sT(nv?(rtl?"🔊 الصوت مفعّل":"🔊 Voice ON"):(rtl?"🔇 الصوت معطّل":"🔇 Voice OFF"),"ok")}} style={{background:voiceOn?"#ecfdf5":"",color:voiceOn?"#059669":""}}>{voiceOn?"🔊":"🔇"}</button><button className="hb" onClick={()=>setLang(lang==="en"?"ar":"en")}>🌐 {t.lang}</button><button className="hb hb-red" onClick={()=>{
  // Check if shift is open
  if(activeShift){
    const msg=rtl?"⚠️ لديك وردية مفتوحة حالياً!\n\nسيتم تسجيل الخروج فقط، والوردية ستبقى مفتوحة.\nيمكنك متابعتها لاحقاً عند تسجيل الدخول مرة أخرى.\n\nتأكيد تسجيل الخروج؟":"⚠️ You have an OPEN shift!\n\nLogout will only sign you out.\nYour shift will REMAIN OPEN.\nYou can resume it on next login.\n\nConfirm logout?";
    if(!confirm(msg))return;
  }
  setLI(false);setCU(null);setLU("");setLP("");
}}>🚪 {t.logout}</button></div></header>

<nav className="nav" style={{display:"flex",flexDirection:"column",gap:0}}>
{/* ── PRIMARY: Cashier Tabs (like screenshot) ── */}
<div style={{display:"flex",gap:6,padding:"10px 16px",background:"#fff",borderBottom:"1px solid #e2e8f0",overflowX:"auto"}}>
{[
{id:"home",l:rtl?"الرئيسية":"Home",i:"🏠"},
{id:"sale",l:rtl?"نقطة البيع":"POS",i:"🛒"},
{id:"orders",l:rtl?"الطلبات":"Orders",i:"📋",badge:held.length||0},
{id:"cashMgmt",l:rtl?"إدارة النقد":"Cash Management",i:"💰"},
{id:"stockCheck",l:rtl?"كميات المنتجات":"Product Quantities",i:"📦"},
{id:"regClose",l:rtl?"إغلاق الصندوق":"Register Closures",i:"🔒",dot:!!activeShift},
{id:"posReturn",l:rtl?"مرتجع":"Return",i:"↩️"},
].map(b=><button key={b.id} onClick={()=>setTab(b.id)} style={{padding:"8px 18px",border:tab===b.id?"2px solid #1e40af":"1.5px solid #d1d5db",borderRadius:8,background:tab===b.id?"#eff6ff":"#fff",color:tab===b.id?"#1e40af":"#374151",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",whiteSpace:"nowrap",position:"relative",transition:"all .15s"}}>{b.i} {b.l}{b.badge>0&&<span style={{position:"absolute",top:-4,right:rtl?"auto":-4,left:rtl?-4:"auto",background:"#dc2626",color:"#fff",fontSize:8,fontWeight:800,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{b.badge}</span>}{b.dot&&<span style={{position:"absolute",top:-2,right:rtl?"auto":-2,left:rtl?-2:"auto",width:8,height:8,background:"#059669",borderRadius:"50%",border:"2px solid #fff"}}/>}</button>)}
</div>
{/* ── SECONDARY: Manager/Admin Tabs ── */}
<div style={{display:"flex",gap:2,padding:"4px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",overflowX:"auto",flexWrap:"wrap"}}>
{hasP("dashboard")&&<button className={"nt "+(tab==="dashboard"?"a":"")} onClick={()=>setTab("dashboard")}>📊 {t.dashboard}</button>}
{hasP("dashboard")&&<button className={"nt "+(tab==="analytics"?"a":"")} onClick={()=>setTab("analytics")}>🧠 {rtl?"التحليلات":"Analytics"}</button>}
{hasP("sales_view")&&<button className={"nt "+(tab==="sales"?"a":"")} onClick={()=>setTab("sales")}>📋 {t.salesView}</button>}
{hasP("hr")&&<button className={"nt "+(tab==="hr"?"a":"")} onClick={()=>setTab("hr")}>🏢 {t.hr}</button>}
{hasP("finance")&&<button className={"nt "+(tab==="finance"?"a":"")} onClick={()=>setTab("finance")}>💰 {t.finance}</button>}
{(cu.role==="admin"||cu.role==="manager")&&<button className={"nt "+(tab==="admin"?"a":"")} onClick={()=>setTab("admin")}>⚙️ {t.admin}</button>}
</div>
</nav>

<div className="mn">

{/* HOME PAGE — FANCY */}
{tab==="home"&&(()=>{
const todayRev=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}});
const todayTotal=todayRev.reduce((s,t2)=>s+t2.tot,0);
const todayCount=todayRev.length;
const todayItemsSold=todayRev.reduce((s,t2)=>s+t2.items.reduce((a,i)=>a+i.qty,0),0);
const nowHr=new Date().getHours();
const greeting=nowHr<12?(rtl?"صباح الخير":"Good Morning"):nowHr<17?(rtl?"مساء الخير":"Good Afternoon"):(rtl?"مساء الخير":"Good Evening");
const targetDaily=storeSettings.dailyTarget||500;const pct=Math.min(100,(todayTotal/targetDaily*100));

return<div style={{flex:1,overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:12,background:"linear-gradient(180deg,#f0f9ff 0%,#f9fafb 30%)"}}>

{/* Hero Banner */}
<div style={{background:"linear-gradient(135deg,#1e3a5f 0%,#2563eb 50%,#7c3aed 100%)",borderRadius:24,padding:"32px 30px 28px",color:"#fff",position:"relative",overflow:"hidden",minHeight:120}}>
<div style={{position:"absolute",top:-30,right:-30,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.08)"}}/>
<div style={{position:"absolute",bottom:-40,left:-20,width:150,height:150,borderRadius:"50%",background:"rgba(255,255,255,.05)"}}/>
<div style={{position:"relative",zIndex:1,display:"flex",alignItems:"center",gap:20}}>
{/* Avatar */}
<div style={{width:76,height:76,borderRadius:"50%",border:"3px solid rgba(255,255,255,.4)",overflow:"hidden",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
{cu.avatar?<img src={cu.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:32,fontWeight:800}}>{(rtl?(cu.fa||cu.fn):cu.fn).charAt(0)}</span>}
</div>
<div style={{flex:1,minWidth:0}}>
<div style={{fontSize:15,opacity:.8,marginBottom:6}}>{greeting} 👋</div>
<div style={{fontSize:32,fontWeight:800,marginBottom:4,lineHeight:1.2}}>{rtl?(cu.fa||cu.fn):cu.fn}</div>
<div style={{fontSize:13,opacity:.7,marginTop:2}}>{cu.role==="admin"?t.adminR:cu.role==="manager"?t.manager:t.cashier} · {new Date().toLocaleDateString(rtl?"ar":"en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
</div>
</div></div>

{/* Weather + Date & Time Card */}
{(()=>{
const wInfo={0:{icon:"☀️",en:"Clear Sky",ar:"صافٍ"},1:{icon:"🌤️",en:"Mostly Clear",ar:"غالباً صافٍ"},2:{icon:"⛅",en:"Partly Cloudy",ar:"غائم جزئياً"},3:{icon:"☁️",en:"Overcast",ar:"غائم"},45:{icon:"🌫️",en:"Foggy",ar:"ضبابي"},48:{icon:"🌫️",en:"Fog",ar:"ضباب"},51:{icon:"🌦️",en:"Light Drizzle",ar:"رذاذ خفيف"},53:{icon:"🌧️",en:"Drizzle",ar:"رذاذ"},55:{icon:"🌧️",en:"Heavy Drizzle",ar:"رذاذ غزير"},61:{icon:"🌧️",en:"Light Rain",ar:"مطر خفيف"},63:{icon:"🌧️",en:"Rain",ar:"ممطر"},65:{icon:"🌧️",en:"Heavy Rain",ar:"أمطار غزيرة"},71:{icon:"🌨️",en:"Light Snow",ar:"ثلج خفيف"},73:{icon:"🌨️",en:"Snow",ar:"ثلوج"},75:{icon:"❄️",en:"Heavy Snow",ar:"ثلوج غزيرة"},80:{icon:"🌦️",en:"Showers",ar:"زخات"},81:{icon:"🌧️",en:"Heavy Showers",ar:"زخات غزيرة"},95:{icon:"⛈️",en:"Thunderstorm",ar:"عاصفة رعدية"}};
const wc=weather?.current?.weather_code||0;
const wi=wInfo[wc]||wInfo[Math.floor(wc/10)*10]||{icon:"🌡️",en:"--",ar:"--"};
const temp=weather?.current?Math.round(weather.current.temperature_2m):null;
const humid=weather?.current?.relative_humidity_2m;
const wind=weather?.current?Math.round(weather.current.wind_speed_10m):null;
const hi=weather?.daily?.temperature_2m_max?.[0]?Math.round(weather.daily.temperature_2m_max[0]):null;
const lo=weather?.daily?.temperature_2m_min?.[0]?Math.round(weather.daily.temperature_2m_min[0]):null;
const forecast=weather?.daily?.temperature_2m_max?weather.daily.temperature_2m_max.slice(1,3).map((mx,i)=>{
const fc=weather.daily.weather_code?.[i+1]||0;
const fi=wInfo[fc]||wInfo[Math.floor(fc/10)*10]||{icon:"🌡️"};
const dayName=new Date(Date.now()+(i+1)*86400000).toLocaleDateString(rtl?"ar":"en-US",{weekday:"short"});
return{day:dayName,hi:Math.round(mx),lo:Math.round(weather.daily.temperature_2m_min[i+1]),icon:fi.icon}
}):[];

return<div style={{background:"linear-gradient(135deg,#0c4a6e,#0ea5e9,#38bdf8)",borderRadius:20,padding:"20px 24px",color:"#fff",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>

{/* Live Date & Time */}
<div style={{display:"flex",alignItems:"center",gap:16}}>
<div>
<div style={{fontSize:42,fontWeight:800,fontFamily:"var(--m)",lineHeight:1,letterSpacing:-2}}>
{clockTime.toLocaleTimeString(rtl?"ar":"en-US",{hour:"2-digit",minute:"2-digit",hour12:true}).replace(/ /g,"")}
</div>
<div style={{fontSize:11,opacity:.7,fontFamily:"var(--m)",marginTop:2}}>
:{clockTime.toLocaleTimeString("en-US",{second:"2-digit"}).split(":").pop().replace(/\D/g,"")}s
</div>
<div style={{fontSize:13,opacity:.9,marginTop:6}}>
{clockTime.toLocaleDateString(rtl?"ar":"en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
</div>
<div style={{fontSize:11,opacity:.6,marginTop:2}}>📍 {rtl?"إربد":"Irbid"}, {rtl?"الأردن":"Jordan"}</div>
</div>
</div>

{/* Weather */}
{temp!==null&&<div style={{display:"flex",alignItems:"center",gap:14}}>
<div style={{fontSize:48,lineHeight:1}}>{wi.icon}</div>
<div>
<div style={{fontSize:36,fontWeight:800,fontFamily:"var(--m)",lineHeight:1}}>{temp}°C</div>
<div style={{fontSize:13,opacity:.9,marginTop:2}}>{rtl?wi.ar:wi.en}</div>
</div>
</div>}

{/* Details + Forecast */}
<div style={{display:"flex",gap:14,alignItems:"center"}}>
{humid!=null&&<div style={{textAlign:"center"}}>
<div style={{fontSize:10,opacity:.7}}>💧</div>
<div style={{fontSize:14,fontWeight:700}}>{humid}%</div>
<div style={{fontSize:9,opacity:.6}}>{rtl?"رطوبة":"Humidity"}</div>
</div>}
{wind!=null&&<div style={{textAlign:"center"}}>
<div style={{fontSize:10,opacity:.7}}>💨</div>
<div style={{fontSize:14,fontWeight:700}}>{wind}<span style={{fontSize:9}}> km/h</span></div>
<div style={{fontSize:9,opacity:.6}}>{rtl?"رياح":"Wind"}</div>
</div>}
{hi!==null&&<div style={{textAlign:"center"}}>
<div style={{fontSize:10,opacity:.7}}>🌡️</div>
<div style={{fontSize:14,fontWeight:700}}>{hi}°<span style={{opacity:.6,fontSize:11}}>/{lo}°</span></div>
<div style={{fontSize:9,opacity:.6}}>H/L</div>
</div>}
{forecast.length>0&&<div style={{borderLeft:"1px solid rgba(255,255,255,.3)",paddingLeft:14,display:"flex",gap:12}}>
{forecast.map((f,i)=><div key={i} style={{textAlign:"center"}}>
<div style={{fontSize:9,opacity:.7}}>{f.day}</div>
<div style={{fontSize:18}}>{f.icon}</div>
<div style={{fontSize:11,fontWeight:700}}>{f.hi}°<span style={{opacity:.5,fontSize:9}}>/{f.lo}°</span></div>
</div>)}
</div>}
</div>
</div>})()}

{/* Clock In/Out — Separate Card */}
<div style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:20,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
<div style={{display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0}}>
<div style={{width:48,height:48,borderRadius:14,background:myAtt&&myAtt.clock_in&&!myAtt.clock_out?"#ecfdf5":myAtt&&myAtt.clock_out?"#eff6ff":"#f9fafb",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>🕐</div>
<div style={{minWidth:0}}>
<div style={{fontSize:15,fontWeight:700,color:"#374151",marginBottom:2}}>{t.attendance}</div>
{myAtt&&myAtt.clock_in&&!myAtt.clock_out?<div style={{fontSize:13,color:"#059669",fontWeight:600}}>✓ {t.clockedIn}: {new Date(myAtt.clock_in).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
:myAtt&&myAtt.clock_out?<div style={{fontSize:13,color:"#6b7280"}}>{new Date(myAtt.clock_in).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} → {new Date(myAtt.clock_out).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} · <strong style={{color:"#2563eb"}}>{myAtt.hours_worked}h</strong></div>
:<div style={{fontSize:13,color:"#9ca3af"}}>{rtl?"لم يتم تسجيل الحضور بعد":"Not clocked in yet"}</div>}
</div>
</div>
<div style={{flexShrink:0}}>
{myAtt&&myAtt.clock_in&&!myAtt.clock_out?
<button onClick={async()=>{try{const a=await DB.clockOut(cu.id);setMyAtt(a);sT("✓ "+t.clockedOut,"ok")}catch{}}} style={{padding:"12px 32px",background:"#dc2626",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",boxShadow:"0 4px 12px rgba(220,38,38,.3)"}}>🔴 {t.clockOut}</button>
:myAtt&&myAtt.clock_out?
<div style={{padding:"10px 24px",background:"#eff6ff",borderRadius:12,color:"#2563eb",fontSize:13,fontWeight:600}}>✓ {rtl?"انتهت الوردية":"Shift Complete"}</div>
:<button onClick={async()=>{try{const a=await DB.clockIn(cu.id);setMyAtt(a);sT("✓ "+t.clockedIn,"ok")}catch{}}} style={{padding:"12px 32px",background:"#059669",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",boxShadow:"0 4px 12px rgba(5,150,105,.3)"}}>🟢 {t.clockIn}</button>}
</div>
</div>

{/* Shift Status — Prominent Card */}
{!activeShift?<div style={{background:"linear-gradient(135deg,#fef3c7,#fffbeb)",border:"2px solid #f59e0b",borderRadius:20,padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
<div style={{display:"flex",alignItems:"center",gap:14}}>
<div style={{fontSize:40}}>🔒</div>
<div>
<div style={{fontSize:17,fontWeight:800,color:"#92400e"}}>{rtl?"لا يوجد وردية مفتوحة":"No Active Shift"}</div>
<div style={{fontSize:13,color:"#a16207"}}>{rtl?"افتح وردية لبدء البيع":"Open a shift to start selling"}</div>
</div>
</div>
<button onClick={()=>setTab("regClose")} style={{padding:"12px 28px",background:"#059669",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",boxShadow:"0 4px 12px rgba(5,150,105,.3)",whiteSpace:"nowrap"}}>🟢 {rtl?"فتح وردية":"Open Shift"}</button>
</div>
:<div style={{background:"linear-gradient(135deg,#d1fae5,#ecfdf5)",border:"2px solid #34d399",borderRadius:20,padding:"20px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
<div style={{display:"flex",alignItems:"center",gap:14}}>
<div style={{fontSize:40}}>✅</div>
<div>
<div style={{fontSize:17,fontWeight:800,color:"#065f46"}}>{rtl?"وردية نشطة":"Shift Active"}</div>
<div style={{fontSize:13,color:"#047857"}}>{activeShift.cashier_name} · {rtl?"بدأت":"Started"} {new Date(activeShift.shift_start).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} · {rtl?"الافتتاحي":"Opening"}: {fm(+activeShift.opening_balance)}</div>
<div style={{fontSize:11,color:"#065f46",marginTop:4,fontWeight:600}}>
  ⏱️ {(()=>{const diff=new Date()-new Date(activeShift.shift_start);const h=Math.floor(diff/3600000);const m=Math.floor((diff%3600000)/60000);return rtl?`مدة الوردية: ${h} ساعة ${m} دقيقة`:`Shift duration: ${h}h ${m}m`;})()}
</div>
<div style={{fontSize:10,color:"#065f46",marginTop:2,fontStyle:"italic"}}>
  💡 {rtl?"الوردية تبقى مفتوحة حتى تُغلقها يدوياً (حتى بعد تسجيل الخروج)":"Shift stays open until manually closed (even after logout)"}
</div>
</div>
</div>
<button onClick={()=>setTab("sale")} style={{padding:"12px 28px",background:"#1e40af",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",boxShadow:"0 4px 12px rgba(30,64,175,.3)",whiteSpace:"nowrap"}}>🛒 {rtl?"ابدأ البيع":"Start Selling"}</button>
</div>}

{/* Re-order Alerts */}
{(()=>{const lowItems=prods.filter(p=>p.s>0&&p.s<10);return lowItems.length>0&&<div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:16,padding:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<span style={{fontSize:14,fontWeight:700,color:"#991b1b"}}>🔔 {rtl?"تنبيه إعادة الطلب":"Re-order Alert"} ({lowItems.length})</span>
<button onClick={()=>{const csv=["Product,Barcode,Stock,Suggested"];lowItems.forEach(p=>csv.push('"'+pN(p)+'","'+p.bc+'",'+p.s+","+(50-p.s)));const b=new Blob([csv.join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="reorder-"+new Date().toISOString().slice(0,10)+".csv";a.click()}} style={{padding:"4px 12px",background:"#dc2626",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📥 {rtl?"تصدير":"Export"}</button>
</div>
{lowItems.slice(0,5).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
<span>{p.e} {pN(p)}</span>
<span style={{fontFamily:"var(--m)",fontWeight:700,color:"#dc2626"}}>{p.s} {rtl?"متبقي":"left"}</span>
</div>)}
{lowItems.length>5&&<div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>+{lowItems.length-5} {rtl?"أخرى":"more"}</div>}
</div>})()}

{/* Top Sellers This Week */}
{txns.length>0&&(()=>{const week=txns.filter(tx=>{try{const d=new Date();d.setDate(d.getDate()-7);return new Date(tx.ts)>=d}catch{return false}});const pm={};week.forEach(tx=>tx.items.forEach(i=>{if(!pm[i.id])pm[i.id]={name:pN(i),qty:0,rev:0};pm[i.id].qty+=i.qty;pm[i.id].rev+=i.p*i.qty}));const top=Object.values(pm).sort((a,b)=>b.qty-a.qty).slice(0,5);return top.length>0&&<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:16}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:10}}>🔥 {rtl?"الأكثر مبيعاً هذا الأسبوع":"Top Sellers This Week"}</div>
{top.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<top.length-1?"1px solid #f3f4f6":"none"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<span style={{width:20,height:20,borderRadius:"50%",background:i===0?"#fbbf24":i===1?"#9ca3af":i===2?"#d97706":"#e5e7eb",color:"#fff",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</span>
<span style={{fontSize:13,fontWeight:600}}>{p.name}</span>
</div>
<div style={{textAlign:"right"}}><div style={{fontFamily:"var(--m)",fontSize:13,fontWeight:700,color:"#059669"}}>{fm(p.rev)}</div><div style={{fontSize:10,color:"#9ca3af"}}>{p.qty} {rtl?"قطعة":"pcs"}</div></div>
</div>)}
</div>})()}

{/* Today's Progress Bar */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:20,padding:20}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<div style={{fontSize:14,fontWeight:700,color:"#374151"}}>📊 {t.today} — {rtl?"تقدم المبيعات":"Sales Progress"}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(todayTotal)}</div>
</div>
<div style={{height:12,background:"#f3f4f6",borderRadius:6,overflow:"hidden",marginBottom:8}}>
<div style={{height:"100%",width:pct+"%",background:"linear-gradient(90deg,#059669,#10b981)",borderRadius:6,transition:"width 1s ease"}}/>
</div>
<div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af"}}>
<span>{pct.toFixed(0)}% {rtl?"من الهدف":"of target"}</span>
<span>{rtl?"الهدف":"Target"}: {fm(targetDaily)}</span>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginTop:14}}>
<div style={{textAlign:"center",padding:10,background:"#ecfdf5",borderRadius:12}}><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{todayCount}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.txns}</div></div>
<div style={{textAlign:"center",padding:10,background:"#eff6ff",borderRadius:12}}><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{todayItemsSold}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.sold}</div></div>
<div style={{textAlign:"center",padding:10,background:"#f5f3ff",borderRadius:12}}><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{todayCount>0?fm(todayTotal/todayCount):"0.000"}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.avgTxn}</div></div>
</div></div>

{/* Quick Actions Grid */}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>
{[{icon:"🛒",label:t.newSale,color:"#059669",bg:"#ecfdf5",act:()=>setTab("sale"),show:true},
{icon:"📊",label:t.dashboard,color:"#2563eb",bg:"#eff6ff",act:()=>setTab("dashboard"),show:hasP("dashboard")},
{icon:"📋",label:t.salesView,color:"#7c3aed",bg:"#f5f3ff",act:()=>setTab("sales"),show:hasP("sales_view")},
{icon:"📦",label:t.inventory,color:"#d97706",bg:"#fffbeb",act:()=>{setTab("admin");setAT("inventory")},show:hasP("inventory")},
{icon:"💰",label:t.finance,color:"#dc2626",bg:"#fef2f2",act:()=>setTab("finance"),show:hasP("finance")},
{icon:"🏢",label:t.hr,color:"#0891b2",bg:"#ecfeff",act:()=>setTab("hr"),show:hasP("hr")},
{icon:"📥",label:t.excel,color:"#374151",bg:"#f9fafb",act:()=>exportXL(prods,txns,invs),show:hasP("excel_export")}
].filter(x=>x.show).map((a,i)=><button key={i} onClick={a.act} style={{padding:18,background:a.bg,border:"1.5px solid transparent",borderRadius:16,cursor:"pointer",fontFamily:"var(--f)",textAlign:"center",transition:"all .2s",display:"flex",flexDirection:"column",alignItems:"center",gap:6}} onMouseOver={e=>e.currentTarget.style.borderColor=a.color} onMouseOut={e=>e.currentTarget.style.borderColor="transparent"}><div style={{fontSize:32}}>{a.icon}</div><div style={{fontSize:12,fontWeight:700,color:a.color}}>{a.label}</div></button>)}
</div>

{/* Alerts Row */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
{/* Low Stock Alert */}
<div style={{background:prods.filter(p=>p.s<30).length>0?"#fffbeb":"#ecfdf5",border:"1.5px solid "+(prods.filter(p=>p.s<30).length>0?"#fcd34d":"#d1fae5"),borderRadius:16,padding:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<span style={{fontSize:13,fontWeight:700,color:prods.filter(p=>p.s<30).length>0?"#92400e":"#065f46"}}>📦 {t.lowStock}</span>
<span style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:prods.filter(p=>p.s<30).length>0?"#d97706":"#059669"}}>{prods.filter(p=>p.s<30).length}</span>
</div>
{prods.filter(p=>p.s<30).slice(0,4).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",color:"#6b7280"}}><span>{p.e} {pN(p)}</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:p.s<10?"#dc2626":"#d97706"}}>{p.s}</span></div>)}
{prods.filter(p=>p.s<30).length>4&&<div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>+{prods.filter(p=>p.s<30).length-4} {rtl?"أخرى":"more"}</div>}
</div>

{/* Expiring Items Alert */}
<div style={{background:expiringProds.length>0?"#fef2f2":"#ecfdf5",border:"1.5px solid "+(expiringProds.length>0?"#fecaca":"#d1fae5"),borderRadius:16,padding:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<span style={{fontSize:13,fontWeight:700,color:expiringProds.length>0?"#991b1b":"#065f46"}}>⏰ {t.expiringItems}</span>
<span style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:expiringProds.length>0?"#dc2626":"#059669"}}>{expiringProds.length}</span>
</div>
{expiringProds.slice(0,4).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",color:"#6b7280"}}><span>{p.e} {pN(p)}</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:p.daysLeft<=0?"#dc2626":p.daysLeft<=7?"#ea580c":"#d97706"}}>{p.daysLeft<=0?t.expired:p.daysLeft+" "+t.daysLeft}</span></div>)}
{expiringProds.length===0&&<div style={{textAlign:"center",color:"#059669",fontSize:11,padding:8}}>✓ {rtl?"لا منتجات منتهية":"All products fresh"}</div>}
</div>
</div>

{/* System Stats */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:14,textAlign:"center"}}><div style={{fontSize:28,marginBottom:4}}>🛒</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{tC}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.txns}</div></div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:14,textAlign:"center"}}><div style={{fontSize:28,marginBottom:4}}>👥</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{customers.length}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.customers}</div></div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:14,textAlign:"center"}}><div style={{fontSize:28,marginBottom:4}}>📦</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{prods.length}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.inventory}</div></div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:14,textAlign:"center"}}><div style={{fontSize:28,marginBottom:4}}>💰</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(tT)}</div><div style={{fontSize:10,color:"#6b7280"}}>{t.totalSales}</div></div>
</div>

{/* Recent Transactions — Scrollable */}
<div className="tb" style={{minHeight:0}}><div className="tbh"><span>🕐 {t.recentActivity}</span></div><div style={{maxHeight:250,overflowY:"auto"}}><table><thead><tr><th>{t.receipt}</th><th>{t.time}</th><th>👤</th><th>{t.method}</th><th>{t.total}</th></tr></thead><tbody>{txns.slice(0,20).map(tx=><tr key={tx.id} style={{cursor:"pointer"}} onClick={()=>openReceiptWithItems(tx)}><td className="mn" style={{fontSize:11}}>{tx.rn}</td><td style={{fontSize:11}}>{tx.date} {tx.time}</td><td style={{fontSize:11,color:tx.custName?"#2563eb":"#d1d5db"}}>{tx.custName||"—"}</td><td><span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:tx.method==="cash"?"#ecfdf5":tx.method==="card"?"#eff6ff":"#f5f3ff",color:tx.method==="cash"?"#059669":tx.method==="card"?"#2563eb":"#7c3aed"}}>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</span></td><td className="mn" style={{color:"#059669"}}>{fm(tx.tot)}</td></tr>)}</tbody></table></div></div>
</div>})()}

{/* HR MODULE */}
{tab==="hr"&&<div className="ad"><div className="ads">
<button className={"asb "+(hrTab==="contracts"?"a":"")} onClick={()=>setHrTab("contracts")}>📄 {t.contracts}</button>
<button className={"asb "+(hrTab==="salaries"?"a":"")} onClick={()=>setHrTab("salaries")}>💰 {t.salaries}</button>
<button className={"asb "+(hrTab==="bonus"?"a":"")} onClick={()=>setHrTab("bonus")}>🏆 {t.bonusProgram}</button>
<button className={"asb "+(hrTab==="leaves"?"a":"")} onClick={()=>setHrTab("leaves")}>🏖️ {t.leaves}</button>
<button className={"asb "+(hrTab==="attendance"?"a":"")} onClick={()=>setHrTab("attendance")}>🕐 {t.attendance}</button>
</div><div className="ac">

{/* CONTRACTS */}
{hrTab==="contracts"&&<><h2>📄 {t.contracts}</h2>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{setContractMod(true);setNewContract({user_id:"",contract_type:"full-time",start_date:"",end_date:"",basic_salary:"",housing_allowance:"",transport_allowance:"",other_allowance:"",working_hours_per_day:8,working_days_per_week:6,annual_leave_days:21,notes:""})}}>{t.addContract}</button>
{!contracts.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>{t.noContracts}</div>:
<table className="at"><thead><tr><th>{t.employee}</th><th>{t.contractType}</th><th>{t.startDate}</th><th>{t.endDate}</th><th>{t.basicSalary}</th><th>{t.totalSalary}</th><th>{t.act}</th></tr></thead>
<tbody>{contracts.map(c=>{const u=users.find(x=>x.id===c.user_id);return<tr key={c.id}>
<td style={{fontWeight:600}}>{u?(rtl?(u.fa||u.fn):u.fn):"—"}</td>
<td><span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:600,background:c.contract_type==="full-time"?"#ecfdf5":c.contract_type==="part-time"?"#eff6ff":"#fffbeb",color:c.contract_type==="full-time"?"#059669":c.contract_type==="part-time"?"#2563eb":"#d97706"}}>{t[c.contract_type==="full-time"?"fullTime":c.contract_type==="part-time"?"partTime":c.contract_type==="temporary"?"temporary":"probation"]}</span></td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{c.start_date}</td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{c.end_date||"—"}</td>
<td className="mn" style={{color:"#374151"}}>{fm(+c.basic_salary)}</td>
<td className="mn" style={{color:"#059669",fontWeight:700}}>{fm(+c.total_salary)}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:c.status==="active"?"#ecfdf5":"#fef2f2",color:c.status==="active"?"#059669":"#dc2626"}}>{c.status}</span>
{cu.role==="admin"&&<button className="ab ab-d" style={{marginLeft:4,fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف العقد؟":"Delete contract?"))return;setContracts(p=>p.filter(x=>x.id!==c.id));try{await DB.deleteContract(c.id)}catch{}}}>✕</button>}</td>
</tr>})}</tbody></table>}
</>}

{/* SALARIES */}
{hrTab==="salaries"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>💰 {t.salaries}</h2>
<ExportButtons title={rtl?"تقرير الرواتب":"Salaries Report"} getExportData={()=>{
  const headers=[rtl?"الموظف":"Employee",rtl?"الشهر":"Month",rtl?"السنة":"Year",rtl?"الأساسي":"Basic",rtl?"إضافي":"Overtime",rtl?"مكافأة":"Bonus",rtl?"خصومات":"Deductions",rtl?"الصافي":"Net",rtl?"الحالة":"Status",rtl?"طريقة":"Method"];
  const rows=salaries.map(s=>{const c=contracts.find(x=>x.id===s.contract_id);const emp=c?c.employee_name:"—";return [emp,s.month||"—",s.year||"—",(+s.basic_salary).toFixed(3),(+(s.overtime_pay||0)).toFixed(3),(+(s.bonus||0)).toFixed(3),(+(s.deductions||0)).toFixed(3),(+s.net_salary).toFixed(3),s.status||"—",s.payment_method||"—"]});
  const total=salaries.reduce((s,x)=>s+ +x.net_salary,0);
  const paidCount=salaries.filter(s=>s.status==="paid").length;
  const summary=[
    {label:rtl?"عدد الرواتب":"Records",value:salaries.length,color:"#1e40af"},
    {label:rtl?"المدفوع":"Paid",value:paidCount,color:"#059669"},
    {label:rtl?"الإجمالي":"Total",value:fm(total),color:"#dc2626"},
    {label:rtl?"المعلقة":"Pending",value:salaries.filter(s=>s.status==="pending").length,color:"#d97706"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:true};
}}/></div>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{setSalaryMod(true);setNewSalary({user_id:"",month:"",year:new Date().getFullYear(),basic_salary:"",allowances:"",deductions:"",overtime_hours:"",bonus:"",payment_method:"bank",notes:""})}}>{t.addSalary}</button>
{!salPayments.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>{t.noSalaries}</div>:
<table className="at"><thead><tr><th>{t.employee}</th><th>{t.payMonth}</th><th>{t.basicSalary}</th><th>{t.deductions}</th><th>{t.bonus}</th><th>{t.netSalary}</th><th>{t.act}</th></tr></thead>
<tbody>{salPayments.map(s=>{const u=users.find(x=>x.id===s.user_id);return<tr key={s.id}>
<td style={{fontWeight:600}}>{u?(rtl?(u.fa||u.fn):u.fn):"—"}</td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{s.month}/{s.year}</td>
<td className="mn">{fm(+s.basic_salary)}</td>
<td className="mn" style={{color:"#dc2626"}}>{+s.deductions>0?"-"+fm(+s.deductions):"—"}</td>
<td className="mn" style={{color:"#059669"}}>{+s.bonus>0?"+"+fm(+s.bonus):"—"}</td>
<td className="mn" style={{color:"#059669",fontWeight:700}}>{fm(+s.net_salary)}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:s.status==="paid"?"#ecfdf5":s.status==="pending"?"#fffbeb":"#fef2f2",color:s.status==="paid"?"#059669":s.status==="pending"?"#d97706":"#dc2626"}}>{t[s.status]}</span>
{s.status==="pending"&&<button className="ab ab-s" style={{marginLeft:4,fontSize:9}} onClick={async()=>{const empName=u?(rtl?(u.fa||u.fn):u.fn):"Employee";setSalPayments(p=>p.map(x=>x.id===s.id?{...x,status:"paid",payment_date:new Date().toISOString().slice(0,10)}:x));try{await DB.updateSalary(s.id,{status:"paid",payment_date:new Date().toISOString().slice(0,10)});const salCat=expCats.find(c=>c.name==="Salaries")||expCats[0];if(salCat){const exp={category_id:salCat.id,amount:+s.net_salary,description:"Salary "+s.month+"/"+s.year+" — "+empName,payment_method:s.payment_method||"bank",expense_date:new Date().toISOString().slice(0,10),recurring:"none",created_by:cu?.id};const r=await DB.addExpense(exp);if(r)setExpensesList(p=>[r,...p])}}catch{}sT("✓ "+t.paid,"ok")}}>{t.markPaid}</button>}
{cu.role==="admin"&&<button className="ab ab-d" style={{marginLeft:4,fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف هذا السجل؟":"Delete this record?"))return;setSalPayments(p=>p.filter(x=>x.id!==s.id));try{await DB.deleteSalary(s.id)}catch{}}}>✕</button>}</td>
</tr>})}</tbody></table>}
</>}

{/* LEAVES */}
{hrTab==="leaves"&&<><h2>🏖️ {t.leaves}</h2>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{setLeaveMod(true);setNewLeave({user_id:"",leave_type:"annual",start_date:"",end_date:"",reason:""})}}>{t.addLeave}</button>
{!leaveReqs.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>{t.noLeaves}</div>:
<table className="at"><thead><tr><th>{t.employee}</th><th>{t.leaveType}</th><th>{t.startDate}</th><th>{t.endDate}</th><th>{t.leaveDays}</th><th>{t.leaveReason}</th><th>{t.act}</th></tr></thead>
<tbody>{leaveReqs.map(l=>{const u=users.find(x=>x.id===l.user_id);return<tr key={l.id}>
<td style={{fontWeight:600}}>{u?(rtl?(u.fa||u.fn):u.fn):"—"}</td>
<td><span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:600,background:l.leave_type==="annual"?"#eff6ff":l.leave_type==="sick"?"#fef2f2":"#fffbeb",color:l.leave_type==="annual"?"#2563eb":l.leave_type==="sick"?"#dc2626":"#d97706"}}>{t[l.leave_type==="annual"?"annual":l.leave_type==="sick"?"sick":l.leave_type==="unpaid"?"unpaid":l.leave_type==="emergency"?"emergency":"otherLeave"]}</span></td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{l.start_date}</td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{l.end_date}</td>
<td className="mn">{l.days}</td>
<td style={{fontSize:11,color:"#6b7280",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{l.reason||"—"}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:l.status==="approved"?"#ecfdf5":l.status==="pending"?"#fffbeb":"#fef2f2",color:l.status==="approved"?"#059669":l.status==="pending"?"#d97706":"#dc2626"}}>{t[l.status]}</span>
{l.status==="pending"&&cu.role==="admin"&&<><button className="ab ab-s" style={{marginLeft:4,fontSize:9}} onClick={async()=>{setLeaveReqs(p=>p.map(x=>x.id===l.id?{...x,status:"approved",approved_by:cu.id}:x));try{await DB.updateLeave(l.id,{status:"approved",approved_by:cu.id})}catch{}sT("✓ "+t.approved,"ok")}}>{t.approve}</button><button className="ab ab-d" style={{marginLeft:2,fontSize:9}} onClick={async()=>{setLeaveReqs(p=>p.map(x=>x.id===l.id?{...x,status:"rejected"}:x));try{await DB.updateLeave(l.id,{status:"rejected"})}catch{}}}>{t.reject}</button></>}
{cu.role==="admin"&&<button className="ab ab-d" style={{marginLeft:4,fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setLeaveReqs(p=>p.filter(x=>x.id!==l.id));try{await DB.deleteLeave(l.id)}catch{}}}>✕</button>}</td>
</tr>})}</tbody></table>}
</>}

{/* ATTENDANCE */}
{hrTab==="attendance"&&<><h2>🕐 {t.attendance}</h2>
<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={async()=>{try{const a=await DB.getAttendance();setAttRecords(a);sT("✓ Refreshed","ok")}catch{}}}>🔄 {t.todayAtt}</button>
{attRecords.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40}}>🕐</div>{rtl?"لا سجلات حضور اليوم":"No attendance records today"}</div>:
<table className="at"><thead><tr><th>{t.employee}</th><th>{t.clockIn}</th><th>{t.clockOut}</th><th>{t.hoursWorked}</th><th>{t.act}</th></tr></thead>
<tbody>{attRecords.map(a=>{const u=users.find(x=>x.id===a.user_id);return<tr key={a.id}>
<td style={{fontWeight:600}}>{u?(rtl?(u.fa||u.fn):u.fn):"ID:"+a.user_id}</td>
<td style={{fontFamily:"var(--m)",color:"#059669"}}>{a.clock_in?new Date(a.clock_in).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}):"—"}</td>
<td style={{fontFamily:"var(--m)",color:a.clock_out?"#dc2626":"#d1d5db"}}>{a.clock_out?new Date(a.clock_out).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}):"—"}</td>
<td className="mn">{a.hours_worked?a.hours_worked+"h":"—"}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:a.status==="present"?"#ecfdf5":a.status==="late"?"#fffbeb":"#fef2f2",color:a.status==="present"?"#059669":a.status==="late"?"#d97706":"#dc2626"}}>{t[a.status]||a.status}</span>
{cu.role==="admin"&&<button className="ab ab-d" style={{marginLeft:4,fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setAttRecords(p=>p.filter(x=>x.id!==a.id));try{await DB.deleteAttendance(a.id)}catch{}}}>✕</button>}</td>
</tr>})}</tbody></table>}
</>}

{/* BONUS PROGRAM */}
{hrTab==="bonus"&&(()=>{
// Calculate each employee's performance this month
const now=new Date();const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
const empPerf=users.filter(u=>u.st==="active").map(u=>{
  // Sales by this cashier
  const empTxns=txns.filter(tx=>tx.cashierName===(rtl?(u.fa||u.fn):u.fn)||tx.cashierId===u.id);
  const monthTxns=empTxns.filter(tx=>{try{return new Date(tx.ts)>=monthStart}catch{return false}});
  const monthRev=monthTxns.reduce((s,tx)=>s+tx.tot,0);
  const monthCount=monthTxns.length;
  const monthItems=monthTxns.reduce((s,tx)=>s+tx.items.reduce((a,i)=>a+i.qty,0),0);
  // Bonuses earned from salary payments
  const empBonuses=salPayments.filter(s=>s.user_id===u.id&&+s.bonus>0);
  const totalBonusEarned=empBonuses.reduce((s,p)=>s+ +p.bonus,0);
  // Calculate auto-bonuses
  const salesBonusAmt=bonusRules.salesPerTxn>0?+(monthCount*bonusRules.salesPerTxn).toFixed(3):0;
  const hitTarget=monthRev>=bonusRules.salesThreshold;
  const targetBonusAmt=hitTarget?bonusRules.salesReward:0;
  const suggestedBonus=+(salesBonusAmt+targetBonusAmt).toFixed(3);
  return{...u,monthRev,monthCount,monthItems,totalBonusEarned,salesBonusAmt,targetBonusAmt,suggestedBonus,hitTarget};
}).sort((a,b)=>b.monthRev-a.monthRev);

const topEmp=empPerf[0];

return<>
<h2>🏆 {t.bonusProgram}</h2>
<div style={{display:"flex",gap:8,marginBottom:14}}>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>{setBonusMod(true);setNewBonus({user_id:"",amount:"",reason:"",type:"custom"})}}>{t.awardBonus}</button>
<button className="ab ab-e" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setBonusEditRules(true)}>⚙️ {t.editRules}</button>
</div>

{/* Bonus Rules Summary */}
<div style={{background:"linear-gradient(135deg,#fffbeb,#fef3c7)",border:"1.5px solid #fcd34d",borderRadius:16,padding:16,marginBottom:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#92400e",marginBottom:10}}>📋 {t.bonusRules}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
<div style={{background:"#fff",borderRadius:12,padding:12,textAlign:"center"}}>
<div style={{fontSize:24,marginBottom:4}}>🛒</div>
<div style={{fontSize:11,fontWeight:700,color:"#374151"}}>{t.salesBonus}</div>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fN(bonusRules.salesPerTxn)} JD</div>
<div style={{fontSize:9,color:"#6b7280"}}>{t.perTxn}</div>
</div>
<div style={{background:"#fff",borderRadius:12,padding:12,textAlign:"center"}}>
<div style={{fontSize:24,marginBottom:4}}>🎯</div>
<div style={{fontSize:11,fontWeight:700,color:"#374151"}}>{t.performanceBonus}</div>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{fN(bonusRules.salesReward)} JD</div>
<div style={{fontSize:9,color:"#6b7280"}}>{t.ifAbove} {fN(bonusRules.salesThreshold)} JD</div>
</div>
<div style={{background:"#fff",borderRadius:12,padding:12,textAlign:"center"}}>
<div style={{fontSize:24,marginBottom:4}}>📅</div>
<div style={{fontSize:11,fontWeight:700,color:"#374151"}}>{t.attendanceBonus}</div>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{fN(bonusRules.attendanceReward)} JD</div>
<div style={{fontSize:9,color:"#6b7280"}}>≥{bonusRules.attendanceTarget} {t.daysPresent}</div>
</div>
</div>
</div>

{/* Top Seller Highlight */}
{topEmp&&topEmp.monthRev>0&&<div style={{background:"linear-gradient(135deg,#1e3a5f,#2563eb,#7c3aed)",borderRadius:20,padding:20,color:"#fff",marginBottom:14,display:"flex",alignItems:"center",gap:16}}>
<div style={{width:64,height:64,borderRadius:"50%",border:"3px solid rgba(255,255,255,.4)",overflow:"hidden",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
{topEmp.avatar?<img src={topEmp.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:28,fontWeight:800}}>🏆</span>}
</div>
<div style={{flex:1}}>
<div style={{fontSize:11,opacity:.7}}>{t.topSeller} — {t.thisMonth}</div>
<div style={{fontSize:22,fontWeight:800}}>{rtl?(topEmp.fa||topEmp.fn):topEmp.fn}</div>
<div style={{fontSize:12,opacity:.8,marginTop:2}}>{topEmp.monthCount} {t.txns.toLowerCase()} · {topEmp.monthItems} {t.items.toLowerCase()}</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)"}}>{fm(topEmp.monthRev)}</div>
<div style={{fontSize:10,opacity:.7}}>{t.salesAchieved}</div>
</div>
</div>}

{/* Employee Performance Cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:14}}>
{empPerf.map((emp,idx)=><div key={emp.id} style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:16,padding:16,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,right:0,height:4,background:idx===0&&emp.monthRev>0?"linear-gradient(90deg,#d97706,#f59e0b)":"linear-gradient(90deg,#e5e7eb,#d1d5db)"}}/>

<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,marginTop:4}}>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<div style={{width:40,height:40,borderRadius:"50%",overflow:"hidden",background:"linear-gradient(135deg,#2563eb,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
{emp.avatar?<img src={emp.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{color:"#fff",fontWeight:800,fontSize:15}}>{(rtl?(emp.fa||emp.fn):emp.fn).charAt(0)}</span>}
</div>
<div>
<div style={{fontSize:14,fontWeight:700,color:"#374151"}}>{rtl?(emp.fa||emp.fn):emp.fn}</div>
<div style={{fontSize:10,color:"#9ca3af"}}>{emp.role==="admin"?t.adminR:emp.role==="manager"?t.manager:t.cashier}</div>
</div>
</div>
{idx===0&&emp.monthRev>0&&<span style={{fontSize:20}}>🥇</span>}
{idx===1&&emp.monthRev>0&&<span style={{fontSize:20}}>🥈</span>}
{idx===2&&emp.monthRev>0&&<span style={{fontSize:20}}>🥉</span>}
</div>

{/* Performance metrics */}
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:12}}>
<div style={{background:"#ecfdf5",borderRadius:8,padding:8,textAlign:"center"}}><div style={{fontSize:9,color:"#065f46"}}>{t.totalSales}</div><div style={{fontSize:14,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(emp.monthRev)}</div></div>
<div style={{background:"#eff6ff",borderRadius:8,padding:8,textAlign:"center"}}><div style={{fontSize:9,color:"#1e40af"}}>{t.txnCount}</div><div style={{fontSize:14,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{emp.monthCount}</div></div>
<div style={{background:"#f5f3ff",borderRadius:8,padding:8,textAlign:"center"}}><div style={{fontSize:9,color:"#5b21b6"}}>{t.items}</div><div style={{fontSize:14,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{emp.monthItems}</div></div>
</div>

{/* Sales progress bar */}
{bonusRules.salesThreshold>0&&<div style={{marginBottom:10}}>
<div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#6b7280",marginBottom:3}}><span>{t.salesTarget}</span><span>{Math.min(100,(emp.monthRev/bonusRules.salesThreshold*100)).toFixed(0)}%</span></div>
<div style={{height:6,background:"#f3f4f6",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.min(100,(emp.monthRev/bonusRules.salesThreshold*100))+"%",background:emp.hitTarget?"#059669":"#2563eb",borderRadius:3,transition:"width .5s"}}/></div>
</div>}

{/* Suggested bonus */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:emp.suggestedBonus>0?"#ecfdf5":"#f9fafb",borderRadius:10,padding:"8px 12px"}}>
<div><div style={{fontSize:10,fontWeight:600,color:emp.suggestedBonus>0?"#065f46":"#6b7280"}}>{rtl?"مكافأة مقترحة":"Suggested Bonus"}</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{emp.salesBonusAmt>0?emp.monthCount+"×"+fN(bonusRules.salesPerTxn)+"="+fN(emp.salesBonusAmt):""}{emp.targetBonusAmt>0?" + "+fN(emp.targetBonusAmt)+" 🎯":""}</div>
</div>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:emp.suggestedBonus>0?"#059669":"#9ca3af"}}>{fm(emp.suggestedBonus)}</div>
</div>

{/* Award button */}
{emp.suggestedBonus>0&&<button onClick={()=>{setBonusMod(true);setNewBonus({user_id:emp.id,amount:emp.suggestedBonus.toString(),reason:(rtl?"مكافأة أداء — ":"Performance bonus — ")+emp.monthCount+" "+t.txns.toLowerCase()+", "+fm(emp.monthRev)+" "+t.totalSales.toLowerCase(),type:"performance"})}} style={{width:"100%",marginTop:8,padding:"8px",background:"#2563eb",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>🏆 {t.awardBonus} — {fm(emp.suggestedBonus)}</button>}

{/* Previous bonuses */}
{emp.totalBonusEarned>0&&<div style={{marginTop:8,fontSize:10,color:"#6b7280",textAlign:"center"}}>{rtl?"إجمالي المكافآت السابقة":"Total bonuses earned"}: <strong style={{color:"#059669"}}>{fm(emp.totalBonusEarned)}</strong></div>}
</div>)}
</div>

{/* Bonus History */}
<div className="tb"><div className="tbh"><span>📜 {t.bonusHistory}</span></div>
<table><thead><tr><th>{t.employee}</th><th>{t.bonusReason}</th><th>{t.bonusAmount}</th><th>{t.payMonth}</th><th>{t.act}</th></tr></thead>
<tbody>{salPayments.filter(s=>+s.bonus>0).length===0?<tr><td colSpan={5} style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{t.noBonuses}</td></tr>:salPayments.filter(s=>+s.bonus>0).map(s=>{const u=users.find(x=>x.id===s.user_id);return<tr key={s.id}>
<td style={{fontWeight:600}}>{u?(rtl?(u.fa||u.fn):u.fn):"—"}</td>
<td style={{fontSize:11,color:"#6b7280"}}>{s.notes||t.performanceBonus}</td>
<td className="mn" style={{color:"#059669",fontWeight:700}}>{fm(+s.bonus)}</td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{s.month}/{s.year}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:s.status==="paid"?"#ecfdf5":"#fffbeb",color:s.status==="paid"?"#059669":"#d97706"}}>{t[s.status]}</span></td>
</tr>})}</tbody></table></div>
</>})()}
</div></div>}

{/* BONUS AWARD MODAL */}
{bonusMod&&<div className="ov" onClick={()=>setBonusMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>🏆 {t.awardBonus}<button className="mc" onClick={()=>setBonusMod(false)}>✕</button></h2>
<div className="pf"><label>{t.employee}</label><select value={newBonus.user_id} onChange={e=>setNewBonus({...newBonus,user_id:+e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">{t.selProd}</option>{users.filter(u=>u.st==="active").map(u=><option key={u.id} value={u.id}>{u.fn} ({u.un})</option>)}</select></div>
<div className="pf"><label>{t.bonusAmount} (JD)</label><input type="number" value={newBonus.amount} onChange={e=>setNewBonus({...newBonus,amount:e.target.value})} placeholder="0.000"/></div>
<div className="pf"><label>{t.bonusReason}</label><input value={newBonus.reason} onChange={e=>setNewBonus({...newBonus,reason:e.target.value})}/></div>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"سيتم إضافة كمكافأة في معالجة الراتب":"Will be added as bonus in salary processing"}</div>
<div style={{fontSize:24,fontWeight:800,color:"#059669",fontFamily:"var(--m)"}}>{fm(parseFloat(newBonus.amount)||0)}</div>
</div>
<button className="cpb cpb-green" onClick={async()=>{if(!newBonus.user_id||!newBonus.amount)return;const empUser=users.find(u=>u.id===newBonus.user_id);const empName=empUser?(rtl?(empUser.fa||empUser.fn):empUser.fn):"Employee";const now=new Date();const s={user_id:newBonus.user_id,month:String(now.getMonth()+1).padStart(2,"0"),year:now.getFullYear(),basic_salary:0,allowances:0,deductions:0,overtime_hours:0,overtime_amount:0,bonus:parseFloat(newBonus.amount)||0,net_salary:parseFloat(newBonus.amount)||0,payment_method:"bank",status:"paid",payment_date:now.toISOString().slice(0,10),notes:newBonus.reason||t.bonusProgram+" — "+empName};try{const r=await DB.addSalary(s);if(r)setSalPayments(p=>[r,...p]);setBonusMod(false);sT("✓ "+t.bonusAwarded,"ok")}catch(e){console.error(e)}}} disabled={!newBonus.user_id||!newBonus.amount}>🏆 {t.awardBonus}</button>
</div></div>}

{/* BONUS RULES EDIT MODAL */}
{bonusEditRules&&<div className="ov" onClick={()=>setBonusEditRules(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>⚙️ {t.bonusRules}<button className="mc" onClick={()=>setBonusEditRules(false)}>✕</button></h2>
<div style={{background:"#ecfdf5",borderRadius:14,padding:16,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#065f46",marginBottom:10}}>🛒 {t.salesBonus}</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.perTxn} (JD)</label><input type="number" step="0.010" value={bonusRules.salesPerTxn} onChange={e=>setBonusRules(p=>({...p,salesPerTxn:+e.target.value}))}/></div>
<div className="pf" style={{flex:1}}><label>{t.bonusThreshold} (JD)</label><input type="number" value={bonusRules.salesThreshold} onChange={e=>setBonusRules(p=>({...p,salesThreshold:+e.target.value}))}/></div>
<div className="pf" style={{flex:1}}><label>{t.bonusReward} (JD)</label><input type="number" value={bonusRules.salesReward} onChange={e=>setBonusRules(p=>({...p,salesReward:+e.target.value}))}/></div>
</div>
<div style={{fontSize:10,color:"#6b7280",marginTop:4}}>💡 {rtl?"كل موظف يحصل على":"Each employee earns"} {fN(bonusRules.salesPerTxn)} JD {t.perTxn} + {fN(bonusRules.salesReward)} JD {t.ifAbove} {fN(bonusRules.salesThreshold)} JD {rtl?"مبيعات شهرية":"monthly sales"}</div>
</div>
<div style={{background:"#f5f3ff",borderRadius:14,padding:16,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#5b21b6",marginBottom:10}}>📅 {t.attendanceBonus}</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.daysPresent}</label><input type="number" value={bonusRules.attendanceTarget} onChange={e=>setBonusRules(p=>({...p,attendanceTarget:+e.target.value}))}/></div>
<div className="pf" style={{flex:1}}><label>{t.bonusReward} (JD)</label><input type="number" value={bonusRules.attendanceReward} onChange={e=>setBonusRules(p=>({...p,attendanceReward:+e.target.value}))}/></div>
</div>
</div>
<div style={{background:"#fffbeb",borderRadius:14,padding:16,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:10}}>🏆 {t.topSeller}</div>
<div className="pf"><label>{t.bonusReward} (JD)</label><input type="number" value={bonusRules.topSellerReward} onChange={e=>setBonusRules(p=>({...p,topSellerReward:+e.target.value}))}/></div>
</div>
<button className="cpb" onClick={()=>{DB.setSetting("bonus_rules",bonusRules);setBonusEditRules(false);sT("✓ "+t.saved,"ok")}}>✓ {t.saveRules}</button>
</div></div>}

{tab==="finance"&&(()=>{
const totalBankBal=bankAccts.reduce((s,a)=>s+ +a.balance,0);
const totalExp=expensesList.reduce((s,e)=>s+ +e.amount,0);
const salCatId=expCats.find(c=>c.name==="Salaries")?.id;
const suppliesCatId=expCats.find(c=>c.name==="Supplies")?.id;
const opExpOnly=expensesList.filter(e=>e.category_id!==salCatId&&e.category_id!==suppliesCatId).reduce((s,e)=>s+ +e.amount,0);
const salExpOnly=expensesList.filter(e=>e.category_id===salCatId).reduce((s,e)=>s+ +e.amount,0);
const purchaseExpOnly=expensesList.filter(e=>e.category_id===suppliesCatId).reduce((s,e)=>s+ +e.amount,0);
const totalSalPaid=salExpOnly>0?salExpOnly:salPayments.filter(s=>s.status==="paid").reduce((s,p)=>s+ +p.net_salary,0);
const grossRev=tT;
const cogs=txns.reduce((s,tx)=>s+tx.items.reduce((a,i)=>{const pr=prods.find(p=>p.id===i.id);return a+(pr?pr.c:0)*i.qty},0),0);
const grossP=grossRev-cogs;
const netP=grossP-opExpOnly-totalSalPaid;
const monthExp=expensesList.filter(e=>{try{const d=new Date(e.expense_date);const n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear()}catch{return false}}).reduce((s,e)=>s+ +e.amount,0);
const margin=grossRev>0?((netP/grossRev)*100).toFixed(1):0;

return<div className="ad"><div className="ads">
<button className={"asb "+(finTab==="overview"?"a":"")} onClick={()=>setFinTab("overview")}>📊 {t.financialOverview}</button>
<button className={"asb "+(finTab==="expenses"?"a":"")} onClick={()=>setFinTab("expenses")}>💸 {t.expenses}</button>
<button className={"asb "+(finTab==="bank"?"a":"")} onClick={()=>setFinTab("bank")}>🏦 {t.bankAccounts}</button>
<button className={"asb "+(finTab==="movements"?"a":"")} onClick={()=>setFinTab("movements")}>📄 {t.moneyMovements}</button>
<button className={"asb "+(finTab==="pnl"?"a":"")} onClick={()=>setFinTab("pnl")}>📈 {t.pnl}</button>
<button className={"asb "+(finTab==="shifts"?"a":"")} onClick={()=>setFinTab("shifts")}>💵 {rtl?"الورديات":"Cash Shifts"}</button>
<button className={"asb "+(finTab==="eod"?"a":"")} onClick={()=>setFinTab("eod")}>📄 {rtl?"تقرير نهاية اليوم":"EOD Report"}</button>
<button className={"asb "+(finTab==="profitability"?"a":"")} onClick={()=>setFinTab("profitability")}>📊 {rtl?"ربحية المنتجات":"Profitability"}</button>
<button className={"asb "+(finTab==="documents"?"a":"")} onClick={()=>setFinTab("documents")}>📁 {t.documents}</button>
</div><div className="ac">

{/* FINANCIAL OVERVIEW */}
{finTab==="overview"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>📊 {t.financialOverview}</h2>
<ExportButtons title={rtl?"التقرير المالي":"Financial Report"} getExportData={()=>{
  const totalSales=txns.reduce((s,x)=>s+x.tot,0);
  const cogs=txns.reduce((s,tx)=>s+tx.items.reduce((a,i)=>{const p=prods.find(pp=>pp.id===i.id);return p?a+p.c*i.qty:a},0),0);
  const headers=[rtl?"البند":"Item",rtl?"المبلغ (JD)":"Amount (JD)",rtl?"ملاحظات":"Notes"];
  const rows=[
    [rtl?"إجمالي الإيرادات":"Gross Revenue",totalSales.toFixed(3),txns.length+" "+(rtl?"فاتورة":"transactions")],
    [rtl?"تكلفة البضاعة":"Cost of Goods Sold",cogs.toFixed(3),""],
    [rtl?"الربح الإجمالي":"Gross Profit",(totalSales-cogs).toFixed(3),totalSales>0?((totalSales-cogs)/totalSales*100).toFixed(1)+"%":"0%"],
    [rtl?"مصروفات تشغيلية":"Operating Expenses",opExpOnly.toFixed(3),""],
    [rtl?"رواتب":"Salaries",salExpOnly.toFixed(3),""],
    [rtl?"مشتريات":"Purchases",purchaseExpOnly.toFixed(3),""],
    [rtl?"إجمالي المصروفات":"Total Expenses",totalExp.toFixed(3),""],
    [rtl?"صافي الربح":"Net Profit",(totalSales-cogs-opExpOnly).toFixed(3),""],
    [rtl?"الرصيد البنكي":"Bank Balance",totalBankBal.toFixed(3),bankAccts.length+" "+(rtl?"حساب":"accounts")]
  ];
  const summary=[
    {label:rtl?"الإيرادات":"Revenue",value:fm(totalSales),color:"#059669"},
    {label:rtl?"المصروفات":"Expenses",value:fm(totalExp),color:"#dc2626"},
    {label:rtl?"صافي الربح":"Net Profit",value:fm(totalSales-cogs-opExpOnly),color:"#1e40af"},
    {label:rtl?"الرصيد":"Balance",value:fm(totalBankBal),color:"#7c3aed"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:true};
}}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
<div className="dc" style={{borderLeft:"4px solid #059669",background:"linear-gradient(135deg,#ecfdf5,#fff)"}}><div className="dcl">💰 {t.currentBalance}</div><div className="dcv g" style={{fontSize:24}}>{fm(totalBankBal)}</div><div className="dcc">{bankAccts.length} {rtl?"حساب":"accounts"}</div></div>
<div className="dc" style={{borderLeft:"4px solid #2563eb"}}><div className="dcl">📈 {t.grossRevenue}</div><div className="dcv b">{fm(grossRev)}</div><div className="dcc">{tC} {t.txns.toLowerCase()}</div></div>
<div className="dc" style={{borderLeft:"4px solid #dc2626"}}><div className="dcl">💸 {t.totalExpenses}</div><div className="dcv" style={{color:"#dc2626"}}>{fm(totalExp)}</div><div className="dcc">{expensesList.length} {rtl?"مصروف":"expenses"}</div></div>
<div className="dc" style={{borderLeft:"4px solid "+(netP>=0?"#059669":"#dc2626")}}><div className="dcl">💎 {t.netProfit}</div><div className="dcv" style={{color:netP>=0?"#059669":"#dc2626"}}>{fm(netP)}</div><div className="dcc">{margin}% {t.profitMargin}</div></div>
</div>

{/* Bank accounts cards */}
<div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:10}}>🏦 {t.bankAccounts}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
{bankAccts.map(a=><div key={a.id} style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:16,padding:16,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:a.bank_name?"linear-gradient(90deg,#2563eb,#7c3aed)":a.name.toLowerCase().includes("cash")?"linear-gradient(90deg,#059669,#10b981)":"linear-gradient(90deg,#d97706,#f59e0b)"}}/>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginTop:4}}>
<div>
<div style={{fontSize:12,fontWeight:700,color:"#374151"}}>{rtl?(a.name_ar||a.name):a.name}</div>
{a.bank_name&&<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>🏦 {a.bank_name}</div>}
{a.account_no&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"var(--m)",direction:"ltr"}}># {a.account_no}</div>}
</div>
<span style={{fontSize:16}}>{a.bank_name?"🏦":a.name.toLowerCase().includes("petty")||a.name_ar?.includes("الكاش")?"💵":a.name.toLowerCase().includes("cash")||a.name_ar?.includes("صندوق")?"🗃️":"📦"}</span>
</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:+a.balance>=0?"#059669":"#dc2626",marginTop:8}}>{fm(+a.balance)}</div>
{a.bank_name&&<div style={{fontSize:10,color:"#2563eb",fontWeight:600,marginTop:4}}>🏦 {a.bank_name}</div>}
{a.account_no&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"var(--m)",direction:"ltr",marginTop:2}}># {a.account_no}</div>}
</div>)}
</div>

{/* This month summary */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
<div className="tb"><div className="tbh"><span>💸 {t.thisMonth} — {t.expenses}</span></div><table><thead><tr><th>{t.expCategory}</th><th>{t.expAmount}</th></tr></thead><tbody>{(()=>{const catTotals={};expensesList.filter(e=>{try{const d=new Date(e.expense_date);const n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear()}catch{return false}}).forEach(e=>{const cat=expCats.find(c=>c.id===e.category_id);const nm=cat?(rtl?cat.name_ar:cat.name):"Other";catTotals[nm]=(catTotals[nm]||0)+ +e.amount});return Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([n,v],i)=><tr key={i}><td style={{fontWeight:600}}>{n}</td><td className="mn" style={{color:"#dc2626"}}>{fm(v)}</td></tr>)})()}{monthExp===0&&<tr><td colSpan={2} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{rtl?"لا مصروفات":"No expenses"}</td></tr>}</tbody></table><div style={{padding:"8px 16px",borderTop:"1px solid #e5e7eb",textAlign:"right",fontWeight:700,fontFamily:"var(--m)",color:"#dc2626"}}>{t.total}: {fm(monthExp)}</div></div>

<div className="tb"><div className="tbh"><span>📈 {t.pnl} — {t.thisMonth}</span></div><table><tbody>
<tr><td style={{fontWeight:600}}>📈 {t.grossRevenue}</td><td className="mn" style={{color:"#059669"}}>{fm(grossRev)}</td></tr>
<tr><td style={{fontWeight:600}}>📦 {t.costOfGoods}</td><td className="mn" style={{color:"#dc2626"}}>-{fm(cogs)}</td></tr>
<tr style={{borderTop:"2px solid #e5e7eb"}}><td style={{fontWeight:700}}>💰 {t.grossProfit}</td><td className="mn" style={{fontWeight:700,color:grossP>=0?"#059669":"#dc2626"}}>{fm(grossP)}</td></tr>
<tr><td style={{fontWeight:600}}>💸 {t.opExpenses}</td><td className="mn" style={{color:"#dc2626"}}>-{fm(opExpOnly)}</td></tr>
<tr><td style={{fontWeight:600}}>👥 {t.salaries}</td><td className="mn" style={{color:"#dc2626"}}>-{fm(totalSalPaid)}</td></tr>
{purchaseExpOnly>0&&<tr><td style={{fontWeight:600}}>📦 {t.purchases}</td><td className="mn" style={{color:"#6b7280"}}>{fm(purchaseExpOnly)} ✓</td></tr>}
<tr style={{borderTop:"2px solid #1f2937",background:"#f9fafb"}}><td style={{fontWeight:800,fontSize:14}}>💎 {t.netProfit}</td><td className="mn" style={{fontWeight:800,fontSize:14,color:netP>=0?"#059669":"#dc2626"}}>{fm(netP)}</td></tr>
</tbody></table></div>
</div>
</>}

{/* EXPENSES */}
{finTab==="expenses"&&<><h2>💸 {t.expenses}</h2>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{setExpMod(true);setNewExp({category_id:"",amount:"",description:"",payment_method:"cash",expense_date:new Date().toISOString().slice(0,10),recurring:"none",reference_no:"",debit_account:"",attachment:null})}}>{t.addExpense}</button>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
<div className="dc" style={{borderLeft:"4px solid #dc2626"}}><div className="dcl">{t.allTime2}</div><div className="dcv" style={{color:"#dc2626"}}>{fm(totalExp)}</div></div>
<div className="dc" style={{borderLeft:"4px solid #d97706"}}><div className="dcl">{t.thisMonth}</div><div className="dcv y">{fm(monthExp)}</div></div>
<div className="dc" style={{borderLeft:"4px solid #6b7280"}}><div className="dcl">{t.txns}</div><div className="dcv" style={{color:"#374151"}}>{expensesList.length}</div></div>
</div>
{!expensesList.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>💸 {rtl?"لا مصروفات":"No expenses yet"}</div>:
<table className="at"><thead><tr><th>{t.expDate}</th><th>{t.expCategory}</th><th>{t.expDesc}</th><th>{t.payMethod}</th><th>{t.expAmount}</th><th></th></tr></thead>
<tbody>{expensesList.map(e=>{const cat=expCats.find(c=>c.id===e.category_id);const att=(()=>{try{return {}[e.id]}catch{return null}})();return<tr key={e.id}>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{e.expense_date}</td>
<td><span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:600,background:"#fef2f2",color:"#dc2626"}}>{cat?(cat.icon+" "+(rtl?cat.name_ar:cat.name)):"—"}</span></td>
<td style={{fontSize:11,color:"#6b7280",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis"}}>{e.description||"—"}{att&&<span style={{marginLeft:4,cursor:"pointer"}} title={rtl?"عرض الفاتورة":"View invoice"} onClick={()=>setViewDocMod({title:e.description||t.expenses,file:att,fileName:"invoice",date:e.expense_date,type:"other",description:fm(+e.amount)})}>📎</span>}</td>
<td style={{fontSize:10}}>{e.payment_method==="bank"?t.bank:e.payment_method==="check"?t.check:t.cash}</td>
<td className="mn" style={{color:"#dc2626",fontWeight:700}}>{fm(+e.amount)}</td>
<td><button className="ab" style={{background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",fontSize:10,padding:"4px 8px",marginRight:2}} title={rtl?"طباعة سند صرف":"Print payment voucher"} onClick={()=>{
const w=window.open("","_blank","width=800,height=900");
if(!w)return;
const dir=rtl?"rtl":"ltr";
const lbl=(ar,en)=>rtl?ar:en;
// Convert number to Arabic words (simple version)
const numberToWords=(n)=>{
  const num=Math.floor(n);
  const dec=Math.round((n-num)*1000);
  if(rtl){
    return num+" دينار"+(dec>0?" و "+dec+" فلس":"");
  }else{
    return num+" Dinar"+(dec>0?" and "+dec+" Fils":"");
  }
};
const voucherNo="PV-"+e.id;
const html="<!DOCTYPE html><html><head><meta charset='utf-8'><title>"+lbl("سند صرف","Payment Voucher")+" "+voucherNo+"</title>"
+"<style>"
+"@page{size:A4;margin:18mm}"
+"*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}"
+"body{direction:"+dir+";color:#1f2937;font-size:12pt}"
+".v{max-width:780px;margin:0 auto;border:3px double #1e40af;padding:24px;background:#fff}"
+".h{display:flex;align-items:center;gap:18px;border-bottom:2px solid #1e40af;padding-bottom:14px;margin-bottom:18px}"
+".h img{height:80px}"
+".h .s{flex:1;text-align:center}"
+".h .s h1{font-size:24pt;color:#1e40af;font-weight:900;margin-bottom:4px}"
+".h .s p{color:#6b7280;font-size:10pt;line-height:1.5}"
+".title{background:#1e40af;color:#fff;text-align:center;padding:10px;font-size:18pt;font-weight:800;margin-bottom:16px;border-radius:6px}"
+".meta{display:flex;justify-content:space-between;background:#f9fafb;padding:12px 18px;border-radius:6px;margin-bottom:16px;font-size:11pt}"
+".meta b{color:#1e40af}"
+".row{display:flex;padding:10px 0;border-bottom:1px dotted #d1d5db}"
+".row .l{width:180px;font-weight:700;color:#374151}"
+".row .v{flex:1;color:#1f2937}"
+".amt{background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #d97706;border-radius:8px;padding:18px;margin:18px 0;text-align:center}"
+".amt .l{font-size:11pt;color:#92400e;margin-bottom:6px;font-weight:700}"
+".amt .n{font-size:32pt;font-weight:900;color:#92400e;font-family:monospace;letter-spacing:2px}"
+".amt .w{font-size:11pt;color:#92400e;margin-top:6px;font-style:italic}"
+".sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:30px;padding-top:18px;border-top:2px dashed #9ca3af}"
+".sig{text-align:center}"
+".sig .l{font-size:9pt;color:#6b7280;font-weight:700;margin-bottom:30px}"
+".sig .ln{border-top:1px solid #1f2937;padding-top:4px;font-size:9pt;color:#374151}"
+".f{text-align:center;margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:8pt;color:#9ca3af}"
+"</style></head><body>"
+"<div class='v'>"
+"<div class='h'>"
+"<img src='"+STORE_LOGO+"' alt='3045'/>"
+"<div class='s'>"
+"<h1>"+(storeSettings.storeName||"3045 Supermarket")+"</h1>"
+"<p>"+lbl("إربد، شارع المدينة المنورة - مقابل SOS","Irbid, Almadina Almonawarah St. (Opp. SOS)")+"</p>"
+"<p>📞 0791191244</p>"
+"</div>"
+"</div>"
+"<div class='title'>"+lbl("سند صرف","PAYMENT VOUCHER")+"</div>"
+"<div class='meta'>"
+"<div><b>"+lbl("رقم السند","Voucher No")+":</b> "+voucherNo+"</div>"
+"<div><b>"+lbl("التاريخ","Date")+":</b> "+e.expense_date+"</div>"
+"</div>"
+"<div class='row'><div class='l'>"+lbl("الفئة","Category")+":</div><div class='v'>"+(cat?(cat.icon+" "+(rtl?cat.name_ar:cat.name)):"-")+"</div></div>"
+"<div class='row'><div class='l'>"+lbl("الوصف / البيان","Description")+":</div><div class='v'>"+(e.description||"-")+"</div></div>"
+"<div class='row'><div class='l'>"+lbl("طريقة الدفع","Payment Method")+":</div><div class='v'>"+(e.payment_method==="bank"?lbl("تحويل بنكي","Bank Transfer"):e.payment_method==="check"?lbl("شيك","Check"):lbl("نقدي","Cash"))+"</div></div>"
+(e.reference_no?"<div class='row'><div class='l'>"+lbl("رقم المرجع","Reference No")+":</div><div class='v'>"+e.reference_no+"</div></div>":"")
+"<div class='amt'>"
+"<div class='l'>"+lbl("المبلغ المصروف","AMOUNT PAID")+"</div>"
+"<div class='n'>"+(+e.amount).toFixed(3)+" JD</div>"
+"<div class='w'>"+lbl("فقط ","Only ")+numberToWords(+e.amount)+lbl(" لا غير","")+"</div>"
+"</div>"
+"<div class='sigs'>"
+"<div class='sig'><div class='l'>"+lbl("اسم وتوقيع المستلم","Recipient Name & Signature")+"</div><div class='ln'>____________________</div></div>"
+"<div class='sig'><div class='l'>"+lbl("اسم وتوقيع المحاسب","Accountant Name & Signature")+"</div><div class='ln'>"+(cu.fn||"")+"</div></div>"
+"<div class='sig'><div class='l'>"+lbl("توقيع المدير","Manager Signature")+"</div><div class='ln'>____________________</div></div>"
+"</div>"
+"<div class='f'>"+lbl("تم إصدار هذا السند بتاريخ","Voucher issued on")+" "+new Date().toLocaleString(rtl?"ar":"en-US")+"</div>"
+"</div>"
+"</body></html>";
w.document.write(html);
w.document.close();
setTimeout(function(){w.print()},500);
}}>🖨 {rtl?"سند":"Voucher"}</button><button className="ab ab-d" onClick={async()=>{setExpensesList(p=>p.filter(x=>x.id!==e.id));try{await DB.deleteExpense(e.id);const attachments={};delete attachments[e.id];/* attachments disabled */}catch{}}}>✕</button></td>
</tr>})}</tbody></table>}
</>}

{/* BANK ACCOUNTS */}
{finTab==="bank"&&<><h2>🏦 {t.bankAccounts}</h2>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{setMovMod(true);setNewMov({account_id:bankAccts[0]?.id||"",type:"deposit",amount:"",description:"",reference_no:"",to_account_id:""})}}>{t.deposit} / {t.withdrawal} / {t.transfer}</button>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:14}}>
{bankAccts.map(a=><div key={a.id} style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:20,padding:20,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,right:0,height:4,background:a.bank_name?"linear-gradient(90deg,#2563eb,#7c3aed)":a.name.toLowerCase().includes("cash register")||a.name_ar?.includes("صندوق")?"linear-gradient(90deg,#059669,#10b981)":"linear-gradient(90deg,#d97706,#f59e0b)"}}/>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginTop:4}}>
<div style={{flex:1}}>
<div style={{fontSize:15,fontWeight:700,color:"#374151"}}>{rtl?(a.name_ar||a.name):a.name}</div>
{a.bank_name&&<div style={{display:"flex",alignItems:"center",gap:4,marginTop:4}}>
<span style={{fontSize:12}}>🏦</span>
<span style={{fontSize:12,color:"#2563eb",fontWeight:600}}>{a.bank_name}</span>
</div>}
{a.account_no&&<div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
<span style={{fontSize:10,color:"#9ca3af"}}>#</span>
<span style={{fontSize:11,color:"#6b7280",fontFamily:"var(--m)",direction:"ltr",letterSpacing:1}}>{a.account_no}</span>
</div>}
{!a.bank_name&&!a.account_no&&<div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>{a.name.toLowerCase().includes("petty")||a.name_ar?.includes("كاش")?"💵 "+(rtl?"نقد يدوي":"Manual cash"):"🗃️ "+(rtl?"صندوق داخلي":"Internal register")}</div>}
</div>
<span style={{fontSize:28,opacity:.15}}>{a.bank_name?"🏦":a.name.toLowerCase().includes("petty")||a.name_ar?.includes("كاش")?"💵":"🗃️"}</span>
</div>
<div style={{fontSize:32,fontWeight:800,fontFamily:"var(--m)",color:+a.balance>=0?"#059669":"#dc2626",marginTop:12}}>{fm(+a.balance)}</div>
</div>)}
</div>
<div style={{background:"#f9fafb",borderRadius:16,padding:16,textAlign:"center"}}>
<div style={{fontSize:12,color:"#6b7280",fontWeight:600}}>{t.currentBalance} ({rtl?"جميع الحسابات":"All Accounts"})</div>
<div style={{fontSize:32,fontWeight:800,fontFamily:"var(--m)",color:totalBankBal>=0?"#059669":"#dc2626"}}>{fm(totalBankBal)}</div>
</div>
</>}

{/* MONEY MOVEMENTS */}
{finTab==="movements"&&<><h2>📄 {t.moneyMovements}</h2>
<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={async()=>{try{const mv=await DB.getMoneyMovements();setMovements(mv);sT("✓ Refreshed","ok")}catch{}}}>🔄 Refresh</button>
{!movements.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>📄 {rtl?"لا حركات":"No movements"}</div>:
<table className="at"><thead><tr><th>{t.expDate}</th><th>{t.bankAccounts}</th><th>{t.movementType}</th><th>{t.expDesc}</th><th>{t.expAmount}</th><th>{t.balAfter}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{movements.map(m=>{const acct=bankAccts.find(a=>a.id===m.account_id);const isIn=m.type==="deposit"||m.type==="sales_deposit"||m.type==="transfer_in";return<tr key={m.id}>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{new Date(m.created_at).toLocaleDateString()}</td>
<td style={{fontSize:11,fontWeight:600}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14}}>{acct&&acct.bank_name?"🏦":acct&&(acct.name.toLowerCase().includes("cash register")||acct?.name_ar?.includes("صندوق"))?"🗃️":"💵"}</span><div>{acct?(rtl?(acct.name_ar||acct.name):acct.name):"—"}{acct&&acct.bank_name&&<div style={{fontSize:9,color:"#6b7280"}}>{acct.bank_name}</div>}{acct&&acct.account_no&&<div style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--m)",direction:"ltr"}}># {acct.account_no}</div>}</div></div></td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:isIn?"#ecfdf5":"#fef2f2",color:isIn?"#059669":"#dc2626"}}>{isIn?"↑":"↓"} {m.type}</span></td>
<td style={{fontSize:11,color:"#6b7280"}}>{m.description||"—"}</td>
<td className="mn" style={{color:isIn?"#059669":"#dc2626",fontWeight:700}}>{isIn?"+":"-"}{fm(+m.amount)}</td>
<td className="mn">{fm(+m.balance_after)}</td>
{cu.role==="admin"&&<td><button className="ab ab-d" onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setMovements(p=>p.filter(x=>x.id!==m.id));try{await DB.deleteMovement(m.id)}catch{}}}>✕</button></td>}
</tr>})}</tbody></table>}
</>}

{/* P&L STATEMENT */}
{finTab==="pnl"&&(()=>{
// Build daily profit data for current month
const now2=new Date();const yr=now2.getFullYear();const mo=now2.getMonth();
const daysInMonth=new Date(yr,mo+1,0).getDate();const todayDay=now2.getDate();
const dailyData=[];
for(let d=1;d<=daysInMonth;d++){
  const dateStr=yr+"-"+String(mo+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
  const dayTxns=txns.filter(tx=>{try{const dt=new Date(tx.ts);return dt.getFullYear()===yr&&dt.getMonth()===mo&&dt.getDate()===d}catch{return false}});
  const rev=dayTxns.reduce((s,tx)=>s+tx.tot,0);
  const dayCogs=dayTxns.reduce((s,tx)=>s+tx.items.reduce((a,i)=>{const pr=prods.find(p=>p.id===i.id);return a+(pr?pr.c:0)*i.qty},0),0);
  const dayExp=expensesList.filter(e=>e.expense_date===dateStr&&e.category_id!==salCatId&&e.category_id!==suppliesCatId).reduce((s,e)=>s+ +e.amount,0);
  const dayProfit=rev-dayCogs-dayExp;
  if(d<=todayDay) dailyData.push({day:d,rev:+rev.toFixed(3),cogs:+dayCogs.toFixed(3),profit:+dayProfit.toFixed(3),type:"actual"});
}
// Calculate trend: avg daily profit
const actualDays=dailyData.filter(d=>d.rev>0);
const avgDailyProfit=actualDays.length>0?actualDays.reduce((s,d)=>s+d.profit,0)/actualDays.length:0;
const avgDailyRev=actualDays.length>0?actualDays.reduce((s,d)=>s+d.rev,0)/actualDays.length:0;
// Project remaining days
const projected=[...dailyData];
let cumulProfit=dailyData.reduce((s,d)=>s+d.profit,0);
for(let d=todayDay+1;d<=daysInMonth;d++){
  cumulProfit+=avgDailyProfit;
  projected.push({day:d,rev:+avgDailyRev.toFixed(3),profit:+avgDailyProfit.toFixed(3),type:"forecast"});
}
// Cumulative data for area chart
let cumActual=0,cumForecast=0;
const cumulData=projected.map(d=>{
  if(d.type==="actual"){cumActual+=d.profit;cumForecast=cumActual;return{day:d.day,actual:+cumActual.toFixed(3),forecast:null}}
  else{cumForecast+=d.profit;return{day:d.day,actual:null,forecast:+cumForecast.toFixed(3)}}
});
// Bridge: last actual day connects to forecast
if(cumulData.length>0&&todayDay<daysInMonth){const lastActual=cumulData.filter(d=>d.actual!==null).pop();if(lastActual){const fIdx=cumulData.findIndex(d=>d.forecast!==null);if(fIdx>0)cumulData[fIdx-1]={...cumulData[fIdx-1],forecast:cumulData[fIdx-1].actual}}}
const projectedMonthProfit=+(cumulProfit).toFixed(3);
const projectedMonthRev=+(dailyData.reduce((s,d)=>s+d.rev,0)+avgDailyRev*(daysInMonth-todayDay)).toFixed(3);
const monthNames=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

return<><h2>📈 {t.pnl}</h2>

{/* P&L Statement */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
<div style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:20,padding:24}}>
<div style={{textAlign:"center",marginBottom:20}}>
<div style={{fontSize:18,fontWeight:800,color:"#1f2937"}}>3045 Supermarket</div>
<div style={{fontSize:12,color:"#9ca3af"}}>{t.pnl} — {t.allTime2}</div>
</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6"}}><span style={{fontWeight:600}}>📈 {t.grossRevenue}</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:"#059669"}}>{fm(grossRev)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6",color:"#dc2626"}}><span style={{fontWeight:500}}>📦 {t.costOfGoods}</span><span style={{fontFamily:"var(--m)"}}>({fm(cogs)})</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"2px solid #e5e7eb",fontWeight:700,fontSize:15}}><span>💰 {t.grossProfit}</span><span style={{fontFamily:"var(--m)",color:grossP>=0?"#059669":"#dc2626"}}>{fm(grossP)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6",color:"#dc2626"}}><span style={{fontWeight:500}}>💸 {t.opExpenses}</span><span style={{fontFamily:"var(--m)"}}>({fm(opExpOnly)})</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6",color:"#dc2626"}}><span style={{fontWeight:500}}>👥 {t.salaries} ({t.paid})</span><span style={{fontFamily:"var(--m)"}}>({fm(totalSalPaid)})</span></div>
{purchaseExpOnly>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f3f4f6",color:"#6b7280"}}><span style={{fontWeight:500,fontSize:12}}>📦 {t.purchases} ({rtl?"في تكلفة البضاعة":"in COGS"})</span><span style={{fontFamily:"var(--m)",fontSize:12}}>{fm(purchaseExpOnly)} ✓</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"12px 0",borderTop:"3px solid #1f2937",marginTop:6,fontSize:18,fontWeight:800}}><span>💎 {t.netProfit}</span><span style={{fontFamily:"var(--m)",color:netP>=0?"#059669":"#dc2626"}}>{fm(netP)}</span></div>
<div style={{textAlign:"center",fontSize:12,color:netP>=0?"#059669":"#dc2626",fontWeight:600,marginTop:4}}>{t.profitMargin}: {margin}%</div>
</div>
</div>

{/* Month Forecast Card */}
<div style={{display:"flex",flexDirection:"column",gap:12}}>
<div style={{background:"linear-gradient(135deg,#1e3a5f,#2563eb)",borderRadius:20,padding:20,color:"#fff"}}>
<div style={{fontSize:12,opacity:.7}}>{rtl?"توقعات الشهر":"Month Forecast"} — {monthNames[mo]} {yr}</div>
<div style={{fontSize:11,opacity:.5,marginTop:2}}>{rtl?"بناءً على":"Based on"} {actualDays.length} {rtl?"يوم بيانات":"days of data"} ({todayDay}/{daysInMonth})</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:14}}>
<div><div style={{fontSize:10,opacity:.6}}>{rtl?"الإيرادات المتوقعة":"Projected Revenue"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)"}}>{fm(projectedMonthRev)}</div></div>
<div><div style={{fontSize:10,opacity:.6}}>{rtl?"الربح المتوقع":"Projected Profit"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:projectedMonthProfit>=0?"#86efac":"#fca5a5"}}>{fm(projectedMonthProfit)}</div></div>
</div>
<div style={{marginTop:12}}>
<div style={{display:"flex",justifyContent:"space-between",fontSize:10,opacity:.6,marginBottom:4}}><span>{rtl?"التقدم":"Progress"}</span><span>{todayDay}/{daysInMonth} {rtl?"يوم":"days"}</span></div>
<div style={{height:6,background:"rgba(255,255,255,.2)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:(todayDay/daysInMonth*100)+"%",background:"#86efac",borderRadius:3}}/></div>
</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
<div style={{background:"#ecfdf5",border:"1px solid #d1fae5",borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:10,color:"#065f46"}}>{rtl?"متوسط يومي":"Avg Daily"}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(avgDailyRev)}</div><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"إيرادات":"revenue"}</div></div>
<div style={{background:avgDailyProfit>=0?"#ecfdf5":"#fef2f2",border:"1px solid "+(avgDailyProfit>=0?"#d1fae5":"#fecaca"),borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:10,color:avgDailyProfit>=0?"#065f46":"#991b1b"}}>{rtl?"متوسط ربح يومي":"Avg Daily Profit"}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:avgDailyProfit>=0?"#059669":"#dc2626"}}>{fm(avgDailyProfit)}</div><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"صافي":"net"}</div></div>
</div>
</div>
</div>

{/* Cumulative Profit Trend Chart */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:20,padding:20,marginBottom:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:4}}>📈 {rtl?"اتجاه الربح الصافي — ":"Net Profit Trend — "}{monthNames[mo]} {yr}</div>
<div style={{fontSize:11,color:"#9ca3af",marginBottom:14}}>{rtl?"الخط المتصل = فعلي · الخط المتقطع = متوقع":"Solid = Actual · Dashed = Forecast"}</div>
<ResponsiveContainer width="100%" height={240}>
<AreaChart data={cumulData}>
<defs>
<linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={.15}/><stop offset="95%" stopColor="#059669" stopOpacity={0}/></linearGradient>
<linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={.1}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient>
</defs>
<CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
<XAxis dataKey="day" tick={{fill:"#9ca3af",fontSize:10}} label={{value:rtl?"اليوم":"Day",position:"bottom",fontSize:10,fill:"#9ca3af"}}/>
<YAxis tick={{fill:"#9ca3af",fontSize:10}} label={{value:"JD",angle:-90,position:"insideLeft",fontSize:10,fill:"#9ca3af"}}/>
<Tooltip contentStyle={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,fontSize:12}} formatter={(v,n)=>[v!==null?fm(v):"—",n==="actual"?(rtl?"فعلي":"Actual"):(rtl?"متوقع":"Forecast")]}/>
<Area type="monotone" dataKey="actual" stroke="#059669" fill="url(#profitGrad)" strokeWidth={3} dot={{r:2,fill:"#059669"}} connectNulls={false}/>
<Area type="monotone" dataKey="forecast" stroke="#7c3aed" fill="url(#forecastGrad)" strokeWidth={2} strokeDasharray="8 4" dot={false} connectNulls={false}/>
</AreaChart>
</ResponsiveContainer>
<div style={{display:"flex",justifyContent:"center",gap:20,marginTop:8,fontSize:11}}>
<div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:20,height:3,background:"#059669",borderRadius:2}}/> {rtl?"فعلي":"Actual"}</div>
<div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:20,height:3,background:"#7c3aed",borderRadius:2,borderTop:"2px dashed #7c3aed"}}/> {rtl?"متوقع":"Forecast"}</div>
</div>
</div>

{/* Daily Breakdown Bar Chart */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:20,padding:20}}>
<div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:14}}>📊 {rtl?"الربح اليومي":"Daily Profit"} — {monthNames[mo]} {yr}</div>
<ResponsiveContainer width="100%" height={180}>
<BarChart data={dailyData}>
<CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
<XAxis dataKey="day" tick={{fill:"#9ca3af",fontSize:9}}/>
<YAxis tick={{fill:"#9ca3af",fontSize:9}}/>
<Tooltip contentStyle={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,fontSize:11}} formatter={(v,n)=>[fm(v),n==="rev"?(rtl?"إيرادات":"Revenue"):n==="profit"?(rtl?"ربح":"Profit"):(rtl?"تكلفة":"COGS")]}/>
<Bar dataKey="rev" fill="#2563eb" radius={[4,4,0,0]} opacity={.3} name="rev"/>
<Bar dataKey="profit" fill="#059669" radius={[4,4,0,0]} name="profit"/>
</BarChart>
</ResponsiveContainer>
</div>
</>})()}

{/* ── CASH SHIFTS / RECONCILIATION ── */}
{finTab==="shifts"&&(()=>{
const todayShifts=cashShifts.filter(s=>s.shift_date===new Date().toISOString().slice(0,10));
const todayTxs2=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}});
return<><h2>💵 {rtl?"إدارة الورديات والتسوية":"Cash Shifts & Reconciliation"}</h2>

{/* Open/Close Shift */}
<div style={{display:"flex",gap:8,marginBottom:14}}>
{!activeShift?<button className="ab ab-s" style={{padding:"10px 20px",fontSize:13}} onClick={async()=>{
const s={user_id:cu.id,cashier_name:rtl?(cu.fa||cu.fn):cu.fn,shift_date:new Date().toISOString().slice(0,10),opening_balance:0,status:"open"};
const pr=prompt(rtl?"أدخل الرصيد الافتتاحي (JD):":"Enter opening balance (JD):","0");
if(pr===null)return;s.opening_balance=parseFloat(pr)||0;
try{const r=await DB.openShift(s);if(r){setActiveShift(r);setCashShifts(p=>[r,...p]);setTab("sale");try{await DB.clockIn(cu?.id);sT("✓ "+(rtl?"بدأت الوردية وتم تسجيل الحضور":"Shift opened & checked in"),"ok")}catch{sT("✓ "+(rtl?"بدأت الوردية":"Shift opened"),"ok")}}}catch(e){console.error(e)}}}>🟢 {rtl?"بدء وردية":"Open Shift"}</button>
:<button className="ab ab-e" style={{padding:"10px 20px",fontSize:13}} onClick={()=>{setCloseShiftMod(true);setShiftCashCount("")}}>🔴 {rtl?"إغلاق الوردية":"Close Shift"}</button>}
</div>

{/* Active shift indicator */}
{activeShift&&<div style={{background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",border:"1.5px solid #86efac",borderRadius:16,padding:16,marginBottom:14}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div>
<div style={{fontSize:14,fontWeight:700,color:"#065f46"}}>🟢 {rtl?"وردية نشطة":"Active Shift"}</div>
<div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{activeShift.cashier_name} · {rtl?"افتتاحي":"Opening"}: {fm(+activeShift.opening_balance)}</div>
<div style={{fontSize:10,color:"#9ca3af",fontFamily:"var(--m)"}}>{new Date(activeShift.shift_start).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} — {rtl?"الآن":"now"}</div>
<div style={{fontSize:11,color:"#065f46",marginTop:6,fontWeight:700}}>
⏱️ {(()=>{const diff=new Date()-new Date(activeShift.shift_start);const h=Math.floor(diff/3600000);const m=Math.floor((diff%3600000)/60000);return rtl?`المدة: ${h}س ${m}د`:`Duration: ${h}h ${m}m`;})()}
</div>
</div>
<div style={{textAlign:"right"}}>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(todayTxs2.filter(tx=>tx.method==="cash").reduce((s,tx)=>s+tx.tot,0))}</div>
<div style={{fontSize:10,color:"#6b7280"}}>{rtl?"مبيعات نقدية":"Cash sales"}</div>
</div>
</div>
<div style={{marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,.6)",borderRadius:8,fontSize:10,color:"#065f46",fontWeight:600}}>
💡 {rtl?"الوردية تبقى مفتوحة حتى تُغلقها يدوياً — تسجيل الخروج لا يُغلقها":"Shift stays open until manually closed — logout does NOT close it"}
</div>
</div>}

{/* Shift History */}
<div className="tb"><div className="tbh"><span>📋 {rtl?"سجل الورديات":"Shift History"}</span></div>
<table><thead><tr><th>{rtl?"الكاشير":"Cashier"}</th><th>{t.expDate}</th><th>{rtl?"افتتاحي":"Opening"}</th><th>{rtl?"متوقع":"Expected"}</th><th>{rtl?"فعلي":"Actual"}</th><th>{rtl?"الفرق":"Diff"}</th><th>{rtl?"الحالة":"Status"}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{cashShifts.length===0?<tr><td colSpan={cu.role==="admin"?8:7} style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{rtl?"لا سجلات":"No records"}</td></tr>:cashShifts.map(s=><tr key={s.id}>
<td style={{fontWeight:600,fontSize:12}}>{s.cashier_name}</td>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{s.shift_date}</td>
<td style={{fontFamily:"var(--m)"}}>{fm(+s.opening_balance)}</td>
<td style={{fontFamily:"var(--m)"}}>{fm(+s.expected_cash)}</td>
<td style={{fontFamily:"var(--m)"}}>{s.actual_cash!==null?fm(+s.actual_cash):"—"}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:+s.cash_difference===0?"#059669":+s.cash_difference>0?"#2563eb":"#dc2626"}}>{s.actual_cash!==null?(+s.cash_difference>0?"+":"")+fN(+s.cash_difference):"—"}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:s.status==="open"?"#ecfdf5":s.status==="closed"?"#eff6ff":"#f3f4f6",color:s.status==="open"?"#059669":s.status==="closed"?"#2563eb":"#6b7280"}}>{s.status}</span></td>
{cu.role==="admin"&&<td><button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setCashShifts(p=>p.filter(x=>x.id!==s.id));if(activeShift?.id===s.id)setActiveShift(null);try{await DB.deleteShift(s.id)}catch{}}}>✕</button></td>}
</tr>)}</tbody></table></div>
</>})()}

{/* ── EOD REPORT ── */}
{finTab==="eod"&&(()=>{
const todayStr=new Date().toISOString().slice(0,10);
const todayTxs3=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}});
const cashS=todayTxs3.filter(tx=>tx.method==="cash").reduce((s,tx)=>s+tx.tot,0);
const cardS=todayTxs3.filter(tx=>tx.method==="card").reduce((s,tx)=>s+tx.tot,0);
const madaS=todayTxs3.filter(tx=>tx.method==="mobile").reduce((s,tx)=>s+tx.tot,0);
const totalS=cashS+cardS+madaS;
const totalTax=todayTxs3.reduce((s,tx)=>s+tx.tax,0);
const totalItems=todayTxs3.reduce((s,tx)=>s+tx.items.reduce((a,i)=>a+i.qty,0),0);
const todayCogs=todayTxs3.reduce((s,tx)=>s+tx.items.reduce((a,i)=>{const pr=prods.find(p=>p.id===i.id);return a+(pr?pr.c:0)*i.qty},0),0);
const todayRet=salesReturns.filter(r=>{try{return new Date(r.created_at).toDateString()===new Date().toDateString()}catch{return false}}).reduce((s,r)=>s+ +r.total_refund,0);
const todayExp=expensesList.filter(e=>e.expense_date===todayStr).reduce((s,e)=>s+ +e.amount,0);
const todayInvs=invs.filter(i=>{try{return new Date(i.date).toDateString()===new Date().toDateString()}catch{return false}});
const todayPurchases=todayInvs.reduce((s,i)=>s+(+i.total||0),0);
const openingBal=activeShift?+activeShift.opening_balance:0;
const todayCashIn=movements.filter(m=>{try{return new Date(m.created_at).toDateString()===new Date().toDateString()&&m.type==="deposit"}catch{return false}}).reduce((s,m)=>s+ +m.amount,0);
const todayCashOut=movements.filter(m=>{try{return new Date(m.created_at).toDateString()===new Date().toDateString()&&m.type==="withdrawal"}catch{return false}}).reduce((s,m)=>s+ +m.amount,0);
const expectedDrawer=openingBal+cashS+todayCashIn-todayCashOut;
const remittance=expectedDrawer-openingBal;
const gProf=totalS-todayCogs;const nProf=gProf-todayExp-todayRet;
const gMargin=totalS>0?((gProf/totalS)*100).toFixed(1):0;

return<><h2>📄 {rtl?"تقرير نهاية اليوم":"End of Day Report"}</h2>

<div style={{display:"flex",gap:8,marginBottom:14}}>
<button className="ab ab-s" style={{padding:"10px 20px",fontSize:13}} onClick={async()=>{
const report={report_date:todayStr,total_sales:+totalS.toFixed(3),total_cash_sales:+cashS.toFixed(3),total_card_sales:+cardS.toFixed(3),total_mada_sales:+madaS.toFixed(3),total_transactions:todayTxs3.length,total_items_sold:totalItems,total_sales_returns:+todayRet.toFixed(3),total_expenses:+todayExp.toFixed(3),total_cost_of_goods:+todayCogs.toFixed(3),gross_profit:+gProf.toFixed(3),gross_margin:+gMargin,net_profit:+nProf.toFixed(3),total_tax_collected:+totalTax.toFixed(3),generated_by:cu?.fn,status:"final"};
try{const r=await DB.addEODReport(report);if(r)setEODReports(p=>{const existing=p.findIndex(x=>x.report_date===todayStr);if(existing>=0){const n=[...p];n[existing]=r;return n}return[r,...p]});sT("✓ "+(rtl?"تم إنشاء التقرير":"Report generated"),"ok")}catch(e){console.error(e)}}}>📄 {rtl?"إنشاء تقرير اليوم":"Generate Today's Report"}</button>
<button className="ab ab-x" style={{padding:"10px 20px",fontSize:13}} onClick={()=>window.print()}>🖨 {t.print}</button>
</div>

{/* Live EOD Preview */}
<div style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:20,padding:24,maxWidth:500,fontFamily:"var(--m)"}}>
<div style={{textAlign:"center",marginBottom:20,borderBottom:"2px dashed #e5e7eb",paddingBottom:16}}>
<div style={{fontSize:20,fontWeight:800,fontFamily:"var(--f)"}}>{storeSettings.storeName||"3045 Supermarket"}</div><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"إربد، شارع المدينة المنورة - مقابل SOS":"Irbid, Almadina Almonawarah St. (Opp. SOS)"} · 📞 0791191244</div>
<div style={{fontSize:12,color:"#9ca3af"}}>{rtl?"تقرير نهاية اليوم":"End of Day Report"}</div>
<div style={{fontSize:13,color:"#374151",marginTop:4}}>{new Date().toLocaleDateString(rtl?"ar":"en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
</div>

<div style={{fontSize:12}}>
<div style={{fontWeight:700,marginBottom:8,fontFamily:"var(--f)",color:"#374151"}}>📊 {rtl?"ملخص المبيعات":"Sales Summary"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>💵 {t.cash}</span><span>{fN(cashS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>💳 {t.card}</span><span>{fN(cardS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>📱 {t.mada}</span><span>{fN(madaS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #e5e7eb",fontWeight:700,fontSize:14}}><span>{t.totalSales}</span><span style={{color:"#059669"}}>{fN(totalS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#9ca3af"}}><span>{t.txns}: {todayTxs3.length}</span><span>{t.items}: {totalItems}</span></div>

<div style={{fontWeight:700,marginTop:16,marginBottom:8,fontFamily:"var(--f)",color:"#374151"}}>📈 {rtl?"الربحية":"Profitability"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{t.grossRevenue}</span><span>{fN(totalS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>{t.costOfGoods}</span><span>({fN(todayCogs)})</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontWeight:700}}><span>{t.grossProfit}</span><span style={{color:gProf>=0?"#059669":"#dc2626"}}>{fN(gProf)} ({gMargin}%)</span></div>
{todayRet>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>↩️ {rtl?"المرتجعات":"Returns"}</span><span>({fN(todayRet)})</span></div>}
{todayExp>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>💸 {t.expenses}</span><span>({fN(todayExp)})</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"2px solid #1f2937",fontWeight:800,fontSize:16,marginTop:4}}><span>💎 {t.netProfit}</span><span style={{color:nProf>=0?"#059669":"#dc2626"}}>{fN(nProf)}</span></div>

<div style={{fontWeight:700,marginTop:16,marginBottom:8,fontFamily:"var(--f)",color:"#374151"}}>🧾 {rtl?"الضريبة":"Tax"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{t.vat}</span><span>{fN(totalTax)}</span></div>

<div style={{fontWeight:700,marginTop:16,marginBottom:8,fontFamily:"var(--f)",color:"#374151"}}>🧾 {rtl?"مشتريات اليوم":"Today's Purchases"}</div>
{todayInvs.length===0?<div style={{padding:"4px 0",color:"#9ca3af",fontSize:11}}>{rtl?"لا مشتريات اليوم":"No purchases today"}</div>:<>
{todayInvs.map(i=><div key={i.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:11}}><span>📋 {i.invoice_number||i.id} {i.supplier_name?"· "+i.supplier_name:""}</span><span>{fN(+i.total)}</span></div>)}
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #e5e7eb",fontWeight:700}}><span>{rtl?"إجمالي المشتريات":"Total Purchases"}</span><span style={{color:"#dc2626"}}>{fN(todayPurchases)}</span></div>
</>}

<div style={{fontWeight:700,marginTop:16,marginBottom:8,fontFamily:"var(--f)",color:"#374151"}}>💰 {rtl?"حركة النقد":"Cash Movement"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{rtl?"الرصيد الافتتاحي":"Opening Balance"}</span><span>{fN(openingBal)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#059669"}}><span>↑ {rtl?"مبيعات نقدية":"Cash Sales"}</span><span>+{fN(cashS)}</span></div>
{todayCashIn>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#059669"}}><span>↑ {rtl?"إدخال نقد":"Cash In"}</span><span>+{fN(todayCashIn)}</span></div>}
{todayCashOut>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>↓ {rtl?"إخراج نقد":"Cash Out"}</span><span>-{fN(todayCashOut)}</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #e5e7eb",fontWeight:700}}><span>{rtl?"المتوقع في الصندوق":"Expected in Drawer"}</span><span>{fN(expectedDrawer)}</span></div>

<div style={{background:"linear-gradient(135deg,#7c2d12,#9a3412)",borderRadius:12,padding:14,marginTop:16,color:"#fff",textAlign:"center"}}>
<div style={{fontSize:11,opacity:.9,marginBottom:4}}>💼 {rtl?"المبلغ المطلوب توريده للإدارة":"Amount to Remit to Management"}</div>
<div style={{fontSize:24,fontWeight:900,fontFamily:"var(--m)"}}>{fN(remittance)}</div>
<div style={{fontSize:9,opacity:.8,marginTop:4}}>{rtl?"= نقدي - افتتاحي + إدخال - إخراج":"= cash - opening + in - out"}</div>
</div>

<div style={{textAlign:"center",marginTop:16,borderTop:"2px dashed #e5e7eb",paddingTop:12,fontSize:10,color:"#9ca3af"}}>{rtl?"تم الإنشاء بواسطة":"Generated by"}: {cu?.fn} · {new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
</div>
</div>

{/* Saved EOD Reports */}
{eodReports.length>0&&<div className="tb" style={{marginTop:14}}><div className="tbh"><span>📋 {rtl?"التقارير السابقة":"Previous Reports"}</span></div>
<table><thead><tr><th>{t.expDate}</th><th>{t.totalSales}</th><th>{t.grossProfit}</th><th>{t.netProfit}</th><th>{rtl?"الهامش":"Margin"}</th><th>{t.txns}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{eodReports.map(r=><tr key={r.id} style={{cursor:"pointer"}} onClick={()=>setEODViewMod(r)}>
<td style={{fontFamily:"var(--m)",fontSize:11,fontWeight:600}}>{r.report_date}</td>
<td style={{fontFamily:"var(--m)",color:"#059669"}}>{fm(+r.total_sales)}</td>
<td style={{fontFamily:"var(--m)",color:+r.gross_profit>=0?"#059669":"#dc2626"}}>{fm(+r.gross_profit)}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:+r.net_profit>=0?"#059669":"#dc2626"}}>{fm(+r.net_profit)}</td>
<td style={{fontFamily:"var(--m)"}}>{r.gross_margin}%</td>
<td style={{fontFamily:"var(--m)"}}>{r.total_transactions}</td>
{cu.role==="admin"&&<td><button className="ab ab-d" style={{fontSize:9}} onClick={async(e)=>{e.stopPropagation();if(!confirm(rtl?"حذف؟":"Delete?"))return;setEODReports(p=>p.filter(x=>x.id!==r.id));try{await DB.deleteEODReport(r.id)}catch{}}}>✕</button></td>}
</tr>)}</tbody></table></div>}
</>})()}

{/* ── PRODUCT PROFITABILITY ── */}
{finTab==="profitability"&&(()=>{
const sorted=prodProfitability.sort((a,b)=>(+b.total_gross_profit)-(+a.total_gross_profit));
const topProfit=sorted.filter(p=>+p.total_gross_profit>0).slice(0,5);
const lossItems=sorted.filter(p=>+p.net_profit<0);
const totalRev=sorted.reduce((s,p)=>s+ +p.total_revenue,0);
const totalProf=sorted.reduce((s,p)=>s+ +p.total_gross_profit,0);
const avgMargin=totalRev>0?((totalProf/totalRev)*100).toFixed(1):0;

return<><h2>📊 {rtl?"ربحية المنتجات":"Product Profitability"}</h2>

<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12,marginBottom:14}} onClick={async()=>{try{const pp=await DB.getProductProfitability();setProdProfitability(pp);sT("✓ Refreshed","ok")}catch{}}}>🔄 {rtl?"تحديث":"Refresh"}</button>

{/* KPI Cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
<div style={{background:"#ecfdf5",borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:9,color:"#065f46"}}>{rtl?"إجمالي الإيراد":"Total Revenue"}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(totalRev)}</div></div>
<div style={{background:"#eff6ff",borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:9,color:"#1e40af"}}>{rtl?"إجمالي الربح":"Total Profit"}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{fm(totalProf)}</div></div>
<div style={{background:"#f5f3ff",borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:9,color:"#5b21b6"}}>{rtl?"متوسط الهامش":"Avg Margin"}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{avgMargin}%</div></div>
<div style={{background:lossItems.length>0?"#fef2f2":"#ecfdf5",borderRadius:14,padding:14,textAlign:"center"}}><div style={{fontSize:9,color:lossItems.length>0?"#991b1b":"#065f46"}}>{rtl?"منتجات خاسرة":"Loss Items"}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:lossItems.length>0?"#dc2626":"#059669"}}>{lossItems.length}</div></div>
</div>

{/* Top Profitable */}
{topProfit.length>0&&<div style={{marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>🏆 {rtl?"الأكثر ربحية":"Top Profitable"}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
{topProfit.map((p,i)=><div key={p.id} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:i===0?"#d97706":i===1?"#9ca3af":"#cd7f32"}}/>
<div style={{fontSize:14,marginBottom:4}}>{p.emoji} {i===0?"🥇":i===1?"🥈":i===2?"🥉":""}</div>
<div style={{fontSize:12,fontWeight:700}}>{rtl?p.name_ar:p.name}</div>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#059669",marginTop:4}}>{fm(+p.total_gross_profit)}</div>
<div style={{fontSize:9,color:"#6b7280"}}>{p.gross_margin_pct}% {rtl?"هامش":"margin"} · {p.total_qty_sold} {rtl?"مباع":"sold"}</div>
</div>)}
</div></div>}

{/* Loss Items Alert */}
{lossItems.length>0&&<div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:16,padding:14,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#991b1b",marginBottom:8}}>⚠️ {rtl?"منتجات خاسرة (بعد المرتجعات)":"Loss Items (after returns)"}</div>
{lossItems.map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0"}}><span>{p.emoji} {rtl?p.name_ar:p.name}</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:"#dc2626"}}>{fm(+p.net_profit)}</span></div>)}
</div>}

{/* Full Table */}
<div style={{overflowX:"auto"}}><table className="at"><thead><tr><th>{t.product}</th><th>{t.price}</th><th>{t.cost}</th><th>{rtl?"هامش الوحدة":"Unit Margin"}</th><th>{rtl?"هامش %":"Margin %"}</th><th>{rtl?"مباع":"Sold"}</th><th>{rtl?"إيراد":"Revenue"}</th><th>{rtl?"ربح إجمالي":"Gross Profit"}</th><th>{rtl?"مرتجعات":"Returns"}</th><th>{rtl?"صافي":"Net"}</th></tr></thead>
<tbody>{sorted.map(p=><tr key={p.id}>
<td style={{fontWeight:600}}>{p.emoji} {rtl?p.name_ar:p.name}</td>
<td style={{fontFamily:"var(--m)"}}>{fN(+p.price)}</td>
<td style={{fontFamily:"var(--m)"}}>{fN(+p.cost)}</td>
<td style={{fontFamily:"var(--m)",color:+p.unit_gross_profit>0?"#059669":"#dc2626"}}>{fN(+p.unit_gross_profit)}</td>
<td style={{fontFamily:"var(--m)",fontWeight:600,color:+p.gross_margin_pct>=30?"#059669":+p.gross_margin_pct>=15?"#d97706":"#dc2626"}}>{p.gross_margin_pct}%</td>
<td style={{fontFamily:"var(--m)"}}>{p.total_qty_sold}</td>
<td style={{fontFamily:"var(--m)"}}>{fm(+p.total_revenue)}</td>
<td style={{fontFamily:"var(--m)",color:+p.total_gross_profit>=0?"#059669":"#dc2626",fontWeight:700}}>{fm(+p.total_gross_profit)}</td>
<td style={{fontFamily:"var(--m)",color:+p.return_losses>0?"#dc2626":"#d1d5db"}}>{+p.return_losses>0?"-"+fm(+p.return_losses):"—"}</td>
<td style={{fontFamily:"var(--m)",fontWeight:800,color:+p.net_profit>=0?"#059669":"#dc2626"}}>{fm(+p.net_profit)}</td>
</tr>)}</tbody></table></div>
</>})()}

{/* DOCUMENTS */}
{finTab==="documents"&&<><h2>📁 {t.documents}</h2>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:14}} onClick={()=>{setDocMod(true);setNewDoc({title:"",type:"other",description:"",date:new Date().toISOString().slice(0,10),file:null,fileName:""})}}>{t.addDoc}</button>

{documents.length===0?<div style={{textAlign:"center",padding:60,color:"#9ca3af"}}><div style={{fontSize:48,marginBottom:8}}>📁</div>{t.noDocuments}</div>:
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:12}}>
{documents.map((doc,i)=>{
const typeColors={rent:"#dc2626",license:"#2563eb",insurance:"#059669",agreement:"#7c3aed",other:"#6b7280"};
const typeIcons={rent:"🏠",license:"📋",insurance:"🛡️",agreement:"📝",other:"📄"};
return<div key={i} style={{background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:16,padding:16,position:"relative",cursor:"pointer",transition:"all .15s"}} onClick={()=>setViewDocMod(doc)} onMouseOver={e=>e.currentTarget.style.borderColor="#2563eb"} onMouseOut={e=>e.currentTarget.style.borderColor="#e5e7eb"}>
<div style={{position:"absolute",top:0,left:0,right:0,height:4,background:typeColors[doc.type]||"#6b7280",borderRadius:"16px 16px 0 0"}}/>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginTop:4}}>
<div style={{display:"flex",alignItems:"center",gap:10}}>
{doc.file&&doc.file.startsWith("data:image")?<img src={doc.file} style={{width:44,height:44,objectFit:"cover",borderRadius:10,border:"1px solid #e5e7eb"}} alt=""/>:<div style={{fontSize:28}}>{typeIcons[doc.type]||"📄"}</div>}
<div>
<div style={{fontSize:14,fontWeight:700,color:"#374151"}}>{doc.title}</div>
<span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:(typeColors[doc.type]||"#6b7280")+"15",color:typeColors[doc.type]||"#6b7280"}}>{t[doc.type==="rent"?"rentContract":doc.type==="license"?"license":doc.type==="insurance"?"insurance":doc.type==="agreement"?"agreement":"otherDoc"]}</span>
</div>
</div>
{cu.role==="admin"&&<button className="ab ab-d" style={{fontSize:9}} onClick={(e2)=>{e2.stopPropagation();if(!confirm(rtl?"حذف؟":"Delete?"))return;saveDocuments(documents.filter((_,x)=>x!==i))}}>✕</button>}
</div>
{doc.description&&<div style={{fontSize:11,color:"#6b7280",marginTop:8}}>{doc.description}</div>}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
<span style={{fontSize:10,color:"#9ca3af",fontFamily:"var(--m)"}}>{doc.date}</span>
{doc.file&&<span style={{fontSize:10,color:"#2563eb",fontWeight:600}}>📎 {doc.fileName}</span>}
</div>
</div>})}
</div>}
</>}

</div></div>})()}

{/* ═══ SALE TAB — REDESIGNED ═══ */}
{tab==="sale"&&(!activeShift?<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"linear-gradient(180deg,#fffbeb,#fff)",gap:16,padding:40}}>
<div style={{fontSize:80,opacity:.8}}>🔒</div>
<div style={{fontSize:24,fontWeight:800,color:"#92400e"}}>{rtl?"لا يوجد وردية مفتوحة":"No Active Shift"}</div>
<div style={{fontSize:15,color:"#6b7280",textAlign:"center",maxWidth:400,lineHeight:1.6}}>{rtl?"يجب فتح وردية قبل بدء البيع. اذهب إلى إغلاق الصندوق لفتح وردية جديدة.":"You must open a shift before making sales. Go to Register Closures to open a new shift."}</div>
<div style={{display:"flex",gap:12,marginTop:8}}>
<button onClick={()=>setTab("regClose")} style={{padding:"14px 32px",background:"#059669",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",boxShadow:"0 4px 16px rgba(5,150,105,.3)"}}>🟢 {rtl?"فتح وردية":"Open Shift"}</button>
<button onClick={()=>setTab("home")} style={{padding:"14px 24px",background:"#f1f5f9",border:"1.5px solid #e2e8f0",borderRadius:12,color:"#475569",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>🏠 {rtl?"الرئيسية":"Home"}</button>
</div>
</div>:<div style={{display:"flex",flex:1,overflow:"hidden",height:"100%"}}>

{/* ═══ LEFT: CATEGORIES ═══ */}
<div style={{width:340,display:"flex",flexDirection:"column",background:"#f8fafc",borderRight:rtl?"none":"1px solid #e2e8f0",borderLeft:rtl?"1px solid #e2e8f0":"none",flexShrink:0,overflow:"hidden"}}>

{/* Search */}
<div style={{padding:"10px 12px",background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",gap:6}}>
<div style={{flex:1,position:"relative"}}>
<span style={{position:"absolute",[rtl?"right":"left"]:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#94a3b8"}}>🔍</span>
<input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t.search} style={{width:"100%",padding:"10px 12px 10px 36px",background:"#f1f5f9",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"var(--f)",outline:"none",color:"#1e293b"}}/>
</div>
<button onClick={()=>setBM(true)} style={{padding:"10px 14px",background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>▦</button>
<button onClick={()=>{setBM(true);setCamScan(true)}} style={{padding:"10px 14px",background:"#0d9488",border:"none",borderRadius:10,color:"#fff",cursor:"pointer",fontSize:13}}>📷</button>
</div>

{/* Category Grid */}
<div style={{flex:1,overflowY:"auto",padding:10}}>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
{CATS_ALL.map(c=><button key={c.id} onClick={()=>setCat(c.id)} style={{padding:"14px 6px",background:cat===c.id?"#1e40af":"#fff",border:cat===c.id?"none":"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontWeight:700,color:cat===c.id?"#fff":"#475569",cursor:"pointer",fontFamily:"var(--f)",textAlign:"center",lineHeight:1.3,transition:"all .15s"}}>{c.i}<br/>{t[c.k]||c.id}</button>)}
</div>

{/* Product list under categories */}
<div style={{marginTop:10,fontSize:11,color:"#64748b",fontWeight:600,padding:"0 2px"}}>{fp.length} {rtl?"منتج":"products"}{search&&" — \""+search+"\""}</div>
<div style={{marginTop:6,display:"flex",flexDirection:"column",gap:2}}>
{fpVisible.map(p=><div key={p.id} onClick={()=>addToCart(p)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:p.s<=0?"#fef2f2":"#fff",border:"1px solid "+(p.s<=0?"#fecaca":"#f1f5f9"),borderRadius:8,cursor:"pointer",transition:"all .1s"}} onMouseEnter={e=>{e.currentTarget.style.background=p.s<=0?"#fee2e2":"#eff6ff";e.currentTarget.style.borderColor=p.s<=0?"#fca5a5":"#bfdbfe"}} onMouseLeave={e=>{e.currentTarget.style.background=p.s<=0?"#fef2f2":"#fff";e.currentTarget.style.borderColor=p.s<=0?"#fecaca":"#f1f5f9"}}>
<span style={{fontSize:16,width:24,textAlign:"center",flexShrink:0}}>{p.e}</span>
<div style={{flex:1,minWidth:0}}>
<div style={{fontSize:14,fontWeight:600,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pN(p)}</div>
<div style={{fontSize:9,color:"#94a3b8",fontFamily:"var(--m)"}}>{p.bc} · {rtl?"المخزون":"Stock"}: <span style={{color:p.s<0?"#dc2626":p.s===0?"#dc2626":p.s<10?"#d97706":"#059669",fontWeight:800}}>{p.s}{p.s<0?" ⚠️":p.s===0?" ⛔":""}</span></div>
</div>
<div style={{fontFamily:"var(--m)",fontSize:15,fontWeight:800,color:"#1e40af",flexShrink:0}}>{fN(p.p)}</div>
</div>)}
{fp.length>fpVisible.length&&<button onClick={()=>setPosPage(p=>p+1)} style={{padding:"10px",background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:10,color:"#1e40af",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",marginTop:4,textAlign:"center"}}>{rtl?"عرض المزيد":"Load more"} ({fpVisible.length}/{fp.length})</button>}
{!fp.length&&<div style={{textAlign:"center",padding:30,color:"#94a3b8",fontSize:12}}>{t.none}</div>}
</div>
</div>
</div>

{/* ═══ RIGHT: CART TABLE + CHECKOUT ═══ */}
<div style={{flex:1,display:"flex",flexDirection:"column",background:"#fff",overflow:"hidden"}}>

{/* Receipt number */}
<div style={{padding:"8px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>{rtl?"الفاتورة":"Invoice"}</div>
{activeShift&&<span style={{fontSize:9,background:"#ecfdf5",color:"#059669",padding:"2px 8px",borderRadius:10,fontWeight:600}}>{rtl?"وردية نشطة":"Shift Active"}</span>}
</div>
<div style={{display:"flex",alignItems:"center",gap:6}}>
{cart.length>0&&<button onClick={clr} style={{padding:"5px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,color:"#dc2626",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>✕ {t.clear}</button>}
<span style={{fontSize:11,color:"#64748b",fontFamily:"var(--m)"}}>{new Date().toLocaleDateString()}</span>
</div>
</div>

{/* Cart Table */}
<div style={{flex:1,overflowY:"auto"}}>
{!cart.length?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"#cbd5e1",gap:8}}>
<div style={{fontSize:48,opacity:.3}}>🛒</div>
<div style={{fontSize:14,fontWeight:600,color:"#94a3b8"}}>{t.empty}</div>
<div style={{fontSize:11,color:"#cbd5e1"}}>{t.emptyHint}</div>
</div>:
<table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
<thead><tr style={{background:"#f8fafc",position:"sticky",top:0,zIndex:1}}>
<th style={{padding:"10px 14px",textAlign:rtl?"right":"left",fontWeight:700,color:"#475569",borderBottom:"2px solid #e2e8f0",fontSize:12}}>{t.product}</th>
<th style={{padding:"10px 8px",fontWeight:700,color:"#475569",borderBottom:"2px solid #e2e8f0",fontSize:12,width:90}}>{t.bc}</th>
<th style={{padding:"10px 8px",fontWeight:700,color:"#475569",borderBottom:"2px solid #e2e8f0",fontSize:12,width:70,textAlign:"center"}}>{t.qty}</th>
<th style={{padding:"10px 8px",fontWeight:700,color:"#475569",borderBottom:"2px solid #e2e8f0",fontSize:12,width:70,textAlign:"center"}}>{t.price}</th>
<th style={{padding:"10px 8px",fontWeight:700,color:"#475569",borderBottom:"2px solid #e2e8f0",fontSize:12,width:80,textAlign:"center"}}>{t.total}</th>
<th style={{padding:"10px 8px",borderBottom:"2px solid #e2e8f0",width:50}}></th>
</tr></thead>
<tbody>{cart.map((i,idx)=>{const isNewest=idx===0&&i._addedAt&&(Date.now()-i._addedAt<3000);return<tr key={i.id} style={{borderBottom:"1px solid #f1f5f9",animation:"sIn .15s ease",background:idx===0?"#ecfdf5":"transparent",boxShadow:isNewest?"inset 4px 0 0 #059669":idx===0?"inset 3px 0 0 #10b981":"none",transition:"background .3s"}}>
<td style={{padding:"10px 14px"}}><div style={{fontWeight:600,color:"#1e293b"}}>{pN(i)}</div></td>
<td style={{padding:"10px 8px",fontFamily:"var(--m)",fontSize:10,color:"#94a3b8"}}>{i.bc?.slice(0,12)}{i.bc?.length>12?"...":""}</td>
<td style={{padding:"6px 4px",textAlign:"center"}}><div style={{display:"inline-flex",alignItems:"center",background:"#f1f5f9",borderRadius:8,border:"1px solid #e2e8f0"}}>
<button onMouseDown={e=>e.preventDefault()} tabIndex={-1} onClick={e=>{uQ(i.id,-1);e.currentTarget.blur()}} style={{width:28,height:28,border:"none",background:"none",color:"#64748b",cursor:"pointer",fontSize:14,fontWeight:700}}>−</button>
<input type="number" value={i.qty} onChange={e=>{const v=parseInt(e.target.value);if(v>0)setCart(prev=>prev.map(x=>x.id===i.id?{...x,qty:v}:x))}} style={{width:36,textAlign:"center",border:"none",background:"none",fontFamily:"var(--m)",fontSize:13,fontWeight:700,outline:"none"}}/>
<button onMouseDown={e=>e.preventDefault()} tabIndex={-1} onClick={e=>{uQ(i.id,1);e.currentTarget.blur()}} style={{width:28,height:28,border:"none",background:"none",color:"#64748b",cursor:"pointer",fontSize:14,fontWeight:700}}>+</button>
</div></td>
<td style={{padding:"10px 8px",textAlign:"center",fontFamily:"var(--m)",fontWeight:600,color:"#475569"}}>{fN(i.p)}</td>
<td style={{padding:"10px 8px",textAlign:"center",fontFamily:"var(--m)",fontWeight:800,color:"#1e40af"}}>{fN(i.p*i.qty)}</td>
<td style={{padding:"6px",textAlign:"center"}}><button onMouseDown={e=>e.preventDefault()} tabIndex={-1} onClick={e=>{rI(i.id);e.currentTarget.blur()}} style={{width:28,height:28,borderRadius:"50%",border:"1.5px solid #fecaca",background:"#fff",color:"#dc2626",cursor:"pointer",fontSize:12,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>✕</button></td>
</tr>})}</tbody>
</table>}
</div>

{/* ═══ SUMMARY ═══ */}
<div style={{borderTop:"2px solid #e2e8f0",background:"#f8fafc",padding:"12px 20px",flexShrink:0}}>

{/* Customer lookup row */}
<div style={{display:"flex",gap:6,marginBottom:8}}>
<div style={{position:"relative",flex:1}}>
<span style={{position:"absolute",[rtl?"right":"left"]:10,top:"50%",transform:"translateY(-50%)",fontSize:12}}>📱</span>
<input value={custPhoneInput} onChange={e=>{setCustPhoneInput(e.target.value);if(!e.target.value)setSelCust(null)}} onKeyDown={e=>{if(e.key==="Enter")inlineLookup(custPhoneInput)}} placeholder={t.searchCust} style={{width:"100%",padding:"8px 10px 8px 32px",background:selCust?"#eff6ff":"#fff",border:selCust?"2px solid #1e40af":"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,fontFamily:"var(--m)",outline:"none",direction:"ltr"}}/>
</div>
<button onClick={()=>inlineLookup(custPhoneInput)} disabled={!custPhoneInput.trim()} style={{padding:"8px 14px",background:"#1e40af",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:11,opacity:custPhoneInput.trim()?"1":".4"}}>🔍</button>
<button onClick={()=>{setCustMod(true);setCustPhone(custPhoneInput);setCustSearch(null)}} style={{padding:"8px 10px",background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:8,color:"#64748b",cursor:"pointer",fontSize:11}}>👤+</button>
{selCust&&<div style={{display:"flex",alignItems:"center",gap:6,background:"#eff6ff",padding:"4px 10px",borderRadius:8,border:"1px solid #bfdbfe"}}>
<span style={{fontSize:11,fontWeight:700,color:"#1e40af"}}>{selCust.name}</span>
<span style={{fontSize:9,background:"#dbeafe",padding:"1px 6px",borderRadius:8,fontWeight:700,color:"#1e40af",textTransform:"uppercase"}}>{t[selCust.tier]} · {selCust.pts}pts</span>
<button onClick={()=>{setSelCust(null);setRedeemPts(0);setCustPhoneInput("")}} style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:10}}>✕</button>
</div>}
</div>

{selCust&&selCust.pts>=20&&<div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:10,color:"#64748b"}}>{t.redeemPts}:</span>
<input type="range" min="0" max={Math.min(selCust.pts,Math.floor(tot/0.005))} step="10" value={redeemPts} onChange={e=>setRedeemPts(+e.target.value)} style={{flex:1,accentColor:"#1e40af",height:4}}/>
<span style={{fontSize:11,fontWeight:700,color:"#7c3aed",fontFamily:"var(--m)"}}>{redeemPts>0?"-"+fm(redeemVal):"0"}</span>
</div>}

{/* Summary grid */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px 20px",fontSize:14,marginBottom:8}}>
<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#64748b"}}>{t.subtotal} :</span><span style={{fontFamily:"var(--m)",fontWeight:700}}>{fm(sub)}</span></div>
<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#64748b"}}>{t.qty} :</span><span style={{fontFamily:"var(--m)",fontWeight:700}}>{cCnt}</span></div>
<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#64748b"}}>{t.vat} :</span><span style={{fontFamily:"var(--m)",fontWeight:700}}>{fm(tax)}</span></div>
<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#64748b"}}>{t.discount} :</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:aDisc>0?"#dc2626":"inherit"}}>{aDisc>0?"-"+fm(dA):"0.000"}</span></div>
{redeemPts>0&&selCust&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#7c3aed"}}>🎁 {t.redeemPts} :</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:"#7c3aed"}}>-{fm(redeemVal)}</span></div>}
{appliedCoupon&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#7c3aed"}}>🎟️ {appliedCoupon.code} :</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:"#059669"}}>{appliedCoupon.coupon_type==="percent"?appliedCoupon.discount_value+"%":fm(+appliedCoupon.discount_value)}</span></div>}
</div>

{/* Total */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<span style={{fontSize:20,fontWeight:900,color:"#dc2626"}}>{t.total} :</span>
<span style={{fontSize:32,fontWeight:900,color:"#dc2626",fontFamily:"var(--m)"}}>{fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</span>
</div>

{/* Action buttons row */}
<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
<button onClick={()=>{setPM("cash");setCT("")}} disabled={!cart.length} style={{flex:"1 1 80px",padding:"12px 8px",background:"#059669",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:cart.length?"1":".3",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>💵</span>{t.cash}
</button>
<button onClick={()=>{setPM("card");setCT("")}} disabled={!cart.length} style={{flex:"1 1 80px",padding:"12px 8px",background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:cart.length?"1":".3",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>💳</span>{t.card}
</button>
<button onClick={()=>{if(!cart.length)return;setHeld(p=>[...p,{id:gI(),items:[...cart],time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}),disc:aDisc}]);clr()}} disabled={!cart.length} style={{flex:"1 1 80px",padding:"12px 8px",background:"#7c3aed",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:cart.length?"1":".3",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>⏸</span>{t.hold}
</button>
<button onClick={()=>setMiscMod(true)} style={{flex:"1 1 80px",padding:"12px 8px",background:"#9333ea",border:"none",borderRadius:10,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>➕</span>{rtl?"متفرقات":"Misc"}
</button>
<button onClick={()=>{const v=prompt(rtl?"نسبة الخصم %":"Discount %","");if(v){const n=parseFloat(v);if(!isNaN(n)&&n>0&&n<=100)setAD(n)}}} style={{flex:"1 1 80px",padding:"12px 8px",background:"#d97706",border:"none",borderRadius:10,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>%</span>{t.discount}
</button>
<button onClick={()=>{setPM("mobile");setCT("")}} disabled={!cart.length} style={{flex:"1 1 80px",padding:"12px 8px",background:"#0d9488",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:cart.length?"1":".3",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>📱</span>{t.mada}
</button>
{selCust&&<button onClick={()=>{setPM("credit");setCT("")}} disabled={!cart.length} style={{flex:"1 1 80px",padding:"12px 8px",background:"#7c3aed",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:cart.length?"1":".3",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>📝</span>{rtl?"آجل":"Credit"}
</button>}
<button onClick={async()=>{if(!couponInput){const code=prompt(rtl?"رمز القسيمة":"Coupon code","");if(!code)return;setCouponInput(code.toUpperCase());try{const cp=await DB.findCoupon(code.toUpperCase());if(!cp){sT("✗ Invalid","err");return}if(cp.valid_until&&new Date(cp.valid_until)<new Date()){sT("✗ Expired","err");return}if(cp.used_count>=cp.max_uses){sT("✗ Used","err");return}if(cp.min_purchase>0&&sub<+cp.min_purchase){sT("✗ Min: "+fm(+cp.min_purchase),"err");return}setAppliedCoupon(cp);if(cp.coupon_type==="percent"&&+cp.discount_value>0)setAD(+cp.discount_value);sT("✓ 🎟️ "+cp.code,"ok")}catch{sT("✗ Invalid","err")}}else{setAppliedCoupon(null);setCouponInput("");setAD(0);sT("✓ Removed","ok")}}} style={{flex:"1 1 80px",padding:"12px 8px",background:appliedCoupon?"#dc2626":"#be185d",border:"none",borderRadius:10,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
<span style={{fontSize:16}}>🎟️</span>{appliedCoupon?rtl?"إزالة":"Remove":rtl?"قسيمة":"Coupon"}
</button>
</div>
</div>
</div>
</div>)}
{/* HELD */}
{tab==="held"&&<div className="hld"><h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>⏸ {t.held} ({held.length})</h2>{!held.length?<div style={{textAlign:"center",padding:60,color:"#9ca3af"}}><div style={{fontSize:48}}>📋</div>{t.noHeld}</div>:held.map(o=><div key={o.id} className="hc"><div className="ht2"><span className="hid">{o.id}</span><span className="htm">{o.date}</span></div><div className="hti">{o.items.map(i=>pN(i)+" ×"+i.qty).join(", ")}</div><div className="htt">{fm(o.items.reduce((s,i)=>s+i.p*i.qty,0))}</div><div className="has"><button className="hbn hbn-r" onClick={()=>{setCart(o.items);setAD(o.disc);setHeld(p=>p.filter(x=>x.id!==o.id));setTab("sale")}}>{t.resume}</button><button className="hbn hbn-d" onClick={()=>setHeld(p=>p.filter(x=>x.id!==o.id))}>{t.del}</button></div></div>)}</div>}

{/* SALES VIEW — FULL TRANSACTION HISTORY */}

{/* ═══ ORDERS TAB ═══ */}
{tab==="orders"&&<div style={{flex:1,overflowY:"auto",padding:16}}>
<h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>📋 {rtl?"الطلبات":"Orders"}</h2>

{/* Order stats */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
{[
{l:rtl?"اليوم":"Today",v:txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}}).length,c:"#059669",bg:"#ecfdf5",i:"📊"},
{l:rtl?"معلقة":"Held",v:held.length,c:"#d97706",bg:"#fffbeb",i:"⏸"},
{l:rtl?"نقدي":"Cash",v:txns.filter(tx=>tx.method==="cash"&&(()=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}})()).length,c:"#059669",bg:"#ecfdf5",i:"💵"},
{l:rtl?"بطاقة":"Card",v:txns.filter(tx=>(tx.method==="card"||tx.method==="mobile")&&(()=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}})()).length,c:"#2563eb",bg:"#eff6ff",i:"💳"},
].map((s,i)=><div key={i} style={{background:s.bg,borderRadius:14,padding:14,textAlign:"center"}}>
<div style={{fontSize:9,color:s.c,fontWeight:600}}>{s.i} {s.l}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:s.c}}>{s.v}</div>
</div>)}
</div>

{/* Held orders */}
{held.length>0&&<div style={{marginBottom:16}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:8,color:"#d97706"}}>⏸ {rtl?"طلبات معلقة":"Held Orders"} ({held.length})</div>
{held.map(o=><div key={o.id} style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:12,padding:14,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div><div style={{fontWeight:700,fontSize:13}}>{o.id}</div><div style={{fontSize:11,color:"#6b7280"}}>{o.date} {o.time} · {o.items.length} {t.items} · {fm(o.items.reduce((s,i)=>s+i.p*i.qty,0))}</div></div>
<div style={{display:"flex",gap:6}}><button className="ab ab-s" onClick={()=>{setCart(o.items);setAD(o.disc);setHeld(p=>p.filter(x=>x.id!==o.id));setTab("sale")}}>{t.resume}</button><button className="ab ab-d" onClick={()=>setHeld(p=>p.filter(x=>x.id!==o.id))}>✕</button></div>
</div>)}
</div>}

{/* Recent completed orders */}
<div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📋 {rtl?"آخر الطلبات":"Recent Orders"}</div>
{txns.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>{t.noTxns}</div>:
<table className="at"><thead><tr><th>{t.receipt}</th><th>{t.time}</th><th>{t.items}</th><th>{t.method}</th><th>👤</th><th>{t.total}</th><th>{t.act}</th></tr></thead>
<tbody>{txns.slice(0,30).map(tx=><tr key={tx.id} style={{cursor:"pointer"}} onClick={()=>openReceiptWithItems(tx)}>
<td style={{fontFamily:"var(--m)",fontSize:11,fontWeight:700,color:"#1e40af"}}>{tx.rn}</td>
<td style={{fontSize:11}}>{tx.date} {tx.time}</td>
<td style={{fontFamily:"var(--m)"}}>{tx.items.reduce((s,i)=>s+i.qty,0)}</td>
<td><span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:tx.method==="cash"?"#ecfdf5":tx.method==="card"?"#eff6ff":"#f5f3ff",color:tx.method==="cash"?"#059669":tx.method==="card"?"#2563eb":"#7c3aed"}}>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</span></td>
<td style={{fontSize:11,color:tx.custPhone?"#1e40af":"#d1d5db"}}>{tx.custName||"—"}</td>
<td className="mn" style={{color:"#059669",fontWeight:700}}>{fm(tx.tot)}</td>
<td><button className="ab ab-e" onClick={e=>{e.stopPropagation();openReceiptWithItems(tx)}}>🖨</button></td>
</tr>)}</tbody></table>}
</div>}

{/* ═══ CASH MANAGEMENT TAB ═══ */}
{tab==="cashMgmt"&&<div style={{flex:1,overflowY:"auto",padding:16}}>
<h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>💰 {rtl?"إدارة النقد":"Cash Management"}</h2>

{/* Register balance */}
{(()=>{const regAcct=bankAccts.find(a=>a.name.toLowerCase().includes("cash register")||a.name_ar?.includes("صندوق"));const pettyAcct=bankAccts.find(a=>a.name.toLowerCase().includes("petty")||a.name_ar?.includes("الكاش"));
return<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
<div style={{background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",borderRadius:16,padding:16,textAlign:"center"}}>
<div style={{fontSize:10,color:"#059669",fontWeight:600}}>🗃️ {rtl?"صندوق النقد":"Cash Register"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{regAcct?fm(+regAcct.balance):"0.000"}</div>
</div>
<div style={{background:"linear-gradient(135deg,#fffbeb,#fef3c7)",borderRadius:16,padding:16,textAlign:"center"}}>
<div style={{fontSize:10,color:"#d97706",fontWeight:600}}>💵 {rtl?"الكاش":"Petty Cash"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{pettyAcct?fm(+pettyAcct.balance):"0.000"}</div>
</div>
<div style={{background:"linear-gradient(135deg,#eff6ff,#dbeafe)",borderRadius:16,padding:16,textAlign:"center"}}>
<div style={{fontSize:10,color:"#1e40af",fontWeight:600}}>📊 {rtl?"مبيعات اليوم":"Today Sales"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#1e40af"}}>{fm(txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}}).reduce((s,tx)=>s+tx.tot,0))}</div>
</div>
</div>})()}

{/* Active Shift Info */}
{activeShift&&<div style={{background:"#ecfdf5",border:"1.5px solid #86efac",borderRadius:14,padding:14,marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div><div style={{fontSize:12,fontWeight:700,color:"#059669"}}>✓ {rtl?"وردية نشطة":"Active Shift"}</div>
<div style={{fontSize:11,color:"#6b7280"}}>{activeShift.cashier_name} · {rtl?"افتتاحي":"Opening"}: {fm(+activeShift.opening_balance)} · {new Date(activeShift.shift_start).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div></div>
</div>}

{/* Cash In / Cash Out buttons */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
<button onClick={async()=>{const amt=prompt(rtl?"المبلغ المدخل (JD)":"Cash In Amount (JD)","");if(!amt)return;const n=parseFloat(amt);if(isNaN(n)||n<=0)return;const reason=prompt(rtl?"السبب (تغيير/قرض/أخرى)":"Reason (change fund/loan/other)","change fund");const regAcct=bankAccts.find(a=>a.name.toLowerCase().includes("cash register")||a.name_ar?.includes("صندوق"));if(!regAcct)return;
const newBal=+regAcct.balance+n;try{await DB.updateBankBalance(regAcct.id,newBal);await DB.addMoneyMovement({account_id:regAcct.id,type:"deposit",amount:n,balance_after:newBal,description:"Cash In: "+(reason||""),reference_no:"CI-"+Date.now().toString(36),created_by:cu?.id});setBankAccts(p=>p.map(a=>a.id===regAcct.id?{...a,balance:newBal}:a));setCashOps(p=>[{type:"in",amount:n,reason:reason||"",time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})},...p]);sT("✓ +"+fm(n)+" "+(rtl?"تم الإدخال":"Cash In"),"ok")}catch(e){console.error(e);sT("✗ Error","err")}
}} style={{padding:16,background:"#059669",border:"none",borderRadius:14,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
<span style={{fontSize:28}}>↑</span>{rtl?"إدخال نقد":"Cash In"}
</button>

<button onClick={async()=>{const amt=prompt(rtl?"المبلغ المخرج (JD)":"Cash Out Amount (JD)","");if(!amt)return;const n=parseFloat(amt);if(isNaN(n)||n<=0)return;const reason=prompt(rtl?"السبب (مورد/مصاريف/أخرى)":"Reason (supplier/expenses/other)","expenses");const regAcct=bankAccts.find(a=>a.name.toLowerCase().includes("cash register")||a.name_ar?.includes("صندوق"));if(!regAcct)return;if(n>+regAcct.balance){sT("✗ "+(rtl?"رصيد غير كافٍ":"Insufficient"),"err");return}
const newBal=+regAcct.balance-n;try{await DB.updateBankBalance(regAcct.id,newBal);await DB.addMoneyMovement({account_id:regAcct.id,type:"withdrawal",amount:n,balance_after:newBal,description:"Cash Out: "+(reason||""),reference_no:"CO-"+Date.now().toString(36),created_by:cu?.id});setBankAccts(p=>p.map(a=>a.id===regAcct.id?{...a,balance:newBal}:a));setCashOps(p=>[{type:"out",amount:n,reason:reason||"",time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})},...p]);sT("✓ -"+fm(n)+" "+(rtl?"تم الإخراج":"Cash Out"),"ok")}catch(e){console.error(e);sT("✗ Error","err")}
}} style={{padding:16,background:"#dc2626",border:"none",borderRadius:14,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
<span style={{fontSize:28}}>↓</span>{rtl?"إخراج نقد":"Cash Out"}
</button>
</div>

{/* Today's cash operations log */}
<div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📝 {rtl?"عمليات اليوم":"Today's Operations"}</div>
{cashOps.length===0?<div style={{textAlign:"center",padding:30,color:"#9ca3af",fontSize:12}}>{rtl?"لا عمليات نقدية اليوم":"No cash operations today"}</div>:
<div style={{display:"flex",flexDirection:"column",gap:6}}>{cashOps.map((op,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:op.type==="in"?"#ecfdf5":"#fef2f2",borderRadius:10,border:"1px solid "+(op.type==="in"?"#86efac":"#fecaca")}}>
<div><span style={{fontSize:14}}>{op.type==="in"?"↑":"↓"}</span> <span style={{fontWeight:600}}>{op.reason}</span> <span style={{fontSize:10,color:"#6b7280"}}>{op.time}</span></div>
<span style={{fontFamily:"var(--m)",fontWeight:800,color:op.type==="in"?"#059669":"#dc2626"}}>{op.type==="in"?"+":"-"}{fm(op.amount)}</span>
</div>)}</div>}

{/* Recent movements */}
<div style={{fontSize:14,fontWeight:700,margin:"16px 0 8px"}}>📄 {rtl?"آخر الحركات":"Recent Movements"}</div>
{movements.slice(0,10).map(m=>{const acct=bankAccts.find(a=>a.id===m.account_id);const isIn=m.type==="deposit"||m.type==="sales_deposit";return<div key={m.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid #f1f5f9",fontSize:12}}>
<div><span style={{fontWeight:600}}>{acct?(rtl?(acct.name_ar||acct.name):acct.name):"—"}</span> · <span style={{color:"#6b7280"}}>{m.description||m.type}</span></div>
<span style={{fontFamily:"var(--m)",fontWeight:700,color:isIn?"#059669":"#dc2626"}}>{isIn?"+":"-"}{fm(+m.amount)}</span>
</div>})}
</div>}

{/* ═══ PRODUCT QUANTITIES / STOCK CHECK TAB ═══ */}
{tab==="stockCheck"&&<div style={{flex:1,overflowY:"auto",padding:16}}>
<h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>📦 {rtl?"كميات المنتجات":"Product Quantities"}</h2>

{/* Search */}
<div style={{position:"relative",marginBottom:16}}>
<span style={{position:"absolute",[rtl?"right":"left"]:14,top:"50%",transform:"translateY(-50%)",color:"#94a3b8"}}>🔍</span>
<input value={stockSearch} onChange={e=>setStockSearch(e.target.value)} placeholder={rtl?"بحث بالاسم أو الباركود...":"Search by name or barcode..."} style={{width:"100%",padding:"14px 14px 14px 44px",background:"#f8fafc",border:"2px solid #e2e8f0",borderRadius:14,fontSize:14,fontFamily:"var(--f)",outline:"none"}}/>
</div>

{/* Stock summary */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#059669",fontWeight:600}}>{rtl?"إجمالي المنتجات":"Total Products"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{prods.length}</div></div>
<div style={{background:"#eff6ff",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#1e40af",fontWeight:600}}>{rtl?"متوفر":"In Stock"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#1e40af"}}>{prods.filter(p=>p.s>0).length}</div></div>
<div style={{background:"#fffbeb",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#d97706",fontWeight:600}}>{rtl?"مخزون منخفض":"Low Stock"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{prods.filter(p=>p.s>0&&p.s<10).length}</div></div>
<div style={{background:"#fef2f2",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:9,color:"#dc2626",fontWeight:600}}>{rtl?"نفذ":"Out of Stock"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#dc2626"}}>{prods.filter(p=>p.s<=0).length}</div></div>
</div>

{/* Product table */}
{(()=>{const stockProds=prods.filter(p=>!stockSearch||p.n.toLowerCase().includes(stockSearch.toLowerCase())||p.a.includes(stockSearch)||p.bc.includes(stockSearch)).slice(0,100);
return<table className="at"><thead><tr>
<th>{t.bc}</th><th>{t.product}</th><th>{t.cat}</th><th>{t.price}</th><th style={{textAlign:"center"}}>{t.stock}</th><th>{rtl?"الحالة":"Status"}</th>
</tr></thead>
<tbody>{stockProds.map(p=><tr key={p.id} style={{background:p.s<=0?"#fef2f2":p.s<10?"#fffbeb":"transparent"}}>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{p.bc}</td>
<td><div style={{fontWeight:600}}>{pN(p)}</div></td>
<td style={{fontSize:10}}>{p.cat}</td>
<td style={{fontFamily:"var(--m)"}}>{fN(p.p)}</td>
<td style={{textAlign:"center",fontFamily:"var(--m)",fontWeight:700,fontSize:14,color:p.s<=0?"#dc2626":p.s<10?"#d97706":"#059669"}}>{p.s}</td>
<td><span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:p.s<=0?"#fef2f2":p.s<10?"#fffbeb":"#ecfdf5",color:p.s<=0?"#dc2626":p.s<10?"#d97706":"#059669"}}>{p.s<=0?(rtl?"نفذ":"Out"):p.s<10?(rtl?"منخفض":"Low"):(rtl?"متوفر":"OK")}</span></td>
</tr>)}</tbody></table>})()}
{!stockSearch&&<div style={{textAlign:"center",padding:8,color:"#9ca3af",fontSize:11}}>{rtl?"يعرض أول ١٠٠ منتج — استخدم البحث":"Showing first 100 — use search for more"}</div>}
</div>}

{/* ═══ REGISTER CLOSURES TAB ═══ */}
{tab==="regClose"&&<div style={{flex:1,overflowY:"auto",padding:16}}>
<h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>🔒 {rtl?"إغلاق الصندوق":"Register Closures"}</h2>

{/* Open/Close shift */}
{!activeShift?<div style={{background:"#fffbeb",border:"2px dashed #fcd34d",borderRadius:16,padding:24,textAlign:"center",marginBottom:16}}>
<div style={{fontSize:40,marginBottom:8}}>🔓</div>
<div style={{fontSize:16,fontWeight:700,color:"#92400e",marginBottom:8}}>{rtl?"لا يوجد وردية مفتوحة":"No Active Shift"}</div>
<div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>{rtl?"افتح وردية جديدة لبدء البيع":"Open a new shift to start selling"}</div>
<button style={{padding:"14px 28px",background:"#059669",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}} onClick={async()=>{const ob=prompt(rtl?"الرصيد الافتتاحي (JD)":"Opening Balance (JD)","50");if(!ob)return;const s={user_id:cu?.id,cashier_name:cu?.fn,shift_date:new Date().toISOString().slice(0,10),shift_start:new Date().toISOString(),opening_balance:parseFloat(ob)||50,status:"open"};try{const r=await DB.openShift(s);if(r){setActiveShift(r);setCashShifts(p=>[r,...p]);setTab("sale");try{await DB.clockIn(cu?.id);sT("✓ "+(rtl?"بدأت الوردية وتم تسجيل الحضور":"Shift opened & checked in"),"ok")}catch{sT("✓ "+(rtl?"بدأت الوردية":"Shift opened"),"ok")}}}catch(e){console.error(e)}}}>🟢 {rtl?"فتح وردية":"Open Shift"}</button>
</div>

:/* Active shift — show close option */
<div style={{background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",border:"2px solid #86efac",borderRadius:16,padding:20,marginBottom:16}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
<div>
<div style={{fontSize:16,fontWeight:800,color:"#059669"}}>✓ {rtl?"وردية نشطة":"Active Shift"}</div>
<div style={{fontSize:12,color:"#374151",marginTop:4}}>{activeShift.cashier_name}</div>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"بدأت":"Started"}: {new Date(activeShift.shift_start).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"الافتتاحي":"Opening"}: {fm(+activeShift.opening_balance)}</div>
</div>
<div style={{fontSize:48,opacity:.2}}>✓</div>
</div>

{/* Close shift form */}
<div style={{marginTop:16,borderTop:"1px solid #86efac",paddingTop:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:8}}>🔒 {rtl?"إغلاق الصندوق":"Close Register"}</div>
<div style={{fontSize:11,color:"#6b7280",marginBottom:10}}>{rtl?"عد النقد في الصندوق وأدخل المبلغ الفعلي":"Count the cash in drawer and enter actual amount"}</div>
<div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
<div style={{flex:1}}>
<label style={{fontSize:11,fontWeight:600,color:"#374151"}}>{rtl?"المبلغ الفعلي في الصندوق (JD)":"Actual Cash in Drawer (JD)"}</label>
<input type="number" value={shiftCashCount} onChange={e=>setShiftCashCount(e.target.value)} placeholder="0.000" style={{width:"100%",padding:12,background:"#fff",border:"2px solid #86efac",borderRadius:10,fontSize:18,fontFamily:"var(--m)",fontWeight:700,outline:"none",textAlign:"center",marginTop:4}}/>
</div>
<button style={{padding:"14px 20px",background:"#dc2626",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}} onClick={async()=>{
if(!shiftCashCount)return;
const actualCash=parseFloat(shiftCashCount)||0;
const todayTx=txns.filter(tx=>{try{const ts=new Date(tx.ts);const ss=new Date(activeShift.shift_start);return ts>=ss}catch{return false}});
const cashSales=todayTx.filter(tx=>tx.method==="cash").reduce((s,tx)=>s+tx.tot,0);
const cardSales=todayTx.filter(tx=>tx.method==="card").reduce((s,tx)=>s+tx.tot,0);
const madaSales=todayTx.filter(tx=>tx.method==="mobile").reduce((s,tx)=>s+tx.tot,0);
const expectedCash=+activeShift.opening_balance+cashSales;
const diff=actualCash-expectedCash;
const u={shift_end:new Date().toISOString(),total_cash_sales:+cashSales.toFixed(3),total_card_sales:+cardSales.toFixed(3),total_mada_sales:+madaSales.toFixed(3),expected_cash:+expectedCash.toFixed(3),actual_cash:actualCash,cash_difference:+diff.toFixed(3),difference_type:diff>0.01?"overage":diff<-0.01?"shortage":"match",total_transactions:todayTx.length,total_items_sold:todayTx.reduce((s,tx)=>s+tx.items.reduce((a,i)=>a+i.qty,0),0),status:"closed"};
try{await DB.closeShift(activeShift.id,u);try{await DB.clockOut(cu?.id)}catch{}setCashShifts(p=>p.map(s=>s.id===activeShift.id?{...s,...u}:s));setActiveShift(null);setShiftCashCount("");sT("✓ "+(rtl?"تم إغلاق الوردية وتسجيل الانصراف":"Shift closed & clocked out")+(diff>0.01?" ↑ +"+fm(diff):diff<-0.01?" ↓ "+fm(diff):" ✓ Match"),"ok")}catch(e){console.error(e)}
}}>🔒 {rtl?"إغلاق الوردية":"Close Shift"}</button>
</div>

{/* Live preview */}
{shiftCashCount&&(()=>{const actual=parseFloat(shiftCashCount)||0;const todayTx=txns.filter(tx=>{try{return new Date(tx.ts)>=new Date(activeShift.shift_start)}catch{return false}});const cashS=todayTx.filter(tx=>tx.method==="cash").reduce((s,tx)=>s+tx.tot,0);const expected=+activeShift.opening_balance+cashS;const diff=actual-expected;
return<div style={{marginTop:10,background:"#fff",borderRadius:10,padding:12,fontSize:12}}>
<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}><span>{rtl?"الافتتاحي":"Opening"}</span><span style={{fontFamily:"var(--m)"}}>{fm(+activeShift.opening_balance)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}><span>💵 {rtl?"مبيعات نقدية":"Cash Sales"}</span><span style={{fontFamily:"var(--m)"}}>{fm(cashS)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderTop:"1px solid #e5e7eb",paddingTop:6,fontWeight:700}}><span>{rtl?"المتوقع":"Expected"}</span><span style={{fontFamily:"var(--m)"}}>{fm(expected)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontWeight:700}}><span>{rtl?"الفعلي":"Actual"}</span><span style={{fontFamily:"var(--m)"}}>{fm(actual)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"2px solid #1f2937",marginTop:4,fontWeight:800,fontSize:14,color:diff>0.01?"#059669":diff<-0.01?"#dc2626":"#374151"}}><span>{rtl?"الفرق":"Difference"}</span><span style={{fontFamily:"var(--m)"}}>{diff>0?"+":""}{fm(diff)} {diff>0.01?(rtl?"↑ فائض":"↑ Over"):diff<-0.01?(rtl?"↓ عجز":"↓ Short"):(rtl?"✓ مطابق":"✓ Match")}</span></div>
</div>})()}
</div>
</div>}

{/* Past closures */}
<div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📊 {rtl?"سجل الإغلاقات":"Closure History"}</div>
{cashShifts.filter(s=>s.status==="closed").length===0?<div style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{rtl?"لا إغلاقات سابقة":"No previous closures"}</div>:
<table className="at"><thead><tr><th>{t.expDate}</th><th>👤</th><th>{rtl?"افتتاحي":"Opening"}</th><th>💵 {rtl?"نقدي":"Cash"}</th><th>💳 {rtl?"بطاقة":"Card"}</th><th>{rtl?"متوقع":"Expected"}</th><th>{rtl?"فعلي":"Actual"}</th><th>{rtl?"الفرق":"Diff"}</th></tr></thead>
<tbody>{cashShifts.filter(s=>s.status==="closed").slice(0,20).map(s=><tr key={s.id}>
<td style={{fontSize:11,fontFamily:"var(--m)"}}>{s.shift_date}</td>
<td style={{fontSize:11}}>{s.cashier_name}</td>
<td className="mn">{fm(+s.opening_balance)}</td>
<td className="mn" style={{color:"#059669"}}>{fm(+s.total_cash_sales)}</td>
<td className="mn" style={{color:"#2563eb"}}>{fm((+(s.total_card_sales||0))+(+(s.total_mada_sales||0)))}</td>
<td className="mn">{fm(+s.expected_cash)}</td>
<td className="mn">{fm(+s.actual_cash)}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:s.difference_type==="overage"?"#059669":s.difference_type==="shortage"?"#dc2626":"#374151"}}>{+s.cash_difference>0?"+":""}{fm(+s.cash_difference)} {s.difference_type==="match"?"✓":s.difference_type==="overage"?"↑":"↓"}</td>
</tr>)}</tbody></table>}
</div>}


{/* ═══ POS RETURN TAB ═══ */}
{tab==="posReturn"&&<div style={{flex:1,overflowY:"auto",padding:16}}>
<h2 style={{fontSize:18,fontWeight:800,marginBottom:14}}>↩️ {rtl?"مرتجعات نقطة البيع":"POS Returns"}</h2>
<div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:14,padding:16,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:10}}>{rtl?"إرجاع بالإيصال":"Return by Receipt"}</div>
<div style={{display:"flex",gap:8}}>
<input id="ret-rn" placeholder={rtl?"رقم الإيصال":"Receipt number"} style={{flex:1,padding:"10px 14px",border:"1.5px solid #fde68a",borderRadius:10,fontSize:14,fontFamily:"var(--m)",outline:"none"}}/>
<button onClick={()=>{const el=document.getElementById("ret-rn");const rn=el?el.value:"";if(!rn)return;const tx=txns.find(x=>x.rn===rn);if(!tx){sT("✗ "+(rtl?"الإيصال غير موجود":"Receipt not found"),"err");return}setRM(tx);sT("✓ "+(rtl?"تم العثور":"Found"),"ok")}} style={{padding:"10px 20px",background:"#d97706",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>🔍</button>
</div>
</div>
<div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{rtl?"آخر المبيعات — اضغط على ↩️ للإرجاع أو على الصف لعرض الفاتورة":"Recent Sales — click ↩️ to return, or click row to view"}</div>
{txns.slice(0,20).map(tx=>{const retStatus=getTxnReturnStatus(tx);const bgColor=retStatus.status==="full"?"#fef2f2":retStatus.status==="partial"?"#fffbeb":"#fff";const borderColor=retStatus.status==="full"?"#fca5a5":retStatus.status==="partial"?"#fcd34d":"#e2e8f0";return <div key={tx.id} style={{background:bgColor,border:"1px solid "+borderColor,borderRadius:10,padding:12,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
<div style={{flex:1,cursor:"pointer"}} onClick={()=>openReceiptWithItems(tx)}>
<div style={{fontFamily:"var(--m)",fontSize:12,fontWeight:700,color:"#1e40af"}}>{tx.rn}
{retStatus.status==="full"&&<span style={{marginLeft:8,padding:"2px 8px",background:"#dc2626",color:"#fff",borderRadius:10,fontSize:9,fontWeight:700}}>↩️ {rtl?"مُرجع كلي":"FULL RETURN"}</span>}
{retStatus.status==="partial"&&<span style={{marginLeft:8,padding:"2px 8px",background:"#d97706",color:"#fff",borderRadius:10,fontSize:9,fontWeight:700}}>↩️ {rtl?"مُرجع جزئي":"PARTIAL RETURN"}</span>}
</div>
<div style={{fontSize:11,color:"#6b7280"}}>{tx.date} {tx.time} · {(tx.items||[]).length} {t.items}{retStatus.status!=="none"&&<span style={{marginLeft:6,color:retStatus.status==="full"?"#dc2626":"#d97706",fontWeight:600}}>· {rtl?"استرداد":"Refunded"}: {fm(retStatus.refundAmount)}</span>}</div>
</div>
<div style={{fontFamily:"var(--m)",fontWeight:700,color:retStatus.status==="full"?"#dc2626":"#059669",fontSize:14,textDecoration:retStatus.status==="full"?"line-through":"none"}}>{fm(tx.tot)}</div>
<button onClick={async(e)=>{e.stopPropagation();if(retStatus.status==="full"){sT("⚠ "+(rtl?"الفاتورة مُرجعة كلياً":"Fully returned"),"err");return}let txWithItems=tx;if(!tx.items||tx.items.length===0){try{const{data:items}=await sb.from("transaction_items").select("*").eq("transaction_id",tx.id).limit(5000);if(items&&items.length>0){txWithItems={...tx,items:items.map(i=>({id:i.product_id||"misc_"+i.id,n:i.product_name||"—",a:i.product_name_ar||i.product_name||"—",bc:i.barcode||"MISC",p:+i.unit_price,qty:i.quantity,_isMisc:!i.product_id}))};setTxns(prev=>prev.map(x=>x.id===tx.id?txWithItems:x))}else{sT("✗ "+(rtl?"لا توجد بنود لهذه الفاتورة":"No items for this transaction"),"err");return}}catch(er){sT("✗ "+er.message,"err");return}}setReturnTxn(txWithItems);setReturnItems(txWithItems.items.map(i=>({...i,returnQty:0,reason:""})));setSalesReturnMod(true)}} style={{padding:"8px 14px",background:retStatus.status==="full"?"#9ca3af":"#dc2626",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:800,cursor:retStatus.status==="full"?"not-allowed":"pointer",fontFamily:"var(--f)",whiteSpace:"nowrap",opacity:retStatus.status==="full"?0.5:1}} disabled={retStatus.status==="full"}>↩️ {rtl?"إرجاع":"Return"}</button>{cu.role==="admin"&&tx.voidStatus!=="voided"&&<button onClick={(e)=>{e.stopPropagation();setVoidMod(tx);setVoidReason("")}} style={{padding:"8px 12px",background:"#7c2d12",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",whiteSpace:"nowrap",marginLeft:4}}>🚫 {rtl?"إلغاء":"Void"}</button>}{tx.voidStatus==="voided"&&<span style={{padding:"6px 12px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,fontSize:10,fontWeight:700,marginLeft:4}}>🚫 {rtl?"ملغاة":"VOIDED"}</span>}
</div>})}
</div>}


{/* ── ANALYTICS TAB ── */}
{tab==="analytics"&&analytics&&<div style={{padding:16,overflowY:"auto",flex:1}}>
<h2 style={{fontSize:20,fontWeight:800,marginBottom:16}}>🧠 {rtl?"التحليلات الذكية":"Smart Analytics"}</h2>

{/* ── RECOMMENDED ACTIONS PANEL ── */}
{analytics.actions.length>0&&<div style={{background:"linear-gradient(135deg,#1e1b4b,#312e81)",borderRadius:20,padding:20,marginBottom:16,color:"#fff"}}>
<div style={{fontSize:15,fontWeight:700,marginBottom:12}}>💡 {rtl?"توصيات ذكية":"Smart Recommendations"} <span style={{fontSize:11,fontWeight:400,opacity:.7}}>({analytics.actions.length})</span></div>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{analytics.actions.slice(0,6).map((a,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"rgba(255,255,255,.08)",borderRadius:12,border:"1px solid rgba(255,255,255,.1)"}}>
<span style={{fontSize:20,flexShrink:0}}>{a.icon}</span>
<div style={{flex:1,fontSize:12,fontWeight:500}}>{rtl?a.ar:a.en}</div>
<span style={{padding:"3px 10px",borderRadius:14,fontSize:9,fontWeight:700,background:a.type==="reorder"?"#3b82f6":a.type==="discount"?"#d97706":a.type==="expiry"?"#dc2626":"#6b7280",flexShrink:0}}>{a.type}</span>
</div>)}
</div>
</div>}

{/* ── SALES FORECASTING ── */}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:16}}>
<div style={{background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",borderRadius:16,padding:18}}>
<div style={{fontSize:10,color:"#065f46",fontWeight:600}}>📈 {rtl?"توقع الغد":"Tomorrow Forecast"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#059669",marginTop:4}}>{fm(analytics.forecastTomorrow)}</div>
<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{rtl?"بناءً على نمط اليوم":"Based on weekday pattern"}</div>
</div>
<div style={{background:"linear-gradient(135deg,#eff6ff,#dbeafe)",borderRadius:16,padding:18}}>
<div style={{fontSize:10,color:"#1e40af",fontWeight:600}}>📊 {rtl?"توقع الأسبوع":"Weekly Forecast"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb",marginTop:4}}>{fm(analytics.forecastWeek)}</div>
<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{rtl?"7 أيام قادمة":"Next 7 days"}</div>
</div>
<div style={{background:"linear-gradient(135deg,#f5f3ff,#ede9fe)",borderRadius:16,padding:18}}>
<div style={{fontSize:10,color:"#5b21b6",fontWeight:600}}>📅 {rtl?"توقع الشهر":"Monthly Forecast"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed",marginTop:4}}>{fm(analytics.forecastMonth)}</div>
<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{rtl?"30 يوم قادم":"Next 30 days"}</div>
</div>
<div style={{background:"linear-gradient(135deg,#fffbeb,#fef3c7)",borderRadius:16,padding:18}}>
<div style={{fontSize:10,color:"#92400e",fontWeight:600}}>📈 {rtl?"اتجاه المبيعات":"Sales Trend"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:analytics.trendMultiplier>=1?"#059669":"#dc2626",marginTop:4}}>{analytics.trendMultiplier>=1?"↑":"↓"} {((analytics.trendMultiplier-1)*100).toFixed(0)}%</div>
<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{rtl?"آخر 7 أيام مقابل السابق":"Last 7d vs prior 7d"}</div>
</div>
</div>

{/* ── TREND CHART (last 30 days) ── */}
<div style={{background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",padding:16,marginBottom:16}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📈 {rtl?"مبيعات آخر 30 يوم":"Last 30 Days Sales"}</div>
<ResponsiveContainer width="100%" height={180}>
<AreaChart data={analytics.last30.map((v,i)=>({day:30-i,sales:v})).reverse()}>
<CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
<XAxis dataKey="day" fontSize={9} tick={{fill:"#9ca3af"}}/>
<YAxis fontSize={9} tick={{fill:"#9ca3af"}}/>
<Tooltip formatter={v=>fm(v)} labelFormatter={l=>"Day "+l}/>
<Area type="monotone" dataKey="sales" stroke="#2563eb" fill="#dbeafe" strokeWidth={2}/>
</AreaChart>
</ResponsiveContainer>
</div>

{/* ── SMART KPI WIDGETS ── */}
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:16}}>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,textAlign:"center"}}>
<div style={{fontSize:9,color:"#6b7280"}}>{rtl?"دوران المخزون":"Stock Turnover"}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{analytics.stockTurnover}x</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"سنوياً":"annualized"}</div>
</div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,textAlign:"center"}}>
<div style={{fontSize:9,color:"#6b7280"}}>{rtl?"قيمة المخزون":"Stock Value"}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#374151"}}>{fm(analytics.totalStockValue)}</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"بالتكلفة":"at cost"}</div>
</div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,textAlign:"center"}}>
<div style={{fontSize:9,color:"#6b7280"}}>{rtl?"المبيعات اليومي":"Daily Average"}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(analytics.avgDaily)}</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"آخر 30 يوم":"last 30 days"}</div>
</div>
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:14,textAlign:"center"}}>
<div style={{fontSize:9,color:"#6b7280"}}>{rtl?"ساعة الذروة":"Peak Hour"}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{analytics.peakHour>12?(analytics.peakHour-12)+"PM":analytics.peakHour+"AM"}</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"أعلى مبيعات":"highest sales"}</div>
</div>
</div>

{/* ── ABC CLASSIFICATION ── */}
<div style={{background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",padding:16,marginBottom:16}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:12}}>📊 {rtl?"تصنيف ABC":"ABC Classification"}</div>

{/* ABC Summary bars */}
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
{[{l:"A",sub:rtl?"أعلى 80% إيراد":"Top 80% revenue",c:analytics.abcA.length,bg:"#059669",bgL:"#ecfdf5"},
{l:"B",sub:rtl?"15% إيراد":"15% revenue",c:analytics.abcB.length,bg:"#d97706",bgL:"#fffbeb"},
{l:"C",sub:rtl?"5% أو أقل":"5% or less",c:analytics.abcC.length,bg:"#dc2626",bgL:"#fef2f2"}
].map(g=><div key={g.l} style={{background:g.bgL,borderRadius:14,padding:14,textAlign:"center",border:"1.5px solid "+g.bg+"30"}}>
<div style={{fontSize:28,fontWeight:800,color:g.bg}}>{g.l}</div>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#374151"}}>{g.c}</div>
<div style={{fontSize:9,color:"#6b7280"}}>{g.sub}</div>
</div>)}
</div>

{/* ABC Pie */}
<div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
<div style={{width:140,height:140}}>
<ResponsiveContainer width="100%" height="100%">
<PieChart><Pie data={[{name:"A",value:analytics.abcA.reduce((s,p)=>s+p.totalRevenue,0)},{name:"B",value:analytics.abcB.reduce((s,p)=>s+p.totalRevenue,0)},{name:"C",value:analytics.abcC.reduce((s,p)=>s+p.totalRevenue,0)}]} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3}>
{[{c:"#059669"},{c:"#d97706"},{c:"#dc2626"}].map((e,i)=><Cell key={i} fill={e.c}/>)}
</Pie></PieChart>
</ResponsiveContainer>
</div>
<div style={{flex:1,minWidth:200}}>
{[{grade:"A",items:analytics.abcA,color:"#059669"},{grade:"B",items:analytics.abcB,color:"#d97706"},{grade:"C",items:analytics.abcC,color:"#dc2626"}].map(g=>
<div key={g.grade} style={{marginBottom:8}}>
<div style={{fontSize:11,fontWeight:700,color:g.color,marginBottom:4}}>{g.grade} — {g.items.length} {rtl?"منتج":"products"}</div>
{g.items.slice(0,3).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0"}}>
<span>{p.e} {pN(p)}</span><span style={{fontFamily:"var(--m)",color:g.color}}>{fm(p.totalRevenue)}</span>
</div>)}
{g.items.length>3&&<div style={{fontSize:9,color:"#9ca3af"}}>+{g.items.length-3} {rtl?"أخرى":"more"}</div>}
</div>)}
</div>
</div>
</div>

{/* ── REORDER SUGGESTIONS ── */}
<div style={{background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",padding:16,marginBottom:16}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:12}}>🔄 {rtl?"اقتراحات إعادة الطلب":"Reorder Suggestions"}</div>

{(()=>{
const reorders=analytics.prodStats.filter(p=>p.urgency==="critical"||p.urgency==="high"||p.urgency==="medium").sort((a,b)=>{const p={critical:0,high:1,medium:2};return(p[a.urgency]||3)-(p[b.urgency]||3)});
return reorders.length===0?<div style={{textAlign:"center",padding:30,color:"#9ca3af"}}>✅ {rtl?"لا حاجة لإعادة طلب":"No reorders needed"}</div>:
<div style={{overflowX:"auto"}}><table className="at"><thead><tr><th>{t.product}</th><th>{t.stock}</th><th>{rtl?"معدل يومي":"Daily Avg"}</th><th>{rtl?"أيام متبقية":"Days Left"}</th><th>{rtl?"كمية مقترحة":"Suggested Qty"}</th><th>{rtl?"نقطة الطلب":"Reorder Pt"}</th><th>{rtl?"الأولوية":"Priority"}</th></tr></thead>
<tbody>{reorders.map(p=><tr key={p.id} style={{background:p.urgency==="critical"?"#fef2f2":p.urgency==="high"?"#fffbeb":"transparent"}}>
<td style={{fontWeight:600}}>{p.e} {pN(p)}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:p.s<=0?"#dc2626":p.s<=p.reorderPoint?"#d97706":"#059669"}}>{p.s}</td>
<td style={{fontFamily:"var(--m)"}}>{p.avgDailySales.toFixed(1)}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:p.daysRemaining<=3?"#dc2626":p.daysRemaining<=7?"#d97706":"#374151"}}>{p.daysRemaining===999?"∞":p.daysRemaining+"d"}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:"#2563eb"}}>{p.suggestedQty}</td>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{p.reorderPoint}</td>
<td><span style={{padding:"3px 10px",borderRadius:14,fontSize:9,fontWeight:700,color:"#fff",background:p.urgency==="critical"?"#dc2626":p.urgency==="high"?"#ea580c":"#d97706"}}>{p.urgency==="critical"?(rtl?"حرج":"CRITICAL"):p.urgency==="high"?(rtl?"عالي":"HIGH"):(rtl?"متوسط":"MEDIUM")}</span></td>
</tr>)}</tbody></table></div>})()}
</div>

{/* ── TOP MARGIN ITEMS ── */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
<div style={{background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",padding:16}}>
<div style={{fontSize:13,fontWeight:700,marginBottom:10}}>🏆 {rtl?"أعلى هامش ربح":"Top Margin Items"}</div>
{analytics.prodStats.filter(p=>p.totalRevenue>0).sort((a,b)=>b.marginPct-a.marginPct).slice(0,8).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f9fafb"}}>
<div style={{fontSize:12}}>{p.e} {pN(p)}</div>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<span style={{fontFamily:"var(--m)",fontSize:11,fontWeight:700,color:p.marginPct>=30?"#059669":p.marginPct>=15?"#d97706":"#dc2626"}}>{p.marginPct.toFixed(0)}%</span>
<div style={{width:40,height:6,background:"#f3f4f6",borderRadius:3,overflow:"hidden"}}><div style={{width:Math.min(100,p.marginPct)+"%",height:"100%",background:p.marginPct>=30?"#059669":p.marginPct>=15?"#d97706":"#dc2626",borderRadius:3}}/></div>
</div>
</div>)}
</div>
<div style={{background:"#fff",borderRadius:16,border:"1px solid #e5e7eb",padding:16}}>
<div style={{fontSize:13,fontWeight:700,marginBottom:10}}>📉 {rtl?"بطيئة الحركة":"Slow Movers"}</div>
{analytics.prodStats.filter(p=>p.s>0).sort((a,b)=>a.avgDailySales-b.avgDailySales).slice(0,8).map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #f9fafb"}}>
<div style={{fontSize:12}}>{p.e} {pN(p)}</div>
<div style={{textAlign:"right"}}>
<div style={{fontFamily:"var(--m)",fontSize:11,color:"#dc2626",fontWeight:600}}>{p.avgDailySales.toFixed(2)}/d</div>
<div style={{fontSize:9,color:"#9ca3af"}}>{p.s} {rtl?"بالمخزون":"in stock"}</div>
</div>
</div>)}
</div>
</div>
</div>}

{tab==="sales"&&(()=>{
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADVANCED SALES HISTORY — Multi-filter + Group By + Export
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Unique cashiers, customers, categories for dropdowns
const uniqueCashiers = [...new Set(txns.map(t=>t.cashierName).filter(Boolean))].sort();
const uniqueCategories = [...new Set(prods.map(p=>p.cat).filter(Boolean))].sort();

// ── Apply all filters
const filtered = txns.filter(tx => {
  // Text search (receipt/customer name/phone)
  if(salesSearch){
    const q = salesSearch.toLowerCase();
    const match = (tx.rn||"").toLowerCase().includes(q) || (tx.custName||"").toLowerCase().includes(q) || (tx.custPhone||"").includes(salesSearch);
    if(!match) return false;
  }
  // Receipt number exact
  if(salesReceiptFilter && !(tx.rn||"").toLowerCase().includes(salesReceiptFilter.toLowerCase())) return false;
  // Method
  if(salesMethod!=="all" && tx.method!==salesMethod) return false;
  // Date range
  if(salesDateFrom){try{if(new Date(tx.ts) < new Date(salesDateFrom)) return false}catch{}}
  if(salesDateTo){try{if(new Date(tx.ts) > new Date(salesDateTo+"T23:59:59")) return false}catch{}}
  // Time range (HH:MM)
  if(salesTimeFrom || salesTimeTo){
    try{
      const d = new Date(tx.ts);
      const mins = d.getHours()*60 + d.getMinutes();
      if(salesTimeFrom){
        const [h,m] = salesTimeFrom.split(":").map(Number);
        if(mins < h*60+m) return false;
      }
      if(salesTimeTo){
        const [h,m] = salesTimeTo.split(":").map(Number);
        if(mins > h*60+m) return false;
      }
    }catch{}
  }
  // Product filter (by barcode or product name in items)
  if(salesProductFilter){
    const q = salesProductFilter.toLowerCase();
    const hasProduct = (tx.items||[]).some(i => (i.bc||"").toLowerCase().includes(q) || (i.n||"").toLowerCase().includes(q) || (i.a||"").toLowerCase().includes(q));
    if(!hasProduct) return false;
  }
  // Category filter (check items' categories via products list)
  if(salesCategoryFilter){
    const hasCat = (tx.items||[]).some(i => {
      const prod = prods.find(p => p.id===i.id || p.bc===i.bc);
      return prod && prod.cat === salesCategoryFilter;
    });
    if(!hasCat) return false;
  }
  // Cashier filter
  if(salesCashierFilter && tx.cashierName !== salesCashierFilter) return false;
  // Customer filter
  if(salesCustomerFilter){
    const q = salesCustomerFilter.toLowerCase();
    if(!(tx.custName||"").toLowerCase().includes(q) && !(tx.custPhone||"").includes(salesCustomerFilter)) return false;
  }
  // Amount range
  if(salesAmountMin && tx.tot < parseFloat(salesAmountMin)) return false;
  if(salesAmountMax && tx.tot > parseFloat(salesAmountMax)) return false;
  // Status filter
  if(salesStatusFilter !== "all"){
    const retStatus = getTxnReturnStatus(tx);
    if(salesStatusFilter === "voided" && tx.voidStatus !== "voided") return false;
    if(salesStatusFilter === "normal" && (tx.voidStatus === "voided" || retStatus.status !== "none")) return false;
    if(salesStatusFilter === "full_return" && retStatus.status !== "full") return false;
    if(salesStatusFilter === "partial_return" && retStatus.status !== "partial") return false;
  }
  return true;
});

// ── Sort
const sorted = [...filtered].sort((a,b) => {
  if(salesSort==="oldest") return (a.ts||"") > (b.ts||"") ? 1 : -1;
  if(salesSort==="highest") return b.tot - a.tot;
  if(salesSort==="lowest") return a.tot - b.tot;
  return (b.ts||"") > (a.ts||"") ? 1 : -1;
});

const filteredTotal = sorted.reduce((s,tx) => s + tx.tot, 0);
const filteredRefund = sorted.reduce((s,tx) => s + getTxnReturnStatus(tx).refundAmount, 0);
const filteredNet = filteredTotal - filteredRefund;

// ── Group By logic
const groupedData = (() => {
  if(salesGroupBy === "none") return null;
  const groups = {};
  sorted.forEach(tx => {
    let key = "—";
    if(salesGroupBy === "cashier") key = tx.cashierName || "Unknown";
    else if(salesGroupBy === "method") key = tx.method === "cash" ? (rtl?"نقدي":"Cash") : tx.method === "card" ? (rtl?"فيزا":"Card") : (rtl?"كليك":"Mobile");
    else if(salesGroupBy === "date"){try{key = new Date(tx.ts).toISOString().slice(0,10)}catch{}}
    else if(salesGroupBy === "hour"){try{const d=new Date(tx.ts);key=String(d.getHours()).padStart(2,"0")+":00"}catch{}}
    else if(salesGroupBy === "customer") key = tx.custName || (rtl?"ضيف":"Guest");
    else if(salesGroupBy === "category"){
      // One tx can be in multiple category groups
      const cats = new Set();
      (tx.items||[]).forEach(i => {
        const prod = prods.find(p => p.id===i.id || p.bc===i.bc);
        if(prod && prod.cat) cats.add(prod.cat);
      });
      cats.forEach(cat => {
        if(!groups[cat]) groups[cat] = {txs:[], total:0, count:0, itemsCount:0, refund:0};
        groups[cat].txs.push(tx);
        groups[cat].total += tx.tot;
        groups[cat].count++;
        groups[cat].itemsCount += (tx.items||[]).reduce((s,i)=>s+i.qty,0);
        groups[cat].refund += getTxnReturnStatus(tx).refundAmount;
      });
      return;
    }
    else if(salesGroupBy === "product"){
      const prodCounts = {};
      (tx.items||[]).forEach(i => {
        const pk = i.n || i.bc;
        if(!prodCounts[pk]) prodCounts[pk] = 0;
        prodCounts[pk] += i.qty * i.p;
      });
      Object.entries(prodCounts).forEach(([p, amt]) => {
        if(!groups[p]) groups[p] = {txs:[], total:0, count:0, itemsCount:0, refund:0};
        if(!groups[p].txs.includes(tx)) groups[p].txs.push(tx);
        groups[p].total += amt;
        groups[p].count++;
      });
      return;
    }
    if(!groups[key]) groups[key] = {txs:[], total:0, count:0, itemsCount:0, refund:0};
    groups[key].txs.push(tx);
    groups[key].total += tx.tot;
    groups[key].count++;
    groups[key].itemsCount += (tx.items||[]).reduce((s,i)=>s+i.qty,0);
    groups[key].refund += getTxnReturnStatus(tx).refundAmount;
  });
  // Sort groups by total desc
  return Object.entries(groups).sort((a,b) => b[1].total - a[1].total);
})();

// ── Clear all filters
const clearAllFilters = () => {
  setSalesSearch(""); setSalesMethod("all"); setSalesSort("newest");
  setSalesDateFrom(""); setSalesDateTo(""); setSalesTimeFrom(""); setSalesTimeTo("");
  setSalesProductFilter(""); setSalesCategoryFilter(""); setSalesReceiptFilter("");
  setSalesCashierFilter(""); setSalesCustomerFilter("");
  setSalesAmountMin(""); setSalesAmountMax(""); setSalesStatusFilter("all");
  setSalesGroupBy("none");
};

const hasActiveFilters = salesSearch||salesMethod!=="all"||salesDateFrom||salesDateTo||salesTimeFrom||salesTimeTo||salesProductFilter||salesCategoryFilter||salesReceiptFilter||salesCashierFilter||salesCustomerFilter||salesAmountMin||salesAmountMax||salesStatusFilter!=="all"||salesGroupBy!=="none";

// ── Export to CSV (Excel-compatible)
const exportToCSV = () => {
  const headers = [rtl?"رقم الفاتورة":"Receipt", rtl?"التاريخ":"Date", rtl?"الوقت":"Time", rtl?"الكاشير":"Cashier", rtl?"العميل":"Customer", rtl?"الهاتف":"Phone", rtl?"العناصر":"Items", rtl?"الكمية":"Qty", rtl?"طريقة الدفع":"Method", rtl?"الخصم":"Discount", rtl?"الضريبة":"Tax", rtl?"الإجمالي":"Total", rtl?"المسترد":"Refunded", rtl?"الصافي":"Net", rtl?"الحالة":"Status"];
  let csv = "\uFEFF" + headers.join(",") + "\n"; // BOM for Arabic support
  sorted.forEach(tx => {
    const ret = getTxnReturnStatus(tx);
    const status = tx.voidStatus==="voided" ? (rtl?"ملغاة":"Voided") : ret.status==="full" ? (rtl?"مُرجع كلي":"Full Return") : ret.status==="partial" ? (rtl?"مُرجع جزئي":"Partial Return") : (rtl?"عادية":"Normal");
    const itemsStr = (tx.items||[]).map(i => i.n).join(" | ");
    const row = [
      tx.rn, tx.date, tx.time, tx.cashierName||"", tx.custName||"", tx.custPhone||"",
      '"'+itemsStr.replace(/"/g,'""')+'"', (tx.items||[]).reduce((s,i)=>s+i.qty,0),
      tx.method, tx.dp+"%", tx.tax.toFixed(3), tx.tot.toFixed(3), ret.refundAmount.toFixed(3),
      (tx.tot-ret.refundAmount).toFixed(3), status
    ];
    csv += row.join(",") + "\n";
  });
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales_export_"+new Date().toISOString().slice(0,10)+".csv";
  a.click();
  URL.revokeObjectURL(url);
  sT("✓ "+(rtl?"تم تصدير CSV":"CSV exported"),"ok");
};

// ── Export to PDF (via printable window)
const exportToPDF = () => {
  const w = window.open("", "_blank", "width=900,height=700");
  if(!w) return;
  const today = new Date().toLocaleDateString();
  let rows = "";
  sorted.forEach(tx => {
    const ret = getTxnReturnStatus(tx);
    const netAmount = tx.tot - ret.refundAmount;
    const status = tx.voidStatus==="voided" ? '<span style="background:#7c2d12;color:#fff;padding:2px 6px;border-radius:4px;font-size:9px">VOIDED</span>' : ret.status==="full" ? '<span style="background:#dc2626;color:#fff;padding:2px 6px;border-radius:4px;font-size:9px">FULL RET</span>' : ret.status==="partial" ? '<span style="background:#d97706;color:#fff;padding:2px 6px;border-radius:4px;font-size:9px">PARTIAL</span>' : '<span style="color:#059669">✓</span>';
    rows += `<tr>
      <td style="font-family:monospace;font-size:10px">${tx.rn}</td>
      <td>${tx.date}<br/><small>${tx.time}</small></td>
      <td>${tx.cashierName||"—"}</td>
      <td>${tx.custName||"—"}</td>
      <td style="text-align:center">${(tx.items||[]).reduce((s,i)=>s+i.qty,0)}</td>
      <td>${tx.method}</td>
      <td style="text-align:right;font-family:monospace">${tx.tot.toFixed(3)}</td>
      <td style="text-align:right;font-family:monospace;color:#dc2626">${ret.refundAmount>0?"-"+ret.refundAmount.toFixed(3):"—"}</td>
      <td style="text-align:right;font-family:monospace;font-weight:700;color:#059669">${netAmount.toFixed(3)}</td>
      <td style="text-align:center">${status}</td>
    </tr>`;
  });
  
  let groupSection = "";
  if(groupedData && groupedData.length > 0){
    groupSection = `<h3 style="margin-top:20px">📊 ${rtl?"المجموعات":"Groups"}: ${salesGroupBy}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:15px"><thead><tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Group</th><th style="padding:8px;text-align:center">Count</th><th style="padding:8px;text-align:right">Total</th><th style="padding:8px;text-align:right">Refunded</th><th style="padding:8px;text-align:right">Net</th></tr></thead><tbody>` +
    groupedData.map(([k,v]) => `<tr><td style="padding:6px;font-weight:700">${k}</td><td style="text-align:center">${v.count}</td><td style="text-align:right;font-family:monospace">${v.total.toFixed(3)}</td><td style="text-align:right;font-family:monospace;color:#dc2626">${v.refund.toFixed(3)}</td><td style="text-align:right;font-family:monospace;color:#059669;font-weight:700">${(v.total-v.refund).toFixed(3)}</td></tr>`).join("") +
    `</tbody></table>`;
  }
  
  const filterSummary = [];
  if(salesSearch) filterSummary.push("Search: "+salesSearch);
  if(salesMethod!=="all") filterSummary.push("Method: "+salesMethod);
  if(salesDateFrom) filterSummary.push("From: "+salesDateFrom);
  if(salesDateTo) filterSummary.push("To: "+salesDateTo);
  if(salesTimeFrom) filterSummary.push("Time from: "+salesTimeFrom);
  if(salesTimeTo) filterSummary.push("Time to: "+salesTimeTo);
  if(salesProductFilter) filterSummary.push("Product: "+salesProductFilter);
  if(salesCategoryFilter) filterSummary.push("Category: "+salesCategoryFilter);
  if(salesCashierFilter) filterSummary.push("Cashier: "+salesCashierFilter);
  if(salesCustomerFilter) filterSummary.push("Customer: "+salesCustomerFilter);
  if(salesAmountMin) filterSummary.push("Min: "+salesAmountMin);
  if(salesAmountMax) filterSummary.push("Max: "+salesAmountMax);
  if(salesStatusFilter!=="all") filterSummary.push("Status: "+salesStatusFilter);
  if(salesGroupBy!=="none") filterSummary.push("Group: "+salesGroupBy);
  
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sales Report</title>
  <style>
    body{font-family:Arial,sans-serif;padding:20px;color:#111827}
    h1{color:#1e40af;border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:4px}
    .meta{color:#6b7280;font-size:11px;margin-bottom:16px}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0;padding:12px;background:#f9fafb;border-radius:8px}
    .summary>div{text-align:center}
    .summary strong{display:block;font-size:18px;color:#1e40af}
    .summary small{font-size:10px;color:#6b7280}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#1e40af;color:#fff;padding:8px;text-align:left;font-size:10px}
    td{padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px}
    tr:nth-child(even){background:#f9fafb}
    .filters{background:#fffbeb;border:1px solid #fcd34d;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:11px;color:#92400e}
    @media print{body{padding:10px}.no-print{display:none}}
  </style></head><body>
  <h1>📊 ${rtl?"تقرير المبيعات":"Sales Report"}</h1>
  <div class="meta">3045 Super Grocery · ${rtl?"تم الإنشاء":"Generated"}: ${new Date().toLocaleString()} · ${cu?.fn||""}</div>
  ${filterSummary.length ? '<div class="filters"><strong>🔍 '+(rtl?"الفلاتر":"Filters")+':</strong> '+filterSummary.join(" | ")+'</div>' : ''}
  <div class="summary">
    <div><strong>${sorted.length}</strong><small>${rtl?"فاتورة":"Transactions"}</small></div>
    <div><strong style="color:#059669">${filteredTotal.toFixed(3)}</strong><small>${rtl?"إجمالي":"Total"} JD</small></div>
    <div><strong style="color:#dc2626">${filteredRefund.toFixed(3)}</strong><small>${rtl?"مسترد":"Refunded"} JD</small></div>
    <div><strong style="color:#1e40af">${filteredNet.toFixed(3)}</strong><small>${rtl?"صافي":"Net"} JD</small></div>
  </div>
  ${groupSection}
  <h3>${rtl?"تفاصيل الفواتير":"Transaction Details"}</h3>
  <table>
    <thead><tr><th>${rtl?"الإيصال":"Receipt"}</th><th>${rtl?"التاريخ":"Date"}</th><th>${rtl?"الكاشير":"Cashier"}</th><th>${rtl?"العميل":"Customer"}</th><th>${rtl?"القطع":"Qty"}</th><th>${rtl?"الدفع":"Method"}</th><th>${rtl?"الإجمالي":"Total"}</th><th>${rtl?"مسترد":"Refund"}</th><th>${rtl?"صافي":"Net"}</th><th>${rtl?"الحالة":"Status"}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:30px;font-size:10px;color:#9ca3af;text-align:center">© 3045 Super Grocery — ${new Date().getFullYear()}</div>
  <script>setTimeout(()=>window.print(),600)</script>
  </body></html>`);
  w.document.close();
};

// ── Quick date presets
const setDatePreset = (preset) => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const dd = String(today.getDate()).padStart(2,"0");
  const todayStr = yyyy+"-"+mm+"-"+dd;
  if(preset==="today"){setSalesDateFrom(todayStr);setSalesDateTo(todayStr)}
  else if(preset==="yesterday"){
    const y = new Date(today);y.setDate(y.getDate()-1);
    const ys = y.toISOString().slice(0,10);
    setSalesDateFrom(ys);setSalesDateTo(ys);
  }
  else if(preset==="week"){
    const s = new Date(today);s.setDate(s.getDate()-7);
    setSalesDateFrom(s.toISOString().slice(0,10));setSalesDateTo(todayStr);
  }
  else if(preset==="month"){
    const s = new Date(yyyy,today.getMonth(),1);
    setSalesDateFrom(s.toISOString().slice(0,10));setSalesDateTo(todayStr);
  }
  else if(preset==="last_month"){
    const s = new Date(yyyy,today.getMonth()-1,1);
    const e = new Date(yyyy,today.getMonth(),0);
    setSalesDateFrom(s.toISOString().slice(0,10));setSalesDateTo(e.toISOString().slice(0,10));
  }
  else if(preset==="year"){
    setSalesDateFrom(yyyy+"-01-01");setSalesDateTo(todayStr);
  }
};

return <div className="dsh">
{/* ── HEADER ── */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>📋 {t.salesView}</h2>
    <p style={{color:"#6b7280",fontSize:11,margin:"4px 0 0"}}>{rtl?"بحث متقدم · تجميع · تصدير":"Advanced search · Group by · Export"}</p>
  </div>
  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
    <button onClick={()=>setSalesShowAdvanced(!salesShowAdvanced)}
      style={{padding:"8px 14px",background:salesShowAdvanced?"#7c3aed":"#f3f4f6",color:salesShowAdvanced?"#fff":"#374151",border:"none",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer"}}>
      ⚙️ {rtl?"فلاتر متقدمة":"Advanced Filters"} {salesShowAdvanced?"▲":"▼"}
    </button>
    <ExportButtons title={rtl?"سجل المبيعات":"Sales History Report"} getExportData={()=>{
      // Build filters list for report
      const filterList = [];
      if(salesSearch) filterList.push((rtl?"بحث":"Search")+": "+salesSearch);
      if(salesMethod!=="all") filterList.push((rtl?"الدفع":"Method")+": "+salesMethod);
      if(salesDateFrom) filterList.push((rtl?"من":"From")+": "+salesDateFrom);
      if(salesDateTo) filterList.push((rtl?"إلى":"To")+": "+salesDateTo);
      if(salesTimeFrom) filterList.push((rtl?"من ساعة":"From time")+": "+salesTimeFrom);
      if(salesTimeTo) filterList.push((rtl?"إلى ساعة":"To time")+": "+salesTimeTo);
      if(salesReceiptFilter) filterList.push((rtl?"رقم":"#")+": "+salesReceiptFilter);
      if(salesProductFilter) filterList.push((rtl?"منتج":"Product")+": "+salesProductFilter);
      if(salesCategoryFilter) filterList.push((rtl?"فئة":"Category")+": "+salesCategoryFilter);
      if(salesCashierFilter) filterList.push((rtl?"كاشير":"Cashier")+": "+salesCashierFilter);
      if(salesCustomerFilter) filterList.push((rtl?"عميل":"Customer")+": "+salesCustomerFilter);
      if(salesAmountMin) filterList.push((rtl?"المبلغ من":"Amt min")+": "+salesAmountMin);
      if(salesAmountMax) filterList.push((rtl?"المبلغ إلى":"Amt max")+": "+salesAmountMax);
      if(salesStatusFilter!=="all") filterList.push((rtl?"الحالة":"Status")+": "+salesStatusFilter);
      if(salesGroupBy!=="none") filterList.push((rtl?"تجميع":"Group")+": "+salesGroupBy);
      
      // Headers
      const headers = [rtl?"رقم الفاتورة":"Receipt#",rtl?"التاريخ":"Date",rtl?"الوقت":"Time",rtl?"الكاشير":"Cashier",rtl?"العميل":"Customer",rtl?"هاتف":"Phone",rtl?"القطع":"Items",rtl?"الدفع":"Method",rtl?"خصم":"Disc%",rtl?"الضريبة":"Tax",rtl?"الإجمالي":"Total",rtl?"المسترد":"Refund",rtl?"الصافي":"Net",rtl?"الحالة":"Status"];
      
      // Rows
      const rows = sorted.map(tx=>{
        const ret=getTxnReturnStatus(tx);
        const status=tx.voidStatus==="voided"?(rtl?"ملغاة":"Voided"):ret.status==="full"?(rtl?"مُرجع كلي":"Full Return"):ret.status==="partial"?(rtl?"مُرجع جزئي":"Partial"):(rtl?"عادية":"Normal");
        return [tx.rn,tx.date,tx.time,tx.cashierName||"—",tx.custName||"—",tx.custPhone||"—",(tx.items||[]).reduce((s,i)=>s+i.qty,0),tx.method,tx.dp+"%",tx.tax.toFixed(3),tx.tot.toFixed(3),ret.refundAmount.toFixed(3),(tx.tot-ret.refundAmount).toFixed(3),status];
      });
      
      // Summary
      const summary = [
        {label:rtl?"عدد الفواتير":"Transactions",value:sorted.length,color:"#1e40af"},
        {label:rtl?"إجمالي":"Total Sales",value:fm(filteredTotal),color:"#059669"},
        {label:rtl?"مسترد":"Refunded",value:fm(filteredRefund),color:"#dc2626"},
        {label:rtl?"صافي":"Net",value:fm(filteredNet),color:"#1e40af"}
      ];
      
      return {headers, rows, summary, filters:filterList, showSignatures:true};
    }}/>
    <button onClick={async()=>{try{const tx=await DB.getTransactions();setTxns(tx);sT("✓ Refreshed","ok")}catch{}}} style={{padding:"8px 14px",background:"#2563eb",color:"#fff",border:"none",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer"}}>🔄</button>
  </div>
</div>

{/* ── KPI ROW ── */}
<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:12}}>
  <div className="dc" style={{borderLeft:"4px solid #059669"}}><div className="dcl">{rtl?"المبيعات":"Sales"}</div><div className="dcv g">{fm(filteredTotal)}</div><div className="dcc">{sorted.length} {rtl?"فاتورة":"txns"}</div></div>
  <div className="dc" style={{borderLeft:"4px solid #dc2626"}}><div className="dcl">{rtl?"المسترد":"Refunded"}</div><div className="dcv" style={{color:"#dc2626"}}>{fm(filteredRefund)}</div><div className="dcc">{rtl?"من مرتجعات":"from returns"}</div></div>
  <div className="dc" style={{borderLeft:"4px solid #1e40af"}}><div className="dcl">{rtl?"الصافي":"Net"}</div><div className="dcv b">{fm(filteredNet)}</div><div className="dcc">{rtl?"بعد الاسترداد":"after refunds"}</div></div>
  <div className="dc" style={{borderLeft:"4px solid #2563eb"}}><div className="dcl">{t.filterCash}</div><div className="dcv b">{fm(sorted.filter(x=>x.method==="cash").reduce((s,x)=>s+x.tot,0))}</div></div>
  <div className="dc" style={{borderLeft:"4px solid #7c3aed"}}><div className="dcl">{t.filterCard}+{t.filterMada}</div><div className="dcv p">{fm(sorted.filter(x=>x.method!=="cash").reduce((s,x)=>s+x.tot,0))}</div></div>
</div>

{/* ── PRIMARY FILTERS (always visible) ── */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,padding:12,marginBottom:10}}>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
    <div style={{flex:"2 1 240px",position:"relative"}}>
      <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13}}>🔍</span>
      <input value={salesSearch} onChange={e=>setSalesSearch(e.target.value)} placeholder={rtl?"بحث سريع (إيصال/عميل/هاتف)":"Quick search (receipt/customer/phone)"}
        style={{width:"100%",padding:"10px 10px 10px 36px",background:"#f9fafb",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:12,outline:"none"}}/>
    </div>
    <select value={salesMethod} onChange={e=>setSalesMethod(e.target.value)} style={{padding:"10px 14px",background:salesMethod!=="all"?"#eff6ff":"#f9fafb",border:"1.5px solid "+(salesMethod!=="all"?"#2563eb":"#e5e7eb"),borderRadius:10,fontSize:11,outline:"none",minWidth:100}}>
      <option value="all">💳 {t.filterAll}</option><option value="cash">💵 {t.filterCash}</option><option value="card">💳 {t.filterCard}</option><option value="mobile">📱 {t.filterMada}</option>
    </select>
    <select value={salesSort} onChange={e=>setSalesSort(e.target.value)} style={{padding:"10px 14px",background:"#f9fafb",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:11,outline:"none",minWidth:100}}>
      <option value="newest">⬇ {t.sortNewest}</option><option value="oldest">⬆ {t.sortOldest}</option><option value="highest">💰 {t.sortHighest}</option><option value="lowest">🪙 {t.sortLowest}</option>
    </select>
    <select value={salesStatusFilter} onChange={e=>setSalesStatusFilter(e.target.value)} style={{padding:"10px 14px",background:salesStatusFilter!=="all"?"#fef2f2":"#f9fafb",border:"1.5px solid "+(salesStatusFilter!=="all"?"#dc2626":"#e5e7eb"),borderRadius:10,fontSize:11,outline:"none",minWidth:120}}>
      <option value="all">📋 {rtl?"كل الحالات":"All Status"}</option>
      <option value="normal">✓ {rtl?"عادية":"Normal"}</option>
      <option value="full_return">↩️ {rtl?"مُرجعة كلي":"Full Return"}</option>
      <option value="partial_return">↩️ {rtl?"مُرجعة جزئي":"Partial Return"}</option>
      <option value="voided">🚫 {rtl?"ملغاة":"Voided"}</option>
    </select>
  </div>
  
  {/* GroupBy Selector — Visible Chip Buttons */}
  <div style={{marginTop:10,padding:"10px 12px",background:"linear-gradient(135deg,#faf5ff,#fff)",border:"1.5px solid "+(salesGroupBy!=="none"?"#7c3aed":"#e9d5ff"),borderRadius:10}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
      <span style={{fontSize:12,fontWeight:800,color:"#5b21b6"}}>📊 {rtl?"تجميع حسب:":"Group By:"}</span>
      {salesGroupBy !== "none" && (
        <button onClick={()=>{setSalesGroupBy("none");setExpandedGroups(new Set())}}
          style={{padding:"3px 10px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer"}}>
          ✕ {rtl?"إلغاء التجميع":"Clear"}
        </button>
      )}
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {[
        {k:"none",l:rtl?"بدون":"None",i:"⊘"},
        {k:"cashier",l:rtl?"الكاشير":"Cashier",i:"👤"},
        {k:"category",l:rtl?"الفئة":"Category",i:"🏷️"},
        {k:"method",l:rtl?"طريقة الدفع":"Payment",i:"💳"},
        {k:"date",l:rtl?"التاريخ":"Date",i:"📅"},
        {k:"hour",l:rtl?"الساعة":"Hour",i:"🕐"},
        {k:"customer",l:rtl?"العميل":"Customer",i:"👥"},
        {k:"product",l:rtl?"المنتج":"Product",i:"📦"}
      ].map(opt => {
        const isActive = salesGroupBy === opt.k;
        return (
          <button key={opt.k} onClick={()=>{setSalesGroupBy(opt.k);setExpandedGroups(new Set())}}
            style={{
              padding:"7px 12px",
              background: isActive ? "linear-gradient(135deg,#7c3aed,#9333ea)" : "#fff",
              color: isActive ? "#fff" : "#5b21b6",
              border: "1.5px solid " + (isActive ? "#7c3aed" : "#e9d5ff"),
              borderRadius: 20,
              fontSize: 11,
              fontWeight: isActive ? 800 : 600,
              cursor: "pointer",
              boxShadow: isActive ? "0 2px 6px rgba(124,58,237,.3)" : "none",
              transition: "all .15s"
            }}>
            {opt.i} {opt.l}
          </button>
        );
      })}
    </div>
  </div>
  
  {/* Quick Date Presets */}
  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
    <span style={{fontSize:11,color:"#6b7280",fontWeight:600}}>⚡ {rtl?"اختصار":"Quick"}:</span>
    {[{k:"today",l:rtl?"اليوم":"Today"},{k:"yesterday",l:rtl?"أمس":"Yesterday"},{k:"week",l:rtl?"7 أيام":"7 Days"},{k:"month",l:rtl?"هذا الشهر":"This Month"},{k:"last_month",l:rtl?"الشهر السابق":"Last Month"},{k:"year",l:rtl?"هذه السنة":"This Year"}].map(p=>(
      <button key={p.k} onClick={()=>setDatePreset(p.k)} style={{padding:"5px 10px",background:"#eff6ff",color:"#1e40af",border:"1px solid #bfdbfe",borderRadius:6,fontSize:10,cursor:"pointer",fontWeight:600}}>{p.l}</button>
    ))}
    {hasActiveFilters && <button onClick={clearAllFilters} style={{padding:"5px 12px",background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:6,fontSize:10,cursor:"pointer",fontWeight:700,marginLeft:"auto"}}>✕ {rtl?"مسح كل الفلاتر":"Clear all filters"}</button>}
  </div>
</div>

{/* ── ADVANCED FILTERS (collapsible) ── */}
{salesShowAdvanced && (
  <div style={{background:"linear-gradient(135deg,#f5f3ff,#fff)",border:"1.5px solid #c4b5fd",borderRadius:12,padding:14,marginBottom:10}}>
    <div style={{fontSize:12,fontWeight:800,color:"#5b21b6",marginBottom:10}}>⚙️ {rtl?"فلاتر متقدمة":"Advanced Filters"}</div>
    
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
      {/* Date range */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>📅 {rtl?"من تاريخ":"From Date"}</label>
        <input type="date" value={salesDateFrom} onChange={e=>setSalesDateFrom(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesDateFrom?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesDateFrom?"#f5f3ff":"#fff"}}/>
      </div>
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>📅 {rtl?"إلى تاريخ":"To Date"}</label>
        <input type="date" value={salesDateTo} onChange={e=>setSalesDateTo(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesDateTo?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesDateTo?"#f5f3ff":"#fff"}}/>
      </div>
      
      {/* Time range */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>🕐 {rtl?"من ساعة":"From Time"}</label>
        <input type="time" value={salesTimeFrom} onChange={e=>setSalesTimeFrom(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesTimeFrom?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesTimeFrom?"#f5f3ff":"#fff"}}/>
      </div>
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>🕐 {rtl?"إلى ساعة":"To Time"}</label>
        <input type="time" value={salesTimeTo} onChange={e=>setSalesTimeTo(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesTimeTo?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesTimeTo?"#f5f3ff":"#fff"}}/>
      </div>
      
      {/* Receipt # */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>🧾 {rtl?"رقم الفاتورة":"Receipt #"}</label>
        <input value={salesReceiptFilter} onChange={e=>setSalesReceiptFilter(e.target.value)} placeholder="KH-130426-001" style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesReceiptFilter?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,fontFamily:"monospace",background:salesReceiptFilter?"#f5f3ff":"#fff"}}/>
      </div>
      
      {/* Product/Barcode */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>📦 {rtl?"منتج/باركود":"Product/Barcode"}</label>
        <input value={salesProductFilter} onChange={e=>setSalesProductFilter(e.target.value)} placeholder={rtl?"اسم أو باركود":"Name or barcode"} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesProductFilter?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesProductFilter?"#f5f3ff":"#fff"}}/>
      </div>
      
      {/* Category */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>🏷️ {rtl?"الصنف":"Category"}</label>
        <select value={salesCategoryFilter} onChange={e=>setSalesCategoryFilter(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesCategoryFilter?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesCategoryFilter?"#f5f3ff":"#fff"}}>
          <option value="">— {rtl?"كل الفئات":"All Categories"} —</option>
          {uniqueCategories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      
      {/* Cashier */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>👤 {rtl?"الكاشير":"Cashier"}</label>
        <select value={salesCashierFilter} onChange={e=>setSalesCashierFilter(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesCashierFilter?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesCashierFilter?"#f5f3ff":"#fff"}}>
          <option value="">— {rtl?"كل الكاشيرين":"All Cashiers"} —</option>
          {uniqueCashiers.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      
      {/* Customer */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>👥 {rtl?"العميل":"Customer"}</label>
        <input value={salesCustomerFilter} onChange={e=>setSalesCustomerFilter(e.target.value)} placeholder={rtl?"اسم أو هاتف":"Name or phone"} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesCustomerFilter?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,background:salesCustomerFilter?"#f5f3ff":"#fff"}}/>
      </div>
      
      {/* Amount range */}
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>💰 {rtl?"المبلغ من":"Amount Min"}</label>
        <input type="number" step="0.001" value={salesAmountMin} onChange={e=>setSalesAmountMin(e.target.value)} placeholder="0.000" style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesAmountMin?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,fontFamily:"monospace",background:salesAmountMin?"#f5f3ff":"#fff"}}/>
      </div>
      <div>
        <label style={{fontSize:10,fontWeight:700,color:"#374151"}}>💰 {rtl?"المبلغ إلى":"Amount Max"}</label>
        <input type="number" step="0.001" value={salesAmountMax} onChange={e=>setSalesAmountMax(e.target.value)} placeholder="999.999" style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+(salesAmountMax?"#7c3aed":"#e5e7eb"),borderRadius:8,fontSize:11,marginTop:3,fontFamily:"monospace",background:salesAmountMax?"#f5f3ff":"#fff"}}/>
      </div>
    </div>
  </div>
)}

{/* ── GROUPED VIEW (Card-based, collapsible) ── */}
{groupedData && (
  <>
    {/* Header summary */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,padding:"12px 16px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",color:"#fff",borderRadius:12,boxShadow:"0 4px 12px rgba(124,58,237,.2)"}}>
      <div>
        <div style={{fontSize:11,opacity:0.9,fontWeight:600}}>📊 {rtl?"عرض مجموعات":"Grouped View"}</div>
        <div style={{fontSize:18,fontWeight:800,marginTop:2}}>
          {(()=>{const labels={cashier:rtl?"الكاشير":"Cashier",category:rtl?"الفئة":"Category",method:rtl?"طريقة الدفع":"Payment Method",date:rtl?"التاريخ":"Date",hour:rtl?"الساعة":"Hour",customer:rtl?"العميل":"Customer",product:rtl?"المنتج":"Product"};return labels[salesGroupBy]||salesGroupBy})()}
        </div>
      </div>
      <div style={{display:"flex",gap:18,alignItems:"center"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,opacity:0.85}}>{rtl?"المجموعات":"Groups"}</div>
          <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace"}}>{groupedData.length}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,opacity:0.85}}>{rtl?"الفواتير":"Receipts"}</div>
          <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace"}}>{sorted.length}</div>
        </div>
        <div style={{textAlign:"center",borderLeft:"1px solid rgba(255,255,255,.3)",paddingLeft:18}}>
          <div style={{fontSize:10,opacity:0.85}}>{rtl?"الصافي":"Net Sales"}</div>
          <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace"}}>{fm(filteredNet)}</div>
        </div>
        <button onClick={()=>{
          if(expandedGroups.size === groupedData.length) setExpandedGroups(new Set());
          else setExpandedGroups(new Set(groupedData.map(([k])=>k)));
        }} style={{padding:"8px 14px",background:"rgba(255,255,255,.2)",border:"1.5px solid rgba(255,255,255,.4)",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
          {expandedGroups.size === groupedData.length ? "⊟ "+(rtl?"طي الكل":"Collapse All") : "⊞ "+(rtl?"فتح الكل":"Expand All")}
        </button>
      </div>
    </div>
    
    {/* Toggle: show/hide main txns table when grouped */}
    <div style={{marginBottom:10,padding:"8px 12px",background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,display:"flex",alignItems:"center",gap:10,fontSize:11}}>
      <span style={{color:"#92400e"}}>💡 {rtl?"عند التجميع، الجدول التفصيلي مخفي افتراضياً.":"When grouping, the detail table is hidden by default."}</span>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontWeight:700,color:"#78350f"}}>
        <input type="checkbox" checked={!hideUnGroupedTable} onChange={e=>setHideUnGroupedTable(!e.target.checked)} style={{cursor:"pointer"}}/>
        {rtl?"إظهار الجدول التفصيلي":"Show detail table"}
      </label>
    </div>
    
    {/* Group cards */}
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
      {groupedData.map(([key,data],idx) => {
        const pct = filteredTotal > 0 ? (data.total / filteredTotal * 100) : 0;
        const netAmt = data.total - data.refund;
        const isExpanded = expandedGroups.has(key);
        const rank = idx + 1;
        // Color rank: top 3 highlighted
        const rankBg = rank === 1 ? "#fef3c7" : rank === 2 ? "#f3f4f6" : rank === 3 ? "#fed7aa" : "#fff";
        const rankColor = rank === 1 ? "#b45309" : rank === 2 ? "#6b7280" : rank === 3 ? "#9a3412" : "#9ca3af";
        const rankIcon = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "#"+rank;
        
        return (
          <div key={key} style={{background:"#fff",border:"2px solid "+(isExpanded?"#7c3aed":"#e9d5ff"),borderRadius:12,overflow:"hidden",transition:"all .15s",boxShadow:isExpanded?"0 4px 12px rgba(124,58,237,.15)":"0 1px 3px rgba(0,0,0,.05)"}}>
            
            {/* Card Header (clickable to toggle) */}
            <div onClick={()=>{
              const ns = new Set(expandedGroups);
              if(isExpanded) ns.delete(key); else ns.add(key);
              setExpandedGroups(ns);
            }} style={{padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:14,background:isExpanded?"linear-gradient(90deg,#faf5ff,#fff)":"#fff"}}>
              
              {/* Rank badge */}
              <div style={{minWidth:38,height:38,background:rankBg,color:rankColor,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:rank<=3?16:13,fontFamily:"monospace",flexShrink:0}}>
                {rankIcon}
              </div>
              
              {/* Group name + receipts count */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:800,color:"#111827",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{key}</div>
                <div style={{fontSize:11,color:"#6b7280",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                  <span>🧾 <strong style={{color:"#374151"}}>{data.count}</strong> {rtl?"فاتورة":"receipts"}</span>
                  {data.itemsCount > 0 && <span>📦 <strong style={{color:"#374151"}}>{data.itemsCount}</strong> {rtl?"وحدة":"items"}</span>}
                  {data.count > 0 && <span>💰 {rtl?"متوسط":"avg"}: <strong style={{color:"#374151",fontFamily:"monospace"}}>{fm(data.total/data.count)}</strong></span>}
                </div>
              </div>
              
              {/* Numbers stack */}
              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9,color:"#6b7280",fontWeight:600,textTransform:"uppercase"}}>{rtl?"إجمالي":"Total"}</div>
                  <div style={{fontSize:15,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{fm(data.total)}</div>
                </div>
                {data.refund > 0 && (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:9,color:"#6b7280",fontWeight:600,textTransform:"uppercase"}}>{rtl?"مسترد":"Refund"}</div>
                    <div style={{fontSize:13,fontWeight:700,color:"#dc2626",fontFamily:"monospace"}}>−{fm(data.refund)}</div>
                  </div>
                )}
                <div style={{textAlign:"right",borderLeft:"1.5px solid #f3f4f6",paddingLeft:14}}>
                  <div style={{fontSize:9,color:"#1e40af",fontWeight:700,textTransform:"uppercase"}}>{rtl?"الصافي":"Net"}</div>
                  <div style={{fontSize:18,fontWeight:800,color:"#1e40af",fontFamily:"monospace"}}>{fm(netAmt)}</div>
                </div>
              </div>
              
              {/* Percentage with bar */}
              <div style={{minWidth:140,textAlign:"right"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
                  <span style={{fontSize:14,fontWeight:800,color:"#7c3aed",fontFamily:"monospace"}}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{width:"100%",height:8,background:"#f3f4f6",borderRadius:4,overflow:"hidden",marginTop:4}}>
                  <div style={{width:Math.min(pct,100)+"%",height:"100%",background:"linear-gradient(90deg,#7c3aed,#a78bfa)",borderRadius:4,transition:"width .3s"}}></div>
                </div>
              </div>
              
              {/* Expand chevron */}
              <div style={{fontSize:18,color:"#7c3aed",fontWeight:800,transition:"transform .2s",transform:isExpanded?"rotate(90deg)":"rotate(0)",width:20,textAlign:"center"}}>
                ▶
              </div>
            </div>
            
            {/* Expanded transactions */}
            {isExpanded && (
              <div style={{borderTop:"2px solid #e9d5ff",background:"#faf5ff",padding:"10px 14px"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#5b21b6",marginBottom:8}}>
                  📋 {rtl?`الفواتير في هذه المجموعة (${data.txs.length})`:`Receipts in this group (${data.txs.length})`}
                </div>
                <div style={{maxHeight:300,overflow:"auto",background:"#fff",borderRadius:8,border:"1px solid #e9d5ff"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead style={{background:"#f9fafb",position:"sticky",top:0,zIndex:1}}>
                      <tr>
                        <th style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700}}>{t.receipt}</th>
                        <th style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700}}>{t.time}</th>
                        <th style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700}}>👤 {rtl?"الكاشير":"Cashier"}</th>
                        <th style={{padding:"7px 10px",textAlign:"center",fontSize:10,color:"#6b7280",fontWeight:700}}>{t.method}</th>
                        <th style={{padding:"7px 10px",textAlign:"center",fontSize:10,color:"#6b7280",fontWeight:700}}>{t.items}</th>
                        <th style={{padding:"7px 10px",textAlign:"right",fontSize:10,color:"#059669",fontWeight:700}}>{t.total}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.txs.slice(0,50).map(tx => {
                        const retStatus = getTxnReturnStatus(tx);
                        return (
                          <tr key={tx.id} style={{borderTop:"1px solid #f3f4f6",cursor:"pointer"}} onClick={()=>setReceiptView(tx)}>
                            <td style={{padding:"6px 10px",fontFamily:"monospace",fontWeight:700,color:"#1e40af"}}>{tx.rn}</td>
                            <td style={{padding:"6px 10px",fontSize:10,color:"#6b7280"}}>{tx.time}<br/><span style={{fontSize:9}}>{tx.date}</span></td>
                            <td style={{padding:"6px 10px",fontWeight:600}}>{tx.cashierName||"—"}</td>
                            <td style={{padding:"6px 10px",textAlign:"center"}}>
                              <span style={{padding:"2px 6px",background:tx.method==="cash"?"#ecfdf5":tx.method==="card"?"#eff6ff":"#fef3c7",color:tx.method==="cash"?"#065f46":tx.method==="card"?"#1e40af":"#92400e",borderRadius:4,fontSize:9,fontWeight:700}}>
                                {tx.method==="cash"?"💵":tx.method==="card"?"💳":"📱"} {tx.method==="cash"?(rtl?"نقد":"Cash"):tx.method==="card"?(rtl?"فيزا":"Card"):(rtl?"كليك":"Mobile")}
                              </span>
                            </td>
                            <td style={{padding:"6px 10px",textAlign:"center",fontFamily:"monospace"}}>{(tx.items||[]).reduce((s,i)=>s+i.qty,0)}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#059669"}}>
                              {fm(tx.tot)}
                              {retStatus.refundAmount > 0 && <div style={{fontSize:9,color:"#dc2626"}}>−{fm(retStatus.refundAmount)}</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {data.txs.length > 50 && (
                      <tfoot>
                        <tr><td colSpan={6} style={{padding:8,textAlign:"center",fontSize:10,color:"#6b7280",fontStyle:"italic",background:"#f9fafb"}}>
                          {rtl?`يعرض أول 50 من ${data.txs.length}`:`Showing first 50 of ${data.txs.length}`}
                        </td></tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  </>
)}

{/* ── TRANSACTIONS TABLE (hidden when grouping unless user wants it) ── */}
{(!groupedData || !hideUnGroupedTable) && (
<div className="tb" style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,overflow:"auto",maxHeight:"60vh"}}>
  <table>
    <thead style={{position:"sticky",top:0,zIndex:1,background:"#f9fafb"}}>
      <tr>
        <th>{t.receipt}</th>
        <th>{t.time}</th>
        <th>👤 {rtl?"الكاشير":"Cashier"}</th>
        <th>👥 {rtl?"العميل":"Customer"}</th>
        <th>{t.items}</th>
        <th>{t.method}</th>
        <th>{t.discount}</th>
        <th>{t.total}</th>
        <th>↩️ {rtl?"مسترد":"Refund"}</th>
        <th>✓ {rtl?"صافي":"Net"}</th>
        <th>{t.points}</th>
        {cu.role==="admin"&&<th>{t.act}</th>}
      </tr>
    </thead>
    <tbody>
      {sorted.length===0?<tr><td colSpan={cu.role==="admin"?12:11} style={{textAlign:"center",padding:40,color:"#9ca3af"}}>{t.noTxns}</td></tr>:sorted.slice(0,500).map(tx=>{
        const retStatus = getTxnReturnStatus(tx);
        const rowBg = retStatus.status==="full"?"#fef2f2":retStatus.status==="partial"?"#fffbeb":(tx.voidStatus==="voided"?"#f3f4f6":"transparent");
        const netAmount = tx.tot - retStatus.refundAmount;
        return <tr key={tx.id} style={{cursor:"pointer",background:rowBg}} onClick={()=>openReceiptWithItems(tx)}>
          <td className="mn" style={{fontSize:11}}>
            <div style={{fontWeight:700,color:"#1e40af"}}>{tx.rn}</div>
            {retStatus.status==="full"&&<div style={{marginTop:3}}><span style={{padding:"2px 7px",background:"#dc2626",color:"#fff",borderRadius:8,fontSize:9,fontWeight:700}}>↩️ {rtl?"مُرجع كلي":"FULL"}</span></div>}
            {retStatus.status==="partial"&&<div style={{marginTop:3}}><span style={{padding:"2px 7px",background:"#d97706",color:"#fff",borderRadius:8,fontSize:9,fontWeight:700}}>↩️ {rtl?"جزئي":"PARTIAL"}</span></div>}
            {tx.voidStatus==="voided"&&<div style={{marginTop:3}}><span style={{padding:"2px 7px",background:"#7c2d12",color:"#fff",borderRadius:8,fontSize:9,fontWeight:700}}>🚫 {rtl?"ملغاة":"VOIDED"}</span></div>}
          </td>
          <td style={{fontSize:11,whiteSpace:"nowrap"}}>{tx.date}<br/><span style={{color:"#9ca3af"}}>{tx.time}</span></td>
          <td style={{fontSize:11,fontWeight:600,color:"#059669"}}>{tx.cashierName||"—"}</td>
          <td>{tx.custName?<div><div style={{fontSize:11,fontWeight:600,color:"#2563eb"}}>{tx.custName}</div><div style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--m)"}}>{tx.custPhone}</div></div>:<span style={{color:"#d1d5db"}}>—</span>}</td>
          <td style={{fontFamily:"var(--m)",textAlign:"center"}}>{(tx.items||[]).reduce((s,i)=>s+i.qty,0)}</td>
          <td><span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:600,background:tx.method==="cash"?"#ecfdf5":tx.method==="card"?"#eff6ff":"#f5f3ff",color:tx.method==="cash"?"#059669":tx.method==="card"?"#2563eb":"#7c3aed"}}>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</span></td>
          <td style={{fontFamily:"var(--m)",fontSize:11,color:tx.dp>0?"#ea580c":"#d1d5db"}}>{tx.dp>0?tx.dp+"%":"—"}</td>
          <td className="mn" style={{color:retStatus.status==="full"?"#dc2626":"#059669",fontSize:13,textDecoration:retStatus.status==="full"?"line-through":"none",fontWeight:700}}>{fm(tx.tot)}</td>
          <td className="mn" style={{color:"#dc2626",fontSize:11,fontWeight:700}}>{retStatus.refundAmount>0?"−"+fm(retStatus.refundAmount):"—"}</td>
          <td className="mn" style={{color:"#1e40af",fontSize:13,fontWeight:800}}>{fm(netAmount)}</td>
          <td style={{fontSize:10}}>{tx.ptsEarned>0&&<span style={{color:"#059669"}}>+{tx.ptsEarned}</span>}{tx.ptsRedeemed>0&&<span style={{color:"#7c3aed",marginLeft:4}}>-{tx.ptsRedeemed}</span>}{!tx.ptsEarned&&!tx.ptsRedeemed&&<span style={{color:"#d1d5db"}}>—</span>}</td>
          {cu.role==="admin"&&<td><button className="ab ab-d" onClick={async(e)=>{e.stopPropagation();if(!confirm(rtl?"حذف هذه المعاملة؟ سيتم إرجاع الكمية للمخزون":"Delete this transaction? Stock will be restored"))return;
            setProds(prev=>prev.map(p=>{const item=tx.items.find(i=>i.id===p.id);return item?{...p,s:p.s+item.qty}:p}));
            setTxns(p=>p.filter(x=>x.id!==tx.id));
            try{await DB.deleteTransaction(tx.id);const np=await DB.getProducts();setProds(np);
            sT("✓ "+(rtl?"تم الحذف وإرجاع المخزون":"Deleted & stock restored"),"ok")}catch{sT("✗ Error","err")}}}>✕</button></td>}
        </tr>;
      })}
    </tbody>
  </table>
  {sorted.length>500&&<div style={{padding:12,textAlign:"center",background:"#fffbeb",borderTop:"1px solid #fcd34d",fontSize:11,color:"#92400e",fontWeight:600}}>
    ⚠ {rtl?`عرض أول 500 فاتورة من ${sorted.length}. استخدم الفلاتر لتضييق النتائج.`:`Showing first 500 of ${sorted.length}. Use filters to narrow results.`}
  </div>}
</div>
)}

<div style={{fontSize:11,color:"#6b7280",marginTop:10,textAlign:"center"}}>
  {rtl?"عرض":"Showing"} <strong>{Math.min(sorted.length,500)}</strong> / <strong>{sorted.length}</strong> {rtl?"من":"of"} <strong>{txns.length}</strong> {rtl?"فاتورة":"transactions"}
</div>
</div>;
})()}
{tab==="dashboard"&&<div className="dsh">
{/* Header with live indicator */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<h2 style={{fontSize:18,fontWeight:800,margin:0}}>📊 {t.dashboard}</h2>
<div style={{display:"flex",alignItems:"center",gap:10}}>
<div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#059669",background:"#ecfdf5",padding:"4px 12px",borderRadius:20,fontWeight:600,border:"1px solid #d1fae5"}}><span style={{width:7,height:7,borderRadius:"50%",background:"#059669",animation:"pu 2s ease infinite",display:"inline-block"}}/> LIVE</div>
{lastRefresh&&<span style={{fontSize:10,color:"#9ca3af"}}>{lastRefresh.toLocaleTimeString()}</span>}
<ExportButtons title={rtl?"تقرير لوحة التحكم":"Dashboard Report"} getExportData={()=>{
  const todayT=txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}});
  const weekT=txns.filter(tx=>{try{const d=new Date(tx.ts);const w=new Date();w.setDate(w.getDate()-7);return d>=w}catch{return false}});
  const monthT=txns.filter(tx=>{try{const d=new Date(tx.ts);return d.getMonth()===new Date().getMonth()&&d.getFullYear()===new Date().getFullYear()}catch{return false}});
  const headers=[rtl?"الفترة":"Period",rtl?"الفواتير":"Transactions",rtl?"القطع":"Items Sold",rtl?"الإجمالي":"Total",rtl?"المتوسط":"Average"];
  const rows=[
    [rtl?"اليوم":"Today",todayT.length,todayT.reduce((s,x)=>s+x.items.reduce((a,b)=>a+b.qty,0),0),fm(todayT.reduce((s,x)=>s+x.tot,0)),fm(todayT.length>0?todayT.reduce((s,x)=>s+x.tot,0)/todayT.length:0)],
    [rtl?"الأسبوع":"Week",weekT.length,weekT.reduce((s,x)=>s+x.items.reduce((a,b)=>a+b.qty,0),0),fm(weekT.reduce((s,x)=>s+x.tot,0)),fm(weekT.length>0?weekT.reduce((s,x)=>s+x.tot,0)/weekT.length:0)],
    [rtl?"الشهر":"Month",monthT.length,monthT.reduce((s,x)=>s+x.items.reduce((a,b)=>a+b.qty,0),0),fm(monthT.reduce((s,x)=>s+x.tot,0)),fm(monthT.length>0?monthT.reduce((s,x)=>s+x.tot,0)/monthT.length:0)],
    [rtl?"الإجمالي":"All Time",txns.length,txns.reduce((s,x)=>s+x.items.reduce((a,b)=>a+b.qty,0),0),fm(txns.reduce((s,x)=>s+x.tot,0)),fm(txns.length>0?txns.reduce((s,x)=>s+x.tot,0)/txns.length:0)]
  ];
  const summary=[
    {label:rtl?"إجمالي الفواتير":"Total Txns",value:txns.length,color:"#1e40af"},
    {label:rtl?"إجمالي المبيعات":"Total Sales",value:fm(txns.reduce((s,x)=>s+x.tot,0)),color:"#059669"},
    {label:rtl?"المنتجات":"Products",value:prods.length,color:"#7c3aed"},
    {label:rtl?"العملاء":"Customers",value:customers.length,color:"#d97706"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:false};
}}/>
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

{/* Inventory Value Row */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
<div className="dc" style={{borderLeft:"4px solid #6b7280"}}><div className="dcl">🏪 {rtl?"تكلفة المخزون":"Inventory Cost"}</div><div className="dcv" style={{color:"#374151"}}>{fm(invCostTotal)}</div><div className="dcc">{prods.length} {rtl?"منتج":"products"} · {prods.reduce((s,p)=>s+p.s,0)} {rtl?"وحدة":"units"}</div></div>
<div className="dc" style={{borderLeft:"4px solid #2563eb"}}><div className="dcl">🏷️ {rtl?"قيمة البيع":"Retail Value"}</div><div className="dcv b">{fm(invRetailTotal)}</div></div>
<div className="dc" style={{borderLeft:"4px solid #059669"}}><div className="dcl">💎 {rtl?"ربح محتمل":"Potential Profit"}</div><div className="dcv g">{fm(invPotentialProfit)}</div><div className="dcc">{invCostTotal>0?((invPotentialProfit/invCostTotal)*100).toFixed(1):0}%</div></div>
<div className="dc" style={{borderLeft:"4px solid #d97706"}}><div className="dcl">📦 {rtl?"إجمالي المشتريات":"Total Purchases"}</div><div className="dcv y">{fm(totalPurchases)}</div><div className="dcc">{invs.length} {rtl?"فاتورة":"invoices"}</div></div>
</div>
<div className="cg">
<div className="ck"><div className="ckt">📈 {t.hourly}</div><ResponsiveContainer width="100%" height={160}><AreaChart data={hrD}><defs><linearGradient id="aG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={.15}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/><XAxis dataKey="h" tick={{fill:"#9ca3af",fontSize:10}}/><YAxis tick={{fill:"#9ca3af",fontSize:10}}/><Tooltip contentStyle={ttip}/><Area type="monotone" dataKey="v" stroke="#2563eb" fill="url(#aG)" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">📊 {t.trend}</div><ResponsiveContainer width="100%" height={160}><BarChart data={dyD}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/><XAxis dataKey="d" tick={{fill:"#9ca3af",fontSize:10}}/><YAxis tick={{fill:"#9ca3af",fontSize:10}}/><Tooltip contentStyle={ttip}/><Bar dataKey="r" fill="#2563eb" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">🍩 {t.byCat}</div><ResponsiveContainer width="100%" height={160}><PieChart><Pie data={ctD} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" label={d=>rtl?d.a:d.n}>{ctD.map((_,i)=><Cell key={i} fill={CC[i%CC.length]}/>)}</Pie><Tooltip contentStyle={ttip}/></PieChart></ResponsiveContainer></div>
<div className="ck"><div className="ckt">💳 {t.payments}</div><ResponsiveContainer width="100%" height={160}><PieChart><Pie data={ppD} cx="50%" cy="50%" outerRadius={60} dataKey="value" label={d=>d.name}>{ppD.map((_,i)=><Cell key={i} fill={CC[i%CC.length]}/>)}</Pie><Tooltip contentStyle={ttip}/></PieChart></ResponsiveContainer></div>
</div>

{/* Top Revenue + Top Margin + Loyalty Stats */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
<div className="tb"><div className="tbh"><span>🏆 {t.top} 5 {rtl?"مبيعات":"Revenue"}</span></div><table><thead><tr><th>{t.product}</th><th>{t.qty}</th><th>{t.total}</th></tr></thead><tbody>{topProds.length===0?<tr><td colSpan={3} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{t.noTxns}</td></tr>:topProds.map((tp,i)=><tr key={i}><td style={{fontWeight:600}}><span style={{color:"#d97706",marginRight:4}}>{["🥇","🥈","🥉","4.","5."][i]}</span>{rtl?tp.nameAr:tp.name}</td><td className="mn">{tp.qty}</td><td className="mn" style={{color:"#059669"}}>{fm(tp.rev)}</td></tr>)}</tbody></table></div>

<div className="tb"><div className="tbh"><span>💎 {t.top} 5 {rtl?"ربح":"Margin"}</span></div><table><thead><tr><th>{t.product}</th><th>{t.margin}</th><th>%</th></tr></thead><tbody>{topMargin.length===0?<tr><td colSpan={3} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{t.noTxns}</td></tr>:topMargin.map((tp,i)=><tr key={i}><td style={{fontWeight:600}}><span style={{color:"#059669",marginRight:4}}>{["🥇","🥈","🥉","4.","5."][i]}</span>{rtl?tp.nameAr:tp.name}</td><td className="mn" style={{color:"#059669"}}>{fm(tp.margin)}</td><td style={{fontFamily:"var(--m)",fontSize:11,color:tp.marginPct>=30?"#059669":tp.marginPct>=15?"#d97706":"#dc2626"}}>{tp.marginPct.toFixed(0)}%</td></tr>)}</tbody></table></div>

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

{/* Expiring items alerts */}
{expiringProds.length>0&&<div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:16,padding:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#991b1b",marginBottom:8}}>⏰ {t.expiringItems} ({expiringProds.length})</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>{expiringProds.map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",padding:"8px 12px",borderRadius:8,fontSize:12,border:"1px solid "+(p.daysLeft<=0?"#fecaca":p.daysLeft<=7?"#fed7aa":"#fde68a")}}>
<div><span style={{fontWeight:600}}>{p.e} {pN(p)}</span><div style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--m)"}}>{t.stock}: {p.s} · {p.exp}</div></div>
<span style={{fontFamily:"var(--m)",fontWeight:700,fontSize:11,padding:"3px 8px",borderRadius:8,background:p.daysLeft<=0?"#fef2f2":p.daysLeft<=7?"#fff7ed":"#fffbeb",color:p.daysLeft<=0?"#dc2626":p.daysLeft<=7?"#ea580c":"#d97706"}}>{p.daysLeft<=0?"⛔ "+t.expired:p.daysLeft+" "+t.daysLeft}</span>
</div>)}</div>
</div>}

{/* Dead Stock Alert */}
{deadStock.length>0&&<div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:16,padding:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#991b1b",marginBottom:8}}>💀 {rtl?"مخزون راكد":"Dead Stock"} ({deadStock.length})</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>{deadStock.slice(0,6).map(d=><div key={d.id} style={{display:"flex",justifyContent:"space-between",background:"#fff",padding:"8px 12px",borderRadius:8,fontSize:12}}>
<span style={{fontWeight:600}}>{d.emoji} {rtl?d.name_ar:d.name}</span>
<span style={{fontFamily:"var(--m)",fontWeight:700,color:"#dc2626"}}>{d.days_since_last_sale===null?"∞":d.days_since_last_sale+"d"}</span>
</div>)}</div>
</div>}

{/* Batch Expiry Alert */}
{expiringBatches.length>0&&<div style={{background:"#fff7ed",border:"1.5px solid #fed7aa",borderRadius:16,padding:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#9a3412",marginBottom:8}}>📋 {rtl?"دُفعات تنتهي قريباً":"Batches Expiring Soon"} ({expiringBatches.length})</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>{expiringBatches.slice(0,6).map(b=><div key={b.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",padding:"8px 12px",borderRadius:8,fontSize:12,border:"1px solid "+(b.urgency==="expired"?"#fecaca":b.urgency==="critical"?"#fed7aa":"#fde68a")}}>
<div><span style={{fontWeight:600}}>{b.emoji} {rtl?b.product_name_ar:b.product_name}</span><div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"دُفعة":"Batch"}: {b.batch_number} · {b.quantity_remaining} {rtl?"متبقي":"left"}</div></div>
<span style={{fontFamily:"var(--m)",fontWeight:700,fontSize:11,color:b.urgency==="expired"?"#dc2626":b.urgency==="critical"?"#ea580c":"#d97706"}}>{b.days_until_expiry<=0?"⛔":b.days_until_expiry+"d"}</span>
</div>)}</div>
</div>}

{/* Recent transactions table */}
<div className="tb"><div className="tbh"><span>{t.recent}</span><button className="ab ab-x" onClick={()=>exportXL(prods,txns,invs)}>📥 {t.excel}</button></div><table><thead><tr><th>{t.receipt}</th><th>{t.time}</th><th>👤</th><th>#</th><th>{t.method}</th><th>{t.total}</th></tr></thead><tbody>{!tC?<tr><td colSpan={6} style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{t.noTxns}</td></tr>:txns.slice(0,15).map(tx=><tr key={tx.id} style={{cursor:"pointer"}} onClick={()=>openReceiptWithItems(tx)}><td className="mn">{tx.rn}</td><td>{tx.date} {tx.time}</td><td style={{fontSize:11,color:tx.custName?"#2563eb":"#d1d5db"}}>{tx.custName||"—"}</td><td>{tx.items.reduce((s,i)=>s+i.qty,0)}</td><td>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</td><td className="mn" style={{color:"#059669"}}>{fm(tx.tot)}</td></tr>)}</tbody></table></div>
</div>}

{/* ADMIN */}
{tab==="admin"&&<div className="ad"><div className="ads"><button className={"asb "+(atab==="inventory"?"a":"")} onClick={()=>setAT("inventory")}>📦 {t.inventory}</button><button className={"asb "+(atab==="vendors"?"a":"")} onClick={()=>setAT("vendors")}>🏭 {rtl?"الموردون":"Vendors"}</button><button className={"asb "+(atab==="categories"?"a":"")} onClick={()=>setAT("categories")}>🏷️ {rtl?"إدارة الفئات":"Categories"}</button><button className={"asb "+(atab==="packages"?"a":"")} onClick={()=>setAT("packages")}>📦 {rtl?"إدارة الحزم":"Pack Manager"}</button><button className={"asb "+(atab==="bulkassign"?"a":"")} onClick={()=>setAT("bulkassign")}>📦 {rtl?"ربط جماعي للموردين":"Bulk Assign"}</button><button className={"asb "+(atab==="audit"?"a":"")} onClick={()=>setAT("audit")} style={{background:atab==="audit"?undefined:"linear-gradient(90deg,#fef2f2,transparent)"}}>🔍 {rtl?"التدقيق الذكي":"Smart Audit"}</button><button className={"asb "+(atab==="stocktake"?"a":"")} onClick={()=>setAT("stocktake")} style={{background:atab==="stocktake"?undefined:"linear-gradient(90deg,#f5f3ff,transparent)"}}>📋 {rtl?"جرد البضاعة":"Stocktake"}</button><button className={"asb "+(atab==="reconcile"?"a":"")} onClick={()=>{setAT("reconcile");DB.getReconciliations().then(r=>{}).catch(()=>{});DB.getClosingReports().then(setClosingReports).catch(()=>{})}} style={{background:atab==="reconcile"?undefined:"linear-gradient(90deg,#ecfdf5,transparent)"}}>💰 {rtl?"مطابقة الصندوق":"Reconciliation"}</button><button className={"asb "+(atab==="pricereview"?"a":"")} onClick={()=>setAT("pricereview")}>💰 {rtl?"مراجعة الأسعار":"Price Review"}</button><button className={"asb "+(atab==="purchases"?"a":"")} onClick={()=>setAT("purchases")}>🧾 {t.purchases}</button><button className={"asb "+(atab==="sales_admin"?"a":"")} onClick={()=>setAT("sales_admin")}>📋 {t.salesView}</button><button className={"asb "+(atab==="loyalty"?"a":"")} onClick={()=>setAT("loyalty")}>⭐ {t.loyalty}</button><button className={"asb "+(atab==="users"?"a":"")} onClick={()=>setAT("users")}>👥 {t.users}</button><button className={"asb "+(atab==="settings"?"a":"")} onClick={()=>setAT("settings")}>⚙️ {t.settings}</button></div>
<div className="ac">
{atab==="inventory"&&<><h2>📦 {t.inventory}</h2>
{/* Inventory Sub-tabs */}
<div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
{[{k:"products",i:"📦",l:rtl?"المنتجات":"Products"},{k:"batches",i:"📋",l:rtl?"الدُفعات":"Batches"},{k:"deadstock",i:"💀",l:rtl?"مخزون راكد":"Dead Stock"},{k:"returns",i:"↩️",l:rtl?"المرتجعات":"Returns"}].map(s=><button key={s.k} onClick={()=>setInvSubTab(s.k)} style={{padding:"8px 16px",borderRadius:10,border:"1.5px solid "+(invSubTab===s.k?"#2563eb":"#e5e7eb"),background:invSubTab===s.k?"#eff6ff":"#fff",color:invSubTab===s.k?"#2563eb":"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>{s.i} {s.l}</button>)}
</div>

{/* ── PRODUCTS SUB-TAB ── */}
{invSubTab==="products"&&<><div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}><button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setAPM(true)}>{t.addProd}</button>
<ExportButtons title={rtl?"تقرير المخزون":"Inventory Report"} getExportData={()=>{
  const f=invSearch.toLowerCase().trim();
  const soldMap={};txns.forEach(tx=>tx.items.forEach(i=>{soldMap[i.id]=(soldMap[i.id]||0)+i.qty}));
  const list=prods.filter(p=>{if(f&&!(p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.cat||"").toLowerCase().includes(f)))return false;if(invSupFilter&&(p.supplier||"")!==invSupFilter)return false;return true});
  const headers=[rtl?"الباركود":"Barcode",rtl?"المنتج":"Product",rtl?"الفئة":"Category",rtl?"المورد":"Vendor",rtl?"التكلفة":"Cost",rtl?"السعر":"Price",rtl?"المخزون":"Stock",rtl?"المباع":"Sold",rtl?"الهامش":"Margin",rtl?"قيمة المخزون":"Stock Value",rtl?"الانتهاء":"Expiry"];
  const rows=list.map(p=>[p.bc,pN(p),p.cat||"—",p.supplier||"—",p.c.toFixed(3),p.p.toFixed(3),p.s,soldMap[p.id]||0,(p.p-p.c).toFixed(3),(p.c*p.s).toFixed(3),p.exp||"—"]);
  const totalStock=list.reduce((s,p)=>s+p.s,0);
  const totalValue=list.reduce((s,p)=>s+p.c*p.s,0);
  const totalRetail=list.reduce((s,p)=>s+p.p*p.s,0);
  const summary=[
    {label:rtl?"عدد المنتجات":"Products",value:list.length,color:"#1e40af"},
    {label:rtl?"إجمالي المخزون":"Total Stock",value:totalStock,color:"#2563eb"},
    {label:rtl?"قيمة التكلفة":"Cost Value",value:fm(totalValue),color:"#dc2626"},
    {label:rtl?"قيمة البيع":"Retail Value",value:fm(totalRetail),color:"#059669"}
  ];
  const filterList=[];
  if(invSearch) filterList.push((rtl?"بحث":"Search")+": "+invSearch);
  if(invSupFilter) filterList.push((rtl?"المورد":"Supplier")+": "+invSupFilter);
  return {headers,rows,summary,filters:filterList,showSignatures:true};
}}/>
{/* View mode toggle */}
<div style={{display:"flex",gap:0,border:"1.5px solid #e5e7eb",borderRadius:10,overflow:"hidden"}}>
  <button onClick={()=>setInvViewMode("table")} style={{padding:"8px 14px",background:invViewMode==="table"?"#2563eb":"#fff",color:invViewMode==="table"?"#fff":"#6b7280",border:"none",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📊 {rtl?"جدول":"Table"}</button>
  <button onClick={()=>setInvViewMode("category")} style={{padding:"8px 14px",background:invViewMode==="category"?"#7c3aed":"#fff",color:invViewMode==="category"?"#fff":"#6b7280",border:"none",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>🏷️ {rtl?"بالفئة":"By Category"}</button>
</div>
<div style={{flex:"1 1 250px",minWidth:200,position:"relative"}}>
<span style={{position:"absolute",[rtl?"right":"left"]:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#94a3b8",pointerEvents:"none"}}>🔍</span>
<input value={invSearch} onChange={e=>setInvSearch(e.target.value)} placeholder={rtl?"بحث بالاسم أو الباركود أو الفئة...":"Search by name, barcode, or category..."} style={{width:"100%",padding:rtl?"10px 38px 10px 14px":"10px 14px 10px 38px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"var(--f)",outline:"none",background:"#f9fafb"}}/>
{invSearch&&<button onClick={()=>setInvSearch("")} style={{position:"absolute",[rtl?"left":"right"]:8,top:"50%",transform:"translateY(-50%)",background:"#dc2626",border:"none",color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
</div>
<select value={invSupFilter} onChange={e=>setInvSupFilter(e.target.value)} style={{padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"var(--f)",outline:"none",background:invSupFilter?"#eff6ff":"#f9fafb",color:"#374151",minWidth:140}}><option value="">{rtl?"كل الموردين":"All Vendors"}</option>{[...new Set(prods.map(p=>p.supplier).filter(Boolean))].sort().map(s=><option key={s} value={s}>{s}</option>)}</select>
<div style={{fontSize:11,color:"#6b7280",fontWeight:600}}>{(()=>{const f=invSearch.toLowerCase().trim();return f?prods.filter(p=>p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.cat||"").toLowerCase().includes(f)).length+" / "+prods.length:prods.length+" "+(rtl?"منتج":"products")})()}</div>
</div>{prods.filter(p=>p.s<30).length>0&&<div className="lw"><div className="lwt">⚠️ {t.lowStock}</div>{prods.filter(p=>p.s<30).slice(0,5).map(p=><div key={p.id} className="lwi">{pN(p)} — {p.s}</div>)}{prods.filter(p=>p.s<30).length>5&&<div className="lwi">+{prods.filter(p=>p.s<30).length-5} {rtl?"أخرى":"more"}</div>}</div>}

{/* CATEGORY VIEW - Grouped by category with inline edit */}
{invViewMode==="category"&&(()=>{
  const f=invSearch.toLowerCase().trim();
  const soldMap={};txns.forEach(tx=>tx.items.forEach(i=>{soldMap[i.id]=(soldMap[i.id]||0)+i.qty}));
  let filtered=prods.filter(p=>{
    if(f&&!(p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.cat||"").toLowerCase().includes(f)||(p.supplier||"").toLowerCase().includes(f)))return false;
    if(invSupFilter&&(p.supplier||"")!==invSupFilter)return false;
    return true;
  });
  // Group by category
  const byCategory={};
  filtered.forEach(p=>{
    const cat=p.cat||"__uncategorized__";
    if(!byCategory[cat])byCategory[cat]=[];
    byCategory[cat].push(p);
  });
  const sortedCats=Object.keys(byCategory).sort((a,b)=>byCategory[b].length-byCategory[a].length);
  
  const toggleCat=(cat)=>{
    const ns=new Set(invExpandedCats);
    if(ns.has(cat))ns.delete(cat);else ns.add(cat);
    setInvExpandedCats(ns);
  };
  
  return <div style={{display:"flex",flexDirection:"column",gap:8}}>
    {/* Expand/Collapse All controls */}
    <div style={{display:"flex",gap:8,marginBottom:4}}>
      <button onClick={()=>setInvExpandedCats(new Set(sortedCats))} style={{padding:"6px 12px",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>⬇ {rtl?"فتح الكل":"Expand All"}</button>
      <button onClick={()=>setInvExpandedCats(new Set())} style={{padding:"6px 12px",background:"#f3f4f6",color:"#6b7280",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>⬆ {rtl?"طي الكل":"Collapse All"}</button>
      <div style={{marginLeft:"auto",fontSize:11,color:"#6b7280",fontWeight:600,display:"flex",alignItems:"center"}}>{sortedCats.length} {rtl?"فئة":"categories"} · {filtered.length} {rtl?"منتج":"products"}</div>
    </div>
    
    {sortedCats.map(cat=>{
      const isExpanded=invExpandedCats.has(cat);
      const catProds=byCategory[cat];
      const catTotal=catProds.reduce((s,p)=>s+p.c*p.s,0);
      const catRetail=catProds.reduce((s,p)=>s+p.p*p.s,0);
      const lowStockCount=catProds.filter(p=>p.s<30).length;
      const isUncat=cat==="__uncategorized__";
      
      return <div key={cat} style={{background:"#fff",border:"1.5px solid "+(isExpanded?"#7c3aed":"#e5e7eb"),borderRadius:12,overflow:"hidden"}}>
        {/* Category Header - clickable */}
        <div onClick={()=>toggleCat(cat)} style={{padding:"12px 16px",background:isUncat?"#fef2f2":isExpanded?"#f5f3ff":"#f9fafb",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
            <span style={{fontSize:14,transition:"transform .2s",transform:isExpanded?"rotate(90deg)":"rotate(0)"}}>▶</span>
            <span style={{fontSize:20}}>{isUncat?"⚠️":"📦"}</span>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:isUncat?"#dc2626":"#374151"}}>{isUncat?(rtl?"بدون فئة":"Uncategorized"):cat}</div>
              <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{catProds.length} {rtl?"منتج":"products"} {lowStockCount>0&&<span style={{color:"#d97706",fontWeight:600,marginLeft:8}}>· ⚠️ {lowStockCount} {rtl?"مخزون منخفض":"low stock"}</span>}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:14,alignItems:"center"}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"قيمة التكلفة":"Cost value"}</div>
              <div style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:"#dc2626"}}>{fm(catTotal)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"#9ca3af"}}>{rtl?"قيمة البيع":"Retail value"}</div>
              <div style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:"#059669"}}>{fm(catRetail)}</div>
            </div>
            <button onClick={(e)=>{e.stopPropagation();openNewInvoice();setInvRows([{cat:isUncat?"":cat,bc:"",prodId:"",name:"",qty:"",cost:"",price:"",expDates:[""],isNew:false}])}}
              style={{padding:"6px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ {rtl?"إضافة فاتورة":"Add Invoice"}</button>
          </div>
        </div>
        
        {/* Products table (when expanded) */}
        {isExpanded && (
          <div style={{overflowX:"auto",borderTop:"1px solid #e5e7eb"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{background:"#fafafa"}}>
                <tr>
                  <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:120}}>{t.bc}</th>
                  <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:150}}>{t.product}</th>
                  <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:120}}>{rtl?"المورد":"Vendor"}</th>
                  <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#dc2626",fontWeight:700,width:80}}>{t.cost}</th>
                  <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#059669",fontWeight:700,width:80}}>{t.price}</th>
                  <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#6b7280",fontWeight:700,width:70}}>{t.stock}</th>
                  <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#d97706",fontWeight:700,minWidth:110}}>{t.expiryDate}</th>
                  <th style={{padding:"8px",textAlign:"right",fontSize:10,color:"#6b7280",fontWeight:700,width:100}}>{t.act}</th>
                </tr>
              </thead>
              <tbody>
                {catProds.map(p=>{
                  const expDays=p.exp?Math.ceil((new Date(p.exp)-today2)/86400000):null;
                  const isEditing=eProd===p.id;
                  return <tr key={p.id} style={{borderTop:"1px solid #f3f4f6",background:expDays!==null&&expDays<=0?"#fef2f2":expDays!==null&&expDays<=7?"#fffbeb":"transparent"}}>
                    <td style={{padding:"6px 8px",fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{p.bc}</td>
                    <td style={{padding:"6px 8px",fontWeight:600}}>{pN(p)}</td>
                    <td style={{padding:"6px 8px"}}>
                      {isEditing?<select value={eSup} onChange={e=>setESup(e.target.value)} style={{width:"100%",padding:"4px 6px",border:"1px solid #2563eb",borderRadius:4,fontSize:11,background:"#eff6ff"}}><option value="">— {rtl?"بدون":"None"} —</option>{suppliers.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}</select>
                      :<span style={{fontSize:11,color:p.supplier?"#2563eb":"#d1d5db"}}>{p.supplier||"—"}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {isEditing?<input type="number" step="0.001" value={eCost} onChange={e=>setECost(e.target.value)} style={{width:70,padding:"4px 6px",border:"1px solid #dc2626",borderRadius:4,fontSize:11,fontFamily:"monospace",textAlign:"center"}}/>:<span style={{fontFamily:"monospace",fontWeight:600,color:"#dc2626"}}>{p.c.toFixed(3)}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {isEditing?<input type="number" step="0.001" value={ePr} onChange={e=>setEPr(e.target.value)} style={{width:70,padding:"4px 6px",border:"1px solid #059669",borderRadius:4,fontSize:11,fontFamily:"monospace",textAlign:"center"}}/>:<span style={{fontFamily:"monospace",fontWeight:700,color:"#059669"}}>{p.p.toFixed(3)}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {isEditing?<input type="number" value={eSt} onChange={e=>setESt(e.target.value)} style={{width:60,padding:"4px 6px",border:"1px solid #2563eb",borderRadius:4,fontSize:11,fontFamily:"monospace",textAlign:"center"}}/>:<span style={{fontWeight:700,color:p.s<=0?"#dc2626":p.s<30?"#d97706":"#059669"}}>{p.s}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center",fontSize:10}}>
                      {isEditing?<input type="date" value={eExp} onChange={e=>setEExp(e.target.value)} style={{padding:"4px 6px",border:"1px solid #d97706",borderRadius:4,fontSize:10,fontFamily:"monospace"}}/>
                      :p.exp?<span style={{fontFamily:"monospace",color:expDays<=0?"#dc2626":expDays<=7?"#ea580c":expDays<=30?"#d97706":"#059669",fontSize:10}}>{p.exp}</span>:<span style={{color:"#d1d5db"}}>—</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"right"}}>
                      {isEditing?<>
                        <button onClick={async()=>{
                          const np=ePr===""||isNaN(parseFloat(ePr))?p.p:parseFloat(ePr);
                          const ns=eSt===""||isNaN(parseInt(eSt))?p.s:parseInt(eSt);
                          const ne=eExp||p.exp||null;
                          const nc=eCost===""||isNaN(parseFloat(eCost))?p.c:parseFloat(eCost);
                          const nsup=eSup;
                          // Audit log for price/cost changes
                          if(p.p!==np){DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"edit_price",entity_type:"product",entity_id:p.id,field_name:"price",old_value:String(p.p),new_value:String(np),notes:"Inline edit"}).catch(()=>{})}
                          if(p.c!==nc){DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"edit_cost",entity_type:"product",entity_id:p.id,field_name:"cost",old_value:String(p.c),new_value:String(nc),notes:"Inline edit"}).catch(()=>{})}
                          setProds(prev=>prev.map(x=>x.id===p.id?{...x,p:np,s:ns,exp:ne,c:nc,supplier:nsup}:x));
                          setEP(null);
                          try{await sb.from("products").update({price:np,stock:ns,cost:nc,expiry_date:ne||null,supplier:nsup||null,updated_at:new Date().toISOString()}).eq("id",p.id);sT("✓ "+(rtl?"تم":"Saved"),"ok")}catch(e){console.error(e);sT("✗ "+e.message,"err")}
                        }} style={{padding:"4px 8px",background:"#059669",color:"#fff",border:"none",borderRadius:4,fontSize:11,cursor:"pointer",marginRight:2}}>✓</button>
                        <button onClick={()=>setEP(null)} style={{padding:"4px 8px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:4,fontSize:11,cursor:"pointer"}}>✕</button>
                      </>:<>
                      <button onClick={()=>{setEP(p.id);setEPr(p.p.toString());setESt(p.s.toString());setEExp(p.exp||"");setECost(p.c.toString());setESup(p.supplier||"")}} style={{padding:"4px 10px",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:4,fontSize:10,cursor:"pointer",fontWeight:600,marginRight:4}}>✎ {rtl?"تعديل":"Edit"}</button>
                      {cu.role==="admin"&&<button onClick={()=>{setEditProdMod(p);setEditProdBc(p.bc||"");setEditProdN(p.n||"");setEditProdA(p.a||"")}} style={{padding:"4px 8px",background:"#fef3c7",color:"#92400e",border:"1px solid #fcd34d",borderRadius:4,fontSize:10,cursor:"pointer",fontWeight:600}} title={rtl?"تعديل متقدم":"Advanced"}>✏️</button>}
                      </>}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>;
    })}
  </div>;
})()}

{/* TABLE VIEW (original) - only show when viewMode is table */}
{invViewMode==="table"&&<><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>{(()=>{const bcMap={};prods.forEach(p=>{if(p.bc){bcMap[p.bc]=(bcMap[p.bc]||0)+1}});const dupBcs=Object.entries(bcMap).filter(([,c])=>c>1);if(dupBcs.length===0)return null;const dupProds=prods.filter(p=>p.bc&&bcMap[p.bc]>1).length;return <div style={{flex:1,padding:"10px 14px",background:"linear-gradient(135deg,#fef2f2,#fee2e2)",border:"2px solid #fca5a5",borderRadius:10,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}><div style={{flex:1,minWidth:200}}><div style={{fontSize:13,fontWeight:800,color:"#991b1b"}}>🔴 {rtl?"تنبيه: باركودات مكررة!":"WARNING: Duplicate Barcodes!"}</div><div style={{fontSize:11,color:"#7f1d1d",marginTop:3}}>{rtl?`يوجد ${dupBcs.length} باركود مكرر يؤثر على ${dupProds} منتج. هذا يسبب أخطاء في نقطة البيع.`:`${dupBcs.length} duplicate barcodes affecting ${dupProds} products. This causes POS errors.`}</div></div>{cu.role==="admin"&&<button onClick={()=>setShowOnlyDups(!showOnlyDups)} style={{padding:"8px 14px",background:showOnlyDups?"#dc2626":"#fff",color:showOnlyDups?"#fff":"#dc2626",border:"2px solid #dc2626",borderRadius:8,fontSize:11,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>{showOnlyDups?"✓ "+(rtl?"عرض الكل":"Show All"):"🔍 "+(rtl?"عرض المكررات فقط":"Show Dups Only")}</button>}</div>})()}</div><div style={{overflowX:"auto"}}><table className="at"><thead><tr><th style={{cursor:"pointer"}} onClick={()=>sortInv("bc")}>{t.bc}{sortIcon("bc")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("n")}>{t.product}{sortIcon("n")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("supplier")}>{rtl?"المورد":"Vendor"}{sortIcon("supplier")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("c")}>{t.cost}{sortIcon("c")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("p")}>{t.price}{sortIcon("p")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("s")}>{t.stock}{sortIcon("s")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("sold")}>{rtl?"المباع":"Sold"}{sortIcon("sold")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("margin")}>{t.margin}{sortIcon("margin")}</th><th style={{cursor:"pointer"}} onClick={()=>sortInv("exp")}>{t.expiryDate}{sortIcon("exp")}</th><th>{rtl?"دُفعات":"Batches"}</th><th>{t.act}</th></tr></thead><tbody>{(()=>{const f=invSearch.toLowerCase().trim();const soldMap={};txns.forEach(tx=>tx.items.forEach(i=>{soldMap[i.id]=(soldMap[i.id]||0)+i.qty}));const bcDupCounts={};prods.forEach(pp=>{if(pp.bc){bcDupCounts[pp.bc]=(bcDupCounts[pp.bc]||0)+1}});let list=prods.filter(p=>{if(f&&!(p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.cat||"").toLowerCase().includes(f)||(p.supplier||"").toLowerCase().includes(f)))return false;if(invSupFilter&&(p.supplier||"")!==invSupFilter)return false;if(showOnlyDups&&(!p.bc||bcDupCounts[p.bc]<=1))return false;return true});if(invSortKey){const dir=invSortDir==="asc"?1:-1;list=[...list].sort((a,b)=>{let av,bv;if(invSortKey==="sold"){av=soldMap[a.id]||0;bv=soldMap[b.id]||0}else if(invSortKey==="margin"){av=a.p-a.c;bv=b.p-b.c}else if(invSortKey==="supplier"){av=(a.supplier||"").toLowerCase();bv=(b.supplier||"").toLowerCase()}else if(invSortKey==="bc"||invSortKey==="n"||invSortKey==="exp"){av=(a[invSortKey]||"").toString().toLowerCase();bv=(b[invSortKey]||"").toString().toLowerCase()}else{av=+a[invSortKey]||0;bv=+b[invSortKey]||0}return av<bv?-1*dir:av>bv?1*dir:0})}return list})().map(p=>{const mg=p.p-p.c;const mgPct=p.c>0?((p.p-p.c)/p.c*100):0;const expDays=p.exp?Math.ceil((new Date(p.exp)-today2)/86400000):null;const pBatches=batches.filter(b=>b.product_id===p.id&&b.status==="active"&&b.quantity_remaining>0);return<tr key={p.id} style={{background:expDays!==null&&expDays<=0?"#fef2f2":expDays!==null&&expDays<=7?"#fffbeb":"transparent"}}><td style={{fontFamily:"var(--m)",fontSize:11}}>{p.bc}{(()=>{const dupCount=prods.filter(x=>x.bc===p.bc&&p.bc).length;if(dupCount>1){return <div style={{marginTop:3}}><span title={rtl?`هذا الباركود مستخدم في ${dupCount} منتجات!`:`This barcode is used in ${dupCount} products!`} style={{display:"inline-block",padding:"2px 6px",background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",borderRadius:4,fontSize:9,fontWeight:800,boxShadow:"0 1px 3px rgba(220,38,38,.3)"}}>🔴 {rtl?`مكرر ×${dupCount}`:`DUP ×${dupCount}`}</span></div>}return null})()}</td><td style={{fontWeight:600}}>{pN(p)}{(()=>{const isPkg=packages[p.bc];const pkgEntries=Object.entries(packages).filter(([,v])=>v.parentId===p.id);if(isPkg){const parProd=prods.find(x=>x.id===isPkg.parentId);return<div style={{fontSize:9,color:"#7c3aed",fontWeight:600,marginTop:3,background:"#f5f3ff",padding:"2px 6px",borderRadius:4,display:"inline-block"}}>📦 {rtl?"حزمة":"Pack"} ×{isPkg.packSize} → {parProd?parProd.n:isPkg.parentBc}</div>}if(pkgEntries.length>0){return<div style={{fontSize:9,color:"#059669",fontWeight:600,marginTop:3,background:"#ecfdf5",padding:"2px 6px",borderRadius:4,display:"inline-block"}}>🔗 {rtl?"يُباع كحزم":"Sold as packs"}: {pkgEntries.map(([bc,v])=>{const pp=prods.find(x=>x.bc===bc);return(pp?pp.n:bc)+" (×"+v.packSize+")"}).join(", ")}</div>}return null})()}</td><td style={{fontSize:11,color:p.supplier?"#2563eb":"#d1d5db",fontWeight:p.supplier?600:400}}>{eProd===p.id?<select value={eSup} onChange={e=>setESup(e.target.value)} style={{padding:"4px 8px",border:"1.5px solid #2563eb",borderRadius:6,fontSize:11,fontFamily:"var(--f)",outline:"none",width:"100%"}}><option value="">— {rtl?"بدون":"None"} —</option>{suppliers.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}</select>:(p.supplier||"—")}</td><td>{eProd===p.id?<input value={eCost} onChange={e=>setECost(e.target.value)}/>:<span style={{fontFamily:"var(--m)"}}>{fN(p.c)}</span>}</td><td>{eProd===p.id?<input value={ePr} onChange={e=>setEPr(e.target.value)}/>:<span style={{fontFamily:"var(--m)",fontWeight:600}}>{fN(p.p)}</span>}</td><td>{eProd===p.id?<input value={eSt} onChange={e=>setESt(e.target.value)}/>:<span style={{fontWeight:700,color:p.s<0?"#dc2626":p.s===0?"#dc2626":p.s<30?"#d97706":"#059669"}}>{p.s}{p.s<0?" ⚠️":p.s===0?" ⛔":""}</span>}</td><td style={{fontFamily:"var(--m)",fontSize:11,color:"#2563eb",fontWeight:600}}>{(()=>{let s=0;txns.forEach(tx=>tx.items.forEach(i=>{if(i.id===p.id)s+=i.qty}));return s})()}</td><td style={{fontFamily:"var(--m)",fontSize:11}}><span style={{fontWeight:600,color:mg>0?"#059669":mg<0?"#dc2626":"#9ca3af"}}>{fN(mg)}</span><br/><span style={{fontSize:9,color:mgPct>=30?"#059669":mgPct>=15?"#d97706":"#dc2626"}}>{mgPct.toFixed(1)}%</span></td><td style={{fontSize:10}}>{eProd===p.id?<input type="date" value={eExp} onChange={e=>setEExp(e.target.value)} style={{width:120}}/>:p.exp?<span style={{fontFamily:"var(--m)",fontWeight:600,color:expDays<=0?"#dc2626":expDays<=7?"#ea580c":expDays<=30?"#d97706":"#059669"}}>{p.exp}{expDays<=0?" ⛔":expDays<=7?" 🔴":expDays<=30?" 🟡":""}</span>:<span style={{color:"#d1d5db"}}>—</span>}</td>
<td>{pBatches.length>0?<span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:700,background:"#eff6ff",color:"#2563eb",cursor:"pointer"}} onClick={()=>{setInvSubTab("batches");setBatchProdId(p.id)}}>{pBatches.length} {rtl?"دُفعة":"lot"+(pBatches.length>1?"s":"")}</span>:<span style={{color:"#d1d5db",fontSize:10}}>—</span>}</td>
<td>{eProd===p.id?<><button className="ab ab-s" onClick={async()=>{const np=ePr===""||isNaN(parseFloat(ePr))?p.p:parseFloat(ePr),ns=eSt===""||isNaN(parseInt(eSt))?p.s:parseInt(eSt),ne=eExp||p.exp||null,nc=eCost===""||isNaN(parseFloat(eCost))?p.c:parseFloat(eCost),nsup=eSup;setProds(prev=>prev.map(x=>x.id===p.id?{...x,p:np,s:ns,exp:ne,c:nc,supplier:nsup}:x));setEP(null);try{await sb.from("products").update({price:np,stock:ns,cost:nc,expiry_date:ne||null,supplier:nsup||null,updated_at:new Date().toISOString()}).eq("id",p.id);sT("✓ "+(rtl?"تم الحفظ":"Saved"),"ok")}catch(e){console.error(e);sT("✗ "+(e.message||"Error"),"err")}}}>✓</button><button className="ab ab-c" onClick={()=>setEP(null)}>✕</button></>:<><button className="ab ab-e" onClick={()=>{setEP(p.id);setEPr(p.p.toString());setESt(p.s.toString());setEExp(p.exp||"");setECost(p.c.toString());setESup(p.supplier||"")}}>✎ {t.edit}</button><button className="ab" style={{background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",fontSize:10,padding:"4px 6px",marginLeft:2}} title={rtl?"إضافة دُفعة بتاريخ انتهاء":"Add Batch with Expiry"} onClick={()=>{setBatchProdId(p.id);setBatchMod(true);setNewBatch({product_id:p.id,batch_number:"B-"+Date.now().toString(36).toUpperCase(),supplier_name:"",received_date:new Date().toISOString().slice(0,10),expiry_date:"",quantity_received:"",cost_per_unit:p.c.toString(),notes:""})}}>📋 {rtl?"دُفعة":"Batch"}</button>{cu.role==="admin"&&<button className="ab" style={{background:"#fef3c7",color:"#92400e",border:"1px solid #fcd34d",fontSize:10,padding:"4px 6px",marginLeft:2}} title={rtl?"تعديل متقدم (الاسم والباركود)":"Advanced edit (name & barcode)"} onClick={()=>{setEditProdMod(p);setEditProdBc(p.bc||"");setEditProdN(p.n||"");setEditProdA(p.a||"")}}>✏️ {rtl?"متقدم":"Advanced"}</button>}{cu.role==="admin"&&(()=>{const dups=prods.filter(x=>x.bc===p.bc&&p.bc);if(dups.length>1){return <button className="ab" style={{background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",border:"none",fontSize:10,padding:"4px 8px",marginLeft:2,fontWeight:800,boxShadow:"0 1px 3px rgba(220,38,38,.3)"}} title={rtl?`دمج ${dups.length} منتجات بنفس الباركود`:`Merge ${dups.length} products with same barcode`} onClick={()=>setMergeMod({barcode:p.bc,products:dups,targetId:p.id,isMerging:false})}>🔀 {rtl?`دمج ${dups.length}`:`Merge ${dups.length}`}</button>}return null})()}<button className="ab" style={{background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",fontSize:10,padding:"4px 6px",marginLeft:2}} title={rtl?"توليد باركود جديد للمنتج":"Generate new barcode"} onClick={async()=>{const hasBc=p.bc&&p.bc.length>=4&&!p.bc.startsWith("NOBC");const msg=hasBc?(rtl?"⚠ هذا المنتج لديه باركود بالفعل:\n"+p.bc+"\n\nهل تريد استبداله بباركود جديد؟":"⚠ This product already has a barcode:\n"+p.bc+"\n\nReplace it with a new one?"):(rtl?"توليد باركود جديد لـ:\n"+pN(p)+"\n\nاستمرار؟":"Generate new barcode for:\n"+pN(p)+"\n\nContinue?");if(!confirm(msg))return;const newBc="3045"+Date.now().toString().slice(-8);const exists=prods.find(x=>x.bc===newBc&&x.id!==p.id);if(exists){sT("✗ "+(rtl?"تعارض، حاول مجدداً":"Conflict, try again"),"err");return}setProds(prev=>prev.map(x=>x.id===p.id?{...x,bc:newBc}:x));try{await sb.from("products").update({barcode:newBc,updated_at:new Date().toISOString()}).eq("id",p.id);sT("✓ "+(rtl?"باركود جديد: ":"New barcode: ")+newBc,"ok")}catch(e){console.error(e);sT("✗ "+(e.message||"Error saving"),"err");setProds(prev=>prev.map(x=>x.id===p.id?{...x,bc:p.bc}:x))}}}>🎲 {rtl?"توليد":"Gen"}</button><button className="ab" style={{background:"#eff6ff",color:"#1e40af",border:"1px solid #bfdbfe",fontSize:10,padding:"4px 6px",marginLeft:2}} title={rtl?"طباعة ملصق باركود":"Print barcode label"} onClick={()=>{const qStr=prompt(rtl?"كم ملصق تريد طباعته؟":"How many labels to print?","1");if(!qStr)return;const q=parseInt(qStr);if(isNaN(q)||q<=0||q>200){sT("✗ "+(rtl?"عدد غير صالح (1-200)":"Invalid (1-200)"),"err");return}const w=window.open("","_blank","width=500,height=500");if(!w)return;const nm=(p.a||p.n).replace(/"/g,"").substring(0,28);const storeName=(storeSettings.storeName||"3045").substring(0,18);const bc=p.bc;let labels="";for(let k=0;k<q;k++){labels+='<div class="lbl"><div class="sn">'+storeName+'</div><div class="nm">'+nm+'</div><svg class="bc" id="bc'+k+'"></svg><div class="pr">'+p.p.toFixed(3)+' JD</div></div>'}w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title> </title><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><style>@page{size:40mm 30mm;margin:0}@media print{html,body{margin:0!important;padding:0!important;width:40mm;height:30mm}thead,tfoot,header,footer{display:none!important}}html,body{margin:0;padding:0;width:40mm;height:30mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}*{box-sizing:border-box;margin:0;padding:0}.lbl{width:40mm;height:30mm;padding:1mm 1.5mm;text-align:center;font-family:Arial,"Tahoma",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;page-break-inside:avoid;page-break-after:always}.lbl:last-child{page-break-after:auto}.sn{font-size:10pt;font-weight:900;line-height:1.05;margin-bottom:0.3mm}.nm{font-size:8pt;font-weight:700;line-height:1.1;max-height:7.5mm;overflow:hidden;word-break:break-word;direction:rtl}.bc{width:37mm;height:10mm;display:block}.pr{font-size:15pt;font-weight:900;line-height:1;font-family:Arial,sans-serif;margin-top:0.3mm}</style></head><body>'+labels+'<script>window.addEventListener("load",function(){for(var k=0;k<'+q+';k++){try{JsBarcode("#bc"+k,"'+bc+'",{format:"CODE128",width:1.5,height:36,displayValue:true,fontSize:9,textMargin:0,margin:0})}catch(e){}}setTimeout(function(){window.print();setTimeout(function(){window.close()},800)},400)})<\/script></body></html>');w.document.close()}}>🏷️ {rtl?"ملصق":"Label"}</button>{cu.role==="admin"&&p.s>0&&<button className="ab" style={{background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca",fontSize:9,padding:"4px 8px",marginLeft:2}} onClick={()=>{const qty=prompt(rtl?"كم وحدة تريد إنقاصها؟":"How many units to decrease?","1");if(!qty)return;const n=parseInt(qty);if(isNaN(n)||n<=0){sT("✗ Invalid","err");return}if(n>p.s){sT("✗ "+(rtl?"أكثر من المخزون":"Exceeds stock"),"err");return}const reason=prompt(rtl?"السبب (تالف/منتهي/فقدان/تعديل)":"Reason (damaged/expired/loss/adjustment)","adjustment");const newStock=p.s-n;setProds(prev=>prev.map(x=>x.id===p.id?{...x,s:newStock}:x));DB.updateProductPriceStock(p.id,p.p,newStock,p.exp).catch(e=>console.error(e));sT("✓ "+(rtl?"تم إنقاص":"Decreased")+" "+n+" → "+newStock+" "+(reason||""),"ok")}}>▼ {rtl?"إنقاص":"Decrease"}</button>}<button className="ab ab-d" onClick={async()=>{if(!confirm(rtl?"حذف المنتج؟":"Delete product?"))return;setProds(prev=>prev.filter(x=>x.id!==p.id));try{await DB.deleteProduct(p.id)}catch(e){console.error(e)}}}>✕</button></>}</td></tr>})}</tbody></table></div></>}</>}

{/* ── BATCHES SUB-TAB ── */}
{invSubTab==="batches"&&(()=>{
const filteredBatches=batchProdId?batches.filter(b=>b.product_id===batchProdId):batches;
const activeBatches=filteredBatches.filter(b=>b.quantity_remaining>0);
return<>
<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>{setBatchMod(true);setNewBatch({product_id:batchProdId||"",batch_number:"B-"+Date.now().toString(36).toUpperCase(),supplier_name:"",received_date:new Date().toISOString().slice(0,10),expiry_date:"",quantity_received:"",cost_per_unit:"",notes:""})}}>{rtl?"إضافة دُفعة":"Add Batch"}</button>
{batchProdId&&<button className="ab ab-c" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setBatchProdId(null)}>{rtl?"عرض الكل":"Show All"}</button>}
<div style={{marginLeft:"auto",fontSize:12,color:"#6b7280"}}>{activeBatches.length} {rtl?"دُفعة نشطة":"active batches"}</div>
</div>

{/* Expiry summary cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
{[{l:rtl?"منتهية":"Expired",c:filteredBatches.filter(b=>b.expiry_date&&new Date(b.expiry_date)<today2&&b.quantity_remaining>0).length,bg:"#fef2f2",cl:"#dc2626"},
{l:rtl?"< 7 أيام":"< 7 days",c:filteredBatches.filter(b=>{if(!b.expiry_date||b.quantity_remaining<=0)return false;const d=Math.ceil((new Date(b.expiry_date)-today2)/86400000);return d>=0&&d<=7}).length,bg:"#fff7ed",cl:"#ea580c"},
{l:rtl?"< 30 يوم":"< 30 days",c:filteredBatches.filter(b=>{if(!b.expiry_date||b.quantity_remaining<=0)return false;const d=Math.ceil((new Date(b.expiry_date)-today2)/86400000);return d>7&&d<=30}).length,bg:"#fffbeb",cl:"#d97706"},
{l:rtl?"سليمة":"OK",c:filteredBatches.filter(b=>{if(!b.expiry_date||b.quantity_remaining<=0)return true;return Math.ceil((new Date(b.expiry_date)-today2)/86400000)>30}).filter(b=>b.quantity_remaining>0).length,bg:"#ecfdf5",cl:"#059669"}
].map((s,i)=><div key={i} style={{background:s.bg,borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:s.cl}}>{s.c}</div><div style={{fontSize:10,color:s.cl}}>{s.l}</div></div>)}
</div>

<div style={{overflowX:"auto"}}><table className="at"><thead><tr><th>{rtl?"الدُفعة":"Batch"}</th><th>{t.product}</th><th>{rtl?"المورد":"Supplier"}</th><th>{rtl?"استلام":"Received"}</th><th>{t.expiryDate}</th><th>{rtl?"الكمية":"Qty"}</th><th>{rtl?"متبقي":"Remaining"}</th><th>{t.cost}</th><th>{rtl?"الحالة":"Status"}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{activeBatches.length===0?<tr><td colSpan={cu.role==="admin"?10:9} style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{rtl?"لا دُفعات":"No batches"}</td></tr>:activeBatches.map(b=>{
const pr=prods.find(p=>p.id===b.product_id);const expD=b.expiry_date?Math.ceil((new Date(b.expiry_date)-today2)/86400000):null;
return<tr key={b.id} style={{background:expD!==null&&expD<=0?"#fef2f2":expD!==null&&expD<=7?"#fff7ed":"transparent"}}>
<td style={{fontFamily:"var(--m)",fontSize:11,fontWeight:700,color:"#2563eb"}}>{b.batch_number}</td>
<td style={{fontWeight:600}}>{pr?pN(pr):b.product_id}</td>
<td style={{fontSize:11}}>{b.supplier_name||"—"}</td>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{b.received_date}</td>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{b.expiry_date?<span style={{color:expD<=0?"#dc2626":expD<=7?"#ea580c":expD<=30?"#d97706":"#059669",fontWeight:600}}>{b.expiry_date}{expD<=0?" ⛔":expD<=7?" 🔴":expD<=30?" 🟡":""}</span>:"—"}</td>
<td style={{fontFamily:"var(--m)"}}>{b.quantity_received}</td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:b.quantity_remaining>0?"#059669":"#dc2626"}}>{b.quantity_remaining}</td>
<td style={{fontFamily:"var(--m)"}}>{fN(+b.cost_per_unit)}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:b.status==="active"?"#ecfdf5":b.status==="depleted"?"#f3f4f6":"#fef2f2",color:b.status==="active"?"#059669":b.status==="depleted"?"#9ca3af":"#dc2626"}}>{b.status}</span></td>
{cu.role==="admin"&&<td><button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setBatches(p=>p.filter(x=>x.id!==b.id));try{await DB.deleteBatch(b.id)}catch{}}}>✕</button></td>}
</tr>})}</tbody></table></div>
</>})()}

{/* ── STOCKTAKE SUB-TAB ── */}
{/* Old stocktake sub-tab removed — use Admin → 📋 Stocktake instead */}

{/* ── DEAD STOCK SUB-TAB ── */}
{invSubTab==="deadstock"&&<>
<div style={{display:"flex",gap:8,marginBottom:14}}>
<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12}} onClick={async()=>{try{const ds=await DB.getDeadStock();setDeadStock(ds);sT("✓ Refreshed","ok")}catch{}}}>🔄 {rtl?"تحديث":"Refresh"}</button>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
{[{l:"30+ "+t.daysLeft,c:deadStock.filter(d=>d.days_since_last_sale>=30&&d.days_since_last_sale<60).length,bg:"#fffbeb",cl:"#d97706"},
{l:"60+ "+t.daysLeft,c:deadStock.filter(d=>d.days_since_last_sale>=60&&d.days_since_last_sale<90).length,bg:"#fff7ed",cl:"#ea580c"},
{l:"90+ "+t.daysLeft,c:deadStock.filter(d=>d.days_since_last_sale===null||d.days_since_last_sale>=90).length,bg:"#fef2f2",cl:"#dc2626"}
].map((s,i)=><div key={i} style={{background:s.bg,borderRadius:12,padding:14,textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:s.cl}}>{s.c}</div><div style={{fontSize:11,color:s.cl,fontWeight:600}}>{s.l}</div></div>)}
</div>
{deadStock.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40}}>✅</div>{rtl?"لا يوجد مخزون راكد":"No dead stock detected"}</div>:
<div style={{overflowX:"auto"}}><table className="at"><thead><tr><th>{t.product}</th><th>{t.stock}</th><th>{t.price}</th><th>{rtl?"قيمة المخزون":"Stock Value"}</th><th>{rtl?"آخر بيع":"Last Sold"}</th><th>{rtl?"أيام الركود":"Days Idle"}</th></tr></thead>
<tbody>{deadStock.map(d=>{const days=d.days_since_last_sale;return<tr key={d.id} style={{background:days===null||days>=90?"#fef2f2":days>=60?"#fff7ed":"#fffbeb"}}>
<td style={{fontWeight:600}}>{d.emoji} {rtl?d.name_ar:d.name}</td>
<td style={{fontFamily:"var(--m)"}}>{d.stock}</td>
<td style={{fontFamily:"var(--m)"}}>{fN(+d.price)}</td>
<td style={{fontFamily:"var(--m)",color:"#dc2626",fontWeight:700}}>{fm(+d.stock_value)}</td>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{d.last_sold_at?new Date(d.last_sold_at).toLocaleDateString():<span style={{color:"#dc2626"}}>{rtl?"أبداً":"Never"}</span>}</td>
<td><span style={{padding:"3px 10px",borderRadius:14,fontSize:10,fontWeight:700,background:days===null||days>=90?"#dc2626":days>=60?"#ea580c":"#d97706",color:"#fff"}}>{days===null?"∞":days+"d"}</span></td>
</tr>})}</tbody></table></div>}
</>}

{/* ── RETURNS SUB-TAB ── */}
{invSubTab==="returns"&&<>
<div style={{display:"flex",gap:8,marginBottom:14}}>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setSalesReturnMod(true)}>↩️ {rtl?"مرتجع مبيعات":"Sales Return"}</button>
<button className="ab ab-e" style={{padding:"8px 16px",fontSize:12}} onClick={()=>setPurchaseReturnMod(true)}>↩️ {rtl?"مرتجع مشتريات":"Purchase Return"}</button>
</div>

{/* Sales Returns */}
<div className="tb" style={{marginBottom:14}}><div className="tbh"><span>↩️ {rtl?"مرتجعات المبيعات":"Sales Returns"}</span></div>
<table><thead><tr><th>{t.receipt}</th><th>{rtl?"النوع":"Type"}</th><th>{rtl?"المبلغ":"Amount"}</th><th>{rtl?"طريقة":"Method"}</th><th>{t.time}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{salesReturns.length===0?<tr><td colSpan={cu.role==="admin"?6:5} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{rtl?"لا مرتجعات":"No returns"}</td></tr>:salesReturns.map(r=><tr key={r.id}>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{r.receipt_no||"—"}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:r.return_type==="full"?"#fef2f2":"#fffbeb",color:r.return_type==="full"?"#dc2626":"#d97706"}}>{r.return_type==="full"?(rtl?"كامل":"Full"):(rtl?"جزئي":"Partial")}</span></td>
<td className="mn" style={{color:"#dc2626",fontWeight:700}}>{fm(+r.total_refund)}</td>
<td style={{fontSize:11}}>{r.refund_method}</td>
<td style={{fontSize:10,fontFamily:"var(--m)"}}>{new Date(r.created_at).toLocaleDateString()}</td>
{cu.role==="admin"&&<td><button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setSalesReturns(p=>p.filter(x=>x.id!==r.id));try{await DB.deleteSalesReturn(r.id)}catch{}}}>✕</button></td>}
</tr>)}</tbody></table></div>

{/* Purchase Returns */}
<div className="tb"><div className="tbh"><span>↩️ {rtl?"مرتجعات المشتريات":"Purchase Returns"}</span></div>
<table><thead><tr><th>{rtl?"الفاتورة":"Invoice"}</th><th>{rtl?"المورد":"Supplier"}</th><th>{rtl?"النوع":"Type"}</th><th>{rtl?"المبلغ":"Amount"}</th><th>{t.time}</th>{cu.role==="admin"&&<th>{t.act}</th>}</tr></thead>
<tbody>{purchaseReturns.length===0?<tr><td colSpan={cu.role==="admin"?6:5} style={{textAlign:"center",padding:20,color:"#9ca3af"}}>{rtl?"لا مرتجعات":"No returns"}</td></tr>:purchaseReturns.map(r=><tr key={r.id}>
<td style={{fontFamily:"var(--m)",fontSize:11}}>{r.invoice_no||"—"}</td>
<td style={{fontSize:11}}>{r.supplier_name||"—"}</td>
<td><span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:r.return_type==="full"?"#fef2f2":"#fffbeb",color:r.return_type==="full"?"#dc2626":"#d97706"}}>{r.return_type==="full"?(rtl?"كامل":"Full"):(rtl?"جزئي":"Partial")}</span></td>
<td className="mn" style={{color:"#059669",fontWeight:700}}>{fm(+r.total_refund)}</td>
<td style={{fontSize:10,fontFamily:"var(--m)"}}>{new Date(r.created_at).toLocaleDateString()}</td>
{cu.role==="admin"&&<td><button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setPurchaseReturns(p=>p.filter(x=>x.id!==r.id));try{await DB.deletePurchaseReturn(r.id)}catch{}}}>✕</button></td>}
</tr>)}</tbody></table></div>
</>}
</>}

{atab==="vendors"&&(()=>{
const prodCountBySup={};prods.forEach(p=>{if(p.supplier)prodCountBySup[p.supplier]=(prodCountBySup[p.supplier]||0)+1});
return<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>🏭 {rtl?"إدارة الموردين":"Vendor Management"}</h2>
<ExportButtons title={rtl?"تقرير الموردين":"Vendors Report"} getExportData={()=>{
  const headers=[rtl?"الاسم":"Name",rtl?"المندوب":"Rep",rtl?"الهاتف":"Phone",rtl?"الشروط":"Terms",rtl?"المنتجات":"Products",rtl?"فواتير الشراء":"Invoices"];
  const rows=suppliers.map(s=>{const prodCount=prods.filter(p=>p.supplier===s.name).length;const invCount=invs.filter(i=>i.supplier===s.name).length;return [s.name||"—",s.rep_name||"—",s.phone||"—",s.terms||"—",prodCount,invCount]});
  const summary=[
    {label:rtl?"إجمالي الموردين":"Total Vendors",value:suppliers.length,color:"#1e40af"},
    {label:rtl?"المنتجات":"Linked Products",value:prods.filter(p=>p.supplier).length,color:"#059669"},
    {label:rtl?"بدون مورد":"Without Supplier",value:prods.filter(p=>!p.supplier).length,color:"#dc2626"},
    {label:rtl?"فواتير":"Invoices",value:invs.length,color:"#7c3aed"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:false};
}}/></div>
<div style={{background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:14,padding:14,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,color:"#1e40af",marginBottom:10}}>➕ {rtl?"إضافة مورد جديد":"Add New Vendor"}</div>
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
<input id="v-name" placeholder={rtl?"اسم المورد *":"Vendor name *"} style={{flex:"2 1 200px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="v-rep" placeholder={rtl?"اسم المندوب":"Sales rep name"} style={{flex:"1 1 140px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="v-rep" placeholder={rtl?"اسم المندوب":"Rep name"} style={{flex:"1 1 140px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="v-phone" placeholder={rtl?"الهاتف":"Phone"} style={{flex:"1 1 140px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--m)",outline:"none"}}/>
<input id="v-terms" placeholder={rtl?"الشروط (نقدي/30 يوم...)":"Terms"} style={{flex:"1 1 140px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<button onClick={()=>{const ne=document.getElementById("v-name");const pe=document.getElementById("v-phone");const te=document.getElementById("v-terms");const re=document.getElementById("v-rep");const nm=ne?ne.value.trim():"";const ph=pe?pe.value.trim():"";const tr=te?te.value.trim():"";const rp=re?re.value.trim():"";if(!nm){sT("✗ "+(rtl?"اسم المورد مطلوب":"Name required"),"err");return}if(suppliers.find(s=>s.name===nm)){sT("✗ "+(rtl?"المورد موجود":"Already exists"),"err");return}const ns=[...suppliers,{id:"sup_"+Date.now().toString(36),name:nm,phone:ph,terms:tr||"Cash",rep:rp}];setSuppliers(ns);DB.setSetting("suppliers",ns);if(ne)ne.value="";if(pe)pe.value="";if(te)te.value="";if(re)re.value="";sT("✓ "+(rtl?"تمت الإضافة":"Added"),"ok")}} style={{padding:"10px 24px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>+ {rtl?"إضافة":"Add"}</button>
</div></div>

<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#065f46",fontWeight:600}}>{rtl?"إجمالي الموردين":"Total Vendors"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{suppliers.length}</div></div>
<div style={{background:"#eff6ff",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#1e40af",fontWeight:600}}>{rtl?"موردون نشطون":"Active (with products)"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{Object.keys(prodCountBySup).length}</div></div>
<div style={{background:"#fffbeb",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#92400e",fontWeight:600}}>{rtl?"منتجات بدون مورد":"Products w/o vendor"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{prods.filter(p=>!p.supplier).length}</div></div>
</div>

{suppliers.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40,marginBottom:8}}>🏭</div>{rtl?"لا موردين بعد — أضف أول مورد أعلاه":"No vendors yet — add your first one above"}</div>:
<table className="at"><thead><tr><th>{rtl?"اسم المورد":"Vendor Name"}</th><th>{rtl?"المندوب":"Rep"}</th><th>{rtl?"الهاتف":"Phone"}</th><th>{rtl?"الشروط":"Terms"}</th><th>{rtl?"عدد المنتجات":"Products"}</th><th>{t.act}</th></tr></thead>
<tbody>{suppliers.map((s,i)=><tr key={s.id||i}>
<td><input value={s.name} onChange={e=>{const ns=[...suppliers];ns[i]={...ns[i],name:e.target.value};setSuppliers(ns)}} onBlur={()=>DB.setSetting("suppliers",suppliers)} style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontWeight:600,fontFamily:"var(--f)",outline:"none"}}/></td>
<td><input value={s.rep||""} onChange={e=>{const ns=[...suppliers];ns[i]={...ns[i],rep:e.target.value};setSuppliers(ns)}} onBlur={()=>DB.setSetting("suppliers",suppliers)} placeholder={rtl?"اسم المندوب":"Rep name"} style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontFamily:"var(--f)",outline:"none"}}/></td>
<td><input value={s.rep||""} onChange={e=>{const ns=[...suppliers];ns[i]={...ns[i],rep:e.target.value};setSuppliers(ns)}} onBlur={()=>DB.setSetting("suppliers",suppliers)} placeholder={rtl?"اسم المندوب":"Rep"} style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontFamily:"var(--f)",outline:"none",color:"#7c3aed",fontWeight:600}}/></td>
<td><input value={s.phone||""} onChange={e=>{const ns=[...suppliers];ns[i]={...ns[i],phone:e.target.value};setSuppliers(ns)}} onBlur={()=>DB.setSetting("suppliers",suppliers)} placeholder="—" style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontFamily:"var(--m)",outline:"none"}}/></td>
<td><input value={s.terms||""} onChange={e=>{const ns=[...suppliers];ns[i]={...ns[i],terms:e.target.value};setSuppliers(ns)}} onBlur={()=>DB.setSetting("suppliers",suppliers)} placeholder="Cash" style={{width:"100%",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontFamily:"var(--f)",outline:"none"}}/></td>
<td><span onClick={()=>{if((prodCountBySup[s.name]||0)>0){setVenProdMod(s.name);setVenProdSearch("");setVenProdSort({k:"",d:"asc"});setVenProdEdits({})}}} style={{padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:700,background:prodCountBySup[s.name]>0?"#ecfdf5":"#f3f4f6",color:prodCountBySup[s.name]>0?"#059669":"#9ca3af",fontFamily:"var(--m)",cursor:prodCountBySup[s.name]>0?"pointer":"default",textDecoration:prodCountBySup[s.name]>0?"underline":"none"}}>{prodCountBySup[s.name]||0}{prodCountBySup[s.name]>0?" 👁":""}</span></td>
<td><button className="ab ab-s" style={{fontSize:10}} onClick={()=>{DB.setSetting("suppliers",suppliers);sT("✓ "+(rtl?"تم الحفظ":"Saved"),"ok")}}>💾 {rtl?"حفظ":"Save"}</button> <button className="ab ab-d" style={{fontSize:10}} onClick={()=>{const cnt=prodCountBySup[s.name]||0;if(cnt>0&&!confirm(rtl?"هذا المورد لديه "+cnt+" منتج. هل تريد حذفه؟":"This vendor has "+cnt+" products. Delete anyway?"))return;if(cnt===0&&!confirm(rtl?"حذف؟":"Delete?"))return;const ns=suppliers.filter((x,xi)=>xi!==i);setSuppliers(ns);DB.setSetting("suppliers",ns);sT("✓ "+(rtl?"تم الحذف":"Deleted"),"ok")}}>✕</button></td>
</tr>)}</tbody></table>}
<div style={{marginTop:14,fontSize:11,color:"#6b7280",background:"#f9fafb",padding:12,borderRadius:10}}>💡 {rtl?"عدّل أي حقل واضغط خارج الحقل أو زر الحفظ — التغييرات تُحفظ تلقائياً":"Edit any field then click outside or press Save — changes auto-save"}</div>
</>})()}

{atab==="categories"&&(()=>{
// Category Manager — Bilingual + Subcategories + AI Auto-Categorize

// Build category map from products
const catMap = {};
prods.forEach(p => {
  const cat = (p.cat||"").trim() || "__uncategorized__";
  if(!catMap[cat]) catMap[cat] = {count:0, products:[], samples:[]};
  catMap[cat].count++;
  catMap[cat].products.push(p);
  if(catMap[cat].samples.length < 3) catMap[cat].samples.push(p.n);
});
const catList = Object.entries(catMap).map(([name,info]) => {
  // Find rich data from customCats if exists
  const rich = customCats.find(c => c.name===name || c.id===name);
  return {
    name,
    nameAr: rich?.nameAr || rich?.name_ar || "",
    emoji: rich?.emoji || "📦",
    parent: rich?.parent || "",
    count: info.count,
    samples: info.samples,
    isUncategorized: name === "__uncategorized__"
  };
}).sort((a,b) => b.count - a.count);

// Detect similar categories (Levenshtein-lite: lowercase + trim)
const normalized = {};
catList.forEach(c => {
  const k = c.name.toLowerCase().replace(/[\s_-]/g,"");
  if(!normalized[k]) normalized[k] = [];
  normalized[k].push(c);
});
const duplicates = Object.values(normalized).filter(g => g.length > 1);
const singletons = catList.filter(c => c.count === 1 && !c.isUncategorized);
const uncatProducts = catMap["__uncategorized__"]?.count || 0;

// Filter
const filtered = catList.filter(c => {
  if(!catMgrSearch) return true;
  const s = catMgrSearch.toLowerCase();
  return c.name.toLowerCase().includes(s) || (c.nameAr||"").includes(catMgrSearch);
});

// AI Keyword Dictionary for auto-categorization
const KEYWORDS = {
  candy: {ar:"حلويات", emoji:"🍫", words:["snickers","kitkat","kit kat","twix","mars","bounty","galaxy","oreo","m&m","mm","chocolate","شوكولاتة","شوكولا","حلوى","علكة","gum","orbit","mentos","haribo","candy","sweet"]},
  chips: {ar:"شيبس ومكسرات", emoji:"🥜", words:["lays","ليز","doritos","pringles","برينجلز","chips","شيبس","crisp","nuts","مكسرات","seeds","بذور","بذر","sunflower","peanut","فستق","لوز","cashew","almond"]},
  beverages: {ar:"مشروبات", emoji:"🥤", words:["pepsi","بيبسي","coca","cola","كوكا","sprite","سبرايت","fanta","فانتا","mountain dew","mirinda","مرندة","7up","seven up","drink","soda","soft drink","مشروب غازي","cool"]},
  energy: {ar:"مشروبات الطاقة", emoji:"⚡", words:["red bull","ريد بول","monster","مونستر","power horse","باور هورس","sting","ستينج","energy","طاقة","matrix","tiger","xl"]},
  water: {ar:"مياه وعصائر", emoji:"💧", words:["water","مياه","ماء","juice","عصير","mineral","spring","aquafina","نستله","nestle","sparkling","orange juice","apple juice","mango"]},
  cigarettes: {ar:"سجائر", emoji:"🚬", words:["marlboro","مارلبورو","l&m","lm","winston","وينستون","kent","كينت","davidoff","دافيدوف","camel","cigarettes","سجائر","tobacco","دخان","west","gauloise"]},
  snacks: {ar:"وجبات خفيفة", emoji:"🍪", words:["noodles","نودلز","indomie","إندومي","cup noodles","biscuit","بسكويت","cookie","كوكيز","wafer","ويفر","cake","كيك","croissant","كرواسون"]},
  canned: {ar:"معلبات", emoji:"🥫", words:["tuna","تونة","sardine","سردين","beans","فاصوليا","corn","ذرة","peas","بازيلاء","mushroom","فطر","canned","معلب","قطعة","tomato paste","معجون"]},
  dairy: {ar:"ألبان", emoji:"🥛", words:["milk","حليب","لبن","yogurt","لبنة","cheese","جبنة","جبن","butter","زبدة","cream","قشطة","laban","أبوقوس","نادك","المراعي","almarai"]},
  bakery: {ar:"مخبوزات", emoji:"🍞", words:["bread","خبز","عيش","صمون","كعك","cake","كيك","croissant","pita","خبز عربي","toast","تورتيلا","bun"]},
  meat: {ar:"لحوم", emoji:"🍖", words:["chicken","دجاج","beef","لحم بقر","lamb","لحم خروف","sausage","سجق","نقانق","mortadella","مرتديلا","بسطرمة","شاورما","shawarma","kebab"]},
  frozen: {ar:"مجمدات", emoji:"🧊", words:["frozen","مجمد","مثلج","ice cream","آيس كريم","بوظة","مجلدات","fish frozen","سمك مجمد"]},
  vegetables: {ar:"خضروات", emoji:"🥬", words:["tomato","طماطم","onion","بصل","potato","بطاطا","cucumber","خيار","lettuce","خس","carrot","جزر","pepper","فلفل","garlic","ثوم"]},
  fruits: {ar:"فواكه", emoji:"🍎", words:["apple","تفاح","banana","موز","orange","برتقال","grape","عنب","mango","مانجا","watermelon","بطيخ","strawberry","فراولة"]},
  cleaning: {ar:"منظفات", emoji:"🧴", words:["detergent","منظف","soap","صابون","shampoo","شامبو","tide","تايد","ariel","أريال","persil","برسيل","clorox","كلوركس","dettol","ديتول","fairy","فيري","disinfectant","معقم","sanitizer","bleach","قاصر"]},
  household: {ar:"مستلزمات منزلية", emoji:"🧹", words:["tissue","مناديل","كلينكس","kleenex","toilet paper","ورق توالت","lighter","ولاعة","candle","شمعة","plastic bag","كيس بلاستيك","aluminum","قصدير","foil","رول","battery","بطارية"]},
  spices: {ar:"بهارات", emoji:"🧂", words:["salt","ملح","sugar","سكر","pepper","فلفل اسود","cumin","كمون","cinnamon","قرفة","cardamom","هيل","saffron","زعفران","spice","بهار","thyme","زعتر"]},
  oils: {ar:"زيوت", emoji:"🛢️", words:["oil","زيت","olive oil","زيت زيتون","sunflower oil","corn oil","ghee","سمن","tahini","طحينة"]},
  rice_pasta: {ar:"أرز ومعكرونة", emoji:"🍝", words:["rice","أرز","pasta","معكرونة","spaghetti","سباغيتي","macaroni","مكرونة","noodles dry","شعيرية","vermicelli","بسماتي","basmati"]},
  babycare: {ar:"عناية بالأطفال", emoji:"🍼", words:["pampers","بامبرز","diaper","حفاضة","baby","طفل","رضع","cerelac","سيريلاك","formula","حليب أطفال"]},
  personal: {ar:"عناية شخصية", emoji:"🧴", words:["toothpaste","معجون اسنان","colgate","كولجيت","sensodyne","deodorant","ديودرانت","perfume","عطر","brush","فرشاة","razor","شفرة","shaving","حلاقة","cream فاتك","veet"]}
};

const detectCategory = (productName, currentCat) => {
  const text = (productName||"").toLowerCase();
  let best = null, bestScore = 0;
  Object.entries(KEYWORDS).forEach(([catKey, def]) => {
    let score = 0;
    def.words.forEach(w => {
      if(text.includes(w.toLowerCase())) score += w.length;
    });
    if(score > bestScore) { bestScore = score; best = catKey; }
  });
  return best;
};

const runAutoSuggest = () => {
  const sugg = [];
  prods.forEach(p => {
    const detected = detectCategory(p.n + " " + (p.a||""), p.cat);
    if(detected) {
      const detectedCatName = KEYWORDS[detected].ar; // we'll match by AR or EN
      const detectedEn = detected;
      // Check if current cat differs (case-insensitive)
      const curr = (p.cat||"").toLowerCase().trim();
      if(curr !== detectedEn.toLowerCase() && curr !== detectedCatName.toLowerCase()) {
        sugg.push({
          productId: p.id,
          name: p.n,
          nameAr: p.a,
          currentCat: p.cat || "—",
          suggestedCat: detectedEn,
          suggestedCatAr: detectedCatName,
          emoji: KEYWORDS[detected].emoji
        });
      }
    }
  });
  setCatSuggestions(sugg);
  setCatSuggApprove(new Set(sugg.map(s => s.productId)));
  setCatAutoSuggMod(true);
};

const applyAutoSuggestions = async () => {
  let count = 0;
  const ids = Array.from(catSuggApprove);
  for(const sg of catSuggestions) {
    if(!ids.includes(sg.productId)) continue;
    const pr = prods.find(x => x.id === sg.productId);
    if(pr) {
      try {
        await DB.upsertProduct({...pr, cat: sg.suggestedCat});
        count++;
      } catch(e) { console.error(e); }
    }
  }
  setProds(p => p.map(x => {
    const sg = catSuggestions.find(s => s.productId === x.id && ids.includes(s.productId));
    return sg ? {...x, cat: sg.suggestedCat} : x;
  }));
  // Save new categories to customCats if not exists
  const newCustomCats = [...customCats];
  catSuggestions.forEach(sg => {
    if(!ids.includes(sg.productId)) return;
    if(!newCustomCats.find(c => c.name === sg.suggestedCat)) {
      newCustomCats.push({
        id: "cat_"+sg.suggestedCat,
        name: sg.suggestedCat,
        nameAr: sg.suggestedCatAr,
        emoji: sg.emoji,
        parent: ""
      });
    }
  });
  setCustomCats(newCustomCats);
  await DB.setSetting("custom_categories", newCustomCats);
  sT(`✓ ${rtl?"تم تحديث":"Updated"} ${count} ${rtl?"منتج":"products"}`, "ok");
  setCatAutoSuggMod(false);
  setCatSuggestions([]);
  setCatSuggApprove(new Set());
};

const mergeCategories = async () => {
  if(catMergeFrom.length === 0 || !catMergeTo.en) return;
  // Save merged category to customCats
  let newCustomCats = customCats.filter(c => !catMergeFrom.includes(c.name));
  if(!newCustomCats.find(c => c.name === catMergeTo.en)) {
    newCustomCats.push({
      id: "cat_"+catMergeTo.en,
      name: catMergeTo.en,
      nameAr: catMergeTo.ar,
      emoji: catMergeTo.emoji,
      parent: catMergeTo.parent
    });
  }
  // Update all products
  let count = 0;
  const productsToUpdate = prods.filter(p => catMergeFrom.includes(p.cat));
  for(const pr of productsToUpdate) {
    try {
      await DB.upsertProduct({...pr, cat: catMergeTo.en});
      count++;
    } catch(e) { console.error(e); }
  }
  setProds(p => p.map(x => catMergeFrom.includes(x.cat) ? {...x, cat: catMergeTo.en} : x));
  setCustomCats(newCustomCats);
  await DB.setSetting("custom_categories", newCustomCats);
  sT(`✓ ${rtl?"تم دمج":"Merged"} ${count} ${rtl?"منتج":"products"}`, "ok");
  setCatMergeMod(false);
  setCatMergeFrom([]);
  setCatMergeTo({en:"",ar:"",emoji:"📦",parent:""});
};

const saveEditedCat = async () => {
  if(!catEditMod || !catEditMod.newEn) return;
  const oldName = catEditMod.oldName;
  const newName = catEditMod.newEn;
  // Update customCats
  const newCustomCats = customCats.filter(c => c.name !== oldName);
  newCustomCats.push({
    id: "cat_"+newName,
    name: newName,
    nameAr: catEditMod.newAr || "",
    emoji: catEditMod.newEmoji || "📦",
    parent: catEditMod.newParent || ""
  });
  // Update products if name changed
  if(oldName !== newName) {
    const productsToUpdate = prods.filter(p => p.cat === oldName);
    for(const pr of productsToUpdate) {
      try { await DB.upsertProduct({...pr, cat: newName}); }
      catch(e) { console.error(e); }
    }
    setProds(p => p.map(x => x.cat === oldName ? {...x, cat: newName} : x));
  }
  setCustomCats(newCustomCats);
  await DB.setSetting("custom_categories", newCustomCats);
  sT("✓ "+(rtl?"تم الحفظ":"Saved"), "ok");
  setCatEditMod(null);
};

const addNewCat = async () => {
  if(!newCatData.en) return;
  const newCustomCats = [...customCats, {
    id: "cat_"+newCatData.en,
    name: newCatData.en,
    nameAr: newCatData.ar,
    emoji: newCatData.emoji,
    parent: newCatData.parent
  }];
  setCustomCats(newCustomCats);
  await DB.setSetting("custom_categories", newCustomCats);
  sT("✓ "+(rtl?"تمت الإضافة":"Added"), "ok");
  setCatNewMod(false);
  setNewCatData({en:"",ar:"",emoji:"📦",parent:""});
};

return <>
{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>🏷️ {rtl?"إدارة الفئات":"Category Manager"}</h2>
    <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>
      <strong>{catList.length}</strong> {rtl?"فئة":"categories"} · 
      <strong style={{color:"#dc2626"}}> {duplicates.length}</strong> {rtl?"تكرار":"duplicates"} · 
      <strong style={{color:"#d97706"}}> {singletons.length}</strong> {rtl?"بمنتج واحد":"singletons"} · 
      <strong style={{color:"#dc2626"}}> {uncatProducts}</strong> {rtl?"بدون فئة":"uncategorized"}
    </p>
  </div>
  <div style={{display:"flex",gap:8}}>
    <ExportButtons title={rtl?"تقرير الفئات":"Categories Report"} getExportData={()=>{
      const headers=[rtl?"الفئة":"Category",rtl?"عدد المنتجات":"Products",rtl?"قيمة المخزون":"Stock Value",rtl?"قيمة البيع":"Retail Value",rtl?"عينات":"Samples"];
      const rows=catList.map(c=>{
        const stockVal=c.products.reduce((s,p)=>s+p.c*p.s,0);
        const retailVal=c.products.reduce((s,p)=>s+p.p*p.s,0);
        return [c.name==="__uncategorized__"?(rtl?"بدون فئة":"Uncategorized"):c.name,c.count,stockVal.toFixed(3),retailVal.toFixed(3),c.samples.join(", ")];
      });
      const summary=[
        {label:rtl?"عدد الفئات":"Categories",value:catList.length,color:"#1e40af"},
        {label:rtl?"إجمالي المنتجات":"Total Products",value:prods.length,color:"#059669"},
        {label:rtl?"بدون فئة":"Uncategorized",value:uncatProducts,color:"#dc2626"},
        {label:rtl?"منتج واحد":"Singletons",value:singletons.length,color:"#d97706"}
      ];
      return {headers,rows,summary,filters:[],showSignatures:false};
    }}/>
    <button onClick={runAutoSuggest}
      style={{padding:"10px 20px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",border:"none",borderRadius:10,
              color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13,boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>
      🧠 {rtl?"اقتراحات ذكية AI":"AI Auto-Categorize"}
    </button>
    <button onClick={()=>setCatNewMod(true)}
      style={{padding:"10px 20px",background:"#059669",border:"none",borderRadius:10,
              color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      + {rtl?"فئة جديدة":"New Category"}
    </button>
  </div>
</div>

{/* Alerts */}
{(duplicates.length > 0 || uncatProducts > 0) && (
  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
    {duplicates.length > 0 && (
      <div style={{padding:12,background:"#fef3c7",borderRadius:10,border:"1px solid #fbbf24"}}>
        <div style={{fontWeight:700,color:"#92400e",marginBottom:6,fontSize:13}}>⚠️ {rtl?"فئات متشابهة":"Similar Categories"}</div>
        {duplicates.slice(0,3).map((g,i) => (
          <div key={i} style={{fontSize:11,color:"#78350f",marginBottom:4}}>
            {g.map(c => c.name).join(" ↔ ")} 
            <button onClick={()=>{
              setCatMergeFrom(g.map(c=>c.name));
              setCatMergeTo({en:g[0].name,ar:g[0].nameAr,emoji:g[0].emoji||"📦",parent:""});
              setCatMergeMod(true);
            }}
            style={{marginLeft:8,padding:"2px 8px",background:"#92400e",color:"#fff",border:"none",borderRadius:4,fontSize:10,cursor:"pointer"}}>
              {rtl?"دمج":"Merge"}
            </button>
          </div>
        ))}
      </div>
    )}
    {uncatProducts > 0 && (
      <div style={{padding:12,background:"#fee2e2",borderRadius:10,border:"1px solid #fca5a5"}}>
        <div style={{fontWeight:700,color:"#991b1b",marginBottom:6,fontSize:13}}>🔴 {rtl?"منتجات بدون فئة":"Uncategorized Products"}</div>
        <div style={{fontSize:11,color:"#7f1d1d"}}>
          {uncatProducts} {rtl?"منتج بدون فئة — استخدم AI للتصنيف التلقائي":"products without category — use AI to auto-categorize"}
        </div>
      </div>
    )}
  </div>
)}

{/* Search + Bulk Merge */}
<div style={{display:"flex",gap:8,marginBottom:12,padding:12,background:"#f9fafb",borderRadius:12,border:"1px solid #e5e7eb"}}>
  <input value={catMgrSearch} onChange={e=>setCatMgrSearch(e.target.value)}
    placeholder={rtl?"🔍 بحث عن فئة...":"🔍 Search categories..."}
    style={{flex:1,padding:"10px 14px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,outline:"none"}}/>
  <button onClick={()=>{setCatMergeMod(true);setCatMergeFrom([]);setCatMergeTo({en:"",ar:"",emoji:"📦",parent:""})}}
    style={{padding:"10px 20px",background:"#d97706",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
    🔀 {rtl?"دمج فئات":"Merge Categories"}
  </button>
</div>

{/* Categories Table */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",overflow:"auto"}}>
  <table style={{width:"100%",borderCollapse:"collapse"}}>
    <thead style={{background:"#f9fafb"}}>
      <tr>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600,width:60}}>{rtl?"رمز":"Icon"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الفئة (إنجليزي)":"Category (EN)"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الفئة (عربي)":"Category (AR)"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الفئة الأم":"Parent"}</th>
        <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"عدد المنتجات":"Products"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"أمثلة":"Samples"}</th>
        <th style={{padding:10,textAlign:"center",fontSize:11,color:"#6b7280",fontWeight:600,width:120}}>{rtl?"إجراءات":"Actions"}</th>
      </tr>
    </thead>
    <tbody>
      {filtered.map((c,i) => (
        <tr key={i} style={{borderTop:"1px solid #f3f4f6",
          background: c.isUncategorized ? "#fef2f2" : c.count===1 ? "#fffbeb" : "#fff"}}>
          <td style={{padding:10,fontSize:24,textAlign:"center"}}>{c.emoji}</td>
          <td style={{padding:10,fontSize:13,fontWeight:600}}>
            {c.isUncategorized ? <span style={{color:"#dc2626"}}>{rtl?"بدون فئة":"Uncategorized"}</span> : c.name}
          </td>
          <td style={{padding:10,fontSize:13,direction:"rtl"}}>{c.nameAr || <span style={{color:"#d1d5db",fontSize:11}}>—</span>}</td>
          <td style={{padding:10,fontSize:11,color:"#6b7280"}}>
            {c.parent ? <span style={{padding:"2px 8px",background:"#eff6ff",color:"#2563eb",borderRadius:6}}>{c.parent}</span> : "—"}
          </td>
          <td style={{padding:10,textAlign:"right",fontSize:13,fontFamily:"monospace",fontWeight:700,
            color:c.count===1?"#d97706":c.count>50?"#059669":"#374151"}}>{c.count}</td>
          <td style={{padding:10,fontSize:10,color:"#6b7280",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {c.samples.join(" · ")}
          </td>
          <td style={{padding:10,textAlign:"center"}}>
            {!c.isUncategorized && (
              <button onClick={()=>setCatEditMod({oldName:c.name,newEn:c.name,newAr:c.nameAr,newEmoji:c.emoji,newParent:c.parent})}
                style={{padding:"4px 10px",background:"#2563eb",color:"#fff",border:"none",borderRadius:6,fontSize:11,cursor:"pointer",marginRight:4}}>
                ✎ {rtl?"تعديل":"Edit"}
              </button>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>

{/* Edit Modal */}
{catEditMod && (
  <div onClick={()=>setCatEditMod(null)}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:400}}>
      <h3 style={{margin:"0 0 16px",fontSize:18,fontWeight:800}}>✎ {rtl?"تعديل الفئة":"Edit Category"}</h3>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input value={catEditMod.newEmoji} onChange={e=>setCatEditMod({...catEditMod,newEmoji:e.target.value})}
          placeholder="📦" style={{width:60,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:24,textAlign:"center"}}/>
        <input value={catEditMod.newEn} onChange={e=>setCatEditMod({...catEditMod,newEn:e.target.value})}
          placeholder="English Name" style={{flex:1,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14}}/>
      </div>
      <input value={catEditMod.newAr} onChange={e=>setCatEditMod({...catEditMod,newAr:e.target.value})}
        placeholder="الاسم بالعربي" style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginBottom:8,direction:"rtl"}}/>
      <select value={catEditMod.newParent} onChange={e=>setCatEditMod({...catEditMod,newParent:e.target.value})}
        style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginBottom:16}}>
        <option value="">— {rtl?"بدون فئة أم":"No Parent"} —</option>
        {catList.filter(c => !c.isUncategorized && c.name !== catEditMod.oldName).map(c => (
          <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>
        ))}
      </select>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setCatEditMod(null)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={saveEditedCat} style={{padding:"10px 24px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer"}}>✓ {rtl?"حفظ":"Save"}</button>
      </div>
    </div>
  </div>
)}

{/* New Category Modal */}
{catNewMod && (
  <div onClick={()=>setCatNewMod(false)}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:400}}>
      <h3 style={{margin:"0 0 16px",fontSize:18,fontWeight:800}}>+ {rtl?"فئة جديدة":"New Category"}</h3>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <input value={newCatData.emoji} onChange={e=>setNewCatData({...newCatData,emoji:e.target.value})}
          placeholder="📦" style={{width:60,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:24,textAlign:"center"}}/>
        <input value={newCatData.en} onChange={e=>setNewCatData({...newCatData,en:e.target.value})}
          placeholder="English Name" style={{flex:1,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14}}/>
      </div>
      <input value={newCatData.ar} onChange={e=>setNewCatData({...newCatData,ar:e.target.value})}
        placeholder="الاسم بالعربي" style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginBottom:8,direction:"rtl"}}/>
      <select value={newCatData.parent} onChange={e=>setNewCatData({...newCatData,parent:e.target.value})}
        style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginBottom:16}}>
        <option value="">— {rtl?"فئة رئيسية":"Main Category"} —</option>
        {catList.filter(c => !c.isUncategorized).map(c => (
          <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>
        ))}
      </select>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setCatNewMod(false)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={addNewCat} disabled={!newCatData.en} style={{padding:"10px 24px",background:newCatData.en?"#059669":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:newCatData.en?"pointer":"not-allowed"}}>✓ {rtl?"إضافة":"Add"}</button>
      </div>
    </div>
  </div>
)}

{/* Merge Categories Modal */}
{catMergeMod && (
  <div onClick={()=>setCatMergeMod(false)}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:500,maxWidth:600,maxHeight:"85vh",overflow:"auto"}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>🔀 {rtl?"دمج الفئات":"Merge Categories"}</h3>
      <p style={{color:"#6b7280",fontSize:12,margin:"0 0 16px"}}>
        {rtl?"اختر الفئات للدمج، ثم حدد الفئة النهائية":"Select categories to merge into one"}
      </p>
      
      {/* Source categories - multi-select */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:6,color:"#374151"}}>1. {rtl?"الفئات المراد دمجها (اختر متعدد)":"Categories to merge (multi-select)"}</div>
        <div style={{maxHeight:200,overflow:"auto",border:"1.5px solid #e5e7eb",borderRadius:8,padding:8}}>
          {catList.filter(c => !c.isUncategorized).map(c => (
            <label key={c.name} style={{display:"flex",alignItems:"center",gap:8,padding:6,fontSize:12,cursor:"pointer",borderRadius:4,
              background:catMergeFrom.includes(c.name)?"#eff6ff":"transparent"}}>
              <input type="checkbox" checked={catMergeFrom.includes(c.name)}
                onChange={e=>{
                  if(e.target.checked) setCatMergeFrom([...catMergeFrom,c.name]);
                  else setCatMergeFrom(catMergeFrom.filter(x=>x!==c.name));
                }}/>
              <span>{c.emoji}</span>
              <span style={{fontWeight:600}}>{c.name}</span>
              {c.nameAr && <span style={{color:"#6b7280",fontSize:11}}>({c.nameAr})</span>}
              <span style={{marginLeft:"auto",fontSize:10,color:"#9ca3af"}}>{c.count} {rtl?"منتج":"products"}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Target category */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:6,color:"#374151"}}>2. {rtl?"الفئة الموحدة":"Final unified category"}</div>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <input value={catMergeTo.emoji} onChange={e=>setCatMergeTo({...catMergeTo,emoji:e.target.value})}
            style={{width:60,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:24,textAlign:"center"}}/>
          <input value={catMergeTo.en} onChange={e=>setCatMergeTo({...catMergeTo,en:e.target.value})}
            placeholder="English Name" style={{flex:1,padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14}}/>
        </div>
        <input value={catMergeTo.ar} onChange={e=>setCatMergeTo({...catMergeTo,ar:e.target.value})}
          placeholder="الاسم بالعربي" style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,direction:"rtl"}}/>
      </div>

      {catMergeFrom.length > 0 && catMergeTo.en && (
        <div style={{padding:12,background:"#fef3c7",borderRadius:8,marginBottom:16,fontSize:12,color:"#78350f"}}>
          ⚠️ {rtl?`سيتم دمج ${catMergeFrom.length} فئة و تحديث ${prods.filter(p=>catMergeFrom.includes(p.cat)).length} منتج`:`Will merge ${catMergeFrom.length} categories and update ${prods.filter(p=>catMergeFrom.includes(p.cat)).length} products`}
        </div>
      )}

      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setCatMergeMod(false)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={mergeCategories} disabled={catMergeFrom.length===0||!catMergeTo.en}
          style={{padding:"10px 24px",background:(catMergeFrom.length>0&&catMergeTo.en)?"#d97706":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:(catMergeFrom.length>0&&catMergeTo.en)?"pointer":"not-allowed"}}>
          🔀 {rtl?"دمج":"Merge"}
        </button>
      </div>
    </div>
  </div>
)}

{/* AI Auto-Suggest Modal */}
{catAutoSuggMod && (
  <div onClick={()=>setCatAutoSuggMod(false)}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:800,maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>🧠 {rtl?"اقتراحات ذكية للفئات":"AI Category Suggestions"}</h3>
      <p style={{color:"#6b7280",fontSize:12,margin:"0 0 12px"}}>
        {rtl?`النظام اكتشف ${catSuggestions.length} منتج قد يكون مصنّف خطأ — راجع وأكّد:`:`AI found ${catSuggestions.length} potentially miscategorized products — review and confirm:`}
      </p>
      
      {catSuggestions.length === 0 ? (
        <div style={{padding:40,textAlign:"center",color:"#9ca3af"}}>
          🎉 {rtl?"كل المنتجات مصنّفة بشكل صحيح!":"All products correctly categorized!"}
        </div>
      ) : (
        <>
          <div style={{display:"flex",gap:8,marginBottom:8,paddingBottom:8,borderBottom:"1px solid #e5e7eb"}}>
            <button onClick={()=>setCatSuggApprove(new Set(catSuggestions.map(s=>s.productId)))}
              style={{padding:"4px 12px",background:"#ecfdf5",border:"1px solid #6ee7b7",borderRadius:6,color:"#059669",fontSize:11,cursor:"pointer",fontWeight:600}}>
              ✓ {rtl?"اختر الكل":"Select All"}
            </button>
            <button onClick={()=>setCatSuggApprove(new Set())}
              style={{padding:"4px 12px",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:6,color:"#dc2626",fontSize:11,cursor:"pointer",fontWeight:600}}>
              ✕ {rtl?"إلغاء الكل":"Clear All"}
            </button>
            <span style={{marginLeft:"auto",fontSize:11,color:"#6b7280"}}>{catSuggApprove.size} / {catSuggestions.length} {rtl?"محدد":"selected"}</span>
          </div>
          <div style={{flex:1,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
                <tr>
                  <th style={{padding:8,textAlign:"left",fontSize:11,color:"#6b7280",width:30}}></th>
                  <th style={{padding:8,textAlign:"left",fontSize:11,color:"#6b7280"}}>{rtl?"المنتج":"Product"}</th>
                  <th style={{padding:8,textAlign:"left",fontSize:11,color:"#dc2626"}}>{rtl?"الفئة الحالية":"Current"}</th>
                  <th style={{padding:8,textAlign:"left",fontSize:11,color:"#059669"}}>{rtl?"المقترحة":"Suggested"}</th>
                </tr>
              </thead>
              <tbody>
                {catSuggestions.map((sg,i) => (
                  <tr key={i} style={{borderTop:"1px solid #f3f4f6",
                    background:catSuggApprove.has(sg.productId)?"#ecfdf5":"#fff"}}>
                    <td style={{padding:8}}>
                      <input type="checkbox" checked={catSuggApprove.has(sg.productId)}
                        onChange={e=>{
                          const ns = new Set(catSuggApprove);
                          if(e.target.checked) ns.add(sg.productId); else ns.delete(sg.productId);
                          setCatSuggApprove(ns);
                        }}/>
                    </td>
                    <td style={{padding:8,fontSize:11,fontWeight:600}}>{rtl?sg.nameAr:sg.name}</td>
                    <td style={{padding:8,fontSize:11,color:"#dc2626"}}>{sg.currentCat}</td>
                    <td style={{padding:8,fontSize:11,color:"#059669",fontWeight:700}}>
                      {sg.emoji} {sg.suggestedCat} <span style={{color:"#9ca3af",fontWeight:400}}>({sg.suggestedCatAr})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16,paddingTop:12,borderTop:"1px solid #e5e7eb"}}>
        <button onClick={()=>{setCatAutoSuggMod(false);setCatSuggestions([]);setCatSuggApprove(new Set())}}
          style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>
          {rtl?"إلغاء":"Cancel"}
        </button>
        {catSuggestions.length > 0 && (
          <button onClick={applyAutoSuggestions} disabled={catSuggApprove.size===0}
            style={{padding:"10px 24px",background:catSuggApprove.size>0?"linear-gradient(135deg,#7c3aed,#9333ea)":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:catSuggApprove.size>0?"pointer":"not-allowed"}}>
            ✓ {rtl?`تطبيق ${catSuggApprove.size} تغيير`:`Apply ${catSuggApprove.size} Changes`}
          </button>
        )}
      </div>
    </div>
  </div>
)}
</>})()}

{atab==="packages"&&(()=>{
// Package Manager — manage parent-pack relationships
const pkgList = Object.entries(packages).map(([packBc, info]) => {
  const packProd = prods.find(p => p.bc === packBc);
  const parentProd = prods.find(p => p.id === info.parentId);
  return { packBc, packProd, parentProd, packSize: info.packSize };
}).filter(x => x.packProd && x.parentProd);

const filteredPkgs = pkgList.filter(x => {
  if(!packMgrSearch) return true;
  const s = packMgrSearch.toLowerCase();
  return x.packProd.n.toLowerCase().includes(s) || x.parentProd.n.toLowerCase().includes(s) || x.packBc.includes(packMgrSearch);
});

// Products that could be parents (not already a pack themselves, has stock>0 or is a known item)
const possibleParents = prods.filter(p => !packages[p.bc]).sort((a,b)=>a.n.localeCompare(b.n));
// Products that could be packs (not already a parent of something)
const isAlreadyParent = (id) => Object.values(packages).some(p => p.parentId === id);
const possiblePacks = prods.filter(p => !packages[p.bc] && !isAlreadyParent(p.id));

const savePack = async () => {
  if(!newPack.parentId || !newPack.packBc || !newPack.packSize) return;
  const parentProd = prods.find(p => p.id === newPack.parentId);
  if(!parentProd) return;
  
  let packProd = prods.find(p => p.bc === newPack.packBc);
  
  // If pack barcode doesn't exist as a product yet, create it
  if(!packProd && newPack.packName && newPack.packPrice) {
    const newId = "P_PACK_" + Date.now().toString(36);
    const newProdData = {
      id: newId,
      bc: newPack.packBc,
      n: newPack.packName,
      a: newPack.packName,
      p: parseFloat(newPack.packPrice) || 0,
      c: parentProd.c * parseInt(newPack.packSize),
      cat: parentProd.cat,
      u: "pack",
      s: 0,
      e: "📦",
      exp: null,
      img: null,
      supplier: parentProd.supplier
    };
    try {
      await DB.upsertProduct(newProdData);
      setProds(p => [...p, newProdData]);
      packProd = newProdData;
    } catch(e) { console.error(e); sT("✗ "+(rtl?"خطأ":"Error"),"err"); return; }
  }
  
  if(!packProd) {
    sT("✗ "+(rtl?"يجب إدخال اسم وسعر للحزمة الجديدة":"Need pack name & price"),"err");
    return;
  }
  
  // Update price if provided and pack already exists
  if(newPack.packPrice && parseFloat(newPack.packPrice) !== packProd.p) {
    try {
      await DB.upsertProduct({...packProd, p: parseFloat(newPack.packPrice)});
      setProds(p => p.map(x => x.id===packProd.id ? {...x, p: parseFloat(newPack.packPrice)} : x));
    } catch(e) { console.error(e); }
  }
  
  // Save package link
  const updated = {...packages, [newPack.packBc]: {parentId: parentProd.id, parentBc: parentProd.bc, packSize: parseInt(newPack.packSize)}};
  try {
    await DB.setSetting("packages", updated);
    setPackages(updated);
    sT("✓ "+(rtl?"تم ربط الحزمة":"Pack linked"),"ok");
    setNewPackMod(false);
    setNewPack({parentId:"",packBc:"",packName:"",packSize:"",packPrice:""});
  } catch(e) { console.error(e); sT("✗ Error","err"); }
};

const deletePack = async (packBc) => {
  if(!confirm(rtl?"حذف ربط الحزمة؟ (لن يحذف المنتج)":"Delete pack link? (Product remains)")) return;
  const updated = {...packages};
  delete updated[packBc];
  try {
    await DB.setSetting("packages", updated);
    setPackages(updated);
    sT("✓ "+(rtl?"تم الحذف":"Deleted"),"ok");
  } catch(e) { console.error(e); }
};

return <>
{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>📦 {rtl?"إدارة الحزم والعبوات":"Package Manager"}</h2>
    <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>
      {rtl?"اربط منتج العلبة بمنتج الحبة الأم — عند بيع العلبة يخصم تلقائياً من مخزون الحبة":"Link pack barcodes to parent products — selling a pack auto-deducts from parent stock"}
    </p>
  </div>
  <div style={{display:"flex",gap:8}}>
  <ExportButtons title={rtl?"تقرير الحزم":"Packages Report"} getExportData={()=>{
    const headers=[rtl?"باركود الحزمة":"Pack Barcode",rtl?"اسم الحزمة":"Pack Name",rtl?"الحبة الأم":"Parent Product",rtl?"الحجم":"Size",rtl?"سعر الحزمة":"Pack Price",rtl?"مخزون الأم":"Parent Stock"];
    const rows=Object.entries(packages).map(([packBc,pkg])=>{
      const parent=prods.find(p=>p.id===pkg.parentId);
      const packProd=prods.find(p=>p.bc===packBc);
      return [packBc,packProd?pN(packProd):"—",parent?pN(parent):"—",pkg.packSize||1,packProd?packProd.p.toFixed(3):"—",parent?parent.s:"—"];
    });
    const summary=[
      {label:rtl?"عدد الحزم":"Pack Links",value:Object.keys(packages).length,color:"#7c3aed"},
      {label:rtl?"المنتجات الأم":"Parent Products",value:[...new Set(Object.values(packages).map(p=>p.parentId))].length,color:"#1e40af"}
    ];
    return {headers,rows,summary,filters:[],showSignatures:false};
  }}/>
  <button onClick={()=>{setNewPackMod(true);setNewPack({parentId:"",packBc:"",packName:"",packSize:"",packPrice:""})}}
    style={{padding:"10px 20px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
    + {rtl?"حزمة جديدة":"New Pack Link"}
  </button>
  </div>
</div>

{/* How it works guide */}
<div style={{background:"linear-gradient(135deg,#eff6ff,#f0fdf4)",border:"1.5px solid #bfdbfe",borderRadius:12,padding:16,marginBottom:14}}>
  <div style={{fontSize:13,fontWeight:700,color:"#1e40af",marginBottom:8}}>💡 {rtl?"كيف تعمل الحزم؟":"How packs work?"}</div>
  <div style={{fontSize:12,color:"#374151",lineHeight:1.7}}>
    {rtl?<>
      <strong>مثال إندومي:</strong> لديك "إندومي حبة" بمخزون 100 حبة. تبيع أيضاً "إندومي علبة 5 حبات".<br/>
      <strong>1.</strong> أنشئ كل من المنتجين في المخزون بباركودات مختلفة.<br/>
      <strong>2.</strong> اضغط "حزمة جديدة" واربط: العلبة ← الحبة (Size: 5).<br/>
      <strong>3.</strong> عند بيع علبة → النظام يخصم 5 حبات من مخزون "إندومي حبة" تلقائياً ✅<br/>
      <strong>4.</strong> مخزون "إندومي علبة" يبقى = 0 دائماً (وهمي).
    </>:<>
      <strong>Indomie example:</strong> You have "Indomie Single" with 100 units in stock. You also sell "Indomie Pack of 5".<br/>
      <strong>1.</strong> Create both products in inventory with different barcodes.<br/>
      <strong>2.</strong> Click "New Pack Link" and link: Pack ← Single (Size: 5).<br/>
      <strong>3.</strong> When you sell a pack → system auto-deducts 5 from "Indomie Single" stock ✅<br/>
      <strong>4.</strong> "Indomie Pack" stock stays = 0 (virtual).
    </>}
  </div>
</div>

{/* Search */}
<div style={{display:"flex",gap:8,marginBottom:12,padding:12,background:"#f9fafb",borderRadius:12,border:"1px solid #e5e7eb"}}>
  <input value={packMgrSearch} onChange={e=>setPackMgrSearch(e.target.value)}
    placeholder={rtl?"🔍 بحث بالاسم أو الباركود...":"🔍 Search by name or barcode..."}
    style={{flex:1,padding:"10px 14px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,outline:"none"}}/>
  <div style={{padding:"10px 16px",background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,fontWeight:600,color:"#374151"}}>
    {pkgList.length} {rtl?"حزمة نشطة":"active packs"}
  </div>
</div>

{/* Packages table */}
{pkgList.length === 0 ? (
  <div style={{padding:60,textAlign:"center",background:"#fff",borderRadius:12,border:"1px solid #e5e7eb"}}>
    <div style={{fontSize:48}}>📦</div>
    <div style={{fontSize:16,fontWeight:700,color:"#374151",marginTop:8}}>{rtl?"لا توجد حزم بعد":"No packs yet"}</div>
    <div style={{fontSize:12,color:"#6b7280",marginTop:4}}>{rtl?"اضغط 'حزمة جديدة' لربط أول حزمة":"Click 'New Pack Link' to create your first one"}</div>
  </div>
) : (
  <div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",overflow:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead style={{background:"#f9fafb"}}>
        <tr>
          <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الحزمة (المباع)":"Pack (Sold)"}</th>
          <th style={{padding:10,textAlign:"center",fontSize:11,color:"#6b7280",fontWeight:600,width:60}}>×</th>
          <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الحبة الأم (يخصم منها)":"Parent (Deducts From)"}</th>
          <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"سعر الحزمة":"Pack Price"}</th>
          <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"سعر الحبة":"Single Price"}</th>
          <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"التوفير":"Savings"}</th>
          <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"مخزون الأم":"Parent Stock"}</th>
          <th style={{padding:10,textAlign:"center",fontSize:11,color:"#6b7280",fontWeight:600,width:80}}></th>
        </tr>
      </thead>
      <tbody>
        {filteredPkgs.map((x,i) => {
          const totalIfSingle = x.parentProd.p * x.packSize;
          const savings = totalIfSingle - x.packProd.p;
          const savingsPct = totalIfSingle > 0 ? (savings/totalIfSingle*100) : 0;
          return (
            <tr key={i} style={{borderTop:"1px solid #f3f4f6"}}>
              <td style={{padding:10}}>
                <div style={{fontSize:13,fontWeight:600}}>{x.packProd.n}</div>
                <div style={{fontSize:10,color:"#6b7280",fontFamily:"monospace"}}>{x.packBc}</div>
              </td>
              <td style={{padding:10,textAlign:"center",fontSize:18,fontWeight:800,color:"#7c3aed"}}>{x.packSize}</td>
              <td style={{padding:10}}>
                <div style={{fontSize:13,fontWeight:600,color:"#059669"}}>↗ {x.parentProd.n}</div>
                <div style={{fontSize:10,color:"#6b7280",fontFamily:"monospace"}}>{x.parentProd.bc}</div>
              </td>
              <td style={{padding:10,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}>{x.packProd.p.toFixed(3)}</td>
              <td style={{padding:10,textAlign:"right",fontFamily:"monospace"}}>{x.parentProd.p.toFixed(3)}</td>
              <td style={{padding:10,textAlign:"right",fontSize:11}}>
                {savings > 0 ? (
                  <><span style={{color:"#059669",fontWeight:700,fontFamily:"monospace"}}>-{savings.toFixed(3)}</span>
                    <div style={{fontSize:9,color:"#059669"}}>({savingsPct.toFixed(0)}% off)</div></>
                ) : savings < 0 ? (
                  <span style={{color:"#dc2626",fontWeight:700,fontSize:10}}>⚠ {rtl?"أغلى!":"More expensive!"}</span>
                ) : <span style={{color:"#9ca3af"}}>—</span>}
              </td>
              <td style={{padding:10,textAlign:"right",fontFamily:"monospace",fontWeight:700,
                color:x.parentProd.s<x.packSize?"#dc2626":x.parentProd.s<30?"#d97706":"#059669"}}>
                {x.parentProd.s} {x.parentProd.s<x.packSize&&"⛔"}
              </td>
              <td style={{padding:10,textAlign:"center"}}>
                <button onClick={()=>deletePack(x.packBc)}
                  style={{padding:"4px 10px",background:"#fef2f2",color:"#dc2626",border:"1px solid #fecaca",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:600}}>
                  🗑️ {rtl?"حذف":"Unlink"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
)}

{/* Promotions section */}
<div style={{marginTop:24,padding:16,background:"linear-gradient(135deg,#fef3c7,#fef9c3)",borderRadius:12,border:"1.5px solid #fcd34d"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <div>
      <div style={{fontSize:14,fontWeight:700,color:"#78350f"}}>🎯 {rtl?"العروض الديناميكية (3 بدينار)":"Dynamic Promotions (Buy 3 for $1)"}</div>
      <div style={{fontSize:11,color:"#92400e",marginTop:4}}>
        {rtl?"للعروض مثل '3 حبات بدينار' حيث الباركود واحد، أنشئها من Loyalty → Promotions":"For deals like '3 for 1 JD' with single barcode, create them in Loyalty → Promotions"}
      </div>
    </div>
    <button onClick={()=>{setTab("admin");setAT("loyalty");setLoyaltyTab("promotions")}}
      style={{padding:"10px 20px",background:"#d97706",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13,whiteSpace:"nowrap"}}>
      🎯 {rtl?"إدارة العروض":"Manage Promotions"}
    </button>
  </div>
</div>

{/* New Pack Modal */}
{newPackMod && (
  <div onClick={()=>setNewPackMod(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:500,maxWidth:600,maxHeight:"90vh",overflow:"auto"}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>+ {rtl?"ربط حزمة جديدة":"New Pack Link"}</h3>
      <p style={{color:"#6b7280",fontSize:12,marginBottom:16}}>
        {rtl?"اختر المنتج الأم (الحبة) ثم أدخل بيانات الحزمة":"Select parent (single unit) then enter pack details"}
      </p>
      
      {/* Parent selector */}
      <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>1. {rtl?"المنتج الأم (الحبة)":"Parent Product (Single)"}</label>
      <select value={newPack.parentId} onChange={e=>setNewPack({...newPack,parentId:e.target.value})}
        style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,marginBottom:14}}>
        <option value="">— {rtl?"اختر المنتج الأم":"Select parent product"} —</option>
        {possibleParents.map(p => (
          <option key={p.id} value={p.id}>{p.n} — {p.p.toFixed(3)} JD ({rtl?"المخزون":"stock"}: {p.s})</option>
        ))}
      </select>
      
      {newPack.parentId && (() => {
        const par = prods.find(p => p.id === newPack.parentId);
        return <div style={{padding:10,background:"#ecfdf5",borderRadius:8,marginBottom:14,fontSize:11,color:"#065f46"}}>
          ✓ {rtl?"الأم":"Parent"}: <strong>{par.n}</strong> · {rtl?"السعر":"Price"}: {par.p.toFixed(3)} JD · {rtl?"المخزون":"Stock"}: {par.s}
        </div>;
      })()}
      
      {/* Pack details */}
      <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>2. {rtl?"باركود الحزمة":"Pack Barcode"}</label>
      <input value={newPack.packBc} onChange={e=>setNewPack({...newPack,packBc:e.target.value})}
        placeholder={rtl?"امسح أو أدخل باركود العلبة":"Scan or type pack barcode"}
        style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,marginBottom:14,fontFamily:"monospace"}}/>
      
      {/* Check if pack barcode already exists */}
      {newPack.packBc && (() => {
        const existing = prods.find(p => p.bc === newPack.packBc);
        if(existing && newPack.parentId !== existing.id) {
          return <div style={{padding:10,background:"#eff6ff",borderRadius:8,marginBottom:14,fontSize:11,color:"#1e40af"}}>
            ℹ️ {rtl?"المنتج موجود":"Product exists"}: <strong>{existing.n}</strong> ({existing.p.toFixed(3)} JD) — {rtl?"سيتم استخدامه كحزمة":"will be used as pack"}
          </div>;
        } else if(!existing && newPack.packBc.length >= 4) {
          return <div style={{padding:10,background:"#fffbeb",borderRadius:8,marginBottom:14,fontSize:11,color:"#92400e"}}>
            ⚠️ {rtl?"المنتج غير موجود — أكمل البيانات وسأنشئه:":"Product doesn't exist — fill in to create it:"}
          </div>;
        }
        return null;
      })()}
      
      {/* If pack doesn't exist, allow creating */}
      {newPack.packBc && !prods.find(p => p.bc === newPack.packBc) && (
        <input value={newPack.packName} onChange={e=>setNewPack({...newPack,packName:e.target.value})}
          placeholder={rtl?"اسم الحزمة (مثل: إندومي علبة 5)":"Pack name (e.g. Indomie Pack of 5)"}
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginBottom:14}}/>
      )}
      
      {/* Pack size & price */}
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <div style={{flex:1}}>
          <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>3. {rtl?"عدد الحبات في الحزمة":"Units per Pack"}</label>
          <input type="number" value={newPack.packSize} onChange={e=>setNewPack({...newPack,packSize:e.target.value})}
            placeholder="5" style={{width:"100%",padding:10,border:"1.5px solid #7c3aed",borderRadius:8,fontSize:18,marginTop:4,fontFamily:"monospace",fontWeight:800,textAlign:"center",color:"#7c3aed"}}/>
        </div>
        <div style={{flex:1}}>
          <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>4. {rtl?"سعر الحزمة":"Pack Price"} (JD)</label>
          <input type="number" step="0.001" value={newPack.packPrice} onChange={e=>setNewPack({...newPack,packPrice:e.target.value})}
            placeholder="2.000" style={{width:"100%",padding:10,border:"1.5px solid #059669",borderRadius:8,fontSize:18,marginTop:4,fontFamily:"monospace",fontWeight:800,textAlign:"center",color:"#059669"}}/>
        </div>
      </div>
      
      {/* Preview */}
      {newPack.parentId && newPack.packSize && newPack.packPrice && (() => {
        const par = prods.find(p => p.id === newPack.parentId);
        const totalSingle = par.p * parseInt(newPack.packSize);
        const savings = totalSingle - parseFloat(newPack.packPrice);
        return <div style={{padding:14,background:"linear-gradient(135deg,#f5f3ff,#ecfdf5)",borderRadius:10,marginBottom:16,fontSize:12,color:"#374151"}}>
          <div style={{fontWeight:700,marginBottom:6,color:"#7c3aed"}}>📦 {rtl?"معاينة":"Preview"}:</div>
          {rtl?<>
            • {newPack.packSize} {rtl?"حبة بسعر":"× single ="} {totalSingle.toFixed(3)} JD<br/>
            • {rtl?"سعر الحزمة":"Pack price"}: <strong>{parseFloat(newPack.packPrice).toFixed(3)}</strong> JD<br/>
            • <strong style={{color:savings>=0?"#059669":"#dc2626"}}>{savings>=0?"التوفير":"⚠ أغلى بـ"}: {Math.abs(savings).toFixed(3)} JD ({Math.abs(savings/totalSingle*100).toFixed(0)}%)</strong>
          </>:<>
            • {newPack.packSize} singles cost: {totalSingle.toFixed(3)} JD<br/>
            • Pack price: <strong>{parseFloat(newPack.packPrice).toFixed(3)}</strong> JD<br/>
            • <strong style={{color:savings>=0?"#059669":"#dc2626"}}>{savings>=0?"Savings":"⚠ More expensive by"}: {Math.abs(savings).toFixed(3)} JD ({Math.abs(savings/totalSingle*100).toFixed(0)}%)</strong>
          </>}
        </div>;
      })()}
      
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setNewPackMod(false)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={savePack} disabled={!newPack.parentId||!newPack.packBc||!newPack.packSize}
          style={{padding:"10px 24px",background:(newPack.parentId&&newPack.packBc&&newPack.packSize)?"linear-gradient(135deg,#7c3aed,#9333ea)":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:(newPack.parentId&&newPack.packBc&&newPack.packSize)?"pointer":"not-allowed"}}>
          ✓ {rtl?"ربط الحزمة":"Link Pack"}
        </button>
      </div>
    </div>
  </div>
)}
</>})()}

{atab==="bulkassign"&&(()=>{
// Bulk Supplier Assignment with Smart Suggestions
const unassigned = prods.filter(p => !p.supplier || p.supplier.trim()==="");
const assigned = prods.filter(p => p.supplier && p.supplier.trim()!=="");

// Build supplier-category map for smart suggestions
const supCatMap = {};
assigned.forEach(p => {
  const sup = p.supplier.trim();
  if(!supCatMap[sup]) supCatMap[sup] = {};
  supCatMap[sup][p.cat] = (supCatMap[sup][p.cat]||0) + 1;
});

// Get list of suppliers (from existing data + suppliers table)
const allSupplierNames = new Set();
assigned.forEach(p => allSupplierNames.add(p.supplier.trim()));
suppliers.forEach(s => allSupplierNames.add(s.name));
const supplierList = Array.from(allSupplierNames).sort();

// Generate suggestion for each unassigned product
const getSuggestion = (cat) => {
  let bestSup = null, maxCount = 0;
  Object.entries(supCatMap).forEach(([sup, cats]) => {
    if(cats[cat] && cats[cat] > maxCount) {
      maxCount = cats[cat];
      bestSup = sup;
    }
  });
  return bestSup;
};

const filteredUnassigned = unassigned.filter(p => {
  if(bulkCatFilter !== "all" && p.cat !== bulkCatFilter) return false;
  if(bulkSearch) {
    const s = bulkSearch.toLowerCase();
    if(!p.n.toLowerCase().includes(s) && !(p.a||"").includes(bulkSearch) && !p.bc.includes(bulkSearch)) return false;
  }
  return true;
});

const categories = [...new Set(unassigned.map(p => p.cat))].sort();
const allFilteredSelected = filteredUnassigned.length > 0 && filteredUnassigned.every(p => bulkSelected.has(p.id));

const applyBulkAssignFn = async () => {
  if(!chosenSupplier || bulkSelected.size === 0) return;
  const ids = Array.from(bulkSelected);
  try {
    for(const id of ids) {
      const pr = prods.find(x => x.id === id);
      if(pr) await DB.upsertProduct({...pr, supplier: chosenSupplier});
    }
    setProds(p => p.map(x => bulkSelected.has(x.id) ? {...x, supplier: chosenSupplier} : x));
    sT(`✓ ${rtl?"تم ربط":"Assigned"} ${ids.length} ${rtl?"منتج":"products"}`, "ok");
    setBulkSelected(new Set());
    setChosenSupplier("");
    setBulkSupplierMod(false);
  } catch(e) { console.error(e); sT("Error", "err"); }
};

const applyAllSuggestions = async () => {
  const groups = {};
  filteredUnassigned.forEach(p => {
    const sugg = suggestions[p.id] !== undefined ? suggestions[p.id] : getSuggestion(p.cat);
    if(sugg) {
      if(!groups[sugg]) groups[sugg] = [];
      groups[sugg].push(p.id);
    }
  });
  let total = 0;
  for(const [sup, ids] of Object.entries(groups)) {
    for(const id of ids) {
      const pr = prods.find(x => x.id === id);
      if(pr) {
        try { await DB.upsertProduct({...pr, supplier: sup}); total++; }
        catch(e) { console.error(e); }
      }
    }
  }
  setProds(p => p.map(x => {
    for(const [sup, ids] of Object.entries(groups)) {
      if(ids.includes(x.id)) return {...x, supplier: sup};
    }
    return x;
  }));
  sT(`✓ ${rtl?"تم ربط":"Assigned"} ${total} ${rtl?"منتج":"products"}`, "ok");
  setShowSuggestions(false);
  setSuggestions({});
};

return <>
<div style={{display:"flex",justifyContent:"space-between",marginBottom:16,alignItems:"center"}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>📦 {rtl?"المنتجات بدون مورد":"Unassigned Products"}</h2>
    <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>
      <strong style={{color:"#dc2626"}}>{unassigned.length}</strong> {rtl?"منتج بدون مورد":"products without supplier"} · 
      <strong style={{color:"#059669"}}> {assigned.length}</strong> {rtl?"منتج مرتبط":"products assigned"}
    </p>
  </div>
  <div style={{display:"flex",gap:8}}>
    <ExportButtons title={rtl?"تقرير ربط الموردين":"Supplier Assignment Report"} getExportData={()=>{
      const headers=[rtl?"الباركود":"Barcode",rtl?"المنتج":"Product",rtl?"الفئة":"Category",rtl?"المورد الحالي":"Current Supplier",rtl?"المقترح":"Suggested"];
      const rows=prods.map(p=>[p.bc,pN(p),p.cat||"—",p.supplier||(rtl?"بدون":"None"),suggestions[p.id]||"—"]);
      const withSup=prods.filter(p=>p.supplier).length;
      const summary=[
        {label:rtl?"إجمالي":"Total",value:prods.length,color:"#1e40af"},
        {label:rtl?"بمورد":"With Supplier",value:withSup,color:"#059669"},
        {label:rtl?"بدون":"Without",value:prods.length-withSup,color:"#dc2626"},
        {label:rtl?"اقتراحات":"Suggestions",value:Object.keys(suggestions).length,color:"#7c3aed"}
      ];
      return {headers,rows,summary,filters:[],showSignatures:false};
    }}/>
    <button onClick={()=>setShowSuggestions(!showSuggestions)} 
      style={{padding:"10px 20px",background:showSuggestions?"#9333ea":"#7c3aed",border:"none",borderRadius:10,
              color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13,boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>
      🧠 {rtl?"اقتراحات ذكية":"Smart Suggestions"}
    </button>
  </div>
</div>

{/* Filters */}
<div style={{display:"flex",gap:8,marginBottom:12,padding:12,background:"#f9fafb",borderRadius:12,border:"1px solid #e5e7eb"}}>
  <input value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)}
    placeholder={rtl?"🔍 بحث بالاسم أو الباركود...":"🔍 Search by name or barcode..."}
    style={{flex:1,padding:"10px 14px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,outline:"none"}}/>
  <select value={bulkCatFilter} onChange={e=>setBulkCatFilter(e.target.value)}
    style={{padding:"10px 14px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,outline:"none",minWidth:150}}>
    <option value="all">{rtl?"كل الفئات":"All Categories"}</option>
    {categories.map(c => <option key={c} value={c}>{c} ({unassigned.filter(p=>p.cat===c).length})</option>)}
  </select>
  {bulkSelected.size > 0 && (
    <button onClick={()=>setBulkSupplierMod(true)}
      style={{padding:"10px 24px",background:"#059669",border:"none",borderRadius:8,
              color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13,boxShadow:"0 2px 8px rgba(5,150,105,.3)"}}>
      ✓ {rtl?"ربط":"Assign"} {bulkSelected.size} {rtl?"منتج":"products"}
    </button>
  )}
</div>

{bulkSelected.size > 0 && (
  <div style={{padding:"10px 14px",background:"#ecfdf5",borderRadius:8,marginBottom:8,
               fontSize:12,color:"#065f46",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <span>✓ <strong>{bulkSelected.size}</strong> {rtl?"محدد":"selected"}</span>
    <button onClick={()=>setBulkSelected(new Set())} 
      style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontWeight:600,fontSize:11}}>
      ✕ {rtl?"إلغاء التحديد":"Clear Selection"}
    </button>
  </div>
)}

{/* Table */}
<div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",overflow:"auto",maxHeight:"60vh"}}>
  <table style={{width:"100%",borderCollapse:"collapse"}}>
    <thead style={{background:"#f9fafb",position:"sticky",top:0,zIndex:1}}>
      <tr>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600,width:40}}>
          <input type="checkbox" checked={allFilteredSelected}
            onChange={e=>{
              const newSel = new Set(bulkSelected);
              if(e.target.checked) filteredUnassigned.forEach(p => newSel.add(p.id));
              else filteredUnassigned.forEach(p => newSel.delete(p.id));
              setBulkSelected(newSel);
            }}/>
        </th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الباركود":"Barcode"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"المنتج":"Product"}</th>
        <th style={{padding:10,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الفئة":"Category"}</th>
        <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"التكلفة":"Cost"}</th>
        <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"السعر":"Price"}</th>
        <th style={{padding:10,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"المخزون":"Stock"}</th>
        {showSuggestions && <th style={{padding:10,textAlign:"left",fontSize:11,color:"#7c3aed",fontWeight:700}}>🧠 {rtl?"المورد المقترح":"Suggested"}</th>}
      </tr>
    </thead>
    <tbody>
      {filteredUnassigned.slice(0,300).map(p => {
        const autoSugg = getSuggestion(p.cat);
        const currentSugg = suggestions[p.id] !== undefined ? suggestions[p.id] : autoSugg;
        return (
          <tr key={p.id} style={{borderTop:"1px solid #f3f4f6",
            background: bulkSelected.has(p.id) ? "#eff6ff" : "#fff"}}>
            <td style={{padding:8}}>
              <input type="checkbox" checked={bulkSelected.has(p.id)}
                onChange={e=>{
                  const newSel = new Set(bulkSelected);
                  if(e.target.checked) newSel.add(p.id);
                  else newSel.delete(p.id);
                  setBulkSelected(newSel);
                }}/>
            </td>
            <td style={{padding:8,fontSize:11,fontFamily:"monospace",color:"#6b7280"}}>{p.bc}</td>
            <td style={{padding:8,fontSize:12,fontWeight:600}}>{rtl ? (p.a||p.n) : p.n}</td>
            <td style={{padding:8,fontSize:11}}>
              <span style={{padding:"3px 8px",background:"#f3f4f6",borderRadius:6,fontSize:10}}>{p.cat}</span>
            </td>
            <td style={{padding:8,fontSize:11,fontFamily:"monospace",textAlign:"right"}}>{p.c.toFixed(3)}</td>
            <td style={{padding:8,fontSize:11,fontFamily:"monospace",textAlign:"right",fontWeight:600}}>{p.p.toFixed(3)}</td>
            <td style={{padding:8,fontSize:11,textAlign:"right",
              color:p.s<30?"#dc2626":"#059669",fontWeight:600}}>{p.s}</td>
            {showSuggestions && (
              <td style={{padding:8,fontSize:11}}>
                <select value={currentSugg||""} onChange={e=>{
                  const newSugg = {...suggestions};
                  if(e.target.value) newSugg[p.id] = e.target.value;
                  else newSugg[p.id] = "";
                  setSuggestions(newSugg);
                }}
                style={{padding:"4px 8px",border:"1px solid "+(currentSugg?"#c4b5fd":"#e5e7eb"),borderRadius:6,
                        background:currentSugg?"#f5f3ff":"#fff",fontSize:11,outline:"none",maxWidth:200,width:"100%"}}>
                  <option value="">— {rtl?"تخطّي":"Skip"} —</option>
                  {supplierList.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
            )}
          </tr>
        );
      })}
    </tbody>
  </table>
  {filteredUnassigned.length > 300 && (
    <div style={{padding:12,textAlign:"center",color:"#6b7280",fontSize:11,background:"#fffbeb"}}>
      {rtl?`يعرض 300 من ${filteredUnassigned.length} — استخدم الفلاتر للتضييق`:`Showing 300 of ${filteredUnassigned.length} — use filters to narrow`}
    </div>
  )}
  {filteredUnassigned.length === 0 && (
    <div style={{padding:40,textAlign:"center",color:"#9ca3af"}}>
      🎉 {rtl?"كل المنتجات مرتبطة بموردين!":"All products assigned!"}
    </div>
  )}
</div>

{/* Apply Suggestions Bar */}
{showSuggestions && filteredUnassigned.some(p => {
  const s = suggestions[p.id] !== undefined ? suggestions[p.id] : getSuggestion(p.cat);
  return s && s !== "";
}) && (
  <div style={{position:"sticky",bottom:0,marginTop:16,padding:16,
               background:"linear-gradient(135deg,#7c3aed,#9333ea)",borderRadius:12,
               display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 -4px 12px rgba(0,0,0,.1)"}}>
    <div style={{color:"#fff"}}>
      <div style={{fontWeight:700,fontSize:14}}>
        🧠 {rtl?"اقتراحات ذكية جاهزة":"Smart Suggestions Ready"}
      </div>
      <div style={{fontSize:11,opacity:.9}}>
        {rtl?"راجع الاقتراحات في الجدول أعلاه ثم اضغط تطبيق":"Review suggestions in the table above, then apply"}
      </div>
    </div>
    <div style={{display:"flex",gap:8}}>
      <button onClick={()=>{setShowSuggestions(false);setSuggestions({})}}
        style={{padding:"10px 20px",background:"rgba(255,255,255,.2)",border:"none",
                borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer"}}>
        {rtl?"إلغاء":"Cancel"}
      </button>
      <button onClick={applyAllSuggestions}
        style={{padding:"10px 24px",background:"#fff",border:"none",
                borderRadius:8,color:"#7c3aed",fontWeight:700,cursor:"pointer"}}>
        ✓ {rtl?"تطبيق كل الاقتراحات":"Apply All Suggestions"}
      </button>
    </div>
  </div>
)}

{/* Bulk Assign Modal */}
{bulkSupplierMod && (
  <div onClick={()=>setBulkSupplierMod(false)}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",
            display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()}
      style={{background:"#fff",borderRadius:16,padding:24,minWidth:400,maxWidth:500}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>
        {rtl?`ربط مورد لـ ${bulkSelected.size} منتج`:`Assign Supplier to ${bulkSelected.size} Products`}
      </h3>
      <p style={{color:"#6b7280",fontSize:13,margin:"0 0 16px"}}>
        {rtl?"كل المنتجات المحددة سيتم ربطها بهذا المورد":"All selected products will be linked to this supplier"}
      </p>
      <select value={chosenSupplier} onChange={e=>setChosenSupplier(e.target.value)}
        style={{width:"100%",padding:12,border:"1.5px solid #e5e7eb",borderRadius:8,
                fontSize:14,outline:"none",marginBottom:16}}>
        <option value="">— {rtl?"اختر مورد":"Select Supplier"} —</option>
        {supplierList.map(s => {
          const count = assigned.filter(p => p.supplier === s).length;
          return <option key={s} value={s}>{s} ({count} {rtl?"منتج":"products"})</option>;
        })}
      </select>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setBulkSupplierMod(false)}
          style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,
                  fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={applyBulkAssignFn} disabled={!chosenSupplier}
          style={{padding:"10px 24px",background:chosenSupplier?"#059669":"#d1d5db",
                  border:"none",borderRadius:8,color:"#fff",fontWeight:700,
                  cursor:chosenSupplier?"pointer":"not-allowed"}}>
          ✓ {rtl?"ربط":"Assign"}
        </button>
      </div>
    </div>
  </div>
)}
</>})()}

{atab==="reconcile"&&(()=>{
// Cash Reconciliation & Daily Closing
const todayDate=new Date().toISOString().slice(0,10);
const todayStart=new Date();todayStart.setHours(0,0,0,0);
const todayTxs=txns.filter(tx=>{try{return new Date(tx.ts)>=todayStart && tx.voidStatus!=="voided"}catch{return false}});
const voidedTxs=txns.filter(tx=>{try{return new Date(tx.ts)>=todayStart && tx.voidStatus==="voided"}catch{return false}});

// Calculate today's totals by payment method
const cashTotal=todayTxs.filter(t=>t.method==="cash").reduce((s,t)=>s+t.tot,0);
const cardTotal=todayTxs.filter(t=>t.method==="card").reduce((s,t)=>s+t.tot,0);
const mobileTotal=todayTxs.filter(t=>t.method==="mobile").reduce((s,t)=>s+t.tot,0);
const totalSales=cashTotal+cardTotal+mobileTotal;

// Per-cashier breakdown
const cashierStats={};
todayTxs.forEach(tx=>{
  const cid=tx.cashierId||0;
  const cname=tx.cashierName||"Unknown";
  if(!cashierStats[cid]) cashierStats[cid]={name:cname,cash:0,card:0,mobile:0,count:0,seqs:[],minSeq:Infinity,maxSeq:0};
  cashierStats[cid].count++;
  cashierStats[cid][tx.method]+=tx.tot;
  cashierStats[cid].seqs.push(tx.seq||0);
  if(tx.seq){
    cashierStats[cid].minSeq=Math.min(cashierStats[cid].minSeq,tx.seq);
    cashierStats[cid].maxSeq=Math.max(cashierStats[cid].maxSeq,tx.seq);
  }
});

// Detect gaps per cashier
const allGaps=[];
Object.entries(cashierStats).forEach(([cid,info])=>{
  const sorted=[...info.seqs].sort((a,b)=>a-b);
  for(let i=1;i<sorted.length;i++){
    if(sorted[i]-sorted[i-1]>1){
      for(let m=sorted[i-1]+1;m<sorted[i];m++){
        allGaps.push({cashier_name:info.name,missing_seq:m});
      }
    }
  }
});

// Today's returns
const todayRet=salesReturns.filter(r=>{try{return new Date(r.created_at).toDateString()===new Date().toDateString()}catch{return false}});
const returnsAmount=todayRet.reduce((s,r)=>s+ +r.total_refund,0);

// Run reconciliation
const runReconciliation=async()=>{
  if(!reconActualCash||isNaN(parseFloat(reconActualCash))){sT("✗ "+(rtl?"أدخل المبلغ النقدي":"Enter cash amount"),"err");return}
  const actual=parseFloat(reconActualCash);
  const diff=actual-cashTotal;
  let status="balanced";
  if(diff>0.01) status="over";
  else if(diff<-0.01) status="short";
  
  try{
    await DB.addReconciliation({
      reconciliation_date:todayDate,
      cashier_id:cu?.id,
      cashier_name:cu?.fn,
      shift_end:new Date().toISOString(),
      system_cash_total:cashTotal,
      system_card_total:cardTotal,
      system_mobile_total:mobileTotal,
      system_total:totalSales,
      transaction_count:todayTxs.length,
      actual_cash_count:actual,
      cash_difference:diff,
      status:status,
      notes:reconNotes,
      reconciled_by:cu?.id,
      reconciled_by_name:cu?.fn
    });
    sT("✓ "+(rtl?"تم تسجيل المطابقة":"Reconciliation saved"),"ok");
    setReconMod(false);setReconActualCash("");setReconNotes("");
  }catch(e){console.error(e);sT("✗ Error","err")}
};

// Save closing report
const saveDailyClosing=async()=>{
  if(!confirm(rtl?"حفظ تقرير الإغلاق اليومي؟":"Save daily closing report?")) return;
  try{
    await DB.saveClosingReport({
      report_date:todayDate,
      total_sales:+totalSales.toFixed(3),
      total_cash_sales:+cashTotal.toFixed(3),
      total_card_sales:+cardTotal.toFixed(3),
      total_mobile_sales:+mobileTotal.toFixed(3),
      transaction_count:todayTxs.length,
      voided_count:voidedTxs.length,
      voided_amount:+voidedTxs.reduce((s,t)=>s+t.tot,0).toFixed(3),
      returns_count:todayRet.length,
      returns_amount:+returnsAmount.toFixed(3),
      expected_cash:+cashTotal.toFixed(3),
      sequence_gaps:allGaps.length,
      gap_details:allGaps.length>0?JSON.stringify(allGaps):null,
      closed_by:cu?.id,
      closed_by_name:cu?.fn
    });
    const newReports=await DB.getClosingReports();
    setClosingReports(newReports);
    sT("✓ "+(rtl?"تم حفظ التقرير":"Report saved"),"ok");
  }catch(e){console.error(e);sT("✗ "+e.message,"err")}
};

const printClosingReport=()=>{
  const w=window.open("","_blank","width=800,height=900");
  if(!w) return;
  let html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily Closing</title>
  <style>
    body{font-family:Arial,sans-serif;padding:20px;color:#1f2937;max-width:600px;margin:0 auto}
    h1{color:#059669;text-align:center;border-bottom:3px solid #059669;padding-bottom:10px}
    h2{margin-top:20px;padding:8px 12px;background:#f3f4f6;border-radius:6px}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
    th{background:#f3f4f6;padding:8px;text-align:left;border:1px solid #d1d5db}
    td{padding:8px;border:1px solid #e5e7eb}
    .total{font-weight:bold;background:#ecfdf5;font-size:14px}
    .gap{background:#fef2f2;color:#dc2626}
    .meta{color:#6b7280;font-size:11px;text-align:center;margin-bottom:16px}
    @media print{body{padding:10px}}
  </style></head><body>
  <h1>📊 ${rtl?"تقرير الإغلاق اليومي":"Daily Closing Report"}</h1>
  <div class="meta">3045 Super Grocery · ${new Date().toLocaleString()} · ${cu?.fn||""}</div>
  
  <h2>💰 ${rtl?"إجمالي المبيعات":"Sales Summary"}</h2>
  <table>
    <tr><td>${rtl?"نقدي":"Cash"}</td><td style="text-align:right">${cashTotal.toFixed(3)} JD</td><td style="text-align:right">${todayTxs.filter(t=>t.method==="cash").length} ${rtl?"فاتورة":"txns"}</td></tr>
    <tr><td>${rtl?"فيزا":"Card"}</td><td style="text-align:right">${cardTotal.toFixed(3)} JD</td><td style="text-align:right">${todayTxs.filter(t=>t.method==="card").length} ${rtl?"فاتورة":"txns"}</td></tr>
    <tr><td>${rtl?"كليك":"Mobile"}</td><td style="text-align:right">${mobileTotal.toFixed(3)} JD</td><td style="text-align:right">${todayTxs.filter(t=>t.method==="mobile").length} ${rtl?"فاتورة":"txns"}</td></tr>
    <tr class="total"><td>${rtl?"الإجمالي":"TOTAL"}</td><td style="text-align:right">${totalSales.toFixed(3)} JD</td><td style="text-align:right">${todayTxs.length} ${rtl?"فاتورة":"txns"}</td></tr>
  </table>
  
  <h2>👥 ${rtl?"حسب الكاشير":"Per Cashier"}</h2>
  <table>
    <thead><tr><th>${rtl?"الكاشير":"Cashier"}</th><th>${rtl?"عدد":"Count"}</th><th>${rtl?"نقدي":"Cash"}</th><th>${rtl?"فيزا":"Card"}</th><th>${rtl?"كليك":"Mobile"}</th><th>${rtl?"النطاق":"Range"}</th></tr></thead>
    <tbody>
    ${Object.values(cashierStats).map(c=>`<tr><td>${c.name}</td><td>${c.count}</td><td>${c.cash.toFixed(3)}</td><td>${c.card.toFixed(3)}</td><td>${c.mobile.toFixed(3)}</td><td style="font-family:monospace;font-size:10px">#${c.minSeq===Infinity?"-":c.minSeq} → #${c.maxSeq||"-"}</td></tr>`).join("")}
    </tbody>
  </table>
  
  <h2>${allGaps.length>0?"🔴":"✅"} ${rtl?"فحص التسلسل":"Sequence Check"}</h2>
  ${allGaps.length===0?
    `<p style="color:#059669;font-weight:bold">✓ ${rtl?"لا توجد فجوات — جميع الفواتير مسجلة":"No gaps — all receipts recorded"}</p>`:
    `<table><thead><tr><th>${rtl?"الكاشير":"Cashier"}</th><th>${rtl?"الرقم المفقود":"Missing #"}</th></tr></thead><tbody>
    ${allGaps.map(g=>`<tr class="gap"><td>${g.cashier_name}</td><td>#${g.missing_seq}</td></tr>`).join("")}
    </tbody></table>`
  }
  
  <h2>⚠️ ${rtl?"الإلغاءات والمرتجعات":"Voids & Returns"}</h2>
  <table>
    <tr><td>${rtl?"الفواتير الملغاة":"Voided Transactions"}</td><td>${voidedTxs.length}</td><td>${voidedTxs.reduce((s,t)=>s+t.tot,0).toFixed(3)} JD</td></tr>
    <tr><td>${rtl?"المرتجعات":"Returns"}</td><td>${todayRet.length}</td><td>${returnsAmount.toFixed(3)} JD</td></tr>
  </table>
  
  <div style="margin-top:30px;padding:12px;background:#f9fafb;border-radius:6px;font-size:11px;color:#6b7280">
    ${rtl?"تم إنشاء هذا التقرير تلقائياً":"This report was generated automatically"} · ${rtl?"يرجى الاحتفاظ به للأرشيف":"Please archive for records"}
  </div>
  
  <script>setTimeout(()=>window.print(),500)</script>
  </body></html>`;
  w.document.write(html);w.document.close();
};

return <>
{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>💰 {rtl?"مطابقة الصندوق والإغلاق اليومي":"Cash Reconciliation & Daily Closing"}</h2>
    <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>
      {new Date().toLocaleDateString(rtl?"ar":"en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
    </p>
  </div>
  <div style={{display:"flex",gap:8}}>
    <ExportButtons title={rtl?"تقرير مطابقة الصندوق":"Cash Reconciliation Report"} getExportData={()=>{
      const headers=[rtl?"الكاشير":"Cashier",rtl?"عدد الفواتير":"Count",rtl?"نقدي":"Cash",rtl?"فيزا":"Card",rtl?"كليك":"Mobile",rtl?"نطاق الأرقام":"Seq Range"];
      const rows=Object.values(cashierStats).map(c=>[c.name,c.count,c.cash.toFixed(3),c.card.toFixed(3),c.mobile.toFixed(3),"#"+(c.minSeq===Infinity?"-":c.minSeq)+" → #"+(c.maxSeq||"-")]);
      const summary=[
        {label:rtl?"إجمالي":"Total",value:fm(totalSales),color:"#1e40af"},
        {label:rtl?"نقدي":"Cash",value:fm(cashTotal),color:"#059669"},
        {label:rtl?"فيزا+كليك":"Card+Mobile",value:fm(cardTotal+mobileTotal),color:"#7c3aed"},
        {label:rtl?"الفجوات":"Gaps",value:allGaps.length,color:allGaps.length>0?"#dc2626":"#059669"}
      ];
      return {headers,rows,summary,filters:[(rtl?"التاريخ":"Date")+": "+todayDate],showSignatures:true};
    }}/>
    <button onClick={()=>{setReconMod(true);setReconActualCash("");setReconNotes("")}}
      style={{padding:"10px 20px",background:"linear-gradient(135deg,#059669,#10b981)",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      💰 {rtl?"عدّ الصندوق":"Count Drawer"}
    </button>
    <button onClick={printClosingReport}
      style={{padding:"10px 20px",background:"#7c3aed",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      🖨 {rtl?"طباعة التقرير":"Print Report"}
    </button>
    <button onClick={saveDailyClosing}
      style={{padding:"10px 20px",background:"#dc2626",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      🔒 {rtl?"إغلاق اليوم":"Close Day"}
    </button>
  </div>
</div>

{/* Gap Alert */}
{allGaps.length>0 && (
  <div style={{padding:14,background:"linear-gradient(135deg,#fef2f2,#fee2e2)",border:"2px solid #dc2626",borderRadius:12,marginBottom:14}}>
    <div style={{fontSize:14,fontWeight:800,color:"#991b1b",marginBottom:6}}>🔴 {rtl?"تنبيه: فجوات في الترقيم!":"ALERT: Gaps in Sequence Numbering!"}</div>
    <div style={{fontSize:12,color:"#7f1d1d",marginBottom:8}}>
      {rtl?`تم اكتشاف ${allGaps.length} فجوة — هذا يعني فواتير قد تكون فُقدت أو حُذفت يدوياً`:`Detected ${allGaps.length} gaps — receipts may have been lost or deleted manually`}
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {allGaps.slice(0,10).map((g,i)=>(
        <span key={i} style={{padding:"4px 10px",background:"#dc2626",color:"#fff",borderRadius:6,fontSize:11,fontFamily:"monospace",fontWeight:700}}>
          {g.cashier_name} → #{g.missing_seq}
        </span>
      ))}
      {allGaps.length>10 && <span style={{fontSize:11,color:"#7f1d1d",fontWeight:600,padding:"4px 10px"}}>+{allGaps.length-10} {rtl?"أخرى":"more"}</span>}
    </div>
  </div>
)}

{/* Today Summary Cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
  <div style={{padding:16,background:"linear-gradient(135deg,#ecfdf5,#fff)",border:"1.5px solid #6ee7b7",borderRadius:12}}>
    <div style={{fontSize:11,color:"#065f46",fontWeight:600}}>💵 {rtl?"نقدي":"Cash"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#059669",fontFamily:"monospace",marginTop:4}}>{cashTotal.toFixed(3)}</div>
    <div style={{fontSize:10,color:"#065f46"}}>{todayTxs.filter(t=>t.method==="cash").length} {rtl?"فاتورة":"txns"}</div>
  </div>
  <div style={{padding:16,background:"linear-gradient(135deg,#eff6ff,#fff)",border:"1.5px solid #93c5fd",borderRadius:12}}>
    <div style={{fontSize:11,color:"#1e40af",fontWeight:600}}>💳 {rtl?"فيزا":"Card"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#2563eb",fontFamily:"monospace",marginTop:4}}>{cardTotal.toFixed(3)}</div>
    <div style={{fontSize:10,color:"#1e40af"}}>{todayTxs.filter(t=>t.method==="card").length} {rtl?"فاتورة":"txns"}</div>
  </div>
  <div style={{padding:16,background:"linear-gradient(135deg,#f5f3ff,#fff)",border:"1.5px solid #c4b5fd",borderRadius:12}}>
    <div style={{fontSize:11,color:"#5b21b6",fontWeight:600}}>📱 {rtl?"كليك":"Mobile"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#7c3aed",fontFamily:"monospace",marginTop:4}}>{mobileTotal.toFixed(3)}</div>
    <div style={{fontSize:10,color:"#5b21b6"}}>{todayTxs.filter(t=>t.method==="mobile").length} {rtl?"فاتورة":"txns"}</div>
  </div>
  <div style={{padding:16,background:"linear-gradient(135deg,#fef3c7,#fff)",border:"1.5px solid #fcd34d",borderRadius:12}}>
    <div style={{fontSize:11,color:"#78350f",fontWeight:600}}>📊 {rtl?"الإجمالي":"Total"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#d97706",fontFamily:"monospace",marginTop:4}}>{totalSales.toFixed(3)}</div>
    <div style={{fontSize:10,color:"#78350f"}}>{todayTxs.length} {rtl?"فاتورة":"txns"}</div>
  </div>
</div>

{/* Per-Cashier Breakdown */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,marginBottom:14,overflow:"hidden"}}>
  <div style={{padding:"10px 14px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14}}>
    👥 {rtl?"أداء الكاشير اليوم":"Cashier Performance Today"}
  </div>
  {Object.keys(cashierStats).length===0?(
    <div style={{padding:30,textAlign:"center",color:"#9ca3af"}}>{rtl?"لا توجد مبيعات اليوم بعد":"No sales today yet"}</div>
  ):(
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead style={{background:"#f9fafb"}}>
        <tr>
          <th style={{padding:8,textAlign:"left",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الكاشير":"Cashier"}</th>
          <th style={{padding:8,textAlign:"right",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"الفواتير":"Count"}</th>
          <th style={{padding:8,textAlign:"right",fontSize:11,color:"#065f46",fontWeight:600}}>{rtl?"نقدي":"Cash"}</th>
          <th style={{padding:8,textAlign:"right",fontSize:11,color:"#1e40af",fontWeight:600}}>{rtl?"فيزا":"Card"}</th>
          <th style={{padding:8,textAlign:"right",fontSize:11,color:"#5b21b6",fontWeight:600}}>{rtl?"كليك":"Mobile"}</th>
          <th style={{padding:8,textAlign:"center",fontSize:11,color:"#6b7280",fontWeight:600}}>{rtl?"النطاق":"Seq Range"}</th>
        </tr>
      </thead>
      <tbody>
        {Object.values(cashierStats).map((c,i)=>(
          <tr key={i} style={{borderTop:"1px solid #f3f4f6"}}>
            <td style={{padding:10,fontWeight:700}}>👤 {c.name}</td>
            <td style={{padding:10,textAlign:"right",fontFamily:"monospace",fontWeight:700}}>{c.count}</td>
            <td style={{padding:10,textAlign:"right",fontFamily:"monospace",color:"#059669"}}>{c.cash.toFixed(3)}</td>
            <td style={{padding:10,textAlign:"right",fontFamily:"monospace",color:"#2563eb"}}>{c.card.toFixed(3)}</td>
            <td style={{padding:10,textAlign:"right",fontFamily:"monospace",color:"#7c3aed"}}>{c.mobile.toFixed(3)}</td>
            <td style={{padding:10,textAlign:"center",fontSize:10,fontFamily:"monospace",color:"#6b7280"}}>
              #{c.minSeq===Infinity?"-":c.minSeq} → #{c.maxSeq||"-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>

{/* Voided + Returns */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
  <div style={{padding:14,background:"#fff",border:"1.5px solid "+(voidedTxs.length>0?"#fca5a5":"#e5e7eb"),borderRadius:12}}>
    <div style={{fontWeight:700,fontSize:13,marginBottom:6,color:"#374151"}}>⚠️ {rtl?"الفواتير الملغاة اليوم":"Voided Today"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#dc2626",fontFamily:"monospace"}}>{voidedTxs.length}</div>
    <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"بإجمالي":"Amount"}: {voidedTxs.reduce((s,t)=>s+t.tot,0).toFixed(3)} JD</div>
  </div>
  <div style={{padding:14,background:"#fff",border:"1.5px solid "+(todayRet.length>0?"#fca5a5":"#e5e7eb"),borderRadius:12}}>
    <div style={{fontWeight:700,fontSize:13,marginBottom:6,color:"#374151"}}>↩️ {rtl?"المرتجعات اليوم":"Returns Today"}</div>
    <div style={{fontSize:24,fontWeight:800,color:"#dc2626",fontFamily:"monospace"}}>{todayRet.length}</div>
    <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"بإجمالي":"Amount"}: {returnsAmount.toFixed(3)} JD</div>
  </div>
</div>

{/* Recent Closing Reports */}
{closingReports.length>0 && (
  <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,overflow:"hidden"}}>
    <div style={{padding:"10px 14px",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14}}>
      📚 {rtl?"تقارير الإغلاق السابقة":"Previous Closing Reports"}
    </div>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
      <thead style={{background:"#f9fafb"}}>
        <tr>
          <th style={{padding:8,textAlign:"left",color:"#6b7280"}}>{rtl?"التاريخ":"Date"}</th>
          <th style={{padding:8,textAlign:"right",color:"#6b7280"}}>{rtl?"المبيعات":"Sales"}</th>
          <th style={{padding:8,textAlign:"right",color:"#6b7280"}}>{rtl?"الفواتير":"Txns"}</th>
          <th style={{padding:8,textAlign:"right",color:"#dc2626"}}>{rtl?"الفجوات":"Gaps"}</th>
          <th style={{padding:8,textAlign:"right",color:"#6b7280"}}>{rtl?"الفرق":"Cash Diff"}</th>
          <th style={{padding:8,textAlign:"left",color:"#6b7280"}}>{rtl?"أُغلق بواسطة":"Closed By"}</th>
        </tr>
      </thead>
      <tbody>
        {closingReports.slice(0,15).map(r=>(
          <tr key={r.id} style={{borderTop:"1px solid #f3f4f6"}}>
            <td style={{padding:8,fontFamily:"monospace",fontWeight:600}}>{r.report_date}</td>
            <td style={{padding:8,textAlign:"right",fontFamily:"monospace",color:"#059669",fontWeight:700}}>{(+r.total_sales).toFixed(3)}</td>
            <td style={{padding:8,textAlign:"right",fontFamily:"monospace"}}>{r.transaction_count}</td>
            <td style={{padding:8,textAlign:"right",fontFamily:"monospace",color:r.sequence_gaps>0?"#dc2626":"#059669",fontWeight:700}}>
              {r.sequence_gaps>0?"🔴 "+r.sequence_gaps:"✓"}
            </td>
            <td style={{padding:8,textAlign:"right",fontFamily:"monospace",color:Math.abs(+r.cash_difference)<0.01?"#059669":"#dc2626",fontWeight:700}}>
              {(+r.cash_difference).toFixed(3)}
            </td>
            <td style={{padding:8}}>{r.closed_by_name||"—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}

{/* Reconciliation Modal */}
{reconMod && (
  <div onClick={()=>setReconMod(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:450,maxWidth:520}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>💰 {rtl?"عدّ الصندوق":"Count Cash Drawer"}</h3>
      <p style={{color:"#6b7280",fontSize:12,marginBottom:16}}>
        {rtl?"عدّ النقد الفعلي في الدرج وأدخله أدناه — النظام سيقارنه بالمتوقع":"Count actual cash in drawer and enter below — system will compare with expected"}
      </p>
      
      <div style={{padding:14,background:"#ecfdf5",borderRadius:10,marginBottom:14}}>
        <div style={{fontSize:11,color:"#065f46",fontWeight:600,marginBottom:4}}>{rtl?"المتوقع (حسب النظام)":"Expected (per system)"}</div>
        <div style={{fontSize:28,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{cashTotal.toFixed(3)} JD</div>
        <div style={{fontSize:10,color:"#065f46"}}>{todayTxs.filter(t=>t.method==="cash").length} {rtl?"فاتورة نقدية":"cash transactions"}</div>
      </div>
      
      <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>{rtl?"النقد الفعلي في الصندوق":"Actual Cash in Drawer"}</label>
      <input type="number" step="0.001" value={reconActualCash} onChange={e=>setReconActualCash(e.target.value)}
        autoFocus placeholder="0.000"
        style={{width:"100%",padding:14,border:"2px solid #059669",borderRadius:10,fontSize:24,marginTop:4,marginBottom:12,fontFamily:"monospace",fontWeight:800,textAlign:"center",color:"#059669"}}/>
      
      {reconActualCash && !isNaN(parseFloat(reconActualCash)) && (() => {
        const diff=parseFloat(reconActualCash)-cashTotal;
        const ok=Math.abs(diff)<0.01;
        return <div style={{padding:12,borderRadius:10,marginBottom:12,
          background:ok?"#ecfdf5":diff>0?"#fffbeb":"#fef2f2",
          border:"2px solid "+(ok?"#6ee7b7":diff>0?"#fcd34d":"#fca5a5")}}>
          <div style={{fontSize:11,fontWeight:600,color:"#374151"}}>{rtl?"الفرق":"Difference"}</div>
          <div style={{fontSize:24,fontWeight:800,fontFamily:"monospace",color:ok?"#059669":diff>0?"#d97706":"#dc2626"}}>
            {diff>0?"+":""}{diff.toFixed(3)} JD
          </div>
          <div style={{fontSize:11,fontWeight:600,marginTop:4,color:ok?"#059669":diff>0?"#d97706":"#dc2626"}}>
            {ok?"✓ "+(rtl?"مطابق":"Balanced"):diff>0?"⚠️ "+(rtl?"زيادة":"OVER"):"🔴 "+(rtl?"نقص":"SHORT")}
          </div>
        </div>;
      })()}
      
      <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>{rtl?"ملاحظات (اختياري)":"Notes (optional)"}</label>
      <textarea value={reconNotes} onChange={e=>setReconNotes(e.target.value)}
        placeholder={rtl?"سبب الفرق، ملاحظات...":"Reason for difference, notes..."}
        rows={2} style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,marginBottom:16,fontFamily:"inherit",resize:"none"}}/>
      
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setReconMod(false)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={runReconciliation} disabled={!reconActualCash}
          style={{padding:"10px 24px",background:reconActualCash?"linear-gradient(135deg,#059669,#10b981)":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:reconActualCash?"pointer":"not-allowed"}}>
          ✓ {rtl?"حفظ المطابقة":"Save Reconciliation"}
        </button>
      </div>
    </div>
  </div>
)}
</>})()}

{/* ━━━━ STOCKTAKE ADMIN SCREEN ━━━━ */}
{atab==="stocktake"&&(()=>{
  // Compute stats for each session
  const sessionStats = (session) => {
    const items = session.id === stocktakeSessionDetail?.id ? stocktakeSessionDetail.items : [];
    // Use counts from state if detail is loaded, else use a count query later
    return {total: items.length, matched: items.filter(i=>i.status==="match").length, variances: items.filter(i=>i.status==="variance").length, unregistered: items.filter(i=>i.status==="unregistered").length};
  };
  
  return <>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <div>
        <h2 style={{fontSize:20,fontWeight:800,margin:0}}>📋 {rtl?"إدارة جلسات الجرد":"Stocktake Sessions Management"}</h2>
        <p style={{color:"#6b7280",fontSize:12,margin:"4px 0 0"}}>
          {rtl?"مراجعة واعتماد نتائج الجرد":"Review and approve stocktake results"}
        </p>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={startStocktake} style={{padding:"10px 18px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",color:"#fff",border:"none",borderRadius:10,fontSize:12,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>
          ➕ {rtl?"بدء جلسة جرد":"Start New Session"}
        </button>
        <button onClick={async()=>{const s=await DB.getStocktakeSessions();setStocktakeSessions(s);sT("✓ Refreshed","ok")}} style={{padding:"10px 14px",background:"#2563eb",color:"#fff",border:"none",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer"}}>🔄</button>
      </div>
    </div>
    
    {/* KPI Cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
      <div className="dc" style={{borderLeft:"4px solid #7c3aed"}}>
        <div className="dcl">{rtl?"إجمالي الجلسات":"Total Sessions"}</div>
        <div className="dcv" style={{color:"#7c3aed"}}>{stocktakeSessions.length}</div>
      </div>
      <div className="dc" style={{borderLeft:"4px solid #f59e0b"}}>
        <div className="dcl">{rtl?"قيد التنفيذ":"In Progress"}</div>
        <div className="dcv" style={{color:"#d97706"}}>{stocktakeSessions.filter(s=>s.status==="in_progress").length}</div>
      </div>
      <div className="dc" style={{borderLeft:"4px solid #2563eb"}}>
        <div className="dcl">{rtl?"مكتملة":"Completed"}</div>
        <div className="dcv b">{stocktakeSessions.filter(s=>s.status==="completed").length}</div>
      </div>
      <div className="dc" style={{borderLeft:"4px solid #059669"}}>
        <div className="dcl">{rtl?"معتمدة":"Approved"}</div>
        <div className="dcv g">{stocktakeSessions.filter(s=>s.status==="approved").length}</div>
      </div>
    </div>
    
    {/* Sessions Table */}
    {stocktakeSessions.length === 0 ? (
      <div style={{padding:40,textAlign:"center",color:"#9ca3af",background:"#f9fafb",borderRadius:12}}>
        <div style={{fontSize:48,marginBottom:8}}>📋</div>
        <div style={{fontWeight:700}}>{rtl?"لا توجد جلسات جرد بعد":"No stocktake sessions yet"}</div>
        <div style={{fontSize:11,marginTop:6}}>{rtl?"اضغط 'بدء جلسة جرد' للبدء":"Click 'Start New Session' to begin"}</div>
      </div>
    ) : (
      <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
            <tr>
              <th style={{padding:10,textAlign:"left",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"رقم الجلسة":"Session #"}</th>
              <th style={{padding:10,textAlign:"left",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"الموظف":"Started By"}</th>
              <th style={{padding:10,textAlign:"left",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"البداية":"Started"}</th>
              <th style={{padding:10,textAlign:"left",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"المدة":"Duration"}</th>
              <th style={{padding:10,textAlign:"center",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"الحالة":"Status"}</th>
              <th style={{padding:10,textAlign:"right",fontSize:11,color:"#374151",fontWeight:700}}>{rtl?"الإجراء":"Action"}</th>
            </tr>
          </thead>
          <tbody>
            {stocktakeSessions.map(s => {
              const isActive = activeStocktake?.id === s.id;
              const startTime = new Date(s.started_at);
              const endTime = s.completed_at ? new Date(s.completed_at) : new Date();
              const mins = Math.floor((endTime - startTime) / 60000);
              const duration = mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
              const statusColor = s.status==="approved"?"#059669":s.status==="completed"?"#2563eb":s.status==="in_progress"?"#d97706":"#dc2626";
              const statusBg = s.status==="approved"?"#ecfdf5":s.status==="completed"?"#eff6ff":s.status==="in_progress"?"#fffbeb":"#fef2f2";
              const statusLabel = s.status==="approved"?(rtl?"معتمدة ✓":"Approved ✓"):s.status==="completed"?(rtl?"مكتملة":"Completed"):s.status==="in_progress"?(rtl?"قيد التنفيذ":"In Progress"):(rtl?"مرفوضة":"Rejected");
              return (
                <tr key={s.id} style={{borderTop:"1px solid #f3f4f6"}}>
                  <td style={{padding:10}}>
                    <div style={{fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}>{s.session_code}</div>
                    {isActive && <span style={{padding:"2px 6px",background:"#d97706",color:"#fff",borderRadius:4,fontSize:9,fontWeight:700,marginTop:3,display:"inline-block"}}>🟢 {rtl?"نشطة حالياً":"Currently Active"}</span>}
                  </td>
                  <td style={{padding:10,fontSize:12,fontWeight:600,color:"#2563eb"}}>{s.started_by_name}</td>
                  <td style={{padding:10,fontSize:11}}>
                    {startTime.toLocaleDateString()}<br/>
                    <span style={{color:"#9ca3af"}}>{startTime.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</span>
                  </td>
                  <td style={{padding:10,fontSize:11,fontFamily:"monospace",fontWeight:700}}>{duration}</td>
                  <td style={{padding:10,textAlign:"center"}}>
                    <span style={{padding:"4px 10px",background:statusBg,color:statusColor,borderRadius:6,fontSize:10,fontWeight:700}}>{statusLabel}</span>
                    {s.approved_by_name && <div style={{fontSize:9,color:"#059669",marginTop:3}}>✓ {s.approved_by_name}</div>}
                  </td>
                  <td style={{padding:10,textAlign:"right"}}>
                    <div style={{display:"flex",gap:4,justifyContent:"flex-end",flexWrap:"wrap"}}>
                      {s.status==="in_progress" && s.started_by === cu?.id && (
                        <button onClick={()=>resumeStocktake(s)} style={{padding:"5px 10px",background:"#f59e0b",color:"#fff",border:"none",borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer"}}>▶ {rtl?"استئناف":"Resume"}</button>
                      )}
                      <button onClick={()=>openStocktakeSessionDetail(s)} style={{padding:"5px 10px",background:"#2563eb",color:"#fff",border:"none",borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer"}}>👁 {rtl?"تفاصيل":"Details"}</button>
                      {cu.role==="admin" && s.status==="in_progress" && (
                        <button onClick={async()=>{
                          if(!confirm(rtl?"حذف هذه الجلسة وكل بياناتها؟":"Delete this session and all its data?"))return;
                          try{await DB.deleteStocktakeSession(s.id);setStocktakeSessions(prev=>prev.filter(x=>x.id!==s.id));sT("✓ "+(rtl?"تم الحذف":"Deleted"),"ok")}catch(e){console.error(e)}
                        }} style={{padding:"5px 8px",background:"#dc2626",color:"#fff",border:"none",borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer"}}>✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </>;
})()}

{atab==="audit"&&(()=>{
// Smart Audit System — 13 checks
const today3 = new Date(); today3.setHours(0,0,0,0);
const in30 = new Date(today3.getTime() + 30*86400000);
const ago30 = new Date(today3.getTime() - 30*86400000);

// Build sales map (product → last sold date, total qty)
const lastSold = {}; const totalSold = {};
txns.forEach(tx => {
  const txDate = new Date(tx.created_at || tx.date || tx.ts || Date.now());
  tx.items.forEach(i => {
    if(!lastSold[i.id] || txDate > lastSold[i.id]) lastSold[i.id] = txDate;
    totalSold[i.id] = (totalSold[i.id]||0) + i.qty;
  });
});

// Calculate category averages for "abnormal price in category"
const catPrices = {};
prods.forEach(p => {
  if(!p.cat || !p.p) return;
  if(!catPrices[p.cat]) catPrices[p.cat] = [];
  catPrices[p.cat].push(p.p);
});
const catAvg = {};
Object.entries(catPrices).forEach(([k,arr]) => {
  catAvg[k] = arr.reduce((a,b)=>a+b,0)/arr.length;
});

// Detect duplicate barcodes
const bcCounts = {};
prods.forEach(p => {
  if(!p.bc) return;
  bcCounts[p.bc] = (bcCounts[p.bc]||0)+1;
});

// Detect similar names (simple: same first 8 chars after lowercase)
const nameKeys = {};
prods.forEach(p => {
  const k = (p.n||"").toLowerCase().replace(/\s+/g,"").substring(0,10);
  if(k.length < 4) return;
  if(!nameKeys[k]) nameKeys[k] = [];
  nameKeys[k].push(p);
});
const similarNames = Object.values(nameKeys).filter(g => g.length > 1);

// Run all 13 checks
const issues = {critical:[], warning:[], info:[]};

prods.forEach(p => {
  const expDays = p.exp ? Math.ceil((new Date(p.exp) - today3) / 86400000) : null;
  const margin = p.p - p.c;
  const marginPct = p.c > 0 ? ((p.p - p.c) / p.c * 100) : 0;
  const lastSoldDate = lastSold[p.id];
  const daysSinceSold = lastSoldDate ? Math.floor((today3 - lastSoldDate) / 86400000) : null;
  
  // 🔴 CRITICAL
  if(p.c > 0 && p.p < p.c) issues.critical.push({type:"price_below_cost",product:p,detail:`${rtl?"السعر":"Price"} ${p.p.toFixed(3)} < ${rtl?"التكلفة":"Cost"} ${p.c.toFixed(3)}`,fix:"price"});
  if(p.c === 0 || p.p === 0) issues.critical.push({type:"zero_value",product:p,detail:p.c===0?(rtl?"التكلفة = 0":"Cost = 0"):(rtl?"السعر = 0":"Price = 0"),fix:p.c===0?"cost":"price"});
  if(expDays !== null && expDays <= 0) issues.critical.push({type:"expired",product:p,detail:`${rtl?"منتهي منذ":"Expired"} ${Math.abs(expDays)} ${rtl?"يوم":"days"}`,fix:"expiry"});
  
  // 🟡 WARNING
  if(p.c > 0 && marginPct > 200) issues.warning.push({type:"high_margin",product:p,detail:`${rtl?"هامش":"Margin"} ${marginPct.toFixed(0)}% (>200%)`,fix:"price"});
  if(p.c > 0 && marginPct < 5 && marginPct >= 0) issues.warning.push({type:"low_margin",product:p,detail:`${rtl?"هامش":"Margin"} ${marginPct.toFixed(1)}% (<5%)`,fix:"price"});
  if(p.cat && catAvg[p.cat] && (p.p > catAvg[p.cat]*3 || p.p < catAvg[p.cat]*0.2) && p.p > 0) {
    issues.warning.push({type:"abnormal_price",product:p,detail:`${rtl?"متوسط الفئة":"Cat avg"} ${catAvg[p.cat].toFixed(3)}, ${rtl?"السعر":"price"} ${p.p.toFixed(3)}`,fix:"price"});
  }
  if(p.bc && bcCounts[p.bc] > 1) issues.warning.push({type:"duplicate_barcode",product:p,detail:`${rtl?"باركود مكرر":"Duplicate barcode"} (${bcCounts[p.bc]})`,fix:"barcode"});
  if(expDays !== null && expDays > 0 && expDays <= 30) issues.warning.push({type:"near_expiry",product:p,detail:`${rtl?"ينتهي خلال":"Expires in"} ${expDays} ${rtl?"يوم":"days"}`,fix:"expiry"});
  if(p.s > 1000) issues.warning.push({type:"large_stock",product:p,detail:`${rtl?"مخزون كبير":"Large stock"}: ${p.s}`,fix:"stock"});
  
  // 🟢 INFO
  if(!p.a || p.a.trim() === "") issues.info.push({type:"missing_ar",product:p,detail:rtl?"مفقود اسم عربي":"Missing Arabic name",fix:"name_ar"});
  if(!p.cat || p.cat.trim() === "") issues.info.push({type:"missing_category",product:p,detail:rtl?"مفقود فئة":"Missing category",fix:"category"});
  if(!p.supplier || p.supplier.trim() === "") issues.info.push({type:"missing_supplier",product:p,detail:rtl?"مفقود مورد":"Missing supplier",fix:"supplier"});
  if(p.s > 0 && daysSinceSold !== null && daysSinceSold > 30) issues.info.push({type:"slow_velocity",product:p,detail:`${rtl?"لم يُبَع منذ":"Not sold for"} ${daysSinceSold} ${rtl?"يوم":"days"}`,fix:"slow",totalSold:totalSold[p.id]||0});
  if(p.s > 0 && !lastSoldDate && p.created_at) issues.info.push({type:"never_sold",product:p,detail:rtl?"لم يُبَع أبداً":"Never sold",fix:"slow"});
});

// Similar names
similarNames.forEach(g => {
  g.forEach(p => issues.warning.push({type:"similar_name",product:p,detail:`${rtl?"اسم مشابه لـ":"Similar to"}: ${g.filter(x=>x.id!==p.id).map(x=>x.n).join(", ")}`,fix:"name"}));
});

// Apply filter
const allIssues = auditFilter==="critical"?issues.critical:auditFilter==="warning"?issues.warning:auditFilter==="info"?issues.info:[...issues.critical,...issues.warning,...issues.info];

// Group by type
const byType = {};
allIssues.forEach(i => {
  if(!byType[i.type]) byType[i.type] = [];
  byType[i.type].push(i);
});

const TYPE_LABELS = {
  price_below_cost: {ar:"سعر بيع أقل من التكلفة",en:"Price below cost",icon:"🔴"},
  zero_value: {ar:"تكلفة أو سعر = صفر",en:"Zero cost or price",icon:"🔴"},
  expired: {ar:"منتهي الصلاحية",en:"Expired",icon:"🔴"},
  high_margin: {ar:"هامش ربح مرتفع جداً",en:"High margin (>200%)",icon:"🟡"},
  low_margin: {ar:"هامش ربح منخفض",en:"Low margin (<5%)",icon:"🟡"},
  abnormal_price: {ar:"سعر شاذ في الفئة",en:"Abnormal price for category",icon:"🟡"},
  duplicate_barcode: {ar:"باركود مكرر",en:"Duplicate barcode",icon:"🟡"},
  near_expiry: {ar:"صلاحية قريبة (30 يوم)",en:"Near expiry (30 days)",icon:"🟡"},
  large_stock: {ar:"كمية مخزون شاذة",en:"Abnormal stock",icon:"🟡"},
  similar_name: {ar:"اسم متشابه",en:"Similar name",icon:"🟡"},
  missing_ar: {ar:"مفقود اسم عربي",en:"Missing Arabic name",icon:"🟢"},
  missing_category: {ar:"مفقود فئة",en:"Missing category",icon:"🟢"},
  missing_supplier: {ar:"مفقود مورد",en:"Missing supplier",icon:"🟢"},
  slow_velocity: {ar:"بطيء البيع",en:"Slow seller",icon:"🟢"},
  never_sold: {ar:"لم يُبَع",en:"Never sold",icon:"🟢"}
};

const exportAuditExcel = () => {
  let csv = "Severity,Type,Product,Barcode,Category,Cost,Price,Stock,Detail,Suggested Action\n";
  ["critical","warning","info"].forEach(sev => {
    issues[sev].forEach(i => {
      const lbl = TYPE_LABELS[i.type]?.en || i.type;
      csv += `${sev},${lbl},"${i.product.n}",${i.product.bc||""},${i.product.cat||""},${i.product.c},${i.product.p},${i.product.s},"${i.detail}","${i.fix}"\n`;
    });
  });
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = "audit_report_"+new Date().toISOString().slice(0,10)+".csv";
  a.click(); URL.revokeObjectURL(url);
  sT("✓ "+(rtl?"تم التصدير":"Exported"),"ok");
};

const exportAuditPDF = () => {
  const w = window.open("","_blank","width=900,height=700");
  if(!w) return;
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Smart Audit Report</title>
  <style>
    body{font-family:Arial,sans-serif;padding:20px;color:#1f2937}
    h1{color:#7c3aed;border-bottom:3px solid #7c3aed;padding-bottom:8px}
    h2{margin-top:24px;padding:8px 12px;border-radius:6px}
    h2.crit{background:#fef2f2;color:#dc2626}
    h2.warn{background:#fffbeb;color:#d97706}
    h2.info{background:#f0fdf4;color:#059669}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}
    th{background:#f3f4f6;padding:6px;text-align:left;border:1px solid #d1d5db}
    td{padding:6px;border:1px solid #e5e7eb}
    .meta{color:#6b7280;font-size:11px;margin-bottom:16px}
    @media print{body{padding:10px}h2{page-break-after:avoid}}
  </style></head><body>
  <h1>🔍 Smart Audit Report — 3045 Super Grocery</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()} · By: ${cu.fn} · Total Issues: ${issues.critical.length + issues.warning.length + issues.info.length}</div>`;
  
  ["critical","warning","info"].forEach(sev => {
    const items = issues[sev];
    if(items.length === 0) return;
    const cls = sev==="critical"?"crit":sev==="warning"?"warn":"info";
    const icon = sev==="critical"?"🔴":sev==="warning"?"🟡":"🟢";
    html += `<h2 class="${cls}">${icon} ${sev.toUpperCase()} (${items.length})</h2>`;
    html += `<table><thead><tr><th>Type</th><th>Product</th><th>Barcode</th><th>Cat</th><th>Cost</th><th>Price</th><th>Stock</th><th>Issue</th></tr></thead><tbody>`;
    items.slice(0,200).forEach(i => {
      const lbl = TYPE_LABELS[i.type]?.en || i.type;
      html += `<tr><td>${lbl}</td><td>${i.product.n}</td><td>${i.product.bc||"-"}</td><td>${i.product.cat||"-"}</td><td>${i.product.c.toFixed(3)}</td><td>${i.product.p.toFixed(3)}</td><td>${i.product.s}</td><td>${i.detail}</td></tr>`;
    });
    html += `</tbody></table>`;
  });
  
  html += `<script>setTimeout(()=>window.print(),500)</script></body></html>`;
  w.document.write(html); w.document.close();
};

const totalIssues = issues.critical.length + issues.warning.length + issues.info.length;
const healthScore = prods.length > 0 ? Math.max(0, Math.round(100 - (issues.critical.length*5 + issues.warning.length*1 + issues.info.length*0.2) / prods.length * 100)) : 100;

// Gap Detection in Receipts (last 7 days)
const auditGaps = (() => {
  const sevenDaysAgo = new Date(Date.now() - 7*86400000);
  // Include VOIDED transactions too (they keep their seq)
  const recentTxs = txns.filter(t => {try{return new Date(t.ts) >= sevenDaysAgo}catch{return false}});
  const byCashierDay = {};
  recentTxs.forEach(t => {
    const dayKey = (t.cashierId||0) + "_" + new Date(t.ts).toISOString().slice(0,10);
    if(!byCashierDay[dayKey]) byCashierDay[dayKey] = {cashier:t.cashierName, cashierId:t.cashierId, date:new Date(t.ts).toISOString().slice(0,10), seqs:[], txs:[]};
    if(t.seq) {
      byCashierDay[dayKey].seqs.push(t.seq);
      byCashierDay[dayKey].txs.push(t);
    }
  });
  const gaps = [];
  Object.values(byCashierDay).forEach(g => {
    const sorted = [...g.seqs].sort((a,b)=>a-b);
    for(let i=1; i<sorted.length; i++) {
      if(sorted[i]-sorted[i-1] > 1) {
        for(let m=sorted[i-1]+1; m<sorted[i]; m++) {
          // Find the transactions BEFORE and AFTER the gap
          const txBefore = g.txs.find(t => t.seq === sorted[i-1]);
          const txAfter = g.txs.find(t => t.seq === sorted[i]);
          
          // Calculate time gap
          let timeGap = null;
          let timeGapMins = null;
          if(txBefore && txAfter){
            const diff = new Date(txAfter.ts) - new Date(txBefore.ts);
            timeGapMins = Math.round(diff/60000);
            const h = Math.floor(diff/3600000);
            const mins = Math.floor((diff%3600000)/60000);
            timeGap = h > 0 ? `${h}h ${mins}m` : `${mins}m`;
          }
          
          // Smart reason analysis
          let likelyReason = "unknown";
          let reasonDetail = "";
          
          if(timeGapMins !== null){
            if(timeGapMins > 60){
              likelyReason = "break";
              reasonDetail = rtl ? `فترة استراحة طويلة (${timeGap})` : `Long break period (${timeGap})`;
            } else if(timeGapMins < 2){
              likelyReason = "system_error";
              reasonDetail = rtl ? `مشكلة نظام - فاصل زمني قصير جداً (${timeGap})` : `System issue - very short gap (${timeGap})`;
            } else {
              likelyReason = "normal_gap";
              reasonDetail = rtl ? `فاصل طبيعي (${timeGap})` : `Normal gap (${timeGap})`;
            }
          }
          
          gaps.push({
            cashier: g.cashier,
            cashierId: g.cashierId,
            date: g.date,
            missing: m,
            txBefore: txBefore ? {seq:txBefore.seq, rn:txBefore.rn, time:txBefore.time, total:txBefore.tot} : null,
            txAfter: txAfter ? {seq:txAfter.seq, rn:txAfter.rn, time:txAfter.time, total:txAfter.tot} : null,
            timeGap,
            timeGapMins,
            likelyReason,
            reasonDetail
          });
        }
      }
    }
  });
  return gaps;
})();

return <>
{/* Header with health score */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:16}}>
  <div>
    <h2 style={{fontSize:20,fontWeight:800,margin:0}}>🔍 {rtl?"التدقيق الذكي":"Smart Audit"}</h2>
    <p style={{color:"#6b7280",fontSize:13,margin:"4px 0 0"}}>
      {rtl?"فحص شامل لـ":"Scanning"} <strong>{prods.length}</strong> {rtl?"منتج":"products"} · 
      <strong style={{color:"#dc2626",marginLeft:4}}>{issues.critical.length}</strong> {rtl?"حرج":"critical"} · 
      <strong style={{color:"#d97706",marginLeft:4}}>{issues.warning.length}</strong> {rtl?"تحذير":"warnings"} · 
      <strong style={{color:"#059669",marginLeft:4}}>{issues.info.length}</strong> {rtl?"ملاحظة":"info"}
    </p>
  </div>
  <div style={{display:"flex",gap:8,alignItems:"center"}}>
    <ExportButtons title={rtl?"تقرير التدقيق":"Audit Report"} getExportData={()=>{
      const allIssues=[...issues.critical,...issues.warning,...issues.info];
      const headers=[rtl?"المستوى":"Level",rtl?"النوع":"Type",rtl?"المنتج":"Product",rtl?"الباركود":"Barcode",rtl?"التفاصيل":"Details"];
      const rows=allIssues.map(i=>[i.severity||"—",i.type||"—",i.productName||"—",i.barcode||"—",i.message||"—"]);
      const summary=[
        {label:rtl?"الصحة":"Health",value:healthScore+"%",color:healthScore>=80?"#059669":healthScore>=50?"#d97706":"#dc2626"},
        {label:rtl?"حرج":"Critical",value:issues.critical.length,color:"#dc2626"},
        {label:rtl?"تحذير":"Warning",value:issues.warning.length,color:"#d97706"},
        {label:rtl?"ملاحظة":"Info",value:issues.info.length,color:"#059669"}
      ];
      return {headers,rows,summary,filters:[],showSignatures:true};
    }}/>
    <div style={{padding:"8px 16px",borderRadius:10,background:healthScore>=80?"#ecfdf5":healthScore>=50?"#fffbeb":"#fef2f2",
      border:"1.5px solid "+(healthScore>=80?"#6ee7b7":healthScore>=50?"#fbbf24":"#fca5a5")}}>
      <div style={{fontSize:10,color:"#6b7280"}}>{rtl?"الصحة العامة":"Health Score"}</div>
      <div style={{fontSize:24,fontWeight:800,color:healthScore>=80?"#059669":healthScore>=50?"#d97706":"#dc2626"}}>{healthScore}/100</div>
    </div>
    <button onClick={()=>{setShowAuditLog(true);DB.getAuditLog(200).then(setAuditLog)}}
      style={{padding:"10px 16px",background:"#6b7280",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      📋 {rtl?"السجل":"Log"}
    </button>
    {bulkEditSel.size > 0 && (
      <button onClick={()=>setBulkEditMod(true)}
        style={{padding:"10px 16px",background:"#7c3aed",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
        ⚡ {rtl?`تعديل جماعي (${bulkEditSel.size})`:`Bulk Edit (${bulkEditSel.size})`}
      </button>
    )}
    <button onClick={exportAuditExcel}
      style={{padding:"10px 16px",background:"#059669",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      📊 Excel
    </button>
    <button onClick={exportAuditPDF}
      style={{padding:"10px 16px",background:"#dc2626",border:"none",borderRadius:10,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
      📄 PDF
    </button>
  </div>
</div>

{/* Receipt Gap Alert (last 7 days) */}
{auditGaps.length > 0 && (
  <div style={{padding:14,background:"linear-gradient(135deg,#fef2f2,#fee2e2)",border:"2px solid #dc2626",borderRadius:12,marginBottom:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div>
        <div style={{fontSize:14,fontWeight:800,color:"#991b1b"}}>🔴 {rtl?"تنبيه: فجوات في أرقام الفواتير (آخر 7 أيام)":"ALERT: Receipt Number Gaps (last 7 days)"}</div>
        <div style={{fontSize:11,color:"#7f1d1d",marginTop:4}}>
          {rtl?`اكتُشف ${auditGaps.length} فاتورة مفقودة — راجع التفاصيل أدناه لمعرفة السبب المحتمل`:`Detected ${auditGaps.length} missing receipts — review details below for likely causes`}
        </div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={()=>{
          // Export gaps to CSV
          const headers = [rtl?"التاريخ":"Date", rtl?"الكاشير":"Cashier", rtl?"رقم مفقود":"Missing#", rtl?"فاتورة قبل":"Before", rtl?"فاتورة بعد":"After", rtl?"الفاصل الزمني":"Time Gap", rtl?"السبب المحتمل":"Likely Reason"];
          let csv = "\uFEFF" + headers.join(",") + "\n";
          auditGaps.forEach(g => {
            csv += [g.date, g.cashier, "#"+g.missing, g.txBefore?("#"+g.txBefore.seq+" @"+g.txBefore.time):"—", g.txAfter?("#"+g.txAfter.seq+" @"+g.txAfter.time):"—", g.timeGap||"—", '"'+g.reasonDetail.replace(/"/g,'""')+'"'].join(",") + "\n";
          });
          const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "receipt_gaps_"+new Date().toISOString().slice(0,10)+".csv";
          a.click();
        }} style={{padding:"8px 14px",background:"#10b981",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:11,whiteSpace:"nowrap"}}>
          📊 Excel
        </button>
        <button onClick={()=>{setTab("admin");setAT("reconcile")}}
          style={{padding:"8px 14px",background:"#dc2626",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer",fontSize:11,whiteSpace:"nowrap"}}>
          💰 {rtl?"المطابقة":"Reconciliation"}
        </button>
      </div>
    </div>
    
    {/* Summary by reason */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
      {(()=>{
        const byReason = {};
        auditGaps.forEach(g => {byReason[g.likelyReason] = (byReason[g.likelyReason]||0)+1});
        const reasonLabels = {
          system_error: {ar:"🔴 خطأ نظام محتمل", en:"🔴 Likely System Error", color:"#dc2626", bg:"#fef2f2"},
          normal_gap: {ar:"🟡 فاصل طبيعي", en:"🟡 Normal Gap", color:"#d97706", bg:"#fffbeb"},
          break: {ar:"🟢 استراحة", en:"🟢 Break Period", color:"#059669", bg:"#f0fdf4"},
          unknown: {ar:"⚪ غير محدد", en:"⚪ Unknown", color:"#6b7280", bg:"#f9fafb"}
        };
        return Object.entries(byReason).map(([k,v]) => {
          const lbl = reasonLabels[k] || reasonLabels.unknown;
          return (
            <div key={k} style={{padding:8,background:lbl.bg,border:"1px solid "+lbl.color+"33",borderRadius:8}}>
              <div style={{fontSize:10,color:lbl.color,fontWeight:700}}>{rtl?lbl.ar:lbl.en}</div>
              <div style={{fontSize:20,fontWeight:800,color:lbl.color,fontFamily:"monospace"}}>{v}</div>
            </div>
          );
        });
      })()}
    </div>
    
    {/* Detailed table */}
    <div style={{background:"#fff",borderRadius:8,overflow:"hidden",border:"1px solid #fecaca"}}>
      <div style={{maxHeight:300,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead style={{background:"#fef2f2",position:"sticky",top:0,zIndex:1}}>
            <tr>
              <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"التاريخ":"Date"}</th>
              <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"الكاشير":"Cashier"}</th>
              <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"رقم مفقود":"Missing #"}</th>
              <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"الفاتورة قبل":"Before"}</th>
              <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"الفاتورة بعد":"After"}</th>
              <th style={{padding:"8px",textAlign:"center",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"الفاصل":"Time Gap"}</th>
              <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#991b1b",fontWeight:700}}>{rtl?"السبب المحتمل":"Likely Reason"}</th>
            </tr>
          </thead>
          <tbody>
            {auditGaps.slice(0,50).map((g,i)=>{
              const reasonColor = g.likelyReason === "system_error" ? "#dc2626" : g.likelyReason === "break" ? "#059669" : g.likelyReason === "normal_gap" ? "#d97706" : "#6b7280";
              const reasonBg = g.likelyReason === "system_error" ? "#fef2f2" : g.likelyReason === "break" ? "#f0fdf4" : g.likelyReason === "normal_gap" ? "#fffbeb" : "#f9fafb";
              return (
                <tr key={i} style={{borderTop:"1px solid #fecaca"}}>
                  <td style={{padding:"6px 8px",fontSize:10}}>{g.date}</td>
                  <td style={{padding:"6px 8px",fontSize:10,fontWeight:600,color:"#2563eb"}}>{g.cashier}</td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    <span style={{padding:"3px 8px",background:"#dc2626",color:"#fff",borderRadius:4,fontSize:10,fontFamily:"monospace",fontWeight:700}}>#{g.missing}</span>
                  </td>
                  <td style={{padding:"6px 8px",fontSize:10}}>
                    {g.txBefore ? (
                      <div>
                        <div style={{fontFamily:"monospace",fontWeight:600}}>#{g.txBefore.seq}</div>
                        <div style={{fontSize:9,color:"#6b7280"}}>{g.txBefore.time} · {fm(g.txBefore.total)}</div>
                      </div>
                    ) : "—"}
                  </td>
                  <td style={{padding:"6px 8px",fontSize:10}}>
                    {g.txAfter ? (
                      <div>
                        <div style={{fontFamily:"monospace",fontWeight:600}}>#{g.txAfter.seq}</div>
                        <div style={{fontSize:9,color:"#6b7280"}}>{g.txAfter.time} · {fm(g.txAfter.total)}</div>
                      </div>
                    ) : "—"}
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:g.timeGapMins>60?"#059669":g.timeGapMins<2?"#dc2626":"#d97706"}}>
                    {g.timeGap || "—"}
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <span style={{padding:"3px 8px",background:reasonBg,color:reasonColor,borderRadius:4,fontSize:10,fontWeight:600}}>
                      {g.reasonDetail}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {auditGaps.length > 50 && (
        <div style={{padding:8,textAlign:"center",fontSize:10,color:"#991b1b",background:"#fef2f2",fontWeight:600}}>
          {rtl?`يعرض أول 50 من ${auditGaps.length} — استخدم Excel لتصدير الكل`:`Showing first 50 of ${auditGaps.length} — use Excel to export all`}
        </div>
      )}
    </div>
    
    {/* Help text */}
    <div style={{marginTop:10,padding:10,background:"#fff",borderRadius:8,border:"1px solid #fecaca",fontSize:10,color:"#7f1d1d",lineHeight:1.7}}>
      <strong>💡 {rtl?"كيف يُحدد السبب المحتمل":"How likely reason is determined"}:</strong>
      <div style={{marginTop:4}}>
        • <strong style={{color:"#dc2626"}}>🔴 {rtl?"خطأ نظام":"System Error"}</strong>: {rtl?"فاصل زمني أقل من دقيقتين — قد يشير إلى انقطاع الاتصال أو حذف يدوي":"Gap less than 2 minutes — may indicate connection loss or manual deletion"}<br/>
        • <strong style={{color:"#d97706"}}>🟡 {rtl?"فاصل طبيعي":"Normal Gap"}</strong>: {rtl?"فاصل 2-60 دقيقة — قد يشير إلى بدء فاتورة وإلغائها قبل الحفظ":"2-60 minute gap — may indicate cancelled draft invoice"}<br/>
        • <strong style={{color:"#059669"}}>🟢 {rtl?"استراحة":"Break Period"}</strong>: {rtl?"أكثر من ساعة — راجع التواصل في ذلك الوقت":"Over 1 hour — check activity during this period"}
      </div>
    </div>
  </div>
)}

{/* Severity Filters */}
<div style={{display:"flex",gap:8,marginBottom:14}}>
  <button onClick={()=>setAuditFilter("all")}
    style={{padding:"10px 18px",background:auditFilter==="all"?"#1f2937":"#f3f4f6",color:auditFilter==="all"?"#fff":"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
    {rtl?"الكل":"All"} ({totalIssues})
  </button>
  <button onClick={()=>setAuditFilter("critical")}
    style={{padding:"10px 18px",background:auditFilter==="critical"?"#dc2626":"#fef2f2",color:auditFilter==="critical"?"#fff":"#dc2626",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
    🔴 {rtl?"حرج":"Critical"} ({issues.critical.length})
  </button>
  <button onClick={()=>setAuditFilter("warning")}
    style={{padding:"10px 18px",background:auditFilter==="warning"?"#d97706":"#fffbeb",color:auditFilter==="warning"?"#fff":"#d97706",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
    🟡 {rtl?"تحذير":"Warning"} ({issues.warning.length})
  </button>
  <button onClick={()=>setAuditFilter("info")}
    style={{padding:"10px 18px",background:auditFilter==="info"?"#059669":"#f0fdf4",color:auditFilter==="info"?"#fff":"#059669",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
    🟢 {rtl?"ملاحظة":"Info"} ({issues.info.length})
  </button>
</div>

{/* Issues grouped by type */}
{Object.keys(byType).length === 0 ? (
  <div style={{padding:60,textAlign:"center",background:"#fff",borderRadius:12,border:"1px solid #e5e7eb"}}>
    <div style={{fontSize:48}}>🎉</div>
    <div style={{fontSize:18,fontWeight:700,color:"#059669",marginTop:8}}>{rtl?"كل شيء على ما يرام!":"All clear!"}</div>
    <div style={{fontSize:12,color:"#6b7280",marginTop:4}}>{rtl?"لا توجد أخطاء في هذه الفئة":"No issues in this category"}</div>
  </div>
) : (
  Object.entries(byType).map(([type, items]) => {
    const lbl = TYPE_LABELS[type] || {ar:type,en:type,icon:"•"};
    const isCrit = ["price_below_cost","zero_value","expired"].includes(type);
    const isWarn = ["high_margin","low_margin","abnormal_price","duplicate_barcode","near_expiry","large_stock","similar_name"].includes(type);
    const bgCol = isCrit?"#fef2f2":isWarn?"#fffbeb":"#f0fdf4";
    const border = isCrit?"#fca5a5":isWarn?"#fbbf24":"#6ee7b7";
    return (
      <div key={type} style={{background:"#fff",borderRadius:12,border:"1px solid "+border,marginBottom:12,overflow:"hidden"}}>
        <div style={{padding:"10px 14px",background:bgCol,borderBottom:"1px solid "+border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontWeight:700,fontSize:14}}>{lbl.icon} {rtl?lbl.ar:lbl.en} <span style={{color:"#6b7280",fontWeight:500,marginLeft:8}}>({items.length})</span></div>
          <button onClick={()=>{
            const ns = new Set(bulkEditSel);
            items.forEach(i => ns.add(i.product.id));
            setBulkEditSel(ns);
          }} style={{padding:"4px 10px",background:"rgba(0,0,0,.05)",border:"none",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>
            ☑ {rtl?"اختر الكل":"Select All"}
          </button>
        </div>
        <div style={{maxHeight:300,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,zIndex:1,background:"#f9fafb"}}>
              <tr style={{borderBottom:"2px solid #e5e7eb"}}>
                <th style={{padding:"8px 6px",textAlign:"left",fontSize:10,color:"#374151",fontWeight:700,width:30}}></th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"الباركود":"Barcode"}</th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"المنتج":"Product"}</th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"الفئة":"Category"}</th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#2563eb",fontWeight:700}}>🏭 {rtl?"المورد":"Supplier"}</th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#7c3aed",fontWeight:700}}>🧾 {rtl?"آخر فاتورة":"Last Invoice"}</th>
                <th style={{padding:"8px",textAlign:"right",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"التكلفة":"Cost"}</th>
                <th style={{padding:"8px",textAlign:"right",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"السعر":"Price"}</th>
                <th style={{padding:"8px",textAlign:"right",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"المخزون":"Stock"}</th>
                <th style={{padding:"8px",textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"المشكلة":"Issue"}</th>
                <th style={{padding:"8px",textAlign:"right",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"إجراء":"Action"}</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0,100).map((i,idx) => {
                // Find last invoice for this product
                const lastInv = invs.find(inv => (inv.items||[]).some(it => it.prodId === i.product.id));
                return (
                <tr key={idx} style={{borderTop:"1px solid #f3f4f6",background:bulkEditSel.has(i.product.id)?"#eff6ff":"#fff"}}>
                  <td style={{padding:8,width:30}}>
                    <input type="checkbox" checked={bulkEditSel.has(i.product.id)}
                      onChange={e=>{
                        const ns = new Set(bulkEditSel);
                        if(e.target.checked) ns.add(i.product.id);
                        else ns.delete(i.product.id);
                        setBulkEditSel(ns);
                      }}/>
                  </td>
                  <td style={{padding:8,fontSize:11,fontFamily:"monospace",color:"#6b7280",width:120}}>{i.product.bc||"—"}</td>
                  <td style={{padding:8,fontSize:12,fontWeight:600}}>{rtl?(i.product.a||i.product.n):i.product.n}</td>
                  <td style={{padding:8,fontSize:11,color:"#6b7280"}}>{i.product.cat||"—"}</td>
                  <td style={{padding:8,fontSize:11,color:i.product.supplier?"#2563eb":"#d1d5db",fontWeight:i.product.supplier?600:400}}>{i.product.supplier||"— "+(rtl?"بدون":"None")+" —"}</td>
                  <td style={{padding:8,fontSize:10}}>
                    {lastInv ? (
                      <div>
                        <div style={{fontFamily:"monospace",fontWeight:600,color:"#7c3aed"}}>{lastInv.invoiceNo}</div>
                        <div style={{fontSize:9,color:"#9ca3af"}}>{lastInv.date}</div>
                      </div>
                    ) : (
                      <span style={{color:"#dc2626",fontWeight:600}}>⚠ {rtl?"لا فاتورة":"No invoice"}</span>
                    )}
                  </td>
                  <td style={{padding:8,fontSize:11,fontFamily:"monospace",textAlign:"right"}}>{i.product.c.toFixed(3)}</td>
                  <td style={{padding:8,fontSize:11,fontFamily:"monospace",textAlign:"right",fontWeight:600}}>{i.product.p.toFixed(3)}</td>
                  <td style={{padding:8,fontSize:11,textAlign:"right",fontWeight:700,color:i.product.s===0?"#dc2626":i.product.s<30?"#d97706":"#059669"}}>{i.product.s}</td>
                  <td style={{padding:8,fontSize:11,color:isCrit?"#dc2626":isWarn?"#d97706":"#059669",fontWeight:600}}>{i.detail}</td>
                  <td style={{padding:8,width:140,textAlign:"right"}}>
                    <button onClick={()=>setAuditFixMod({product:i.product,fix:i.fix,issue:i})}
                      style={{padding:"4px 12px",background:isCrit?"#dc2626":isWarn?"#d97706":"#059669",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",marginRight:4}}>
                      ⚡ {rtl?"إصلاح":"Fix"}
                    </button>
                    {i.type === "slow_velocity" && (
                      <button onClick={()=>{
                        const discount = prompt(rtl?"نسبة الخصم %":"Discount %","20");
                        if(!discount) return;
                        const d = parseFloat(discount);
                        if(isNaN(d)||d<=0||d>=100) return;
                        const newPrice = +(i.product.p * (1-d/100)).toFixed(3);
                        if(confirm(rtl?`خفض السعر من ${i.product.p.toFixed(3)} إلى ${newPrice.toFixed(3)}؟`:`Reduce price from ${i.product.p.toFixed(3)} to ${newPrice.toFixed(3)}?`)) {
                          setProds(p => p.map(x => x.id === i.product.id ? {...x, p: newPrice} : x));
                          DB.upsertProduct({...i.product, p: newPrice}).then(()=>{
                            DB.addAuditLog({user_id:cu.id,user_name:cu.fn,action:"discount",entity_type:"product",entity_id:i.product.id,field_name:"price",old_value:String(i.product.p),new_value:String(newPrice),notes:"Slow seller discount "+d+"%"});
                            sT("✓ "+(rtl?"تم تطبيق الخصم":"Discount applied"),"ok");
                          });
                        }
                      }} style={{padding:"4px 8px",background:"#f5f3ff",color:"#7c3aed",border:"1px solid #ddd6fe",borderRadius:6,fontSize:10,cursor:"pointer"}}>
                        💸 {rtl?"خصم":"Discount"}
                      </button>
                    )}
                  </td>
                </tr>);
              })}
            </tbody>
          </table>
          {items.length > 100 && (
            <div style={{padding:8,textAlign:"center",fontSize:11,color:"#9ca3af",background:"#f9fafb"}}>
              {rtl?`يعرض 100 من ${items.length}`:`Showing 100 of ${items.length}`}
            </div>
          )}
        </div>
      </div>
    );
  })
)}

{/* Quick Fix Modal */}
{auditFixMod && (
  <div onClick={()=>setAuditFixMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:400,maxWidth:500}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>⚡ {rtl?"إصلاح سريع":"Quick Fix"}</h3>
      <p style={{color:"#6b7280",fontSize:12,marginBottom:16}}>{auditFixMod.product.n}</p>
      
      {auditFixMod.fix === "price" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"السعر الجديد":"New Price"}</label>
          <input id="qfix" type="number" step="0.001" defaultValue={auditFixMod.product.p}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,fontFamily:"monospace"}}/>
          <div style={{fontSize:11,color:"#6b7280",marginTop:6}}>{rtl?"التكلفة الحالية":"Current cost"}: {auditFixMod.product.c.toFixed(3)}</div>
        </div>
      )}
      {auditFixMod.fix === "cost" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"التكلفة الجديدة":"New Cost"}</label>
          <input id="qfix" type="number" step="0.001" defaultValue={auditFixMod.product.c}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,fontFamily:"monospace"}}/>
        </div>
      )}
      {auditFixMod.fix === "stock" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"المخزون الجديد":"New Stock"}</label>
          <input id="qfix" type="number" defaultValue={auditFixMod.product.s}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,fontFamily:"monospace"}}/>
        </div>
      )}
      {auditFixMod.fix === "expiry" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"تاريخ الانتهاء":"Expiry Date"}</label>
          <input id="qfix" type="date" defaultValue={auditFixMod.product.exp||""}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4}}/>
        </div>
      )}
      {auditFixMod.fix === "name_ar" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"الاسم بالعربي":"Arabic Name"}</label>
          <input id="qfix" defaultValue={auditFixMod.product.a||""}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,direction:"rtl"}}/>
        </div>
      )}
      {auditFixMod.fix === "category" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"الفئة":"Category"}</label>
          <input id="qfix" defaultValue={auditFixMod.product.cat||""}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4}}/>
        </div>
      )}
      {auditFixMod.fix === "supplier" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"المورد":"Supplier"}</label>
          <select id="qfix" defaultValue={auditFixMod.product.supplier||""}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4}}>
            <option value="">— {rtl?"بدون":"None"} —</option>
            {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      )}
      {auditFixMod.fix === "barcode" && (
        <div>
          <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"باركود جديد":"New Barcode"}</label>
          <input id="qfix" defaultValue={auditFixMod.product.bc||""}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,fontFamily:"monospace"}}/>
        </div>
      )}
      
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
        <button onClick={()=>setAuditFixMod(null)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={async()=>{
          const el = document.getElementById("qfix");
          if(!el) return;
          const newVal = el.value;
          const p = auditFixMod.product;
          let updated = {...p};
          let oldVal = "", fieldName = auditFixMod.fix;
          
          if(auditFixMod.fix==="price") { oldVal=p.p; updated.p = parseFloat(newVal)||p.p; }
          else if(auditFixMod.fix==="cost") { oldVal=p.c; updated.c = parseFloat(newVal)||p.c; }
          else if(auditFixMod.fix==="stock") { oldVal=p.s; updated.s = parseInt(newVal)||0; }
          else if(auditFixMod.fix==="expiry") { oldVal=p.exp||""; updated.exp = newVal||null; }
          else if(auditFixMod.fix==="name_ar") { oldVal=p.a||""; updated.a = newVal; }
          else if(auditFixMod.fix==="category") { oldVal=p.cat||""; updated.cat = newVal; }
          else if(auditFixMod.fix==="supplier") { oldVal=p.supplier||""; updated.supplier = newVal; }
          else if(auditFixMod.fix==="barcode") { oldVal=p.bc; updated.bc = newVal; }
          
          setProds(prev => prev.map(x => x.id===p.id ? updated : x));
          try {
            await DB.upsertProduct(updated);
            await DB.addAuditLog({user_id:cu.id,user_name:cu.fn,action:"quick_fix",entity_type:"product",entity_id:p.id,field_name:fieldName,old_value:String(oldVal),new_value:String(newVal),notes:"Quick fix from audit"});
            sT("✓ "+(rtl?"تم الإصلاح":"Fixed"),"ok");
          } catch(e) { console.error(e); sT("✗ Error","err"); }
          setAuditFixMod(null);
        }} style={{padding:"10px 24px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:"pointer"}}>
          ✓ {rtl?"حفظ":"Save"}
        </button>
      </div>
    </div>
  </div>
)}

{/* Bulk Edit Modal */}
{bulkEditMod && (
  <div onClick={()=>setBulkEditMod(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:450,maxWidth:550}}>
      <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800}}>⚡ {rtl?`تعديل جماعي لـ ${bulkEditSel.size} منتج`:`Bulk Edit ${bulkEditSel.size} Products`}</h3>
      <p style={{color:"#dc2626",fontSize:12,marginBottom:16}}>⚠️ {rtl?"هذا الإجراء سيُعدّل عدة منتجات دفعة واحدة":"This will modify multiple products at once"}</p>
      
      <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"نوع التعديل":"Edit Type"}</label>
      <select value={bulkEditMode} onChange={e=>setBulkEditMode(e.target.value)}
        style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,marginBottom:12}}>
        <option value="price_pct">{rtl?"تغيير السعر بنسبة %":"Change price by %"}</option>
        <option value="price_fixed">{rtl?"إضافة/خصم مبلغ ثابت من السعر":"Add/subtract fixed price"}</option>
        <option value="cost_pct">{rtl?"تغيير التكلفة بنسبة %":"Change cost by %"}</option>
        <option value="cost_fixed">{rtl?"إضافة/خصم مبلغ ثابت من التكلفة":"Add/subtract fixed cost"}</option>
        <option value="margin_pct">{rtl?"تعيين هامش ربح %":"Set margin %"}</option>
        <option value="set_supplier">{rtl?"تعيين مورد":"Set supplier"}</option>
      </select>
      
      <label style={{fontSize:12,fontWeight:600,color:"#374151"}}>{rtl?"القيمة":"Value"}</label>
      {bulkEditMode === "set_supplier" ? (
        <select value={bulkEditValue} onChange={e=>setBulkEditValue(e.target.value)}
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,marginBottom:12}}>
          <option value="">— {rtl?"اختر":"Select"} —</option>
          {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      ) : (
        <input type="number" step="0.01" value={bulkEditValue} onChange={e=>setBulkEditValue(e.target.value)}
          placeholder={bulkEditMode.includes("pct")?"e.g. 10 (= 10%)":"e.g. 0.500"}
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:14,marginTop:4,marginBottom:12,fontFamily:"monospace"}}/>
      )}
      
      {bulkEditMode === "price_pct" && bulkEditValue && (
        <div style={{padding:10,background:"#fffbeb",borderRadius:8,fontSize:11,color:"#78350f",marginBottom:12}}>
          {rtl?"مثال":"Example"}: {prods.find(p=>bulkEditSel.has(p.id))?.p.toFixed(3)} → {(prods.find(p=>bulkEditSel.has(p.id))?.p * (1+parseFloat(bulkEditValue||0)/100)).toFixed(3)}
        </div>
      )}
      
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
        <button onClick={()=>{setBulkEditMod(false);setBulkEditValue("")}} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={async()=>{
          if(!bulkEditValue) return;
          if(!confirm(rtl?`تعديل ${bulkEditSel.size} منتج. متأكد؟`:`Edit ${bulkEditSel.size} products. Sure?`)) return;
          let count = 0;
          const v = bulkEditMode === "set_supplier" ? bulkEditValue : parseFloat(bulkEditValue);
          for(const id of bulkEditSel) {
            const p = prods.find(x => x.id === id);
            if(!p) continue;
            let updated = {...p}; let oldV = "", newV = "", field = "";
            if(bulkEditMode === "price_pct") { oldV=p.p; updated.p = +(p.p * (1+v/100)).toFixed(3); newV=updated.p; field="price"; }
            else if(bulkEditMode === "price_fixed") { oldV=p.p; updated.p = +(p.p + v).toFixed(3); newV=updated.p; field="price"; }
            else if(bulkEditMode === "cost_pct") { oldV=p.c; updated.c = +(p.c * (1+v/100)).toFixed(3); newV=updated.c; field="cost"; }
            else if(bulkEditMode === "cost_fixed") { oldV=p.c; updated.c = +(p.c + v).toFixed(3); newV=updated.c; field="cost"; }
            else if(bulkEditMode === "margin_pct") { oldV=p.p; updated.p = +(p.c * (1+v/100)).toFixed(3); newV=updated.p; field="price"; }
            else if(bulkEditMode === "set_supplier") { oldV=p.supplier||""; updated.supplier = v; newV=v; field="supplier"; }
            try {
              await DB.upsertProduct(updated);
              await DB.addAuditLog({user_id:cu.id,user_name:cu.fn,action:"bulk_edit",entity_type:"product",entity_id:p.id,field_name:field,old_value:String(oldV),new_value:String(newV),notes:"Bulk edit: "+bulkEditMode});
              count++;
            } catch(e) { console.error(e); }
          }
          const np = await DB.getProducts(); setProds(np);
          sT("✓ "+(rtl?`تم تعديل ${count} منتج`:`Updated ${count} products`),"ok");
          setBulkEditMod(false); setBulkEditSel(new Set()); setBulkEditValue("");
        }} disabled={!bulkEditValue} style={{padding:"10px 24px",background:bulkEditValue?"#7c3aed":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:bulkEditValue?"pointer":"not-allowed"}}>
          ⚡ {rtl?"تطبيق":"Apply"}
        </button>
      </div>
    </div>
  </div>
)}

{/* Audit Log Modal */}
{showAuditLog && (
  <div onClick={()=>setShowAuditLog(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:900,maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <h3 style={{margin:0,fontSize:18,fontWeight:800}}>📋 {rtl?"سجل التدقيق":"Audit Log"}</h3>
        <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"آخر 30 يوم":"Last 30 days"} · {auditLog.length} {rtl?"إدخال":"entries"}</div>
      </div>
      <div style={{flex:1,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:8}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead style={{background:"#f9fafb",position:"sticky",top:0}}>
            <tr>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280"}}>{rtl?"الوقت":"Time"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280"}}>{rtl?"المستخدم":"User"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280"}}>{rtl?"الإجراء":"Action"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280"}}>{rtl?"المنتج":"Product"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280"}}>{rtl?"الحقل":"Field"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#dc2626"}}>{rtl?"قبل":"Before"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#059669"}}>{rtl?"بعد":"After"}</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.length === 0 ? (
              <tr><td colSpan={7} style={{padding:40,textAlign:"center",color:"#9ca3af"}}>{rtl?"لا سجلات بعد":"No log entries yet"}</td></tr>
            ) : auditLog.map(log => {
              const prod = prods.find(p => p.id === log.entity_id);
              return (
                <tr key={log.id} style={{borderTop:"1px solid #f3f4f6"}}>
                  <td style={{padding:8,fontSize:10,color:"#6b7280",fontFamily:"monospace"}}>{new Date(log.created_at).toLocaleString()}</td>
                  <td style={{padding:8,fontSize:11,fontWeight:600}}>{log.user_name||"—"}</td>
                  <td style={{padding:8,fontSize:11}}><span style={{padding:"2px 6px",background:"#eff6ff",color:"#2563eb",borderRadius:4,fontSize:10}}>{log.action}</span></td>
                  <td style={{padding:8,fontSize:11}}>{prod?prod.n:log.entity_id}</td>
                  <td style={{padding:8,fontSize:11,color:"#7c3aed"}}>{log.field_name}</td>
                  <td style={{padding:8,fontSize:11,fontFamily:"monospace",color:"#dc2626"}}>{log.old_value||"—"}</td>
                  <td style={{padding:8,fontSize:11,fontFamily:"monospace",color:"#059669",fontWeight:600}}>{log.new_value||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
        <button onClick={()=>setShowAuditLog(false)} style={{padding:"10px 20px",background:"#1f2937",border:"none",borderRadius:8,color:"#fff",fontWeight:600,cursor:"pointer"}}>{rtl?"إغلاق":"Close"}</button>
      </div>
    </div>
  </div>
)}
</>})()}

{atab==="pricereview"&&(()=>{
// Build invoice price map: latest cost per product from purchase invoices
const invPriceMap={};
invs.forEach(inv=>{(inv.items||[]).forEach(it=>{if(it.prodId&&!invPriceMap[it.prodId]){invPriceMap[it.prodId]={cost:parseFloat(it.cost)||0,invoiceNo:inv.invoiceNo,date:inv.date,supplier:inv.supplier}}})});

const f=prSearch.toLowerCase().trim();
let rows=prods.filter(p=>{
  if(f&&!(p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.supplier||"").toLowerCase().includes(f)))return false;
  const inv=invPriceMap[p.id];
  if(prFilter==="noinvoice")return !inv;
  if(prFilter==="hasinvoice")return !!inv;
  if(prFilter==="variance"){if(!inv)return false;const variance=Math.abs(inv.cost-p.c);return variance>0.001}
  if(prFilter==="nomargin")return p.c>0&&((p.p-p.c)/p.c*100)<10;
  return true;
});

const totalNoInvoice=prods.filter(p=>!invPriceMap[p.id]).length;
const totalVariance=prods.filter(p=>{const i=invPriceMap[p.id];return i&&Math.abs(i.cost-p.c)>0.001}).length;
const totalLowMargin=prods.filter(p=>p.c>0&&((p.p-p.c)/p.c*100)<10).length;
const editCount=Object.keys(prEdits).length;

const saveAll=async()=>{
  if(editCount===0)return;
  if(!confirm((rtl?"حفظ ":"Save ")+editCount+(rtl?" تعديل؟":" changes?")))return;
  let ok=0,fail=0;
  for(const id of Object.keys(prEdits)){
    const ed=prEdits[id];const p=prods.find(x=>x.id===id);if(!p)continue;
    const newCost=ed.c!==undefined?parseFloat(ed.c)||0:p.c;
    const newPrice=ed.p!==undefined?parseFloat(ed.p)||0:p.p;
    const upd={cost:newCost,price:newPrice,updated_at:new Date().toISOString()};
    if(ed.sup!==undefined)upd.supplier=ed.sup||null;
    try{
      await sb.from("products").update(upd).eq("id",id);
      // Update local state immediately so the change is reflected everywhere
      setProds(prev=>prev.map(x=>x.id===id?{...x,c:newCost,p:newPrice,...(ed.sup!==undefined?{supplier:ed.sup||""}:{})}:x));
      ok++;
    }catch(e){fail++;console.error("Update",id,e)}
  }
  // Reload products to ensure full sync
  try{const np=await DB.getProducts();setProds(np)}catch{}
  setPrEdits({});
  sT("✓ "+ok+" "+(rtl?"محفوظ":"saved")+(fail>0?" · "+fail+" "+(rtl?"فشل":"failed"):""),fail>0?"err":"ok");
};

return<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>💰 {rtl?"مراجعة الأسعار والتكاليف":"Price & Cost Review"}</h2>
<ExportButtons title={rtl?"تقرير مراجعة الأسعار":"Price Review Report"} getExportData={()=>{
  const headers=[rtl?"الباركود":"Barcode",rtl?"المنتج":"Product",rtl?"تكلفة الفاتورة":"Invoice Cost",rtl?"التكلفة الحالية":"Current Cost",rtl?"الفرق":"Variance",rtl?"السعر":"Price",rtl?"الهامش %":"Margin %"];
  const exportRows=rows.map(r=>{const inv=invPriceMap[r.id];const margin=r.c>0?((r.p-r.c)/r.c*100).toFixed(1):"—";return [r.bc,pN(r),inv?inv.cost.toFixed(3):"—",r.c.toFixed(3),inv?(inv.cost-r.c).toFixed(3):"—",r.p.toFixed(3),margin+"%"]});
  const summary=[
    {label:rtl?"إجمالي":"Total",value:rows.length,color:"#1e40af"},
    {label:rtl?"بفاتورة":"With Invoice",value:rows.filter(r=>invPriceMap[r.id]).length,color:"#059669"},
    {label:rtl?"بدون فاتورة":"No Invoice",value:rows.filter(r=>!invPriceMap[r.id]).length,color:"#dc2626"},
    {label:rtl?"هامش منخفض":"Low Margin",value:rows.filter(r=>r.c>0&&((r.p-r.c)/r.c*100)<10).length,color:"#d97706"}
  ];
  return {headers,rows:exportRows,summary,filters:[],showSignatures:true};
}}/></div>

{/* Stats cards */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
<div style={{background:"#eff6ff",borderRadius:12,padding:14,textAlign:"center"}}><div style={{fontSize:10,color:"#1e40af",fontWeight:600}}>{rtl?"إجمالي المنتجات":"Total Products"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{prods.length}</div></div>
<div style={{background:"#fffbeb",borderRadius:12,padding:14,textAlign:"center",cursor:"pointer"}} onClick={()=>setPrFilter("noinvoice")}><div style={{fontSize:10,color:"#92400e",fontWeight:600}}>⚠ {rtl?"بدون فاتورة":"No Invoice"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{totalNoInvoice}</div></div>
<div style={{background:"#fef2f2",borderRadius:12,padding:14,textAlign:"center",cursor:"pointer"}} onClick={()=>setPrFilter("variance")}><div style={{fontSize:10,color:"#991b1b",fontWeight:600}}>📊 {rtl?"اختلاف بالسعر":"Price Variance"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#dc2626"}}>{totalVariance}</div></div>
<div style={{background:"#f5f3ff",borderRadius:12,padding:14,textAlign:"center",cursor:"pointer"}} onClick={()=>setPrFilter("nomargin")}><div style={{fontSize:10,color:"#5b21b6",fontWeight:600}}>📉 {rtl?"هامش منخفض <10%":"Low Margin <10%"}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{totalLowMargin}</div></div>
</div>

{/* Filter & Search */}
<div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
<input value={prSearch} onChange={e=>setPrSearch(e.target.value)} placeholder={rtl?"🔍 بحث...":"🔍 Search..."} style={{flex:"1 1 200px",padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",fontFamily:"var(--f)"}}/>
<select value={prFilter} onChange={e=>setPrFilter(e.target.value)} style={{padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,fontFamily:"var(--f)",outline:"none"}}>
<option value="all">{rtl?"الكل":"All"}</option>
<option value="noinvoice">⚠ {rtl?"بدون فاتورة":"No Invoice"}</option>
<option value="hasinvoice">✓ {rtl?"مع فاتورة":"Has Invoice"}</option>
<option value="variance">📊 {rtl?"يوجد اختلاف":"Has Variance"}</option>
<option value="nomargin">📉 {rtl?"هامش منخفض":"Low Margin"}</option>
</select>
<div style={{flex:1}}/>
{editCount>0&&<><span style={{fontSize:12,color:"#d97706",fontWeight:700}}>✏ {editCount} {rtl?"تعديل غير محفوظ":"unsaved"}</span><button onClick={()=>setPrEdits({})} style={{padding:"8px 14px",background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",color:"#6b7280"}}>↺ {rtl?"إلغاء":"Cancel"}</button><button onClick={saveAll} style={{padding:"8px 18px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>💾 {rtl?"حفظ الكل":"Save All"} ({editCount})</button></>}
</div>

<div style={{fontSize:11,color:"#6b7280",marginBottom:8}}>{rtl?"عرض":"Showing"} {rows.length} / {prods.length} · {rtl?"💡 عدّل التكلفة أو السعر مباشرة، الهامش يُحسب تلقائياً":"💡 Edit cost or price inline, margin auto-calculates"}</div>

<div style={{overflowX:"auto",maxHeight:"60vh",overflowY:"auto"}}><table className="at" style={{minWidth:1100}}><thead style={{position:"sticky",top:0,background:"#f9fafb",zIndex:1}}><tr>
<th>{t.bc}</th><th>{t.product}</th><th>{rtl?"المورد":"Vendor"}</th>
<th style={{background:"#fef2f2"}}>{rtl?"التكلفة الحالية":"Current Cost"}</th>
<th style={{background:"#eff6ff"}}>{rtl?"تكلفة الفاتورة":"Invoice Cost"}</th>
<th style={{background:"#fef2f2"}}>{rtl?"تكلفة جديدة":"New Cost"}</th>
<th style={{background:"#ecfdf5"}}>{rtl?"سعر البيع":"Selling Price"}</th>
<th style={{background:"#f5f3ff"}}>{rtl?"الهامش":"Margin"}</th>
<th>{rtl?"المخزون":"Stock"}</th>
<th>{rtl?"رقم الفاتورة":"Invoice #"}</th>
</tr></thead>
<tbody>{rows.map(p=>{
const inv=invPriceMap[p.id];
const ed=prEdits[p.id]||{};
const editedCost=ed.c!==undefined?(parseFloat(ed.c)||0):p.c;
const editedPrice=ed.p!==undefined?(parseFloat(ed.p)||0):p.p;
const margin=editedPrice-editedCost;
const marginPct=editedCost>0?((editedPrice-editedCost)/editedCost*100):0;
const variance=inv?(p.c-inv.cost):0;
const hasVariance=inv&&Math.abs(variance)>0.001;
return<tr key={p.id} style={{background:!inv?"#fffbeb":hasVariance?"#fef2f2":"transparent"}}>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{p.bc}</td>
<td style={{fontWeight:600,fontSize:12}}>{p.e} {pN(p)}</td>
<td style={{fontSize:11}}><select value={ed.sup!==undefined?ed.sup:(p.supplier||"")} onChange={e=>setPrEdits(prev=>({...prev,[p.id]:{...prev[p.id],sup:e.target.value}}))} style={{padding:"5px 8px",border:"1.5px solid "+(ed.sup!==undefined?"#2563eb":"#e5e7eb"),borderRadius:6,fontSize:11,fontFamily:"var(--f)",outline:"none",width:"100%",minWidth:120,background:ed.sup!==undefined?"#eff6ff":(p.supplier?"#fff":"#fffbeb"),color:(ed.sup!==undefined?ed.sup:p.supplier)?"#1e40af":"#9ca3af",fontWeight:600,cursor:"pointer"}}><option value="">— {rtl?"بدون مورد":"None"} —</option>{suppliers.map(s=><option key={s.id} value={s.name}>{s.name}</option>)}</select></td>
<td style={{fontFamily:"var(--m)",fontWeight:700,color:"#dc2626"}}>{fN(p.c)}</td>
<td style={{fontFamily:"var(--m)"}}>{inv?<span style={{color:hasVariance?"#dc2626":"#059669",fontWeight:700}}>{fN(inv.cost)}{hasVariance&&<span style={{fontSize:9,marginLeft:4,color:variance>0?"#dc2626":"#059669"}}>({variance>0?"+":""}{fN(variance)})</span>}</span>:<span style={{color:"#d1d5db"}}>—</span>}</td>
<td><input type="number" step="0.001" value={ed.c!==undefined?ed.c:p.c} onChange={e=>setPrEdits(prev=>({...prev,[p.id]:{...prev[p.id],c:e.target.value}}))} style={{width:80,padding:"6px 8px",border:"1.5px solid #fca5a5",borderRadius:6,fontFamily:"var(--m)",fontSize:12,outline:"none",textAlign:"center",background:ed.c!==undefined?"#fef2f2":"#fff"}}/></td>
<td><input type="number" step="0.001" value={ed.p!==undefined?ed.p:p.p} onChange={e=>setPrEdits(prev=>({...prev,[p.id]:{...prev[p.id],p:e.target.value}}))} style={{width:80,padding:"6px 8px",border:"1.5px solid #86efac",borderRadius:6,fontFamily:"var(--m)",fontSize:12,outline:"none",textAlign:"center",background:ed.p!==undefined?"#ecfdf5":"#fff",fontWeight:700}}/></td>
<td><div style={{textAlign:"center"}}><div style={{fontFamily:"var(--m)",fontWeight:700,color:margin>0?"#059669":"#dc2626"}}>{fN(margin)}</div><div style={{fontSize:10,fontFamily:"var(--m)",fontWeight:600,color:marginPct>=30?"#059669":marginPct>=15?"#d97706":"#dc2626"}}>{marginPct.toFixed(1)}%</div></div></td>
<td style={{fontFamily:"var(--m)",fontSize:11,fontWeight:600}}>{p.s}</td>
<td style={{fontSize:10}}>{inv?<div><div style={{fontFamily:"var(--m)",color:"#2563eb",fontWeight:600}}>{inv.invoiceNo}</div><div style={{color:"#9ca3af"}}>{inv.supplier}</div></div>:<span style={{color:"#d97706",fontWeight:600}}>⚠ {rtl?"لا فاتورة":"No invoice"}</span>}</td>
</tr>})}</tbody></table></div>

<div style={{marginTop:12,background:"#f9fafb",borderRadius:12,padding:14,fontSize:11,color:"#6b7280"}}>
<div style={{fontWeight:700,marginBottom:6,color:"#374151"}}>📋 {rtl?"تعليمات":"Instructions"}:</div>
<div>• <strong>{rtl?"بدون فاتورة (أصفر)":"No Invoice (yellow)"}</strong>: {rtl?"المنتج لم يُسجَّل عبر فاتورة شراء — أنشئ فاتورة من تبويب المشتريات":"Product was added without a purchase invoice — create one in Purchases tab"}</div>
<div>• <strong>{rtl?"اختلاف بالسعر (أحمر)":"Variance (red)"}</strong>: {rtl?"التكلفة الحالية لا تطابق آخر فاتورة — راجع وصحّح":"Current cost doesn't match latest invoice — review & correct"}</div>
<div>• {rtl?"عدّل أي حقل ثم اضغط حفظ الكل لتطبيق كل التغييرات دفعة واحدة":"Edit any field then click Save All to apply changes in bulk"}</div>
<div>• {rtl?"الهامش يُحسب تلقائياً من (السعر - التكلفة) / التكلفة × 100":"Margin auto-calculates from (Price - Cost) / Cost × 100"}</div>
</div>
</>})()}

{atab==="purchases"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>🧾 {t.purchases}</h2>
<ExportButtons title={rtl?"تقرير فواتير الشراء":"Purchase Invoices Report"} getExportData={()=>{
  const headers=[rtl?"رقم الفاتورة":"Invoice#",rtl?"التاريخ":"Date",rtl?"المورد":"Supplier",rtl?"عدد البنود":"Items",rtl?"الإجمالي":"Total",rtl?"طريقة الدفع":"Method",rtl?"استلمها":"Received By"];
  const rows=invs.map(inv=>[inv.invoiceNo||"—",inv.date||"—",inv.supplier||"—",(inv.items||[]).length,(+inv.totalCost).toFixed(3),inv.payMethod||"—",inv.receivedBy||"—"]);
  const total=invs.reduce((s,inv)=>s+ +inv.totalCost,0);
  const summary=[
    {label:rtl?"عدد الفواتير":"Invoices",value:invs.length,color:"#1e40af"},
    {label:rtl?"الإجمالي":"Total",value:fm(total),color:"#dc2626"},
    {label:rtl?"عدد الموردين":"Suppliers",value:[...new Set(invs.map(i=>i.supplier).filter(Boolean))].length,color:"#059669"},
    {label:rtl?"عدد البنود":"Total Items",value:invs.reduce((s,inv)=>s+(inv.items||[]).length,0),color:"#7c3aed"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:true};
}}/></div>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>{openNewInvoice();setInvPayMethod("bank");const ba=bankAccts.find(a=>a.name.toLowerCase().includes("main")||a.name.toLowerCase().includes("bank")||(a.bank_name));if(ba)setInvBankAcct(ba.id.toString());else setInvBankAcct("")}}>{t.addInv}</button>{!invs.length?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>📋 {t.noInv}</div>:invs.map(inv=>{
  const isRecon = inv.is_reconciliation;
  const reconStatus = inv.reconciliation_status || "normal";
  const borderColor = reconStatus==="pending_reconciliation" ? "#f59e0b" : reconStatus==="reconciled" ? "#10b981" : "#e5e7eb";
  const bgColor = reconStatus==="pending_reconciliation" ? "#fffbeb" : reconStatus==="reconciled" ? "#ecfdf5" : "#fff";
  return <div key={inv.id} className="inv-card" onClick={()=>setInvView(inv)} style={{background:bgColor,border:"2px solid "+borderColor}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"center",flexWrap:"wrap",gap:6}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontFamily:"var(--m)",fontSize:13,fontWeight:700,color:"#2563eb"}}>{inv.invoiceNo}</span>
        {isRecon && reconStatus==="pending_reconciliation" && <span style={{padding:"3px 10px",background:"#f59e0b",color:"#fff",borderRadius:12,fontSize:9,fontWeight:800}}>⏳ {rtl?"بانتظار المطابقة":"PENDING RECONCILIATION"}</span>}
        {reconStatus==="reconciled" && <span style={{padding:"3px 10px",background:"#10b981",color:"#fff",borderRadius:12,fontSize:9,fontWeight:800}}>✓ {rtl?"تم المطابقة":"RECONCILED"}</span>}
        {isRecon && <span style={{padding:"2px 8px",background:"#7c3aed",color:"#fff",borderRadius:10,fontSize:9,fontWeight:700}}>🔍 {rtl?"مطابقة":"AUDIT"}</span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:11,color:"#9ca3af"}}>{inv.date}</span>
        {isRecon && reconStatus==="pending_reconciliation" && <button onClick={(e)=>{e.stopPropagation();openReconciliationReport(inv)}} style={{padding:"5px 12px",background:"#f59e0b",color:"#fff",border:"none",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer"}}>🔍 {rtl?"مطابقة":"Reconcile"}</button>}
        {reconStatus==="reconciled" && <button onClick={(e)=>{e.stopPropagation();openReconciliationReport(inv)}} style={{padding:"5px 12px",background:"#10b981",color:"#fff",border:"none",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer"}}>👁 {rtl?"عرض":"View Report"}</button>}
        {cu.role==="admin"&&<button className="ab ab-d" style={{fontSize:9,padding:"2px 6px"}} onClick={async(e)=>{e.stopPropagation();if(!confirm(rtl?"حذف الفاتورة؟":"Delete invoice?"))return;setInvs(p=>p.filter(x=>x.id!==inv.id));try{await DB.deleteInvoice(inv.id)}catch{}}}>✕</button>}
      </div>
    </div>
    <div style={{fontSize:13,fontWeight:500}}>🏭 {inv.supplier}</div>
    <div style={{fontSize:12,color:"#9ca3af",marginTop:4}}>
      {inv.attachment&&<span style={{marginRight:6}}>📎</span>}{inv.items.length} {t.items} · <span style={{color:"#059669",fontFamily:"var(--m)",fontWeight:700}}>{fm(inv.totalCost)}</span>
      {reconStatus==="reconciled"&&inv.reconciled_by_name&&<span style={{marginLeft:8,fontSize:10,color:"#059669"}}>· {rtl?"طابقها":"Reconciled by"}: {inv.reconciled_by_name}</span>}
    </div>
  </div>;
})}</>}

{atab==="users"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>👥 {t.users} & {t.permissions}</h2>
<ExportButtons title={rtl?"تقرير المستخدمين":"Users Report"} getExportData={()=>{
  const headers=[rtl?"اسم المستخدم":"Username",rtl?"الاسم الكامل":"Full Name",rtl?"الدور":"Role",rtl?"الحالة":"Status",rtl?"تاريخ الإنشاء":"Created"];
  const rows=users.map(u=>[u.un||"—",u.fn||"—",u.role||"—",u.active?(rtl?"نشط":"Active"):(rtl?"معطل":"Inactive"),u.created_at?new Date(u.created_at).toLocaleDateString():"—"]);
  const summary=[
    {label:rtl?"إجمالي المستخدمين":"Total Users",value:users.length,color:"#1e40af"},
    {label:rtl?"نشط":"Active",value:users.filter(u=>u.active).length,color:"#059669"},
    {label:rtl?"مدراء":"Admins",value:users.filter(u=>u.role==="admin").length,color:"#7c3aed"},
    {label:rtl?"كاشيرين":"Cashiers",value:users.filter(u=>u.role==="cashier").length,color:"#d97706"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:false};
}}/></div>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:12}} onClick={()=>setAUM(true)}>{t.addUser}</button>
<table className="at"><thead><tr><th>{t.user}</th><th>{t.name}</th><th>{t.role}</th><th style={{textAlign:"center"}}>{t.act}</th><th>{t.permissions}</th><th>{t.pass}</th><th></th></tr></thead><tbody>{users.map(u=><tr key={u.id}>
<td style={{fontFamily:"var(--m)",fontWeight:600}}>{u.un}</td>
<td><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:28,height:28,borderRadius:"50%",overflow:"hidden",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{u.avatar?<img src={u.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:12,fontWeight:700,color:"#9ca3af"}}>{(u.fn||"?").charAt(0)}</span>}</div><span style={{fontWeight:500}}>{rtl?(u.fa||u.fn):u.fn}</span></div></td>
<td><span style={{padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:600,background:u.role==="admin"?"#fef2f2":u.role==="manager"?"#eff6ff":"#f9fafb",color:u.role==="admin"?"#dc2626":u.role==="manager"?"#2563eb":"#6b7280"}}>{u.role==="admin"?t.adminR:u.role==="manager"?t.manager:t.cashier}</span></td>
<td style={{textAlign:"center"}}><span className={"us "+(u.st==="active"?"us-a":"us-i")} onClick={async()=>{const ns=u.st==="active"?"inactive":"active";setUsers(p=>p.map(x=>x.id===u.id?{...x,st:ns}:x));try{await DB.updateUser(u.id,{status:ns})}catch(e){console.error(e)}}}>{u.st==="active"?t.on:t.off}</span></td>
<td><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{PERM_KEYS.filter(pk=>u.perms?.[pk.k]).map(pk=><span key={pk.k} style={{fontSize:9,background:"#ecfdf5",color:"#059669",padding:"2px 6px",borderRadius:6,fontWeight:500}}>{pk.i}</span>)}{PERM_KEYS.filter(pk=>!u.perms?.[pk.k]).length===PERM_KEYS.length&&<span style={{fontSize:9,color:"#d1d5db"}}>POS only</span>}</div></td>
<td><button className="ab ab-p" onClick={()=>{setPWM(u);setNPW("")}}>🔐</button></td>
<td style={{whiteSpace:"nowrap"}}><button className="ab ab-e" onClick={()=>{setEditUserMod(u);setEditUserData({fn:u.fn,fa:u.fa,role:u.role,perms:{...u.perms},avatar:u.avatar||null})}}>✎ {t.editUser}</button>{u.id!==1&&<button className="ab ab-d" style={{marginLeft:4}} onClick={async()=>{setUsers(p=>p.filter(x=>x.id!==u.id));try{await DB.deleteUser(u.id)}catch(e){console.error(e)}}}>✕</button>}</td>
</tr>)}</tbody></table>

{/* Permissions legend */}
<div style={{marginTop:14,background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:12,padding:14}}>
<div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>📋 {t.permissions} — {rtl?"دليل":"Legend"}</div>
<div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#6b7280"}}>
{PERM_KEYS.map(pk=><span key={pk.k}>{pk.i} {t[PERM_LABELS[pk.k]]}</span>)}
</div></div>
</>}

{atab==="sales_admin"&&<><h2>📋 {t.salesView}</h2>
<div style={{display:"flex",gap:8,marginBottom:12}}>
<button className="ab ab-x" style={{padding:"8px 16px",fontSize:12}} onClick={()=>exportXL(prods,txns,invs)}>📥 {t.excel}</button>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12}} onClick={async()=>{try{const tx=await DB.getTransactions();setTxns(tx);sT("✓ Refreshed","ok")}catch{}}}>🔄 Refresh</button>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
<div className="dc" style={{borderLeft:"4px solid #059669"}}><div className="dcl">{t.totalSales}</div><div className="dcv g">{fm(tT)}</div><div className="dcc">{tC} {t.txns.toLowerCase()}</div></div>
<div className="dc" style={{borderLeft:"4px solid #2563eb"}}><div className="dcl">{t.avgTxn}</div><div className="dcv b">{fm(aT)}</div></div>
<div className="dc" style={{borderLeft:"4px solid #7c3aed"}}><div className="dcl">{t.sold}</div><div className="dcv p">{tIS}</div></div>
<div className="dc" style={{borderLeft:"4px solid #d97706"}}><div className="dcl">{t.customers}</div><div className="dcv y">{txns.filter(tx=>tx.custName).length}</div></div>
</div>
<div className="tb"><table><thead><tr><th>{t.receipt}</th><th>{t.time}</th><th>👤</th><th>#</th><th>{t.method}</th><th>{t.total}</th></tr></thead>
<tbody>{txns.slice(0,50).map(tx=><tr key={tx.id} style={{cursor:"pointer"}} onClick={()=>openReceiptWithItems(tx)}><td className="mn" style={{fontSize:11}}>{tx.rn}</td><td style={{fontSize:11}}>{tx.date} {tx.time}</td><td style={{fontSize:11,color:tx.custName?"#2563eb":"#d1d5db"}}>{tx.custName||"—"}</td><td style={{fontFamily:"var(--m)"}}>{tx.items.reduce((s,i)=>s+i.qty,0)}</td><td><span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:tx.method==="cash"?"#ecfdf5":tx.method==="card"?"#eff6ff":"#f5f3ff",color:tx.method==="cash"?"#059669":tx.method==="card"?"#2563eb":"#7c3aed"}}>{tx.method==="mobile"?t.mada:tx.method==="card"?t.card:t.cash}</span></td><td className="mn" style={{color:"#059669"}}>{fm(tx.tot)}</td></tr>)}</tbody></table></div>
</>}

{atab==="loyalty"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><h2 style={{margin:0}}>⭐ {t.loyalty}</h2>
<ExportButtons title={rtl?"تقرير العملاء والولاء":"Customers & Loyalty Report"} getExportData={()=>{
  const headers=[rtl?"الاسم":"Name",rtl?"الهاتف":"Phone",rtl?"الفئة":"Tier",rtl?"النقاط":"Points",rtl?"إجمالي الإنفاق":"Total Spent",rtl?"الزيارات":"Visits"];
  const rows=customers.map(c=>[c.name||"—",c.phone||"—",c.tier||"bronze",c.pts||0,(+(c.spent||0)).toFixed(3),c.visits||0]);
  const totalSpent=customers.reduce((s,c)=>s+ +(c.spent||0),0);
  const summary=[
    {label:rtl?"عدد العملاء":"Customers",value:customers.length,color:"#1e40af"},
    {label:"VIP",value:customers.filter(c=>c.tier==="vip").length,color:"#7c3aed"},
    {label:rtl?"إجمالي الإنفاق":"Total Spent",value:fm(totalSpent),color:"#059669"},
    {label:rtl?"إجمالي النقاط":"Total Points",value:customers.reduce((s,c)=>s+(c.pts||0),0),color:"#d97706"}
  ];
  return {headers,rows,summary,filters:[],showSignatures:false};
}}/></div>

{/* Loyalty Sub-tabs */}
<div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
{[{k:"customers",i:"👥",l:t.customers},{k:"promotions",i:"🎯",l:rtl?"العروض":"Promotions"},{k:"coupons",i:"🎟️",l:rtl?"القسائم":"Coupons"}].map(s=><button key={s.k} onClick={()=>setLoyaltyTab(s.k)} style={{padding:"8px 16px",borderRadius:10,border:"1.5px solid "+(loyaltyTab===s.k?"#7c3aed":"#e5e7eb"),background:loyaltyTab===s.k?"#f5f3ff":"#fff",color:loyaltyTab===s.k?"#7c3aed":"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>{s.i} {s.l}</button>)}
</div>

{/* ── CUSTOMERS TAB ── */}
{loyaltyTab==="customers"&&<>
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
<td><button className="ab ab-e" onClick={async()=>{setCustViewMod(c);try{const h=await DB.getLoyaltyHistory(c.id);setCustHistory(h)}catch{setCustHistory([])}}}>👁 {rtl?"عرض":"View"}</button>{cu.role==="admin"&&<button className="ab ab-d" style={{marginLeft:4}} onClick={async()=>{if(!confirm(rtl?"حذف العميل؟":"Delete customer?"))return;setCustomers(p=>p.filter(x=>x.id!==c.id));try{await DB.deleteCustomer(c.id)}catch{}}}>✕</button>}</td>
</tr>)}</tbody></table>}
</>}

{/* ── PROMOTIONS TAB ── */}
{loyaltyTab==="promotions"&&<>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:14}} onClick={()=>setPromoMod(true)}>🎯 {rtl?"إضافة عرض":"Add Promotion"}</button>

{/* Active Promotions */}
{promotions.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40}}>🎯</div>{rtl?"لا عروض بعد":"No promotions yet"}</div>:
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
{promotions.map(p=>{
const typeColors={buy_x_get_y:"#7c3aed",percent_off:"#059669",fixed_off:"#2563eb",category_discount:"#d97706",happy_hour:"#ea580c",campaign:"#dc2626"};
const typeLabels={buy_x_get_y:rtl?"اشتر X واحصل Y":"Buy X Get Y",percent_off:rtl?"خصم %":"% Off",fixed_off:rtl?"خصم ثابت":"Fixed Off",category_discount:rtl?"خصم فئة":"Category",happy_hour:rtl?"ساعة سعيدة":"Happy Hour",campaign:rtl?"حملة":"Campaign"};
const isActive=p.status==="active"&&(!p.start_date||new Date(p.start_date)<=new Date())&&(!p.end_date||new Date(p.end_date)>=new Date());
return<div key={p.id} style={{background:"#fff",border:"1.5px solid "+(isActive?"#86efac":"#e5e7eb"),borderRadius:16,padding:16,position:"relative"}}>
<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:typeColors[p.promo_type]||"#6b7280",borderRadius:"16px 16px 0 0"}}/>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginTop:4}}>
<div>
<div style={{fontSize:14,fontWeight:700}}>{rtl?p.name_ar:p.name}</div>
<span style={{padding:"2px 8px",borderRadius:14,fontSize:9,fontWeight:600,background:(typeColors[p.promo_type]||"#6b7280")+"18",color:typeColors[p.promo_type]||"#6b7280"}}>{typeLabels[p.promo_type]}</span>
</div>
<div style={{display:"flex",gap:4}}>
<button onClick={async()=>{const ns=p.status==="active"?"paused":"active";setPromotions(pr=>pr.map(x=>x.id===p.id?{...x,status:ns}:x));try{await DB.updatePromotion(p.id,{status:ns})}catch{}}} style={{padding:"4px 8px",borderRadius:6,border:"none",background:p.status==="active"?"#fef2f2":"#ecfdf5",color:p.status==="active"?"#dc2626":"#059669",fontSize:9,cursor:"pointer",fontWeight:700}}>{p.status==="active"?"⏸":"▶"}</button>
{cu.role==="admin"&&<button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setPromotions(pr=>pr.filter(x=>x.id!==p.id));try{await DB.deletePromotion(p.id)}catch{}}}>✕</button>}
</div>
</div>
<div style={{marginTop:10,fontSize:12}}>
{p.promo_type==="percent_off"&&<div style={{fontSize:24,fontWeight:800,color:"#059669"}}>{p.discount_value}% {rtl?"خصم":"OFF"}</div>}
{p.promo_type==="fixed_off"&&<div style={{fontSize:24,fontWeight:800,color:"#2563eb"}}>{fm(+p.discount_value)} {rtl?"خصم":"OFF"}</div>}
{p.promo_type==="buy_x_get_y"&&<div style={{fontSize:18,fontWeight:800,color:"#7c3aed"}}>{rtl?"اشتر":"Buy"} {p.buy_qty} {rtl?"واحصل":"Get"} {p.get_qty} {rtl?"مجاناً":"Free"}</div>}
{p.promo_type==="happy_hour"&&<div style={{fontSize:18,fontWeight:800,color:"#ea580c"}}>{p.start_hour||0}:00 — {p.end_hour||0}:00 · {p.discount_value}%</div>}
{p.promo_type==="campaign"&&<div style={{fontSize:18,fontWeight:800,color:"#dc2626"}}>{p.discount_value}% {rtl?"خصم حملة":"Campaign"}</div>}
</div>
<div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#9ca3af",marginTop:8}}>
<span>{p.start_date||"—"} → {p.end_date||"∞"}</span>
<span>{p.max_uses>0?p.used_count+"/"+p.max_uses+" "+t.visits:rtl?"غير محدود":"Unlimited"}</span>
</div>
</div>})}
</div>}
</>}

{/* ── COUPONS TAB ── */}
{loyaltyTab==="coupons"&&<>
<button className="ab ab-s" style={{padding:"8px 16px",fontSize:12,marginBottom:14}} onClick={()=>setCouponMod(true)}>🎟️ {rtl?"إنشاء قسيمة":"Create Coupon"}</button>

{coupons.length===0?<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}><div style={{fontSize:40}}>🎟️</div>{rtl?"لا قسائم":"No coupons"}</div>:
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
{coupons.map(cp=>{
const isValid=cp.status==="active"&&(!cp.valid_until||new Date(cp.valid_until)>=new Date())&&cp.used_count<cp.max_uses;
return<div key={cp.id} style={{background:isValid?"linear-gradient(135deg,#f5f3ff,#ede9fe)":"#f9fafb",border:"2px dashed "+(isValid?"#7c3aed":"#d1d5db"),borderRadius:16,padding:16,position:"relative"}}>
{/* Ticket notch */}
<div style={{position:"absolute",top:"50%",left:-8,width:16,height:16,borderRadius:"50%",background:"var(--g50)"}}/>
<div style={{position:"absolute",top:"50%",right:-8,width:16,height:16,borderRadius:"50%",background:"var(--g50)"}}/>

<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
<div>
<div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:isValid?"#7c3aed":"#9ca3af",letterSpacing:2}}>{cp.code}</div>
<div style={{fontSize:12,marginTop:4}}>
{cp.coupon_type==="percent"&&<span style={{fontWeight:700,color:"#059669"}}>{cp.discount_value}% {rtl?"خصم":"OFF"}</span>}
{cp.coupon_type==="fixed"&&<span style={{fontWeight:700,color:"#2563eb"}}>{fm(+cp.discount_value)} {rtl?"خصم":"OFF"}</span>}
{cp.coupon_type==="freeitem"&&<span style={{fontWeight:700,color:"#d97706"}}>{rtl?"منتج مجاني":"Free Item"}</span>}
</div>
</div>
<div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
<span style={{padding:"3px 8px",borderRadius:14,fontSize:9,fontWeight:700,background:isValid?"#ecfdf5":"#fef2f2",color:isValid?"#059669":"#dc2626"}}>{isValid?(rtl?"فعال":"Active"):(rtl?"منتهي":"Expired")}</span>
{cu.role==="admin"&&<button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف؟":"Delete?"))return;setCoupons(p=>p.filter(x=>x.id!==cp.id));try{await DB.deleteCoupon(cp.id)}catch{}}}>✕</button>}
</div>
</div>

<div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6b7280",marginTop:10}}>
<span>{rtl?"صالح حتى":"Valid until"}: {cp.valid_until||"∞"}</span>
<span>{cp.used_count}/{cp.max_uses} {rtl?"استخدام":"uses"}</span>
</div>
{cp.min_purchase>0&&<div style={{fontSize:10,color:"#d97706",marginTop:4}}>{rtl?"حد أدنى":"Min"}: {fm(+cp.min_purchase)}</div>}

{/* QR Code Button */}
<button onClick={async()=>{try{const url=await QRCode.toDataURL("3045-COUPON:"+cp.code,{width:250,margin:2,color:{dark:"#7c3aed",light:"#ffffff"}});setCouponQR({code:cp.code,url,coupon:cp})}catch(e){console.error(e)}}} style={{marginTop:10,padding:"8px 16px",background:"#7c3aed",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",width:"100%"}}>📱 {rtl?"عرض QR":"Show QR"}</button>
</div>})}
</div>}
</>}

</>}

{atab==="settings"&&<><h2>⚙️ {t.settings}</h2>

{cu.role==="admin"&&<div style={{background:"linear-gradient(135deg,#1e40af,#7c3aed)",borderRadius:16,padding:20,marginBottom:14,color:"#fff",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
<div style={{flex:"1 1 280px"}}>
<div style={{fontSize:11,opacity:.9,marginBottom:4}}>🚀 {rtl?"إعداد اليوم الأول":"Day One Setup"}</div>
<div style={{fontSize:18,fontWeight:800}}>{rtl?"معالج إعداد المتجر للانطلاق":"Store Go-Live Wizard"}</div>
<div style={{fontSize:12,opacity:.85,marginTop:4}}>{rtl?"دليل خطوة بخطوة لتجهيز النظام للعمل الفعلي":"Step-by-step guide to prepare your store for operations"}</div>
</div>
<button onClick={()=>{setSetupData(p=>({...p,storeName:storeSettings.storeName||"3045 Supermarket"}));setSetupStep(1);setSetupMod(true)}} style={{padding:"12px 24px",background:"#fff",border:"none",borderRadius:10,color:"#1e40af",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>🎯 {rtl?"بدء المعالج":"Start Wizard"}</button>
</div>}

{/* Store Information */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:20,marginBottom:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:14}}>🏪 {t.storeInfo}</div>
<div className="sf">
<label>{t.store}</label>
<input value={storeSettings.storeName} onChange={e=>setStoreSettings(p=>({...p,storeName:e.target.value}))}/>
<div style={{display:"flex",gap:12,marginTop:8}}>
<div style={{flex:1}}><label>{t.taxR}</label><input type="number" value={storeSettings.taxRate} onChange={e=>setStoreSettings(p=>({...p,taxRate:+e.target.value}))}/></div>
<div style={{flex:1}}><label>{t.curr}</label><input value={storeSettings.currency} onChange={e=>setStoreSettings(p=>({...p,currency:e.target.value}))}/></div>
</div>
</div></div>

{/* Goals & Targets */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:16,padding:20,marginBottom:14}}>
<div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:14}}>🎯 {t.goals}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
<div style={{background:"#ecfdf5",borderRadius:14,padding:16,textAlign:"center"}}>
<div style={{fontSize:11,color:"#065f46",fontWeight:600,marginBottom:6}}>📅 {t.dailyTarget}</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
<input type="number" value={storeSettings.dailyTarget} onChange={e=>setStoreSettings(p=>({...p,dailyTarget:+e.target.value}))} style={{width:100,padding:"10px 12px",background:"#fff",border:"2px solid #d1fae5",borderRadius:10,fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#059669",textAlign:"center",outline:"none"}}/>
<span style={{fontSize:12,color:"#6b7280"}}>JD</span>
</div>
</div>
<div style={{background:"#eff6ff",borderRadius:14,padding:16,textAlign:"center"}}>
<div style={{fontSize:11,color:"#1e40af",fontWeight:600,marginBottom:6}}>📆 {t.weeklyTarget}</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
<input type="number" value={storeSettings.weeklyTarget} onChange={e=>setStoreSettings(p=>({...p,weeklyTarget:+e.target.value}))} style={{width:100,padding:"10px 12px",background:"#fff",border:"2px solid #bfdbfe",borderRadius:10,fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb",textAlign:"center",outline:"none"}}/>
<span style={{fontSize:12,color:"#6b7280"}}>JD</span>
</div>
</div>
<div style={{background:"#f5f3ff",borderRadius:14,padding:16,textAlign:"center"}}>
<div style={{fontSize:11,color:"#5b21b6",fontWeight:600,marginBottom:6}}>📅 {t.monthlyTarget}</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
<input type="number" value={storeSettings.monthlyTarget} onChange={e=>setStoreSettings(p=>({...p,monthlyTarget:+e.target.value}))} style={{width:100,padding:"10px 12px",background:"#fff",border:"2px solid #c4b5fd",borderRadius:10,fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed",textAlign:"center",outline:"none"}}/>
<span style={{fontSize:12,color:"#6b7280"}}>JD</span>
</div>
</div>
</div>

{/* Current Progress */}
<div style={{marginTop:16,background:"#f9fafb",borderRadius:12,padding:14}}>
<div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:10}}>{rtl?"التقدم الحالي":"Current Progress"}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
{[{label:t.today,val:txns.filter(tx=>{try{return new Date(tx.ts).toDateString()===new Date().toDateString()}catch{return false}}).reduce((s,t2)=>s+t2.tot,0),target:storeSettings.dailyTarget,color:"#059669"},
{label:t.week,val:txns.filter(tx=>{try{const wa=new Date();wa.setDate(wa.getDate()-7);return new Date(tx.ts)>=wa}catch{return false}}).reduce((s,t2)=>s+t2.tot,0),target:storeSettings.weeklyTarget,color:"#2563eb"},
{label:t.month,val:txns.filter(tx=>{try{const ma=new Date();ma.setDate(ma.getDate()-30);return new Date(tx.ts)>=ma}catch{return false}}).reduce((s,t2)=>s+t2.tot,0),target:storeSettings.monthlyTarget,color:"#7c3aed"}
].map((g,i)=>{const gpct=Math.min(100,(g.val/g.target*100));return<div key={i}>
<div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6b7280",marginBottom:4}}><span>{g.label}</span><span>{gpct.toFixed(0)}%</span></div>
<div style={{height:8,background:"#e5e7eb",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:gpct+"%",background:g.color,borderRadius:4,transition:"width .5s"}}/></div>
<div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:4}}><span style={{fontFamily:"var(--m)",fontWeight:700,color:g.color}}>{fm(g.val)}</span><span style={{color:"#9ca3af"}}>{fm(g.target)}</span></div>
</div>})}
</div></div>
</div>

{/* Custom Categories Management */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:16,marginTop:14}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:10}}>📁 {rtl?"إدارة الفئات المخصصة":"Custom Categories"}</div>
<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
{CATS_ALL.filter(c=>c.id!=="all").map(c=><span key={c.id} style={{padding:"4px 10px",borderRadius:8,fontSize:11,fontWeight:600,background:"#f3f4f6",color:"#374151"}}>{c.i} {t[c.k]||c.id}</span>)}
</div>
<div style={{display:"flex",gap:6}}>
<input id="ncn" placeholder={rtl?"اسم الفئة الجديدة":"New category name"} style={{flex:1,padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="nce" placeholder="📁" style={{width:50,padding:"8px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:16,textAlign:"center",outline:"none"}}/>
<button onClick={()=>{const ne=document.getElementById("ncn");const ee=document.getElementById("nce");const nm=ne?ne.value:"";const em=(ee&&ee.value)||"📁";if(!nm)return;const id="cat_"+Date.now().toString(36);const nc=[...customCats,{id:id,name:nm,emoji:em}];setCustomCats(nc);DB.setSetting("custom_categories",nc);if(ne)ne.value="";if(ee)ee.value="";sT("✓ "+(rtl?"تمت الإضافة":"Added"),"ok")}} style={{padding:"8px 16px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>+</button>
</div>
{customCats.length>0&&<div style={{marginTop:10}}>
{customCats.map((c,i)=><div key={i} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",background:"#ecfdf5",borderRadius:8,fontSize:11,margin:"2px 4px",border:"1px solid #d1fae5"}}>
{c.emoji} {c.name} <button onClick={()=>{const nc=customCats.filter((x,xi)=>xi!==i);setCustomCats(nc);DB.setSetting("custom_categories",nc)}} style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:10,padding:0}}>✕</button>
</div>)}
</div>}
</div>

{/* Supplier Management */}
<div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:14,padding:16,marginTop:14}}>
<div style={{fontSize:14,fontWeight:700,marginBottom:10}}>🏭 {rtl?"إدارة الموردين":"Supplier Management"}</div>
<div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
<input id="sup-name" placeholder={rtl?"اسم المورد":"Supplier name"} style={{flex:"2 1 160px",padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="sup-rep" placeholder={rtl?"اسم المندوب":"Rep name"} style={{flex:"1 1 120px",padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<input id="sup-phone" placeholder={rtl?"الهاتف":"Phone"} style={{flex:"1 1 120px",padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--m)",outline:"none"}}/>
<input id="sup-terms" placeholder={rtl?"الشروط":"Terms"} style={{flex:"1 1 100px",padding:"8px 12px",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:13,fontFamily:"var(--f)",outline:"none"}}/>
<button onClick={()=>{const ne=document.getElementById("sup-name");const re=document.getElementById("sup-rep");const pe=document.getElementById("sup-phone");const te=document.getElementById("sup-terms");const nm=ne?ne.value:"";const rp=re?re.value:"";const ph=pe?pe.value:"";const tr=te?te.value:"";if(!nm)return;const ns=[...suppliers,{id:"sup_"+Date.now().toString(36),name:nm,rep:rp,phone:ph,terms:tr||"Cash"}];setSuppliers(ns);DB.setSetting("suppliers",ns);if(ne)ne.value="";if(re)re.value="";if(pe)pe.value="";if(te)te.value="";sT("✓ "+(rtl?"تمت الإضافة":"Added"),"ok")}} style={{padding:"8px 16px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>+</button>
</div>
{suppliers.length>0&&<table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
<thead><tr style={{background:"#f9fafb"}}><th style={{padding:6,textAlign:rtl?"right":"left"}}>{rtl?"الاسم":"Name"}</th><th style={{padding:6,textAlign:rtl?"right":"left"}}>{rtl?"الهاتف":"Phone"}</th><th style={{padding:6,textAlign:rtl?"right":"left"}}>{rtl?"الشروط":"Terms"}</th><th></th></tr></thead>
<tbody>{suppliers.map((s,i)=><tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
<td style={{padding:6,fontWeight:600}}>{s.name}</td>
<td style={{padding:6,fontFamily:"var(--m)"}}>{s.phone||"—"}</td>
<td style={{padding:6}}>{s.terms||"Cash"}</td>
<td style={{padding:6,textAlign:rtl?"left":"right"}}><button onClick={()=>{const ns=suppliers.filter((x,xi)=>xi!==i);setSuppliers(ns);DB.setSetting("suppliers",ns)}} style={{background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:14}}>✕</button></td>
</tr>)}</tbody>
</table>}
{suppliers.length===0&&<div style={{textAlign:"center",color:"#9ca3af",fontSize:12,padding:10}}>{rtl?"لا موردين بعد":"No suppliers yet"}</div>}
</div>

<button className="svb" onClick={()=>{DB.setSetting("store_settings",storeSettings);sT("✓ "+t.saved,"ok")}}>{t.saveSt}</button>
</>}
</div></div>}
</div>

{/* MISC / WEIGHT ITEM MODAL */}
{miscMod&&<div className="ov" onClick={()=>setMiscMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
<h2>➕ {rtl?"إضافة متفرقات":"Add Misc Item"}<button className="mc" onClick={()=>setMiscMod(false)}>✕</button></h2>
<div style={{fontSize:11,color:"#6b7280",marginBottom:12}}>{rtl?"أضف صنف ليس في الكاتالوج (مثل خضار، فواكه، أو منتج بدون باركود)":"Add an item not in catalog (like vegetables, fruits, or items without barcode)"}</div>

{/* Mode selector */}
<div style={{display:"flex",gap:6,marginBottom:14}}>
<button onClick={()=>setMiscItem({...miscItem,mode:"qty"})} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+(miscItem.mode==="qty"?"#2563eb":"#e5e7eb"),background:miscItem.mode==="qty"?"#eff6ff":"#fff",color:miscItem.mode==="qty"?"#1e40af":"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📦 {rtl?"بالقطعة":"By Quantity"}</button>
<button onClick={()=>setMiscItem({...miscItem,mode:"weight"})} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+(miscItem.mode==="weight"?"#059669":"#e5e7eb"),background:miscItem.mode==="weight"?"#ecfdf5":"#fff",color:miscItem.mode==="weight"?"#065f46":"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>⚖️ {rtl?"بالوزن":"By Weight"}</button>
<button onClick={()=>setMiscItem({...miscItem,mode:"total"})} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+(miscItem.mode==="total"?"#d97706":"#e5e7eb"),background:miscItem.mode==="total"?"#fffbeb":"#fff",color:miscItem.mode==="total"?"#92400e":"#6b7280",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>💰 {rtl?"سعر مباشر":"Direct Price"}</button>
</div>

<div className="pf"><label>{rtl?"اسم الصنف":"Item Name"}</label><input value={miscItem.name} onChange={e=>setMiscItem({...miscItem,name:e.target.value})} placeholder={rtl?"مثال: خيار، بطاطا...":"e.g. Cucumber, Potato..."} autoFocus/></div>

{miscItem.mode==="qty"&&<>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"السعر / قطعة (JD)":"Price/unit (JD)"}</label><input type="number" step="0.001" value={miscItem.price} onChange={e=>setMiscItem({...miscItem,price:e.target.value})} placeholder="0.000"/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"الكمية":"Quantity"}</label><input type="number" value={miscItem.qty} onChange={e=>setMiscItem({...miscItem,qty:e.target.value})} placeholder="1"/></div>
</div>
{miscItem.price&&miscItem.qty&&<div style={{background:"#ecfdf5",borderRadius:10,padding:10,textAlign:"center",marginBottom:10}}><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"الإجمالي":"Total"}</div><div style={{fontSize:22,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm((parseFloat(miscItem.price)||0)*(parseFloat(miscItem.qty)||0))}</div></div>}
</>}

{miscItem.mode==="weight"&&<>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"السعر / كغ (JD)":"Price/kg (JD)"}</label><input type="number" step="0.001" value={miscItem.price} onChange={e=>setMiscItem({...miscItem,price:e.target.value})} placeholder="0.000"/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"الوزن (كغ)":"Weight (kg)"}</label><input type="number" step="0.001" value={miscItem.qty} onChange={e=>setMiscItem({...miscItem,qty:e.target.value})} placeholder="0.000"/></div>
</div>
{miscItem.price&&miscItem.qty&&<div style={{background:"#ecfdf5",borderRadius:10,padding:10,textAlign:"center",marginBottom:10}}><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"الإجمالي":"Total"}: {miscItem.qty} {rtl?"كغ":"kg"} × {miscItem.price}</div><div style={{fontSize:22,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm((parseFloat(miscItem.price)||0)*(parseFloat(miscItem.qty)||0))}</div></div>}
</>}

{miscItem.mode==="total"&&<>
<div className="pf"><label>{rtl?"السعر الإجمالي (JD)":"Total Price (JD)"}</label><input type="number" step="0.001" value={miscItem.price} onChange={e=>setMiscItem({...miscItem,price:e.target.value})} placeholder="0.000"/></div>
{miscItem.price&&<div style={{background:"#fffbeb",borderRadius:10,padding:10,textAlign:"center",marginBottom:10}}><div style={{fontSize:10,color:"#92400e"}}>{rtl?"الإجمالي":"Total"}</div><div style={{fontSize:22,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{fm(parseFloat(miscItem.price)||0)}</div></div>}
</>}

<button className="cpb" disabled={!miscItem.name||!miscItem.price||(miscItem.mode!=="total"&&!miscItem.qty)} onClick={()=>{
const price=parseFloat(miscItem.price)||0;
const qty=miscItem.mode==="total"?1:(parseFloat(miscItem.qty)||1);
const lineTotal=miscItem.mode==="total"?price:price*qty;
const desc=miscItem.mode==="weight"?miscItem.name+" ("+qty+" "+(rtl?"كغ":"kg")+")":miscItem.name;
setCart(prev=>[...prev,{
  id:"misc_"+Date.now(),
  bc:"MISC",
  n:desc,
  a:desc,
  p:miscItem.mode==="total"?lineTotal:price,
  c:0,
  s:999,
  e:miscItem.mode==="weight"?"⚖️":"➕",
  qty:miscItem.mode==="total"?1:qty,
  _isMisc:true,
  _weight:miscItem.mode==="weight"?qty:null
}]);
setMiscMod(false);
setMiscItem({name:"",price:"",qty:"1",mode:"qty"});
sT("✓ "+(rtl?"تمت الإضافة":"Added"),"ok");
beep();
}}>✓ {rtl?"إضافة للسلة":"Add to Cart"}</button>
</div></div>}

{/* PAYMENT MODAL */}
{pmMod&&<div className="ov" onClick={()=>setPM(null)}><div className="md" onClick={e=>e.stopPropagation()}><h2>{pmMod==="cash"?"💵":pmMod==="card"?"💳":pmMod==="credit"?"📝":"📱"} {pmMod==="cash"?t.cashPay:pmMod==="card"?t.cardPay:pmMod==="credit"?(rtl?"بيع آجل":"Credit Sale"):t.madaPay}<button className="mc" onClick={()=>setPM(null)}>✕</button></h2>
{selCust&&<div style={{background:"var(--blue50)",borderRadius:12,padding:10,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:20}}>👤</span><div><div style={{fontSize:13,fontWeight:700,color:"#1e40af"}}>{selCust.name}</div><div style={{fontSize:10,color:"#6b7280"}}>{selCust.phone} · {t[selCust.tier]}</div></div></div><div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#059669",fontWeight:600}}>+{earnablePts} {t.points}</div>{redeemPts>0&&<div style={{fontSize:10,color:"#7c3aed",fontWeight:600}}>-{redeemPts} {t.points} ({fm(redeemVal)})</div>}</div></div>}
<div className="ptd">{fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</div>
{redeemPts>0&&selCust&&<div style={{textAlign:"center",fontSize:11,color:"#7c3aed",marginTop:-10,marginBottom:10}}>🎁 {t.redeemPts}: -{fm(redeemVal)}</div>}
{pmMod==="cash"&&<><div className="pf"><label>{t.tendered}</label><input type="number" value={cTend} onChange={e=>setCT(e.target.value)} autoFocus placeholder="0.000"/></div>{parseFloat(cTend)>=(selCust&&redeemPts>0?totAfterRedeem:tot)&&<div className="chd"><div className="chl">{t.change}</div><div className="cha">{fm(parseFloat(cTend)-(selCust&&redeemPts>0?totAfterRedeem:tot))}</div></div>}</>}{pmMod==="card"&&<div style={{textAlign:"center",padding:24,color:"#6b7280"}}><div style={{fontSize:48,marginBottom:12}}>💳</div>{t.insertCard}</div>}{pmMod==="mobile"&&<div style={{textAlign:"center",padding:24,color:"#6b7280"}}><div style={{fontSize:48,marginBottom:12}}>📱</div>{t.scanMada}</div>}{pmMod==="credit"&&<div style={{textAlign:"center",padding:24,color:"#7c3aed"}}><div style={{fontSize:48,marginBottom:12}}>📝</div><div style={{fontSize:14,fontWeight:700}}>{rtl?"بيع آجل — على حساب العميل":"Credit Sale — on customer account"}</div><div style={{fontSize:12,color:"#6b7280",marginTop:8}}>👤 {selCust?.name} · {selCust?.phone}</div></div>}<button className="cpb cpb-green" onClick={cP} disabled={!canC||processing} style={{opacity:processing?0.5:1,cursor:processing?"wait":"pointer"}}>{processing?(rtl?"⏳ جاري الحفظ...":"⏳ Processing..."):"✓ "+t.confirm+" — "+fm(selCust&&redeemPts>0?totAfterRedeem:tot)}</button></div></div>}

{/* RECEIPT */}
{rcMod&&<div className="ov"><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:paperSize==="A4"?680:440}}>

{/* Paper size selector */}
<div style={{display:"flex",gap:4,marginBottom:10,justifyContent:"center"}}>
{["58mm","80mm","88mm","A4"].map(sz=><button key={sz} onClick={()=>{setPaperSize(sz);DB.setSetting("paper_size",sz)}} style={{padding:"6px 16px",borderRadius:8,border:paperSize===sz?"2px solid #1e40af":"1.5px solid #e2e8f0",background:paperSize===sz?"#eff6ff":"#fff",color:paperSize===sz?"#1e40af":"#64748b",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>{sz==="58mm"?"📜 58mm":sz==="80mm"?"🧾 80mm":sz==="88mm"?"🧾 88mm":"📄 A4"}</button>)}
</div>

{/* Receipt content */}
<div id="receipt-print-area" style={{fontFamily:"'Arial Black','Arial',sans-serif",fontWeight:600,fontSize:paperSize==="A4"?14:paperSize==="88mm"?14:paperSize==="80mm"?14:10,maxWidth:paperSize==="A4"?"100%":paperSize==="88mm"?340:paperSize==="80mm"?320:220,margin:"0 auto",background:"#fff",padding:paperSize==="A4"?"30px":"14px",border:"1px dashed #d1d5db",borderRadius:8,color:"#000"}}>

{/* Header */}
<div style={{textAlign:"center",marginBottom:paperSize==="A4"?16:8}}>
<img src={STORE_LOGO} alt="3045" style={{height:paperSize==="A4"?100:paperSize==="80mm"||paperSize==="88mm"?70:55,marginBottom:8}}/>
<div style={{fontSize:paperSize==="A4"?22:paperSize==="80mm"||paperSize==="88mm"?16:13,fontWeight:900}}>{storeSettings.storeName||"3045 Supermarket"}</div>
<div style={{fontSize:paperSize==="A4"?12:9,color:"#6b7280"}}>{rtl?"إربد، شارع المدينة المنورة - مقابل SOS":"Irbid, Almadina Almonawarah St. (Opp. SOS)"}</div>
<div style={{fontSize:paperSize==="A4"?12:9,color:"#6b7280"}}>📞 0791191244</div>
<div style={{fontSize:paperSize==="A4"?12:9,color:"#6b7280"}}>{rcMod.date} · {rcMod.time}</div>
<div style={{fontSize:paperSize==="A4"?13:10,fontWeight:700,marginTop:4}}>{rtl?"فاتورة":"Receipt"}: {rcMod.rn}</div>
{rcMod.custName&&<div style={{fontSize:paperSize==="A4"?12:9,marginTop:4,fontWeight:600}}>👤 {rcMod.custName}{rcMod.custPhone?" · "+rcMod.custPhone:""}</div>}
</div>

<div style={{borderTop:"1px dashed #000",borderBottom:"1px dashed #000",padding:"4px 0",margin:"4px 0"}}>

{(!rcMod.items||rcMod.items.length===0)?<div style={{padding:"14px",textAlign:"center",background:"#fffbeb",border:"1.5px dashed #fbbf24",borderRadius:10,margin:"6px 0"}}><div style={{fontSize:12,color:"#92400e",fontWeight:700,marginBottom:8}}>⚠ {rtl?"لم يتم تحميل بنود الفاتورة":"Items not loaded"}</div><button onClick={async(e)=>{e.stopPropagation();try{const{data:items}=await sb.from("transaction_items").select("*").eq("transaction_id",rcMod.id).limit(5000);if(items&&items.length>0){const fixed={...rcMod,items:items.map(i=>({id:i.product_id||"misc_"+i.id,n:i.product_name||"—",a:i.product_name_ar||i.product_name||"—",bc:i.barcode||"MISC",p:+i.unit_price,qty:i.quantity,_isMisc:!i.product_id}))};setRM(fixed);setTxns(prev=>prev.map(x=>x.id===rcMod.id?fixed:x));sT("✓ "+(rtl?"تم تحميل البنود":"Items loaded"),"ok")}else{sT("⚠ "+(rtl?"لا توجد بنود لهذه الفاتورة في قاعدة البيانات":"No items found for this transaction"),"err")}}catch(er){sT("✗ "+er.message,"err")}}} style={{padding:"8px 18px",background:"#d97706",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>🔄 {rtl?"إعادة تحميل البنود من قاعدة البيانات":"Reload Items from Database"}</button></div>:

/* A4: Full table layout */
paperSize==="A4"?<table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
<thead><tr style={{borderBottom:"1px solid #000"}}>
<th style={{textAlign:rtl?"right":"left",padding:"6px 4px",fontWeight:700}}>#</th>
<th style={{textAlign:rtl?"right":"left",padding:"6px 4px",fontWeight:700}}>{t.product}</th>
<th style={{textAlign:"center",padding:"6px 4px",fontWeight:700}}>{t.bc}</th>
<th style={{textAlign:"center",padding:"6px 4px",fontWeight:700}}>{t.qty}</th>
<th style={{textAlign:"center",padding:"6px 4px",fontWeight:700}}>{t.price}</th>
<th style={{textAlign:rtl?"left":"right",padding:"6px 4px",fontWeight:700}}>{t.total}</th>
</tr></thead>
<tbody>{rcMod.items.map((i,x)=><tr key={x} style={{borderBottom:"1px dotted #ccc"}}>
<td style={{padding:"5px 4px",fontSize:11}}>{x+1}</td>
<td style={{padding:"5px 4px",fontWeight:600}}>{pN(i)}</td>
<td style={{padding:"5px 4px",textAlign:"center",fontSize:10,color:"#6b7280"}}>{i.bc}</td>
<td style={{padding:"5px 4px",textAlign:"center"}}>{i.qty}</td>
<td style={{padding:"5px 4px",textAlign:"center"}}>{fN(i.p)}</td>
<td style={{padding:"5px 4px",textAlign:rtl?"left":"right",fontWeight:700}}>{fN(i.p*i.qty)}</td>
</tr>)}</tbody>
</table>:

/* 58mm / 80mm: Compact receipt layout */
rcMod.items.map((i,x)=><div key={x} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontSize:paperSize==="80mm"||paperSize==="88mm"?11:9}}>
<div style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{pN(i)}</div>
<div style={{flexShrink:0,textAlign:"right",fontFamily:"monospace"}}> ×{i.qty} {fN(i.p*i.qty)}</div>
</div>)}

</div>

{/* Totals */}
<div style={{padding:"4px 0",fontSize:paperSize==="A4"?13:paperSize==="80mm"||paperSize==="88mm"?11:9}}>
<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span>{t.subtotal}</span><span style={{fontWeight:600}}>{fN(rcMod.sub)}</span></div>
{rcMod.dp>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span>{t.discount} ({rcMod.dp}%)</span><span>−{fN(rcMod.disc)}</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span>{t.vat} ({storeSettings.taxRate}%)</span><span>{fN(rcMod.tax)}</span></div>
{rcMod.ptsRedeemed>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0",color:"#7c3aed"}}><span>🎁 {t.redeemPts} ({rcMod.ptsRedeemed})</span><span>−{fN(DB.pointsToJD(rcMod.ptsRedeemed))}</span></div>}
<div style={{borderTop:"2px solid #000",marginTop:4,paddingTop:4,display:"flex",justifyContent:"space-between",fontSize:paperSize==="A4"?18:paperSize==="80mm"||paperSize==="88mm"?15:12,fontWeight:900}}>
<span>{t.total} (JD)</span><span>{fN(rcMod.tot)}</span>
</div>
</div>

{/* Payment info */}
<div style={{padding:"4px 0",fontSize:paperSize==="A4"?12:paperSize==="80mm"||paperSize==="88mm"?10:8,color:"#6b7280",borderTop:"1px dashed #000",marginTop:4}}>
<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span>{t.method}</span><span style={{fontWeight:700}}>{rcMod.method==="cash"?"💵 "+t.cash:rcMod.method==="card"?"💳 "+t.card:"📱 "+t.mada}</span></div>
{rcMod.method==="cash"&&rcMod.ct>0&&<>
<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span>{t.tendered}</span><span>{fN(rcMod.ct)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontWeight:700}}><span>{t.change}</span><span>{fN(rcMod.ch)}</span></div>
</>}
{rcMod.ptsEarned>0&&<div style={{textAlign:"center",margin:"6px 0",fontWeight:700,color:"#059669"}}>⭐ +{rcMod.ptsEarned} {t.points} {t.earned}</div>}
</div>

{/* Footer */}
<div style={{textAlign:"center",fontSize:paperSize==="A4"?12:paperSize==="80mm"||paperSize==="88mm"?10:8,color:"#9ca3af",marginTop:6,paddingTop:6,borderTop:"1px dashed #000"}}>
{rtl?"شكراً لتسوقكم!":"Thank you for shopping!"}<br/>
{storeSettings.storeName||"3045 Supermarket"} · {new Date().getFullYear()}
</div>
</div>

{/* BIG CHANGE DUE BANNER — for cashier to see clearly after printing */}
{rcMod.method==="cash"&&rcMod.ch>0&&<div style={{marginTop:16,padding:"20px 16px",background:"linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",borderRadius:14,border:"3px solid #f59e0b",textAlign:"center",boxShadow:"0 4px 12px rgba(245, 158, 11, 0.2)"}}>
<div style={{fontSize:14,fontWeight:800,color:"#92400e",marginBottom:6}}>💰 {rtl?"المتبقي للعميل":"Change Due to Customer"}</div>
<div style={{fontSize:42,fontWeight:900,fontFamily:"var(--m)",color:"#b45309",lineHeight:1,letterSpacing:"-1px"}}>{fm(rcMod.ch)}</div>
<div style={{fontSize:11,color:"#92400e",marginTop:8,fontWeight:600}}>{rtl?"💵 دُفع: ":"💵 Paid: "}{fm(rcMod.ct||0)} · {rtl?"📄 الإجمالي: ":"📄 Total: "}{fm(rcMod.tot)}</div>
</div>}

{/* Action buttons */}
<div style={{display:"flex",gap:8,marginTop:12}}>
<button style={{flex:1,padding:"12px",background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}} onClick={()=>{
// Smart print function — does NOT auto-close, cashier closes manually after giving change
const el=document.getElementById("receipt-print-area");
if(!el)return;
const w=paperSize==="58mm"?"58mm":paperSize==="80mm"||paperSize==="88mm"?"80mm":paperSize==="88mm"?"88mm":"210mm";
const h=paperSize==="A4"?"297mm":"auto";
const isThermal=paperSize==="58mm"||paperSize==="80mm"||paperSize==="88mm"||paperSize==="88mm";
const win=window.open("","_blank","width=400,height=600");
win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${rcMod.rn}</title>
<style>
@page{size:${w} ${h};margin:${paperSize==="A4"?"20mm":"3mm"}}
html,body{margin:0;padding:0}
*{margin:0;padding:0;box-sizing:border-box;color:#000 !important}
body{font-family:'Arial Black','Arial',sans-serif;font-size:${paperSize==="A4"?"16pt":paperSize==="88mm"?"15pt":paperSize==="80mm"?"14pt":"10pt"};
font-weight:600;width:100%;padding:${paperSize==="A4"?"0":"2mm"};direction:${rtl?"rtl":"ltr"};line-height:${paperSize==="A4"?"1.7":"1.5"};color:#000}
.wrap{width:100%}
h1,h2{font-size:${paperSize==="A4"?"28pt":paperSize==="88mm"?"22pt":paperSize==="80mm"?"20pt":"14pt"};margin-bottom:${paperSize==="A4"?"8mm":"3mm"};font-weight:900;letter-spacing:0.5px}
img{max-height:${paperSize==="A4"?"140px":paperSize==="88mm"?"100px":paperSize==="80mm"?"90px":"60px"};margin:${paperSize==="A4"?"0 auto 10mm":"0 auto 3mm"};display:block}
table{width:100%;border-collapse:collapse;font-size:${paperSize==="A4"?"15pt":paperSize==="88mm"?"14pt":paperSize==="80mm"?"13pt":"10pt"};margin:${paperSize==="A4"?"10mm 0":"3mm 0"}}
th,td{padding:${paperSize==="A4"?"8px 6px":"5px 3px"};text-align:${rtl?"right":"left"}}
th{border-bottom:${paperSize==="A4"?"2px":"2px"} solid #000;font-weight:900;font-size:${paperSize==="A4"?"16pt":paperSize==="88mm"?"14pt":paperSize==="80mm"?"13pt":"10pt"};text-transform:uppercase}
td{border-bottom:1px dotted #888;font-weight:700}
.c{text-align:center}.r{text-align:${rtl?"left":"right"}}.b{font-weight:900}
.line{border-top:2px dashed #000;margin:${paperSize==="A4"?"8mm 0":"4mm 0"};padding-top:${paperSize==="A4"?"6mm":"3mm"}}
.total-line{border-top:3px solid #000;border-bottom:3px double #000;margin-top:${paperSize==="A4"?"6mm":"4mm"};padding:${paperSize==="A4"?"5mm 0":"4mm 0"};font-size:${paperSize==="A4"?"24pt":paperSize==="88mm"?"22pt":paperSize==="80mm"?"20pt":"14pt"};font-weight:900;text-align:center;background:#000;color:#fff !important}
.total-line *{color:#fff !important}
.row{display:flex;justify-content:space-between;padding:${paperSize==="A4"?"3px 0":"2mm 0"};font-weight:700;font-size:${paperSize==="A4"?"15pt":paperSize==="88mm"?"14pt":paperSize==="80mm"?"13pt":"10pt"}}
.item-row{padding:${paperSize==="A4"?"6px 0":"3mm 0"};border-bottom:1px dotted #666}
.item-name{font-weight:900;font-size:${paperSize==="A4"?"15pt":paperSize==="88mm"?"15pt":paperSize==="80mm"?"14pt":"10pt"}}
.item-detail{font-size:${paperSize==="A4"?"13pt":paperSize==="88mm"?"13pt":paperSize==="80mm"?"12pt":"9pt"};font-weight:700;color:#000}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.total-line{background:#000 !important;color:#fff !important}}
</style></head><body>`);
win.document.write(el.innerHTML);
win.document.write("</body></html>");
win.document.close();
setTimeout(()=>{win.print();setTimeout(()=>win.close(),500)},300);
}}>🖨 {t.print} ({paperSize})</button>
<button style={{flex:1,padding:"14px",background:"#059669",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}} onClick={()=>{setRM(null);setTab("sale")}}>✓ {rtl?"تم التسليم - بيع جديد":"Done - New Sale"}</button>
</div>
</div></div>}

{/* BARCODE — Manual + Camera */}
{bcMod&&<div className="ov" onClick={()=>{setBM(false);setCamScan(false)}}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:440}}>
<h2>▦ {t.scanner}<button className="mc" onClick={()=>{setBM(false);setCamScan(false)}}>✕</button></h2>

{/* Toggle: Manual / Camera */}
<div style={{display:"flex",gap:6,marginBottom:14}}>
<button onClick={()=>setCamScan(false)} style={{flex:1,padding:10,borderRadius:10,border:"1.5px solid "+(camScan?"#e5e7eb":"#2563eb"),background:camScan?"#fff":"#eff6ff",color:camScan?"#6b7280":"#2563eb",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>⌨️ {rtl?"إدخال يدوي":"Manual"}</button>
<button onClick={()=>setCamScan(true)} style={{flex:1,padding:10,borderRadius:10,border:"1.5px solid "+(camScan?"#2563eb":"#e5e7eb"),background:camScan?"#eff6ff":"#fff",color:camScan?"#2563eb":"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📷 {rtl?"كاميرا":"Camera"}</button>
</div>

{/* Camera View */}
{camScan?<>
<div id="cam-reader" style={{width:"100%",borderRadius:16,overflow:"hidden",marginBottom:12,background:"#000",minHeight:200}}/>
<div style={{textAlign:"center",fontSize:12,color:"#6b7280"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:4}}>
<div style={{width:8,height:8,borderRadius:"50%",background:"#dc2626",animation:"pu 1s ease infinite"}}/>
{rtl?"الكاميرا نشطة — وجّه الباركود":"Camera active — point at barcode"}
</div>
<div style={{fontSize:10,color:"#9ca3af"}}>{rtl?"يتم المسح تلقائياً":"Auto-scans when detected"}</div>
</div>
<button onClick={()=>setCamScan(false)} style={{width:"100%",marginTop:12,padding:10,background:"#f3f4f6",border:"none",borderRadius:10,color:"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>✕ {rtl?"إيقاف الكاميرا":"Stop Camera"}</button>
</>:<>

{/* Manual Input */}
<input ref={bcRef} className="bsi" placeholder={rtl?"امسح أو اكتب الباركود...":"Scan or type barcode..."} onKeyDown={e=>{if(e.key==="Enter"){const c=e.target.value.trim();if(c){const matches=prods.filter(x=>x.bc===c);if(matches.length===0)sT("✗ "+t.notFound,"err");else if(matches.length===1){addToCart(matches[0]);sT("✓ "+pN(matches[0])+" "+t.added,"ok")}else setDupBcPicker({barcode:c,products:matches})}e.target.value=""}}}/>
<div style={{fontSize:12,color:"#9ca3af",textAlign:"center",marginBottom:12}}>{t.scanHint}</div>
<div style={{fontSize:12}}><div style={{fontWeight:700,marginBottom:6}}>{t.samples}</div>{prods.slice(0,5).map(p=><div key={p.bc} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",cursor:"pointer"}} onClick={()=>{addToCart(p);sT("✓ "+pN(p),"ok")}}><span style={{fontFamily:"var(--m)",color:"#2563eb"}}>{p.bc}</span><span>{pN(p)}</span></div>)}</div>
</>}
</div></div>}

{/* PASSWORD */}
{pwMod&&<div className="ov" onClick={()=>setPWM(null)}><div className="md" onClick={e=>e.stopPropagation()}><h2>🔐 {t.chgPass} — {pwMod.un}<button className="mc" onClick={()=>setPWM(null)}>✕</button></h2><div className="pf"><label>{t.newPass}</label><input type="password" value={nPW} onChange={e=>setNPW(e.target.value)} autoFocus placeholder="••••••••"/></div><button className="cpb" onClick={async()=>{if(!nPW.trim())return;setUsers(p=>p.map(u=>u.id===pwMod.id?{...u,pw:nPW}:u));setPWM(null);setNPW("");sT("✓ "+t.saved,"ok");try{await DB.updateUser(pwMod.id,{password:nPW})}catch(e){console.error(e)}}} disabled={!nPW.trim()}>✓ {t.setPass}</button></div></div>}

{/* ADD USER */}
{auMod&&<div className="ov" onClick={()=>setAUM(false)}><div className="md" onClick={e=>e.stopPropagation()}><h2>👤 {t.addUser}<button className="mc" onClick={()=>setAUM(false)}>✕</button></h2><div className="pf"><label>🆔 {rtl?"الرقم الوظيفي (اسم المستخدم)":"Employee Number (Username)"}</label><input value={nU.un} onChange={e=>setNU({...nU,un:e.target.value.replace(/\s/g,"")})} placeholder={rtl?"مثال: 1001":"e.g. 1001"} style={{fontFamily:"var(--m)"}}/></div><div className="pf"><label>{t.name} (EN)</label><input value={nU.fn} onChange={e=>setNU({...nU,fn:e.target.value})}/></div><div className="pf"><label>{t.name} (AR)</label><input value={nU.fa} onChange={e=>setNU({...nU,fa:e.target.value})} style={{direction:"rtl"}}/></div><div className="pf"><label>{t.role}</label><select value={nU.role} onChange={e=>setNU({...nU,role:e.target.value})}><option value="cashier">{t.cashier}</option><option value="manager">{t.manager}</option><option value="admin">{t.adminR}</option></select></div><div className="pf"><label>{t.pass}</label><input type="password" value={nU.pw} onChange={e=>setNU({...nU,pw:e.target.value})}/></div><button className="cpb" onClick={async()=>{if(!nU.un||!nU.fn||!nU.pw)return;try{await DB.addUser(nU);const u=await DB.getUsers();setUsers(u)}catch(e){console.error(e)}setAUM(false);setNU({un:"",fn:"",fa:"",role:"cashier",pw:""})}} disabled={!nU.un||!nU.fn||!nU.pw}>✓ {t.addUser}</button></div></div>}

{/* ADD PRODUCT */}
{apMod&&<div className="ov" style={{zIndex:99999}} onClick={()=>{setAPM(false);setInvCamScan(false)}}><div className="md" onClick={e=>e.stopPropagation()}><h2>📦 {t.addProd}<button className="mc" onClick={()=>{setAPM(false);setInvCamScan(false)}}>✕</button></h2>

{/* Barcode field + camera scan + auto-lookup */}
<div className="pf"><label>{t.bc}</label>
<div style={{display:"flex",gap:6}}>
<input value={nP.bc} onChange={e=>setNP({...nP,bc:e.target.value})} onKeyDown={e=>{if(e.key==="Enter"&&nP.bc.length>=4)lookupBarcode(nP.bc)}} style={{flex:1}} placeholder={rtl?"امسح أو اكتب الباركود":"Scan or type barcode"}/>
<button onClick={()=>{const newBc="3045"+Date.now().toString().slice(-8);setNP({...nP,bc:newBc});sT("✓ "+(rtl?"تم توليد باركود":"Barcode generated"),"ok")}} title={rtl?"توليد باركود جديد للمنتجات بدون باركود":"Auto-generate for items without barcode"} style={{padding:"10px 14px",background:"#7c3aed",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"var(--f)",fontWeight:700}}>🎲 {rtl?"توليد":"Auto"}</button>
<button onClick={()=>lookupBarcode(nP.bc)} disabled={!nP.bc||nP.bc.length<4||bcLookup} style={{padding:"10px 16px",background:bcLookup?"#d1d5db":"#059669",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:12,cursor:"pointer",flexShrink:0,fontFamily:"var(--f)",fontWeight:700,opacity:(!nP.bc||nP.bc.length<4)?".4":"1"}}>{bcLookup?"⏳":"🔍"} {rtl?"بحث":"Lookup"}</button>
<button onClick={()=>setInvCamScan(!invCamScan)} style={{padding:"10px 16px",background:invCamScan?"#dc2626":"#2563eb",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:14,cursor:"pointer",flexShrink:0}}>📷</button>
</div>
<div style={{fontSize:9,color:"#9ca3af",marginTop:4}}>{rtl?"امسح الباركود ثم اضغط 🔍 بحث لتعبئة البيانات تلقائياً":"Scan barcode then press 🔍 Lookup to auto-fill product details"}</div>
</div>

{/* Camera preview */}
{invCamScan&&<div style={{marginBottom:12}}>
<div id="inv-cam-reader" style={{width:"100%",borderRadius:12,overflow:"hidden",background:"#000",minHeight:180}}/>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:8,fontSize:11,color:"#6b7280"}}>
<div style={{width:8,height:8,borderRadius:"50%",background:"#dc2626",animation:"pu 1s ease infinite"}}/>
{rtl?"وجّه الكاميرا نحو الباركود":"Point camera at barcode"}
</div>
</div>}

<div className="pf"><label>{t.nameEn}</label><input value={nP.n} onChange={e=>setNP({...nP,n:e.target.value})}/></div><div className="pf"><label>{t.nameAr}</label><input value={nP.a} onChange={e=>setNP({...nP,a:e.target.value})} style={{direction:"rtl"}}/></div><div style={{display:"flex",gap:8}}><div className="pf" style={{flex:1}}><label>{t.cost} (JD)</label><input type="number" value={nP.c} onChange={e=>setNP({...nP,c:e.target.value})}/></div><div className="pf" style={{flex:1}}><label>{t.price} (JD)</label><input type="number" value={nP.p} onChange={e=>setNP({...nP,p:e.target.value})}/></div></div><div style={{display:"flex",gap:8}}><div className="pf" style={{flex:1}}><label>{t.cat}</label><select value={nP.cat} onChange={e=>setNP({...nP,cat:e.target.value})}>{CATS_ALL.filter(c=>c.id!=="all").map(c=><option key={c.id} value={c.id}>{t[c.k]}</option>)}</select></div><div className="pf" style={{flex:1}}><label>{t.unit}</label><select value={nP.u} onChange={e=>setNP({...nP,u:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="pc">{rtl?"قطعة (pc)":"Piece (pc)"}</option><option value="kg">⚖ {rtl?"كيلو (kg) — وزن":"Kilogram (kg) — weight"}</option><option value="g">⚖ {rtl?"غرام (g) — وزن":"Gram (g) — weight"}</option><option value="L">{rtl?"لتر (L)":"Liter (L)"}</option><option value="ml">{rtl?"ملليلتر (ml)":"Milliliter (ml)"}</option><option value="box">{rtl?"علبة (box)":"Box"}</option><option value="pack">{rtl?"عبوة (pack)":"Pack"}</option></select>{(nP.u==="kg"||nP.u==="g")&&<div style={{fontSize:10,color:"#059669",fontWeight:600,marginTop:4,background:"#ecfdf5",padding:"4px 8px",borderRadius:6}}>💡 {rtl?"سيُطلب الوزن عند البيع، والسعر المُدخل هو سعر الكيلو":"Weight will be prompted at sale, entered price = per kg"}</div>}</div></div><div className="pf"><label>Emoji</label><input value={nP.e} onChange={e=>setNP({...nP,e:e.target.value})}/></div>

{/* Product Image */}
<div className="pf"><label>📷 {rtl?"صورة المنتج":"Product Image"}</label>
<div style={{display:"flex",gap:10,alignItems:"center"}}>
<div style={{width:64,height:64,borderRadius:12,border:"2px dashed #d1d5db",overflow:"hidden",background:"#f9fafb",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}} onClick={()=>document.getElementById("prod-img-upload")?.click()}>
{nP.img?<img src={nP.img} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<span style={{fontSize:24,opacity:.3}}>📷</span>}
</div>
<div style={{flex:1}}>
<button onClick={()=>document.getElementById("prod-img-upload")?.click()} style={{padding:"8px 16px",background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:8,color:"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"var(--f)"}}>📷 {rtl?"اختر صورة":"Choose image"}</button>
{nP.img&&<button onClick={()=>setNP({...nP,img:null})} style={{marginLeft:6,padding:"8px 12px",background:"#fef2f2",border:"none",borderRadius:8,color:"#dc2626",fontSize:11,cursor:"pointer",fontFamily:"var(--f)"}}>✕</button>}
<div style={{fontSize:9,color:"#9ca3af",marginTop:4}}>{rtl?"حد أقصى 500KB":"Max 500KB"}</div>
</div>
</div>
<input id="prod-img-upload" type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>500000){sT("✗ Max 500KB","err");return}const r=new FileReader();r.onload=ev=>{const img2=new Image();img2.onload=()=>{const c2=document.createElement("canvas");c2.width=200;c2.height=200;const ctx2=c2.getContext("2d");const mn2=Math.min(img2.width,img2.height);ctx2.drawImage(img2,(img2.width-mn2)/2,(img2.height-mn2)/2,mn2,mn2,0,0,200,200);setNP(p=>({...p,img:c2.toDataURL("image/jpeg",0.7)}))};img2.src=ev.target.result};r.readAsDataURL(f)}}/>
</div>

<div className="pf"><label>{t.expiryDate}</label><input type="date" value={nP.exp} onChange={e=>setNP({...nP,exp:e.target.value})}/></div>

{/* ═══ SUPPLIER & INITIAL STOCK ═══ */}
<div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:12,padding:14,marginBottom:12}}>
<div style={{fontSize:13,fontWeight:700,color:"#065f46",marginBottom:10}}>📦 {rtl?"المخزون الأولي":"Initial Stock"}</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.supplier}</label><select value={nP.supplier||""} onChange={e=>setNP({...nP,supplier:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">{rtl?"-- اختر مورد --":"-- Select --"}</option>{suppliers.map(s=><option key={s.id} value={s.name}>{s.name}{s.rep?" — "+s.rep:""}{s.phone?" · "+s.phone:""}</option>)}</select></div>
<div className="pf" style={{flex:1}}><label>{rtl?"الكمية":"Quantity"}</label><input type="number" value={nP.initQty||""} onChange={e=>setNP({...nP,initQty:e.target.value})} placeholder="0"/></div>
</div>
</div>

{/* ═══ EXPIRY BATCHES ═══ */}
<div style={{background:"#fefce8",border:"1.5px solid #fde047",borderRadius:12,padding:14,marginBottom:12}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<div style={{fontSize:13,fontWeight:700,color:"#854d0e"}}>📅 {rtl?"دُفعات الصلاحية":"Expiry Batches"}</div>
<button onClick={()=>setNP(prev=>({...prev,batches:[...(prev.batches||[]),{qty:"",exp:""}]}))} style={{padding:"4px 12px",background:"#ca8a04",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>+ {rtl?"إضافة دُفعة":"Add Batch"}</button>
</div>
{(nP.batches||[]).length===0&&<div style={{fontSize:12,color:"#a16207",textAlign:"center",padding:8}}>{rtl?"اضغط + لإضافة دُفعات بتواريخ صلاحية مختلفة":"Press + to add batches with different expiry dates"}</div>}
{(nP.batches||[]).map((b,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
<div className="pf" style={{flex:1,marginBottom:0}}><input type="number" value={b.qty} onChange={e=>{const nb=[...(nP.batches||[])];nb[i]={...nb[i],qty:e.target.value};setNP(prev=>({...prev,batches:nb}))}} placeholder={rtl?"الكمية":"Qty"} style={{textAlign:"center"}}/></div>
<div className="pf" style={{flex:2,marginBottom:0}}><input type="date" value={b.exp} onChange={e=>{const nb=[...(nP.batches||[])];nb[i]={...nb[i],exp:e.target.value};setNP(prev=>({...prev,batches:nb}))}}/></div>
<button onClick={()=>{const nb=[...(nP.batches||[])];nb.splice(i,1);setNP(prev=>({...prev,batches:nb}))}} style={{width:28,height:28,borderRadius:"50%",border:"1.5px solid #fecaca",background:"#fff",color:"#dc2626",cursor:"pointer",fontSize:12,flexShrink:0}}>✕</button>
</div>)}
{(nP.batches||[]).length>0&&<div style={{fontSize:11,color:"#854d0e",marginTop:6,fontWeight:600}}>{rtl?"إجمالي الدُفعات":"Total batches"}: {(nP.batches||[]).reduce((s,b)=>s+parseInt(b.qty||0),0)} {rtl?"قطعة":"pcs"}</div>}
</div>

{/* ═══ PACKAGE PRODUCT ═══ */}
<div style={{background:"#eff6ff",border:"1.5px solid #93c5fd",borderRadius:12,padding:14,marginBottom:12}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
<div style={{fontSize:13,fontWeight:700,color:"#1e40af"}}>📦 {rtl?"عبوة/باكج":"Package / Multi-pack"}</div>
<label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#1e40af",cursor:"pointer"}}>
<input type="checkbox" checked={!!nP.isPackage} onChange={e=>setNP(prev=>({...prev,isPackage:e.target.checked}))} style={{accentColor:"#2563eb"}}/>
{rtl?"هذا المنتج عبوة":"This is a package"}
</label>
</div>
{nP.isPackage&&<>
<div style={{fontSize:11,color:"#6b7280",marginBottom:8}}>{rtl?"مثال: ٦ كولا في عبوة واحدة بباركود مختلف وسعر مختلف":"Example: 6 Cola in one pack with different barcode & price"}</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:2}}><label>{rtl?"باركود المنتج الفردي":"Single item barcode"}</label><input value={nP.parentBarcode||""} onChange={e=>setNP({...nP,parentBarcode:e.target.value})} placeholder={rtl?"باركود الحبة الواحدة":"Individual item barcode"}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"عدد القطع":"Pack size"}</label><input type="number" value={nP.packSize||""} onChange={e=>setNP({...nP,packSize:e.target.value})} placeholder="6"/></div></div>
<div className="pr"><div className="pf" style={{flex:1}}><label>{rtl?"💰 سعر بيع الحبة الواحدة (تحديث المنتج الفردي)":"💰 Individual selling price (updates parent product)"}</label><input type="number" step="0.001" value={nP.individualPrice||""} onChange={e=>setNP({...nP,individualPrice:e.target.value})} placeholder={(()=>{const par=prods.find(p=>p.bc===nP.parentBarcode);return par?(rtl?"حالياً: ":"Current: ")+par.p+" — "+(rtl?"اتركه فارغاً للإبقاء على السعر الحالي":"leave empty to keep"):rtl?"أدخل باركود المنتج الفردي أولاً":"Enter parent barcode first"})()} style={{background:nP.parentBarcode&&prods.find(p=>p.bc===nP.parentBarcode)?"#fff":"#f3f4f6"}}/></div>
</div>
{nP.parentBarcode&&nP.packSize&&parseFloat(nP.p)>0&&<div style={{background:"#dbeafe",borderRadius:8,padding:10,fontSize:12,marginTop:4}}>
<div style={{display:"flex",justifyContent:"space-between"}}><span>{rtl?"سعر العبوة":"Pack price"}</span><span style={{fontWeight:700}}>{fN(parseFloat(nP.p)||0)} JD</span></div>
<div style={{display:"flex",justifyContent:"space-between"}}><span>{rtl?"سعر الحبة الواحدة":"Per item price"}</span><span style={{fontWeight:700,color:"#059669"}}>{fN((parseFloat(nP.p)||0)/(parseInt(nP.packSize)||1))} JD</span></div>
<div style={{fontSize:10,color:"#6b7280",marginTop:4}}>💡 {rtl?"عند بيع العبوة سيتم خصم":"Selling this pack deducts"} {nP.packSize} {rtl?"من مخزون المنتج الفردي":"from single item stock"}</div>
</div>}
</>}
</div>

<button className="cpb" onClick={async()=>{if(!nP.bc||!nP.n||!nP.p)return;
  // FIX #3: Check for duplicate barcode before adding
  const dupExists=prods.find(x=>x.bc===nP.bc);
  if(dupExists){alert((rtl?"⚠️ هذا الباركود موجود بالفعل!\n":"⚠️ Barcode already exists!\n")+nP.bc+(rtl?"\nالمنتج الموجود: ":"\nExisting: ")+(dupExists.a||dupExists.n));return}
const initQty=parseInt(nP.initQty)||0;
const batchTotal=(nP.batches||[]).reduce((s,b)=>s+parseInt(b.qty||0),0);
const totalStock=batchTotal>0?batchTotal:initQty;
const newProd={id:"S"+Date.now().toString(36),bc:nP.bc,n:nP.n,a:nP.a||nP.n,p:parseFloat(nP.p)||0,c:parseFloat(nP.c)||0,cat:nP.cat,u:nP.u,s:totalStock,e:nP.e,exp:nP.exp||null,img:nP.img||null,supplier:nP.supplier||""};
setProds(p=>[...p,newProd]);setAPM(false);setInvCamScan(false);
sT("✓ "+t.prodAdded+(totalStock>0?" ("+totalStock+" "+t.qty+")":""),"ok");
try{
  await DB.upsertProduct(newProd);
  // Save expiry batches
  if((nP.batches||[]).length>0){
    for(const b of nP.batches){
      if(parseInt(b.qty)>0&&b.exp){
        await DB.addBatch({product_id:newProd.id,batch_number:"B-"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),supplier_name:nP.supplier||"",received_date:new Date().toISOString().slice(0,10),expiry_date:b.exp,quantity_received:parseInt(b.qty),quantity_remaining:parseInt(b.qty),cost_per_unit:newProd.c,notes:""});
      }
    }
  }else if(initQty>0&&nP.exp){
    // Single batch with expiry
    await DB.addBatch({product_id:newProd.id,batch_number:"B-"+Date.now().toString(36),supplier_name:nP.supplier||"",received_date:new Date().toISOString().slice(0,10),expiry_date:nP.exp,quantity_received:initQty,quantity_remaining:initQty,cost_per_unit:newProd.c,notes:""});
  }
  // Save package link — MERGE with existing packages (don't overwrite)
  if(nP.isPackage&&nP.parentBarcode&&nP.packSize){
    const parentProd=prods.find(p=>p.bc===nP.parentBarcode);
    if(parentProd){
      try{
        const existing=await DB.getSetting("packages",{})||{};
        existing[newProd.bc]={parentId:parentProd.id,parentBc:nP.parentBarcode,packSize:parseInt(nP.packSize)};
        await DB.setSetting("packages",existing);
        setPackages(existing);
        // Update parent's selling price if user provided one
        const newIndPrice=parseFloat(nP.individualPrice);
        if(!isNaN(newIndPrice)&&newIndPrice>0&&newIndPrice!==parentProd.p){
          await sb.from("products").update({price:newIndPrice,updated_at:new Date().toISOString()}).eq("id",parentProd.id);
          setProds(prev=>prev.map(x=>x.id===parentProd.id?{...x,p:newIndPrice}:x));
          sT("✓ "+(rtl?"تم تحديث سعر الحبة الفردية":"Individual price updated"),"ok");
        }
      }catch(er){console.error("Package save:",er)}
    }else{sT("⚠ "+(rtl?"المنتج الفردي غير موجود":"Parent product not found"),"err")}
  }
}catch(e){console.error(e)}
setNP({bc:"",n:"",a:"",p:"",c:"",cat:"food",u:"pc",e:"📦",exp:"",img:null,supplier:"",initQty:"",batches:[],isPackage:false,parentBarcode:"",packSize:"",individualPrice:""});
}} disabled={!nP.bc||!nP.n||!nP.p}>✓ {t.addProd}{(parseInt(nP.initQty)||0)>0||((nP.batches||[]).reduce((s,b)=>s+parseInt(b.qty||0),0))>0?" + "+((nP.batches||[]).reduce((s,b)=>s+parseInt(b.qty||0),0)||(parseInt(nP.initQty)||0))+" "+t.qty:""}</button></div></div>}

{/* DAY ONE SETUP WIZARD */}
{setupMod&&<div className="ov" style={{zIndex:99997}} onClick={()=>{}}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:680,maxHeight:"92vh",overflowY:"auto"}}>
<h2>🚀 {rtl?"معالج إعداد اليوم الأول":"Day One Setup Wizard"}<button className="mc" onClick={()=>{if(confirm(rtl?"هل تريد إغلاق المعالج؟ ستفقد التقدم":"Close wizard? Progress will be lost"))setSetupMod(false)}}>✕</button></h2>

{/* Progress indicator */}
<div style={{display:"flex",gap:6,marginBottom:18}}>
{[1,2,3,4,5,6].map(s=><div key={s} style={{flex:1,height:6,borderRadius:3,background:setupStep>=s?"#1e40af":"#e5e7eb",transition:"all .3s"}}/>)}
</div>
<div style={{textAlign:"center",fontSize:11,color:"#6b7280",marginBottom:14}}>{rtl?"الخطوة":"Step"} {setupStep} / 6</div>

{/* STEP 1: Welcome */}
{setupStep===1&&<div>
<div style={{textAlign:"center",padding:"20px 0"}}>
<div style={{fontSize:60,marginBottom:12}}>👋</div>
<div style={{fontSize:20,fontWeight:800,color:"#1e40af",marginBottom:8}}>{rtl?"مرحباً بك في معالج الإعداد":"Welcome to the Setup Wizard"}</div>
<div style={{fontSize:13,color:"#6b7280",lineHeight:1.7,maxWidth:480,margin:"0 auto"}}>{rtl?"هذا المعالج سيساعدك على تجهيز نظام نقطة البيع للعمل الفعلي. سيرشدك خلال الخطوات التالية:":"This wizard will help you prepare your POS system for live operations. You'll be guided through:"}</div>
</div>
<div style={{background:"#f9fafb",borderRadius:12,padding:16,margin:"14px 0"}}>
<div style={{fontSize:12,color:"#374151",lineHeight:2}}>
{rtl?"📝 1. معلومات المتجر (الاسم، العنوان، الهاتف)":"📝 1. Store Information (name, address, phone)"}<br/>
{rtl?"💰 2. الأرصدة الافتتاحية (الصندوق، البنك)":"💰 2. Opening Balances (cash register, bank)"}<br/>
{rtl?"👥 3. الموظفون والصلاحيات":"👥 3. Employees & Permissions"}<br/>
{rtl?"🎯 4. الأهداف اليومية":"🎯 4. Daily Targets"}<br/>
{rtl?"🧹 5. تنظيف بيانات الاختبار":"🧹 5. Clean Test Data"}<br/>
{rtl?"✅ 6. التأكيد والانطلاق":"✅ 6. Confirm & Go-Live"}
</div>
</div>
<div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:12,marginBottom:14}}>
<div style={{fontSize:11,color:"#92400e",fontWeight:600}}>{rtl?"⚠️ ملاحظة: لن يتم حذف الكاتالوج (4000+ منتج). فقط بيانات الاختبار ستتم إزالتها":"⚠️ Note: Product catalog (4000+ items) will NOT be deleted. Only test transactions will be cleared"}</div>
</div>
<button className="cpb" onClick={()=>setSetupStep(2)}>{rtl?"ابدأ ←":"Start →"}</button>
</div>}

{/* STEP 2: Store Info */}
{setupStep===2&&<div>
<h3 style={{fontSize:16,fontWeight:800,marginBottom:14,color:"#1e40af"}}>📝 {rtl?"معلومات المتجر":"Store Information"}</h3>
<div className="pf"><label>{rtl?"اسم المتجر":"Store Name"}</label><input value={setupData.storeName} onChange={e=>setSetupData(p=>({...p,storeName:e.target.value}))} placeholder="3045 Supermarket"/></div>
<div className="pf"><label>{rtl?"العنوان":"Address"}</label><input value={setupData.address} onChange={e=>setSetupData(p=>({...p,address:e.target.value}))} style={{direction:rtl?"rtl":"ltr"}}/></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"رقم الهاتف":"Phone"}</label><input value={setupData.phone} onChange={e=>setSetupData(p=>({...p,phone:e.target.value}))} style={{fontFamily:"var(--m)"}}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"نسبة الضريبة %":"Tax Rate %"}</label><input type="number" value={setupData.taxRate} onChange={e=>setSetupData(p=>({...p,taxRate:e.target.value}))}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<button onClick={()=>setSetupStep(1)} style={{flex:1,padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>← {rtl?"السابق":"Back"}</button>
<button onClick={()=>setSetupStep(3)} disabled={!setupData.storeName} style={{flex:2,padding:12,background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:setupData.storeName?1:.4}}>{rtl?"التالي ←":"Next →"}</button>
</div>
</div>}

{/* STEP 3: Opening Balances */}
{setupStep===3&&<div>
<h3 style={{fontSize:16,fontWeight:800,marginBottom:8,color:"#1e40af"}}>💰 {rtl?"الأرصدة الافتتاحية":"Opening Balances"}</h3>
<div style={{fontSize:11,color:"#6b7280",marginBottom:14}}>{rtl?"أدخل المبالغ الموجودة فعلياً في الصندوق والبنك يوم الافتتاح":"Enter the actual amounts in cash drawer and bank on opening day"}</div>
<div className="pf"><label>💵 {rtl?"رصيد صندوق النقد (JD)":"Cash Register Balance (JD)"}</label><input type="number" step="0.001" value={setupData.cashBalance} onChange={e=>setSetupData(p=>({...p,cashBalance:e.target.value}))}/></div>
<div className="pf"><label>💰 {rtl?"الكاش (Petty Cash) (JD)":"Petty Cash (JD)"}</label><input type="number" step="0.001" value={setupData.pettyCash} onChange={e=>setSetupData(p=>({...p,pettyCash:e.target.value}))}/></div>
<div className="pf"><label>🏦 {rtl?"الحساب البنكي الرئيسي (JD)":"Main Bank Account (JD)"}</label><input type="number" step="0.001" value={setupData.bankBalance} onChange={e=>setSetupData(p=>({...p,bankBalance:e.target.value}))}/></div>
<div style={{background:"#ecfdf5",borderRadius:10,padding:12,textAlign:"center",marginBottom:14}}>
<div style={{fontSize:10,color:"#065f46"}}>{rtl?"إجمالي الرصيد الافتتاحي":"Total Opening Balance"}</div>
<div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm((+setupData.cashBalance||0)+(+setupData.pettyCash||0)+(+setupData.bankBalance||0))}</div>
</div>
<div style={{display:"flex",gap:8}}>
<button onClick={()=>setSetupStep(2)} style={{flex:1,padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>← {rtl?"السابق":"Back"}</button>
<button onClick={()=>setSetupStep(4)} style={{flex:2,padding:12,background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>{rtl?"التالي ←":"Next →"}</button>
</div>
</div>}

{/* STEP 4: Employees */}
{setupStep===4&&<div>
<h3 style={{fontSize:16,fontWeight:800,marginBottom:8,color:"#1e40af"}}>👥 {rtl?"الموظفون":"Employees"}</h3>
<div style={{fontSize:11,color:"#6b7280",marginBottom:14}}>{rtl?"المستخدمون الحاليون في النظام":"Current users in the system"}</div>
<div style={{background:"#f9fafb",borderRadius:10,padding:12,marginBottom:14}}>
{users.map(u=><div key={u.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #e5e7eb",fontSize:12}}>
<div><strong>{rtl?(u.full_name_ar||u.full_name):u.full_name}</strong> <span style={{color:"#6b7280"}}>({u.username})</span></div>
<span style={{padding:"2px 8px",borderRadius:10,fontSize:9,fontWeight:700,background:u.role==="admin"?"#fef3c7":u.role==="manager"?"#dbeafe":"#f3f4f6",color:u.role==="admin"?"#92400e":u.role==="manager"?"#1e40af":"#374151"}}>{u.role}</span>
</div>)}
</div>
<div style={{background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:10,padding:12,marginBottom:14}}>
<div style={{fontSize:11,color:"#1e40af",fontWeight:600}}>💡 {rtl?"يمكنك إضافة المزيد من الموظفين من":"You can add more employees from"} <strong>Admin → 👥 {t.users}</strong></div>
</div>
<div style={{display:"flex",gap:8}}>
<button onClick={()=>setSetupStep(3)} style={{flex:1,padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>← {rtl?"السابق":"Back"}</button>
<button onClick={()=>setSetupStep(5)} style={{flex:2,padding:12,background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>{rtl?"التالي ←":"Next →"}</button>
</div>
</div>}

{/* STEP 5: Daily Targets + Wipe Test Data */}
{setupStep===5&&<div>
<h3 style={{fontSize:16,fontWeight:800,marginBottom:14,color:"#1e40af"}}>🎯 {rtl?"الأهداف وتنظيف البيانات":"Targets & Cleanup"}</h3>
<div className="pf"><label>{rtl?"الهدف اليومي للمبيعات (JD)":"Daily Sales Target (JD)"}</label><input type="number" value={setupData.dailyTarget} onChange={e=>setSetupData(p=>({...p,dailyTarget:e.target.value}))}/></div>

<div style={{background:"#fef2f2",border:"2px solid #fecaca",borderRadius:12,padding:14,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:800,color:"#991b1b",marginBottom:8}}>🧹 {rtl?"تنظيف بيانات الاختبار":"Clean Test Data"}</div>
<div style={{fontSize:11,color:"#6b7280",marginBottom:10,lineHeight:1.6}}>{rtl?"سيتم حذف جميع المعاملات التجريبية، الفواتير، المصروفات، الورديات السابقة، والتقارير. ":"All test transactions, invoices, expenses, shifts, and reports will be deleted. "}<strong>{rtl?"الكاتالوج (4000+ منتج) سيبقى":"Product catalog (4000+ items) will remain"}</strong></div>
<label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:"pointer"}}>
<input type="checkbox" checked={setupData.wipeTest} onChange={e=>setSetupData(p=>({...p,wipeTest:e.target.checked}))} style={{width:18,height:18}}/>
<span style={{fontWeight:600}}>{rtl?"نعم، احذف بيانات الاختبار قبل الانطلاق":"Yes, wipe test data before going live"}</span>
</label>
</div>

<div style={{display:"flex",gap:8}}>
<button onClick={()=>setSetupStep(4)} style={{flex:1,padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>← {rtl?"السابق":"Back"}</button>
<button onClick={()=>setSetupStep(6)} style={{flex:2,padding:12,background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>{rtl?"التالي ←":"Next →"}</button>
</div>
</div>}

{/* STEP 6: Confirmation with password */}
{setupStep===6&&<div>
<h3 style={{fontSize:16,fontWeight:800,marginBottom:14,color:"#1e40af"}}>✅ {rtl?"التأكيد النهائي":"Final Confirmation"}</h3>

<div style={{background:"#f9fafb",borderRadius:12,padding:16,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:700,marginBottom:10}}>📋 {rtl?"ملخص الإعداد":"Setup Summary"}</div>
<table style={{width:"100%",fontSize:12}}>
<tbody>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"اسم المتجر":"Store Name"}:</td><td style={{fontWeight:700}}>{setupData.storeName}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"العنوان":"Address"}:</td><td style={{fontWeight:600,fontSize:11}}>{setupData.address}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"الهاتف":"Phone"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{setupData.phone}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"الضريبة":"Tax Rate"}:</td><td style={{fontWeight:700}}>{setupData.taxRate}%</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"الهدف اليومي":"Daily Target"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{fm(+setupData.dailyTarget||0)}</td></tr>
<tr><td colSpan="2" style={{padding:"8px 0 4px",borderTop:"1px solid #e5e7eb",fontWeight:700}}>{rtl?"الأرصدة الافتتاحية":"Opening Balances"}:</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280",paddingLeft:14}}>💵 {rtl?"الصندوق":"Cash Register"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{fm(+setupData.cashBalance||0)}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280",paddingLeft:14}}>💰 {rtl?"الكاش":"Petty Cash"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{fm(+setupData.pettyCash||0)}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280",paddingLeft:14}}>🏦 {rtl?"البنك":"Bank"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{fm(+setupData.bankBalance||0)}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280",paddingLeft:14}}>{rtl?"المجموع":"Total"}:</td><td style={{fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm((+setupData.cashBalance||0)+(+setupData.pettyCash||0)+(+setupData.bankBalance||0))}</td></tr>
<tr><td style={{padding:"8px 0 4px",borderTop:"1px solid #e5e7eb",color:"#6b7280"}}>{rtl?"عدد الموظفين":"Employees"}:</td><td style={{fontWeight:700}}>{users.length}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"عدد المنتجات":"Products"}:</td><td style={{fontWeight:700,fontFamily:"var(--m)"}}>{prods.length}</td></tr>
<tr><td style={{padding:"4px 0",color:"#6b7280"}}>{rtl?"تنظيف بيانات الاختبار":"Wipe Test Data"}:</td><td style={{fontWeight:700,color:setupData.wipeTest?"#dc2626":"#6b7280"}}>{setupData.wipeTest?(rtl?"نعم":"Yes"):(rtl?"لا":"No")}</td></tr>
</tbody>
</table>
</div>

<div style={{background:"linear-gradient(135deg,#fef3c7,#fde68a)",border:"2px solid #d97706",borderRadius:12,padding:14,marginBottom:14}}>
<div style={{fontSize:13,fontWeight:800,color:"#92400e",marginBottom:8}}>🔐 {rtl?"تأكيد الانطلاق":"Confirm Go-Live"}</div>
<div style={{fontSize:11,color:"#92400e",marginBottom:10}}>{rtl?"أدخل كلمة مرور المسؤول لتأكيد الانطلاق. هذا الإجراء لا يمكن التراجع عنه":"Enter your admin password to confirm go-live. This action cannot be undone"}</div>
<input type="password" value={setupData.adminPwd} onChange={e=>setSetupData(p=>({...p,adminPwd:e.target.value}))} placeholder={rtl?"كلمة مرور المسؤول":"Admin password"} style={{width:"100%",padding:"12px 14px",border:"2px solid #d97706",borderRadius:10,fontSize:14,fontFamily:"var(--m)",outline:"none",background:"#fff"}}/>
</div>

<div style={{display:"flex",gap:8}}>
<button onClick={()=>setSetupStep(5)} style={{flex:1,padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,color:"#6b7280",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>← {rtl?"السابق":"Back"}</button>
<button disabled={!setupData.adminPwd} onClick={async()=>{
// Verify password
if(setupData.adminPwd!==cu.pw){sT("✗ "+(rtl?"كلمة المرور خاطئة":"Wrong password"),"err");return}
if(!confirm(rtl?"⚠️ هل أنت متأكد من الانطلاق؟ لا يمكن التراجع":"⚠️ Are you sure you want to go live? This cannot be undone"))return;

try{
  // 1. Save store settings
  const newSettings={storeName:setupData.storeName,taxRate:+setupData.taxRate,currency:"JD",dailyTarget:+setupData.dailyTarget||500,weeklyTarget:(+setupData.dailyTarget||500)*7,monthlyTarget:(+setupData.dailyTarget||500)*30};
  setStoreSettings(newSettings);
  await DB.setSetting("store_settings",newSettings);

  // 2. Update bank account balances
  for(const a of bankAccts){
    const nm=(a.name||"").toLowerCase();
    const nmAr=a.name_ar||"";
    let newBal=null;
    if(nm.includes("cash register")||nmAr.includes("صندوق النقد")||nmAr.includes("صندوق")){newBal=+setupData.cashBalance||0}
    else if(nm.includes("petty")||nmAr.includes("الكاش")){newBal=+setupData.pettyCash||0}
    else if(nm.includes("main bank")||nm.includes("bank")||a.bank_name){newBal=+setupData.bankBalance||0}
    if(newBal!==null){
      try{await DB.updateBankBalance(a.id,newBal);setBankAccts(p=>p.map(x=>x.id===a.id?{...x,balance:newBal}:x))}catch(e){console.error(e)}
    }
  }

  // 3. Wipe test data if requested
  if(setupData.wipeTest){
    const wipeTable=async(name)=>{try{const{error}=await sb.from(name).delete().neq("id",0);if(error)console.warn("Wipe "+name+":",error.message)}catch(e){console.warn("Wipe "+name+":",e.message)}};
    // Delete in correct FK order (children before parents)
    await wipeTable("transaction_items");
    await wipeTable("transactions");
    await wipeTable("sales_returns");
    await wipeTable("purchase_returns");
    await wipeTable("purchase_invoice_items");
    await wipeTable("purchase_invoices");
    await wipeTable("expenses");
    await wipeTable("money_movements");
    await wipeTable("eod_reports");
    await wipeTable("cash_shifts");
    await wipeTable("attendance");
    await wipeTable("loyalty_transactions");
    await wipeTable("coupon_redemptions");
    await wipeTable("salary_payments");
    await wipeTable("stocktake_items");
    await wipeTable("stocktake_sessions");
    await wipeTable("product_batches");
    // Reset all product stock to 0
    try{const{error}=await sb.from("products").update({stock:0}).neq("id",0);if(error)console.warn("Stock reset:",error.message)}catch(e){console.warn("Stock reset:",e.message)}

    // Clear local state
    setTxns([]);setSalesReturns([]);setPurchaseReturns([]);setInvs([]);setExpensesList([]);setMovements([]);setCashShifts([]);setEODReports([]);setActiveShift(null);
    setStocktakeSessions([]);setBatches([]);
    // Reload products with reset stock
    try{const np=await DB.getProducts();setProds(np)}catch(e){console.warn("Reload:",e.message)}
  }

  // 4. Mark setup as completed
  await DB.setSetting("setup_completed",{completed:true,date:new Date().toISOString(),by:cu.fn});

  setSetupMod(false);
  setSetupStep(1);
  setSetupData({storeName:"",address:"إربد، شارع المدينة المنورة - مقابل SOS",phone:"0791191244",taxRate:"0",dailyTarget:"500",cashBalance:"100",pettyCash:"50",bankBalance:"0",adminPwd:"",wipeTest:true});
  
  alert((rtl?"🎉 تم الانطلاق بنجاح!\n\nالنظام جاهز للعمل الفعلي.\n\nالخطوات التالية:":"🎉 Go-Live Successful!\n\nSystem is ready for live operations.\n\nNext steps:")+"\n\n"+
    (rtl?"1. أضف البضاعة عبر فواتير المشتريات\n2. ابدأ وردية جديدة\n3. ابدأ البيع":"1. Add inventory via purchase invoices\n2. Open a new shift\n3. Start selling"));
  sT("✓ "+(rtl?"تم الانطلاق!":"Go-Live successful!"),"ok");
}catch(e){console.error("Setup error:",e);alert("❌ "+(rtl?"خطأ في الإعداد":"Setup Error")+":\n\n"+(e.message||e.toString()||"Unknown error")+"\n\n"+(rtl?"تحقق من Console للمزيد من التفاصيل":"Check Console for more details"));sT("✗ "+(e.message||"Error"),"err")}
}} style={{flex:2,padding:12,background:"linear-gradient(135deg,#059669,#10b981)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",opacity:setupData.adminPwd?1:.4}}>🚀 {rtl?"انطلق!":"GO LIVE!"}</button>
</div>
</div>}

</div></div>}

{/* STOCKTAKE SESSION VIEW MODAL */}

{/* PURCHASE INVOICE */}
{invMod&&<div className="ov" onClick={()=>setInvMod(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
<div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:1100,maxHeight:"95vh",display:"flex",flexDirection:"column"}}>

{/* Header */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
  <h2 style={{fontSize:20,fontWeight:800,margin:0,color:invIsReconciliation?"#d97706":"#111827"}}>{invIsReconciliation?"🔍 "+(rtl?"فاتورة مطابقة تاريخية":"Historical Reconciliation Invoice"):"🧾 "+t.addInv}</h2>
  <div style={{display:"flex",gap:8,alignItems:"center"}}>
    <button onClick={()=>{setOcrMod(true);setOcrPages([]);setOcrExtractedRows([]);window._pendingOcrPages=null}}
      style={{padding:"8px 16px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:6,boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>
      📷 {rtl?"مسح فاتورة OCR":"Scan Invoice (OCR)"}
    </button>
    <button onClick={()=>setInvMod(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280"}}>✕</button>
  </div>
</div>

{/* Reconciliation mode toggle */}
<div style={{marginBottom:14,padding:12,background:invIsReconciliation?"linear-gradient(135deg,#fffbeb,#fef3c7)":"#f9fafb",border:"2px solid "+(invIsReconciliation?"#f59e0b":"#e5e7eb"),borderRadius:10}}>
  <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
    <input type="checkbox" checked={invIsReconciliation} onChange={e=>setInvIsReconciliation(e.target.checked)}
      style={{width:20,height:20,cursor:"pointer"}}/>
    <div style={{flex:1}}>
      <div style={{fontSize:13,fontWeight:800,color:invIsReconciliation?"#92400e":"#374151"}}>
        🔍 {rtl?"فاتورة مطابقة تاريخية":"Historical Reconciliation Invoice"}
      </div>
      <div style={{fontSize:10,color:"#6b7280",marginTop:3}}>
        {rtl?"للتدقيق فقط - لن تُضاف الكميات للمخزون - لن يُخصم المبلغ من البنك":"For audit only - stock will NOT be increased - no bank deduction"}
      </div>
    </div>
  </label>
  {invIsReconciliation && (
    <div style={{marginTop:10,padding:10,background:"#fef3c7",borderRadius:6,fontSize:11,color:"#78350f",fontWeight:600}}>
      ⚠️ {rtl?"هذه الفاتورة ستُحفظ بحالة 'بانتظار المطابقة'. سيتم مقارنتها مع المخزون الحالي وعرض تقرير الفروقات.":"This invoice will be saved with 'Pending Reconciliation' status. It will be compared with current stock and show differences report."}
    </div>
  )}
</div>

{/* Top section: Supplier + Invoice number + Date */}
<div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:14,padding:12,background:"#f9fafb",borderRadius:10}}>
  <div>
    <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>🏭 {t.supplier} *</label>
    <select value={invSup} onChange={e=>setInvSup(e.target.value)}
      style={{width:"100%",padding:10,border:"1.5px solid "+(invSup?"#6ee7b7":"#fca5a5"),borderRadius:8,fontSize:13,marginTop:4,fontFamily:"var(--f)",background:invSup?"#ecfdf5":"#fff"}}>
      <option value="">— {rtl?"اختر المورد":"Select supplier"} —</option>
      {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
    </select>
  </div>
  <div>
    <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>🔢 {t.invNo}</label>
    <input value={invNo} onChange={e=>setInvNo(e.target.value)} readOnly
      style={{width:"100%",padding:10,border:"1.5px solid #bfdbfe",borderRadius:8,fontSize:13,marginTop:4,fontFamily:"monospace",background:"#eff6ff",fontWeight:700,color:"#1e40af"}}/>
  </div>
  <div>
    <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>📅 {rtl?"التاريخ":"Date"}</label>
    <input value={new Date().toLocaleDateString()} readOnly
      style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,background:"#f9fafb"}}/>
  </div>
</div>

{/* Products table with category grouping */}
<div style={{flex:1,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:10,marginBottom:10}}>
<table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
  <thead style={{background:"#f3f4f6",position:"sticky",top:0,zIndex:1}}>
    <tr>
      <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:130}}>🏷️ {rtl?"الفئة":"Category"}</th>
      <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:150}}>📷 {rtl?"الباركود":"Barcode"}</th>
      <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700,minWidth:150}}>📦 {rtl?"اسم المنتج":"Product Name"}</th>
      <th style={{padding:8,textAlign:"center",fontSize:10,color:"#6b7280",fontWeight:700,width:80}}>🔢 {rtl?"الكمية":"Qty"}</th>
      <th style={{padding:8,textAlign:"center",fontSize:10,color:"#dc2626",fontWeight:700,width:100}}>💰 {rtl?"سعر الشراء":"Cost"}</th>
      <th style={{padding:8,textAlign:"center",fontSize:10,color:"#059669",fontWeight:700,width:100}}>🏷️ {rtl?"سعر البيع":"Price"}</th>
      <th style={{padding:8,textAlign:"center",fontSize:10,color:"#d97706",fontWeight:700,minWidth:200}}>📅 {rtl?"تواريخ الانتهاء":"Expiry Dates"}</th>
      <th style={{padding:8,textAlign:"center",fontSize:10,color:"#6b7280",fontWeight:700,width:40}}></th>
    </tr>
  </thead>
  <tbody>
    {invRows.map((r,i)=>{
      const categories = [...new Set(prods.map(p=>p.cat).filter(Boolean))].sort();
      const rowTotal = (parseFloat(r.cost)||0) * (parseInt(r.qty)||0);
      return (
        <tr key={i} style={{borderTop:"1px solid #f3f4f6",background:r.isNew?"#fffbeb":"#fff"}}>
          {/* Category dropdown */}
          <td style={{padding:6}}>
            <select value={r.cat} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,cat:e.target.value}:x))}
              style={{width:"100%",padding:"6px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,background:r.cat?"#f5f3ff":"#fff"}}>
              <option value="">—</option>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </td>
          
          {/* Barcode with lookup */}
          <td style={{padding:6}}>
            <input value={r.bc} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,bc:e.target.value}:x))}
              onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();onBarcodeEntered(i,r.bc)}}}
              onBlur={e=>{if(e.target.value.trim())onBarcodeEntered(i,e.target.value)}}
              placeholder={rtl?"امسح أو اكتب":"Scan or type"}
              style={{width:"100%",padding:"6px 8px",border:"1px solid "+(r.prodId?"#6ee7b7":r.isNew?"#fbbf24":"#e5e7eb"),borderRadius:6,fontSize:11,fontFamily:"monospace",background:r.prodId?"#ecfdf5":r.isNew?"#fffbeb":"#fff"}}/>
            {r.isNew && (
              <button onClick={()=>{setNewProdMod({rowIndex:i,barcode:r.bc});setNewProdData({bc:r.bc,n:"",a:"",cat:r.cat||"",u:"pc",e:"📦"})}}
                style={{width:"100%",marginTop:3,padding:"3px 6px",background:"#d97706",color:"#fff",border:"none",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer"}}>
                + {rtl?"منتج جديد":"Add New"}
              </button>
            )}
          </td>
          
          {/* Product name */}
          <td style={{padding:6}}>
            <input value={r.name} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,name:e.target.value}:x))}
              readOnly={!!r.prodId} placeholder={rtl?"اسم المنتج":"Name"}
              style={{width:"100%",padding:"6px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,background:r.prodId?"#f9fafb":"#fff",fontWeight:r.prodId?600:400}}/>
          </td>
          
          {/* Quantity */}
          <td style={{padding:6}}>
            <input type="number" min="1" value={r.qty} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,qty:e.target.value}:x))}
              placeholder="0"
              style={{width:"100%",padding:"6px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:12,fontFamily:"monospace",textAlign:"center",fontWeight:700}}/>
          </td>
          
          {/* Cost */}
          <td style={{padding:6}}>
            <input type="number" step="0.001" value={r.cost} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,cost:e.target.value}:x))}
              placeholder="0.000"
              style={{width:"100%",padding:"6px 8px",border:"1px solid #fca5a5",borderRadius:6,fontSize:12,fontFamily:"monospace",textAlign:"center",color:"#dc2626",fontWeight:700}}/>
          </td>
          
          {/* Selling Price */}
          <td style={{padding:6}}>
            <input type="number" step="0.001" value={r.price} onChange={e=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,price:e.target.value}:x))}
              placeholder="0.000"
              style={{width:"100%",padding:"6px 8px",border:"1px solid #6ee7b7",borderRadius:6,fontSize:12,fontFamily:"monospace",textAlign:"center",color:"#059669",fontWeight:700}}/>
          </td>
          
          {/* Expiry Dates (multiple) */}
          <td style={{padding:6}}>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {(r.expDates||[""]).map((d,j)=>(
                <div key={j} style={{display:"flex",gap:3}}>
                  <input type="date" value={d} onChange={e=>{
                    setInvRows(prev=>prev.map((x,idx)=>{
                      if(idx!==i) return x;
                      const newDates=[...(x.expDates||[""])];
                      newDates[j]=e.target.value;
                      return {...x,expDates:newDates};
                    }));
                  }}
                  style={{flex:1,padding:"4px 6px",border:"1px solid #fcd34d",borderRadius:4,fontSize:10,fontFamily:"monospace",background:d?"#fffbeb":"#fff"}}/>
                  {(r.expDates||[""]).length>1 && (
                    <button onClick={()=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,expDates:x.expDates.filter((_,k)=>k!==j)}:x))}
                      style={{padding:"2px 6px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:3,fontSize:10,cursor:"pointer",fontWeight:700}}>×</button>
                  )}
                </div>
              ))}
              <button onClick={()=>setInvRows(prev=>prev.map((x,idx)=>idx===i?{...x,expDates:[...(x.expDates||[""]),""]}:x))}
                style={{padding:"3px 6px",background:"none",border:"1px dashed #fbbf24",color:"#d97706",borderRadius:4,fontSize:9,cursor:"pointer",fontWeight:600}}>+ {rtl?"تاريخ آخر":"Another Date"}</button>
            </div>
          </td>
          
          {/* Remove row */}
          <td style={{padding:6,textAlign:"center"}}>
            {invRows.length>1 && (
              <button onClick={()=>setInvRows(prev=>prev.filter((_,idx)=>idx!==i))}
                style={{padding:"4px 8px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:4,fontSize:11,cursor:"pointer",fontWeight:700}}>✕</button>
            )}
          </td>
        </tr>
      );
    })}
  </tbody>
</table>
</div>

{/* Add row button + Total */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,padding:12,background:"#f9fafb",borderRadius:10}}>
  <button onClick={()=>setInvRows(prev=>[...prev,{cat:"",bc:"",prodId:"",name:"",qty:"",cost:"",price:"",expDates:[""],isNew:false}])}
    style={{padding:"10px 20px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer",fontSize:12}}>
    + {rtl?"إضافة صف جديد":"Add New Row"}
  </button>
  {(()=>{const total = invRows.reduce((s,r)=>s+(parseFloat(r.cost)||0)*(parseInt(r.qty)||0),0);return (
    <div style={{fontSize:14,fontWeight:700}}>
      <span style={{color:"#6b7280"}}>{rtl?"إجمالي الفاتورة":"Invoice Total"}: </span>
      <span style={{fontFamily:"monospace",fontWeight:800,color:"#059669",fontSize:20}}>{total.toFixed(3)} JD</span>
    </div>
  )})()}
</div>

{/* Payment section */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
  <div>
    <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>💳 {t.payMethod}</label>
    <select value={invPayMethod} onChange={e=>{
      const m=e.target.value; setInvPayMethod(m);
      if(m==="cash"){const ca=bankAccts.find(a=>a.name.toLowerCase().includes("cash register"));if(ca)setInvBankAcct(ca.id.toString())}
      else if(m==="petty"){const pa=bankAccts.find(a=>a.name.toLowerCase().includes("petty"));if(pa)setInvBankAcct(pa.id.toString())}
      else if(m==="bank"){const ba=bankAccts.find(a=>a.name.toLowerCase().includes("main"));if(ba)setInvBankAcct(ba.id.toString())}
      else setInvBankAcct("");
    }} style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,fontFamily:"var(--f)"}}>
      <option value="cash">💵 {rtl?"صندوق النقد":"Cash"}</option>
      <option value="petty">💰 {rtl?"الكاش":"Petty Cash"}</option>
      <option value="bank">🏦 {t.bank}</option>
      <option value="check">📄 {t.check}</option>
    </select>
  </div>
  <div>
    <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>🏦 {rtl?"خصم من حساب":"Debit From"}</label>
    <select value={invBankAcct} onChange={e=>setInvBankAcct(e.target.value)}
      style={{width:"100%",padding:10,border:"1.5px solid "+(invBankAcct?"#6ee7b7":"#fbbf24"),borderRadius:8,fontSize:13,marginTop:4,fontFamily:"var(--f)"}}>
      <option value="">{rtl?"⚠ بدون خصم":"⚠ No debit"}</option>
      {bankAccts.map(a => <option key={a.id} value={a.id}>{rtl?(a.name_ar||a.name):a.name} ({fm(+a.balance)})</option>)}
    </select>
  </div>
</div>

{/* Save button */}
<button onClick={saveNewInvoice} disabled={!invSup||!invNo||invRows.filter(r=>r.prodId&&r.qty).length===0}
  style={{padding:"14px",background:(invSup&&invNo&&invRows.filter(r=>r.prodId&&r.qty).length>0)?"linear-gradient(135deg,#059669,#10b981)":"#d1d5db",border:"none",borderRadius:10,color:"#fff",fontWeight:800,cursor:(invSup&&invNo&&invRows.filter(r=>r.prodId&&r.qty).length>0)?"pointer":"not-allowed",fontSize:15}}>
  ✓ {t.saveInv}
</button>

{/* Quick Add Product Modal */}
{newProdMod && (
  <div onClick={()=>setNewProdMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:400,maxWidth:500}}>
      <h3 style={{margin:"0 0 12px",fontSize:16,fontWeight:800}}>➕ {rtl?"إضافة منتج جديد سريع":"Quick Add Product"}</h3>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>{rtl?"الباركود":"Barcode"}</label>
        <input value={newProdData.bc} onChange={e=>setNewProdData({...newProdData,bc:e.target.value})} readOnly
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,fontFamily:"monospace",background:"#f9fafb"}}/>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>{rtl?"اسم المنتج (EN)":"Name (EN)"} *</label>
        <input value={newProdData.n} onChange={e=>setNewProdData({...newProdData,n:e.target.value})}
          autoFocus placeholder={rtl?"مثال: Indomie Noodles":"e.g. Indomie Noodles"}
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4}}/>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>{rtl?"الاسم (عربي)":"Name (AR)"}</label>
        <input value={newProdData.a} onChange={e=>setNewProdData({...newProdData,a:e.target.value})}
          placeholder={rtl?"مثال: إندومي":"e.g. إندومي"}
          style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:13,marginTop:4,direction:"rtl"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <div style={{flex:1}}>
          <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>{rtl?"الفئة":"Category"}</label>
          <select value={newProdData.cat} onChange={e=>setNewProdData({...newProdData,cat:e.target.value})}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:12,marginTop:4}}>
            <option value="">—</option>
            {[...new Set(prods.map(p=>p.cat).filter(Boolean))].sort().map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{flex:1}}>
          <label style={{fontSize:11,fontWeight:700,color:"#374151"}}>{rtl?"الوحدة":"Unit"}</label>
          <select value={newProdData.u} onChange={e=>setNewProdData({...newProdData,u:e.target.value})}
            style={{width:"100%",padding:10,border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:12,marginTop:4}}>
            <option value="pc">{rtl?"قطعة":"Piece"}</option>
            <option value="kg">{rtl?"كيلو":"kg"}</option>
            <option value="g">{rtl?"جرام":"gram"}</option>
            <option value="box">{rtl?"علبة":"Box"}</option>
            <option value="pack">{rtl?"باكيت":"Pack"}</option>
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>{setNewProdMod(null);setNewProdData({bc:"",n:"",a:"",cat:"",u:"pc",e:"📦"})}}
          style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
        <button onClick={()=>quickAddProduct(newProdMod.rowIndex)} disabled={!newProdData.n}
          style={{padding:"10px 24px",background:newProdData.n?"#059669":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:newProdData.n?"pointer":"not-allowed"}}>
          ✓ {rtl?"إضافة واستخدام":"Add & Use"}
        </button>
      </div>
    </div>
  </div>
)}

</div></div>}

{/* VIEW INVOICE */}
{invView&&<div className="ov" onClick={()=>setInvView(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>🧾 {invView.invoiceNo}<button className="mc" onClick={()=>setInvView(null)}>✕</button></h2>
<div style={{fontSize:13,marginBottom:12}}><div>🏭 {t.supplier}: <strong>{invView.supplier}</strong></div><div style={{color:"#9ca3af",marginTop:4}}>📅 {invView.date} · 👤 {invView.receivedBy}</div></div>
<table className="at"><thead><tr><th>{t.product}</th><th>{t.qty}</th><th>{t.cost}</th><th>{t.total}</th></tr></thead><tbody>{invView.items.map((it,i)=><tr key={i}><td style={{fontWeight:600}}>{it.productName}</td><td style={{fontFamily:"var(--m)"}}>{it.qty}</td><td style={{fontFamily:"var(--m)"}}>{fN(parseFloat(it.cost)||0)}</td><td style={{fontFamily:"var(--m)",color:"#059669",fontWeight:700}}>{fN((parseFloat(it.cost)||0)*(parseInt(it.qty)||0))}</td></tr>)}</tbody></table>
<div style={{textAlign:"right",marginTop:10,fontSize:16,fontWeight:800,color:"#059669",fontFamily:"var(--m)"}}>{t.totCost}: {fm(invView.totalCost)}</div>

{/* ━━━━ Attachments Section (OCR images) ━━━━ */}
<div style={{marginTop:16,padding:12,background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
    <div style={{fontSize:13,fontWeight:700,color:"#374151"}}>
      📎 {rtl?"الصور المرفقة":"Attached Images"}
      {invViewAttachments.length > 0 && <span style={{marginLeft:6,padding:"2px 8px",background:"#7c3aed",color:"#fff",borderRadius:10,fontSize:10,fontWeight:700}}>{invViewAttachments.length}</span>}
    </div>
    {invViewAttachLoading && <span style={{fontSize:10,color:"#6b7280"}}>⏳ {rtl?"جاري التحميل...":"Loading..."}</span>}
  </div>
  
  {!invViewAttachLoading && invViewAttachments.length === 0 && (
    <div style={{padding:16,textAlign:"center",color:"#9ca3af",fontSize:11,fontStyle:"italic"}}>
      {rtl?"لا توجد صور مرفقة لهذه الفاتورة":"No images attached to this invoice"}
    </div>
  )}
  
  {!invViewAttachLoading && invViewAttachments.length > 0 && (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8}}>
      {invViewAttachments.map((att,idx)=>(
        <div key={att.id} style={{border:"1.5px solid #e5e7eb",borderRadius:8,padding:6,background:"#fff",position:"relative"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <span style={{fontSize:10,fontWeight:700,color:"#7c3aed"}}>📄 {rtl?"صفحة":"Page"} {att.page_number||(idx+1)}</span>
            {cu.role==="admin" && (
              <button onClick={async(e)=>{
                e.stopPropagation();
                if(!confirm(rtl?"حذف هذه الصورة؟":"Delete this image?"))return;
                try{
                  await DB.deleteInvoiceAttachment(att.id);
                  setInvViewAttachments(prev=>prev.filter(a=>a.id!==att.id));
                  sT("✓ "+(rtl?"تم الحذف":"Deleted"),"ok");
                }catch(er){console.error(er);sT("✗ "+er.message,"err")}
              }} style={{padding:"1px 5px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:3,fontSize:9,cursor:"pointer"}}>✕</button>
            )}
          </div>
          <img src={att.image_data} alt={"page "+(idx+1)} 
            onClick={()=>setInvAttachLightbox({src:att.image_data,name:att.file_name||`page_${att.page_number||idx+1}`,att})}
            style={{width:"100%",height:100,objectFit:"contain",borderRadius:4,background:"#f3f4f6",cursor:"pointer"}}/>
          <div style={{fontSize:9,color:"#6b7280",marginTop:4,textAlign:"center"}}>
            <button onClick={()=>setInvAttachLightbox({src:att.image_data,name:att.file_name||`page_${att.page_number||idx+1}`,att})}
              style={{padding:"3px 8px",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:4,fontSize:9,cursor:"pointer",fontWeight:600,width:"100%"}}>
              🔍 {rtl?"عرض":"View Full"}
            </button>
          </div>
        </div>
      ))}
    </div>
  )}
</div>

{/* Print A4 Button */}
<button onClick={()=>{
const w=window.open("","_blank","width=900,height=700");
if(!w)return;
const dir=rtl?"rtl":"ltr";
const lbl=(ar,en)=>rtl?ar:en;
let rowsHtml="";
invView.items.forEach((it,i)=>{
  const cost=parseFloat(it.cost)||0;
  const qty=parseInt(it.qty)||0;
  const lineTotal=cost*qty;
  rowsHtml+="<tr><td>"+(i+1)+"</td><td>"+(it.productName||"")+"</td><td class='c'>"+qty+"</td><td class='r'>"+cost.toFixed(3)+"</td><td class='r'><strong>"+lineTotal.toFixed(3)+"</strong></td></tr>";
});
const html="<!DOCTYPE html><html dir='"+dir+"'><head><meta charset='utf-8'><title>"+lbl("فاتورة شراء","Purchase Invoice")+" "+invView.invoiceNo+"</title>"
+"<style>"
+"@page{size:A4;margin:15mm}"
+"*{margin:0;padding:0;box-sizing:border-box}"
+"body{font-family:Arial,sans-serif;font-size:11pt;color:#1f2937;direction:"+dir+"}"
+".header{display:flex;align-items:center;border-bottom:3px solid #1e40af;padding-bottom:14px;margin-bottom:20px}"
+".logo{height:80px;margin-"+(rtl?"left":"right")+":18px}"
+".store{flex:1}"
+".store h1{font-size:22pt;color:#1e40af;font-weight:900;margin-bottom:4px}"
+".store p{color:#6b7280;font-size:10pt;line-height:1.5}"
+".doctype{text-align:"+(rtl?"left":"right")+"}"
+".doctype .t{background:#1e40af;color:#fff;padding:8px 18px;font-size:14pt;font-weight:800;border-radius:6px;display:inline-block}"
+".doctype .n{font-size:11pt;margin-top:8px;color:#374151;font-family:monospace;font-weight:700}"
+".meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;background:#f9fafb;padding:12px;border-radius:8px}"
+".meta div{font-size:10pt}"
+".meta strong{color:#1f2937;display:inline-block;min-width:80px;font-weight:700}"
+".meta span{color:#6b7280}"
+"table{width:100%;border-collapse:collapse;margin-bottom:18px}"
+"thead tr{background:#1e40af;color:#fff}"
+"th{padding:10px 8px;text-align:"+(rtl?"right":"left")+";font-weight:700;font-size:10pt}"
+"th.c,td.c{text-align:center}"
+"th.r,td.r{text-align:"+(rtl?"left":"right")+"}"
+"tbody tr{border-bottom:1px solid #e5e7eb}"
+"tbody tr:nth-child(even){background:#f9fafb}"
+"td{padding:9px 8px;font-size:10pt}"
+".totals{margin-"+(rtl?"right":"left")+":auto;width:280px;background:#f9fafb;border:2px solid #1e40af;border-radius:8px;padding:14px;margin-top:10px}"
+".totals .row{display:flex;justify-content:space-between;padding:5px 0;font-size:11pt}"
+".totals .grand{border-top:2px solid #1e40af;padding-top:10px;margin-top:8px;font-size:14pt;font-weight:900;color:#1e40af}"
+".sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:50px;padding-top:20px;border-top:1px solid #d1d5db}"
+".sig{text-align:center}"
+".sig .l{font-size:9pt;color:#6b7280;margin-bottom:35px}"
+".sig .b{border-top:1.5px solid #374151;padding-top:5px;font-size:9pt;font-weight:700}"
+".footer{text-align:center;margin-top:30px;font-size:8pt;color:#9ca3af;border-top:1px dashed #d1d5db;padding-top:10px}"
+"</style></head><body>"
+"<div class='header'>"
+"<img class='logo' src='"+STORE_LOGO+"' alt='3045'/>"
+"<div class='store'><h1>"+(storeSettings.storeName||"3045 Supermarket")+"</h1>"
+"<p>"+lbl("إربد، شارع المدينة المنورة - مقابل SOS","Irbid, Almadina Almonawarah St. (Opp. SOS)")+"</p>"
+"<p>📞 0791191244</p></div>"
+"<div class='doctype'><div class='t'>"+lbl("فاتورة شراء","PURCHASE INVOICE")+"</div><div class='n'># "+invView.invoiceNo+"</div></div>"
+"</div>"
+"<div class='meta'>"
+"<div><strong>"+lbl("المورد","Supplier")+":</strong> <span>"+(invView.supplier||"-")+"</span></div>"
+"<div><strong>"+lbl("التاريخ","Date")+":</strong> <span>"+invView.date+" "+invView.time+"</span></div>"
+"<div><strong>"+lbl("استلمها","Received By")+":</strong> <span>"+(invView.receivedBy||"-")+"</span></div>"
+"<div><strong>"+lbl("عدد الأصناف","Items")+":</strong> <span>"+invView.items.length+"</span></div>"
+"</div>"
+"<table><thead><tr>"
+"<th class='c'>#</th>"
+"<th>"+lbl("الصنف","Product")+"</th>"
+"<th class='c'>"+lbl("الكمية","Qty")+"</th>"
+"<th class='r'>"+lbl("سعر الوحدة","Unit Cost")+" (JD)</th>"
+"<th class='r'>"+lbl("الإجمالي","Total")+" (JD)</th>"
+"</tr></thead><tbody>"+rowsHtml+"</tbody></table>"
+"<div class='totals'>"
+"<div class='row'><span>"+lbl("عدد الأصناف","Total Items")+":</span><strong>"+invView.items.length+"</strong></div>"
+"<div class='row'><span>"+lbl("مجموع القطع","Total Units")+":</span><strong>"+invView.items.reduce(function(s,i){return s+(parseInt(i.qty)||0)},0)+"</strong></div>"
+"<div class='row grand'><span>"+lbl("الإجمالي","TOTAL")+":</span><span>"+invView.totalCost.toFixed(3)+" JD</span></div>"
+"</div>"
+"<div class='sigs'>"
+"<div class='sig'><div class='l'>"+lbl("توقيع المستلم","Received By Signature")+"</div><div class='b'>____________________</div></div>"
+"<div class='sig'><div class='l'>"+lbl("توقيع المورد","Supplier Signature")+"</div><div class='b'>____________________</div></div>"
+"<div class='sig'><div class='l'>"+lbl("توقيع المدير","Manager Signature")+"</div><div class='b'>____________________</div></div>"
+"</div>"
+"<div class='footer'>"+lbl("تم الإنشاء بواسطة","Generated by")+": "+(cu?.fn||"")+" · "+new Date().toLocaleString("en-US")+"</div>"
+"</body></html>";
w.document.write(html);w.document.close();setTimeout(function(){w.print()},500);
}} style={{marginTop:14,padding:"12px 20px",background:"#1e40af",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)",width:"100%"}}>🖨 {rtl?"طباعة A4":"Print A4"}</button>

{/* Attachment display or attach later */}
<div style={{marginTop:14,borderTop:"1px solid #e5e7eb",paddingTop:14}}>
{invView.attachment?<>
<div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>📎 {t.attachInvoice}</div>
{invView.attachment.startsWith("data:image")?
<img src={invView.attachment} style={{width:"100%",maxHeight:250,objectFit:"contain",borderRadius:12,border:"1px solid #e5e7eb"}} alt=""/>:
<a href={invView.attachment} download={invView.attachName||"invoice"} style={{display:"block",padding:12,background:"#eff6ff",borderRadius:10,textAlign:"center",color:"#2563eb",fontWeight:600,textDecoration:"none",fontSize:12}}>📥 {rtl?"تحميل":"Download"} {invView.attachName}</a>}
</>:<>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<button onClick={()=>document.getElementById("inv-attach-later")?.click()} style={{flex:1,padding:"10px 16px",background:"#fffbeb",border:"1.5px dashed #fcd34d",borderRadius:10,color:"#92400e",fontSize:12,cursor:"pointer",fontFamily:"var(--f)"}}>📎 {rtl?"إرفاق صورة الفاتورة لاحقاً":"Attach invoice image now"}</button>
</div>
<input id="inv-attach-later" type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2000000){sT("✗ Max 2MB","err");return}const r=new FileReader();r.onload=ev=>{const updated={...invView,attachment:ev.target.result,attachName:f.name};setInvs(p=>p.map(x=>x.id===invView.id?updated:x));setInvView(updated);sT("✓ "+t.saved,"ok")};r.readAsDataURL(f)}}/>
</>}
</div>
</div></div>}

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
{custViewMod&&(()=>{
// Customer Purchase Intelligence
const custTxs=txns.filter(tx=>tx.custPhone===custViewMod.phone);
const custItems={};
custTxs.forEach(tx=>tx.items.forEach(i=>{custItems[i.id]=(custItems[i.id]||{...i,totalQty:0,totalSpent:0,count:0});custItems[i.id].totalQty+=i.qty;custItems[i.id].totalSpent+=i.p*i.qty;custItems[i.id].count++}));
const favProducts=Object.values(custItems).sort((a,b)=>b.totalQty-a.totalQty).slice(0,5);
const avgSpend=custTxs.length>0?(custTxs.reduce((s,tx)=>s+tx.tot,0)/custTxs.length):0;
const lastVisit=custTxs.length>0?custTxs[0].date:"—";
const ltv=custViewMod.spent;
const daysSinceVisit=custTxs.length>0?Math.floor((new Date()-new Date(custTxs[0].ts))/86400000):null;
const visitFreq=custViewMod.visits>1&&custTxs.length>1?Math.round((new Date(custTxs[0].ts)-new Date(custTxs[custTxs.length-1].ts))/86400000/Math.max(1,custViewMod.visits-1)):null;
// Personalized suggestions
const suggestions=[];
const favCats={};favProducts.forEach(p=>{const prod=prods.find(x=>x.id===p.id);if(prod)favCats[prod.cat]=(favCats[prod.cat]||0)+p.totalQty});
const topCat=Object.entries(favCats).sort((a,b)=>b[1]-a[1])[0];
if(topCat){const relatedProds=prods.filter(p=>p.cat===topCat[0]&&!custItems[p.id]);relatedProds.slice(0,2).forEach(p=>suggestions.push({icon:"💡",text:rtl?("العميل يشتري "+topCat[0]+" كثيراً — اقترح "+p.a):("Customer buys "+topCat[0]+" often — suggest "+p.n)}))}
if(daysSinceVisit!==null&&daysSinceVisit>14)suggestions.push({icon:"📱",text:rtl?"لم يزر منذ "+daysSinceVisit+" يوم — أرسل عرض":"Haven't visited in "+daysSinceVisit+"d — send offer"});
if(custViewMod.pts>=100)suggestions.push({icon:"🎁",text:rtl?"لديه "+custViewMod.pts+" نقطة — ذكره بالاستبدال":"Has "+custViewMod.pts+" pts — remind to redeem"});

return<div className="ov" onClick={()=>setCustViewMod(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
<h2>👤 {custViewMod.name}<button className="mc" onClick={()=>setCustViewMod(null)}>✕</button></h2>

{/* Basic Info */}
<div style={{display:"flex",gap:8,marginBottom:14}}>
<div style={{flex:1,background:"var(--blue50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.custPhone}</div><div style={{fontSize:14,fontWeight:700,fontFamily:"var(--m)",color:"#1e40af"}}>{custViewMod.phone}</div></div>
<div style={{flex:1,background:"var(--green50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.points}</div><div style={{fontSize:20,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{custViewMod.pts}</div></div>
<div style={{flex:1,background:custViewMod.tier==="vip"?"#f5f3ff":custViewMod.tier==="gold"?"#fffbeb":"var(--g50)",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{t.tier}</div><div style={{fontSize:14,fontWeight:800,textTransform:"uppercase",color:custViewMod.tier==="vip"?"#7c3aed":custViewMod.tier==="gold"?"#d97706":"#6b7280"}}>{t[custViewMod.tier]}</div></div>
</div>

{/* Purchase Intelligence KPIs */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
<div style={{background:"#f9fafb",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"إجمالي الإنفاق":"Lifetime Value"}</div><div style={{fontSize:16,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(ltv)}</div></div>
<div style={{background:"#f9fafb",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"متوسط الفاتورة":"Avg Spend"}</div><div style={{fontSize:16,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{fm(avgSpend)}</div></div>
<div style={{background:"#f9fafb",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"كل":"Every"}</div><div style={{fontSize:16,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{visitFreq?visitFreq+"d":"—"}</div></div>
<div style={{background:"#f9fafb",borderRadius:10,padding:10,textAlign:"center"}}><div style={{fontSize:9,color:"#6b7280"}}>{rtl?"آخر زيارة":"Last Visit"}</div><div style={{fontSize:14,fontWeight:700,fontFamily:"var(--m)",color:daysSinceVisit>14?"#dc2626":"#374151"}}>{lastVisit}</div></div>
</div>

{/* Favorite Products */}
{favProducts.length>0&&<div style={{marginBottom:14}}>
<div style={{fontSize:12,fontWeight:700,marginBottom:8}}>❤️ {rtl?"المنتجات المفضلة":"Favorite Products"}</div>
{favProducts.map((fp2,i)=>{const pr=prods.find(x=>x.id===fp2.id);return<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
<span style={{fontSize:11,fontWeight:800,color:"#d97706",width:16}}>{i+1}</span>
<span style={{fontSize:14}}>{pr?.e||"📦"}</span>
<div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{pr?pN(pr):fp2.n}</div><div style={{fontSize:9,color:"#9ca3af"}}>{fp2.count} {rtl?"مرة":"times"}</div></div>
<div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,fontFamily:"var(--m)",color:"#059669"}}>{fp2.totalQty} {rtl?"وحدة":"units"}</div><div style={{fontSize:9,color:"#9ca3af",fontFamily:"var(--m)"}}>{fm(fp2.totalSpent)}</div></div>
</div>})}
</div>}

{/* Personalized Suggestions */}
{suggestions.length>0&&<div style={{background:"linear-gradient(135deg,#eff6ff,#e0e7ff)",borderRadius:14,padding:14,marginBottom:14}}>
<div style={{fontSize:12,fontWeight:700,marginBottom:8,color:"#1e40af"}}>💡 {rtl?"اقتراحات شخصية":"Personalized Suggestions"}</div>
{suggestions.map((s,i)=><div key={i} style={{display:"flex",gap:8,fontSize:11,padding:"4px 0",color:"#374151"}}><span>{s.icon}</span><span>{s.text}</span></div>)}
</div>}

{/* Points History */}
<div style={{fontSize:13,fontWeight:700,marginBottom:8}}>{t.ptHistory}</div>
{custHistory.length===0?<div style={{textAlign:"center",padding:20,color:"#9ca3af",fontSize:12}}>{t.noTxns}</div>:
<div style={{maxHeight:150,overflowY:"auto"}}>{custHistory.map(h=><div key={h.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--g100)",fontSize:12}}>
<div><span style={{fontWeight:600,color:h.type==="earn"?"#059669":"#7c3aed"}}>{h.type==="earn"?"⬆ "+t.earned:"⬇ "+t.redeemed}</span><div style={{fontSize:10,color:"#9ca3af"}}>{h.description}</div></div>
<div style={{textAlign:"right"}}><div style={{fontWeight:700,fontFamily:"var(--m)",color:h.type==="earn"?"#059669":"#7c3aed"}}>{h.type==="earn"?"+":"-"}{h.points}</div><div style={{fontSize:10,color:"#9ca3af"}}>{new Date(h.created_at).toLocaleDateString()}</div></div>
</div>)}</div>}
</div></div>})()}

{/* ADD PROMOTION MODAL */}
{promoMod&&<div className="ov" onClick={()=>setPromoMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
<h2>🎯 {rtl?"إضافة عرض":"Add Promotion"}<button className="mc" onClick={()=>setPromoMod(false)}>✕</button></h2>
{(()=>{const[np,setNP2]=useState({name:"",name_ar:"",promo_type:"percent_off",discount_value:"",buy_qty:2,get_qty:1,min_purchase:"",applies_to:"all",applies_to_id:"",start_date:new Date().toISOString().slice(0,10),end_date:"",start_hour:"",end_hour:"",max_uses:0,status:"active"});
return<>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"الاسم":"Name"}</label><input value={np.name} onChange={e=>setNP2({...np,name:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"الاسم عربي":"Name AR"}</label><input value={np.name_ar} onChange={e=>setNP2({...np,name_ar:e.target.value})} style={{direction:"rtl"}}/></div>
</div>
<div className="pf"><label>{rtl?"نوع العرض":"Promotion Type"}</label><select value={np.promo_type} onChange={e=>setNP2({...np,promo_type:e.target.value})} style={{fontFamily:"var(--f)"}}>
<option value="percent_off">📊 {rtl?"خصم نسبة":"% Discount"}</option>
<option value="fixed_off">💰 {rtl?"خصم ثابت":"Fixed Discount"}</option>
<option value="buy_x_get_y">🎁 {rtl?"اشتر X واحصل Y":"Buy X Get Y"}</option>
<option value="category_discount">📦 {rtl?"خصم فئة":"Category Discount"}</option>
<option value="happy_hour">⏰ {rtl?"ساعة سعيدة":"Happy Hour"}</option>
<option value="campaign">🌙 {rtl?"حملة (رمضان/عيد)":"Campaign (Ramadan/Eid)"}</option>
</select></div>
{(np.promo_type==="percent_off"||np.promo_type==="category_discount"||np.promo_type==="happy_hour"||np.promo_type==="campaign")&&<div className="pf"><label>{rtl?"نسبة الخصم %":"Discount %"}</label><input type="number" value={np.discount_value} onChange={e=>setNP2({...np,discount_value:e.target.value})} placeholder="10"/></div>}
{np.promo_type==="fixed_off"&&<div className="pf"><label>{rtl?"مبلغ الخصم (JD)":"Discount Amount (JD)"}</label><input type="number" value={np.discount_value} onChange={e=>setNP2({...np,discount_value:e.target.value})} placeholder="1.000"/></div>}
{np.promo_type==="buy_x_get_y"&&<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"اشتر":"Buy"}</label><input type="number" value={np.buy_qty} onChange={e=>setNP2({...np,buy_qty:parseInt(e.target.value)||2})}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"احصل مجاناً":"Get Free"}</label><input type="number" value={np.get_qty} onChange={e=>setNP2({...np,get_qty:parseInt(e.target.value)||1})}/></div>
</div>}
{np.promo_type==="happy_hour"&&<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"من ساعة":"From Hour"}</label><input type="number" min="0" max="23" value={np.start_hour} onChange={e=>setNP2({...np,start_hour:e.target.value})} placeholder="14"/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"إلى ساعة":"To Hour"}</label><input type="number" min="0" max="23" value={np.end_hour} onChange={e=>setNP2({...np,end_hour:e.target.value})} placeholder="16"/></div>
</div>}
{np.promo_type==="category_discount"&&<div className="pf"><label>{rtl?"الفئة":"Category"}</label><select value={np.applies_to_id} onChange={e=>setNP2({...np,applies_to_id:e.target.value,applies_to:"category"})} style={{fontFamily:"var(--f)"}}><option value="">{rtl?"الكل":"All"}</option>{CATS_ALL.filter(c=>c.id!=="all").map(c=><option key={c.id} value={c.id}>{c.i} {t[c.k]}</option>)}</select></div>}
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.startDate}</label><input type="date" value={np.start_date} onChange={e=>setNP2({...np,start_date:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.endDate}</label><input type="date" value={np.end_date} onChange={e=>setNP2({...np,end_date:e.target.value})}/></div>
</div>
<div className="pf"><label>{rtl?"الحد الأدنى للشراء":"Min Purchase"} (JD)</label><input type="number" value={np.min_purchase} onChange={e=>setNP2({...np,min_purchase:e.target.value})} placeholder="0"/></div>
<button className="cpb" style={{background:"#7c3aed"}} onClick={async()=>{if(!np.name||!np.promo_type)return;try{const r=await DB.addPromotion({...np,discount_value:parseFloat(np.discount_value)||0,min_purchase:parseFloat(np.min_purchase)||0,start_hour:np.start_hour?parseInt(np.start_hour):null,end_hour:np.end_hour?parseInt(np.end_hour):null,created_by:cu?.id});if(r)setPromotions(p=>[r,...p]);setPromoMod(false);sT("✓ "+(rtl?"تمت الإضافة":"Promotion added"),"ok")}catch(e){console.error(e)}}} disabled={!np.name}>✓ {rtl?"إضافة عرض":"Add Promotion"}</button>
</>})()}
</div></div>}

{/* ADD COUPON MODAL */}
{couponMod&&<div className="ov" onClick={()=>setCouponMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>🎟️ {rtl?"إنشاء قسيمة":"Create Coupon"}<button className="mc" onClick={()=>setCouponMod(false)}>✕</button></h2>
{(()=>{const[nc,setNC]=useState({code:genCode(),coupon_type:"percent",discount_value:"",min_purchase:"",valid_until:"",max_uses:1,customer_phone:""});
return<>
<div className="pf"><label>{rtl?"رمز القسيمة":"Coupon Code"}</label>
<div style={{display:"flex",gap:6}}>
<input value={nc.code} onChange={e=>setNC({...nc,code:e.target.value.toUpperCase()})} style={{flex:1,fontFamily:"var(--m)",fontSize:16,fontWeight:800,letterSpacing:2,textTransform:"uppercase"}}/>
<button onClick={()=>setNC({...nc,code:genCode()})} style={{padding:"8px 14px",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,fontSize:11,cursor:"pointer",fontFamily:"var(--f)"}}>🔄</button>
</div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"النوع":"Type"}</label><select value={nc.coupon_type} onChange={e=>setNC({...nc,coupon_type:e.target.value})} style={{fontFamily:"var(--f)"}}>
<option value="percent">{rtl?"خصم %":"% Off"}</option>
<option value="fixed">{rtl?"مبلغ ثابت":"Fixed Amount"}</option>
<option value="freeitem">{rtl?"منتج مجاني":"Free Item"}</option>
</select></div>
<div className="pf" style={{flex:1}}><label>{rtl?"القيمة":"Value"}</label><input type="number" value={nc.discount_value} onChange={e=>setNC({...nc,discount_value:e.target.value})} placeholder={nc.coupon_type==="percent"?"10":"1.000"}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"صالح حتى":"Valid Until"}</label><input type="date" value={nc.valid_until} onChange={e=>setNC({...nc,valid_until:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"عدد الاستخدامات":"Max Uses"}</label><input type="number" value={nc.max_uses} onChange={e=>setNC({...nc,max_uses:parseInt(e.target.value)||1})}/></div>
</div>
<div className="pf"><label>{rtl?"الحد الأدنى للشراء":"Min Purchase"} (JD)</label><input type="number" value={nc.min_purchase} onChange={e=>setNC({...nc,min_purchase:e.target.value})} placeholder="0"/></div>
<div className="pf"><label>{rtl?"رقم العميل (اختياري)":"Customer Phone (optional)"}</label><input value={nc.customer_phone} onChange={e=>setNC({...nc,customer_phone:e.target.value})} placeholder="07xxxxxxxx"/></div>

{/* Preview */}
<div style={{background:"linear-gradient(135deg,#f5f3ff,#ede9fe)",border:"2px dashed #7c3aed",borderRadius:16,padding:20,textAlign:"center",marginBottom:12}}>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed",letterSpacing:3}}>{nc.code}</div>
<div style={{fontSize:14,fontWeight:700,color:"#059669",marginTop:4}}>{nc.coupon_type==="percent"?(nc.discount_value||0)+"% OFF":nc.coupon_type==="fixed"?fm(parseFloat(nc.discount_value)||0)+" OFF":rtl?"منتج مجاني":"FREE ITEM"}</div>
{nc.min_purchase&&<div style={{fontSize:10,color:"#6b7280",marginTop:2}}>{rtl?"حد أدنى":"Min"}: {fm(parseFloat(nc.min_purchase)||0)}</div>}
</div>

<button className="cpb" style={{background:"#7c3aed"}} onClick={async()=>{if(!nc.code||!nc.discount_value)return;const c={code:nc.code,coupon_type:nc.coupon_type,discount_value:parseFloat(nc.discount_value)||0,min_purchase:parseFloat(nc.min_purchase)||0,valid_until:nc.valid_until||null,max_uses:nc.max_uses,customer_phone:nc.customer_phone||null,status:"active",created_by:cu?.id};try{const r=await DB.addCoupon(c);if(r)setCoupons(p=>[r,...p]);setCouponMod(false);sT("✓ "+(rtl?"تم إنشاء القسيمة":"Coupon created"),"ok")}catch(e){console.error(e);sT("✗ Code may already exist","err")}}} disabled={!nc.code||!nc.discount_value}>🎟️ {rtl?"إنشاء قسيمة":"Create Coupon"}</button>
</>})()}
</div></div>}

{/* QR CODE VIEW MODAL */}
{couponQR&&<div className="ov" onClick={()=>setCouponQR(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:380,textAlign:"center"}}>
<h2>📱 QR {rtl?"قسيمة":"Coupon"}<button className="mc" onClick={()=>setCouponQR(null)}>✕</button></h2>
<div style={{background:"linear-gradient(135deg,#f5f3ff,#ede9fe)",borderRadius:20,padding:24,marginBottom:16}}>
<img src={couponQR.url} style={{width:200,height:200,borderRadius:12}} alt="QR"/>
<div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed",letterSpacing:3,marginTop:12}}>{couponQR.code}</div>
{couponQR.coupon&&<>
<div style={{fontSize:16,fontWeight:700,color:"#059669",marginTop:4}}>{couponQR.coupon.coupon_type==="percent"?couponQR.coupon.discount_value+"% OFF":fm(+couponQR.coupon.discount_value)+" OFF"}</div>
<div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{rtl?"صالح حتى":"Valid until"}: {couponQR.coupon.valid_until||"∞"}</div>
</>}
</div>
<div style={{display:"flex",gap:8}}>
<button className="rb rb-p" style={{flex:1}} onClick={()=>window.print()}>🖨 {t.print}</button>
<button className="rb rb-n" style={{flex:1}} onClick={()=>{const a=document.createElement("a");a.href=couponQR.url;a.download="coupon-"+couponQR.code+".png";a.click()}}>📥 {rtl?"تحميل":"Download"}</button>
</div>
</div></div>}

{/* ADD EXPENSE MODAL */}
{expMod&&<div className="ov" onClick={()=>setExpMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>💸 {t.addExpense}<button className="mc" onClick={()=>setExpMod(false)}>✕</button></h2>
<div className="pf"><label>{t.expCategory}</label><select value={newExp.category_id} onChange={e=>setNewExp({...newExp,category_id:+e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">--</option>{expCats.map(c=><option key={c.id} value={c.id}>{c.icon} {rtl?c.name_ar:c.name}</option>)}</select></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.expAmount} (JD)</label><input type="number" value={newExp.amount} onChange={e=>setNewExp({...newExp,amount:e.target.value})} placeholder="0.000"/></div>
<div className="pf" style={{flex:1}}><label>{t.expDate}</label><input type="date" value={newExp.expense_date} onChange={e=>setNewExp({...newExp,expense_date:e.target.value})}/></div>
</div>
<div className="pf"><label>{t.expDesc}</label><input value={newExp.description} onChange={e=>setNewExp({...newExp,description:e.target.value})}/></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.payMethod}</label><select value={newExp.payment_method} onChange={e=>setNewExp({...newExp,payment_method:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="cash">{t.cash}</option><option value="bank">{t.bank}</option><option value="check">{t.check}</option></select></div>
<div className="pf" style={{flex:1}}><label>{t.expRecurring}</label><select value={newExp.recurring} onChange={e=>setNewExp({...newExp,recurring:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="none">{t.none2}</option><option value="monthly">{t.monthly2}</option><option value="weekly">{t.weekly2}</option><option value="yearly">{t.yearly2}</option></select></div>
</div>
<div className="pf"><label>{t.refNo}</label><input value={newExp.reference_no} onChange={e=>setNewExp({...newExp,reference_no:e.target.value})}/></div>

{/* Debit from bank account */}
<div className="pf"><label>🏦 {t.debitFrom}</label>
<select value={newExp.debit_account} onChange={e=>setNewExp({...newExp,debit_account:e.target.value})} style={{fontFamily:"var(--f)"}}>
<option value="">{t.noDebit}</option>
{bankAccts.map(a=><option key={a.id} value={a.id}>{a.bank_name?"🏦 ":"💵 "}{rtl?(a.name_ar||a.name):a.name}{a.bank_name?" — "+a.bank_name:""}{a.account_no?" #"+a.account_no:""} ({fm(+a.balance)})</option>)}
</select>
</div>

{/* Attach invoice image */}
<div className="pf"><label>📎 {t.attachInvoice}</label>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<button onClick={()=>document.getElementById("exp-attach")?.click()} style={{padding:"10px 20px",background:"#f3f4f6",border:"1.5px dashed #d1d5db",borderRadius:10,color:"#6b7280",fontSize:12,cursor:"pointer",fontFamily:"var(--f)",flex:1}}>{newExp.attachment?"✓ "+newExp.fileName:rtl?"📷 اختر صورة أو ملف":"📷 Choose image or file"}</button>
{newExp.attachment&&<button onClick={()=>setNewExp({...newExp,attachment:null,fileName:""})} style={{padding:"8px",background:"#fef2f2",border:"none",borderRadius:8,color:"#dc2626",cursor:"pointer",fontSize:12}}>✕</button>}
</div>
<input id="exp-attach" type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2000000){sT("✗ Max 2MB","err");return}const r=new FileReader();r.onload=ev=>setNewExp(p=>({...p,attachment:ev.target.result,fileName:f.name}));r.readAsDataURL(f)}}/>
{newExp.attachment&&newExp.attachment.startsWith("data:image")&&<img src={newExp.attachment} style={{marginTop:8,maxHeight:120,borderRadius:8,border:"1px solid #e5e7eb"}} alt=""/>}
</div>

{/* Preview */}
{newExp.debit_account&&parseFloat(newExp.amount)>0&&(()=>{const acct=bankAccts.find(a=>a.id===+newExp.debit_account);const newBal=acct?(+acct.balance-parseFloat(newExp.amount)):0;return<div style={{background:"#fef2f2",borderRadius:12,padding:10,marginBottom:12,display:"flex",justifyContent:"space-between",fontSize:11}}>
<span>🏦 {rtl?"سيتم خصم من":"Debit from"}: {acct?(rtl?(acct.name_ar||acct.name):acct.name):""}</span>
<span style={{fontFamily:"var(--m)",fontWeight:700,color:newBal>=0?"#059669":"#dc2626"}}>{t.balAfter}: {fm(newBal)}</span>
</div>})()}

<button className="cpb" style={{background:"#dc2626"}} onClick={async()=>{if(!newExp.category_id||!newExp.amount)return;const amt=parseFloat(newExp.amount)||0;
// Save expense to DB (without attachment - stored locally)
const e={category_id:newExp.category_id,amount:amt,description:newExp.description,payment_method:newExp.payment_method,expense_date:newExp.expense_date,recurring:newExp.recurring,reference_no:newExp.reference_no,created_by:cu?.id};
try{const r=await DB.addExpense(e);
if(r){
  setExpensesList(p=>[r,...p]);
  // Attachment storage disabled
  if(newExp.attachment){try{const attachments={};attachments[r.id]=newExp.attachment;/* attachments disabled */}catch{}}
  // Auto-debit from bank account
  if(newExp.debit_account&&amt>0){
    const acct=bankAccts.find(a=>a.id===+newExp.debit_account);
    if(acct){
      const newBal=+acct.balance-amt;
      await DB.updateBankBalance(acct.id,newBal);
      await DB.addMoneyMovement({account_id:acct.id,type:"withdrawal",amount:amt,balance_after:newBal,description:(newExp.description||t.expenses)+" — "+newExp.reference_no,reference_no:newExp.reference_no,created_by:cu?.id});
      setBankAccts(p=>p.map(a=>a.id===acct.id?{...a,balance:newBal}:a));
      const mv=await DB.getMoneyMovements();setMovements(mv);
    }
  }
}
setExpMod(false);sT("✓ "+t.saved+(newExp.debit_account?" + "+t.withdrawal:""),"ok")}catch(er){console.error("Expense error:",er);sT("✗ Error","err")}}} disabled={!newExp.category_id||!newExp.amount}>✓ {t.addExpense} — {fm(parseFloat(newExp.amount)||0)}{newExp.debit_account&&<span style={{fontSize:10,opacity:.7}}> + {t.withdrawal}</span>}</button>
</div></div>}

{/* DEPOSIT/WITHDRAWAL/TRANSFER MODAL */}
{movMod&&<div className="ov" onClick={()=>setMovMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>🏦 {t.deposit} / {t.withdrawal} / {t.transfer}<button className="mc" onClick={()=>setMovMod(false)}>✕</button></h2>
<div className="pf"><label>{rtl?"من حساب":"From Account"}</label><select value={newMov.account_id} onChange={e=>setNewMov({...newMov,account_id:+e.target.value})} style={{fontFamily:"var(--f)"}}>{bankAccts.map(a=><option key={a.id} value={a.id}>{a.bank_name?"🏦 ":"💵 "}{rtl?(a.name_ar||a.name):a.name}{a.bank_name?" — "+a.bank_name:""}{a.account_no?" #"+a.account_no:""} ({fm(+a.balance)})</option>)}</select></div>
<div className="pf"><label>{t.movementType}</label><select value={newMov.type} onChange={e=>setNewMov({...newMov,type:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="deposit">↑ {t.deposit}</option><option value="withdrawal">↓ {t.withdrawal}</option><option value="sales_deposit">🛒 {t.salesDeposit}</option><option value="transfer">🔄 {t.transfer}</option></select></div>

{/* Transfer target account */}
{newMov.type==="transfer"&&<div className="pf"><label>➡️ {rtl?"إلى حساب":"To Account"}</label><select value={newMov.to_account_id} onChange={e=>setNewMov({...newMov,to_account_id:+e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">--</option>{bankAccts.filter(a=>a.id!==newMov.account_id).map(a=><option key={a.id} value={a.id}>{a.bank_name?"🏦 ":"💵 "}{rtl?(a.name_ar||a.name):a.name}{a.bank_name?" — "+a.bank_name:""}{a.account_no?" #"+a.account_no:""} ({fm(+a.balance)})</option>)}</select></div>}

<div className="pf"><label>{t.expAmount} (JD)</label><input type="number" value={newMov.amount} onChange={e=>setNewMov({...newMov,amount:e.target.value})} placeholder="0.000"/></div>
<div className="pf"><label>{t.expDesc}</label><input value={newMov.description} onChange={e=>setNewMov({...newMov,description:e.target.value})}/></div>
<div className="pf"><label>{t.refNo}</label><input value={newMov.reference_no} onChange={e=>setNewMov({...newMov,reference_no:e.target.value})}/></div>

{/* Balance preview */}
{newMov.type==="transfer"?(()=>{
const fromAcct=bankAccts.find(a=>a.id===newMov.account_id);const toAcct=bankAccts.find(a=>a.id===newMov.to_account_id);const amt=parseFloat(newMov.amount)||0;
const fromBal=fromAcct?(+fromAcct.balance-amt):0;const toBal=toAcct?(+toAcct.balance+amt):0;
return<div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",marginBottom:12}}>
<div style={{background:"#fef2f2",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"من":"From"}</div><div style={{fontSize:11,fontWeight:600}}>{fromAcct?(rtl?(fromAcct.name_ar||fromAcct.name):fromAcct.name):""}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:fromBal>=0?"#059669":"#dc2626"}}>{fm(fromBal)}</div></div>
<div style={{fontSize:24}}>➡️</div>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"إلى":"To"}</div><div style={{fontSize:11,fontWeight:600}}>{toAcct?(rtl?(toAcct.name_ar||toAcct.name):toAcct.name):""}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(toBal)}</div></div>
</div>})()
:(()=>{const acct=bankAccts.find(a=>a.id===newMov.account_id);const amt=parseFloat(newMov.amount)||0;const isIn=newMov.type==="deposit"||newMov.type==="sales_deposit";const newBal=acct?(+acct.balance+(isIn?amt:-amt)):0;return<div style={{background:isIn?"#ecfdf5":"#fef2f2",borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}><div style={{fontSize:11,color:"#6b7280"}}>{t.balAfter}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:newBal>=0?"#059669":"#dc2626"}}>{fm(newBal)}</div></div>})()}

<button className="cpb cpb-green" onClick={async()=>{
if(!newMov.account_id||!newMov.amount)return;
if(newMov.type==="transfer"&&!newMov.to_account_id)return;
const amt=parseFloat(newMov.amount)||0;
try{
if(newMov.type==="transfer"){
  // Transfer: withdraw from source, deposit to target
  const fromAcct=bankAccts.find(a=>a.id===newMov.account_id);
  const toAcct=bankAccts.find(a=>a.id===newMov.to_account_id);
  if(!fromAcct||!toAcct)return;
  const fromBal=+fromAcct.balance-amt;const toBal=+toAcct.balance+amt;
  const fromName=rtl?(fromAcct.name_ar||fromAcct.name):fromAcct.name;
  const toName=rtl?(toAcct.name_ar||toAcct.name):toAcct.name;
  await DB.updateBankBalance(fromAcct.id,fromBal);
  await DB.updateBankBalance(toAcct.id,toBal);
  await DB.addMoneyMovement({account_id:fromAcct.id,type:"withdrawal",amount:amt,balance_after:fromBal,description:t.transfer+" → "+toName+(newMov.description?" — "+newMov.description:""),reference_no:newMov.reference_no,created_by:cu?.id});
  await DB.addMoneyMovement({account_id:toAcct.id,type:"deposit",amount:amt,balance_after:toBal,description:t.transfer+" ← "+fromName+(newMov.description?" — "+newMov.description:""),reference_no:newMov.reference_no,created_by:cu?.id});
  setBankAccts(p=>p.map(a=>a.id===fromAcct.id?{...a,balance:fromBal}:a.id===toAcct.id?{...a,balance:toBal}:a));
}else{
  const isIn=newMov.type==="deposit"||newMov.type==="sales_deposit";
  const acct=bankAccts.find(a=>a.id===newMov.account_id);if(!acct)return;
  const newBal=+acct.balance+(isIn?amt:-amt);
  await DB.updateBankBalance(newMov.account_id,newBal);
  await DB.addMoneyMovement({account_id:newMov.account_id,type:newMov.type,amount:amt,balance_after:newBal,description:newMov.description,reference_no:newMov.reference_no,created_by:cu?.id});
  setBankAccts(p=>p.map(a=>a.id===newMov.account_id?{...a,balance:newBal}:a));
}
const mv=await DB.getMoneyMovements();setMovements(mv);setMovMod(false);sT("✓ "+t.saved,"ok");
}catch(e){console.error(e)}}} disabled={!newMov.account_id||!newMov.amount||(newMov.type==="transfer"&&!newMov.to_account_id)}>✓ {newMov.type==="transfer"?t.transfer:t.confirm}</button>
</div></div>}

{/* CLOSE SHIFT MODAL */}
{closeShiftMod&&activeShift&&(()=>{
const shiftTxs=txns.filter(tx=>{try{const ts=new Date(tx.ts);return ts>=new Date(activeShift.shift_start)}catch{return false}});
const cashSales=shiftTxs.filter(tx=>tx.method==="cash").reduce((s,tx)=>s+tx.tot,0);
const cardSales=shiftTxs.filter(tx=>tx.method==="card").reduce((s,tx)=>s+tx.tot,0);
const madaSales=shiftTxs.filter(tx=>tx.method==="mobile").reduce((s,tx)=>s+tx.tot,0);
const shiftReturns=salesReturns.filter(r=>{try{return new Date(r.created_at)>=new Date(activeShift.shift_start)}catch{return false}}).reduce((s,r)=>s+ +r.total_refund,0);
const expected=+activeShift.opening_balance+cashSales-shiftReturns;
const actual=parseFloat(shiftCashCount)||0;
const diff=actual-expected;
const diffType=Math.abs(diff)<0.01?"match":diff>0?"overage":"shortage";
const totalItems=shiftTxs.reduce((s,tx)=>s+tx.items.reduce((a,i)=>a+i.qty,0),0);

return<div className="ov" onClick={()=>setCloseShiftMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:460}}>
<h2>🔴 {rtl?"إغلاق الوردية":"Close Shift"}<button className="mc" onClick={()=>setCloseShiftMod(false)}>✕</button></h2>

<div style={{background:"linear-gradient(135deg,#eff6ff,#dbeafe)",borderRadius:16,padding:16,marginBottom:16}}>
<div style={{fontSize:12,color:"#6b7280",marginBottom:4}}>👤 {activeShift.cashier_name}</div>
<div style={{fontSize:10,fontFamily:"var(--m)",color:"#9ca3af"}}>{new Date(activeShift.shift_start).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})} → {new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
</div>

{/* Shift Summary */}
<div style={{fontSize:12,marginBottom:16}}>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}><span>{rtl?"رصيد افتتاحي":"Opening Balance"}</span><span style={{fontFamily:"var(--m)",fontWeight:700}}>{fm(+activeShift.opening_balance)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}><span>💵 {rtl?"مبيعات نقدية":"Cash Sales"}</span><span style={{fontFamily:"var(--m)",fontWeight:700,color:"#059669"}}>{fm(cashSales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}><span>💳 {rtl?"بطاقة + مدى":"Card + mada"}</span><span style={{fontFamily:"var(--m)",color:"#2563eb"}}>{fm(cardSales+madaSales)}</span></div>
{shiftReturns>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}><span>↩️ {rtl?"مرتجعات":"Returns"}</span><span style={{fontFamily:"var(--m)",color:"#dc2626"}}>-{fm(shiftReturns)}</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#9ca3af"}}><span>{t.txns}: {shiftTxs.length}</span><span>{t.items}: {totalItems}</span></div>
</div>

{/* Expected Cash */}
<div style={{background:"#fffbeb",borderRadius:12,padding:14,marginBottom:12,textAlign:"center"}}>
<div style={{fontSize:10,color:"#92400e"}}>{rtl?"النقد المتوقع في الدرج":"Expected Cash in Drawer"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{fm(expected)}</div>
</div>

{/* Actual Cash Count */}
<div className="pf"><label>💰 {rtl?"عد النقد الفعلي":"Count Actual Cash"} (JD)</label>
<input type="number" step="0.001" value={shiftCashCount} onChange={e=>setShiftCashCount(e.target.value)} placeholder="0.000" style={{fontSize:24,textAlign:"center",fontFamily:"var(--m)",fontWeight:800,padding:16}}/>
</div>

{/* Difference */}
{shiftCashCount&&<div style={{background:diffType==="match"?"#ecfdf5":diffType==="overage"?"#eff6ff":"#fef2f2",borderRadius:12,padding:14,textAlign:"center",marginBottom:12}}>
<div style={{fontSize:10,color:"#6b7280"}}>{rtl?"الفرق":"Difference"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:diffType==="match"?"#059669":diffType==="overage"?"#2563eb":"#dc2626"}}>{diff>0?"+":""}{fN(diff)}</div>
<span style={{padding:"4px 14px",borderRadius:20,fontSize:11,fontWeight:700,background:diffType==="match"?"#059669":diffType==="overage"?"#2563eb":"#dc2626",color:"#fff"}}>{diffType==="match"?(rtl?"مطابق ✓":"Match ✓"):diffType==="overage"?(rtl?"زيادة ↑":"Overage ↑"):(rtl?"نقص ↓":"Shortage ↓")}</span>
</div>}

<button className="cpb" style={{background:"#dc2626"}} onClick={async()=>{
if(!shiftCashCount){sT("✗ "+(rtl?"أدخل العد الفعلي":"Enter actual count"),"err");return}
const update={shift_end:new Date().toISOString(),total_cash_sales:+cashSales.toFixed(3),total_card_sales:+cardSales.toFixed(3),total_mada_sales:+madaSales.toFixed(3),total_returns:+shiftReturns.toFixed(3),expected_cash:+expected.toFixed(3),actual_cash:actual,cash_difference:+diff.toFixed(3),difference_type:diffType,total_transactions:shiftTxs.length,total_items_sold:totalItems,status:"closed"};
try{await DB.closeShift(activeShift.id,update);try{await DB.clockOut(cu?.id)}catch{}setCashShifts(p=>p.map(s=>s.id===activeShift.id?{...s,...update}:s));
// Auto-print shift report
const w=window.open("","_blank","width=400,height=600");
if(w){const dir=rtl?"rtl":"ltr";const lbl=(ar,en)=>rtl?ar:en;
const html="<!DOCTYPE html><html><head><meta charset='utf-8'><title>"+lbl("تقرير الوردية","Shift Report")+"</title><style>@page{size:80mm auto;margin:5mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11pt;direction:"+dir+";padding:8px}.h{text-align:center;border-bottom:2px dashed #000;padding-bottom:8px;margin-bottom:8px}.h .n{font-size:14pt;font-weight:900}.h .a{font-size:9pt;color:#555}.s{margin:8px 0}.s .t{font-weight:800;background:#000;color:#fff;padding:3px 6px;font-size:10pt}.r{display:flex;justify-content:space-between;padding:3px 0;font-size:10pt}.r b{font-weight:800}.tot{border-top:1px solid #000;padding-top:4px;margin-top:4px;font-weight:900}.box{border:2px solid #000;padding:8px;margin-top:8px;text-align:center}.box .l{font-size:9pt}.box .v{font-size:18pt;font-weight:900;font-family:monospace}.f{text-align:center;border-top:2px dashed #000;padding-top:6px;margin-top:8px;font-size:8pt;color:#666}</style></head><body>"
+"<div class='h'><div class='n'>"+(storeSettings.storeName||"3045 Supermarket")+"</div><div class='a'>"+lbl("إربد - مقابل SOS","Irbid - Opp. SOS")+"</div><div class='a'>"+lbl("تقرير نهاية الوردية","SHIFT END REPORT")+"</div></div>"
+"<div class='s'><div class='t'>"+lbl("معلومات الوردية","Shift Info")+"</div>"
+"<div class='r'><span>"+lbl("الموظف","Cashier")+":</span><b>"+(cu.fn||"")+"</b></div>"
+"<div class='r'><span>"+lbl("افتُتحت","Opened")+":</span><b>"+new Date(activeShift.shift_start).toLocaleString("en-US",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"})+"</b></div>"
+"<div class='r'><span>"+lbl("أُغلقت","Closed")+":</span><b>"+new Date().toLocaleString("en-US",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"})+"</b></div></div>"
+"<div class='s'><div class='t'>"+lbl("المبيعات","Sales")+"</div>"
+"<div class='r'><span>💵 "+lbl("نقدي","Cash")+":</span><b>"+cashSales.toFixed(3)+" JD</b></div>"
+"<div class='r'><span>💳 "+lbl("فيزا","Visa")+":</span><b>"+cardSales.toFixed(3)+" JD</b></div>"
+"<div class='r'><span>📱 "+lbl("كليك","CliQ")+":</span><b>"+madaSales.toFixed(3)+" JD</b></div>"
+"<div class='r tot'><span>"+lbl("الإجمالي","Total")+":</span><b>"+(cashSales+cardSales+madaSales).toFixed(3)+" JD</b></div>"
+"<div class='r'><span>"+lbl("عدد الفواتير","Transactions")+":</span><b>"+shiftTxs.length+"</b></div>"
+"<div class='r'><span>"+lbl("القطع المباعة","Items Sold")+":</span><b>"+totalItems+"</b></div></div>"
+"<div class='s'><div class='t'>"+lbl("مطابقة النقد","Cash Reconciliation")+"</div>"
+"<div class='r'><span>"+lbl("الرصيد الافتتاحي","Opening")+":</span><b>"+(+activeShift.opening_balance).toFixed(3)+" JD</b></div>"
+"<div class='r'><span>+ "+lbl("مبيعات نقدية","Cash Sales")+":</span><b>"+cashSales.toFixed(3)+" JD</b></div>"
+"<div class='r tot'><span>"+lbl("المتوقع","Expected")+":</span><b>"+expected.toFixed(3)+" JD</b></div>"
+"<div class='r'><span>"+lbl("الفعلي (المعدود)","Actual (counted)")+":</span><b>"+actual.toFixed(3)+" JD</b></div>"
+"<div class='r tot' style='color:"+(Math.abs(diff)<0.01?"green":diff>0?"blue":"red")+"'><span>"+lbl("الفرق","Difference")+":</span><b>"+(diff>0?"+":"")+diff.toFixed(3)+" JD "+(Math.abs(diff)<0.01?"✓":diff>0?"↑":"↓")+"</b></div></div>"
+"<div class='box'><div class='l'>💼 "+lbl("المبلغ المطلوب توريده للإدارة","REMIT TO MANAGEMENT")+"</div><div class='v'>"+cashSales.toFixed(3)+" JD</div></div>"
+"<div class='f'>"+lbl("توقيع الموظف","Cashier Signature")+": _____________<br/>"+lbl("توقيع المدير","Manager Signature")+": _____________</div>"
+"</body></html>";
w.document.write(html);w.document.close();setTimeout(function(){w.print();setTimeout(function(){w.close()},800)},300)}
setActiveShift(null);setCloseShiftMod(false);sT("✓ "+(rtl?"تم إغلاق الوردية وطبع التقرير":"Shift closed & report printed"),"ok")}catch(e){console.error(e)}
}} disabled={!shiftCashCount}>🔒 {rtl?"تأكيد إغلاق الوردية وطباعة التقرير":"Confirm Close & Print Report"}</button>
</div></div>})()}

{/* EOD VIEW MODAL */}
{eodViewMod&&(()=>{
const reportDate=eodViewMod.report_date;
const dayInvs=invs.filter(i=>{try{return new Date(i.date).toISOString().slice(0,10)===reportDate}catch{return false}});
const dayPurchases=dayInvs.reduce((s,i)=>s+(+i.total||0),0);
const dayMovs=movements.filter(m=>{try{return new Date(m.created_at).toISOString().slice(0,10)===reportDate}catch{return false}});
const dayCashIn=dayMovs.filter(m=>m.type==="deposit").reduce((s,m)=>s+ +m.amount,0);
const dayCashOut=dayMovs.filter(m=>m.type==="withdrawal").reduce((s,m)=>s+ +m.amount,0);
const dayShifts=cashShifts.filter(s=>{try{return new Date(s.shift_start).toISOString().slice(0,10)===reportDate}catch{return false}});
const openingBal=dayShifts.length>0?+dayShifts[0].opening_balance:0;
const cashSales=+eodViewMod.total_cash_sales;
const expectedDrawer=openingBal+cashSales+dayCashIn-dayCashOut;
const remittance=expectedDrawer-openingBal;
return<div className="ov" onClick={()=>setEODViewMod(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
<h2>📄 {eodViewMod.report_date}<button className="mc" onClick={()=>setEODViewMod(null)}>✕</button></h2>
<div style={{fontFamily:"var(--m)",fontSize:12}}>
<div style={{textAlign:"center",borderBottom:"2px dashed #e5e7eb",paddingBottom:12,marginBottom:12}}>
<img src={STORE_LOGO} alt="3045" style={{height:80,marginBottom:10}}/>
<div style={{fontSize:18,fontWeight:800,fontFamily:"var(--f)"}}>{storeSettings.storeName||"3045 Supermarket"}</div><div style={{fontSize:10,color:"#6b7280"}}>{rtl?"إربد، شارع المدينة المنورة - مقابل SOS":"Irbid, Almadina Almonawarah St. (Opp. SOS)"} · 📞 0791191244</div>
<div style={{color:"#9ca3af",fontSize:11}}>{rtl?"تقرير نهاية اليوم":"End of Day Report"} — {eodViewMod.report_date}</div>
</div>

<div style={{fontWeight:700,marginBottom:6,fontFamily:"var(--f)",color:"#374151",fontSize:13}}>📊 {rtl?"ملخص المبيعات":"Sales Summary"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>💵 {t.cash}</span><span>{fm(+eodViewMod.total_cash_sales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>💳 {t.card}</span><span>{fm(+eodViewMod.total_card_sales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>📱 {t.mada}</span><span>{fm(+eodViewMod.total_mada_sales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontWeight:800,fontSize:14,borderTop:"1px solid #e5e7eb"}}><span>{t.totalSales}</span><span style={{color:"#059669"}}>{fm(+eodViewMod.total_sales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#9ca3af",fontSize:10}}><span>{t.txns}: {eodViewMod.total_transactions}</span><span>{t.items}: {eodViewMod.total_items_sold}</span></div>

<div style={{fontWeight:700,marginTop:14,marginBottom:6,fontFamily:"var(--f)",color:"#374151",fontSize:13}}>📈 {rtl?"الربحية":"Profitability"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{t.grossRevenue}</span><span>{fm(+eodViewMod.total_sales)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>{t.costOfGoods}</span><span>({fm(+eodViewMod.total_cost_of_goods)})</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontWeight:700}}><span>{t.grossProfit}</span><span style={{color:"#059669"}}>{fm(+eodViewMod.gross_profit)} ({eodViewMod.gross_margin}%)</span></div>
{+eodViewMod.total_sales_returns>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>↩️ {rtl?"المرتجعات":"Returns"}</span><span>({fm(+eodViewMod.total_sales_returns)})</span></div>}
{+eodViewMod.total_expenses>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>💸 {t.expenses}</span><span>({fm(+eodViewMod.total_expenses)})</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"2px solid #1f2937",fontWeight:800,fontSize:16,marginTop:4}}><span>💎 {t.netProfit}</span><span style={{color:+eodViewMod.net_profit>=0?"#059669":"#dc2626"}}>{fm(+eodViewMod.net_profit)}</span></div>

<div style={{fontWeight:700,marginTop:14,marginBottom:6,fontFamily:"var(--f)",color:"#374151",fontSize:13}}>🧾 {rtl?"الضريبة":"Tax"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{t.vat}</span><span>{fm(+eodViewMod.total_tax_collected)}</span></div>

<div style={{fontWeight:700,marginTop:14,marginBottom:6,fontFamily:"var(--f)",color:"#374151",fontSize:13}}>🧾 {rtl?"مشتريات اليوم":"Today's Purchases"}</div>
{dayInvs.length===0?<div style={{padding:"4px 0",color:"#9ca3af",fontSize:11}}>{rtl?"لا مشتريات":"No purchases"}</div>:<>
{dayInvs.map(i=><div key={i.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:11}}><span>📋 {i.invoice_number||i.id}{i.supplier_name?" · "+i.supplier_name:""}</span><span>{fN(+i.total)}</span></div>)}
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #e5e7eb",fontWeight:700}}><span>{rtl?"إجمالي المشتريات":"Total Purchases"}</span><span style={{color:"#dc2626"}}>{fN(dayPurchases)}</span></div>
</>}

<div style={{fontWeight:700,marginTop:14,marginBottom:6,fontFamily:"var(--f)",color:"#374151",fontSize:13}}>💰 {rtl?"حركة النقد":"Cash Movement"}</div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}><span>{rtl?"الرصيد الافتتاحي":"Opening Balance"}</span><span>{fN(openingBal)}</span></div>
<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#059669"}}><span>↑ {rtl?"مبيعات نقدية":"Cash Sales"}</span><span>+{fN(cashSales)}</span></div>
{dayCashIn>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#059669"}}><span>↑ {rtl?"إدخال نقد":"Cash In"}</span><span>+{fN(dayCashIn)}</span></div>}
{dayCashOut>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",color:"#dc2626"}}><span>↓ {rtl?"إخراج نقد":"Cash Out"}</span><span>-{fN(dayCashOut)}</span></div>}
<div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #e5e7eb",fontWeight:700}}><span>{rtl?"المتوقع في الصندوق":"Expected in Drawer"}</span><span>{fN(expectedDrawer)}</span></div>

<div style={{background:"linear-gradient(135deg,#7c2d12,#9a3412)",borderRadius:12,padding:14,marginTop:14,color:"#fff",textAlign:"center"}}>
<div style={{fontSize:11,opacity:.9,marginBottom:4}}>💼 {rtl?"المبلغ المطلوب توريده للإدارة":"Amount to Remit to Management"}</div>
<div style={{fontSize:24,fontWeight:900,fontFamily:"var(--m)"}}>{fN(remittance)}</div>
</div>

<div style={{textAlign:"center",marginTop:12,fontSize:9,color:"#9ca3af"}}>{eodViewMod.generated_by} · {eodViewMod.status}</div>
</div>
<button className="rb rb-p" style={{width:"100%",marginTop:14}} onClick={()=>window.print()}>🖨 {t.print}</button>
</div></div>})()}

{/* ADD BATCH MODAL */}
{batchMod&&<div className="ov" style={{zIndex:99999}} onClick={()=>setBatchMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>📋 {rtl?"إضافة دُفعة":"Add Batch"}<button className="mc" onClick={()=>setBatchMod(false)}>✕</button></h2>
<div className="pf"><label>{t.product}</label><select value={newBatch.product_id} onChange={e=>setNewBatch({...newBatch,product_id:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">--</option>{prods.map(p=><option key={p.id} value={p.id}>{pN(p)} ({p.bc})</option>)}</select></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"رقم الدُفعة":"Batch #"}</label><input value={newBatch.batch_number} onChange={e=>setNewBatch({...newBatch,batch_number:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{rtl?"المورد":"Supplier"}</label><input value={newBatch.supplier_name} onChange={e=>setNewBatch({...newBatch,supplier_name:e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{rtl?"تاريخ الاستلام":"Received Date"}</label><input type="date" value={newBatch.received_date} onChange={e=>setNewBatch({...newBatch,received_date:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.expiryDate}</label><input type="date" value={newBatch.expiry_date} onChange={e=>setNewBatch({...newBatch,expiry_date:e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.qty}</label><input type="number" value={newBatch.quantity_received} onChange={e=>setNewBatch({...newBatch,quantity_received:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.cost} / {t.unit}</label><input type="number" step="0.001" value={newBatch.cost_per_unit} onChange={e=>setNewBatch({...newBatch,cost_per_unit:e.target.value})}/></div>
</div>
{newBatch.quantity_received&&newBatch.cost_per_unit&&<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}><div style={{fontSize:11,color:"#6b7280"}}>{t.total}</div><div style={{fontSize:24,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm((parseFloat(newBatch.quantity_received)||0)*(parseFloat(newBatch.cost_per_unit)||0))}</div></div>}
<button className="cpb cpb-green" onClick={async()=>{if(!newBatch.product_id||!newBatch.quantity_received)return;const b={product_id:newBatch.product_id,batch_number:newBatch.batch_number,supplier_name:newBatch.supplier_name,received_date:newBatch.received_date,expiry_date:newBatch.expiry_date||null,quantity_received:parseInt(newBatch.quantity_received)||0,quantity_remaining:parseInt(newBatch.quantity_received)||0,cost_per_unit:parseFloat(newBatch.cost_per_unit)||0,notes:newBatch.notes,status:"active"};try{const r=await DB.addBatch(b);if(r)setBatches(p=>[...p,r]);
// Also update product stock
const prod=prods.find(p=>p.id===newBatch.product_id);if(prod){const ns=prod.s+(parseInt(newBatch.quantity_received)||0);setProds(p=>p.map(x=>x.id===prod.id?{...x,s:ns,c:parseFloat(newBatch.cost_per_unit)||x.c}:x));await DB.updateProductPriceStock(prod.id,prod.p,ns)}
setBatchMod(false);sT("✓ "+(rtl?"تمت الإضافة":"Batch added"),"ok")}catch(e){console.error(e)}}} disabled={!newBatch.product_id||!newBatch.quantity_received}>✓ {rtl?"إضافة دُفعة":"Add Batch"}</button>
</div></div>}

{/* SALES RETURN MODAL */}
{/* ━━━━ ADVANCED EDIT PRODUCT MODAL (Admin only - Name & Barcode) ━━━━ */}
{editProdMod && (
  <div onClick={()=>setEditProdMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1004,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:540}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:800,margin:0,color:"#92400e"}}>✏️ {rtl?"تعديل متقدم للمنتج":"Advanced Product Edit"}</h2>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>🔐 {rtl?"للمسؤول فقط — تعديل الاسم والباركود":"Admin only — edit name & barcode"}</div>
        </div>
        <button onClick={()=>setEditProdMod(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280"}}>✕</button>
      </div>
      
      {/* Warning */}
      <div style={{padding:12,background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:8,marginBottom:16,fontSize:11,color:"#92400e",lineHeight:1.6}}>
        ⚠️ <strong>{rtl?"تحذير":"Warning"}:</strong> {rtl?"تعديل الباركود سيؤثر على المسح عند البيع. تأكد من طباعة ملصق جديد بعد الحفظ.":"Changing the barcode affects POS scanning. Print a new label after saving."}
      </div>
      
      {/* Current values display */}
      <div style={{padding:10,background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,marginBottom:14,fontSize:11}}>
        <div style={{color:"#6b7280",marginBottom:4,fontWeight:600}}>{rtl?"القيم الحالية":"Current Values"}:</div>
        <div style={{fontFamily:"monospace"}}>
          <div>📷 {editProdMod.bc}</div>
          <div>🏷️ {editProdMod.n}</div>
          {editProdMod.a && <div>🏷️ {editProdMod.a}</div>}
        </div>
      </div>
      
      {/* Edit fields */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:18}}>
        
        {/* Barcode */}
        <div>
          <label style={{fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:4}}>📷 {rtl?"الباركود":"Barcode"}</label>
          <input value={editProdBc} onChange={e=>setEditProdBc(e.target.value)} placeholder="300451234567"
            style={{width:"100%",padding:"10px 14px",border:"2px solid "+(editProdBc!==editProdMod.bc?"#f59e0b":"#e5e7eb"),borderRadius:8,fontSize:14,fontFamily:"monospace",fontWeight:700,outline:"none",letterSpacing:1}}/>
          {editProdBc !== editProdMod.bc && <div style={{fontSize:10,color:"#d97706",marginTop:4,fontWeight:600}}>⚠️ {rtl?"سيتم تغيير الباركود":"Barcode will be changed"}</div>}
        </div>
        
        {/* English Name */}
        <div>
          <label style={{fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:4}}>🏷️ {rtl?"الاسم بالإنجليزية":"English Name"}</label>
          <input value={editProdN} onChange={e=>setEditProdN(e.target.value)} placeholder="Product Name"
            style={{width:"100%",padding:"10px 14px",border:"2px solid "+(editProdN!==editProdMod.n?"#f59e0b":"#e5e7eb"),borderRadius:8,fontSize:13,outline:"none"}}/>
        </div>
        
        {/* Arabic Name */}
        <div>
          <label style={{fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:4}}>🏷️ {rtl?"الاسم بالعربية":"Arabic Name"}</label>
          <input value={editProdA} onChange={e=>setEditProdA(e.target.value)} placeholder="اسم المنتج"
            style={{width:"100%",padding:"10px 14px",border:"2px solid "+(editProdA!==(editProdMod.a||"")?"#f59e0b":"#e5e7eb"),borderRadius:8,fontSize:13,outline:"none",direction:"rtl"}}/>
        </div>
      </div>
      
      {/* Action buttons */}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>setEditProdMod(null)}
          style={{padding:"10px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
          {rtl?"إلغاء":"Cancel"}
        </button>
        <button onClick={async()=>{
          // Validation
          const newBc = editProdBc.trim();
          const newN = editProdN.trim();
          const newA = editProdA.trim();
          
          if(!newBc){sT("✗ "+(rtl?"الباركود مطلوب":"Barcode required"),"err");return}
          if(!newN){sT("✗ "+(rtl?"الاسم بالإنجليزية مطلوب":"English name required"),"err");return}
          
          // Check barcode duplicate (if changed)
          if(newBc !== editProdMod.bc){
            const dup = prods.find(x => x.bc === newBc && x.id !== editProdMod.id);
            if(dup){
              sT("✗ "+(rtl?`الباركود مستخدم من: ${pN(dup)}`:`Barcode used by: ${pN(dup)}`),"err");
              return;
            }
            // Extra confirmation for barcode change
            if(!confirm(rtl?`تأكيد تغيير الباركود من:\n${editProdMod.bc}\nإلى:\n${newBc}\n\nتأكد من طباعة ملصق جديد بعد الحفظ!`:`Confirm changing barcode from:\n${editProdMod.bc}\nTo:\n${newBc}\n\nRemember to print a new label!`)) return;
          }
          
          try{
            // Update local state
            setProds(prev => prev.map(x => x.id === editProdMod.id ? {...x, bc:newBc, n:newN, a:newA} : x));
            
            // Update database
            await sb.from("products").update({
              barcode: newBc,
              name: newN,
              name_ar: newA || null,
              updated_at: new Date().toISOString()
            }).eq("id", editProdMod.id);
            
            // Audit log for each changed field
            if(newBc !== editProdMod.bc){
              await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"product_barcode_change",entity_type:"product",entity_id:editProdMod.id,field_name:"barcode",old_value:editProdMod.bc,new_value:newBc,notes:"Advanced edit by "+cu?.fn}).catch(()=>{});
            }
            if(newN !== editProdMod.n){
              await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"product_name_change",entity_type:"product",entity_id:editProdMod.id,field_name:"name",old_value:editProdMod.n,new_value:newN,notes:"Advanced edit by "+cu?.fn}).catch(()=>{});
            }
            if(newA !== (editProdMod.a||"")){
              await DB.addAuditLog({user_id:cu?.id,user_name:cu?.fn,action:"product_name_ar_change",entity_type:"product",entity_id:editProdMod.id,field_name:"name_ar",old_value:editProdMod.a||"",new_value:newA,notes:"Advanced edit by "+cu?.fn}).catch(()=>{});
            }
            
            sT("✓ "+(rtl?"تم حفظ التعديلات":"Changes saved"),"ok");
            setEditProdMod(null);
          }catch(e){
            console.error("Advanced edit error:",e);
            sT("✗ "+(e.message||"Error saving"),"err");
            // Revert local state on error
            setProds(prev => prev.map(x => x.id === editProdMod.id ? editProdMod : x));
          }
        }}
          style={{padding:"10px 24px",background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 8px rgba(5,150,105,.3)"}}>
          ✓ {rtl?"حفظ التغييرات":"Save Changes"}
        </button>
      </div>
    </div>
  </div>
)}

{/* ━━━━ STOCKTAKE FULL-SCREEN MODE ━━━━ */}
{stocktakeMode && activeStocktake && (
  <div style={{position:"fixed",inset:0,background:"linear-gradient(135deg,#f5f3ff,#eff6ff)",zIndex:2000,overflow:"auto"}}>
    {/* Header */}
    <div style={{background:"#fff",borderBottom:"2px solid #7c3aed",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
      <div>
        <h1 style={{fontSize:18,fontWeight:800,margin:0,color:"#7c3aed"}}>📋 {rtl?"جلسة جرد نشطة":"Active Stocktake"}</h1>
        <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>
          <strong style={{fontFamily:"monospace"}}>{activeStocktake.session_code}</strong> · 👤 {activeStocktake.started_by_name} · ⏱️ {(()=>{const d=Math.floor((new Date()-new Date(activeStocktake.started_at))/60000);return d<60?`${d}m`:`${Math.floor(d/60)}h ${d%60}m`})()} · 📦 {stocktakeItems.length} {rtl?"منتج":"items"}
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>setStocktakeMode(false)} style={{padding:"10px 16px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>⏸ {rtl?"إيقاف مؤقت":"Pause"}</button>
        <button onClick={endStocktake} style={{padding:"10px 18px",background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 8px rgba(220,38,38,.3)"}}>🔴 {rtl?"إنهاء الجلسة":"End Session"}</button>
      </div>
    </div>
    
    <div style={{maxWidth:800,margin:"0 auto",padding:20}}>
      
      {/* STEP: SCAN BARCODE */}
      {stocktakeStep === "scan" && !stocktakeUnregPrompt && (
        <div style={{background:"#fff",borderRadius:16,padding:30,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{fontSize:80,marginBottom:20}}>📷</div>
          <h2 style={{fontSize:22,fontWeight:800,marginBottom:8,color:"#111827"}}>{rtl?"امسح باركود المنتج":"Scan Product Barcode"}</h2>
          <p style={{color:"#6b7280",fontSize:13,marginBottom:20}}>{rtl?"استخدم ماسح الباركود اللاسلكي أو أدخل الباركود يدوياً":"Use wireless scanner or enter barcode manually"}</p>
          <input autoFocus value={stocktakeScanBc} onChange={e=>setStocktakeScanBc(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")onStocktakeScan()}}
            placeholder={rtl?"الباركود":"Barcode"}
            style={{width:"100%",maxWidth:400,padding:18,fontSize:20,border:"3px solid #7c3aed",borderRadius:12,outline:"none",fontFamily:"monospace",fontWeight:700,textAlign:"center",letterSpacing:2}}/>
          <div style={{marginTop:16}}>
            <button onClick={()=>onStocktakeScan()} disabled={!stocktakeScanBc} style={{padding:"14px 40px",background:stocktakeScanBc?"linear-gradient(135deg,#7c3aed,#9333ea)":"#e5e7eb",color:stocktakeScanBc?"#fff":"#9ca3af",border:"none",borderRadius:10,fontSize:15,fontWeight:800,cursor:stocktakeScanBc?"pointer":"not-allowed"}}>
              ➡ {rtl?"متابعة":"Continue"}
            </button>
          </div>
          
          {/* Recent counted items */}
          {stocktakeItems.length > 0 && (
            <div style={{marginTop:30,textAlign:"left",background:"#f9fafb",borderRadius:10,padding:14}}>
              <div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:10}}>📊 {rtl?`آخر ${Math.min(stocktakeItems.length,5)} منتجات مجرودة`:`Last ${Math.min(stocktakeItems.length,5)} counted items`}</div>
              {stocktakeItems.slice(-5).reverse().map((item,i) => {
                const statusColor = item.status==="match"?"#059669":item.status==="variance"?"#d97706":item.status==="unregistered"?"#dc2626":"#6b7280";
                const statusBg = item.status==="match"?"#ecfdf5":item.status==="variance"?"#fffbeb":item.status==="unregistered"?"#fef2f2":"#f9fafb";
                return (
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:8,background:statusBg,borderRadius:6,marginBottom:4}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:700}}>{item.product_name}</div>
                      <div style={{fontSize:10,fontFamily:"monospace",color:"#6b7280"}}>{item.barcode}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,fontFamily:"monospace",fontWeight:700,color:statusColor}}>
                        {item.system_stock} → {item.actual_stock}
                        {item.difference !== 0 && <span style={{marginLeft:4}}>({item.difference > 0?"+":""}{item.difference})</span>}
                      </div>
                      <div style={{fontSize:9,color:statusColor,fontWeight:700}}>
                        {item.status==="match"?"✓ "+(rtl?"مطابق":"MATCH"):item.status==="variance"?"⚠ "+(rtl?"فرق":"VARIANCE"):item.status==="unregistered"?"🔴 "+(rtl?"غير مسجل":"UNREGISTERED"):item.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      
      {/* STEP: UNREGISTERED PRODUCT */}
      {stocktakeUnregPrompt && stocktakeStep === "unregistered" && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:60,marginBottom:8}}>⚠️</div>
            <h2 style={{fontSize:20,fontWeight:800,color:"#dc2626"}}>{rtl?"المنتج غير مسجل في النظام":"Product Not in System"}</h2>
            <div style={{padding:10,background:"#fef2f2",borderRadius:8,display:"inline-block",marginTop:10}}>
              <div style={{fontSize:10,color:"#7f1d1d"}}>{rtl?"الباركود":"Barcode"}:</div>
              <div style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:"#dc2626"}}>{stocktakeScanBc}</div>
            </div>
          </div>
          
          <div style={{marginBottom:16}}>
            <label style={{fontSize:13,fontWeight:700,display:"block",marginBottom:6}}>{rtl?"الكمية الفعلية":"Actual Quantity"}</label>
            <input type="number" autoFocus value={stocktakeActualQty} onChange={e=>setStocktakeActualQty(e.target.value)}
              placeholder="0" min="0"
              style={{width:"100%",padding:14,fontSize:18,border:"2px solid #dc2626",borderRadius:10,fontFamily:"monospace",textAlign:"center",fontWeight:700}}/>
          </div>
          
          <div style={{marginBottom:20}}>
            <label style={{fontSize:13,fontWeight:700,display:"block",marginBottom:6}}>📅 {rtl?"تواريخ الصلاحية (اختياري)":"Expiry Dates (optional)"}</label>
            {stocktakeNewExpiries.map((d,i)=>(
              <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                <input type="date" value={d} onChange={e=>{const v=[...stocktakeNewExpiries];v[i]=e.target.value;setStocktakeNewExpiries(v)}}
                  style={{flex:1,padding:10,fontSize:13,border:"1.5px solid #e5e7eb",borderRadius:8}}/>
                {stocktakeNewExpiries.length > 1 && (
                  <button onClick={()=>setStocktakeNewExpiries(stocktakeNewExpiries.filter((_,x)=>x!==i))} style={{padding:"0 12px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,cursor:"pointer"}}>✕</button>
                )}
              </div>
            ))}
            <button onClick={()=>setStocktakeNewExpiries([...stocktakeNewExpiries,""])} style={{padding:"6px 14px",background:"#eff6ff",color:"#2563eb",border:"1px dashed #bfdbfe",borderRadius:6,fontSize:11,cursor:"pointer",marginTop:4}}>+ {rtl?"إضافة تاريخ":"Add Date"}</button>
          </div>
          
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={resetStocktakeScreen} style={{padding:"12px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
            <button onClick={stocktakeSaveUnregistered} style={{padding:"12px 28px",background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",border:"none",borderRadius:8,fontWeight:800,cursor:"pointer"}}>💾 {rtl?"حفظ":"Save"}</button>
          </div>
        </div>
      )}
      
      {/* STEP: PRODUCT EXISTS CHECK */}
      {stocktakeStep === "exists" && stocktakeCurrentProd && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:60,marginBottom:8}}>📦</div>
            <h2 style={{fontSize:22,fontWeight:800,marginBottom:4}}>{pN(stocktakeCurrentProd)}</h2>
            <div style={{fontFamily:"monospace",fontSize:13,color:"#6b7280"}}>{stocktakeCurrentProd.bc}</div>
            {stocktakeCurrentProd.cat && <span style={{padding:"3px 10px",background:"#f3f4f6",borderRadius:6,fontSize:10,marginTop:6,display:"inline-block"}}>🏷️ {stocktakeCurrentProd.cat}</span>}
          </div>
          
          <div style={{padding:14,background:"#f9fafb",borderRadius:10,marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"الكمية المسجلة في النظام":"System Stock"}</div>
            <div style={{fontSize:36,fontWeight:800,fontFamily:"monospace",color:"#2563eb"}}>{stocktakeCurrentProd.s}</div>
          </div>
          
          <div style={{fontSize:16,fontWeight:700,textAlign:"center",marginBottom:16,color:"#374151"}}>
            {rtl?"هل المنتج موجود فعلياً في المحل؟":"Is the product physically present?"}
          </div>
          
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <button onClick={stocktakeConfirmExists} style={{padding:20,background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 12px rgba(5,150,105,.3)"}}>
              ✓ {rtl?"نعم، موجود":"Yes, Present"}
            </button>
            <button onClick={stocktakeMarkNotPresent} style={{padding:20,background:"linear-gradient(135deg,#dc2626,#ef4444)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 12px rgba(220,38,38,.3)"}}>
              ✕ {rtl?"لا، غير موجود":"No, Not Present"}
            </button>
          </div>
          
          <button onClick={resetStocktakeScreen} style={{marginTop:12,padding:8,width:"100%",background:"#f3f4f6",color:"#6b7280",border:"none",borderRadius:8,fontSize:11,cursor:"pointer"}}>← {rtl?"العودة":"Back"}</button>
        </div>
      )}
      
      {/* STEP: QUANTITY CORRECT CHECK */}
      {stocktakeStep === "qty_correct" && stocktakeCurrentProd && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:60,marginBottom:8}}>📊</div>
            <h2 style={{fontSize:18,fontWeight:800,marginBottom:4}}>{pN(stocktakeCurrentProd)}</h2>
          </div>
          
          <div style={{padding:20,background:"linear-gradient(135deg,#eff6ff,#f9fafb)",borderRadius:12,marginBottom:20,textAlign:"center",border:"2px solid #bfdbfe"}}>
            <div style={{fontSize:12,color:"#1e40af",fontWeight:600}}>{rtl?"الكمية المسجلة":"Recorded Qty"}</div>
            <div style={{fontSize:48,fontWeight:800,fontFamily:"monospace",color:"#2563eb"}}>{stocktakeCurrentProd.s}</div>
          </div>
          
          <div style={{fontSize:16,fontWeight:700,textAlign:"center",marginBottom:16}}>
            {rtl?"هل هذه الكمية صحيحة بعد العد؟":"Is this count correct?"}
          </div>
          
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <button onClick={stocktakeQtyCorrect} style={{padding:20,background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer"}}>
              ✓ {rtl?"صحيح":"Correct"}
            </button>
            <button onClick={stocktakeQtyWrong} style={{padding:20,background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer"}}>
              ✕ {rtl?"خطأ":"Wrong"}
            </button>
          </div>
        </div>
      )}
      
      {/* STEP: ENTER ACTUAL QTY */}
      {stocktakeStep === "qty_input" && stocktakeCurrentProd && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:16}}>
            <h2 style={{fontSize:18,fontWeight:800,marginBottom:4}}>{pN(stocktakeCurrentProd)}</h2>
            <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"النظام":"System"}: <strong style={{color:"#2563eb",fontFamily:"monospace"}}>{stocktakeCurrentProd.s}</strong></div>
          </div>
          
          <div style={{marginBottom:14}}>
            <label style={{fontSize:13,fontWeight:700,display:"block",marginBottom:6}}>{rtl?"الكمية الفعلية بعد العد":"Actual Counted Quantity"}</label>
            <input type="number" autoFocus value={stocktakeActualQty} onChange={e=>setStocktakeActualQty(e.target.value)}
              min="0" placeholder="0"
              style={{width:"100%",padding:18,fontSize:24,border:"3px solid #d97706",borderRadius:12,fontFamily:"monospace",textAlign:"center",fontWeight:800}}/>
            {stocktakeActualQty !== "" && !isNaN(parseInt(stocktakeActualQty)) && (
              <div style={{textAlign:"center",marginTop:8,fontSize:12,fontWeight:700,color:(parseInt(stocktakeActualQty)-stocktakeCurrentProd.s)===0?"#059669":(parseInt(stocktakeActualQty)-stocktakeCurrentProd.s)>0?"#d97706":"#dc2626"}}>
                {rtl?"الفرق":"Difference"}: {(parseInt(stocktakeActualQty)-stocktakeCurrentProd.s)>0?"+":""}{parseInt(stocktakeActualQty)-stocktakeCurrentProd.s}
              </div>
            )}
          </div>
          
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,fontWeight:600,display:"block",marginBottom:6,color:"#6b7280"}}>{rtl?"سبب الفرق (اختياري)":"Variance Reason (optional)"}</label>
            <select value={stocktakeVarianceReason} onChange={e=>setStocktakeVarianceReason(e.target.value)}
              style={{width:"100%",padding:12,fontSize:13,border:"1.5px solid #e5e7eb",borderRadius:8}}>
              <option value="">— {rtl?"بدون سبب":"No reason"} —</option>
              <option value="damaged">{rtl?"تالف":"Damaged"}</option>
              <option value="expired">{rtl?"منتهي الصلاحية":"Expired"}</option>
              <option value="loss">{rtl?"فقدان/سرقة":"Loss/Theft"}</option>
              <option value="unrecorded_sale">{rtl?"بيع غير مسجل":"Unrecorded sale"}</option>
              <option value="miscounted_before">{rtl?"عد خطأ سابق":"Previous miscount"}</option>
              <option value="other">{rtl?"أخرى":"Other"}</option>
            </select>
          </div>
          
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={()=>setStocktakeStep("qty_correct")} style={{padding:"12px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer"}}>← {rtl?"رجوع":"Back"}</button>
            <button onClick={stocktakeSubmitQty} disabled={stocktakeActualQty===""} style={{padding:"12px 28px",background:stocktakeActualQty===""?"#e5e7eb":"linear-gradient(135deg,#7c3aed,#9333ea)",color:stocktakeActualQty===""?"#9ca3af":"#fff",border:"none",borderRadius:8,fontWeight:800,cursor:stocktakeActualQty===""?"not-allowed":"pointer"}}>➡ {rtl?"متابعة":"Continue"}</button>
          </div>
        </div>
      )}
      
      {/* STEP: EXPIRY CORRECT CHECK */}
      {stocktakeStep === "expiry_correct" && stocktakeCurrentProd && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:60,marginBottom:8}}>📅</div>
            <h2 style={{fontSize:18,fontWeight:800,marginBottom:4}}>{pN(stocktakeCurrentProd)}</h2>
          </div>
          
          <div style={{padding:16,background:stocktakeCurrentProd.exp?"#fffbeb":"#f9fafb",borderRadius:12,marginBottom:16,textAlign:"center",border:"2px solid "+(stocktakeCurrentProd.exp?"#fcd34d":"#e5e7eb")}}>
            <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"تاريخ الصلاحية المسجل":"Recorded Expiry Date"}</div>
            <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace",color:stocktakeCurrentProd.exp?"#d97706":"#9ca3af",marginTop:4}}>
              {stocktakeCurrentProd.exp || (rtl?"— لا يوجد —":"— None —")}
            </div>
          </div>
          
          <div style={{fontSize:15,fontWeight:700,textAlign:"center",marginBottom:16}}>
            {rtl?"هل تاريخ الصلاحية صحيح؟":"Is the expiry date correct?"}
          </div>
          
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <button onClick={stocktakeExpiryCorrect} style={{padding:20,background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer"}}>
              ✓ {rtl?"صحيح":"Correct"}
            </button>
            <button onClick={stocktakeExpiryWrong} style={{padding:20,background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:800,cursor:"pointer"}}>
              ✕ {rtl?"خطأ":"Wrong"}
            </button>
          </div>
        </div>
      )}
      
      {/* STEP: ENTER NEW EXPIRIES (multiple) */}
      {stocktakeStep === "expiry_input" && stocktakeCurrentProd && (
        <div style={{background:"#fff",borderRadius:16,padding:30,boxShadow:"0 4px 20px rgba(0,0,0,.08)"}}>
          <div style={{textAlign:"center",marginBottom:16}}>
            <h2 style={{fontSize:18,fontWeight:800,marginBottom:4}}>{pN(stocktakeCurrentProd)}</h2>
            <div style={{fontSize:11,color:"#6b7280"}}>{rtl?"أدخل تواريخ الصلاحية الصحيحة (يمكن إضافة أكثر من تاريخ إذا كانت هناك دفعات مختلفة)":"Enter correct expiry dates (add multiple if different batches exist)"}</div>
          </div>
          
          <div style={{marginBottom:16}}>
            <label style={{fontSize:13,fontWeight:700,display:"block",marginBottom:8}}>📅 {rtl?"التواريخ":"Expiry Dates"}</label>
            {stocktakeNewExpiries.map((d,i)=>(
              <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
                <input type="date" autoFocus={i===0} value={d} onChange={e=>{const v=[...stocktakeNewExpiries];v[i]=e.target.value;setStocktakeNewExpiries(v)}}
                  style={{flex:1,padding:12,fontSize:14,border:"2px solid #e5e7eb",borderRadius:8,fontFamily:"monospace"}}/>
                {stocktakeNewExpiries.length > 1 && (
                  <button onClick={()=>setStocktakeNewExpiries(stocktakeNewExpiries.filter((_,x)=>x!==i))} style={{padding:"0 14px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,cursor:"pointer"}}>✕</button>
                )}
              </div>
            ))}
            <button onClick={()=>setStocktakeNewExpiries([...stocktakeNewExpiries,""])} style={{padding:"8px 16px",background:"#eff6ff",color:"#2563eb",border:"1px dashed #bfdbfe",borderRadius:6,fontSize:11,cursor:"pointer",marginTop:4,fontWeight:600}}>
              + {rtl?"إضافة تاريخ آخر (دفعة أخرى)":"Add Another Date (different batch)"}
            </button>
          </div>
          
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={()=>setStocktakeStep("expiry_correct")} style={{padding:"12px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer"}}>← {rtl?"رجوع":"Back"}</button>
            <button onClick={stocktakeSubmitExpiries} style={{padding:"12px 28px",background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:8,fontWeight:800,cursor:"pointer"}}>💾 {rtl?"حفظ":"Save"}</button>
          </div>
        </div>
      )}
    </div>
  </div>
)}

{/* ━━━━ STOCKTAKE SESSION DETAIL MODAL (Admin) ━━━━ */}
{stocktakeSessionDetail && (
  <div onClick={()=>setStocktakeSessionDetail(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1005,padding:10}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:1300,maxHeight:"95vh",display:"flex",flexDirection:"column"}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:800,margin:0,color:"#7c3aed"}}>📋 {rtl?"تفاصيل جلسة الجرد":"Stocktake Session Detail"}</h2>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>
            <strong style={{fontFamily:"monospace",color:"#7c3aed"}}>{stocktakeSessionDetail.session_code}</strong> · 👤 {stocktakeSessionDetail.started_by_name} · 📅 {new Date(stocktakeSessionDetail.started_at).toLocaleString()}
          </div>
        </div>
        <button onClick={()=>setStocktakeSessionDetail(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280"}}>✕</button>
      </div>
      
      {(()=>{
        const items = stocktakeSessionDetail.items || [];
        const matched = items.filter(i=>i.status==="match").length;
        const variances = items.filter(i=>i.status==="variance").length;
        const unregistered = items.filter(i=>i.status==="unregistered").length;
        const approved = items.filter(i=>i.admin_decision==="accept").length;
        const rejected = items.filter(i=>i.admin_decision==="reject").length;
        const pending = items.length - approved - rejected;
        const accuracy = items.length > 0 ? ((matched/items.length)*100).toFixed(1) : 0;
        const totalInvProds = prods.length;
        const coveragePct = totalInvProds > 0 ? ((items.length/totalInvProds)*100).toFixed(1) : 0;
        
        return <>
          {/* KPIs */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
            <div style={{padding:10,background:"#eff6ff",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#1e40af",fontWeight:700}}>{rtl?"مجرودة":"Counted"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#2563eb",fontFamily:"monospace"}}>{items.length}</div>
              <div style={{fontSize:9,color:"#6b7280"}}>{coveragePct}% {rtl?"من المخزون":"of inventory"}</div>
            </div>
            <div style={{padding:10,background:"#ecfdf5",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#065f46",fontWeight:700}}>✓ {rtl?"مطابق":"Match"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{matched}</div>
            </div>
            <div style={{padding:10,background:"#fffbeb",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#92400e",fontWeight:700}}>⚠ {rtl?"فروقات":"Variance"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#d97706",fontFamily:"monospace"}}>{variances}</div>
            </div>
            <div style={{padding:10,background:"#fef2f2",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#991b1b",fontWeight:700}}>🔴 {rtl?"غير مسجل":"Unreg"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#dc2626",fontFamily:"monospace"}}>{unregistered}</div>
            </div>
            <div style={{padding:10,background:"#f5f3ff",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#5b21b6",fontWeight:700}}>{rtl?"الدقة":"Accuracy"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#7c3aed",fontFamily:"monospace"}}>{accuracy}%</div>
            </div>
            <div style={{padding:10,background:"#f0fdf4",borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:10,color:"#065f46",fontWeight:700}}>{rtl?"متبقي":"Remaining"}</div>
              <div style={{fontSize:20,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{totalInvProds-items.length}</div>
            </div>
          </div>
          
          {/* Action bar */}
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
            <div style={{fontSize:11,color:"#6b7280"}}>
              {rtl?"قرارات":"Decisions"}: <strong style={{color:"#059669"}}>✓ {approved}</strong> · <strong style={{color:"#dc2626"}}>✕ {rejected}</strong> · <strong style={{color:"#d97706"}}>⏳ {pending}</strong>
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:6}}>
              {/* Export button */}
              <button onClick={()=>{
                const headers=[rtl?"الباركود":"Barcode",rtl?"المنتج":"Product",rtl?"النظام":"System",rtl?"الفعلي":"Actual",rtl?"الفرق":"Diff",rtl?"تواريخ جديدة":"New Expiries",rtl?"السبب":"Reason",rtl?"الحالة":"Status",rtl?"قرار الإدارة":"Admin Action"];
                let csv = "\uFEFF" + headers.join(",") + "\n";
                items.forEach(i => {
                  const newExps = i.new_expiries ? (()=>{try{return JSON.parse(i.new_expiries).join("|")}catch{return ""}})() : "";
                  csv += [i.barcode, '"'+(i.product_name||"").replace(/"/g,'""')+'"', i.system_stock, i.actual_stock, i.difference, newExps, i.variance_reason||"", i.status, i.admin_decision||"pending"].join(",") + "\n";
                });
                const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"});
                const a = document.createElement("a");a.href = URL.createObjectURL(blob);a.download = `${stocktakeSessionDetail.session_code}.csv`;a.click();
              }} style={{padding:"6px 12px",background:"#10b981",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer"}}>📊 Excel</button>
              {cu.role==="admin" && stocktakeSessionDetail.status!=="approved" && (
                <button onClick={()=>approveStocktakeSession(stocktakeSessionDetail)} style={{padding:"6px 14px",background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:800,cursor:"pointer"}}>
                  ✓ {rtl?"اعتماد الجلسة كاملة":"Approve Entire Session"}
                </button>
              )}
            </div>
          </div>
          
          {/* Items table */}
          <div style={{flex:1,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:10}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{background:"#f9fafb",position:"sticky",top:0,zIndex:1}}>
                <tr>
                  <th style={{padding:8,textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"الباركود":"Barcode"}</th>
                  <th style={{padding:8,textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"المنتج":"Product"}</th>
                  <th style={{padding:8,textAlign:"center",fontSize:10,color:"#2563eb",fontWeight:700}}>{rtl?"النظام":"System"}</th>
                  <th style={{padding:8,textAlign:"center",fontSize:10,color:"#059669",fontWeight:700}}>{rtl?"الفعلي":"Actual"}</th>
                  <th style={{padding:8,textAlign:"center",fontSize:10,color:"#dc2626",fontWeight:700}}>{rtl?"الفرق":"Diff"}</th>
                  <th style={{padding:8,textAlign:"left",fontSize:10,color:"#d97706",fontWeight:700}}>{rtl?"تواريخ جديدة":"New Expiries"}</th>
                  <th style={{padding:8,textAlign:"left",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"السبب":"Reason"}</th>
                  <th style={{padding:8,textAlign:"center",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"الحالة":"Status"}</th>
                  <th style={{padding:8,textAlign:"right",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"الإجراء":"Action"}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const statusColor = item.status==="match"?"#059669":item.status==="variance"?"#d97706":item.status==="unregistered"?"#dc2626":"#6b7280";
                  const statusBg = item.status==="match"?"#ecfdf5":item.status==="variance"?"#fffbeb":item.status==="unregistered"?"#fef2f2":"#f9fafb";
                  const newExpsArr = item.new_expiries ? (()=>{try{return JSON.parse(item.new_expiries)}catch{return []}})() : [];
                  return (
                    <tr key={item.id} style={{borderTop:"1px solid #f3f4f6",background:item.admin_decision==="accept"?"#f0fdf4":item.admin_decision==="reject"?"#fef2f2":"transparent"}}>
                      <td style={{padding:8,fontFamily:"monospace",color:"#6b7280"}}>{item.barcode}</td>
                      <td style={{padding:8,fontWeight:600}}>{item.product_name}</td>
                      <td style={{padding:8,textAlign:"center",fontFamily:"monospace",color:"#2563eb",fontWeight:700}}>{item.system_stock}</td>
                      <td style={{padding:8,textAlign:"center",fontFamily:"monospace",color:"#059669",fontWeight:700}}>{item.actual_stock}</td>
                      <td style={{padding:8,textAlign:"center",fontFamily:"monospace",fontWeight:800,color:item.difference===0?"#059669":item.difference>0?"#d97706":"#dc2626"}}>
                        {item.difference>0?"+":""}{item.difference}
                      </td>
                      <td style={{padding:8,fontSize:10}}>
                        {newExpsArr.length > 0 ? newExpsArr.map((d,i)=><div key={i} style={{fontFamily:"monospace",color:"#d97706"}}>{d}</div>) : <span style={{color:"#d1d5db"}}>—</span>}
                      </td>
                      <td style={{padding:8,fontSize:10,color:"#6b7280"}}>{item.variance_reason||"—"}</td>
                      <td style={{padding:8,textAlign:"center"}}>
                        <span style={{padding:"3px 8px",background:statusBg,color:statusColor,borderRadius:4,fontSize:9,fontWeight:700}}>
                          {item.status==="match"?"✓ "+(rtl?"مطابق":"MATCH"):item.status==="variance"?"⚠ "+(rtl?"فرق":"VARIANCE"):item.status==="unregistered"?"🔴 "+(rtl?"غير مسجل":"UNREG"):item.status}
                        </span>
                      </td>
                      <td style={{padding:8,textAlign:"right"}}>
                        {item.admin_decision ? (
                          <span style={{padding:"3px 8px",background:item.admin_decision==="accept"?"#ecfdf5":"#fef2f2",color:item.admin_decision==="accept"?"#059669":"#dc2626",borderRadius:4,fontSize:9,fontWeight:700}}>
                            {item.admin_decision==="accept"?"✓ "+(rtl?"قُبل":"Accepted"):"✕ "+(rtl?"رُفض":"Rejected")}
                          </span>
                        ) : cu.role==="admin" ? (
                          <div style={{display:"flex",gap:3,justifyContent:"flex-end"}}>
                            <button onClick={()=>approveStocktakeItem(item,"accept")} style={{padding:"3px 8px",background:"#059669",color:"#fff",border:"none",borderRadius:3,fontSize:9,fontWeight:700,cursor:"pointer"}} title={rtl?"قبول وتطبيق":"Accept & apply"}>✓</button>
                            <button onClick={()=>approveStocktakeItem(item,"reject")} style={{padding:"3px 8px",background:"#dc2626",color:"#fff",border:"none",borderRadius:3,fontSize:9,fontWeight:700,cursor:"pointer"}} title={rtl?"رفض":"Reject"}>✕</button>
                          </div>
                        ) : (
                          <span style={{fontSize:9,color:"#9ca3af"}}>⏳ {rtl?"معلق":"Pending"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>;
      })()}
    </div>
  </div>
)}

{/* ━━━━ OCR INVOICE SCAN MODAL (Multi-Page) ━━━━ */}
{ocrMod && (
  <div onClick={()=>!ocrProcessing && setOcrMod(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1003,padding:10}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:1100,maxHeight:"95vh",display:"flex",flexDirection:"column",overflow:"auto"}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,margin:0,color:"#7c3aed"}}>📷 {rtl?"مسح فاتورة متعدد الصفحات":"Multi-Page Invoice Scanner"}</h2>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>
            {rtl?"أضف صورة واحدة أو أكثر للفاتورة (حتى 10 صفحات) — يدعم العربية والإنجليزية":"Add 1-10 images of the invoice — Arabic & English supported"}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{padding:"6px 12px",background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:8,fontSize:11,fontWeight:700,color:"#5b21b6"}}>
            📄 {ocrPages.length}/10 {rtl?"صفحة":"pages"}
          </div>
          <button onClick={()=>!ocrProcessing && setOcrMod(false)} disabled={ocrProcessing} style={{background:"none",border:"none",fontSize:20,cursor:ocrProcessing?"not-allowed":"pointer",color:"#6b7280",opacity:ocrProcessing?0.3:1}}>✕</button>
        </div>
      </div>
      
      {/* Upload Buttons (always visible if < 10 pages) */}
      {ocrPages.length < 10 && !ocrProcessing && (
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          <label style={{flex:"1 1 180px",padding:"12px",background:"linear-gradient(135deg,#7c3aed,#9333ea)",color:"#fff",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,textAlign:"center",boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>
            📁 {rtl?"رفع صور متعددة":"Upload Multiple Images"}
            <input type="file" accept="image/*" multiple onChange={e=>handleOCRImages(e.target.files)} style={{display:"none"}}/>
          </label>
          <label style={{flex:"1 1 180px",padding:"12px",background:"linear-gradient(135deg,#2563eb,#3b82f6)",color:"#fff",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,textAlign:"center",boxShadow:"0 2px 8px rgba(37,99,235,.3)"}}>
            📷 {rtl?"التقاط صورة":"Take Photo"}
            <input type="file" accept="image/*" capture="environment" onChange={e=>handleOCRImages(e.target.files)} style={{display:"none"}}/>
          </label>
        </div>
      )}
      
      {/* Empty state */}
      {ocrPages.length === 0 && (
        <div style={{border:"3px dashed #c4b5fd",borderRadius:12,padding:40,textAlign:"center",background:"#faf5ff",marginBottom:14}}>
          <div style={{fontSize:56,marginBottom:10}}>📸</div>
          <div style={{fontSize:14,fontWeight:700,color:"#5b21b6",marginBottom:6}}>{rtl?"لم تتم إضافة صور بعد":"No images added yet"}</div>
          <div style={{fontSize:11,color:"#6b7280",lineHeight:1.6}}>
            {rtl?"يمكنك إضافة:":"You can add:"}<br/>
            • {rtl?"صورة واحدة لفاتورة قصيرة":"1 image for a short invoice"}<br/>
            • {rtl?"عدة صور لفاتورة طويلة أو متعددة الصفحات":"Multiple images for long/multi-page invoices"}
          </div>
        </div>
      )}
      
      {/* Pages grid */}
      {ocrPages.length > 0 && (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>📑 {rtl?"الصفحات المضافة":"Added Pages"}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
            {ocrPages.map((page,idx) => (
              <div key={page.id} style={{border:"2px solid "+(page.processed?"#10b981":"#e5e7eb"),borderRadius:10,padding:8,background:"#fff",position:"relative"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#374151"}}>
                    📄 {rtl?"صفحة":"Page"} {idx+1}
                    {page.processed && <span style={{marginLeft:6,padding:"1px 6px",background:"#10b981",color:"#fff",borderRadius:4,fontSize:9,fontWeight:700}}>✓</span>}
                  </div>
                  {!ocrProcessing && (
                    <button onClick={()=>removeOCRPage(page.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:4,padding:"2px 6px",fontSize:10,cursor:"pointer",fontWeight:700}}>✕</button>
                  )}
                </div>
                <img src={page.preview} alt={"page "+(idx+1)} style={{width:"100%",height:140,objectFit:"contain",borderRadius:6,background:"#f9fafb",cursor:"pointer"}} onClick={()=>{const w=window.open();w.document.write(`<img src="${page.preview}" style="max-width:100%"/>`);w.document.close()}}/>
                {page.processed && page.rows.length > 0 && (
                  <div style={{marginTop:6,padding:4,background:"#ecfdf5",borderRadius:4,fontSize:10,color:"#065f46",fontWeight:600,textAlign:"center"}}>
                    📊 {page.rows.length} {rtl?"صف":"rows"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Analyze button */}
      {ocrPages.length > 0 && ocrPages.some(p => !p.processed) && !ocrProcessing && (
        <button onClick={processOCRAll} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#7c3aed,#9333ea)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:800,cursor:"pointer",marginBottom:14,boxShadow:"0 4px 12px rgba(124,58,237,.3)"}}>
          🔍 {rtl?`تحليل ${ocrPages.filter(p=>!p.processed).length} صفحة غير محللة`:`Analyze ${ocrPages.filter(p=>!p.processed).length} Unprocessed Page(s)`}
        </button>
      )}
      
      {/* Progress bar */}
      {ocrProcessing && (
        <div style={{padding:14,background:"#faf5ff",border:"2px solid #c4b5fd",borderRadius:10,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:700,color:"#5b21b6"}}>
              ⏳ {rtl?`تحليل الصفحة ${ocrCurrentPage} من ${ocrPages.filter(p=>!p.processed).length+ocrCurrentPage-1}`:`Analyzing page ${ocrCurrentPage}/${ocrPages.filter(p=>!p.processed).length+ocrCurrentPage-1}`}
            </span>
            <span style={{fontSize:13,fontWeight:800,color:"#7c3aed",fontFamily:"monospace"}}>{ocrProgress}%</span>
          </div>
          <div style={{width:"100%",height:8,background:"#e5e7eb",borderRadius:4,overflow:"hidden"}}>
            <div style={{width:ocrProgress+"%",height:"100%",background:"linear-gradient(90deg,#7c3aed,#a78bfa)",transition:"width .3s"}}></div>
          </div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:6,textAlign:"center",fontStyle:"italic"}}>
            {rtl?"قد يستغرق 5-15 ثانية لكل صفحة":"May take 5-15 seconds per page"}
          </div>
        </div>
      )}
      
      {/* Extracted rows (merged from all pages) */}
      {ocrExtractedRows.length > 0 && !ocrProcessing && (
        <div style={{border:"2px solid #10b981",borderRadius:10,padding:10,marginBottom:14,background:"#ecfdf5"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:800,color:"#065f46"}}>
              ✅ {rtl?`${ocrExtractedRows.length} صف من ${ocrPages.filter(p=>p.processed).length} صفحة`:`${ocrExtractedRows.length} rows from ${ocrPages.filter(p=>p.processed).length} pages`}
            </div>
            <div style={{fontSize:10,color:"#065f46",fontStyle:"italic"}}>
              {rtl?"الصور ستُحفظ مع الفاتورة":"Images will be saved with the invoice"}
            </div>
          </div>
          <div style={{maxHeight:240,overflow:"auto",background:"#fff",borderRadius:8,border:"1px solid #d1fae5"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{background:"#f0fdf4",position:"sticky",top:0}}>
                <tr>
                  <th style={{padding:6,textAlign:"left",fontSize:10,color:"#065f46"}}>{rtl?"المنتج":"Product"}</th>
                  <th style={{padding:6,textAlign:"center",fontSize:10,color:"#065f46",width:80}}>{rtl?"الكمية":"Qty"}</th>
                  <th style={{padding:6,textAlign:"center",fontSize:10,color:"#065f46",width:100}}>{rtl?"سعر الشراء":"Cost"}</th>
                  <th style={{padding:6,textAlign:"center",fontSize:10,color:"#065f46",width:40}}></th>
                </tr>
              </thead>
              <tbody>
                {ocrExtractedRows.map((r,i) => (
                  <tr key={i} style={{borderTop:"1px solid #d1fae5"}}>
                    <td style={{padding:4}}>
                      <input value={r.name} onChange={e=>{const v=[...ocrExtractedRows];v[i]={...v[i],name:e.target.value};setOcrExtractedRows(v)}}
                        style={{width:"100%",padding:"5px 8px",border:"1px solid #d1fae5",borderRadius:4,fontSize:11,direction:"rtl"}}/>
                    </td>
                    <td style={{padding:4}}>
                      <input type="number" value={r.qty} onChange={e=>{const v=[...ocrExtractedRows];v[i]={...v[i],qty:parseInt(e.target.value)||0};setOcrExtractedRows(v)}}
                        style={{width:"100%",padding:"5px 8px",border:"1px solid #d1fae5",borderRadius:4,fontSize:11,fontFamily:"monospace",textAlign:"center"}}/>
                    </td>
                    <td style={{padding:4}}>
                      <input type="number" step="0.001" value={r.cost} onChange={e=>{const v=[...ocrExtractedRows];v[i]={...v[i],cost:e.target.value};setOcrExtractedRows(v)}}
                        style={{width:"100%",padding:"5px 8px",border:"1px solid #d1fae5",borderRadius:4,fontSize:11,fontFamily:"monospace",textAlign:"center"}}/>
                    </td>
                    <td style={{padding:4,textAlign:"center"}}>
                      <button onClick={()=>{const v=ocrExtractedRows.filter((_,x)=>x!==i);setOcrExtractedRows(v)}}
                        style={{padding:"3px 6px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:3,fontSize:10,cursor:"pointer"}}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={()=>setOcrExtractedRows([...ocrExtractedRows,{name:"",qty:1,cost:"0",rawLine:""}])}
            style={{marginTop:8,padding:"6px 14px",background:"#fff",color:"#059669",border:"1.5px dashed #6ee7b7",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer"}}>
            + {rtl?"إضافة صف يدوي":"Add Manual Row"}
          </button>
        </div>
      )}
      
      {/* Apply / Clear buttons */}
      {ocrExtractedRows.length > 0 && !ocrProcessing && (
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={()=>{setOcrPages([]);setOcrExtractedRows([]);window._pendingOcrPages=null}}
            style={{padding:"10px 20px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
            🔄 {rtl?"مسح الكل":"Clear All"}
          </button>
          <button onClick={applyOCRRows}
            style={{padding:"12px 28px",background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 12px rgba(5,150,105,.3)"}}>
            ✓ {rtl?`تطبيق على الفاتورة (${ocrExtractedRows.length} صف + ${ocrPages.length} صورة)`:`Apply to Invoice (${ocrExtractedRows.length} rows + ${ocrPages.length} images)`}
          </button>
        </div>
      )}
      
      {/* Info box */}
      <div style={{marginTop:14,padding:10,background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,fontSize:10,color:"#92400e",lineHeight:1.7}}>
        <strong>💡 {rtl?"نصائح":"Tips"}:</strong>
        <div style={{marginTop:4}}>
          • {rtl?"أضف الصفحات بالترتيب الصحيح (صفحة 1، 2، 3...)":"Add pages in correct order (page 1, 2, 3...)"}<br/>
          • {rtl?"يتم ضغط الصور تلقائياً لتوفير المساحة":"Images are auto-compressed to save space"}<br/>
          • {rtl?"الصور تُحفظ في قاعدة البيانات مع الفاتورة ويمكن الرجوع لها لاحقاً":"Images saved in database with the invoice — retrievable later"}<br/>
          • {rtl?"راجع البيانات المستخرجة قبل التطبيق":"Review extracted data before applying"}
        </div>
      </div>
    </div>
  </div>
)}
{/* ━━━━ RECONCILIATION REPORT MODAL ━━━━ */}
{reconReportMod && (()=>{
  const {invoice, comparisons} = reconReportMod;
  const matchCount = comparisons.filter(c => c.status === "match").length;
  const diffCount = comparisons.length - matchCount;
  const isReconciled = invoice.reconciliation_status === "reconciled";
  const shortCount = comparisons.filter(c => c.status === "invoice_more").length;
  const extraCount = comparisons.filter(c => c.status === "stock_more").length;
  
  return <div onClick={()=>setReconReportMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1002,padding:10}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:1200,maxHeight:"95vh",display:"flex",flexDirection:"column"}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,margin:0,color:isReconciled?"#10b981":"#f59e0b"}}>
            {isReconciled ? "✓ "+(rtl?"تقرير مطابقة مكتمل":"Completed Reconciliation Report") : "🔍 "+(rtl?"تقرير المطابقة":"Reconciliation Report")}
          </h2>
          <div style={{fontSize:12,color:"#6b7280",marginTop:4}}>
            <strong style={{color:"#2563eb"}}>{invoice.invoiceNo}</strong> · 🏭 {invoice.supplier} · 📅 {invoice.date}
            {isReconciled && invoice.reconciled_by_name && <span style={{marginLeft:8,color:"#059669"}}>· ✓ {rtl?"طابقها":"By"}: {invoice.reconciled_by_name}</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>exportReconciliationReport("print")} style={{padding:"7px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer"}}>🖨 {rtl?"طباعة":"Print"}</button>
          <button onClick={()=>exportReconciliationReport("pdf")} style={{padding:"7px 12px",background:"#dc2626",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer"}}>📄 PDF</button>
          <button onClick={()=>exportReconciliationReport("excel")} style={{padding:"7px 12px",background:"#10b981",color:"#fff",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer"}}>📊 Excel</button>
          <button onClick={()=>setReconReportMod(null)} style={{padding:"7px 12px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer"}}>✕</button>
        </div>
      </div>
      
      {/* KPI Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        <div style={{padding:12,background:"linear-gradient(135deg,#eff6ff,#fff)",border:"1.5px solid #bfdbfe",borderRadius:10}}>
          <div style={{fontSize:11,color:"#1e40af",fontWeight:600}}>📦 {rtl?"المنتجات":"Products"}</div>
          <div style={{fontSize:22,fontWeight:800,color:"#2563eb",fontFamily:"monospace"}}>{comparisons.length}</div>
        </div>
        <div style={{padding:12,background:"linear-gradient(135deg,#ecfdf5,#fff)",border:"1.5px solid #6ee7b7",borderRadius:10}}>
          <div style={{fontSize:11,color:"#065f46",fontWeight:600}}>✓ {rtl?"مطابق":"Matched"}</div>
          <div style={{fontSize:22,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{matchCount}</div>
        </div>
        <div style={{padding:12,background:"linear-gradient(135deg,#fffbeb,#fff)",border:"1.5px solid #fcd34d",borderRadius:10}}>
          <div style={{fontSize:11,color:"#92400e",fontWeight:600}}>⚠️ {rtl?"نقص (بالفاتورة أكثر)":"Short in Stock"}</div>
          <div style={{fontSize:22,fontWeight:800,color:"#d97706",fontFamily:"monospace"}}>{shortCount}</div>
        </div>
        <div style={{padding:12,background:"linear-gradient(135deg,#fef2f2,#fff)",border:"1.5px solid #fca5a5",borderRadius:10}}>
          <div style={{fontSize:11,color:"#991b1b",fontWeight:600}}>🔴 {rtl?"زيادة (بالمخزون أكثر)":"Extra in Stock"}</div>
          <div style={{fontSize:22,fontWeight:800,color:"#dc2626",fontFamily:"monospace"}}>{extraCount}</div>
        </div>
      </div>
      
      {/* Instructions */}
      {!isReconciled && (
        <div style={{padding:10,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,marginBottom:10,fontSize:11,color:"#1e40af"}}>
          ℹ️ {rtl?"لكل منتج مختلف، اختر: 'تعديل للفاتورة' لتحديث المخزون، أو 'إبقاء الحالي' لقبول المخزون الحالي. المنتجات المطابقة لا تحتاج قرار.":"For each differing product, choose: 'Match Invoice' to update stock, or 'Keep Current' to accept current stock. Matched products don't need a decision."}
        </div>
      )}
      
      {/* Comparison Table */}
      <div style={{flex:1,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:10,marginBottom:14}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead style={{background:"#f9fafb",position:"sticky",top:0,zIndex:1}}>
            <tr>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700}}>{rtl?"الباركود":"Barcode"}</th>
              <th style={{padding:8,textAlign:"left",fontSize:10,color:"#6b7280",fontWeight:700}}>{rtl?"المنتج":"Product"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#2563eb",fontWeight:700}}>{rtl?"الفاتورة":"Invoice"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#059669",fontWeight:700}}>{rtl?"المخزون":"Stock"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#dc2626",fontWeight:700}}>{rtl?"الفرق":"Difference"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#7c3aed",fontWeight:700}}>{rtl?"سعر الفاتورة":"Inv Cost"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#d97706",fontWeight:700}}>{rtl?"السعر الحالي":"Cur Cost"}</th>
              <th style={{padding:8,textAlign:"center",fontSize:10,color:"#374151",fontWeight:700}}>{rtl?"القرار":"Decision"}</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map(c=>{
              const decision = reconDecisions[c.idx];
              const rowBg = c.status==="match" ? "#f0fdf4" : c.status==="invoice_more" ? "#fffbeb" : "#fef2f2";
              return <tr key={c.idx} style={{borderTop:"1px solid #f3f4f6",background:rowBg}}>
                <td style={{padding:8,fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{c.barcode}</td>
                <td style={{padding:8,fontWeight:600,fontSize:11}}>{c.productName}</td>
                <td style={{padding:8,textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#2563eb"}}>{c.invoiceQty}</td>
                <td style={{padding:8,textAlign:"center",fontFamily:"monospace",fontWeight:700,color:"#059669"}}>{c.currentStock}</td>
                <td style={{padding:8,textAlign:"center",fontFamily:"monospace",fontWeight:800,color:c.diff===0?"#059669":c.diff>0?"#d97706":"#dc2626"}}>
                  {c.diff===0?"✓ 0":(c.diff>0?"+":"")+c.diff}
                </td>
                <td style={{padding:8,textAlign:"center",fontFamily:"monospace",color:"#7c3aed"}}>{c.invoiceCost.toFixed(3)}</td>
                <td style={{padding:8,textAlign:"center",fontFamily:"monospace",color:"#d97706"}}>{c.currentCost.toFixed(3)}</td>
                <td style={{padding:8,textAlign:"center"}}>
                  {isReconciled ? (
                    <span style={{padding:"3px 8px",background:"#ecfdf5",color:"#059669",borderRadius:6,fontSize:9,fontWeight:700}}>✓ {rtl?"مكتمل":"DONE"}</span>
                  ) : c.status==="match" ? (
                    <span style={{padding:"3px 8px",background:"#ecfdf5",color:"#059669",borderRadius:6,fontSize:9,fontWeight:700}}>✓ {rtl?"مطابق":"MATCH"}</span>
                  ) : (
                    <div style={{display:"flex",gap:3,flexDirection:"column"}}>
                      <button onClick={()=>setReconDecisions(prev=>({...prev,[c.idx]:"match_invoice"}))}
                        style={{padding:"4px 8px",background:decision==="match_invoice"?"#2563eb":"#eff6ff",color:decision==="match_invoice"?"#fff":"#2563eb",border:"1px solid #bfdbfe",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer"}}>
                        ↻ {rtl?"تعديل للفاتورة":"Match Invoice"}
                      </button>
                      <button onClick={()=>setReconDecisions(prev=>({...prev,[c.idx]:"keep_current"}))}
                        style={{padding:"4px 8px",background:decision==="keep_current"?"#6b7280":"#f9fafb",color:decision==="keep_current"?"#fff":"#6b7280",border:"1px solid #e5e7eb",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer"}}>
                        ✓ {rtl?"إبقاء الحالي":"Keep Current"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      
      {/* Action buttons */}
      {!isReconciled && (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <div style={{fontSize:11,color:"#6b7280"}}>
            {rtl?"قرارات مُتخذة":"Decisions made"}: <strong>{Object.values(reconDecisions).filter(v=>v).length}</strong> / {comparisons.length}
            {diffCount>0 && <span style={{marginLeft:8,color:"#d97706"}}>· {diffCount} {rtl?"يحتاج قرار":"need decision"}</span>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{
              const defaults = {};
              comparisons.forEach(c => { defaults[c.idx] = "match_invoice"; });
              setReconDecisions(defaults);
            }} style={{padding:"8px 14px",background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer"}}>
              ↻ {rtl?"الكل للفاتورة":"All Match Invoice"}
            </button>
            <button onClick={()=>{
              const defaults = {};
              comparisons.forEach(c => { defaults[c.idx] = "keep_current"; });
              setReconDecisions(defaults);
            }} style={{padding:"8px 14px",background:"#f9fafb",color:"#6b7280",border:"1px solid #e5e7eb",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer"}}>
              ✓ {rtl?"الكل إبقاء":"All Keep"}
            </button>
            {cu.role==="admin" && (
              <button onClick={()=>{
                if(!confirm(rtl?"تأكيد المطابقة؟ سيتم تطبيق القرارات وحفظ الفاتورة كمكتملة.":"Confirm reconciliation? Decisions will be applied and invoice marked as complete.")) return;
                applyReconciliation();
              }} style={{padding:"10px 20px",background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 8px rgba(5,150,105,.3)"}}>
                ✓ {rtl?"تأكيد المطابقة":"Confirm Reconciliation"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  </div>;
})()}

{/* ━━━━ MERGE PRODUCTS MODAL (admin only) ━━━━ */}
{mergeMod && cu.role === "admin" && (
  <div onClick={()=>!mergeMod.isMerging && setMergeMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1020,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"92vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,margin:0,color:"#dc2626"}}>🔀 {rtl?"دمج المنتجات المكررة":"Merge Duplicate Products"}</h2>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>
            {rtl?`دمج ${mergeMod.products.length} منتجات بنفس الباركود `:`Merge ${mergeMod.products.length} products with barcode `}<strong style={{fontFamily:"monospace",color:"#dc2626"}}>{mergeMod.barcode}</strong>
          </div>
        </div>
        <button onClick={()=>!mergeMod.isMerging && setMergeMod(null)} disabled={mergeMod.isMerging} style={{background:"none",border:"none",fontSize:22,cursor:mergeMod.isMerging?"not-allowed":"pointer",color:"#6b7280"}}>✕</button>
      </div>
      
      {/* Warning */}
      <div style={{padding:12,background:"#fffbeb",border:"2px solid #fcd34d",borderRadius:10,marginBottom:14,fontSize:11,color:"#78350f",lineHeight:1.7}}>
        <div style={{fontWeight:800,fontSize:12,marginBottom:6}}>⚠️ {rtl?"تحذير مهم - عملية الدمج لا يمكن التراجع عنها!":"Important Warning - Merge cannot be undone!"}</div>
        <div>• {rtl?"اختر المنتج المراد الإبقاء عليه (الرئيسي)":"Choose the master product to keep"}</div>
        <div>• {rtl?"باقي المنتجات سيتم حذفها وكل بياناتها ستُنقل للرئيسي":"Other products will be deleted and all their data transferred to master"}</div>
        <div>• {rtl?"البيانات المنقولة: المخزون (مجموع) + المبيعات + المشتريات + المرتجعات + الدفعات":"Data transferred: Stock (sum) + Sales + Purchases + Returns + Batches"}</div>
        <div>• {rtl?"السعر والتكلفة تبقى من المنتج الرئيسي":"Price and cost stay from the master product"}</div>
      </div>
      
      {/* Product cards (selectable) */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:800,color:"#374151",marginBottom:8}}>📌 {rtl?"اختر المنتج الرئيسي (المراد الإبقاء عليه):":"Select the MASTER product to keep:"}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {mergeMod.products.map(p => {
            const isTarget = p.id === mergeMod.targetId;
            // Calculate sales for this product
            let salesQty = 0, salesRev = 0;
            txns.forEach(tx => (tx.items||[]).forEach(i => {if(i.id === p.id){salesQty += i.qty; salesRev += i.qty * i.p}}));
            const invCount = invs.filter(inv => (inv.items||[]).some(it => it.prodId === p.id)).length;
            
            return (
              <div key={p.id} onClick={()=>!mergeMod.isMerging && setMergeMod({...mergeMod,targetId:p.id})}
                style={{padding:14,background:isTarget?"linear-gradient(135deg,#ecfdf5,#fff)":"#f9fafb",border:"3px solid "+(isTarget?"#10b981":"#e5e7eb"),borderRadius:12,cursor:mergeMod.isMerging?"not-allowed":"pointer",transition:"all .2s",position:"relative"}}>
                
                {isTarget && (
                  <div style={{position:"absolute",top:-10,left:14,padding:"3px 12px",background:"#10b981",color:"#fff",borderRadius:12,fontSize:10,fontWeight:800,boxShadow:"0 2px 6px rgba(16,185,129,.4)"}}>
                    ✓ {rtl?"المنتج الرئيسي":"MASTER"}
                  </div>
                )}
                
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  {/* Radio */}
                  <div style={{width:24,height:24,border:"3px solid "+(isTarget?"#10b981":"#9ca3af"),borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {isTarget && <div style={{width:12,height:12,background:"#10b981",borderRadius:"50%"}}></div>}
                  </div>
                  
                  {/* Icon */}
                  <div style={{minWidth:42,height:42,background:isTarget?"#fff":"#f3f4f6",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{p.e || "📦"}</div>
                  
                  {/* Info */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:"#111827"}}>{pN(p)}</div>
                    <div style={{fontSize:10,color:"#6b7280",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                      <span>🆔 ID: <strong>{p.id}</strong></span>
                      {p.cat && <span>🏷️ {p.cat}</span>}
                      {p.supplier && <span>🏭 {p.supplier}</span>}
                    </div>
                  </div>
                  
                  {/* Stats */}
                  <div style={{display:"flex",gap:14,fontSize:10}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{color:"#6b7280",fontWeight:600}}>{rtl?"المخزون":"Stock"}</div>
                      <div style={{fontWeight:800,fontFamily:"monospace",color:p.s>0?"#059669":"#dc2626",fontSize:14}}>{p.s}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{color:"#6b7280",fontWeight:600}}>{rtl?"السعر":"Price"}</div>
                      <div style={{fontWeight:800,fontFamily:"monospace",color:"#1e40af",fontSize:14}}>{fm(p.p)}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{color:"#6b7280",fontWeight:600}}>{rtl?"المباع":"Sold"}</div>
                      <div style={{fontWeight:800,fontFamily:"monospace",color:"#7c3aed",fontSize:14}}>{salesQty}</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{color:"#6b7280",fontWeight:600}}>{rtl?"الفواتير":"Invs"}</div>
                      <div style={{fontWeight:800,fontFamily:"monospace",color:"#d97706",fontSize:14}}>{invCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Merge preview */}
      {mergeMod.targetId && (()=>{
        const target = mergeMod.products.find(p => p.id === mergeMod.targetId);
        const others = mergeMod.products.filter(p => p.id !== mergeMod.targetId);
        const totalStockMerged = mergeMod.products.reduce((s,p) => s + (p.s||0), 0);
        let totalSalesMerged = 0;
        mergeMod.products.forEach(p => {
          txns.forEach(tx => (tx.items||[]).forEach(i => {if(i.id === p.id) totalSalesMerged += i.qty}));
        });
        return (
          <div style={{padding:14,background:"linear-gradient(135deg,#eff6ff,#f0fdf4)",border:"2px solid #10b981",borderRadius:10,marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:800,color:"#065f46",marginBottom:8}}>📊 {rtl?"معاينة بعد الدمج:":"Preview After Merge:"}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,fontSize:11}}>
              <div style={{padding:8,background:"#fff",borderRadius:6}}>
                <div style={{color:"#6b7280",fontWeight:600,fontSize:10}}>{rtl?"المنتج النهائي":"Final Product"}</div>
                <div style={{fontWeight:800,color:"#059669",marginTop:3,fontSize:12}}>{pN(target)}</div>
              </div>
              <div style={{padding:8,background:"#fff",borderRadius:6}}>
                <div style={{color:"#6b7280",fontWeight:600,fontSize:10}}>{rtl?"المخزون المدموج":"Combined Stock"}</div>
                <div style={{fontWeight:800,color:"#059669",marginTop:3,fontFamily:"monospace",fontSize:14}}>{totalStockMerged}</div>
              </div>
              <div style={{padding:8,background:"#fff",borderRadius:6}}>
                <div style={{color:"#6b7280",fontWeight:600,fontSize:10}}>{rtl?"المبيعات الكلية":"Total Sales"}</div>
                <div style={{fontWeight:800,color:"#7c3aed",marginTop:3,fontFamily:"monospace",fontSize:14}}>{totalSalesMerged}</div>
              </div>
              <div style={{padding:8,background:"#fff",borderRadius:6}}>
                <div style={{color:"#6b7280",fontWeight:600,fontSize:10}}>{rtl?"سيُحذف":"Will Delete"}</div>
                <div style={{fontWeight:800,color:"#dc2626",marginTop:3,fontFamily:"monospace",fontSize:14}}>{others.length} {rtl?"منتج":"products"}</div>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* Action buttons */}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button onClick={()=>setMergeMod(null)} disabled={mergeMod.isMerging}
          style={{padding:"12px 22px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:mergeMod.isMerging?"not-allowed":"pointer"}}>
          {rtl?"إلغاء":"Cancel"}
        </button>
        <button disabled={!mergeMod.targetId || mergeMod.isMerging} onClick={async()=>{
          if(!mergeMod.targetId) return;
          const target = mergeMod.products.find(p => p.id === mergeMod.targetId);
          const others = mergeMod.products.filter(p => p.id !== mergeMod.targetId);
          
          if(!confirm(rtl?
            `⚠️ تأكيد الدمج النهائي:\n\n• الإبقاء على: ${pN(target)} (ID: ${target.id})\n• حذف ${others.length} منتجات\n• نقل كل البيانات للمنتج الرئيسي\n\nهذا الإجراء لا يمكن التراجع عنه. متابعة؟`:
            `⚠️ Final merge confirmation:\n\n• Keep: ${pN(target)} (ID: ${target.id})\n• Delete ${others.length} products\n• Transfer all data to master\n\nThis cannot be undone. Continue?`
          )) return;
          
          setMergeMod({...mergeMod,isMerging:true});
          
          try{
            // Calculate combined stock
            const totalStock = mergeMod.products.reduce((s,p) => s + (p.s||0), 0);
            
            // 1. Update all transaction_items with old product IDs → target ID
            for(const other of others){
              try{
                await sb.from("transaction_items").update({product_id: target.id}).eq("product_id", other.id);
              }catch(e){console.error("tx_items update:",e)}
              
              // 2. Update purchase_invoice_items
              try{
                await sb.from("purchase_invoice_items").update({product_id: target.id}).eq("product_id", other.id);
              }catch(e){console.error("inv_items update:",e)}
              
              // 3. Update sales_return_items
              try{
                await sb.from("sales_return_items").update({product_id: target.id}).eq("product_id", other.id);
              }catch(e){console.error("ret_items update:",e)}
              
              // 4. Update product_batches (move batches to target)
              try{
                await sb.from("product_batches").update({product_id: target.id}).eq("product_id", other.id);
              }catch(e){console.error("batches update:",e)}
              
              // 5. Audit log for the merge
              try{
                await DB.addAuditLog({
                  user_id: cu.id, user_name: cu.fn,
                  action: "product_merge",
                  entity_type: "product", entity_id: target.id,
                  field_name: "merge",
                  old_value: `${other.id}:${other.n}:stock=${other.s}`,
                  new_value: `merged into ${target.id}:${target.n}`,
                  notes: `Merged duplicate barcode ${mergeMod.barcode}`
                });
              }catch(e){console.error("audit:",e)}
              
              // 6. Delete the duplicate product
              try{
                await sb.from("products").delete().eq("id", other.id);
              }catch(e){console.error("delete prod:",e)}
            }
            
            // 7. Update target product stock to combined total
            try{
              await sb.from("products").update({stock: totalStock, updated_at: new Date().toISOString()}).eq("id", target.id);
            }catch(e){console.error("target stock update:",e)}
            
            // 8. Refresh local state
            const refreshedProds = await DB.getProducts();
            setProds(refreshedProds);
            const refreshedTxns = await DB.getTransactions();
            setTxns(refreshedTxns);
            const refreshedInvs = await DB.getInvoices();
            setInvs(refreshedInvs);
            
            setMergeMod(null);
            sT("✓ "+(rtl?`تم دمج ${others.length+1} منتجات بنجاح`:`Merged ${others.length+1} products successfully`),"ok");
          }catch(e){
            console.error("Merge failed:",e);
            sT("✗ "+(rtl?"فشل الدمج: ":"Merge failed: ")+e.message,"err");
            setMergeMod({...mergeMod,isMerging:false});
          }
        }} style={{padding:"12px 28px",background:!mergeMod.targetId?"#e5e7eb":"linear-gradient(135deg,#dc2626,#ef4444)",color:!mergeMod.targetId?"#9ca3af":"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:800,cursor:!mergeMod.targetId||mergeMod.isMerging?"not-allowed":"pointer",boxShadow:!mergeMod.targetId?"none":"0 4px 12px rgba(220,38,38,.3)"}}>
          {mergeMod.isMerging ? "⏳ "+(rtl?"جاري الدمج...":"Merging...") : "🔀 "+(rtl?"تأكيد الدمج":"Confirm Merge")}
        </button>
      </div>
    </div>
  </div>
)}

{/* ━━━━ DUPLICATE BARCODE PICKER (when scan finds multiple matches) ━━━━ */}
{dupBcPicker && (
  <div onClick={()=>setDupBcPicker(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1015,padding:20}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,maxWidth:600,width:"100%",maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
      
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:800,margin:0,color:"#dc2626"}}>⚠️ {rtl?"باركود مكرر!":"Duplicate Barcode!"}</h2>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>
            {rtl?`الباركود `:`Barcode `}<strong style={{fontFamily:"monospace",color:"#dc2626"}}>{dupBcPicker.barcode}</strong>{rtl?` يطابق ${dupBcPicker.products.length} منتجات. اختر المنتج الصحيح:`:` matches ${dupBcPicker.products.length} products. Pick the correct one:`}
          </div>
        </div>
        <button onClick={()=>setDupBcPicker(null)} style={{background:"none",border:"none",fontSize:24,cursor:"pointer",color:"#6b7280"}}>✕</button>
      </div>
      
      {/* Warning box */}
      <div style={{padding:10,background:"#fef2f2",border:"1.5px solid #fca5a5",borderRadius:8,marginBottom:14,fontSize:11,color:"#991b1b",lineHeight:1.6}}>
        <strong>🐛 {rtl?"هذه مشكلة في البيانات!":"This is a data issue!"}</strong> {rtl?"يجب على الإدارة تعديل أحد المنتجات لإعطاءه باركوداً فريداً (Admin → Smart Audit → Duplicate barcode)":"Admin should edit one of the products to give it a unique barcode (Admin → Smart Audit → Duplicate barcode)"}.
      </div>
      
      {/* Product picker */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {dupBcPicker.products.map(p => (
          <button key={p.id} onClick={()=>{addToCart(p);sT("✓ "+pN(p)+" "+t.added,"ok");setDupBcPicker(null)}}
            style={{padding:14,background:"#fff",border:"2px solid #e5e7eb",borderRadius:10,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#2563eb";e.currentTarget.style.background="#eff6ff"}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#e5e7eb";e.currentTarget.style.background="#fff"}}>
            
            {/* Icon */}
            <div style={{minWidth:44,height:44,background:"#f5f3ff",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>
              {p.e || "📦"}
            </div>
            
            {/* Info */}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"#111827"}}>{pN(p)}</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                {p.cat && <span>🏷️ {p.cat}</span>}
                {p.supplier && <span>🏭 {p.supplier}</span>}
                <span>📦 {rtl?"المخزون":"Stock"}: <strong style={{color:p.s>0?"#059669":"#dc2626"}}>{p.s}</strong></span>
                <span style={{fontFamily:"monospace",color:"#9ca3af"}}>ID: {p.id}</span>
              </div>
            </div>
            
            {/* Price */}
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"#6b7280",fontWeight:600,textTransform:"uppercase"}}>{rtl?"السعر":"Price"}</div>
              <div style={{fontSize:18,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{fm(p.p)}</div>
            </div>
            
            <div style={{fontSize:18,color:"#2563eb"}}>➕</div>
          </button>
        ))}
      </div>
      
      <button onClick={()=>setDupBcPicker(null)} style={{marginTop:14,width:"100%",padding:10,background:"#f3f4f6",color:"#374151",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
        {rtl?"إلغاء":"Cancel"}
      </button>
    </div>
  </div>
)}

{/* ━━━━ IMAGE LIGHTBOX (full-screen attachment view) ━━━━ */}
{invAttachLightbox && (
  <div onClick={()=>setInvAttachLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1010,padding:20,flexDirection:"column",gap:12}}>
    <div style={{position:"absolute",top:14,right:14,display:"flex",gap:8,zIndex:2}}>
      <a href={invAttachLightbox.src} download={invAttachLightbox.name+".jpg"} onClick={e=>e.stopPropagation()} style={{padding:"8px 14px",background:"#10b981",color:"#fff",borderRadius:8,fontSize:12,fontWeight:700,textDecoration:"none"}}>💾 {rtl?"تحميل":"Download"}</a>
      <button onClick={()=>setInvAttachLightbox(null)} style={{padding:"8px 14px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>✕ {rtl?"إغلاق":"Close"}</button>
    </div>
    <img src={invAttachLightbox.src} alt={invAttachLightbox.name} onClick={e=>e.stopPropagation()} style={{maxWidth:"95vw",maxHeight:"90vh",objectFit:"contain",boxShadow:"0 10px 40px rgba(0,0,0,.5)",borderRadius:8}}/>
    <div style={{color:"#fff",fontSize:12,fontFamily:"monospace"}}>{invAttachLightbox.name}</div>
  </div>
)}

{/* QUICK PRODUCT SEARCH MODAL */}
{quickSearchMod&&<div onClick={()=>{setQuickSearchMod(false);setSelectedProdCard(null)}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1001,padding:20}}>
<div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:20,width:"100%",maxWidth:selectedProdCard?720:540,maxHeight:"92vh",overflow:"auto"}}>

{!selectedProdCard?<>
{/* Search View */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
  <h2 style={{fontSize:18,fontWeight:800,margin:0}}>🔍 {rtl?"بحث سريع عن منتج":"Quick Product Search"}</h2>
  <button onClick={()=>setQuickSearchMod(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280"}}>✕</button>
</div>
<p style={{color:"#6b7280",fontSize:12,marginBottom:14}}>{rtl?"امسح الباركود أو ابحث بالاسم/الفئة/المورد":"Scan barcode or search by name/category/supplier"}</p>

<input value={quickSearchInput} onChange={e=>setQuickSearchInput(e.target.value)}
  onKeyDown={e=>{if(e.key==="Enter"){
    // Try exact barcode match first
    const exact=prods.find(p=>p.bc===quickSearchInput.trim());
    if(exact){setSelectedProdCard(exact);setPrintLabelQty(10);return}
    // If only one result from search, select it
    const q=quickSearchInput.toLowerCase().trim();
    const matches=prods.filter(p=>p.bc.toLowerCase().includes(q)||p.n.toLowerCase().includes(q)||(p.a||"").toLowerCase().includes(q)||(p.cat||"").toLowerCase().includes(q));
    if(matches.length===1){setSelectedProdCard(matches[0]);setPrintLabelQty(10)}
  }}}
  autoFocus
  placeholder={rtl?"امسح الباركود أو اكتب للبحث...":"Scan barcode or type to search..."}
  style={{width:"100%",padding:14,fontSize:16,border:"2.5px solid #2563eb",borderRadius:12,outline:"none",marginBottom:14,fontFamily:"monospace",fontWeight:600}}/>

{/* Results list */}
{quickSearchInput.trim()&&(()=>{
  const q=quickSearchInput.toLowerCase().trim();
  const results=prods.filter(p=>p.bc.toLowerCase().includes(q)||p.n.toLowerCase().includes(q)||(p.a||"").toLowerCase().includes(q)||(p.cat||"").toLowerCase().includes(q)||(p.supplier||"").toLowerCase().includes(q)).slice(0,12);
  if(results.length===0) return <div style={{padding:30,textAlign:"center",color:"#9ca3af",background:"#f9fafb",borderRadius:10}}>🔎 {rtl?"لا توجد نتائج":"No results found"}</div>;
  return <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:400,overflow:"auto"}}>
    <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>{results.length} {rtl?"نتيجة":"result(s)"}</div>
    {results.map(p=><div key={p.id} onClick={()=>{setSelectedProdCard(p);setPrintLabelQty(10)}}
      style={{padding:12,background:"#fff",border:"1.5px solid #e5e7eb",borderRadius:10,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,transition:"all .15s"}}
      onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor="#2563eb"}}
      onMouseLeave={e=>{e.currentTarget.style.background="#fff";e.currentTarget.style.borderColor="#e5e7eb"}}>
      <div style={{flex:1}}>
        <div style={{fontSize:13,fontWeight:700,color:"#111827"}}>{p.e} {pN(p)}</div>
        <div style={{fontSize:10,color:"#6b7280",marginTop:3,fontFamily:"monospace"}}>📷 {p.bc}{p.cat&&" · 🏷️ "+p.cat}{p.supplier&&" · 🏭 "+p.supplier}</div>
      </div>
      <div style={{textAlign:"right"}}>
        <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:"#059669"}}>{fm(p.p)}</div>
        <div style={{fontSize:9,color:p.s<=0?"#dc2626":p.s<30?"#d97706":"#059669",fontWeight:600}}>{rtl?"المخزون":"Stock"}: {p.s}</div>
      </div>
    </div>)}
  </div>;
})()}

{!quickSearchInput.trim()&&<div style={{padding:40,textAlign:"center",color:"#9ca3af",background:"#f9fafb",borderRadius:10}}>
  <div style={{fontSize:36,marginBottom:8}}>🔍</div>
  <div style={{fontSize:13,fontWeight:600}}>{rtl?"ابدأ الكتابة أو امسح باركود":"Start typing or scan a barcode"}</div>
  <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>{rtl?"نصيحة: اضغط Enter لاختيار النتيجة الوحيدة تلقائياً":"Tip: Press Enter to select single result automatically"}</div>
</div>}
</>:<>
{/* Product Card View */}
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
  <button onClick={()=>{setSelectedProdCard(null);setQuickSearchInput("")}} style={{padding:"8px 14px",background:"#f3f4f6",border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,color:"#374151",display:"flex",alignItems:"center",gap:6}}>← {rtl?"رجوع للبحث":"Back to Search"}</button>
  <button onClick={()=>setQuickSearchMod(false)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#6b7280"}}>✕</button>
</div>

{/* Product Card */}
<div style={{background:"linear-gradient(135deg,#eff6ff,#fff)",border:"2px solid #2563eb",borderRadius:16,padding:20,marginBottom:14}}>
  <div style={{display:"flex",gap:20,alignItems:"flex-start",marginBottom:16}}>
    <div style={{fontSize:72,lineHeight:1}}>{selectedProdCard.e||"📦"}</div>
    <div style={{flex:1}}>
      <div style={{fontSize:22,fontWeight:800,color:"#111827",marginBottom:4}}>{pN(selectedProdCard)}</div>
      {selectedProdCard.a&&selectedProdCard.n&&selectedProdCard.a!==selectedProdCard.n&&<div style={{fontSize:14,color:"#6b7280",marginBottom:8}}>{rtl?selectedProdCard.n:selectedProdCard.a}</div>}
      <div style={{display:"inline-block",padding:"6px 14px",background:"#2563eb",color:"#fff",borderRadius:8,fontSize:14,fontFamily:"monospace",fontWeight:700,letterSpacing:1}}>📷 {selectedProdCard.bc}</div>
    </div>
  </div>

  {/* Info grid */}
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>💰 {rtl?"سعر البيع":"Sell Price"}</div>
      <div style={{fontSize:22,fontWeight:800,color:"#059669",fontFamily:"monospace"}}>{fm(selectedProdCard.p)}</div>
    </div>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>💸 {rtl?"سعر الشراء":"Cost"}</div>
      <div style={{fontSize:18,fontWeight:700,color:"#dc2626",fontFamily:"monospace"}}>{fm(selectedProdCard.c)}</div>
      <div style={{fontSize:10,color:"#6b7280",marginTop:3}}>{rtl?"الهامش":"Margin"}: <span style={{fontWeight:700,color:(selectedProdCard.p-selectedProdCard.c)>0?"#059669":"#dc2626"}}>{fm(selectedProdCard.p-selectedProdCard.c)}</span> ({selectedProdCard.c>0?((selectedProdCard.p-selectedProdCard.c)/selectedProdCard.c*100).toFixed(1):"—"}%)</div>
    </div>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>📦 {rtl?"المخزون":"Stock"}</div>
      <div style={{fontSize:22,fontWeight:800,fontFamily:"monospace",color:selectedProdCard.s<=0?"#dc2626":selectedProdCard.s<30?"#d97706":"#059669"}}>{selectedProdCard.s}</div>
      <div style={{fontSize:10,color:"#6b7280",marginTop:3}}>{selectedProdCard.u||"pc"}</div>
    </div>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>🏷️ {rtl?"الفئة":"Category"}</div>
      <div style={{fontSize:13,fontWeight:700,color:"#374151"}}>{selectedProdCard.cat||"—"}</div>
    </div>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>🏭 {rtl?"المورد":"Supplier"}</div>
      <div style={{fontSize:13,fontWeight:700,color:"#2563eb"}}>{selectedProdCard.supplier||"—"}</div>
    </div>
    <div style={{padding:12,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb"}}>
      <div style={{fontSize:10,color:"#6b7280",fontWeight:600,marginBottom:4}}>📅 {rtl?"الانتهاء":"Expiry"}</div>
      <div style={{fontSize:13,fontWeight:700,color:selectedProdCard.exp?"#d97706":"#9ca3af"}}>{selectedProdCard.exp||"—"}</div>
    </div>
  </div>

  {/* Sales stats */}
  {(()=>{
    let totalSold=0;
    txns.forEach(tx=>tx.items.forEach(i=>{if(i.id===selectedProdCard.id)totalSold+=i.qty}));
    return <div style={{marginTop:10,padding:10,background:"#f5f3ff",borderRadius:10,border:"1px solid #ddd6fe",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:11,color:"#5b21b6",fontWeight:600}}>📊 {rtl?"إجمالي المبيعات":"Total Sold"}</div>
      <div style={{fontSize:16,fontWeight:800,color:"#7c3aed",fontFamily:"monospace"}}>{totalSold} {rtl?"قطعة":"units"}</div>
    </div>;
  })()}
</div>

{/* Print Barcode Labels Section */}
<div style={{background:"#ecfdf5",border:"2px solid #6ee7b7",borderRadius:12,padding:16}}>
  <h3 style={{margin:"0 0 12px",fontSize:15,fontWeight:800,color:"#065f46"}}>🖨 {rtl?"طباعة ملصقات الباركود":"Print Barcode Labels"}</h3>
  
  <label style={{fontSize:12,fontWeight:700,color:"#065f46",marginBottom:6,display:"block"}}>{rtl?"عدد الملصقات المطلوبة":"Number of Labels"}</label>
  
  {/* Quick quantity buttons */}
  <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
    {[1,5,10,20,50,100].map(n=>(
      <button key={n} onClick={()=>setPrintLabelQty(n)} style={{padding:"6px 14px",background:printLabelQty===n?"#059669":"#fff",color:printLabelQty===n?"#fff":"#065f46",border:"1.5px solid #6ee7b7",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>{n}</button>
    ))}
  </div>
  
  {/* Custom quantity input */}
  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
    <span style={{fontSize:12,color:"#065f46",fontWeight:600}}>{rtl?"أو أدخل كمية مخصصة:":"Or custom quantity:"}</span>
    <input type="number" min="1" max="500" value={printLabelQty} onChange={e=>setPrintLabelQty(Math.min(500,Math.max(1,parseInt(e.target.value)||1)))}
      style={{width:100,padding:"8px 10px",border:"1.5px solid #6ee7b7",borderRadius:8,fontSize:14,fontWeight:700,fontFamily:"monospace",textAlign:"center"}}/>
    <span style={{fontSize:11,color:"#6b7280"}}>{rtl?"(الحد الأقصى 500)":"(max 500)"}</span>
  </div>
  
  <button onClick={()=>{
    const p=selectedProdCard;
    const q=printLabelQty;
    if(!q||q<=0||q>500){sT("✗ "+(rtl?"كمية غير صالحة":"Invalid quantity"),"err");return}
    const w=window.open("","_blank","width=500,height=500");
    if(!w) return;
    const nm=(p.a||p.n).replace(/"/g,"").substring(0,28);
    const storeName=(storeSettings.storeName||"3045").substring(0,18);
    const bc=p.bc;
    let labels="";
    for(let k=0;k<q;k++){
      labels+='<div class="lbl"><div class="sn">'+storeName+'</div><div class="nm">'+nm+'</div><svg class="bc" id="bc'+k+'"></svg><div class="pr">'+p.p.toFixed(3)+' JD</div></div>';
    }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels - '+nm+'</title><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script><style>@page{size:40mm 30mm;margin:0}@media print{html,body{margin:0!important;padding:0!important;width:40mm;height:30mm}thead,tfoot,header,footer{display:none!important}}html,body{margin:0;padding:0;width:40mm;height:30mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}*{box-sizing:border-box;margin:0;padding:0}.lbl{width:40mm;height:30mm;padding:1mm 1.5mm;text-align:center;font-family:Arial,"Tahoma",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;page-break-inside:avoid;page-break-after:always}.lbl:last-child{page-break-after:auto}.sn{font-size:10pt;font-weight:900;line-height:1.05;margin-bottom:0.3mm}.nm{font-size:8pt;font-weight:700;line-height:1.1;max-height:7.5mm;overflow:hidden;word-break:break-word;direction:rtl}.bc{width:37mm;height:10mm;display:block}.pr{font-size:15pt;font-weight:900;line-height:1;font-family:Arial,sans-serif;margin-top:0.3mm}</style></head><body>'+labels+'<script>window.addEventListener("load",function(){for(var k=0;k<'+q+';k++){try{JsBarcode("#bc"+k,"'+bc+'",{format:"CODE128",width:1.5,height:36,displayValue:true,fontSize:9,textMargin:0,margin:0})}catch(e){}}setTimeout(function(){window.print();setTimeout(function(){window.close()},800)},400)})<\/script></body></html>');
    w.document.close();
    sT("✓ "+(rtl?"جاري الطباعة...":"Printing...")+" ("+q+")","ok");
  }} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#059669,#10b981)",border:"none",borderRadius:10,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>
    🖨 {rtl?"طباعة":"Print"} {printLabelQty} {rtl?"ملصق":"Label(s)"}
  </button>
  
  <div style={{marginTop:10,padding:10,background:"#fff",borderRadius:8,border:"1px dashed #6ee7b7",textAlign:"center"}}>
    <div style={{fontSize:10,color:"#065f46",fontWeight:600,marginBottom:4}}>👁️ {rtl?"معاينة الملصق":"Label Preview"}</div>
    <div style={{display:"inline-block",padding:"6px 10px",border:"2px dashed #059669",borderRadius:6,fontSize:10,fontFamily:"Arial",textAlign:"center",background:"#fff"}}>
      <div style={{fontWeight:900}}>{(storeSettings.storeName||"3045").substring(0,18)}</div>
      <div style={{fontSize:8,fontWeight:700,marginTop:2}}>{(selectedProdCard.a||selectedProdCard.n).substring(0,28)}</div>
      <div style={{fontSize:8,fontFamily:"monospace",marginTop:4,letterSpacing:1}}>|||||||||||||</div>
      <div style={{fontSize:9,fontFamily:"monospace"}}>{selectedProdCard.bc}</div>
      <div style={{fontSize:14,fontWeight:900,marginTop:2}}>{selectedProdCard.p.toFixed(3)} JD</div>
    </div>
    <div style={{fontSize:9,color:"#6b7280",marginTop:6}}>{rtl?"حجم الملصق: 40mm × 30mm (Xprinter)":"Label size: 40mm × 30mm (Xprinter)"}</div>
  </div>
</div>
</>}

</div>
</div>}

{voidMod&&<div className="ov" onClick={()=>setVoidMod(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
  <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:24,minWidth:450,maxWidth:520}}>
    <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:"#dc2626"}}>🚫 {rtl?"إلغاء فاتورة":"Void Transaction"}</h3>
    <p style={{color:"#6b7280",fontSize:12,marginBottom:16}}>
      ⚠️ {rtl?"الإلغاء عملية حساسة — لا يمكن التراجع، الفاتورة ستبقى في السجل مع علامة 'ملغاة'":"Void is sensitive — cannot be undone. Transaction stays in log marked as 'voided'"}
    </p>
    
    <div style={{padding:14,background:"#fef2f2",borderRadius:10,marginBottom:14,border:"1px solid #fca5a5"}}>
      <div style={{fontSize:11,color:"#7f1d1d",fontWeight:600}}>{rtl?"الفاتورة":"Receipt"}: <span style={{fontFamily:"monospace"}}>{voidMod.rn}</span></div>
      <div style={{fontSize:24,fontWeight:800,color:"#dc2626",fontFamily:"monospace",marginTop:4}}>{voidMod.tot.toFixed(3)} JD</div>
      <div style={{fontSize:11,color:"#7f1d1d"}}>{voidMod.date} {voidMod.time} · {voidMod.cashierName}</div>
    </div>
    
    <label style={{fontSize:12,fontWeight:700,color:"#374151"}}>{rtl?"سبب الإلغاء (إجباري)":"Void Reason (required)"}</label>
    <textarea value={voidReason} onChange={e=>setVoidReason(e.target.value)}
      autoFocus placeholder={rtl?"اكتب سبب الإلغاء بوضوح...":"Clearly explain reason for voiding..."}
      rows={3} style={{width:"100%",padding:10,border:"2px solid #fca5a5",borderRadius:8,fontSize:13,marginTop:4,marginBottom:16,fontFamily:"inherit",resize:"none"}}/>
    
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
      <button onClick={()=>setVoidMod(null)} style={{padding:"10px 20px",background:"#f3f4f6",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer"}}>{rtl?"إلغاء":"Cancel"}</button>
      <button onClick={async()=>{
        if(!voidReason.trim()){sT("✗ "+(rtl?"يجب كتابة سبب":"Reason required"),"err");return}
        if(!confirm(rtl?`تأكيد إلغاء الفاتورة ${voidMod.rn}؟`:`Confirm voiding ${voidMod.rn}?`))return;
        try{
          await DB.voidTransaction(voidMod.id,voidReason,cu.id,cu.fn);
          setTxns(p=>p.map(t=>t.id===voidMod.id?{...t,voidStatus:"voided",voidReason:voidReason,voidBy:cu.id,voidAt:new Date().toISOString()}:t));
          sT("✓ "+(rtl?"تم الإلغاء":"Voided"),"ok");
          setVoidMod(null);setVoidReason("");
        }catch(e){console.error(e);sT("✗ "+e.message,"err")}
      }} disabled={!voidReason.trim()}
        style={{padding:"10px 24px",background:voidReason.trim()?"#dc2626":"#d1d5db",border:"none",borderRadius:8,color:"#fff",fontWeight:700,cursor:voidReason.trim()?"pointer":"not-allowed"}}>
        🚫 {rtl?"تأكيد الإلغاء":"Confirm Void"}
      </button>
    </div>
  </div>
</div>}

{salesReturnMod&&<div className="ov" onClick={()=>setSalesReturnMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>↩️ {rtl?"مرتجع مبيعات":"Sales Return"}<button className="mc" onClick={()=>setSalesReturnMod(false)}>✕</button></h2>
<div className="pf"><label>{t.receipt} #</label>
<div style={{display:"flex",gap:6}}>
<input placeholder={rtl?"رقم الإيصال":"Receipt number"} onChange={e=>{const rn=e.target.value;const tx=txns.find(t2=>t2.rn===rn);setReturnTxn(tx||null);if(tx)setReturnItems(tx.items.map(i=>({...i,returnQty:0,reason:""})))}}/>
</div>
</div>
{returnTxn&&<>
<div style={{background:"#eff6ff",borderRadius:12,padding:12,marginBottom:12,fontSize:12}}>
<div style={{fontWeight:700,color:"#2563eb"}}>{returnTxn.rn} — {returnTxn.date}</div>
<div style={{color:"#6b7280"}}>{returnTxn.items.length} {t.items} · {fm(returnTxn.tot)}</div>
</div>
<div style={{fontSize:12,fontWeight:700,marginBottom:8}}>{rtl?"اختر العناصر للإرجاع":"Select items to return"}:</div>
{returnItems.map((ri,i)=><div key={i} style={{display:"flex",gap:6,alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f3f4f6"}}>
<div style={{flex:2,fontSize:12,fontWeight:600}}>{ri.n} <span style={{color:"#9ca3af"}}>×{ri.qty}</span></div>
<input type="number" min="0" max={ri.qty} value={ri.returnQty} onChange={e=>{const v=[...returnItems];v[i]={...v[i],returnQty:Math.min(parseInt(e.target.value)||0,ri.qty)};setReturnItems(v)}} style={{width:50,padding:"6px",borderRadius:6,border:"1px solid #e5e7eb",fontFamily:"var(--m)",textAlign:"center"}} placeholder="0"/>
<input value={ri.reason} onChange={e=>{const v=[...returnItems];v[i]={...v[i],reason:e.target.value};setReturnItems(v)}} placeholder={rtl?"السبب":"Reason"} style={{flex:1,padding:"6px 8px",borderRadius:6,border:"1px solid #e5e7eb",fontSize:11}}/>
</div>)}
{(()=>{const totalReturn=returnItems.reduce((s,ri)=>s+ri.returnQty*ri.p,0);const isFullReturn=returnItems.every(ri=>ri.returnQty===ri.qty);
return totalReturn>0&&<>
<div style={{background:"#fef2f2",borderRadius:12,padding:14,textAlign:"center",marginTop:12}}>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"مبلغ الإرجاع":"Refund Amount"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#dc2626"}}>{fm(totalReturn)}</div>
<div style={{fontSize:10,color:"#9ca3af"}}>{isFullReturn?(rtl?"إرجاع كامل":"Full Return"):(rtl?"إرجاع جزئي":"Partial Return")}</div>
</div>
<button className="cpb" style={{background:"#dc2626",marginTop:12}} onClick={async()=>{
const items=returnItems.filter(ri=>ri.returnQty>0);
if(!items.length){sT("✗ "+(rtl?"اختر منتجات للإرجاع":"Select items to return"),"err");return}
const totalRefund=items.reduce((s,ri)=>s+ri.returnQty*ri.p,0);
if(!confirm((rtl?"تأكيد إرجاع ":"Confirm return of ")+items.length+(rtl?" منتج بقيمة ":" items for ")+fm(totalRefund)+"؟"))return;

console.log("[RETURN] Starting return process",{returnTxn,items,totalRefund});

let savedReturn = null;
try{
  // STEP 1: Save the return record
  console.log("[RETURN] Step 1: Saving return record...");
  const returnPayload={receipt_no:returnTxn.rn,return_type:isFullReturn?"full":"partial",return_reason:items.map(ri=>ri.reason).filter(Boolean).join(", ")||"Customer return",total_refund:totalRefund,refund_method:"cash",status:"completed"};
  console.log("[RETURN] Payload:",returnPayload);
  savedReturn=await DB.addSalesReturn(returnPayload);
  if(!savedReturn){throw new Error(rtl?"فشل حفظ المرتجع - لا توجد بيانات مسترجعة":"Failed to save return - no data returned")}
  console.log("[RETURN] Step 1 OK, saved return:",savedReturn);
}catch(e){
  console.error("[RETURN] Step 1 FAILED:",e);
  sT("✗ "+(rtl?"فشل حفظ المرتجع: ":"Save failed: ")+(e.message||"Unknown"),"err");
  return; // Stop completely
}

try{
  // STEP 2: Save return items
  console.log("[RETURN] Step 2: Saving return items...");
  const isMisc=(ri)=>ri._isMisc||(typeof ri.id==="string"&&ri.id.startsWith("misc_"));
  const itemsToSave=items.map(ri=>{
    const realId=isMisc(ri)?null:(typeof ri.id==="string"&&ri.id.includes("_w")?ri.id.split("_w")[0]:ri.id);
    const safeId=realId&&typeof realId==="string"&&!/^\d+$/.test(realId)?null:realId;
    return{return_id:savedReturn.id,product_id:safeId,product_name:ri.n,quantity:ri.returnQty,unit_price:ri.p,line_total:+(ri.returnQty*ri.p).toFixed(3),reason:ri.reason||""};
  });
  console.log("[RETURN] Items to save:",itemsToSave);
  await DB.addSalesReturnItems(itemsToSave);
  console.log("[RETURN] Step 2 OK");
}catch(e){
  console.error("[RETURN] Step 2 FAILED (items):",e);
  // Continue anyway - the main return record is saved
  sT("⚠ "+(rtl?"تم حفظ المرتجع لكن فشل حفظ البنود":"Return saved but items failed: ")+e.message,"err");
}

try{
  // STEP 3: Restore stock (best effort, won't block)
  console.log("[RETURN] Step 3: Restoring stock...");
  const isMisc=(ri)=>ri._isMisc||(typeof ri.id==="string"&&ri.id.startsWith("misc_"));
  for(const ri of items){
    if(isMisc(ri))continue;
    try{
      const realId=typeof ri.id==="string"&&ri.id.includes("_w")?ri.id.split("_w")[0]:ri.id;
      const{data:cur}=await sb.from("products").select("stock").eq("id",realId).single();
      if(cur){
        const newStock=cur.stock+ri.returnQty;
        await sb.from("products").update({stock:newStock,updated_at:new Date().toISOString()}).eq("id",realId);
        setProds(prev=>prev.map(x=>x.id===realId?{...x,s:newStock}:x));
      }
    }catch(er){console.error("[RETURN] Restore stock for "+ri.id+":",er)}
  }
  console.log("[RETURN] Step 3 OK");
}catch(e){console.error("[RETURN] Step 3 FAILED (stock):",e);}

try{
  // STEP 4: Deduct refund from cash register
  console.log("[RETURN] Step 4: Deducting from cash...");
  const cashAcct=bankAccts.find(a=>a.name&&(a.name.toLowerCase().includes("cash register")||a.name.toLowerCase().includes("صندوق")));
  if(cashAcct){
    await DB.addMoneyMovement({account_id:cashAcct.id,type:"withdrawal",amount:totalRefund,reference_no:"REFUND-"+savedReturn.id,description:(rtl?"مرتجع مبيعات للفاتورة ":"Sales return for receipt ")+returnTxn.rn,created_by:cu?.id});
    await sb.from("bank_accounts").update({balance:(parseFloat(cashAcct.balance)||0)-totalRefund,updated_at:new Date().toISOString()}).eq("id",cashAcct.id);
    const[ba2,mv2]=await Promise.all([DB.getBankAccounts(),DB.getMoneyMovements()]);setBankAccts(ba2);setMovements(mv2);
  }
  console.log("[RETURN] Step 4 OK");
}catch(er){console.error("[RETURN] Step 4 FAILED (refund):",er);}

// STEP 5: Refresh state and close modal
console.log("[RETURN] Step 5: Refreshing state...");
try{
  const allReturns=await DB.getSalesReturns();
  setSalesReturns(allReturns);
}catch(e){
  console.error("[RETURN] Refresh failed:",e);
  setSalesReturns(p=>[savedReturn,...p]);
}
setSalesReturnMod(false);setReturnTxn(null);setReturnItems([]);
sT("✓ "+(rtl?"تم الإرجاع — استرداد ":"Return processed — refunded ")+fm(totalRefund),"ok");
console.log("[RETURN] All done!");
}}>↩️ {rtl?"تأكيد الإرجاع":"Confirm Return"} — {fm(totalReturn)}</button>
</>})()}
</>}
</div></div>}

{/* PURCHASE RETURN MODAL */}
{purchaseReturnMod&&<div className="ov" onClick={()=>setPurchaseReturnMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>↩️ {rtl?"مرتجع مشتريات":"Purchase Return"}<button className="mc" onClick={()=>setPurchaseReturnMod(false)}>✕</button></h2>
<div className="pf"><label>{rtl?"اختر الفاتورة":"Select Invoice"}</label><select onChange={e=>{const inv=invs.find(i=>i.id===+e.target.value);if(inv)setReturnItems(inv.items.map(i=>({...i,returnQty:0})))}} style={{fontFamily:"var(--f)"}}><option value="">--</option>{invs.map(inv=><option key={inv.id} value={inv.id}>{inv.invoiceNo} — {inv.supplier} ({fm(inv.totalCost)})</option>)}</select></div>
{returnItems.length>0&&<>
{returnItems.map((ri,i)=><div key={i} style={{display:"flex",gap:6,alignItems:"center",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
<div style={{flex:2,fontSize:12,fontWeight:600}}>{ri.productName} <span style={{color:"#9ca3af"}}>×{ri.qty}</span></div>
<input type="number" min="0" max={ri.qty} value={ri.returnQty} onChange={e=>{const v=[...returnItems];v[i]={...v[i],returnQty:Math.min(parseInt(e.target.value)||0,parseInt(ri.qty))};setReturnItems(v)}} style={{width:50,padding:"6px",borderRadius:6,border:"1px solid #e5e7eb",fontFamily:"var(--m)",textAlign:"center"}} placeholder="0"/>
</div>)}
{(()=>{const totalReturn=returnItems.reduce((s,ri)=>s+ri.returnQty*(parseFloat(ri.cost)||0),0);
return totalReturn>0&&<>
<div style={{background:"#ecfdf5",borderRadius:12,padding:14,textAlign:"center",marginTop:12}}>
<div style={{fontSize:11,color:"#6b7280"}}>{rtl?"مبلغ الاسترداد":"Refund Amount"}</div>
<div style={{fontSize:28,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{fm(totalReturn)}</div>
</div>
<button className="cpb cpb-green" style={{marginTop:12}} onClick={async()=>{
const items=returnItems.filter(ri=>ri.returnQty>0);if(!items.length)return;
const totalRefund=items.reduce((s,ri)=>s+ri.returnQty*(parseFloat(ri.cost)||0),0);
try{
  const ret=await DB.addPurchaseReturn({invoice_no:items[0]?.invoiceNo||"",supplier_name:items[0]?.supplier||"",return_type:items.every(ri=>ri.returnQty===parseInt(ri.qty))?"full":"partial",total_refund:totalRefund,status:"completed",created_by:cu?.id});
  if(ret)await DB.addPurchaseReturnItems(items.map(ri=>({return_id:ret.id,product_id:ri.prodId,product_name:ri.productName,quantity:ri.returnQty,unit_cost:parseFloat(ri.cost)||0,line_total:ri.returnQty*(parseFloat(ri.cost)||0)})));
  // Deduct stock (returned to supplier)
  for(const ri of items){setProds(p=>p.map(x=>x.id===ri.prodId?{...x,s:Math.max(0,x.s-ri.returnQty)}:x));try{const pr=prods.find(x=>x.id===ri.prodId);if(pr)await DB.updateProductPriceStock(ri.prodId,pr.p,Math.max(0,pr.s-ri.returnQty))}catch{}}
  setPurchaseReturns(p=>[ret,...p]);setPurchaseReturnMod(false);setReturnItems([]);
  sT("✓ "+(rtl?"تم الإرجاع":"Return processed"),"ok");
}catch(e){console.error(e)}}}>↩️ {rtl?"تأكيد الإرجاع":"Confirm Return"} — {fm(totalReturn)}</button>
</>})()}
</>}
</div></div>}

{/* ADD DOCUMENT MODAL */}
{docMod&&<div className="ov" onClick={()=>setDocMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>📁 {t.addDoc}<button className="mc" onClick={()=>setDocMod(false)}>✕</button></h2>
<div className="pf"><label>{t.docTitle}</label><input value={newDoc.title} onChange={e=>setNewDoc({...newDoc,title:e.target.value})} placeholder={rtl?"عنوان المستند":"Document title"}/></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.docType}</label><select value={newDoc.type} onChange={e=>setNewDoc({...newDoc,type:e.target.value})} style={{fontFamily:"var(--f)"}}>
<option value="rent">🏠 {t.rentContract}</option>
<option value="license">📋 {t.license}</option>
<option value="insurance">🛡️ {t.insurance}</option>
<option value="agreement">📝 {t.agreement}</option>
<option value="other">📄 {t.otherDoc}</option>
</select></div>
<div className="pf" style={{flex:1}}><label>{t.expDate}</label><input type="date" value={newDoc.date} onChange={e=>setNewDoc({...newDoc,date:e.target.value})}/></div>
</div>
<div className="pf"><label>{t.expDesc}</label><input value={newDoc.description} onChange={e=>setNewDoc({...newDoc,description:e.target.value})}/></div>
<div className="pf"><label>📎 {t.uploadFile}</label>
<div style={{border:"2px dashed #d1d5db",borderRadius:12,padding:24,textAlign:"center",cursor:"pointer",background:newDoc.file?"#ecfdf5":"#f9fafb"}} onClick={()=>document.getElementById("doc-upload")?.click()}>
{newDoc.file?<>
<div style={{fontSize:28,marginBottom:4}}>✅</div>
<div style={{fontSize:13,fontWeight:600,color:"#059669"}}>{newDoc.fileName}</div>
<div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>{rtl?"انقر لتغيير الملف":"Click to change file"}</div>
</>:<>
<div style={{fontSize:36,marginBottom:4,opacity:.3}}>📎</div>
<div style={{fontSize:13,color:"#6b7280"}}>{rtl?"انقر لرفع صورة أو ملف PDF":"Click to upload image or PDF"}</div>
<div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>{rtl?"حد أقصى 3MB":"Max 3MB"}</div>
</>}
</div>
<input id="doc-upload" type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>3000000){sT("✗ Max 3MB","err");return}const r=new FileReader();r.onload=ev=>setNewDoc(p=>({...p,file:ev.target.result,fileName:f.name}));r.readAsDataURL(f)}}/>
</div>
{newDoc.file&&newDoc.file.startsWith("data:image")&&<img src={newDoc.file} style={{maxHeight:150,borderRadius:8,border:"1px solid #e5e7eb",marginBottom:12,width:"100%",objectFit:"contain"}} alt=""/>}
<button className="cpb" onClick={()=>{if(!newDoc.title)return;const doc={...newDoc,id:Date.now(),createdAt:new Date().toISOString()};saveDocuments([doc,...documents]);setDocMod(false);sT("✓ "+t.saved,"ok")}} disabled={!newDoc.title}>✓ {t.addDoc}</button>
</div></div>}

{/* VIEW DOCUMENT MODAL */}
{viewDocMod&&<div className="ov" onClick={()=>setViewDocMod(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:650}}>
<h2>📄 {viewDocMod.title}<button className="mc" onClick={()=>setViewDocMod(null)}>✕</button></h2>
<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
{viewDocMod.type&&<span style={{padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:600,background:"#eff6ff",color:"#2563eb"}}>{t[viewDocMod.type==="rent"?"rentContract":viewDocMod.type==="license"?"license":viewDocMod.type==="insurance"?"insurance":viewDocMod.type==="agreement"?"agreement":"otherDoc"]}</span>}
<span style={{fontSize:11,color:"#9ca3af",fontFamily:"var(--m)"}}>{viewDocMod.date}</span>
</div>
{viewDocMod.description&&<div style={{fontSize:13,color:"#6b7280",marginBottom:12,padding:10,background:"#f9fafb",borderRadius:8}}>{viewDocMod.description}</div>}
{viewDocMod.file?(viewDocMod.file.startsWith("data:image")?
<div style={{textAlign:"center"}}>
<img src={viewDocMod.file} style={{maxWidth:"100%",maxHeight:"60vh",borderRadius:12,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,.1)"}} alt=""/>
<div style={{marginTop:12}}><a href={viewDocMod.file} download={viewDocMod.fileName||"document.jpg"} style={{padding:"10px 24px",background:"#2563eb",color:"#fff",borderRadius:10,textDecoration:"none",fontSize:12,fontWeight:700}}>📥 {rtl?"تحميل الصورة":"Download Image"}</a></div>
</div>:
viewDocMod.file.startsWith("data:application/pdf")?
<div style={{textAlign:"center",padding:30}}>
<div style={{fontSize:48,marginBottom:8}}>📄</div>
<div style={{fontSize:14,fontWeight:600,marginBottom:12}}>{viewDocMod.fileName}</div>
<a href={viewDocMod.file} download={viewDocMod.fileName||"document.pdf"} style={{padding:"12px 28px",background:"#2563eb",color:"#fff",borderRadius:10,textDecoration:"none",fontSize:13,fontWeight:700}}>📥 {rtl?"تحميل PDF":"Download PDF"}</a>
</div>:
<div style={{textAlign:"center",padding:20}}><a href={viewDocMod.file} download={viewDocMod.fileName} style={{padding:"12px 24px",background:"#2563eb",color:"#fff",borderRadius:10,textDecoration:"none",fontSize:13,fontWeight:700}}>📥 {rtl?"تحميل":"Download"} {viewDocMod.fileName}</a></div>
):<div style={{textAlign:"center",padding:30,color:"#9ca3af"}}><div style={{fontSize:36}}>📄</div>{rtl?"لا يوجد ملف مرفق":"No file attached"}</div>}
</div></div>}

{/* ADD CONTRACT MODAL */}
{contractMod&&<div className="ov" onClick={()=>setContractMod(false)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>📄 {t.addContract}<button className="mc" onClick={()=>setContractMod(false)}>✕</button></h2>
<div className="pf"><label>{t.employee}</label><select value={newContract.user_id} onChange={e=>setNewContract({...newContract,user_id:+e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">{t.selProd}</option>{users.map(u=><option key={u.id} value={u.id}>{u.fn} ({u.un})</option>)}</select></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.contractType}</label><select value={newContract.contract_type} onChange={e=>setNewContract({...newContract,contract_type:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="full-time">{t.fullTime}</option><option value="part-time">{t.partTime}</option><option value="temporary">{t.temporary}</option><option value="probation">{t.probation}</option></select></div>
<div className="pf" style={{flex:1}}><label>{t.annualLeave}</label><input type="number" value={newContract.annual_leave_days} onChange={e=>setNewContract({...newContract,annual_leave_days:+e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.startDate}</label><input type="date" value={newContract.start_date} onChange={e=>setNewContract({...newContract,start_date:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.endDate}</label><input type="date" value={newContract.end_date} onChange={e=>setNewContract({...newContract,end_date:e.target.value})}/></div>
</div>
<div style={{fontSize:13,fontWeight:700,color:"#374151",margin:"8px 0"}}>💰 {t.salaries}</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.basicSalary} (JD)</label><input type="number" value={newContract.basic_salary} onChange={e=>setNewContract({...newContract,basic_salary:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.housingAllow}</label><input type="number" value={newContract.housing_allowance} onChange={e=>setNewContract({...newContract,housing_allowance:e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.transportAllow}</label><input type="number" value={newContract.transport_allowance} onChange={e=>setNewContract({...newContract,transport_allowance:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.otherAllow}</label><input type="number" value={newContract.other_allowance} onChange={e=>setNewContract({...newContract,other_allowance:e.target.value})}/></div>
</div>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}>
<div style={{fontSize:11,color:"#6b7280"}}>{t.totalSalary}</div>
<div style={{fontSize:22,fontWeight:800,color:"#059669",fontFamily:"var(--m)"}}>{fm((parseFloat(newContract.basic_salary)||0)+(parseFloat(newContract.housing_allowance)||0)+(parseFloat(newContract.transport_allowance)||0)+(parseFloat(newContract.other_allowance)||0))}</div>
</div>
<button className="cpb" onClick={async()=>{if(!newContract.user_id||!newContract.start_date||!newContract.basic_salary)return;const total=(parseFloat(newContract.basic_salary)||0)+(parseFloat(newContract.housing_allowance)||0)+(parseFloat(newContract.transport_allowance)||0)+(parseFloat(newContract.other_allowance)||0);const c={...newContract,basic_salary:parseFloat(newContract.basic_salary)||0,housing_allowance:parseFloat(newContract.housing_allowance)||0,transport_allowance:parseFloat(newContract.transport_allowance)||0,other_allowance:parseFloat(newContract.other_allowance)||0,total_salary:total,status:"active"};try{const r=await DB.addContract(c);if(r)setContracts(p=>[...p,r]);setContractMod(false);sT("✓ "+t.saved,"ok")}catch(e){console.error(e)}}} disabled={!newContract.user_id||!newContract.start_date||!newContract.basic_salary}>✓ {t.addContract}</button>
</div></div>}

{/* ADD SALARY MODAL */}
{salaryMod&&<div className="ov" onClick={()=>setSalaryMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>💰 {t.addSalary}<button className="mc" onClick={()=>setSalaryMod(false)}>✕</button></h2>
<div className="pf"><label>{t.employee}</label><select value={newSalary.user_id} onChange={e=>{const uid=+e.target.value;const ct=contracts.find(c=>c.user_id===uid&&c.status==="active");setNewSalary({...newSalary,user_id:uid,basic_salary:ct?ct.basic_salary:"",allowances:ct?(+ct.housing_allowance+ +ct.transport_allowance+ +ct.other_allowance):""})}} style={{fontFamily:"var(--f)"}}><option value="">{t.selProd}</option>{users.map(u=><option key={u.id} value={u.id}>{u.fn} ({u.un})</option>)}</select></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.payMonth}</label><select value={newSalary.month} onChange={e=>setNewSalary({...newSalary,month:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">--</option>{["01","02","03","04","05","06","07","08","09","10","11","12"].map(m=><option key={m} value={m}>{m}</option>)}</select></div>
<div className="pf" style={{flex:1}}><label>{t.payYear}</label><input type="number" value={newSalary.year} onChange={e=>setNewSalary({...newSalary,year:+e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.basicSalary}</label><input type="number" value={newSalary.basic_salary} onChange={e=>setNewSalary({...newSalary,basic_salary:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.deductions}</label><input type="number" value={newSalary.deductions} onChange={e=>setNewSalary({...newSalary,deductions:e.target.value})}/></div>
</div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.overtimeHrs}</label><input type="number" value={newSalary.overtime_hours} onChange={e=>setNewSalary({...newSalary,overtime_hours:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.bonus}</label><input type="number" value={newSalary.bonus} onChange={e=>setNewSalary({...newSalary,bonus:e.target.value})}/></div>
</div>
<div className="pf"><label>{t.payMethod}</label><select value={newSalary.payment_method} onChange={e=>setNewSalary({...newSalary,payment_method:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="bank">{t.bank}</option><option value="cash">{t.cash}</option><option value="check">{t.check}</option></select></div>
{(()=>{const bs=parseFloat(newSalary.basic_salary)||0;const al=parseFloat(newSalary.allowances)||0;const dd=parseFloat(newSalary.deductions)||0;const bn=parseFloat(newSalary.bonus)||0;const ot=parseFloat(newSalary.overtime_hours)||0;const otAmt=bs>0?+(ot*(bs/30/8)*1.5).toFixed(3):0;const net=bs+al-dd+bn+otAmt;return<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}><div style={{fontSize:11,color:"#6b7280"}}>{t.netSalary}</div><div style={{fontSize:24,fontWeight:800,color:"#059669",fontFamily:"var(--m)"}}>{fm(net)}</div></div>})()}
<button className="cpb cpb-green" onClick={async()=>{if(!newSalary.user_id||!newSalary.month)return;const bs=parseFloat(newSalary.basic_salary)||0;const al=parseFloat(newSalary.allowances)||0;const dd=parseFloat(newSalary.deductions)||0;const bn=parseFloat(newSalary.bonus)||0;const ot=parseFloat(newSalary.overtime_hours)||0;const otAmt=bs>0?+(ot*(bs/30/8)*1.5).toFixed(3):0;const net=bs+al-dd+bn+otAmt;const s={user_id:newSalary.user_id,month:newSalary.month,year:newSalary.year,basic_salary:bs,allowances:al,deductions:dd,overtime_hours:ot,overtime_amount:otAmt,bonus:bn,net_salary:net,payment_method:newSalary.payment_method,status:"pending",notes:newSalary.notes};try{const r=await DB.addSalary(s);if(r)setSalPayments(p=>[r,...p]);setSalaryMod(false);sT("✓ "+t.saved,"ok")}catch(e){console.error(e)}}} disabled={!newSalary.user_id||!newSalary.month}>📋 {t.addSalary} ({t.pending})</button>
<button style={{width:"100%",padding:14,background:"#059669",border:"none",borderRadius:"var(--r)",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",marginTop:8,opacity:(!newSalary.user_id||!newSalary.month)?".4":"1"}} onClick={async()=>{if(!newSalary.user_id||!newSalary.month)return;const bs=parseFloat(newSalary.basic_salary)||0;const al=parseFloat(newSalary.allowances)||0;const dd=parseFloat(newSalary.deductions)||0;const bn=parseFloat(newSalary.bonus)||0;const ot=parseFloat(newSalary.overtime_hours)||0;const otAmt=bs>0?+(ot*(bs/30/8)*1.5).toFixed(3):0;const net=bs+al-dd+bn+otAmt;const empUser=users.find(u2=>u2.id===newSalary.user_id);const empName=empUser?(rtl?(empUser.fa||empUser.fn):empUser.fn):"Employee";const s={user_id:newSalary.user_id,month:newSalary.month,year:newSalary.year,basic_salary:bs,allowances:al,deductions:dd,overtime_hours:ot,overtime_amount:otAmt,bonus:bn,net_salary:net,payment_method:newSalary.payment_method,status:"paid",payment_date:new Date().toISOString().slice(0,10),notes:newSalary.notes};try{const r=await DB.addSalary(s);if(r)setSalPayments(p=>[r,...p]);const salCat=expCats.find(c=>c.name==="Salaries")||expCats[0];if(salCat){const exp={category_id:salCat.id,amount:net,description:"Salary "+newSalary.month+"/"+newSalary.year+" — "+empName,payment_method:newSalary.payment_method||"bank",expense_date:new Date().toISOString().slice(0,10),recurring:"none",created_by:cu?.id};const er=await DB.addExpense(exp);if(er)setExpensesList(p=>[er,...p])}setSalaryMod(false);sT("✓ "+t.paid+" + "+t.expenses,"ok")}catch(e){console.error(e)}}} disabled={!newSalary.user_id||!newSalary.month}>💰 {t.markPaid} + {t.addExpense}</button>
</div></div>}

{/* ADD LEAVE MODAL */}
{leaveMod&&<div className="ov" onClick={()=>setLeaveMod(false)}><div className="md" onClick={e=>e.stopPropagation()}>
<h2>🏖️ {t.addLeave}<button className="mc" onClick={()=>setLeaveMod(false)}>✕</button></h2>
<div className="pf"><label>{t.employee}</label><select value={newLeave.user_id} onChange={e=>setNewLeave({...newLeave,user_id:+e.target.value})} style={{fontFamily:"var(--f)"}}><option value="">{t.selProd}</option>{users.map(u=><option key={u.id} value={u.id}>{u.fn} ({u.un})</option>)}</select></div>
<div className="pf"><label>{t.leaveType}</label><select value={newLeave.leave_type} onChange={e=>setNewLeave({...newLeave,leave_type:e.target.value})} style={{fontFamily:"var(--f)"}}><option value="annual">{t.annual}</option><option value="sick">{t.sick}</option><option value="unpaid">{t.unpaid}</option><option value="emergency">{t.emergency}</option><option value="other">{t.otherLeave}</option></select></div>
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.startDate}</label><input type="date" value={newLeave.start_date} onChange={e=>setNewLeave({...newLeave,start_date:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.endDate}</label><input type="date" value={newLeave.end_date} onChange={e=>setNewLeave({...newLeave,end_date:e.target.value})}/></div>
</div>
{newLeave.start_date&&newLeave.end_date&&<div style={{background:"#eff6ff",borderRadius:10,padding:8,textAlign:"center",marginBottom:8,fontSize:14,fontWeight:700,color:"#2563eb"}}>{Math.max(1,Math.ceil((new Date(newLeave.end_date)-new Date(newLeave.start_date))/86400000)+1)} {t.leaveDays}</div>}
<div className="pf"><label>{t.leaveReason}</label><input value={newLeave.reason} onChange={e=>setNewLeave({...newLeave,reason:e.target.value})}/></div>
<button className="cpb" onClick={async()=>{if(!newLeave.user_id||!newLeave.start_date||!newLeave.end_date)return;const days=Math.max(1,Math.ceil((new Date(newLeave.end_date)-new Date(newLeave.start_date))/86400000)+1);const l={...newLeave,days,status:"pending"};try{const r=await DB.addLeave(l);if(r)setLeaveReqs(p=>[r,...p]);setLeaveMod(false);sT("✓ "+t.saved,"ok")}catch(e){console.error(e)}}} disabled={!newLeave.user_id||!newLeave.start_date||!newLeave.end_date}>✓ {t.addLeave}</button>
</div></div>}

{/* EDIT USER MODAL — PROFILE + PERMISSIONS */}
{editUserMod&&editUserData&&<div className="ov" onClick={()=>setEditUserMod(null)}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:520}}>
<h2>✎ {t.editUser} — {editUserMod.un}<button className="mc" onClick={()=>setEditUserMod(null)}>✕</button></h2>

{/* Avatar Upload */}
<div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
<div style={{width:80,height:80,borderRadius:"50%",overflow:"hidden",border:"3px solid #e5e7eb",background:"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",position:"relative"}} onClick={()=>document.getElementById("avatar-upload-"+editUserMod.id)?.click()}>
{editUserData.avatar?<img src={editUserData.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:36,color:"#9ca3af"}}>{(editUserData.fn||"?").charAt(0)}</span>}
<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,.5)",color:"#fff",fontSize:9,textAlign:"center",padding:"3px 0"}}>📷</div>
</div>
<input id={"avatar-upload-"+editUserMod.id} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>500000){sT("✗ Max 500KB","err");return}const r=new FileReader();r.onload=ev=>{const img=new Image();img.onload=()=>{const c=document.createElement("canvas");const sz=150;c.width=sz;c.height=sz;const ctx=c.getContext("2d");const mn=Math.min(img.width,img.height);const sx=(img.width-mn)/2;const sy=(img.height-mn)/2;ctx.drawImage(img,sx,sy,mn,mn,0,0,sz,sz);setEditUserData({...editUserData,avatar:c.toDataURL("image/jpeg",0.7)})};img.src=ev.target.result};r.readAsDataURL(f)}}/>
<div>
<div style={{fontSize:13,fontWeight:700,color:"#374151"}}>{rtl?"صورة الموظف":"Employee Photo"}</div>
<div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{rtl?"انقر للتغيير · 500KB حد أقصى":"Click to change · 500KB max"}</div>
{editUserData.avatar&&<button onClick={()=>setEditUserData({...editUserData,avatar:null})} style={{marginTop:6,padding:"3px 10px",background:"#fef2f2",border:"none",borderRadius:6,color:"#dc2626",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>✕ {rtl?"إزالة الصورة":"Remove photo"}</button>}
</div>
</div>

{/* Profile fields */}
<div style={{display:"flex",gap:8}}>
<div className="pf" style={{flex:1}}><label>{t.name} (EN)</label><input value={editUserData.fn} onChange={e=>setEditUserData({...editUserData,fn:e.target.value})}/></div>
<div className="pf" style={{flex:1}}><label>{t.name} (AR)</label><input value={editUserData.fa} onChange={e=>setEditUserData({...editUserData,fa:e.target.value})} style={{direction:"rtl"}}/></div>
</div>
<div className="pf"><label>{t.role}</label><select value={editUserData.role} onChange={e=>{const r=e.target.value;const dp=r==="admin"?{pos:true,dashboard:true,inventory:true,purchases:true,sales_view:true,users:true,loyalty:true,settings:true,excel_export:true}:r==="manager"?{pos:true,dashboard:true,inventory:true,purchases:true,sales_view:true,users:false,loyalty:true,settings:false,excel_export:true}:{pos:true,dashboard:false,inventory:false,purchases:false,sales_view:false,users:false,loyalty:false,settings:false,excel_export:false};setEditUserData({...editUserData,role:r,perms:dp})}} style={{fontFamily:"var(--f)"}}><option value="cashier">{t.cashier}</option><option value="manager">{t.manager}</option><option value="admin">{t.adminR}</option></select></div>

{/* Permissions toggles */}
<div style={{marginTop:12,marginBottom:16}}>
<div style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:10}}>🔐 {t.permissions}</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
{PERM_KEYS.map(pk=><label key={pk.k} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:editUserData.perms?.[pk.k]?"#ecfdf5":"#f9fafb",border:"1.5px solid "+(editUserData.perms?.[pk.k]?"#d1fae5":"#e5e7eb"),borderRadius:10,cursor:"pointer",transition:"all .15s"}}>
<input type="checkbox" checked={!!editUserData.perms?.[pk.k]} onChange={e=>{const np={...editUserData.perms,[pk.k]:e.target.checked};setEditUserData({...editUserData,perms:np})}} style={{width:16,height:16,accentColor:"#059669"}}/>
<span style={{fontSize:12,fontWeight:editUserData.perms?.[pk.k]?600:400,color:editUserData.perms?.[pk.k]?"#059669":"#6b7280"}}>{pk.i} {t[PERM_LABELS[pk.k]]}</span>
</label>)}
</div>
{/* Quick select buttons */}
<div style={{display:"flex",gap:6,marginTop:8}}>
<button onClick={()=>{const all={};PERM_KEYS.forEach(pk=>{all[pk.k]=true});setEditUserData({...editUserData,perms:all})}} style={{padding:"4px 12px",background:"#ecfdf5",border:"1px solid #d1fae5",borderRadius:6,color:"#059669",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>{rtl?"تحديد الكل":"Select All"}</button>
<button onClick={()=>{const none={};PERM_KEYS.forEach(pk=>{none[pk.k]=pk.k==="pos"});setEditUserData({...editUserData,perms:none})}} style={{padding:"4px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,color:"#dc2626",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"var(--f)"}}>{rtl?"إلغاء الكل":"Clear All"}</button>
</div>
</div>

<button className="cpb" onClick={async()=>{
  const updates={full_name:editUserData.fn,full_name_ar:editUserData.fa,role:editUserData.role,permissions:editUserData.perms,avatar:editUserData.avatar};
  setUsers(p=>p.map(u=>u.id===editUserMod.id?{...u,fn:editUserData.fn,fa:editUserData.fa,role:editUserData.role,perms:editUserData.perms,avatar:editUserData.avatar}:u));
  if(cu.id===editUserMod.id)setCU(prev=>({...prev,fn:editUserData.fn,fa:editUserData.fa,role:editUserData.role,perms:editUserData.perms,avatar:editUserData.avatar}));
  setEditUserMod(null);setEditUserData(null);
  sT("✓ "+t.saved,"ok");
  try{await DB.updateUser(editUserMod.id,updates)}catch(e){console.error(e)}
}}>✓ {t.savePerms}</button>
</div></div>}

{/* VENDOR PRODUCTS MODAL — Full edit/filter/sort */}
{venProdMod&&(()=>{
const f=venProdSearch.toLowerCase().trim();
let list=prods.filter(p=>p.supplier===venProdMod);
if(f)list=list.filter(p=>p.bc.toLowerCase().includes(f)||p.n.toLowerCase().includes(f)||(p.a||"").toLowerCase().includes(f)||(p.cat||"").toLowerCase().includes(f));
if(venProdSort.k){const dir=venProdSort.d==="asc"?1:-1;list=[...list].sort((a,b)=>{let av,bv;if(["bc","n","cat"].includes(venProdSort.k)){av=(a[venProdSort.k]||"").toString().toLowerCase();bv=(b[venProdSort.k]||"").toString().toLowerCase()}else if(venProdSort.k==="margin"){av=a.p-a.c;bv=b.p-b.c}else{av=+a[venProdSort.k]||0;bv=+b[venProdSort.k]||0}return av<bv?-1*dir:av>bv?1*dir:0})}
const sortBy=(k)=>setVenProdSort(p=>p.k===k?{k,d:p.d==="asc"?"desc":"asc"}:{k,d:"asc"});
const ic=(k)=>venProdSort.k===k?(venProdSort.d==="asc"?" ▲":" ▼"):"";
const editCnt=Object.keys(venProdEdits).length;
const totalValue=list.reduce((s,p)=>s+p.s*p.c,0);
const totalRetail=list.reduce((s,p)=>s+p.s*p.p,0);
const saveAll=async()=>{
  if(editCnt===0)return;
  if(!confirm((rtl?"حفظ ":"Save ")+editCnt+(rtl?" تعديل؟":" changes?")))return;
  let ok=0;
  for(const id of Object.keys(venProdEdits)){
    const ed=venProdEdits[id];const p=prods.find(x=>x.id===id);if(!p)continue;
    const upd={updated_at:new Date().toISOString()};
    if(ed.c!==undefined)upd.cost=parseFloat(ed.c)||0;
    if(ed.p!==undefined)upd.price=parseFloat(ed.p)||0;
    if(ed.s!==undefined)upd.stock=parseInt(ed.s)||0;
    if(ed.exp!==undefined)upd.expiry_date=ed.exp||null;
    if(ed.n!==undefined)upd.name=ed.n;
    if(ed.a!==undefined)upd.name_ar=ed.a;
    try{await sb.from("products").update(upd).eq("id",id);ok++}catch(e){console.error(e)}
  }
  try{const np=await DB.getProducts();const supMap={};prods.forEach(x=>{if(x.supplier)supMap[x.id]=x.supplier});setProds(np.map(pr=>({...pr,supplier:pr.supplier||supMap[pr.id]||""})))}catch{}
  setVenProdEdits({});
  sT("✓ "+ok+" "+(rtl?"محفوظ":"saved"),"ok");
};
return<div className="ov" onClick={()=>{if(editCnt===0||confirm(rtl?"إغلاق دون حفظ؟":"Close without saving?"))setVenProdMod(null)}}><div className="md" onClick={e=>e.stopPropagation()} style={{maxWidth:"95vw",width:1200,maxHeight:"92vh",overflowY:"auto"}}>
<h2>🏭 {rtl?"منتجات المورد":"Vendor Products"}: <span style={{color:"#2563eb"}}>{venProdMod}</span><button className="mc" onClick={()=>{if(editCnt===0||confirm(rtl?"إغلاق دون حفظ؟":"Close without saving?"))setVenProdMod(null)}}>✕</button></h2>

{/* Stats */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
<div style={{background:"#eff6ff",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#1e40af"}}>{rtl?"عدد المنتجات":"Products"}</div><div style={{fontSize:22,fontWeight:800,fontFamily:"var(--m)",color:"#2563eb"}}>{list.length}</div></div>
<div style={{background:"#ecfdf5",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#065f46"}}>{rtl?"إجمالي المخزون":"Total Stock"}</div><div style={{fontSize:22,fontWeight:800,fontFamily:"var(--m)",color:"#059669"}}>{list.reduce((s,p)=>s+p.s,0)}</div></div>
<div style={{background:"#fffbeb",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#92400e"}}>{rtl?"قيمة التكلفة":"Cost Value"}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#d97706"}}>{fm(totalValue)}</div></div>
<div style={{background:"#f5f3ff",borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:10,color:"#5b21b6"}}>{rtl?"قيمة البيع":"Retail Value"}</div><div style={{fontSize:18,fontWeight:800,fontFamily:"var(--m)",color:"#7c3aed"}}>{fm(totalRetail)}</div></div>
</div>

{/* Search + Save bar */}
<div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
<input value={venProdSearch} onChange={e=>setVenProdSearch(e.target.value)} placeholder={rtl?"🔍 بحث في المنتجات...":"🔍 Search products..."} style={{flex:1,padding:"10px 14px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:13,outline:"none",fontFamily:"var(--f)"}}/>
<div style={{fontSize:11,color:"#6b7280"}}>{list.length} {rtl?"منتج":"products"}</div>
{editCnt>0&&<><span style={{fontSize:12,color:"#d97706",fontWeight:700}}>✏ {editCnt}</span><button onClick={()=>setVenProdEdits({})} style={{padding:"8px 14px",background:"#f3f4f6",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)",color:"#6b7280"}}>↺ {rtl?"إلغاء":"Cancel"}</button><button onClick={saveAll} style={{padding:"8px 18px",background:"#059669",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"var(--f)"}}>💾 {rtl?"حفظ الكل":"Save All"} ({editCnt})</button></>}
<button onClick={()=>{const csv=["Barcode,Name,NameAR,Category,Cost,Price,Margin,MarginPct,Stock,Expiry"];list.forEach(p=>{const mg=p.p-p.c;const mgp=p.c>0?((p.p-p.c)/p.c*100).toFixed(1):0;csv.push('"'+p.bc+'","'+p.n+'","'+(p.a||"")+'","'+(p.cat||"")+'",'+p.c+","+p.p+","+mg.toFixed(3)+","+mgp+","+p.s+',"'+(p.exp||"")+'"')});const b=new Blob([csv.join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=venProdMod+"-products.csv";a.click()}} style={{padding:"8px 14px",background:"#2563eb",border:"none",borderRadius:8,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"var(--f)"}}>📥 CSV</button>
</div>

<div style={{overflowX:"auto",maxHeight:"55vh",overflowY:"auto"}}><table className="at" style={{minWidth:1100}}><thead style={{position:"sticky",top:0,background:"#f9fafb",zIndex:1}}><tr>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("bc")}>{t.bc}{ic("bc")}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("n")}>{rtl?"الاسم EN":"Name EN"}{ic("n")}</th>
<th>{rtl?"الاسم AR":"Name AR"}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("cat")}>{t.cat}{ic("cat")}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("c")}>{t.cost}{ic("c")}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("p")}>{t.price}{ic("p")}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("margin")}>{t.margin}{ic("margin")}</th>
<th style={{cursor:"pointer"}} onClick={()=>sortBy("s")}>{t.stock}{ic("s")}</th>
<th>{t.expiryDate}</th>
<th>{t.act}</th>
</tr></thead>
<tbody>{list.map(p=>{
const ed=venProdEdits[p.id]||{};
const ec=ed.c!==undefined?(parseFloat(ed.c)||0):p.c;
const ep=ed.p!==undefined?(parseFloat(ed.p)||0):p.p;
const mg=ep-ec;const mgp=ec>0?((ep-ec)/ec*100):0;
const upd=(k,v)=>setVenProdEdits(prev=>({...prev,[p.id]:{...prev[p.id],[k]:v}}));
return<tr key={p.id}>
<td style={{fontFamily:"var(--m)",fontSize:10}}>{p.bc}</td>
<td><input value={ed.n!==undefined?ed.n:p.n} onChange={e=>upd("n",e.target.value)} style={{width:140,padding:"5px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,fontWeight:600,outline:"none",background:ed.n!==undefined?"#fef3c7":"#fff"}}/></td>
<td><input value={ed.a!==undefined?ed.a:(p.a||"")} onChange={e=>upd("a",e.target.value)} style={{width:140,padding:"5px 8px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none",direction:"rtl",background:ed.a!==undefined?"#fef3c7":"#fff"}}/></td>
<td style={{fontSize:10,color:"#6b7280"}}>{p.cat}</td>
<td><input type="number" step="0.001" value={ed.c!==undefined?ed.c:p.c} onChange={e=>upd("c",e.target.value)} style={{width:75,padding:"5px 6px",border:"1.5px solid #fca5a5",borderRadius:6,fontFamily:"var(--m)",fontSize:11,outline:"none",textAlign:"center",background:ed.c!==undefined?"#fef2f2":"#fff"}}/></td>
<td><input type="number" step="0.001" value={ed.p!==undefined?ed.p:p.p} onChange={e=>upd("p",e.target.value)} style={{width:75,padding:"5px 6px",border:"1.5px solid #86efac",borderRadius:6,fontFamily:"var(--m)",fontSize:11,outline:"none",textAlign:"center",background:ed.p!==undefined?"#ecfdf5":"#fff",fontWeight:700}}/></td>
<td><div style={{textAlign:"center"}}><div style={{fontFamily:"var(--m)",fontWeight:700,fontSize:11,color:mg>0?"#059669":"#dc2626"}}>{fN(mg)}</div><div style={{fontSize:9,fontFamily:"var(--m)",color:mgp>=30?"#059669":mgp>=15?"#d97706":"#dc2626"}}>{mgp.toFixed(1)}%</div></div></td>
<td><input type="number" value={ed.s!==undefined?ed.s:p.s} onChange={e=>upd("s",e.target.value)} style={{width:60,padding:"5px 6px",border:"1.5px solid #93c5fd",borderRadius:6,fontFamily:"var(--m)",fontSize:11,outline:"none",textAlign:"center",background:ed.s!==undefined?"#eff6ff":"#fff"}}/></td>
<td><input type="date" value={ed.exp!==undefined?ed.exp:(p.exp||"")} onChange={e=>upd("exp",e.target.value)} style={{width:120,padding:"4px 6px",border:"1px solid #e5e7eb",borderRadius:6,fontFamily:"var(--m)",fontSize:10,outline:"none",background:ed.exp!==undefined?"#fef3c7":"#fff"}}/></td>
<td><button className="ab ab-d" style={{fontSize:9}} onClick={async()=>{if(!confirm(rtl?"حذف المنتج؟":"Delete product?"))return;setProds(p2=>p2.filter(x=>x.id!==p.id));try{await DB.deleteProduct(p.id)}catch{}}}>✕</button></td>
</tr>})}{list.length===0&&<tr><td colSpan="10" style={{textAlign:"center",padding:30,color:"#9ca3af"}}>{rtl?"لا منتجات لهذا المورد":"No products for this vendor"}</td></tr>}</tbody></table></div>

<div style={{marginTop:12,fontSize:11,color:"#6b7280",background:"#f9fafb",padding:12,borderRadius:10}}>💡 {rtl?"عدّل أي حقل (يصبح ملوّن)، اضغط على رؤوس الأعمدة للترتيب، ثم احفظ الكل دفعة واحدة":"Edit any field (turns colored), click column headers to sort, then Save All in bulk"}</div>
</div></div>})()}

{toast&&<div className={"toast toast-"+toast.ty}>{toast.m}</div>}
{tab==="sale"&&<div className="bci" style={{cursor:"pointer"}} onClick={()=>sT("F1=Sale F2=Barcode F3=Camera F5=Cash F6=Visa F7=CliQ F4=Hold Del=Clear Esc=Close","ok")}><span className="bcd"/> ⌨️ {t.ready} · F1-F9</div>}
</div></>);
}
