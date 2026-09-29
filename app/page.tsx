"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Boxes, ChartNoAxesCombined, Download, FileSpreadsheet, LayoutDashboard, PackageCheck, Plus, RotateCcw, ShoppingBag } from "lucide-react";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster, toast } from "sonner";

type Kind = "receipt" | "sale" | "return";
type Product = { id: number; name: string; default_cost: number; default_price: number };
type Movement = { id: number; kind: Kind; product_id: number; product_name: string; sale_id: number | null; quantity: number; unit_cost: number; unit_price: number; store: string; occurred_on: string; note: string };
type Ledger = { products: Product[]; movements: Movement[] };
type Section = "overview" | "receive" | "sales" | "returns" | "budget" | "reports";
const sections: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "receive", label: "استلام المنتجات", icon: Boxes },
  { id: "sales", label: "صفحة البيع", icon: ShoppingBag },
  { id: "returns", label: "المسترجعات", icon: RotateCcw },
  { id: "budget", label: "الميزانية والأرباح", icon: ChartNoAxesCombined },
  { id: "reports", label: "التقارير", icon: FileSpreadsheet },
];
const empty: Ledger = { products: [], movements: [] };
const dateToday = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-"); };
const dateMonthStart = () => dateToday().slice(0,7) + "-01";
const money = (milli: number) => new Intl.NumberFormat("ar", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(milli / 1000);
const moneyInput = (value: string) => { const v = value.trim().replace(",", "."); return /^\d+(\.\d{1,3})?$/.test(v) ? Math.round(Number(v) * 1000) : NaN; };
const kindName: Record<Kind,string> = { receipt: "استلام", sale: "بيع", return: "مسترجع" };

function Field({ label, children, hint }: {label:string; children:ReactNode; hint?:string}) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function SummaryCard({label,value,note}: {label:string;value:string;note:string}) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}
function MovementTable({rows,emptyText}: {rows:Movement[];emptyText:string}) {
  if (!rows.length) return <div className="empty-state">{emptyText}</div>;
  return <Table className="ledger-table"><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>العملية</TableHead><TableHead>المنتج</TableHead><TableHead>المتجر</TableHead><TableHead>الكمية</TableHead><TableHead>القيمة</TableHead></TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.id}><TableCell>{row.occurred_on}</TableCell><TableCell><span className={"kind-pill " + row.kind}>{kindName[row.kind]}</span></TableCell><TableCell className="strong-cell">{row.product_name}</TableCell><TableCell>{row.store || "—"}</TableCell><TableCell>{row.quantity}</TableCell><TableCell>{money(row.quantity * (row.kind === "receipt" ? row.unit_cost : row.unit_price))}</TableCell></TableRow>)}</TableBody></Table>;
}
function totals(rows: Movement[]) {
  const received = rows.filter(r=>r.kind==="receipt").reduce((s,r)=>s+r.quantity,0);
  const sold = rows.filter(r=>r.kind==="sale").reduce((s,r)=>s+r.quantity,0);
  const returned = rows.filter(r=>r.kind==="return").reduce((s,r)=>s+r.quantity,0);
  const purchases = rows.filter(r=>r.kind==="receipt").reduce((s,r)=>s+r.quantity*r.unit_cost,0);
  const grossSales = rows.filter(r=>r.kind==="sale").reduce((s,r)=>s+r.quantity*r.unit_price,0);
  const refunds = rows.filter(r=>r.kind==="return").reduce((s,r)=>s+r.quantity*r.unit_price,0);
  const costOfSales = rows.filter(r=>r.kind==="sale").reduce((s,r)=>s+r.quantity*r.unit_cost,0) - rows.filter(r=>r.kind==="return").reduce((s,r)=>s+r.quantity*r.unit_cost,0);
  return { received, sold, returned, purchases, grossSales, refunds, netSales: grossSales-refunds, costOfSales, profit: grossSales-refunds-costOfSales };
}

