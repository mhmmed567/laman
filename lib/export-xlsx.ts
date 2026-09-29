import { strToU8, zipSync } from "fflate";

type Movement = { kind:"receipt"|"sale"|"return"; product_name:string; quantity:number; unit_cost:number; unit_price:number; store:string; occurred_on:string; note:string };
type Totals = { received:number; sold:number; returned:number; purchases:number; returnedCost:number; netPurchases:number; grossSales:number; costOfSales:number; profit:number };
type ProductBalance = { name:string; received:number; sold:number; returned:number; closing:number };
type Value = string | number | { date:string };
type Row = { cells: Value[]; styles?: number[]; height?: number };
const esc = (value:string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const col = (n:number) => { let s=""; for(let x=n+1;x>0;x=Math.floor((x-1)/26)) s=String.fromCharCode(65+(x-1)%26)+s; return s; };
const serialDate = (value:string) => (Date.parse(value+"T00:00:00Z")-Date.UTC(1899,11,30))/86400000;
function cell(ref:string, value:Value, style:number) {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === "object") return `<c r="${ref}" s="${style}"><v>${serialDate(value.date)}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}
function sheet(rows:Row[], widths:number[], merges:string[], filter?:string, freezeAt?:number) {
  const body = rows.map((row,i)=>`<row r="${i+1}"${row.height?` ht="${row.height}" customHeight="1"`:""}>${row.cells.map((v,j)=>cell(col(j)+(i+1),v,row.styles?.[j]??0)).join("")}</row>`).join("");
  const view = `<sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0">${freezeAt?`<pane ySplit="${freezeAt}" topLeftCell="A${freezeAt+1}" activePane="bottomLeft" state="frozen"/>`:""}</sheetView></sheetViews>`;
  const cols = `<cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${body}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(range=>`<mergeCell ref="${range}"/>`).join("")}</mergeCells>`:""}${filter?`<autoFilter ref="${filter}"/>`:""}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.000"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="4"><font><sz val="11"/><color rgb="FF18333D"/><name val="Arial"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF20525D"/><name val="Arial"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173A49"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F777C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F3F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F8FA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="hair"><color rgb="FFD5E4E8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function downloadReport(rows:Movement[], totals:Totals, products:ProductBalance[], from:string, to:string) {
  const summary:Row[] = [
    {cells:["تقرير المبيعات والمخزون","","","",""],styles:[1,1,1,1,1],height:40},
    {cells:[`الفترة من ${from} إلى ${to}`,"","","",""],styles:[12,12,12,12,12],height:26},
    {cells:[],height:10},
    {cells:["ملخص الفترة","","","",""],styles:[2,2,2,2,2],height:28},
    {cells:["المؤشر","القيمة","","المؤشر","القيمة"],styles:[3,3,0,3,3],height:26},
    {cells:["الكمية المستلمة",totals.received,"","الكمية المُعادة",totals.returned],styles:[4,8,0,4,8]},
    {cells:["تكلفة المستلم",totals.purchases/1000,"","تكلفة المُعاد",totals.returnedCost/1000],styles:[5,7,0,5,7]},
    {cells:["صافي تكلفة المستلم",totals.netPurchases/1000,"","تكلفة المباع",totals.costOfSales/1000],styles:[4,6,0,4,6]},
    {cells:["الكمية المباعة",totals.sold,"","قيمة المبيعات",totals.grossSales/1000],styles:[5,9,0,5,7]},
    {cells:["الربح من البيع",totals.profit/1000],styles:[12,6],height:25},
    {cells:[],height:10},
    {cells:["المنتجات والرصيد","","","",""],styles:[2,2,2,2,2],height:28},
    {cells:["المنتج","المستلم","المباع","المُعاد","المتبقي حتى نهاية الفترة"],styles:[3,3,3,3,3],height:28},
  ];
  for (const p of products) {
    const alt = summary.length%2===0;
    summary.push({cells:[p.name,p.received,p.sold,p.returned,p.closing],styles:[alt?5:4,alt?9:8,alt?9:8,alt?9:8,alt?9:8],height:22});
  }
  if (products.length) summary.push({cells:["الإجمالي",totals.received,totals.sold,totals.returned,products.reduce((sum,p)=>sum+p.closing,0)],styles:[12,8,8,8,8],height:25});
  if (!products.length) summary.push({cells:["لا توجد حركات خلال الفترة"],styles:[4],height:24});

  const details:Row[] = [
    {cells:["تفاصيل الحركات",...Array(8).fill("")],styles:Array(9).fill(1),height:40},
    {cells:[`الفترة من ${from} إلى ${to}`,...Array(8).fill("")],styles:Array(9).fill(12),height:26},
    {cells:[],height:10},
    {cells:["التاريخ","العملية","المنتج","المتجر","الكمية","تكلفة الوحدة","سعر بيع الوحدة","القيمة","ملاحظة"],styles:Array(9).fill(3),height:30},
  ];
  for(const r of rows) {
    const alt=details.length%2===0;
    const plain=alt?5:4, qty=alt?9:8, amount=alt?7:6, date=alt?11:10;
    details.push({cells:[{date:r.occurred_on},r.kind==="receipt"?"استلام":r.kind==="sale"?"بيع":"إرجاع من المستلم",r.product_name,r.store,r.quantity,r.unit_cost/1000,r.unit_price/1000,r.quantity*(r.kind==="sale"?r.unit_price:r.unit_cost)/1000,r.note],styles:[date,plain,plain,plain,qty,amount,amount,amount,plain],height:23});
  }
  if (!rows.length) details.push({cells:["لا توجد حركات خلال الفترة"],styles:[4],height:24});
  const files:Record<string,Uint8Array> = {
    "[Content_Types].xml":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الملخص" sheetId="1" r:id="rId1"/><sheet name="الحركات" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/styles.xml":strToU8(styles),
    "xl/worksheets/sheet1.xml":strToU8(sheet(summary,[28,19,17,24,28],["A1:E1","A2:E2","A4:E4","A12:E12"])),
    "xl/worksheets/sheet2.xml":strToU8(sheet(details,[16,24,26,23,13,19,19,19,36],["A1:I1","A2:I2"],`A4:I${Math.max(4,details.length)}`,4)),
  };
  const zipped = zipSync(files,{level:6});
  const blob = new Blob([new Uint8Array(zipped)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="تقرير-المبيعات-"+from+"-إلى-"+to+".xlsx";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
