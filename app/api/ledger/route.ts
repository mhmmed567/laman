import { LedgerError, deleteFirestoreProduct, loadFirestoreLedger, saveFirestoreMovement, saveFirestoreProduct } from "@/lib/firestore-admin";
import { createNetlifyMovement, createNetlifyProduct, deleteNetlifyProduct, loadNetlifyLedger } from "@/lib/netlify-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const positive = (value: unknown) => integer(value) && Number(value) > 0;
const dateValid = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const safeText = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";
const firebaseSecret = () => process.env.FIREBASE_LEDGER_ACTIVE === "1" ? process.env.FIREBASE_SERVICE_ACCOUNT_JSON : undefined;

export async function GET() {
  try {
    const secret = firebaseSecret();
    const ledger = secret ? await loadFirestoreLedger(secret) : await loadNetlifyLedger();
    return Response.json(ledger, { headers: { "Cache-Control": "no-store" } });
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
      else await createNetlifyProduct(name, unitCost, unitPrice);
      return Response.json({ ok: true }, { status: 201 });
    } catch (cause) {
      if (cause instanceof LedgerError) return error(cause.message, cause.status);
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
    await createNetlifyMovement({ kind, productId, quantity, unitCost, unitPrice, store, occurredOn: occurredOn as string, note });
    return Response.json({ ok: true }, { status: 201 });
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
    else await deleteNetlifyProduct(productId, expectedName);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof LedgerError) return error(cause.message, cause.status);
    console.error("Product deletion failed", cause);
    return error("تعذر حذف المنتج وعملياته. حاول مرة أخرى.", 500);
  }
}
