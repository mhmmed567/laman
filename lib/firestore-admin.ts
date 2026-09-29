/** Firestore access for the private Site. The service account never reaches the browser. */
const projectId = "eduassist-ai-hxc7d";
const databasePath = `projects/${projectId}/databases/(default)/documents`;
const root = `https://firestore.googleapis.com/v1/${databasePath}`;
const encoder = new TextEncoder();

type Fields = Record<string, FireValue>;
type FireValue = { stringValue?: string; integerValue?: string; nullValue?: null };
type FireDoc = { name: string; fields?: Fields; updateTime?: string };
type Account = { project_id: string; client_email: string; private_key: string };
type Product = { id: number; name: string; default_cost: number; default_price: number; stock: number };
type Movement = { id: number; kind: "receipt" | "sale" | "return"; product_id: number; product_name: string; receipt_id: number | null; quantity: number; unit_cost: number; unit_price: number; store: string; occurred_on: string; note: string };

export class LedgerError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
class FirestoreError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const fail = (message: string): never => { throw new LedgerError(message); };
const id = () => Date.now() * 1000 + crypto.getRandomValues(new Uint32Array(1))[0] % 1000;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const whole = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const positive = (value: unknown) => whole(value) && Number(value) > 0;
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let cachedToken: { value: string; expiresAt: number } | undefined;

function readAccount(secret: string): Account {
  const account = JSON.parse(secret) as Account;
  if (account.project_id !== projectId || !account.client_email || !account.private_key) throw new Error("Firebase service account is invalid for this project");
  return account;
}

async function accessToken(secret: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = readAccount(secret);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const raw = Uint8Array.from(atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${payload}`))));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${signature}` }) });
  if (!response.ok) throw new FirestoreError(response.status, "Firebase service account token rejected");
  const result = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

async function api<T>(secret: string, path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken(secret);
  const response = await fetch(`${root}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const detail = await response.text();
    throw new FirestoreError(response.status, detail.slice(0, 500));
  }
  return response.json() as Promise<T>;
}

const docName = (collection: string, document: string | number) => `${databasePath}/${collection}/${document}`;
const asString = (v?: FireValue) => v?.stringValue ?? "";
const asNumber = (v?: FireValue) => Number(v?.integerValue ?? 0);
const field = (v: string | number | null): FireValue => v === null ? { nullValue: null } : typeof v === "number" ? { integerValue: String(v) } : { stringValue: v };
function fields(record: Record<string, string | number | null>): Fields { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, field(value)])); }
function product(doc: FireDoc): Product { const f = doc.fields ?? {}; return { id: asNumber(f.id), name: asString(f.name), default_cost: asNumber(f.default_cost), default_price: asNumber(f.default_price), stock: asNumber(f.stock) }; }
function movement(doc: FireDoc): Movement { const f = doc.fields ?? {}; return { id: asNumber(f.id), kind: asString(f.kind) as Movement["kind"], product_id: asNumber(f.product_id), product_name: asString(f.product_name), receipt_id: f.receipt_id?.nullValue === null || !f.receipt_id ? null : asNumber(f.receipt_id), quantity: asNumber(f.quantity), unit_cost: asNumber(f.unit_cost), unit_price: asNumber(f.unit_price), store: asString(f.store), occurred_on: asString(f.occurred_on), note: asString(f.note) }; }
async function getDoc(secret: string, collection: string, document: number | string): Promise<FireDoc | null> {
  try { return await api<FireDoc>(secret, `/${collection}/${document}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}
async function listDocs(secret: string, collection: string): Promise<FireDoc[]> {
  const documents: FireDoc[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const page = await api<{ documents?: FireDoc[]; nextPageToken?: string }>(secret, `/${collection}?${query}`);
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return documents;
}
type Write = { update: { name: string; fields: Fields }; currentDocument: { exists?: boolean; updateTime?: string } };
const create = (name: string, data: Record<string, string | number | null>): Write => ({ update: { name, fields: fields(data) }, currentDocument: { exists: false } });
const update = (doc: FireDoc, data: Record<string, string | number | null>): Write => ({ update: { name: doc.name, fields: { ...doc.fields, ...fields(data) } }, currentDocument: { updateTime: doc.updateTime } });
async function commit(secret: string, writes: Write[]) { await api(secret, ":commit", { method: "POST", body: JSON.stringify({ writes }) }); }
async function retryOnConflict(work: () => Promise<void>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await work(); return; }
    catch (error) { if (!(error instanceof FirestoreError && (error.status === 409 || error.status === 412)) || attempt === 3) throw error; }
  }
}
async function nameHash(name: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(name.normalize("NFC").toLowerCase())))).map(b => b.toString(16).padStart(2, "0")).join(""); }

