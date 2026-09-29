import { getStore } from "@netlify/blobs";
import { LedgerError } from "@/lib/firestore-admin";

export type Product = { id: number; name: string; default_cost: number; default_price: number };
export type Movement = {
  id: number;
  kind: "receipt" | "sale" | "return";
  product_id: number;
  product_name: string;
  receipt_id: null;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  store: string;
  occurred_on: string;
  note: string;
};
type Ledger = { products: Product[]; movements: Movement[]; nextProductId: number; nextMovementId: number };
const empty = (): Ledger => ({ products: [], movements: [], nextProductId: 1, nextMovementId: 1 });
const store = () => getStore("laman-ledger");
const key = "state";

export async function loadNetlifyLedger() {
  const entry = await store().get(key, { type: "json", consistency: "strong" }) as Ledger | null;
  const ledger = entry ?? empty();
  return {
    products: [...ledger.products].sort((a, b) => a.name.localeCompare(b.name, "ar")),
    movements: [...ledger.movements].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id),
  };
}

async function update(mutator: (ledger: Ledger) => void) {
  // All records live in one site-wide blob. Conditional writes keep a read,
  // stock check, and write atomic when two visitors save at the same time.
  const blobs = store();
  for (let attempt = 0; attempt < 10; attempt++) {
    const entry = await blobs.getWithMetadata(key, { type: "json", consistency: "strong" });
    const ledger = entry ? structuredClone(entry.data as Ledger) : empty();
    mutator(ledger);
    const result = await blobs.setJSON(key, ledger, entry?.etag ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (result.modified) return;
  }
  throw new LedgerError("ازدحم حفظ البيانات. حاول مرة أخرى.", 409);
}

export async function createNetlifyProduct(name: string, cost: number, price: number) {
  await update(ledger => {
    if (ledger.products.some(item => item.name.toLocaleLowerCase("ar") === name.toLocaleLowerCase("ar"))) {
      throw new LedgerError("هذا المنتج موجود بالفعل.");
    }
    ledger.products.push({ id: ledger.nextProductId++, name, default_cost: cost, default_price: price });
  });
}

export async function createNetlifyMovement(input: {
  kind: Movement["kind"]; productId: number; quantity: number; unitCost: number;
  unitPrice: number; store: string; occurredOn: string; note: string;
}) {
  await update(ledger => {
    const product = ledger.products.find(item => item.id === input.productId);
    if (!product) throw new LedgerError("المنتج غير موجود.");
    if (input.kind !== "receipt") {
      const available = ledger.movements.filter(item => item.product_id === input.productId)
        .reduce((sum, item) => sum + (item.kind === "receipt" ? item.quantity : -item.quantity), 0);
      if (available < input.quantity) throw new LedgerError(input.kind === "sale"
        ? "الكمية المطلوبة أكبر من المخزون المتوفر."
        : "الكمية المسترجعة أكبر من الكمية المتبقية في المخزون.");
    }
    const isReceipt = input.kind === "receipt";
    const isSale = input.kind === "sale";
    const movement: Movement = {
      id: ledger.nextMovementId++, kind: input.kind, product_id: product.id,
      product_name: product.name, receipt_id: null, quantity: input.quantity,
      unit_cost: isReceipt ? input.unitCost : product.default_cost,
      unit_price: isReceipt || isSale ? input.unitPrice : 0,
      store: isSale ? input.store : "", occurred_on: input.occurredOn, note: input.note,
    };
    if (isReceipt) {
      product.default_cost = input.unitCost;
      product.default_price = input.unitPrice;
    }
    ledger.movements.push(movement);
  });
}

export async function deleteNetlifyProduct(productId: number, expectedName: string) {
  await update(ledger => {
    const index = ledger.products.findIndex(item => item.id === productId && item.name === expectedName);
    if (index < 0) throw new LedgerError("تغيّر المنتج أو لم يعد موجودًا. حدّث الصفحة ثم حاول مرة أخرى.", 409);
    ledger.products.splice(index, 1);
    ledger.movements = ledger.movements.filter(item => item.product_id !== productId);
  });
}
