import { strToU8, zipSync } from "fflate";

type Movement = { id:number; kind:"receipt"|"sale"|"return"; product_name:string; quantity:number; unit_cost:number; unit_price:number; store:string; occurred_on:string; note:string };
type Totals = { received:number; sold:number; returned:number; purchases:number; grossSales:number; refunds:number; netSales:number; costOfSales:number; profit:number };
type Cell = string | number;
const esc = (text:string) => text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const col = (n:number) => { let s=""; for(let x=n+1;x>0;x=Math.floor((x-1)/26)) s=String.fromCharCode(65+(x-1)%26)+s; return s; };
function sheet(rows:Cell[][]) {
  const body = rows.map((row,i)=>"<row r=\""+(i+1)+"\">"+row.map((value,j)=>{
    const ref=col(j)+(i+1);
    return typeof value==="number" && Number.isFinite(value)
      ? "<c r=\""+ref+"\"><v>"+value+"</v></c>"
      : "<c r=\""+ref+"\" t=\"inlineStr\"><is><t>"+esc(String(value))+"</t></is></c>";
  }).join("")+"</row>").join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>'
    +'<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="25" customWidth="1"/><col min="4" max="10" width="18" customWidth="1"/></cols>'
    +'<sheetData>'+body+'</sheetData></worksheet>';
}
export function downloadReport(rows:Movement[], totals:Totals, from:string, to:string) {
  const overview:Cell[][] = [
    ["تقرير المبيعات والمخزون"],["من",from],["إلى",to],[],
    ["المؤشر","القيمة"],
    ["الكمية المستلمة",totals.received],["تكلفة المشتريات",totals.purchases/1000],
    ["الكمية المباعة",totals.sold],["إجمالي المبيعات",totals.grossSales/1000],
    ["الكمية المسترجعة",totals.returned],["مبالغ المسترجعات",totals.refunds/1000],
    ["صافي المبيعات",totals.netSales/1000],["تكلفة المباع بعد المسترجعات",totals.costOfSales/1000],["صافي الربح",totals.profit/1000],
  ];
  const details:Cell[][] = [["التاريخ","نوع العملية","المنتج","المتجر","الكمية","تكلفة الوحدة","سعر بيع الوحدة","القيمة","ملاحظة"]];
  for(const r of rows) details.push([r.occurred_on, r.kind==="receipt"?"استلام":r.kind==="sale"?"بيع":"مسترجع",r.product_name,r.store,r.quantity,r.unit_cost/1000,r.unit_price/1000,r.quantity*(r.kind==="receipt"?r.unit_cost:r.unit_price)/1000,r.note]);
  const files:Record<string,Uint8Array> = {
    "[Content_Types].xml":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الملخص" sheetId="1" r:id="rId1"/><sheet name="الحركات" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels":strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml":strToU8(sheet(overview)),
    "xl/worksheets/sheet2.xml":strToU8(sheet(details)),
  };
  const zipped = zipSync(files,{level:6});
  const blob = new Blob([new Uint8Array(zipped)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="تقرير-المبيعات-"+from+"-إلى-"+to+".xlsx";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