export async function loadFirestoreLedger(secret: string) {
  const [products, movements] = await Promise.all([listDocs(secret, "products"), listDocs(secret, "movements")]);
  return { products: products.map(product).sort((a, b) => a.name.localeCompare(b.name, "ar")), movements: movements.map(movement).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id - a.id) };
}

export async function saveFirestoreProduct(secret: string, input: { name: string; unitCost: number; unitPrice: number }) {
  const name = text(input.name, 100);
  if (!name || !whole(input.unitCost) || !whole(input.unitPrice)) fail("أدخل اسم المنتج وتكلفته وسعر بيعه.");
  const productId = id();
  const hash = await nameHash(name);
  if (await getDoc(secret, "productNames", hash)) fail("هذا المنتج موجود بالفعل.");
  try {
    await commit(secret, [create(docName("productNames", hash), { product_id: productId }), create(docName("products", productId), { id: productId, name, default_cost: input.unitCost, default_price: input.unitPrice, stock: 0 })]);
  } catch (cause) {
    if (cause instanceof FirestoreError && cause.status === 409) fail("هذا المنتج موجود بالفعل.");
    throw cause;
  }
}

export async function saveFirestoreMovement(secret: string, body: Record<string, unknown>) {
  const quantity = Number(body.quantity);
  const occurred_on = body.occurredOn;
  const note = text(body.note, 300);
  if (!positive(quantity) || quantity > 100000000) fail("أدخل كمية صحيحة أكبر من صفر.");
  if (!validDate(occurred_on)) fail("أدخل تاريخًا صحيحًا.");
  const movementId = id();
  const movementName = docName("movements", movementId);
  if (body.kind === "receipt") {
    const productId = Number(body.productId);
    const unit_cost = Number(body.unitCost), unit_price = Number(body.unitPrice);
    if (!whole(unit_cost) || !whole(unit_price)) fail("أدخل تكلفة وسعر بيع صحيحين.");
    if (!positive(productId)) fail("اختر منتجًا من صفحة المنتجات أولًا.");
    const movementBase = { id: movementId, kind: "receipt", product_id: productId, receipt_id: null, quantity, unit_cost, unit_price, store: "", occurred_on: occurred_on as string, note };
    await retryOnConflict(async () => {
      const existing = await getDoc(secret, "products", productId);
      if (!existing) fail("المنتج غير موجود.");
      const p = product(existing!);
      await commit(secret, [update(existing!, { default_cost: unit_cost, default_price: unit_price, stock: p.stock + quantity }), create(movementName, { ...movementBase, product_name: p.name })]);
    });
    return;
  }
  if (body.kind === "sale") {
    const productId = Number(body.productId);
    const store = text(body.store, 100);
    const unit_price = Number(body.unitPrice);
    if (!positive(productId) || !store || !whole(unit_price)) fail("اختر المنتج والمتجر وسعر البيع.");
    await retryOnConflict(async () => {
      const existing = await getDoc(secret, "products", productId);
      if (!existing) fail("المنتج غير موجود.");
      const p = product(existing!);
      if (p.stock < quantity) fail("الكمية المطلوبة أكبر من المخزون المتوفر.");
      await commit(secret, [update(existing!, { stock: p.stock - quantity }), create(movementName, { id: movementId, kind: "sale", product_id: productId, product_name: p.name, receipt_id: null, quantity, unit_cost: p.default_cost, unit_price, store, occurred_on: occurred_on as string, note })]);
    });
    return;
  }
  if (body.kind === "return") {
    const productId = Number(body.productId);
    if (!positive(productId)) fail("اختر المنتج المستلم.");
    await retryOnConflict(async () => {
      const productDoc = await getDoc(secret, "products", productId);
      if (!productDoc) fail("المنتج غير موجود.");
      const p = product(productDoc!);
      if (quantity > p.stock) fail("الكمية المسترجعة أكبر من الكمية المتبقية في المخزون.");
      await commit(secret, [update(productDoc!, { stock: p.stock - quantity }), create(movementName, { id: movementId, kind: "return", product_id: productId, product_name: p.name, receipt_id: null, quantity, unit_cost: p.default_cost, unit_price: 0, store: "", occurred_on: occurred_on as string, note })]);
    });
    return;
  }
  fail("نوع العملية غير صحيح.");
}
