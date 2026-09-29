import { env } from "cloudflare:workers";
import { LedgerError, loadFirestoreLedger, saveFirestoreMovement } from "@/lib/firestore-admin";

export const dynamic = "force-dynamic";

type Product = { id: number; name: string; default_cost: number; default_price: number };
type Movement = { id: number; kind: "receipt" | "sale" | "return"; product_id: number; product_name: string; sale_id: number | null; quantity: number; unit_cost: number; unit_price: number; store: string; occurred_on: string; note: string };
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const positive = (value: unknown) => integer(value) && Number(value) > 0;
const dateValid = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const safeText = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";
const firebaseSecret = () => (env as unknown as Record<string, unknown>).FIREBASE_SERVICE_ACCOUNT_JSON as string | undefined;

export async function GET() {
  try {
    const secret = firebaseSecret();
    if (secret) return Response.json(await loadFirestoreLedger(secret), { headers: { "Cache-Control": "no-store" } });
    const [products, movements] = await Promise.all([
      env.DB!.prepare("SELECT id, name, default_cost, default_price FROM products ORDER BY name COLLATE NOCASE").all<Product>(),
      env.DB!.prepare("SELECT m.id, m.kind, m.product_id, p.name AS product_name, m.sale_id, m.quantity, m.unit_cost, m.unit_price, m.store, m.occurred_on, m.note FROM movements m JOIN products p ON p.id = m.product_id ORDER BY m.occurred_on DESC, m.id DESC").all<Movement>(),
    ]);
    return Response.json({ products: products.results, movements: movements.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Ledger read failed", cause);
    return error("تعذر تحميل البيانات حاليًا. حاول مرة أخرى.", 500);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return error("البيانات غير صالحة."); }
  const kind = body.kind;
  const quantity = Number(body.quantity);
  const occurredOn = body.occurredOn;
  const note = safeText(body.note, 300);
  if (!positive(quantity) || quantity > 100000000) return error("أدخل كمية صحيحة أكبر من صفر.");
  if (!dateValid(occurredOn)) return error("أدخل تاريخًا صحيحًا.");

  try {
    const secret = firebaseSecret();
    if (secret) {
      await saveFirestoreMovement(secret, body);
      return Response.json({ ok: true }, { status: 201 });
    }
    if (kind === "receipt") {
      const name = safeText(body.name, 100);
      const productId = Number(body.productId);
      const unitCost = Number(body.unitCost);
      const unitPrice = Number(body.unitPrice);
      if (!integer(unitCost) || !integer(unitPrice)) return error("أدخل تكلفة وسعر بيع صحيحين.");
      if (!name && !positive(productId)) return error("اختر منتجًا أو اكتب اسم منتج جديد.");
      let id = productId;
      if (positive(productId)) {
        const product = await env.DB!.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
        if (!product) return error("المنتج غير موجود.");
        await env.DB!.prepare("UPDATE products SET default_cost = ?, default_price = ? WHERE id = ?").bind(unitCost, unitPrice, id).run();
      } else {
        const existing = await env.DB!.prepare("SELECT id FROM products WHERE name = ? COLLATE NOCASE").bind(name).first<{ id: number }>();
        if (existing) return error("هذا المنتج موجود؛ اختره من القائمة.");
        const created = await env.DB!.prepare("INSERT INTO products (name, default_cost, default_price) VALUES (?, ?, ?)").bind(name, unitCost, unitPrice).run();
        id = Number(created.meta.last_row_id);
      }
      await env.DB!.prepare("INSERT INTO movements (kind, product_id, quantity, unit_cost, unit_price, occurred_on, note) VALUES ('receipt', ?, ?, ?, ?, ?, ?)").bind(id, quantity, unitCost, unitPrice, occurredOn, note).run();
      return Response.json({ ok: true }, { status: 201 });
    }
    if (kind === "sale") {
      const productId = Number(body.productId);
      const store = safeText(body.store, 100);
      const unitPrice = Number(body.unitPrice);
      if (!positive(productId) || !store || !integer(unitPrice)) return error("اختر المنتج والمتجر وسعر البيع.");
      const product = await env.DB!.prepare("SELECT id, default_cost FROM products WHERE id = ?").bind(productId).first<{ id: number; default_cost: number }>();
      if (!product) return error("المنتج غير موجود.");
      const result = await env.DB!.prepare(`INSERT INTO movements (kind, product_id, quantity, unit_cost, unit_price, store, occurred_on, note)
        SELECT 'sale', ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COALESCE(SUM(CASE kind WHEN 'receipt' THEN quantity WHEN 'sale' THEN -quantity ELSE quantity END), 0) FROM movements WHERE product_id = ?) >= ?`)
        .bind(productId, quantity, product.default_cost, unitPrice, store, occurredOn, note, productId, quantity).run();
      if (!result.meta.changes) return error("الكمية المطلوبة أكبر من المخزون المتوفر.");
      return Response.json({ ok: true }, { status: 201 });
    }
    if (kind === "return") {
      const saleId = Number(body.saleId);
      if (!positive(saleId)) return error("اختر عملية البيع المرتبطة بالمسترجع.");
      const sale = await env.DB!.prepare("SELECT id, product_id, quantity, unit_cost, unit_price, store FROM movements WHERE id = ? AND kind = 'sale'").bind(saleId).first<{ id: number; product_id: number; quantity: number; unit_cost: number; unit_price: number; store: string }>();
      if (!sale) return error("عملية البيع غير موجودة.");
      const result = await env.DB!.prepare(`INSERT INTO movements (kind, product_id, sale_id, quantity, unit_cost, unit_price, store, occurred_on, note)
        SELECT 'return', ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? <= (SELECT ? - COALESCE(SUM(quantity), 0) FROM movements WHERE kind = 'return' AND sale_id = ?)`)
        .bind(sale.product_id, saleId, quantity, sale.unit_cost, sale.unit_price, sale.store, occurredOn, note, quantity, sale.quantity, saleId).run();
      if (!result.meta.changes) return error("الكمية المسترجعة أكبر من المتبقي من عملية البيع.");
      return Response.json({ ok: true }, { status: 201 });
    }
    return error("نوع العملية غير صحيح.");
  } catch (cause) {
    if (cause instanceof LedgerError) return error(cause.message, cause.status);
    console.error("Ledger write failed", cause);
    return error("تعذر حفظ العملية. حاول مرة أخرى.", 500);
  }
}