export default function Home() {
  const [section,setSection] = useState<Section>("overview");
  const [ledger,setLedger] = useState<Ledger>(empty);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState("");
  const [busy,setBusy] = useState(false);
  const [receipt,setReceipt] = useState({ productId:"new", name:"", quantity:"", cost:"", price:"", date:dateToday(), note:"" });
  const [sale,setSale] = useState({ productId:"", store:"", quantity:"", price:"", date:dateToday(), note:"" });
  const [returned,setReturned] = useState({ saleId:"", quantity:"", date:dateToday(), note:"" });
  const [from,setFrom] = useState(dateMonthStart());
  const [to,setTo] = useState(dateToday());

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch("/api/ledger", { cache:"no-store" });
      const data = await response.json() as Ledger & { error?: string };
      if (!response.ok) throw new Error(data.error || "تعذر تحميل البيانات.");
      setLedger(data as Ledger);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "تعذر تحميل البيانات."); }
    finally { setLoading(false); }
  },[]);
  useEffect(() => { void load(); }, [load]);

  const save = async (payload: Record<string,unknown>) => {
    setBusy(true);
    try {
      const response = await fetch("/api/ledger", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const data = await response.json() as Ledger & { error?: string };
      if (!response.ok) throw new Error(data.error || "تعذر حفظ العملية.");
      await load();
      toast.success("تم حفظ العملية بنجاح");
      return true;
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "تعذر حفظ العملية."); return false; }
    finally { setBusy(false); }
  };
  const onReceipt = async (event:FormEvent) => {
    event.preventDefault();
    const unitCost = moneyInput(receipt.cost), unitPrice = moneyInput(receipt.price);
    if (!Number.isFinite(unitCost) || !Number.isFinite(unitPrice)) return toast.error("أدخل التكلفة والسعر حتى ٣ خانات عشرية.");
    if (await save({ kind:"receipt", productId:receipt.productId==="new"?0:Number(receipt.productId), name:receipt.name, quantity:Number(receipt.quantity), unitCost, unitPrice, occurredOn:receipt.date, note:receipt.note })) {
      setReceipt({productId:"new",name:"",quantity:"",cost:"",price:"",date:dateToday(),note:""});
    }
  };
  const onSale = async (event:FormEvent) => {
    event.preventDefault();
    const unitPrice = moneyInput(sale.price);
    if (!Number.isFinite(unitPrice)) return toast.error("أدخل سعر بيع صحيحًا حتى ٣ خانات عشرية.");
    if (await save({ kind:"sale", productId:Number(sale.productId), store:sale.store, quantity:Number(sale.quantity), unitPrice, occurredOn:sale.date, note:sale.note })) {
      setSale({productId:"",store:sale.store,quantity:"",price:"",date:dateToday(),note:""});
    }
  };
  const onReturn = async (event:FormEvent) => {
    event.preventDefault();
    if (await save({ kind:"return", saleId:Number(returned.saleId), quantity:Number(returned.quantity), occurredOn:returned.date, note:returned.note })) {
      setReturned({saleId:"",quantity:"",date:dateToday(),note:""});
    }
  };

  const stats = useMemo(()=>totals(ledger.movements),[ledger.movements]);
  const stock = useMemo(()=>{
    const counts = new Map<number,number>();
    for (const r of ledger.movements) counts.set(r.product_id,(counts.get(r.product_id)||0)+(r.kind==="sale"?-r.quantity:r.quantity));
    return counts;
  },[ledger.movements]);
  const stockCount = [...stock.values()].reduce((a,b)=>a+b,0);
  const stockValue = ledger.products.reduce((s,p)=>s+(stock.get(p.id)||0)*p.default_cost,0);
  const saleOptions = ledger.movements.filter(r=>r.kind==="sale").map(r=>({ ...r, remaining:r.quantity-ledger.movements.filter(x=>x.kind==="return"&&x.sale_id===r.id).reduce((s,x)=>s+x.quantity,0) })).filter(r=>r.remaining>0);
  const selectedSale = saleOptions.find(r=>String(r.id)===returned.saleId);
  const selectedProduct = ledger.products.find(p=>String(p.id)===sale.productId);
  const periodRows = ledger.movements.filter(r=>r.occurred_on>=from && r.occurred_on<=to);
  const period = totals(periodRows);
  const active = sections.find(x=>x.id===section)!;
  const submitDisabled = busy || loading || !!loadError;
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: Record<string,unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name:"read_inventory", title:"عرض المخزون",
        description:"يعرض المنتجات وكمياتها المتوفرة وسعر البيع المسجل لكل منتج.",
        inputSchema:{type:"object",properties:{},additionalProperties:false},
        annotations:{readOnlyHint:true},
        execute:() => ledger.products.map(p=>({id:p.id,name:p.name,available:stock.get(p.id)||0,price:p.default_price/1000})),
      },{signal:lifecycle.signal});
      await context.registerTool({
        name:"record_sale", title:"تسجيل بيع",
        description:"يسجل بيع كمية من منتج متوفر لمتجر ويحدث المخزون الظاهر.",
        inputSchema:{type:"object",properties:{productId:{type:"integer",minimum:1},quantity:{type:"integer",minimum:1},store:{type:"string",minLength:1},unitPrice:{type:"number",minimum:0},occurredOn:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"}},required:["productId","quantity","store","unitPrice","occurredOn"],additionalProperties:false},
        annotations:{readOnlyHint:false},
        execute:async (input:unknown) => {
          const value=input as {productId:number;quantity:number;store:string;unitPrice:number;occurredOn:string};
          if (!Number.isSafeInteger(value.productId)||!Number.isSafeInteger(value.quantity)||value.quantity<1||!value.store?.trim()||!Number.isFinite(value.unitPrice)) throw new Error("بيانات البيع غير صالحة.");
          const response=await fetch("/api/ledger",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"sale",productId:value.productId,quantity:value.quantity,store:value.store,unitPrice:Math.round(value.unitPrice*1000),occurredOn:value.occurredOn})});
          const data=await response.json() as {error?:string};
          if (!response.ok) throw new Error(data.error||"تعذر تسجيل البيع.");
          await load();
          return {saved:true,productId:value.productId,quantity:value.quantity};
        },
      },{signal:lifecycle.signal});
    };
    void register().catch(()=>{});
    return ()=>lifecycle.abort();
  },[ledger.products,stock,load]);
  const exportExcel = async () => {
    if (from>to) return toast.error("تاريخ البداية يجب أن يسبق تاريخ النهاية.");
    try {
      const { downloadReport } = await import("@/lib/export-xlsx");
      downloadReport(periodRows, period, from, to);
      toast.success("تم تجهيز ملف Excel");
    } catch { toast.error("تعذر إنشاء ملف Excel."); }
  };

  return <SidebarProvider className="app-shell" dir="rtl">
    <Sidebar side="right" collapsible="none" className="sidebar">
      <div className="brand"><span className="brand-mark"><PackageCheck size={24}/></span><span><strong>دفتر المبيعات</strong><small>إدارة المخزون والحسابات</small></span></div>
      <Tabs value={section} onValueChange={v=>setSection(v as Section)} className="nav-tabs"><TabsList className="nav-list" aria-label="القائمة الرئيسية">{sections.map(({id,label,icon:Icon})=><TabsTrigger key={id} value={id} className={"nav-link " + (section===id?"active":"")}><Icon size={19}/><span>{label}</span></TabsTrigger>)}</TabsList></Tabs>
      <div className="sidebar-foot">كل أرقامك في مكان واحد</div>
    </Sidebar>
    <main className="main-content">
      <header className="topbar"><div className="mobile-brand">دفتر المبيعات</div><div className="topbar-date">إدارة يومية واضحة لمبيعاتك</div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><span className="eyebrow">لوحة العمل</span><h1>{active.label}</h1><p>{section==="reports"?"حدد المدة لمراجعة كل حركة خلال الفترة.":section==="sales"?"سجل الكمية المباعة واسم المتجر.":section==="returns"?"اربط كل مسترجع بعملية البيع الأصلية.":section==="budget"?"تابع تكاليف البضاعة والمبيعات وصافي الربح.":"تابع المنتجات والكميات والمبالغ بسهولة."}</p></div>{section==="overview"&&<button className="primary-button" onClick={()=>setSection("receive")}><Plus size={18}/> إضافة استلام</button>}</div>
        {loadError && <div className="error-banner" role="alert">{loadError} <button onClick={()=>void load()}>إعادة المحاولة</button></div>}
        {loading && !loadError ? <div className="workspace-panel">جارٍ تحميل بياناتك…</div> : <>
        {section==="overview" && <>
          <div className="stats-grid"><SummaryCard label="المتوفر في المخزون" value={String(stockCount)} note="قطعة جاهزة للبيع"/><SummaryCard label="صافي المبيعات" value={money(stats.netSales)} note="بعد خصم المسترجعات"/><SummaryCard label="صافي الربح" value={money(stats.profit)} note="المبيعات ناقص تكلفة المباع"/><SummaryCard label="المسترجعات" value={String(stats.returned)} note="قطعة مسترجعة"/></div>
          <section className="workspace-panel"><div className="panel-head"><div><span className="eyebrow">المخزون</span><h2>المنتجات المتوفرة</h2></div><Boxes size={24}/></div>{ledger.products.length?<Table className="ledger-table"><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>المتوفر</TableHead><TableHead>تكلفة الوحدة</TableHead><TableHead>سعر البيع</TableHead></TableRow></TableHeader><TableBody>{ledger.products.map(p=><TableRow key={p.id}><TableCell className="strong-cell">{p.name}</TableCell><TableCell>{stock.get(p.id)||0}</TableCell><TableCell>{money(p.default_cost)}</TableCell><TableCell>{money(p.default_price)}</TableCell></TableRow>)}</TableBody></Table>:<div className="empty-state">لا توجد منتجات بعد. ابدأ بتسجيل أول استلام.</div>}</section>
          <section className="workspace-panel gap-top"><div className="panel-head"><h2>آخر العمليات</h2></div><MovementTable rows={ledger.movements.slice(0,6)} emptyText="ستظهر عمليات الاستلام والبيع والمسترجعات هنا."/></section>
        </>}
        {section==="receive" && <div className="two-column"><section className="workspace-panel"><div className="panel-head"><h2>تسجيل استلام</h2><PackageCheck size={24}/></div><form className="entry-form" onSubmit={onReceipt}>
          <Field label="المنتج"><Select value={receipt.productId} onValueChange={v=>{const p=ledger.products.find(x=>String(x.id)===v);setReceipt(r=>({...r,productId:v,name:"",cost:p?String(p.default_cost/1000):"",price:p?String(p.default_price/1000):""}));}}><SelectTrigger className="select-control"><SelectValue placeholder="اختر المنتج"/></SelectTrigger><SelectContent><SelectItem value="new">+ منتج جديد</SelectItem>{ledger.products.map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
          {receipt.productId==="new"&&<Field label="اسم المنتج"><input required maxLength={100} value={receipt.name} onChange={e=>setReceipt({...receipt,name:e.target.value})} placeholder="مثال: قميص أسود"/></Field>}
          <div className="form-grid"><Field label="الكمية المستلمة"><input type="number" required min="1" step="1" value={receipt.quantity} onChange={e=>setReceipt({...receipt,quantity:e.target.value})}/></Field><Field label="تاريخ الاستلام"><input type="date" required value={receipt.date} onChange={e=>setReceipt({...receipt,date:e.target.value})}/></Field></div>
          <div className="form-grid"><Field label="تكلفة الوحدة" hint="حتى ٣ خانات عشرية"><input type="number" required min="0" step="0.001" value={receipt.cost} onChange={e=>setReceipt({...receipt,cost:e.target.value})}/></Field><Field label="سعر البيع المقترح"><input type="number" required min="0" step="0.001" value={receipt.price} onChange={e=>setReceipt({...receipt,price:e.target.value})}/></Field></div>
          <Field label="ملاحظة (اختياري)"><input maxLength={300} value={receipt.note} onChange={e=>setReceipt({...receipt,note:e.target.value})} placeholder="رقم الفاتورة أو تفاصيل أخرى"/></Field><button className="primary-button full" disabled={submitDisabled}>حفظ الاستلام</button>
        </form></section><section className="workspace-panel"><div className="panel-head"><h2>سجل الاستلام</h2></div><MovementTable rows={ledger.movements.filter(r=>r.kind==="receipt")} emptyText="لم تسجل أي منتجات مستلمة بعد."/></section></div>}
        {section==="sales" && <div className="two-column"><section className="workspace-panel"><div className="panel-head"><h2>عملية بيع جديدة</h2><ShoppingBag size={24}/></div><form className="entry-form" onSubmit={onSale}>
          <Field label="المنتج"><Select value={sale.productId} onValueChange={v=>{const p=ledger.products.find(x=>String(x.id)===v);setSale(s=>({...s,productId:v,price:p?String(p.default_price/1000):""}));}}><SelectTrigger className="select-control"><SelectValue placeholder="اختر منتجًا من المستلم"/></SelectTrigger><SelectContent>{ledger.products.filter(p=>(stock.get(p.id)||0)>0).map(p=><SelectItem key={p.id} value={String(p.id)}>{p.name} — المتوفر {stock.get(p.id)||0}</SelectItem>)}</SelectContent></Select></Field>
          {selectedProduct&&<div className="info-strip">المتوفر الآن: <strong>{stock.get(selectedProduct.id)||0} قطعة</strong></div>}
          <Field label="اسم المتجر"><input required maxLength={100} value={sale.store} onChange={e=>setSale({...sale,store:e.target.value})} placeholder="المتجر الذي تم البيع فيه"/></Field>
          <div className="form-grid"><Field label="الكمية المباعة"><input type="number" required min="1" max={selectedProduct?stock.get(selectedProduct.id):undefined} step="1" value={sale.quantity} onChange={e=>setSale({...sale,quantity:e.target.value})}/></Field><Field label="تاريخ البيع"><input type="date" required value={sale.date} onChange={e=>setSale({...sale,date:e.target.value})}/></Field></div>
          <Field label="سعر بيع الوحدة"><input type="number" required min="0" step="0.001" value={sale.price} onChange={e=>setSale({...sale,price:e.target.value})}/></Field>
          <Field label="ملاحظة (اختياري)"><input maxLength={300} value={sale.note} onChange={e=>setSale({...sale,note:e.target.value})}/></Field><button className="primary-button full" disabled={submitDisabled||!sale.productId}>حفظ البيع</button>
        </form></section><section className="workspace-panel"><div className="panel-head"><h2>المبيعات المسجلة</h2></div><MovementTable rows={ledger.movements.filter(r=>r.kind==="sale")} emptyText="لم تسجل أي عملية بيع بعد."/></section></div>}
        {section==="returns" && <div className="two-column"><section className="workspace-panel"><div className="panel-head"><h2>تسجيل مسترجع</h2><RotateCcw size={24}/></div><form className="entry-form" onSubmit={onReturn}>
          <Field label="عملية البيع الأصلية"><Select value={returned.saleId} onValueChange={v=>setReturned(r=>({...r,saleId:v}))}><SelectTrigger className="select-control"><SelectValue placeholder="اختر عملية البيع"/></SelectTrigger><SelectContent>{saleOptions.map(r=><SelectItem key={r.id} value={String(r.id)}>{r.product_name} · {r.store} · {r.occurred_on} · متبقٍ {r.remaining}</SelectItem>)}</SelectContent></Select></Field>
          {selectedSale&&<div className="info-strip">يمكن استرجاع حتى <strong>{selectedSale.remaining} قطعة</strong> من هذه العملية. مبلغ الاسترداد للوحدة: <strong>{money(selectedSale.unit_price)}</strong></div>}
          <div className="form-grid"><Field label="الكمية المسترجعة"><input type="number" required min="1" max={selectedSale?.remaining} step="1" value={returned.quantity} onChange={e=>setReturned({...returned,quantity:e.target.value})}/></Field><Field label="تاريخ الاسترجاع"><input type="date" required value={returned.date} onChange={e=>setReturned({...returned,date:e.target.value})}/></Field></div>
          <Field label="سبب أو ملاحظة (اختياري)"><input maxLength={300} value={returned.note} onChange={e=>setReturned({...returned,note:e.target.value})}/></Field><button className="primary-button full" disabled={submitDisabled||!returned.saleId}>حفظ المسترجع</button>
        </form></section><section className="workspace-panel"><div className="panel-head"><h2>سجل المسترجعات</h2></div><MovementTable rows={ledger.movements.filter(r=>r.kind==="return")} emptyText="لا توجد مسترجعات مسجلة."/></section></div>}
        {section==="budget" && <><div className="stats-grid"><SummaryCard label="تكلفة المشتريات" value={money(stats.purchases)} note="قيمة كل البضاعة المستلمة"/><SummaryCard label="صافي المبيعات" value={money(stats.netSales)} note="بعد خصم مبالغ المسترجعات"/><SummaryCard label="تكلفة البضاعة المباعة" value={money(stats.costOfSales)} note="بعد عكس تكلفة المسترجعات"/><SummaryCard label="صافي الربح" value={money(stats.profit)} note="صافي المبيعات ناقص تكلفة المباع"/></div><section className="workspace-panel budget-panel"><div><span className="eyebrow">قيمة المخزون الحالي</span><strong>{money(stockValue)}</strong><p>محسوبة من الكمية المتوفرة × آخر تكلفة مسجلة لكل منتج.</p></div><div className="budget-breakdown"><div><span>إجمالي المبيعات</span><b>{money(stats.grossSales)}</b></div><div><span>مبالغ المسترجعات</span><b>{money(stats.refunds)}</b></div><div><span>عدد القطع المباعة بعد المسترجعات</span><b>{stats.sold-stats.returned}</b></div></div></section><p className="fine-print">تُحسب تكلفة المبيع بسعر تكلفة المنتج المسجل وقت البيع. يتم عكس القيمة نفسها عند استرجاع البيع.</p></>}
        {section==="reports" && <><section className="workspace-panel report-filters"><div className="panel-head"><h2>تقرير الفترة</h2><FileSpreadsheet size={24}/></div><div className="filter-row"><Field label="من تاريخ"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="إلى تاريخ"><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field><button className="primary-button" disabled={from>to} onClick={()=>void exportExcel()}><Download size={18}/> تنزيل Excel</button></div>{from>to&&<p className="validation-note">تاريخ البداية يجب أن يسبق تاريخ النهاية.</p>}</section><div className="stats-grid report-stats"><SummaryCard label="المستلم" value={String(period.received)} note={"تكلفته " + money(period.purchases)}/><SummaryCard label="المباع" value={String(period.sold)} note={"قيمته " + money(period.grossSales)}/><SummaryCard label="المسترجع" value={String(period.returned)} note={"قيمته " + money(period.refunds)}/><SummaryCard label="الربح خلال الفترة" value={money(period.profit)} note="بعد خصم المسترجعات والتكلفة"/></div><section className="workspace-panel"><div className="panel-head"><h2>تفاصيل الحركات</h2><span className="row-count">{periodRows.length} عملية</span></div><MovementTable rows={periodRows} emptyText="لا توجد عمليات في هذه الفترة."/></section></>}
        </>}
      </div>
    </main>
    <Toaster position="top-center" richColors dir="rtl"/>
  </SidebarProvider>;
}

