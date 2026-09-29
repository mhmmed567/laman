import { getDatabase } from "@netlify/database";
import { LedgerError, deleteFirestoreProduct, loadFirestoreLedger, saveFirestoreMovement, saveFirestoreProduct } from "@/lib/firestore-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductRow = { id: string | number; name: string; default_cost: string | number; default_price: string | number };
type MovementRow = { id: string | number; kind: "receipt" | "sale" | "return"; product_id: string | number; product_name: string; receipt_id: string | number | null; quantity: number; unit_cost: string | number; unit_price: string | number; store: string; occurred_on: string; note: string };

const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const positive = (value: unknown) => integer(value) && Number(value) > 0;
const dateValid = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const safeText = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";
const firebaseSecret = () => process.env.FIREBASE_LEDGER_ACTIVE === "1" ? process.env.FIREBASE_SERVICE_ACCOUNT_JSON : undefined;
const product = (row: ProductRow) => ({ id: Number(row.id), name: row.name, default_cost: Number(row.default_cost), default_price: Number(row.default_price) });
const movement = (row: MovementRow) => ({ ...row, id: Number(row.id), product_id: Number(row.product_id), receipt_id: row.receipt_id === null ? null : Number(row.receipt_id), unit_cost: Number(row.unit_cost), unit_price: Number(row.unit_price) });
const uniqueViolation = (cause: unknown) => typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";

export async function GET() {
  try {
    const secret = firebaseSecret();
    if (secret) return Response.json(await loadFirestoreLedger(secret), { headers: { "Cache-Control": "no-store" } });
    const db = getDatabase();
    const [products, movements] = await Promise.all([
      db.sql<ProductRow>`SELECT id, name, default_cost, default_price FROM products ORDER BY name`,
      db.sql<MovementRow>`SELECT m.id, m.kind, m.product_id, p.name AS product_name, m.sale_id AS receipt_id, m.quantity, m.unit_cost, m.unit_price, m.store, TO_CHAR(m.occurred_on, 'YYYY-MM-DD') AS occurred_on, m.note FROM movements m JOIN products p ON p.id = m.product_id ORDER BY m.occurred_on DESC, m.id DESC`,
    ]);
    return Response.json({ products: products.map(product), movements: movements.map(movement) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Ledger read failed", cause);
    return error("تعذر تحميل البيانات حاليًا. حاول مرة أخرى.", 500);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return error("البيانات غير صالحة."); }
  const kind = body.kind;
  if (kind === "product") {
    const name = safeText(body.name, 100);
    const unitCost = Number(body.unitCost), unitPrice = Number(body.unitPrice);
    if (!name || !integer(unitCost) || !integer(unitPrice)) return error("أدخل اسم المنتج وتكلفته وسعر بيعه.");
    try {
      const secret = firebaseSecret();
      if (secret) await saveFirestoreProduct(secret, { name, unitCost, unitPrice });
      else await getDatabase().sql`INSERT INTO products (name, default_cost, default_price) VALUES (${name}, ${unitCost}, ${unitPrice})`;
      return Response.json({ ok: true }, { status: 201 });
    } catch (cause) {
      if (cause instanceof LedgerError) return error(cause.message, cause.status);
      if (uniqueViolation(cause)) return error("هذا المنتج موجود بالفعل.");
      console.error("Product creation failed", cause);
      return error("تعذر حفظ المنتج. حاول مرة أخرى.", 500);
    }
  }

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
    const productId = Number(body.productId);
    if (!positive(productId)) return error(kind === "return" ? "اختر المنتج المستلم." : "اختر منتجًا من صفحة المنتجات أولًا.");
    if (kind !== "receipt" && kind !== "sale" && kind !== "return") return error("نوع العملية غير صحيح.");

    const unitCost = Number(body.unitCost), unitPrice = Number(body.unitPrice);
    const store = safeText(body.store, 100);
    if (kind === "receipt" && (!integer(unitCost) || !integer(unitPrice))) return error("أدخل تكلفة وسعر بيع صحيحين.");
    if (kind === "sale" && (!store || !integer(unitPrice))) return error("اختر المنتج والمتجر وسعر البيع.");

    const client = await getDatabase().pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<ProductRow>("SELECT id, name, default_cost, default_price FROM products WHERE id = $1 FOR UPDATE", [productId]);
      if (!found.rows.length) throw new LedgerError("المنتج غير موجود.");
      const current = product(found.rows[0]);
      if (kind === "receipt") {
        await client.query("UPDATE products SET default_cost = $1, default_price = $2 WHERE id = $3", [unitCost, unitPrice, productId]);
        await client.query("INSERT INTO movements (kind, product_id, quantity, unit_cost, unit_price, occurred_on, note) VALUES ('receipt', $1, $2, $3, $4, $5, $6)", [productId, quantity, unitCost, unitPrice, occurredOn, note]);
      } else {
        const available = await client.query<{ stock: string }>("SELECT COALESCE(SUM(CASE WHEN kind = 'receipt' THEN quantity ELSE -quantity END), 0)::text AS stock FROM movements WHERE product_id = $1", [productId]);
        if (Number(available.rows[0].stock) < quantity) throw new LedgerError(kind === "sale" ? "الكمية المطلوبة أكبر من المخزون المتوفر." : "الكمية المسترجعة أكبر من الكمية المتبقية في المخزون.");
        await client.query("INSERT INTO movements (kind, product_id, quantity, unit_cost, unit_price, store, occurred_on, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [kind, productId, quantity, current.default_cost, kind === "sale" ? unitPrice : 0, kind === "sale" ? store : "", occurredOn, note]);
      }
      await client.query("COMMIT");
      return Response.json({ ok: true }, { status: 201 });
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally { client.release(); }
  } catch (cause) {
    if (cause instanceof LedgerError) return error(cause.message, cause.status);
    console.error("Ledger write failed", cause);
    return error("تعذر حفظ العملية. حاول مرة أخرى.", 500);
  }
}

export async function DELETE(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return error("البيانات غير صالحة."); }
  const productId = Number(body.productId);
  const expectedName = safeText(body.expectedName, 100);
  if (!positive(productId) || !expectedName) return error("حدد المنتج الذي تريد حذفه.");
  try {
    const secret = firebaseSecret();
    if (secret) await deleteFirestoreProduct(secret, productId, expectedName);
    else {
      const deleted = await getDatabase().sql<{ id: string }>`DELETE FROM products WHERE id = ${productId} AND name = ${expectedName} RETURNING id`;
      if (!deleted.length) return error("تغيّر المنتج أو لم يعد موجودًا. حدّث الصفحة ثم حاول مرة أخرى.", 409);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof LedgerError) return error(cause.message, cause.status);
    console.error("Product deletion failed", cause);
    return error("تعذر حذف المنتج وعملياته. حاول مرة أخرى.", 500);
  }
}
