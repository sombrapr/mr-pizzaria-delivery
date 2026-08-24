const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v25.0";
const TEST_MODE = String(process.env.TEST_MODE || "true").toLowerCase() === "true";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const STORE_TIMEZONE = process.env.STORE_TIMEZONE || "America/Sao_Paulo";
const DATABASE_URL = process.env.DATABASE_URL || "";
const PRINT_API_KEY = process.env.PRINT_API_KEY || ADMIN_KEY;
const TODAY_PROMOTION = String(process.env.TODAY_PROMOTION || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:10000").trim().replace(/\/+$/, "");
const WHATSAPP_GROUP_URL = String(process.env.WHATSAPP_GROUP_URL || "").trim();
const META_PIXEL_ID = String(process.env.META_PIXEL_ID || "").trim().replace(/\D/g, "").slice(0, 30);
const META_CAPI_ACCESS_TOKEN = String(process.env.META_CAPI_ACCESS_TOKEN || "").trim();
const META_CAPI_TEST_EVENT_CODE = String(process.env.META_CAPI_TEST_EVENT_CODE || "").trim();
const META_GRAPH_API_VERSION = String(process.env.META_GRAPH_API_VERSION || GRAPH_API_VERSION || "v25.0").trim() || "v25.0";
const META_CAPI_ENABLED = Boolean(META_PIXEL_ID && META_CAPI_ACCESS_TOKEN);
const PAGARME_SECRET_KEY = String(process.env.PAGARME_SECRET_KEY || "").trim();
const PAGARME_ENV = String(process.env.PAGARME_ENV || (PAGARME_SECRET_KEY.startsWith("sk_test_") ? "test" : "production")).trim().toLowerCase();
const PAGARME_BASE_URL = String(process.env.PAGARME_BASE_URL || (PAGARME_ENV === "test" ? "https://sdx-api.pagar.me/core/v5" : "https://api.pagar.me/core/v5")).trim().replace(/\/+$/, "");
const PAGARME_ENABLED = Boolean(PAGARME_SECRET_KEY && PAGARME_BASE_URL);
const PAGARME_TEST_MODE = PAGARME_ENV === "test" || PAGARME_SECRET_KEY.startsWith("sk_test_");
const PAGARME_PAYMENT_LINK_EXPIRES_MINUTES = Math.max(5, Math.min(120, Number(process.env.PAGARME_PAYMENT_LINK_EXPIRES_MINUTES || 30)));
const PAGARME_WEBHOOK_TOKEN = String(process.env.PAGARME_WEBHOOK_TOKEN || "").trim();
const WHATSAPP_STATUS_TEMPLATE = String(process.env.WHATSAPP_STATUS_TEMPLATE || "").trim();
const WHATSAPP_STATUS_TEMPLATE_LANGUAGE = String(process.env.WHATSAPP_STATUS_TEMPLATE_LANGUAGE || "pt_BR").trim() || "pt_BR";
const BUSINESS_WHATSAPP_NUMBER = String(process.env.BUSINESS_WHATSAPP_NUMBER || "554434252285").replace(/\D/g, "").slice(0, 15);
const ABANDONED_CART_MIN_AGE_MINUTES = Math.max(1, Number(process.env.ABANDONED_CART_MIN_AGE_MINUTES || 10));
const ABANDONED_CART_RETENTION_DAYS = Math.max(1, Number(process.env.ABANDONED_CART_RETENTION_DAYS || 30));
// O endereço do site próprio é montado pelo domínio atual do Render.
// A variável ORDER_SITE_URL antiga é ignorada para evitar links desatualizados ou rotas inexistentes.
const ORDER_SITE_URL = `${PUBLIC_BASE_URL}/comprar`;
const CARDAPIO_PDF_FILENAME = "cardapio-mr-pizzaria.pdf";
const CARDAPIO_PDF_PATH = path.join(__dirname, CARDAPIO_PDF_FILENAME);
const CARDAPIO_PDF_URL = `${PUBLIC_BASE_URL}/${CARDAPIO_PDF_FILENAME}`;
const COUPON_CODE = String(process.env.COUPON_CODE || "").trim().toUpperCase();
const COUPON_PERCENT = Math.max(0, Math.min(100, Number(process.env.COUPON_PERCENT || 0)));
const SCHEDULE_PRINT_LEAD_MINUTES = Math.max(15, Number(process.env.SCHEDULE_PRINT_LEAD_MINUTES || 60));
const ORDER_ADVANCE_DAYS = Math.max(1, Number(process.env.ORDER_ADVANCE_DAYS || 30));
const RESERVATION_ADVANCE_DAYS = Math.max(1, Number(process.env.RESERVATION_ADVANCE_DAYS || 60));
const RESERVATION_MAX_PEOPLE = Math.max(1, Number(process.env.RESERVATION_MAX_PEOPLE || 30));

const sessions = new Map();
const lastBotMessages = new Map();
const activeInteractiveMessages = new Set();
const memoryOrders = [];
const memoryReservations = [];
const memoryServiceRequests = [];
const memoryTableTabs = [];
const memoryStaff = [];
const memoryFeaturedCombos = [];
const memoryAbandonedCarts = [];
const processedMessages = new Set();
let memoryOrderSequence = 100;
let memoryReservationSequence = 1000;
let memoryServiceSequence = 0;
let memoryStaffSequence = 0;
let memoryTabSequence = 0;
let memoryComboSequence = 0;
let memoryAbandonedCartSequence = 0;
let memoryPromotion = {
  text: TODAY_PROMOTION,
  active: Boolean(TODAY_PROMOTION),
  imageData: null,
  imageMime: "",
  imageName: "",
  hasImage: false,
  updatedAt: new Date().toISOString()
};
let databaseReady = false;
let cachedCardapioMediaId = String(process.env.CARDAPIO_MEDIA_ID || "").trim();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;


function metaSha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
function normalizeMetaText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}
function normalizeMetaPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("55") && digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return digits.slice(0, 15);
}
function requestClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.socket?.remoteAddress || req.ip || "").replace(/^::ffff:/, "");
}
function splitMetaName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
}
function buildMetaUserData({ req, phone = "", customerName = "", browserId = "", fbp = "", fbc = "" } = {}) {
  const userData = {};
  const ip = req ? requestClientIp(req) : "";
  const ua = req ? String(req.headers["user-agent"] || "").slice(0, 1000) : "";
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;
  if (/^fb\.1\.\d+\.\d+/.test(String(fbp || ""))) userData.fbp = String(fbp).slice(0, 255);
  if (/^fb\.1\.\d+\./.test(String(fbc || ""))) userData.fbc = String(fbc).slice(0, 255);
  const normalizedPhone = normalizeMetaPhone(phone);
  if (normalizedPhone) userData.ph = [metaSha256(normalizedPhone)];
  const { first, last } = splitMetaName(customerName);
  const fn = normalizeMetaText(first);
  const ln = normalizeMetaText(last);
  if (fn) userData.fn = [metaSha256(fn)];
  if (ln) userData.ln = [metaSha256(ln)];
  const stableExternal = String(browserId || normalizedPhone || "").trim();
  if (stableExternal) userData.external_id = [metaSha256(stableExternal)];
  return userData;
}
function cleanMetaCustomData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  const allowed = new Set(["currency","value","content_name","content_category","content_type","content_ids","contents","num_items","order_id","delivery_category"]);
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key) || value === undefined || value === null) continue;
    if (key === "value") {
      const n = Number(value); if (Number.isFinite(n) && n >= 0) out[key] = Number(n.toFixed(2));
    } else if (key === "num_items") {
      const n = Number(value); if (Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
    } else if (key === "content_ids" && Array.isArray(value)) {
      out[key] = value.slice(0, 50).map((x) => String(x).slice(0, 200));
    } else if (key === "contents" && Array.isArray(value)) {
      out[key] = value.slice(0, 50).map((x) => ({
        id:String(x?.id||"").slice(0,200),
        quantity:Math.max(1,Math.floor(Number(x?.quantity||1))),
        item_price:Number.isFinite(Number(x?.item_price))?Number(Number(x.item_price).toFixed(2)):undefined
      })).filter((x)=>x.id);
    } else out[key] = String(value).slice(0, 500);
  }
  return out;
}
async function sendMetaCapiEvent({req,eventName,eventId,eventSourceUrl,phone="",customerName="",browserId="",fbp="",fbc="",customData={}}) {
  if (!META_CAPI_ENABLED) return { ok:false, disabled:true };
  const allowedEvents = new Set(["PageView","ViewContent","AddToCart","InitiateCheckout","Purchase"]);
  if (!allowedEvents.has(eventName)) return { ok:false, ignored:true };
  const safeEventId = String(eventId || crypto.randomUUID()).slice(0, 100);
  const event = {
    event_name:eventName,
    event_time:Math.floor(Date.now()/1000),
    event_source_url:String(eventSourceUrl || `${PUBLIC_BASE_URL}/comprar`).slice(0,2048),
    action_source:"website",
    event_id:safeEventId,
    user_data:buildMetaUserData({req,phone,customerName,browserId,fbp,fbc}),
    custom_data:cleanMetaCustomData(customData)
  };
  const body={data:[event]};
  if(META_CAPI_TEST_EVENT_CODE) body.test_event_code=META_CAPI_TEST_EVENT_CODE;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try {
    const response=await fetch(`https://graph.facebook.com/${encodeURIComponent(META_GRAPH_API_VERSION)}/${encodeURIComponent(META_PIXEL_ID)}/events?access_token=${encodeURIComponent(META_CAPI_ACCESS_TOKEN)}`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      console.error("Meta CAPI falhou:",{eventName,eventId:safeEventId,status:response.status,error:data?.error?.message||data?.error||data});
      return{ok:false,status:response.status,error:data?.error?.message||"Falha na Meta CAPI."};
    }
    console.log("Meta CAPI enviado:",{eventName,eventId:safeEventId,eventsReceived:data?.events_received,testEvent:Boolean(META_CAPI_TEST_EVENT_CODE)});
    return {ok:true,eventsReceived:data?.events_received??null,eventId:safeEventId};
  } catch(error) {
    console.error("Meta CAPI erro:",{eventName,eventId:safeEventId,error:error.name==="AbortError"?"timeout":error.message});
    return {ok:false,error:error.name==="AbortError"?"timeout":error.message};
  } finally {clearTimeout(timeout);}
}

const promotionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) return callback(new Error("Envie uma imagem JPG, PNG ou WEBP."));
    callback(null, true);
  }
});

const comboUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) return callback(new Error("A foto do combo deve ser JPG, PNG ou WEBP."));
    callback(null, true);
  }
});

const CONFIG = {
  deliveryFee: 7,
  pix: "02.597.025/0001-40",
  storeAddress: "Av. Paraná, 897, Centro, em frente à Eletro Comercial, Loanda",
  hours: "segunda a sábado, das 18h às 22h30",
  estimate: "40 a 60 minutos",
  tableCount: 17,
  pizzaPrices: {
    regular: { P: 60, M: 70, G: 80 },
    special: { P: 80, M: 90, G: 100 }
  },
  borders: {
    none: { name: "Sem borda recheada", P: 0, M: 0, G: 0 },
    catupiry: { name: "Borda de Catupiry", P: 3, M: 4, G: 5 },
    cheddar: { name: "Borda de Cheddar", P: 3, M: 4, G: 5 },
    chocolate: { name: "Borda de Chocolate", P: 5, M: 6, G: 7 }
  }
};

const PIZZA_FLAVORS = [
  { name: "Atum", category: "Tradicional", description: "Molho de tomate, mussarela, atum, orégano e azeitonas" },
  { name: "Baiana", category: "Tradicional", description: "Molho de tomate, mussarela, calabresa ralada, pimenta calabresa, orégano e azeitonas" },
  { name: "Brócolis com bacon", category: "Tradicional", description: "Molho de tomate, mussarela, brócolis, bacon, alho frito, orégano e azeitonas" },
  { name: "Calabresa", category: "Tradicional", description: "Molho de tomate, mussarela, calabresa, orégano e azeitonas" },
  { name: "Calabresa acebolada", category: "Tradicional", description: "Molho de tomate, mussarela, calabresa, cebola, orégano e azeitonas" },
  { name: "Coração de frango", category: "Tradicional", description: "Molho de tomate, mussarela, coração de frango fatiado, cebola, orégano e azeitonas" },
  { name: "Frango", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, orégano e azeitonas" },
  { name: "Frango catupiry", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, catupiry, orégano e azeitonas" },
  { name: "Frango com bacon", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, bacon, orégano e azeitonas" },
  { name: "Frango com cheddar", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, cheddar, orégano e azeitonas" },
  { name: "Frango com milho", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, milho, orégano e azeitonas" },
  { name: "Frango com palmito", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, palmito, orégano e azeitonas" },
  { name: "Frango cremoso", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, catupiry, bacon, milho, orégano e azeitonas" },
  { name: "Frango Mexicano", category: "Tradicional", description: "Molho de tomate, mussarela, frango desfiado, milho, pimentão, pimenta calabresa, orégano e azeitonas" },
  { name: "Lombo", category: "Tradicional", description: "Molho de tomate, mussarela, lombo, orégano e azeitonas" },
  { name: "Lombo catupiry", category: "Tradicional", description: "Molho de tomate, mussarela, lombo, catupiry, orégano e azeitonas" },
  { name: "Lombo com palmito", category: "Tradicional", description: "Molho de tomate, mussarela, lombo, palmito, orégano e azeitonas" },
  { name: "Margherita", category: "Tradicional", description: "Molho de tomate, mussarela, parmesão, tomate, manjericão, orégano e azeitonas" },
  { name: "Milho", category: "Tradicional", description: "Molho de tomate, mussarela, milho, orégano e azeitonas" },
  { name: "Mussarela", category: "Tradicional", description: "Molho de tomate, mussarela, tomate, orégano e azeitonas" },
  { name: "Napolitana", category: "Tradicional", description: "Molho de tomate, mussarela, parmesão, tomate, orégano e azeitonas" },
  { name: "Palmito", category: "Tradicional", description: "Molho de tomate, mussarela, palmito, orégano e azeitonas" },
  { name: "Pepperoni", category: "Tradicional", description: "Molho de tomate, mussarela, pepperoni, orégano e azeitonas" },
  { name: "Portuguesa", category: "Tradicional", description: "Molho de tomate, mussarela, presunto, ovo, ervilha, orégano e azeitonas" },
  { name: "Presunto", category: "Tradicional", description: "Molho de tomate, mussarela, presunto, tomate cereja, orégano e azeitonas" },
  { name: "Quatro queijos", category: "Tradicional", description: "Molho de tomate, mussarela, parmesão, catupiry, provolone, orégano e azeitonas" },
  { name: "Rúcula com tomate seco", category: "Tradicional", description: "Molho de tomate, mussarela, rúcula, tomate seco, orégano e azeitonas" },
  { name: "Tropical", category: "Tradicional", description: "Molho de tomate, mussarela, ervilha, milho, bacon, palmito, orégano e azeitonas" },
  { name: "Três queijos", category: "Tradicional", description: "Molho de tomate, mussarela, parmesão, catupiry, orégano e azeitonas" },
  { name: "Da Casa", category: "Especial", description: "Molho de tomate, mussarela, filé mignon, palmito, champignon, cebola, alho, orégano e azeitonas" },
  { name: "Carne seca", category: "Especial", description: "Molho de tomate, mussarela, carne seca, cebola, orégano e azeitonas" },
  { name: "Strogonoff de carne", category: "Especial", description: "Molho de tomate, mussarela, strogonoff de carne, batata palha, orégano e azeitonas" },
  { name: "Chocolate branco", category: "Doce", description: "Chocolate branco, morango, leite condensado e confete" },
  { name: "Chocolate com morango", category: "Doce", description: "Chocolate ao leite, morango fatiado e leite condensado" },
  { name: "Dois amores", category: "Doce", description: "Chocolate ao leite, chocolate branco e leite condensado" },
  { name: "Ouro Branco", category: "Doce", description: "Chocolate branco, bombom Ouro Branco e leite condensado" },
  { name: "Paçoca", category: "Doce", description: "Chocolate ao leite, paçoca triturada e leite condensado" },
  { name: "Prestígio", category: "Doce", description: "Chocolate ao leite, coco ralado e leite condensado" },
  { name: "Sonho de Valsa", category: "Doce", description: "Chocolate ao leite, bombom Sonho de Valsa e leite condensado" }

];

const FLAVORS = PIZZA_FLAVORS.map((item) => item.name);
const SPECIAL_FLAVORS = PIZZA_FLAVORS.filter((item) => item.category === "Especial").map((item) => item.name);
const FLAVOR_BY_NAME = new Map(PIZZA_FLAVORS.map((item) => [item.name, item]));

const PRODUCTS = {
  Lanches: [
    { name: "X-Burger", price: 18, description: "Pão de hambúrguer, blend bovino 150g, queijo, mussarela e molho especial" },
    { name: "X-Bacon salada", price: 28, description: "Pão brioche, carne bovina, queijo mussarela, presunto, bacon crocante, alface e tomate" },
    { name: "X-Salada", price: 20, description: "Pão brioche, blend bovino 150g, queijo mussarela, alface, tomate e maionese" },
    { name: "X-Frango", price: 25, description: "Pão brioche, frango em cubos, presunto, mussarela, alface e tomate" },
    { name: "X-Egg", price: 23, description: "Pão brioche, carne bovina, queijo mussarela, alface, tomate e ovo frito" },
    { name: "X-Calabresa", price: 25, description: "Pão brioche, blend bovino 150g, queijo mussarela, alface, tomate, maionese e calabresa" },
    { name: "Beirute frango", price: 50, description: "Beirute de frango" },
    { name: "Beirute filé mignon", price: 60, description: "Beirute de filé mignon" }
  ],
  Porções: [
    { name: "Porção de Tilápia", price: 45, description: "Tilápia em tiras empanadas e fritas" },
    { name: "Batata frita", price: 30, description: "Batata frita" },
    { name: "Calabresa acebolada", price: 35, description: "Calabresa na chapa com cebola" },
    { name: "Frango a passarinho", price: 35, description: "Frango a passarinho" },
    { name: "Costelinha de pacu", price: 45, description: "Costelinha de pacu" },
    { name: "Fígado acebolado", price: 30, description: "Fígado, cebola, pimentão e alho" },
    { name: "Coração de frango", price: 50, description: "Coração de frango" },
    { name: "Alcatra acebolada", price: 80, description: "Alcatra, cebola e pão sírio" },
    { name: "Picanha acebolada", price: 100, description: "Picanha, cebola e pão sírio" },
    { name: "Filé de frango acebolado", price: 50, description: "Filé de frango, cebola e pão sírio" },
    { name: "Costelinha barbecue", price: 149.90, description: "Acompanha arroz" }
  ],
  Bebidas: [
    { name: "Coca-Cola lata", price: 6 },
    { name: "Coca-Cola Zero lata", price: 6 },
    { name: "Fanta Laranja lata", price: 5 },
    { name: "Fanta Uva lata", price: 5 },
    { name: "Sprite lata", price: 5 },
    { name: "Água", price: 4 },
    { name: "Água com gás", price: 4 },
    { name: "Suco de polpa 360 ml", price: 10, description: "Uva, maracujá, morango, acerola e abacaxi" },
    { name: "Amstel 600 ml", price: 10 },
    { name: "Heineken 600 ml", price: 15 },
    { name: "Amstel lata", price: 7 },
    { name: "Heineken long neck", price: 10 }
  ],
  Drinks: [
    { name: "Dona Onça - Vodka", price: 28, description: "Morango, maracujá, açúcar e gelo" },
    { name: "Dona Onça - Velho Barreiro", price: 25, description: "Morango, maracujá, açúcar e gelo" },
    { name: "Dona Onça 2.0 - Vodka", price: 28, description: "Morango, maracujá, limão, açúcar e gelo" },
    { name: "Dona Onça 2.0 - Velho Barreiro", price: 25, description: "Morango, maracujá, limão, açúcar e gelo" },
    { name: "Batida de Abacaxi - Vodka", price: 30, description: "Abacaxi, açúcar, leite condensado e gelo" },
    { name: "Batida de Abacaxi - Velho Barreiro", price: 30, description: "Abacaxi, açúcar, leite condensado e gelo" },
    { name: "Batida de Morango - Vodka", price: 30, description: "Morango, açúcar, leite condensado e gelo" },
    { name: "Batida de Morango - Velho Barreiro", price: 30, description: "Morango, açúcar, leite condensado e gelo" },
    { name: "Caipirinha de Morango - Vodka", price: 30, description: "Morango, açúcar e gelo" },
    { name: "Caipirinha de Morango - Velho Barreiro", price: 30, description: "Morango, açúcar e gelo" },
    { name: "Caipirinha de Limão - Vodka", price: 28, description: "Limão, açúcar e gelo" },
    { name: "Caipirinha de Limão - Velho Barreiro", price: 25, description: "Limão, açúcar e gelo" },
    { name: "Caipirinha de Maracujá - Vodka", price: 28, description: "Maracujá, açúcar e gelo" },
    { name: "Caipirinha de Maracujá - Velho Barreiro", price: 25, description: "Maracujá, açúcar e gelo" },
    { name: "Espanhola", price: 30, description: "Vinho, abacaxi e leite condensado" },
    { name: "Limonet", price: 30, description: "Limão, gelo, vodka e leite condensado" },
    { name: "Tombadinha", price: 30, description: "Vodka, limão, gelo, açúcar e picolé de gelo" },
    { name: "Esqueci Meu CPF", price: 30, description: "Vodka, maracujá, gelo, açúcar e picolé de maracujá" },
    { name: "Congela Coração", price: 30, description: "Vodka, morango, gelo, açúcar e picolé de morango" }
  ],
  Doces: [
    { name: "Sweetburguer Brigadeiro", price: 28, description: "Bolo, hambúrguer de brigadeiro, morango e calda de chocolate branco" },
    { name: "Sweetburguer Oreo", price: 28, description: "Bolo, hambúrguer de brigadeiro de Oreo, crispys de Nutella e calda de chocolate branco" },
    { name: "Petit gâteau", price: 18, description: "" }
  ]
};


const CUSTOMER_ORDER_SITE_HTML = "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<title>Comprar — MR Pizzaria</title>\n<meta name=\"description\" content=\"Faça seu pedido online na MR Pizzaria, em Loanda/PR.\">\n<style>\n:root{--red:#a3161c;--red2:#7b0d12;--yellow:#f6b900;--ink:#211d1a;--muted:#6e655f;--paper:#fffdfa;--line:#eadfd5;--soft:#f8f1ea;--ok:#18723c;--shadow:0 12px 32px rgba(80,31,16,.12)}\n*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f6f0e9;color:var(--ink);font-family:Arial,Helvetica,sans-serif}.top{background:linear-gradient(135deg,var(--red2),var(--red));color:#fff;padding:18px 16px;position:sticky;top:0;z-index:30;box-shadow:0 3px 18px #0003}.topin{max-width:1100px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-weight:900;font-size:22px;letter-spacing:.4px}.brand span{color:var(--yellow)}.cartpill{border:0;border-radius:999px;padding:10px 14px;background:var(--yellow);color:#291d00;font-weight:800;cursor:pointer}.wrap{max-width:1100px;margin:auto;padding:18px}.hero{background:#fff;border-radius:20px;padding:22px;box-shadow:var(--shadow);display:grid;grid-template-columns:1.3fr .7fr;gap:18px;align-items:center}.hero h1{margin:0 0 8px;font-size:34px}.hero p{color:var(--muted);font-size:16px;line-height:1.5}.heroBadge{background:var(--soft);border:1px solid var(--line);padding:18px;border-radius:16px}.heroBadge b{display:block;color:var(--red);font-size:18px;margin-bottom:7px}.promo{display:none;margin-top:18px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}.promo.show{display:grid;grid-template-columns:minmax(220px,.8fr) 1.2fr}.promo img{width:100%;height:100%;max-height:420px;object-fit:cover;background:#eee}.promoText{padding:24px;display:flex;flex-direction:column;justify-content:center}.promoText h2{margin:0 0 10px;color:var(--red)}.promoText p{white-space:pre-wrap;line-height:1.55}.featuredCombos{display:none;margin-top:20px;background:linear-gradient(135deg,#fff7db,#fff);border:2px solid #f0bd24;border-radius:20px;padding:20px;box-shadow:var(--shadow)}.featuredCombos.show{display:block}.featuredHead{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px}.featuredHead h2{margin:0;color:var(--red)}.featuredHead p{margin:5px 0 0;color:var(--muted)}.comboGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.comboCard{position:relative;background:#fff;border:2px solid #f0c956;border-radius:16px;padding:16px;box-shadow:0 8px 22px rgba(109,55,8,.09);overflow:hidden}.comboCard img{display:block;width:calc(100% + 32px);height:190px;object-fit:cover;margin:-16px -16px 14px;background:#f3eee8}.comboCard:before{content:\"COMBO\";position:absolute;top:10px;right:10px;font-size:10px;font-weight:900;letter-spacing:1px;color:#7b0d12;background:#ffe892;padding:5px 7px;border-radius:999px}.comboCard h3{margin:0 60px 7px 0}.comboCard p{color:var(--muted);line-height:1.45;min-height:42px}.comboCard .price{font-size:22px}.btn{border:0;border-radius:12px;padding:13px 16px;font-weight:800;cursor:pointer}.primary{background:var(--red);color:#fff}.primary:hover{background:var(--red2)}.secondary{background:var(--yellow);color:#2d2000}.ghost{background:#fff;border:1px solid var(--line)}.section{margin-top:20px;background:#fff;border-radius:20px;padding:20px;box-shadow:var(--shadow)}.section h2{margin:0 0 14px}.tabs{display:flex;gap:8px;overflow:auto;padding-bottom:8px}.tab{white-space:nowrap;border:1px solid var(--line);background:#fff;border-radius:999px;padding:10px 14px;font-weight:800;cursor:pointer}.tab.active{background:var(--red);color:#fff;border-color:var(--red)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{border:1px solid var(--line);border-radius:15px;padding:15px;background:var(--paper)}.card h3{margin:0 0 6px;font-size:17px}.price{font-weight:900;color:var(--red);font-size:18px}.row{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.field{margin-bottom:12px}.field label{display:block;font-size:13px;font-weight:800;margin:0 0 6px}.field input,.field select,.field textarea{width:100%;border:1px solid #d7cbc1;border-radius:10px;padding:11px 12px;font:inherit;background:#fff}.field textarea{min-height:76px;resize:vertical}.pizzaBox{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:16px}.cartEmpty{text-align:center;color:var(--muted);padding:22px}.cartItem{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px 0;border-bottom:1px dashed var(--line)}.cartItem b{display:block}.cartItem small{color:var(--muted);line-height:1.4}.remove{border:0;background:#ffe9e8;color:#8d1116;border-radius:9px;padding:8px;cursor:pointer}.summary{margin-top:15px;background:var(--soft);border-radius:14px;padding:15px}.sumline{display:flex;justify-content:space-between;margin:7px 0}.sumline.total{font-size:20px;font-weight:900;color:var(--red);border-top:1px solid var(--line);padding-top:10px}.checkoutGrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.checkoutSteps{display:flex;gap:8px;margin:0 0 18px;flex-wrap:wrap}.checkoutSteps span{padding:9px 12px;border-radius:999px;background:#eee;color:#6e655f;font-weight:800}.checkoutSteps span.active{background:var(--red);color:#fff}.paymentSummary{background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0 14px}.paymentSummary b{font-size:24px;color:var(--red)}.payGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:12px 0}.payOption{border:2px solid var(--line);border-radius:14px;background:#fff;padding:15px;text-align:left;cursor:pointer;font:inherit}.payOption strong{display:block;font-size:17px}.payOption small{display:block;color:var(--muted);margin-top:4px;line-height:1.35}.payOption.selected{border-color:var(--red);box-shadow:0 0 0 2px #a3161c18;background:#fff8f8}.notice{padding:12px;border-radius:12px;background:#fff6d8;border:1px solid #f0d67b;line-height:1.45}.success{display:none;background:#e8f7ee;color:#155f33;border:1px solid #a6d9b8;padding:18px;border-radius:14px;margin-top:14px}.success.show{display:block}.error{display:none;background:#ffeded;color:#8b1717;border:1px solid #efb3b3;padding:13px;border-radius:12px;margin-top:12px}.error.show{display:block}.loading{opacity:.65;pointer-events:none}.footer{text-align:center;color:var(--muted);padding:28px 10px 90px}.sticky{display:none;position:fixed;left:12px;right:12px;bottom:12px;z-index:40}.sticky button{width:100%;box-shadow:0 8px 24px #0004}.hidden{display:none!important}\n@media(max-width:780px){.hero,.promo.show,.checkoutGrid{grid-template-columns:1fr}.payGrid{grid-template-columns:1fr}.comboGrid{grid-template-columns:1fr 1fr}.hero h1{font-size:28px}.grid{grid-template-columns:1fr 1fr}.row{grid-template-columns:1fr}.wrap{padding:12px}.section{padding:15px}.sticky{display:block}}\n@media(max-width:480px){.grid,.comboGrid{grid-template-columns:1fr}.brand{font-size:19px}}\n</style>\n<!--META_PIXEL_BOOTSTRAP-->\n</head>\n<body>\n<header class=\"top\"><div class=\"topin\"><div class=\"brand\">MR <span>PIZZARIA</span></div><button class=\"cartpill\" onclick=\"goCart()\">🛒 Carrinho <span id=\"cartCount\">0</span></button></div></header>\n<main class=\"wrap\">\n<section class=\"hero\"><div><h1>Peça pelo nosso site 🍕</h1><p>Monte seu pedido, escolha entrega, retirada ou consumo no local. O pedido entra diretamente no painel e na fila da pizzaria.</p><div style=\"display:flex;gap:10px;flex-wrap:wrap\"><button class=\"btn primary\" onclick=\"document.getElementById('menu').scrollIntoView()\">Ver cardápio</button><a class=\"btn secondary\" style=\"text-decoration:none;display:inline-block\" href=\"/cardapio-mr-pizzaria.pdf\" download=\"cardapio-mr-pizzaria.pdf\">Baixar cardápio em PDF</a></div></div><div class=\"heroBadge\"><b>MR Pizzaria — Loanda/PR</b><div>Av. Paraná, 897, Centro</div><div>Segunda a sábado, 18h às 22h30</div><div>Previsão: 40 a 60 minutos</div></div></section>\n<section id=\"promo\" class=\"promo\"><img id=\"promoImg\" alt=\"Promoção da MR Pizzaria\"><div class=\"promoText\"><h2>🔥 Promoção do dia</h2><p id=\"promoCopy\"></p><button id=\"promoOrderBtn\" class=\"btn primary\" type=\"button\" onclick=\"document.getElementById('menu').scrollIntoView()\">Fazer pedido</button><div id=\"promoCombo\" class=\"hidden\" style=\"margin-top:14px;padding-top:14px;border-top:1px solid var(--line)\"><h3 style=\"margin:0 0 12px\">Escolha os sabores da promoção</h3><div class=\"field\"><label>1º sabor da pizza grande</label><select id=\"promoFlavor1\"></select></div><div class=\"field\"><label>2º sabor (opcional)</label><select id=\"promoFlavor2\"></select></div><div class=\"field\"><label>Observação dos sabores (opcional)</label><input id=\"promoNote\" maxlength=\"250\" placeholder=\"Ex.: sem cebola, massa bem assada\"></div><div class=\"notice\">Inclui <b>1 pizza grande</b> e <b>1 brotinha de chocolate com morango</b> por <b>R$ 110,00</b>. Escolha 1 ou 2 sabores.</div><div style=\"display:flex;gap:10px;flex-wrap:wrap;margin-top:10px\"><button class=\"btn primary\" type=\"button\" onclick=\"addPromoCombo()\">Adicionar combo ao carrinho</button><button class=\"btn ghost\" type=\"button\" onclick=\"closePromoCombo()\">Fechar</button></div></div></div></section>\n<section id=\"featuredCombos\" class=\"featuredCombos\"><div class=\"featuredHead\"><div><h2>⭐ Combos em destaque</h2><p>Opções fixas do cardápio, separadas das promoções do dia.</p></div><button class=\"btn ghost\" type=\"button\" onclick=\"document.getElementById('menu').scrollIntoView()\">Ver cardápio completo</button></div><div id=\"comboGrid\" class=\"comboGrid\"></div></section>\n<section id=\"menu\" class=\"section\"><div style=\"display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap\"><h2 style=\"margin:0\">Cardápio</h2><a class=\"btn secondary\" style=\"text-decoration:none;display:inline-block\" href=\"/cardapio-mr-pizzaria.pdf\" download=\"cardapio-mr-pizzaria.pdf\">Baixar PDF</a></div><div class=\"tabs\" id=\"tabs\" style=\"margin-top:14px\"></div><div id=\"pizzaArea\" class=\"pizzaBox\"></div><div id=\"products\" class=\"grid\"></div></section>\n<section id=\"carrinho\" class=\"section\"><h2>Seu carrinho</h2><div id=\"cartList\"></div><div class=\"summary\"><div class=\"sumline\"><span>Subtotal</span><b id=\"subtotal\">R$ 0,00</b></div><div class=\"sumline\"><span>Taxa de entrega</span><b id=\"deliveryFee\">R$ 0,00</b></div><div class=\"sumline total\"><span>Total</span><span id=\"total\">R$ 0,00</span></div></div></section>\n<section id=\"checkout\" class=\"section\"><h2>Finalizar pedido</h2><div class=\"checkoutSteps\"><span id=\"stepDetailsBadge\" class=\"active\">1. Dados do pedido</span><span id=\"stepPaymentBadge\">2. Pagamento</span></div><form id=\"checkoutForm\"><input type=\"text\" name=\"company\" class=\"hidden\" tabindex=\"-1\" autocomplete=\"off\"><div id=\"checkoutDetailsStep\"><div class=\"checkoutGrid\"><div><div class=\"field\"><label>Nome</label><input id=\"customerName\" required maxlength=\"80\" autocomplete=\"name\"></div><div class=\"field\"><label>WhatsApp</label><input id=\"phone\" required inputmode=\"tel\" placeholder=\"(44) 99999-9999\" autocomplete=\"tel\"></div><div class=\"field\"><label>Como deseja receber?</label><select id=\"deliveryType\"><option>Entrega</option><option>Retirada</option><option>Consumir no local</option></select></div></div><div><div id=\"addressFields\"><div class=\"row\"><div class=\"field\"><label>Rua/Avenida</label><input id=\"street\" maxlength=\"120\"></div><div class=\"field\"><label>Número</label><input id=\"number\" maxlength=\"20\"></div></div><div class=\"row\"><div class=\"field\"><label>Bairro</label><input id=\"district\" maxlength=\"80\"></div><div class=\"field\"><label>Referência</label><input id=\"reference\" maxlength=\"150\"></div></div></div><div id=\"tableField\" class=\"hidden\"><div class=\"row\"><div class=\"field\"><label>Número da mesa (1 a 17)</label><input id=\"tableNumber\" type=\"number\" min=\"1\" max=\"17\" placeholder=\"Ex.: 5\"></div><div class=\"field\"><label>Nome da comanda</label><input id=\"commandName\" maxlength=\"80\" placeholder=\"Ex.: João ou Comanda geral\"></div></div><div class=\"row\"><div class=\"field\"><label>Garçom</label><input id=\"waiterName\" maxlength=\"80\" placeholder=\"Nome do garçom\"></div><div class=\"field hidden\"><label>Código da comanda</label><input id=\"tabCode\" maxlength=\"30\"></div></div></div><div class=\"notice\">Na entrega, a taxa é de <b>R$ 7,00</b>. Retirada e consumo no local não têm taxa.</div><label style=\"display:flex;gap:9px;align-items:flex-start;margin-top:14px;line-height:1.4\"><input id=\"recoveryOptIn\" type=\"checkbox\" style=\"width:auto;margin-top:3px\"> <span><b>Lembrete do carrinho:</b> se eu sair sem finalizar, a MR Pizzaria pode me lembrar deste carrinho pelo WhatsApp.</span></label><label style=\"display:flex;gap:9px;align-items:flex-start;margin-top:10px;line-height:1.4\"><input id=\"marketingConsent\" type=\"checkbox\" style=\"width:auto;margin-top:3px\"> <span>Autorizo a medição de campanhas do Facebook/Instagram para melhorar ofertas e anúncios.</span></label></div></div><button id=\"continuePaymentBtn\" class=\"btn primary\" style=\"width:100%;margin-top:16px\" type=\"button\" onclick=\"showPaymentStep()\">Continuar para pagamento</button></div><div id=\"checkoutPaymentStep\" class=\"hidden\"><h3 style=\"margin:0\">Como deseja pagar?</h3><p style=\"color:var(--muted)\">Escolha entre pagar agora com segurança pelo Pagar.me ou pagar no local.</p><div class=\"paymentSummary\"><span>Total do pedido</span><br><b id=\"paymentTotal\">R$ 0,00</b></div><input id=\"payment\" type=\"hidden\" value=\"\"><div id=\"onlinePayBlock\"><h4 style=\"margin:12px 0 4px;color:var(--red)\">Pagar agora pelo site</h4><div class=\"payGrid\"><button id=\"payPixOnline\" class=\"payOption\" type=\"button\" data-payment=\"Pix online\" onclick=\"selectPayment('Pix online')\"><strong>⚡ Pix online</strong><small>Abre o checkout seguro do Pagar.me e confirma automaticamente quando o pagamento for aprovado.</small></button><button id=\"payCardOnline\" class=\"payOption\" type=\"button\" data-payment=\"Cartão de crédito online\" onclick=\"selectPayment('Cartão de crédito online')\"><strong>🔒 Crédito online — 1x</strong><small>Dados do cartão são preenchidos no ambiente seguro do Pagar.me. A MR Pizzaria não recebe o número do cartão.</small></button></div><div id=\"onlineTestNotice\" class=\"notice hidden\"><b>Ambiente de teste:</b> nenhuma cobrança real será feita enquanto as chaves de teste estiverem configuradas.</div></div><h4 style=\"margin:18px 0 4px;color:var(--red)\">Pagar no local</h4><div class=\"payGrid\"><button class=\"payOption\" type=\"button\" data-payment=\"Cartão de crédito\" onclick=\"selectPayment('Cartão de crédito')\"><strong>💳 Crédito na máquina</strong><small>Pagamento presencial na entrega ou retirada.</small></button><button class=\"payOption\" type=\"button\" data-payment=\"Cartão de débito\" onclick=\"selectPayment('Cartão de débito')\"><strong>💳 Débito na máquina</strong><small>Pagamento presencial na entrega ou retirada.</small></button><button class=\"payOption\" type=\"button\" data-payment=\"Pix\" onclick=\"selectPayment('Pix')\"><strong>📱 Pix no local</strong><small>Pagamento via Pix na entrega ou retirada.</small></button><button class=\"payOption\" type=\"button\" data-payment=\"Dinheiro\" onclick=\"selectPayment('Dinheiro')\"><strong>💵 Dinheiro</strong><small>Informe o troco se precisar.</small></button><button id=\"payMesaOption\" class=\"payOption hidden\" type=\"button\" data-payment=\"Conta da mesa\" onclick=\"selectPayment('Conta da mesa')\"><strong>🧾 Conta da mesa</strong><small>Somente para consumo no salão.</small></button></div><div id=\"changeField\" class=\"field hidden\"><label>Troco para quanto?</label><input id=\"changeFor\" inputmode=\"decimal\" placeholder=\"Ex.: 100,00\"></div><div id=\"paymentNotice\" class=\"notice\"><b>Pagamento no local:</b> o pedido será confirmado sem abrir cobrança online.</div><div class=\"row\" style=\"margin-top:14px\"><button class=\"btn ghost\" type=\"button\" onclick=\"backToDetails()\">Voltar</button><button id=\"finishBtn\" class=\"btn primary\" type=\"submit\">Confirmar pedido</button></div></div><div id=\"formError\" class=\"error\"></div><div id=\"success\" class=\"success\"></div></form></section>\n</main>\n<div class=\"sticky\"><button class=\"btn secondary\" onclick=\"goCart()\">Ver carrinho — <span id=\"stickyTotal\">R$ 0,00</span></button></div>\n<footer class=\"footer\">MR Pizzaria • WhatsApp (44) 3425-2285 • Loanda/PR • <a href=\"/privacy\" target=\"_blank\" rel=\"noopener\">Privacidade</a></footer>\n<script>\nlet catalog=null;let cart=[];let activeCategory='Pizza';\nconst brl=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));\nconst esc=s=>String(s||'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#039;'}[c]));\nfunction marketingAllowed(){return localStorage.getItem('mr_marketing_consent')==='yes'}\nfunction metaEventId(eventName){return `${eventName}_${Date.now().toString(36)}_${(window.crypto&&crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2))}`.slice(0,100)}\nfunction metaCookie(name){const prefix=name+'=';for(const part of String(document.cookie||'').split(';')){const c=part.trim();if(c.startsWith(prefix))return decodeURIComponent(c.slice(prefix.length))}return''}\nfunction metaBrowserId(){let id=localStorage.getItem('mr_meta_browser_id');if(!id){id=window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);localStorage.setItem('mr_meta_browser_id',id)}return id}\nfunction metaIdentity(){return{browserId:metaBrowserId(),fbp:metaCookie('_fbp'),fbc:metaCookie('_fbc'),phone:document.getElementById('phone')?.value||'',customerName:document.getElementById('customerName')?.value||''}}\nfunction sendMetaServerEvent(eventName,params,eventId){if(!window.MR_META_CAPI_ENABLED||!marketingAllowed())return;const identity=metaIdentity();fetch('/api/meta/event',{method:'POST',headers:{'content-type':'application/json'},keepalive:true,body:JSON.stringify({consent:true,eventName,eventId,eventSourceUrl:location.href,customData:params,...identity})}).catch(()=>{})}\nfunction metaTrack(eventName,params={},eventId='',options={}){if(!marketingAllowed())return'';const id=eventId||metaEventId(eventName);try{if(typeof window.fbq==='function')window.fbq('track',eventName,params,{eventID:id})}catch(_e){}if(options.server!==false)sendMetaServerEvent(eventName,params,id);return id}\nfunction startMetaPixel(){const id=String(window.MR_META_PIXEL_ID||'').trim();if(window.__mrMetaStarted)return;window.__mrMetaStarted=true;if(id){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',id)}metaTrack('PageView',{content_name:'Site MR Pizzaria'})}\nfunction loadMarketingPreference(){const box=document.getElementById('marketingConsent');const pref=localStorage.getItem('mr_marketing_consent');if(box)box.checked=pref==='yes';if(pref==='yes')startMetaPixel()}\nfunction updateMarketingConsent(){const box=document.getElementById('marketingConsent');if(!box)return;localStorage.setItem('mr_marketing_consent',box.checked?'yes':'no');if(box.checked)startMetaPixel()}\nfunction cartToken(){let token=localStorage.getItem('mr_cart_token');if(!token){token=(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));localStorage.setItem('mr_cart_token',token)}return token}\nfunction restoreLocalCart(){try{const saved=JSON.parse(localStorage.getItem('mr_cart')||'[]');if(Array.isArray(saved))cart=saved.slice(0,50)}catch(_e){cart=[]}}\nfunction persistLocalCart(){try{if(cart.length)localStorage.setItem('mr_cart',JSON.stringify(cart));else localStorage.removeItem('mr_cart')}catch(_e){}}\nlet abandonedSaveTimer=null;\nfunction scheduleAbandonedCartSave(){persistLocalCart();clearTimeout(abandonedSaveTimer);abandonedSaveTimer=setTimeout(saveAbandonedCart,1800)}\nasync function saveAbandonedCart(){const opt=document.getElementById('recoveryOptIn');if(!opt?.checked||!cart.length)return;const phone=document.getElementById('phone')?.value||'';if(phone.replace(/\\D/g,'').length<10)return;const type=document.getElementById('deliveryType')?.value||'Entrega';const payload={company:'',cartToken:cartToken(),customerName:document.getElementById('customerName')?.value||'',phone,deliveryType:type,address:{street:document.getElementById('street')?.value||'',number:document.getElementById('number')?.value||'',district:document.getElementById('district')?.value||'',reference:document.getElementById('reference')?.value||''},items:cart.map(({unit,label,...x})=>x),recoveryOptIn:true};try{await fetch('/api/site/abandoned-cart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})}catch(_e){}}\nfunction goCart(){document.getElementById('carrinho').scrollIntoView()}\nasync function init(){restoreLocalCart();const r=await fetch('/api/site/catalog');catalog=await r.json();renderFeaturedCombos();renderTabs();selectCategory('Pizza');renderCart();applyQueryPrefill();loadPromo();loadMarketingPreference()}\nfunction applyQueryPrefill(){const q=new URLSearchParams(location.search);const mesa=q.get('mesa');const comanda=q.get('comanda');const cliente=q.get('cliente');const garcom=q.get('garcom');const modo=q.get('modo');if(mesa){document.getElementById('deliveryType').value='Consumir no local';document.getElementById('tableNumber').value=mesa}if(comanda)document.getElementById('tabCode').value=comanda;if(cliente){document.getElementById('customerName').value=cliente;document.getElementById('commandName').value=cliente}if(garcom)document.getElementById('waiterName').value=garcom;if(modo==='garcom'){document.getElementById('phone').required=false;document.getElementById('phone').placeholder='Opcional para pedido da mesa';selectPayment('Conta da mesa')}updateDelivery();updatePayment()}\nasync function loadPromo(){try{const r=await fetch('/api/site/promotion');const p=await r.json();if(!p.active)return;document.getElementById('promoCopy').textContent=p.text||'Confira nossa promoção especial.';const img=document.getElementById('promoImg');if(p.hasImage){img.src=p.imageUrl}else{img.classList.add('hidden')}setupPromoCombo(p.text||'');document.getElementById('promo').classList.add('show')}catch(e){}}\nfunction setupPromoCombo(promoText){const flavors=['Calabresa','Mussarela','Frango catupiry','Tomate seco'];const first=document.getElementById('promoFlavor1');const second=document.getElementById('promoFlavor2');if(!first||!second)return;first.innerHTML=flavors.map(f=>`<option value=\"${esc(f)}\">${esc(f)}</option>`).join('');second.innerHTML=['<option value=\"\">Apenas 1 sabor</option>',...flavors.map(f=>`<option value=\"${esc(f)}\">${esc(f)}</option>`)].join('');const btn=document.getElementById('promoOrderBtn');btn.textContent='Comprar esta promoção';btn.onclick=openPromoCombo}\nfunction openPromoCombo(){const box=document.getElementById('promoCombo');box.classList.remove('hidden');box.scrollIntoView({behavior:'smooth',block:'center'})}\nfunction closePromoCombo(){document.getElementById('promoCombo').classList.add('hidden')}\nfunction addPromoCombo(){const flavor1=document.getElementById('promoFlavor1').value;const flavor2=document.getElementById('promoFlavor2').value;const note=document.getElementById('promoNote').value.trim();if(!flavor1){alert('Escolha o primeiro sabor da promoção.');return}if(flavor2&&flavor1===flavor2){alert('Escolha sabores diferentes ou deixe apenas um sabor.');return}const label=`Combo promoção — Pizza grande ${flavor2?`½ ${flavor1} / ½ ${flavor2}`:flavor1} + Brotinha de chocolate com morango`;cart.push({kind:'promo_combo',qty:1,flavor1,flavor2,note,unit:110,label});metaTrack('AddToCart',{currency:'BRL',value:110,content_name:label,content_category:'Promoção'});renderCart();goCart()}\nfunction traditionalFlavorOptions(){return ['<option value=\"\">Escolha o sabor</option>',...(catalog.flavorDetails||[]).filter(f=>f.category==='Tradicional').map(f=>`<option value=\"${esc(f.name)}\">${esc(f.name)}</option>`)].join('')}\nfunction renderFeaturedCombos(){const combos=(catalog.featuredCombos||[]).filter(x=>x.active!==false);const section=document.getElementById('featuredCombos');const grid=document.getElementById('comboGrid');if(!section||!grid)return;if(!combos.length){section.classList.remove('show');grid.innerHTML='';return}const flavors=traditionalFlavorOptions();section.classList.add('show');grid.innerHTML=combos.map((c,i)=>`<article class=\"comboCard\">${c.hasImage?`<img src=\"/combo/${Number(c.id)}/imagem?v=${encodeURIComponent(c.updatedAt||'1')}\" alt=\"${esc(c.name)}\" loading=\"lazy\">`:''}<h3>${esc(c.name)}</h3>${c.description?`<p>${esc(c.description)}</p>`:'<p>Combo especial da MR Pizzaria.</p>'}<div class=\"price\">${brl(c.price)}</div><div class=\"field\" style=\"margin-top:10px\"><label>1º sabor da pizza grande</label><select id=\"combo_f1_${i}\">${flavors}</select></div><div class=\"field\"><label>2º sabor (opcional)</label><select id=\"combo_f2_${i}\"><option value=\"\">Apenas 1 sabor</option>${flavors.replace('<option value=\"\">Escolha o sabor</option>','')}</select></div><div class=\"field\"><label>Observação dos sabores (opcional)</label><input id=\"combo_note_${i}\" maxlength=\"250\" placeholder=\"Ex.: sem cebola, massa bem assada\"></div><div class=\"field\"><label>Quantidade</label><input id=\"combo_q_${i}\" type=\"number\" min=\"1\" max=\"20\" value=\"1\"></div><button class=\"btn primary\" type=\"button\" onclick=\"addFeaturedCombo(${Number(c.id)},${i})\">Adicionar combo</button></article>`).join('')}\nfunction addFeaturedCombo(comboId,i){const c=(catalog.featuredCombos||[]).find(x=>Number(x.id)===Number(comboId));if(!c)return;const flavor1=document.getElementById('combo_f1_'+i)?.value||'';const flavor2=document.getElementById('combo_f2_'+i)?.value||'';const note=document.getElementById('combo_note_'+i)?.value.trim()||'';if(!flavor1){alert('Escolha o primeiro sabor da pizza grande.');return}if(flavor2&&flavor1===flavor2){alert('Escolha sabores diferentes ou deixe apenas um sabor.');return}const qty=Math.max(1,Math.min(20,Number(document.getElementById('combo_q_'+i)?.value)||1));const label=`${c.name} — Pizza grande ${flavor2?`½ ${flavor1} / ½ ${flavor2}`:flavor1}`;cart.push({kind:'combo',comboId:Number(c.id),qty,flavor1,flavor2,note,unit:Number(c.price),label});metaTrack('AddToCart',{currency:'BRL',value:Number(c.price)*qty,content_name:label,content_category:'Combo'});renderCart();goCart()}\nfunction renderTabs(){const cats=['Pizza',...Object.keys(catalog.products)];document.getElementById('tabs').innerHTML=cats.map(c=>`<button class=\"tab ${c===activeCategory?'active':''}\" onclick='selectCategory(${JSON.stringify(c)})'>${esc(c)}</button>`).join('')}\nfunction selectCategory(c){activeCategory=c;renderTabs();document.getElementById('pizzaArea').classList.toggle('hidden',c!=='Pizza');document.getElementById('products').classList.toggle('hidden',c==='Pizza');if(c==='Pizza')renderPizza();else renderProducts(c);metaTrack('ViewContent',{content_name:'Cardápio MR Pizzaria',content_category:c})}\nfunction flavorOptions(){return ['Tradicional','Especial','Doce'].map(cat=>{const items=(catalog.flavorDetails||[]).filter(f=>f.category===cat);return items.length?`<optgroup label=\"${esc(cat)}\">${items.map(f=>`<option value=\"${esc(f.name)}\">${esc(f.name)}</option>`).join('')}</optgroup>`:''}).join('')}\nlet pizzaFlavorCount=1;\nfunction renderPizza(){const flavors=flavorOptions();document.getElementById('pizzaArea').innerHTML=`<h3>Monte sua pizza</h3><div class=\"notice\" style=\"margin-bottom:12px\">Tradicionais: P R$ 60, M R$ 70, G R$ 80. Especiais: P R$ 80, M R$ 90, G R$ 100. Pequena: 1 sabor. Média e grande: escolha 1 ou 2 sabores.</div><div class=\"field\"><label>Tamanho</label><select id=\"pzSize\" onchange=\"syncPizzaSize()\"><option value=\"\">Selecione o tamanho</option><option value=\"P\">Pequena — 1 sabor</option><option value=\"M\">Média — 1 ou 2 sabores</option><option value=\"G\">Grande — 1 ou 2 sabores</option></select></div><div id=\"pizzaChoices\" class=\"hidden\"><div class=\"field hidden\" id=\"flavorCountField\"><label>Quantos sabores?</label><div style=\"display:flex;gap:10px;flex-wrap:wrap\"><button id=\"pzOneFlavor\" class=\"btn primary\" type=\"button\" onclick=\"setPizzaFlavorCount(1)\">1 sabor</button><button id=\"pzTwoFlavors\" class=\"btn ghost\" type=\"button\" onclick=\"setPizzaFlavorCount(2)\">2 sabores</button></div></div><div class=\"row\" id=\"pizzaFlavorRow\"><div class=\"field\"><label>1º sabor</label><select id=\"pzF1\"><option value=\"\">Nenhum</option>${flavors}</select></div><div class=\"field hidden\" id=\"secondFlavorField\"><label>2º sabor</label><select id=\"pzF2\"><option value=\"\">Nenhum</option>${flavors}</select></div></div><div class=\"row\"><div class=\"field\"><label>Borda</label><select id=\"pzBorder\"><option value=\"none\">Sem borda</option><option value=\"catupiry\">Catupiry</option><option value=\"cheddar\">Cheddar</option><option value=\"chocolate\">Chocolate</option></select></div><div class=\"field\"><label>Quantidade</label><input id=\"pzQty\" type=\"number\" min=\"1\" max=\"20\" value=\"1\"></div></div><div class=\"field\"><label>Observação</label><input id=\"pzNote\" maxlength=\"250\" placeholder=\"Ex.: sem cebola\"></div><button class=\"btn primary\" type=\"button\" onclick=\"addPizza()\">Adicionar pizza</button></div>`;pizzaFlavorCount=1;syncPizzaSize()}\nfunction setPizzaFlavorCount(count){pizzaFlavorCount=Number(count)===2?2:1;const second=document.getElementById('secondFlavorField');const f2=document.getElementById('pzF2');const one=document.getElementById('pzOneFlavor');const two=document.getElementById('pzTwoFlavors');if(pizzaFlavorCount===1&&f2)f2.value='';if(second)second.classList.toggle('hidden',pizzaFlavorCount!==2);if(one){one.classList.toggle('primary',pizzaFlavorCount===1);one.classList.toggle('ghost',pizzaFlavorCount!==1)}if(two){two.classList.toggle('primary',pizzaFlavorCount===2);two.classList.toggle('ghost',pizzaFlavorCount!==2)}}\nfunction syncPizzaSize(){const size=document.getElementById('pzSize')?.value||'';const choices=document.getElementById('pizzaChoices');const countField=document.getElementById('flavorCountField');if(choices)choices.classList.toggle('hidden',!size);if(!size)return;const small=size==='P';if(small)pizzaFlavorCount=1;if(countField)countField.classList.toggle('hidden',small);setPizzaFlavorCount(small?1:pizzaFlavorCount)}\nfunction productPrice(cat,name){const p=(catalog.products[cat]||[]).find(x=>x.name===name);return p?Number(p.price):0}\nfunction pizzaUnit(x){const special=new Set(catalog.specialFlavors||[]);const first=(special.has(x.flavor1)?catalog.pizzaPrices.special:catalog.pizzaPrices.regular)[x.size];const second=x.flavor2?(special.has(x.flavor2)?catalog.pizzaPrices.special:catalog.pizzaPrices.regular)[x.size]:first;const base=x.flavor2?(first+second)/2:first;return base+Number(catalog.borders[x.borderKey][x.size])}\nfunction addPizza(){const size=document.getElementById('pzSize').value;if(!size){alert('Escolha o tamanho da pizza.');return}const flavor1=document.getElementById('pzF1').value;const useTwo=size!=='P'&&pizzaFlavorCount===2;const flavor2=useTwo?document.getElementById('pzF2').value:'';if(!flavor1){alert('Escolha o sabor da pizza.');return}if(useTwo&&!flavor2){alert('Escolha o segundo sabor ou marque a opção 1 sabor.');return}const x={kind:'pizza',size,flavor1,flavor2,borderKey:document.getElementById('pzBorder').value,qty:Math.max(1,Math.min(20,Number(document.getElementById('pzQty').value)||1)),note:document.getElementById('pzNote').value.trim()};if(x.flavor2&&x.flavor1===x.flavor2){alert('Escolha dois sabores diferentes ou marque a opção 1 sabor.');return}x.unit=pizzaUnit(x);x.label=`Pizza ${x.size} — ${x.flavor2?'½ '+x.flavor1+' / ½ '+x.flavor2:x.flavor1}`;cart.push(x);metaTrack('AddToCart',{currency:'BRL',value:Number(x.unit)*Number(x.qty),content_name:x.label,content_category:'Pizza',content_type:'product',content_ids:[x.label],contents:[{id:x.label,quantity:Number(x.qty),item_price:Number(x.unit)}]});renderCart();goCart()}\nfunction renderProducts(cat){document.getElementById('products').innerHTML=(catalog.products[cat]||[]).map((p,i)=>`<div class=\"card\"><h3>${esc(p.name)}</h3>${p.description?`<p style=\"color:var(--muted);min-height:42px\">${esc(p.description)}</p>`:''}<div class=\"price\">${brl(p.price)}</div><div class=\"field\" style=\"margin-top:10px\"><label>Quantidade</label><input id=\"q_${i}\" type=\"number\" min=\"1\" max=\"20\" value=\"1\"></div><button class=\"btn primary\" onclick='addProduct(${JSON.stringify(cat)},${JSON.stringify(p.name)},${i})'>Adicionar</button></div>`).join('')}\nfunction addProduct(cat,name,i){const qty=Math.max(1,Math.min(20,Number(document.getElementById('q_'+i).value)||1));const unit=productPrice(cat,name);cart.push({kind:'product',category:cat,name,qty,note:'',unit,label:name});metaTrack('AddToCart',{currency:'BRL',value:Number(unit)*qty,content_name:name,content_category:cat,content_type:'product',content_ids:[name],contents:[{id:name,quantity:qty,item_price:Number(unit)}]});renderCart()}\nfunction removeItem(i){cart.splice(i,1);renderCart()}\nfunction totals(){const subtotal=cart.reduce((s,x)=>s+Number(x.unit)*Number(x.qty),0);const fee=document.getElementById('deliveryType')?.value==='Entrega'?Number(catalog?.deliveryFee||7):0;return{subtotal,fee,total:subtotal+fee}}\nfunction renderCart(){const list=document.getElementById('cartList');if(!cart.length)list.innerHTML='<div class=\"cartEmpty\">Seu carrinho está vazio.</div>';else list.innerHTML=cart.map((x,i)=>`<div class=\"cartItem\"><div><b>${x.qty}x ${esc(x.label)}</b><small>${x.note?esc(x.note)+'<br>':''}${brl(x.unit)} cada</small></div><div><b>${brl(x.unit*x.qty)}</b><br><button class=\"remove\" onclick=\"removeItem(${i})\">Remover</button></div></div>`).join('');const t=totals();document.getElementById('subtotal').textContent=brl(t.subtotal);document.getElementById('deliveryFee').textContent=brl(t.fee);document.getElementById('total').textContent=brl(t.total);document.getElementById('stickyTotal').textContent=brl(t.total);document.getElementById('cartCount').textContent=cart.reduce((s,x)=>s+Number(x.qty),0);const pt=document.getElementById('paymentTotal');if(pt)pt.textContent=brl(t.total);scheduleAbandonedCartSave()}\nfunction selectPayment(value){document.getElementById('payment').value=value;updatePayment()}\nfunction updateDelivery(){const t=document.getElementById('deliveryType').value;document.getElementById('addressFields').classList.toggle('hidden',t!=='Entrega');document.getElementById('tableField').classList.toggle('hidden',t!=='Consumir no local');const mesa=document.getElementById('payMesaOption');if(mesa)mesa.classList.toggle('hidden',t!=='Consumir no local');if(t!=='Consumir no local'&&document.getElementById('payment').value==='Conta da mesa')document.getElementById('payment').value='';renderCart();updatePayment()}\nfunction updatePayment(){const value=document.getElementById('payment').value;const online=value==='Pix online'||value==='Cartão de crédito online';document.getElementById('changeField').classList.toggle('hidden',value!=='Dinheiro');document.querySelectorAll('.payOption').forEach(el=>el.classList.toggle('selected',el.dataset.payment===value));const notice=document.getElementById('paymentNotice');if(notice)notice.innerHTML=online?'<b>Pagamento online:</b> ao confirmar, você será enviado ao checkout seguro do Pagar.me. O pedido só será liberado para preparo depois da aprovação.':'<b>Pagamento no local:</b> o pedido será confirmado sem abrir cobrança online.';const btn=document.getElementById('finishBtn');if(btn)btn.textContent=online?'Ir para pagamento seguro':'Confirmar pedido'}\nfunction setupOnlinePayment(){const enabled=Boolean(window.MR_PAGARME_ENABLED);document.getElementById('onlinePayBlock')?.classList.toggle('hidden',!enabled);document.getElementById('onlineTestNotice')?.classList.toggle('hidden',!enabled||!window.MR_PAGARME_TEST);if(!enabled&&['Pix online','Cartão de crédito online'].includes(document.getElementById('payment')?.value))document.getElementById('payment').value='';updatePayment()}\nlet mrPaymentWindow=null,mrPaymentPollTimer=null,mrPaymentEventSource=null;\nfunction openOnlinePaymentWindow(){try{const w=window.open('about:blank','mr_pagarme_checkout','popup=yes,width=540,height=780,resizable=yes,scrollbars=yes');if(w){try{w.document.open();w.document.write('<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Abrindo pagamento...</title><style>body{font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f0e9;color:#211d1a;text-align:center;padding:24px}b{color:#a3161c}</style></head><body><div><b>MR Pizzaria</b><p>Abrindo checkout seguro do Pagar.me...</p></div></body></html>');w.document.close()}catch(_){}}return w}catch(_){return null}}\nfunction stopOnlinePaymentPolling(){if(mrPaymentPollTimer){clearInterval(mrPaymentPollTimer);mrPaymentPollTimer=null}if(mrPaymentEventSource){try{mrPaymentEventSource.close()}catch(_){}mrPaymentEventSource=null}}\nfunction closeOnlinePaymentWindow(){try{if(mrPaymentWindow&&!mrPaymentWindow.closed)mrPaymentWindow.close()}catch(_){}mrPaymentWindow=null;try{window.focus()}catch(_){}}\nfunction waitForOnlinePayment(orderNumber,paymentLinkId,total,metaData,tracking,paymentUrl){stopOnlinePaymentPolling();const started=Date.now();const success=document.getElementById('success');let finished=false;const applyState=(data)=>{if(finished||!data)return;const status=String(data.paymentStatus||'');if(status==='paid'){finished=true;stopOnlinePaymentPolling();closeOnlinePaymentWindow();sessionStorage.removeItem('mr_pending_order');document.title='✅ Pagamento aprovado — MR Pizzaria';success.innerHTML=`<b>✅ Pagamento aprovado!</b><br>Pedido nº <b>${esc(orderNumber)}</b> recebido pela MR Pizzaria.<br>Total: <b>${brl(total)}</b>.${tracking}`;success.classList.add('show');success.scrollIntoView({behavior:'smooth',block:'center'});try{window.focus()}catch(_){}if(!window.MR_PAGARME_TEST&&marketingAllowed())metaTrack('Purchase',metaData,`Purchase_order_${orderNumber}`,{server:false});return}if(['failed','canceled','refunded','link_error'].includes(status)){finished=true;stopOnlinePaymentPolling();closeOnlinePaymentWindow();document.title='Pagamento não concluído — MR Pizzaria';const msg=status==='failed'?'O pagamento não foi aprovado.':status==='refunded'?'O pagamento foi estornado.':'O pagamento foi cancelado.';success.innerHTML=`<b>⚠️ ${esc(msg)}</b><br>Pedido nº ${esc(orderNumber)}.<br><a class='btn secondary' style='display:inline-block;text-decoration:none;margin-top:12px' target='_blank' rel='noopener' href='${esc(paymentUrl)}'>Abrir checkout novamente</a>`;success.classList.add('show');success.scrollIntoView({behavior:'smooth',block:'center'});try{window.focus()}catch(_){}return}};const check=async()=>{try{const r=await fetch(`/api/site/orders/${encodeURIComponent(orderNumber)}/payment-status?link=${encodeURIComponent(paymentLinkId)}`,{cache:'no-store'});const data=await r.json().catch(()=>({}));if(r.ok)applyState(data);if(!finished&&Date.now()-started>35*60*1000){finished=true;stopOnlinePaymentPolling();success.innerHTML=`<b>Pagamento ainda pendente.</b><br>Pedido nº ${esc(orderNumber)}.<br><a class='btn secondary' style='display:inline-block;text-decoration:none;margin-top:12px' target='_blank' rel='noopener' href='${esc(paymentUrl)}'>Abrir checkout</a>`;success.classList.add('show')}}catch(_){}};try{mrPaymentEventSource=new EventSource(`/api/site/orders/${encodeURIComponent(orderNumber)}/payment-events?link=${encodeURIComponent(paymentLinkId)}`);mrPaymentEventSource.onmessage=(ev)=>{try{applyState(JSON.parse(ev.data||'{}'))}catch(_){}};mrPaymentEventSource.onerror=()=>{if(finished&&mrPaymentEventSource){try{mrPaymentEventSource.close()}catch(_){}mrPaymentEventSource=null}}}catch(_){}check();mrPaymentPollTimer=setInterval(check,5000);const onVisible=()=>{if(!document.hidden&&!finished)check()};document.addEventListener('visibilitychange',onVisible,{passive:true});setTimeout(()=>document.removeEventListener('visibilitychange',onVisible),36*60*1000)}\nfunction checkoutError(message){const err=document.getElementById('formError');err.textContent=message;err.classList.add('show');document.getElementById('success').classList.remove('show');document.getElementById('checkout').scrollIntoView({behavior:'smooth',block:'start'})}\nfunction showPaymentStep(){const err=document.getElementById('formError');err.classList.remove('show');if(!cart.length){checkoutError('Adicione pelo menos um item ao carrinho.');goCart();return}const name=document.getElementById('customerName').value.trim();if(name.length<2){checkoutError('Informe o nome do cliente.');return}const phone=document.getElementById('phone');if(phone.required&&phone.value.replace(/\\D/g,'').length<10){checkoutError('Informe um WhatsApp válido com DDD.');return}const type=document.getElementById('deliveryType').value;if(type==='Entrega'&&(!document.getElementById('street').value.trim()||!document.getElementById('number').value.trim()||!document.getElementById('district').value.trim())){checkoutError('Para entrega, informe rua, número e bairro.');return}if(type==='Consumir no local'){const mesa=Number(document.getElementById('tableNumber').value);if(!Number.isInteger(mesa)||mesa<1||mesa>17){checkoutError('Informe uma mesa de 1 a 17.');return}}document.getElementById('checkoutDetailsStep').classList.add('hidden');document.getElementById('checkoutPaymentStep').classList.remove('hidden');document.getElementById('stepDetailsBadge').classList.remove('active');document.getElementById('stepPaymentBadge').classList.add('active');const t=totals();document.getElementById('paymentTotal').textContent=brl(t.total);metaTrack('InitiateCheckout',{currency:'BRL',value:Number(t.total),num_items:cart.reduce((sum,x)=>sum+Number(x.qty||0),0),content_type:'product',content_ids:cart.map(x=>x.label||x.name).filter(Boolean),contents:cart.map(x=>({id:x.label||x.name,quantity:Number(x.qty||1),item_price:Number(x.unit||0)}))});document.getElementById('checkout').scrollIntoView({behavior:'smooth',block:'start'})}\nfunction backToDetails(){document.getElementById('checkoutPaymentStep').classList.add('hidden');document.getElementById('checkoutDetailsStep').classList.remove('hidden');document.getElementById('stepPaymentBadge').classList.remove('active');document.getElementById('stepDetailsBadge').classList.add('active');document.getElementById('formError').classList.remove('show');document.getElementById('checkout').scrollIntoView({behavior:'smooth',block:'start'})}\nfunction parseMoney(v){return Number(String(v||'').replace(/\\./g,'').replace(',','.'))||null}\ndocument.getElementById('deliveryType').addEventListener('change',()=>{updateDelivery();scheduleAbandonedCartSave()});document.getElementById('marketingConsent').addEventListener('change',updateMarketingConsent);document.getElementById('recoveryOptIn').addEventListener('change',scheduleAbandonedCartSave);['customerName','phone','street','number','district','reference'].forEach(id=>document.getElementById(id)?.addEventListener('input',scheduleAbandonedCartSave));\ndocument.getElementById('checkoutForm').addEventListener('submit',async e=>{e.preventDefault();const err=document.getElementById('formError');const ok=document.getElementById('success');err.classList.remove('show');ok.classList.remove('show');if(!cart.length){checkoutError('Adicione pelo menos um item ao carrinho.');goCart();return}const payment=document.getElementById('payment').value;if(!payment){checkoutError('Escolha uma forma de pagamento antes de confirmar.');return}const online=payment==='Pix online'||payment==='Cartão de crédito online';if(online&&!window.MR_PAGARME_ENABLED){checkoutError('Pagamento online temporariamente indisponível. Escolha uma forma de pagamento no local.');return}mrPaymentWindow=online?openOnlinePaymentWindow():null;const type=document.getElementById('deliveryType').value;const purchaseEventId=marketingAllowed()?metaEventId('Purchase'):'';const metaId=marketingAllowed()?metaIdentity():{};const payload={company:e.target.company.value,customerName:document.getElementById('customerName').value,phone:document.getElementById('phone').value,deliveryType:type,address:{street:document.getElementById('street').value,number:document.getElementById('number').value,district:document.getElementById('district').value,reference:document.getElementById('reference').value},tableNumber:document.getElementById('tableNumber').value,commandName:document.getElementById('commandName').value,waiterName:document.getElementById('waiterName').value,tabCode:document.getElementById('tabCode').value,payment,changeFor:parseMoney(document.getElementById('changeFor').value),items:cart.map(({unit,label,...x})=>x),abandonedCartToken:document.getElementById('recoveryOptIn')?.checked?cartToken():'',marketingConsent:marketingAllowed(),meta:{eventId:purchaseEventId,eventSourceUrl:location.href,...metaId}};const itemCount=cart.reduce((sum,x)=>sum+Number(x.qty||0),0);const btn=document.getElementById('finishBtn');btn.disabled=true;btn.textContent=online?'Gerando pagamento...':'Enviando...';try{const r=await fetch('/api/site/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível enviar o pedido.');const local=type==='Consumir no local';const wa=String(window.MR_BUSINESS_WHATSAPP||'').replace(/\\D/g,'');const trackingText=`Olá, fiz o pedido nº ${data.orderNumber} pelo site e quero receber as atualizações do pedido.`;const tracking=(!local&&wa)?`<br><a class=\"btn secondary\" style=\"display:inline-block;text-decoration:none;margin-top:12px\" target=\"_blank\" rel=\"noopener\" href=\"https://wa.me/${wa}?text=${encodeURIComponent(trackingText)}\">Receber atualizações no WhatsApp</a><br><small>Envie a mensagem que abrir no WhatsApp para liberar as atualizações automáticas do pedido.</small>`:'';if(data.paymentUrl){const metaOnlinePurchase={currency:'BRL',value:Number(data.total),num_items:itemCount,content_name:'Pedido pago MR Pizzaria',content_type:'product',content_ids:cart.map(x=>x.label||x.name).filter(Boolean),contents:cart.map(x=>({id:x.label||x.name,quantity:Number(x.qty||1),item_price:Number(x.unit||0)})),order_id:String(data.orderNumber)};ok.innerHTML=`<b>Pedido nº ${esc(data.orderNumber)} criado.</b><br>Total: ${brl(data.total)}.<br><b>⏳ Aguardando pagamento.</b><br>O checkout seguro foi aberto em outra aba. Depois da aprovação, esta tela será atualizada automaticamente.`;ok.classList.add('show');sessionStorage.setItem('mr_pending_order',String(data.orderNumber));cart=[];localStorage.removeItem('mr_cart');localStorage.removeItem('mr_cart_token');document.getElementById('payment').value='';renderCart();updatePayment();if(mrPaymentWindow&&!mrPaymentWindow.closed){try{mrPaymentWindow.location.replace(data.paymentUrl)}catch(_){mrPaymentWindow.location.href=data.paymentUrl}waitForOnlinePayment(data.orderNumber,data.paymentLinkId,data.total,metaOnlinePurchase,tracking,data.paymentUrl)}else{ok.innerHTML+=`<br><small>Seu navegador bloqueou a nova aba. Abrindo o checkout nesta mesma tela...</small>`;setTimeout(()=>window.location.assign(data.paymentUrl),700)}return}ok.innerHTML=`<b>Pedido nº ${esc(data.orderNumber)} confirmado!</b><br>${data.tabCode?`Comanda: <b>${esc(data.tabCode)}</b><br>`:''}Forma de pagamento: <b>${esc(payment)}</b><br>Total: ${brl(data.total)}.${tracking}`;ok.classList.add('show');metaTrack('Purchase',{currency:'BRL',value:Number(data.total),num_items:itemCount,content_name:'Pedido confirmado MR Pizzaria',content_type:'product',content_ids:cart.map(x=>x.label||x.name).filter(Boolean),contents:cart.map(x=>({id:x.label||x.name,quantity:Number(x.qty||1),item_price:Number(x.unit||0)})),order_id:String(data.orderNumber)},purchaseEventId,{server:false});cart=[];localStorage.removeItem('mr_cart');localStorage.removeItem('mr_cart_token');document.getElementById('recoveryOptIn').checked=false;document.getElementById('payment').value='';renderCart();updatePayment();document.getElementById('checkoutPaymentStep').classList.add('hidden');document.getElementById('checkoutDetailsStep').classList.remove('hidden');document.getElementById('stepPaymentBadge').classList.remove('active');document.getElementById('stepDetailsBadge').classList.add('active');document.getElementById('checkout').scrollIntoView()}catch(ex){if(online)closeOnlinePaymentWindow();checkoutError(ex.message)}finally{btn.disabled=false;updatePayment()}});\ninit().catch(()=>{document.getElementById('products').innerHTML='<div class=\"error show\">Não foi possível carregar o cardápio. Atualize a página.</div>'});updateDelivery();setupOnlinePayment();\n</script>\n</body></html>";

const ORDER_STATUSES = [
  "Aguardando pagamento",
  "Pagamento recusado",
  "Agendado",
  "Novo",
  "Aceito",
  "Em preparo",
  "Pronto",
  "Saiu para entrega",
  "Finalizado",
  "Cancelado"
];

const RESERVATION_STATUSES = ["Pendente", "Confirmada", "Concluída", "Cancelada"];
const SERVICE_STATUSES = ["Pendente", "Atendido"];
const TAB_STATUSES = ["Aberta", "Conta solicitada", "Fechada"];
const STAFF_ROLES = ["Garçom", "Caixa", "Cozinha", "Gerente", "Administrador"];

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function safeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    number: Number(row.order_number),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryType: row.delivery_type,
    address: row.address || {},
    location: row.location || {},
    items: row.items || [],
    subtotal: Number(row.subtotal || 0),
    discount: Number(row.discount || 0),
    couponCode: row.coupon_code || "",
    deliveryFee: Number(row.delivery_fee || 0),
    total: Number(row.total || 0),
    payment: row.payment,
    changeFor: row.change_for == null ? null : Number(row.change_for),
    pickupName: row.pickup_name || "",
    tableNumber: row.table_number || "",
    tabCode: row.tab_code || "",
    commandName: row.command_name || "",
    waiterName: row.waiter_name || "",
    reservationNumber: row.reservation_number == null ? null : Number(row.reservation_number),
    scheduledFor: row.scheduled_for,
    paymentReceiptId: row.payment_receipt_id || "",
    paymentReceiptType: row.payment_receipt_type || "",
    paymentProvider: row.payment_provider || "",
    paymentStatus: row.payment_status || "",
    paymentLinkId: row.payment_link_id || "",
    paymentLinkUrl: row.payment_link_url || "",
    paymentExternalId: row.payment_external_id || "",
    marketingConsent: Boolean(row.marketing_consent),
    abandonedCartToken: row.abandoned_cart_token || "",
    paymentUpdatedAt: row.payment_updated_at || null,
    status: row.status,
    pizzaPrintedAt: row.pizza_printed_at,
    kitchenPrintedAt: row.kitchen_printed_at
  };
}

function rowToReservation(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    number: Number(row.reservation_number),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    reservationFor: row.reservation_for,
    people: Number(row.people || 0),
    notes: row.notes || "",
    status: row.status
  };
}

function rowToServiceRequest(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    message: row.message || "",
    status: row.status
  };
}

function rowToAbandonedCart(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    cartToken: row.cart_token || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    deliveryType: row.delivery_type || "Entrega",
    address: row.address || {},
    items: row.items || [],
    subtotal: Number(row.subtotal || 0),
    recoveryOptIn: Boolean(row.recovery_opt_in),
    status: row.status || "Pendente",
    recoveredAt: row.recovered_at || null,
    convertedOrderNumber: row.converted_order_number == null ? null : Number(row.converted_order_number)
  };
}

function rowToTableTab(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tabCode: row.tab_code,
    tableNumber: Number(row.table_number),
    sequenceNo: Number(row.sequence_no),
    customerName: row.customer_name || "Comanda geral",
    waiterName: row.waiter_name || "",
    people: Number(row.people || 0),
    status: row.status || "Aberta",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}

function rowToStaff(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToPromotion(row, includeImage = false) {
  if (!row) return null;
  return {
    text: row.promotion_text || "",
    active: Boolean(row.active),
    imageData: includeImage && row.image_data ? Buffer.from(row.image_data) : null,
    imageMime: row.image_mime || "",
    imageName: row.image_name || "",
    hasImage: Boolean(row.has_image ?? row.image_data),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function rowToFeaturedCombo(row, { includeImage = false } = {}) {
  if (!row) return null;
  const rawImage = row.image_data || row.imageData || null;
  const hasImage = row.has_image != null ? Boolean(row.has_image) : Boolean(rawImage && rawImage.length);
  return {
    id: Number(row.id), name: row.name || "", description: row.description || "", price: Number(row.price || 0),
    active: Boolean(row.active), sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    imageMime: row.image_mime || row.imageMime || "", imageName: row.image_name || row.imageName || "",
    hasImage, imageData: includeImage ? rawImage : null,
    createdAt: row.created_at || row.createdAt || null, updatedAt: row.updated_at || row.updatedAt || null
  };
}

async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL não configurado: dados serão mantidos somente na memória.");
    return;
  }

  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS mr_order_number_seq START WITH 101;
    CREATE SEQUENCE IF NOT EXISTS mr_reservation_number_seq START WITH 1001;

    CREATE TABLE IF NOT EXISTS mr_orders (
      id BIGSERIAL PRIMARY KEY,
      order_number BIGINT UNIQUE NOT NULL DEFAULT nextval('mr_order_number_seq'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_type TEXT NOT NULL,
      address JSONB NOT NULL DEFAULT '{}'::jsonb,
      location JSONB NOT NULL DEFAULT '{}'::jsonb,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      subtotal NUMERIC(10,2) NOT NULL,
      discount NUMERIC(10,2) NOT NULL DEFAULT 0,
      coupon_code TEXT NOT NULL DEFAULT '',
      delivery_fee NUMERIC(10,2) NOT NULL,
      total NUMERIC(10,2) NOT NULL,
      payment TEXT NOT NULL,
      change_for NUMERIC(10,2),
      pickup_name TEXT NOT NULL DEFAULT '',
      table_number TEXT NOT NULL DEFAULT '',
      reservation_number BIGINT,
      scheduled_for TIMESTAMPTZ,
      payment_receipt_id TEXT NOT NULL DEFAULT '',
      payment_receipt_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Novo',
      pizza_printed_at TIMESTAMPTZ,
      kitchen_printed_at TIMESTAMPTZ
    );

    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS location JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS coupon_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS pickup_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS table_number TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS tab_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS command_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS waiter_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS reservation_number BIGINT;
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_receipt_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_receipt_type TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_link_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_link_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_external_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS abandoned_cart_token TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_orders ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS mr_orders_created_at_idx ON mr_orders (created_at DESC);
    CREATE INDEX IF NOT EXISTS mr_orders_status_idx ON mr_orders (status);
    CREATE INDEX IF NOT EXISTS mr_orders_phone_idx ON mr_orders (customer_phone, created_at DESC);
    CREATE INDEX IF NOT EXISTS mr_orders_scheduled_idx ON mr_orders (scheduled_for);
    CREATE INDEX IF NOT EXISTS mr_orders_reservation_idx ON mr_orders (reservation_number);
    CREATE INDEX IF NOT EXISTS mr_orders_tab_idx ON mr_orders (tab_code, created_at DESC);

    CREATE TABLE IF NOT EXISTS mr_table_tabs (
      id BIGSERIAL PRIMARY KEY,
      tab_code TEXT UNIQUE NOT NULL,
      table_number INTEGER NOT NULL CHECK (table_number BETWEEN 1 AND 17),
      sequence_no INTEGER NOT NULL,
      customer_name TEXT NOT NULL DEFAULT 'Comanda geral',
      waiter_name TEXT NOT NULL DEFAULT '',
      people INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Aberta',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      UNIQUE (table_number, sequence_no)
    );
    CREATE INDEX IF NOT EXISTS mr_table_tabs_table_idx ON mr_table_tabs (table_number, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS mr_staff (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mr_staff_name_unique_idx ON mr_staff (LOWER(name));

    CREATE TABLE IF NOT EXISTS mr_order_events (
      id BIGSERIAL PRIMARY KEY,
      order_number BIGINT NOT NULL,
      event_type TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS mr_order_events_number_idx ON mr_order_events (order_number, created_at DESC);

    CREATE TABLE IF NOT EXISTS mr_reservations (
      id BIGSERIAL PRIMARY KEY,
      reservation_number BIGINT UNIQUE NOT NULL DEFAULT nextval('mr_reservation_number_seq'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      reservation_for TIMESTAMPTZ NOT NULL,
      people INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pendente'
    );
    CREATE INDEX IF NOT EXISTS mr_reservations_date_idx ON mr_reservations (reservation_for);
    CREATE INDEX IF NOT EXISTS mr_reservations_phone_idx ON mr_reservations (customer_phone, created_at DESC);

    CREATE TABLE IF NOT EXISTS mr_service_requests (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pendente'
    );
    CREATE INDEX IF NOT EXISTS mr_service_requests_status_idx ON mr_service_requests (status, created_at DESC);

    CREATE TABLE IF NOT EXISTS mr_promotion (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      promotion_text TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT FALSE,
      image_data BYTEA,
      image_mime TEXT NOT NULL DEFAULT '',
      image_name TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mr_featured_combos (
      id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price NUMERIC(10,2) NOT NULL CHECK (price >= 0), active BOOLEAN NOT NULL DEFAULT TRUE, sort_order INTEGER NOT NULL DEFAULT 0,
      image_data BYTEA, image_mime TEXT NOT NULL DEFAULT '', image_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE mr_featured_combos ADD COLUMN IF NOT EXISTS image_data BYTEA;
    ALTER TABLE mr_featured_combos ADD COLUMN IF NOT EXISTS image_mime TEXT NOT NULL DEFAULT '';
    ALTER TABLE mr_featured_combos ADD COLUMN IF NOT EXISTS image_name TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS mr_featured_combos_active_idx ON mr_featured_combos (active, sort_order, id);

    CREATE TABLE IF NOT EXISTS mr_abandoned_carts (
      id BIGSERIAL PRIMARY KEY,
      cart_token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL,
      delivery_type TEXT NOT NULL DEFAULT 'Entrega',
      address JSONB NOT NULL DEFAULT '{}'::jsonb,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
      recovery_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'Pendente',
      recovered_at TIMESTAMPTZ,
      converted_order_number BIGINT
    );
    CREATE INDEX IF NOT EXISTS mr_abandoned_carts_status_idx ON mr_abandoned_carts (status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS mr_abandoned_carts_phone_idx ON mr_abandoned_carts (customer_phone, updated_at DESC);
    DELETE FROM mr_abandoned_carts WHERE updated_at < NOW() - INTERVAL '${ABANDONED_CART_RETENTION_DAYS} days';
  `);

  await pool.query(
    `INSERT INTO mr_promotion (id, promotion_text, active)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [TODAY_PROMOTION, Boolean(TODAY_PROMOTION)]
  );

  await pool.query(`
    SELECT setval('mr_order_number_seq', GREATEST(100, COALESCE((SELECT MAX(order_number) FROM mr_orders), 100)), true);
    SELECT setval('mr_reservation_number_seq', GREATEST(1000, COALESCE((SELECT MAX(reservation_number) FROM mr_reservations), 1000)), true);
  `);

  databaseReady = true;
  console.log("Banco PostgreSQL conectado e tabelas da versão 6.3.6 prontas.");
}

async function getPromotion({ includeImage = false } = {}) {
  if (!databaseReady || !pool) {
    return {
      ...memoryPromotion,
      imageData: includeImage ? memoryPromotion.imageData : null
    };
  }

  const fields = includeImage
    ? "promotion_text, active, image_data, image_mime, image_name, updated_at, (image_data IS NOT NULL AND octet_length(image_data) > 0) AS has_image"
    : "promotion_text, active, image_mime, image_name, updated_at, (image_data IS NOT NULL AND octet_length(image_data) > 0) AS has_image";
  const result = await pool.query(`SELECT ${fields} FROM mr_promotion WHERE id = 1`);
  if (!result.rows[0]) {
    return {
      text: TODAY_PROMOTION,
      active: Boolean(TODAY_PROMOTION),
      imageData: null,
      imageMime: "",
      imageName: "",
      hasImage: false,
      updatedAt: new Date().toISOString()
    };
  }
  return rowToPromotion(result.rows[0], includeImage);
}

async function savePromotion({ text, active, file = null, removeImage = false }) {
  const cleanText = String(text || "").trim().slice(0, 4000);
  const current = await getPromotion({ includeImage: true });
  let imageData = current.imageData;
  let imageMime = current.imageMime;
  let imageName = current.imageName;

  if (removeImage) {
    imageData = null;
    imageMime = "";
    imageName = "";
  }
  if (file) {
    imageData = file.buffer;
    imageMime = file.mimetype;
    imageName = file.originalname || "promocao";
  }

  const enabled = Boolean(active);
  if (enabled && !cleanText && !imageData) {
    throw new Error("Para ativar, escreva o texto ou envie uma imagem da promoção.");
  }

  if (!databaseReady || !pool) {
    memoryPromotion = {
      text: cleanText,
      active: enabled,
      imageData,
      imageMime,
      imageName,
      hasImage: Boolean(imageData),
      updatedAt: new Date().toISOString()
    };
    return { ...memoryPromotion, imageData: null };
  }

  const result = await pool.query(
    `INSERT INTO mr_promotion (id, promotion_text, active, image_data, image_mime, image_name, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       promotion_text = EXCLUDED.promotion_text,
       active = EXCLUDED.active,
       image_data = EXCLUDED.image_data,
       image_mime = EXCLUDED.image_mime,
       image_name = EXCLUDED.image_name,
       updated_at = NOW()
     RETURNING promotion_text, active, image_mime, image_name, updated_at,
       (image_data IS NOT NULL AND octet_length(image_data) > 0) AS has_image`,
    [cleanText, enabled, imageData, imageMime, imageName]
  );
  return rowToPromotion(result.rows[0], false);
}

async function listFeaturedCombos({ includeInactive = false } = {}) {
  if (!databaseReady || !pool) return memoryFeaturedCombos.filter(x => includeInactive || x.active).sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||Number(a.id)-Number(b.id)).map(x=>rowToFeaturedCombo(x));
  const where = includeInactive ? "" : "WHERE active = TRUE";
  const result = await pool.query(`SELECT id,name,description,price,active,sort_order,image_mime,image_name,created_at,updated_at,(image_data IS NOT NULL AND octet_length(image_data)>0) AS has_image FROM mr_featured_combos ${where} ORDER BY sort_order ASC,id ASC`);
  return result.rows.map(row=>rowToFeaturedCombo(row));
}
async function getFeaturedCombo(id,{includeImage=false}={}) {
  const comboId=Number.parseInt(id,10); if(!Number.isInteger(comboId)||comboId<1)return null;
  if(!databaseReady||!pool){const item=memoryFeaturedCombos.find(x=>Number(x.id)===comboId);return item?rowToFeaturedCombo(item,{includeImage}):null}
  const fields=includeImage?"*, (image_data IS NOT NULL AND octet_length(image_data)>0) AS has_image":"id,name,description,price,active,sort_order,image_mime,image_name,created_at,updated_at,(image_data IS NOT NULL AND octet_length(image_data)>0) AS has_image";
  const result=await pool.query(`SELECT ${fields} FROM mr_featured_combos WHERE id=$1 LIMIT 1`,[comboId]); return result.rows[0]?rowToFeaturedCombo(result.rows[0],{includeImage}):null;
}
async function createFeaturedCombo({name,description,price,active=true,sortOrder=0,file=null}) {
  const cleanName=cleanSiteText(name,100),cleanDescription=cleanSiteText(description,500),cleanPrice=Number(String(price||"").replace(",",".")),cleanSort=Number.parseInt(sortOrder,10)||0;
  if(cleanName.length<2)throw new Error("Informe o nome do combo."); if(!Number.isFinite(cleanPrice)||cleanPrice<=0)throw new Error("Informe um preço válido para o combo.");
  const imageData=file?.buffer||null,imageMime=file?.mimetype||"",imageName=cleanSiteText(file?.originalname||"",180);
  if(!databaseReady||!pool){const now=new Date().toISOString(),item={id:++memoryComboSequence,name:cleanName,description:cleanDescription,price:cleanPrice,active:Boolean(active),sortOrder:cleanSort,imageData,imageMime,imageName,hasImage:Boolean(imageData),createdAt:now,updatedAt:now};memoryFeaturedCombos.push(item);return rowToFeaturedCombo(item)}
  const result=await pool.query(`INSERT INTO mr_featured_combos (name,description,price,active,sort_order,image_data,image_mime,image_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING *, (image_data IS NOT NULL AND octet_length(image_data)>0) AS has_image`,[cleanName,cleanDescription,cleanPrice,Boolean(active),cleanSort,imageData,imageMime,imageName]); return rowToFeaturedCombo(result.rows[0]);
}
async function updateFeaturedCombo(id,{name,description,price,active,sortOrder,file=null,removeImage=false}) {
  const comboId=Number.parseInt(id,10); if(!Number.isInteger(comboId)||comboId<1)throw new Error("Combo inválido.");
  const cleanName=cleanSiteText(name,100),cleanDescription=cleanSiteText(description,500),cleanPrice=Number(String(price||"").replace(",",".")),cleanSort=Number.parseInt(sortOrder,10)||0;
  if(cleanName.length<2)throw new Error("Informe o nome do combo."); if(!Number.isFinite(cleanPrice)||cleanPrice<=0)throw new Error("Informe um preço válido para o combo.");
  const current=await getFeaturedCombo(comboId,{includeImage:true}); if(!current)return null; let imageData=current.imageData,imageMime=current.imageMime,imageName=current.imageName;
  if(removeImage){imageData=null;imageMime="";imageName=""} if(file){imageData=file.buffer;imageMime=file.mimetype;imageName=cleanSiteText(file.originalname||"combo",180)}
  if(!databaseReady||!pool){const item=memoryFeaturedCombos.find(x=>Number(x.id)===comboId);if(!item)return null;Object.assign(item,{name:cleanName,description:cleanDescription,price:cleanPrice,active:Boolean(active),sortOrder:cleanSort,imageData,imageMime,imageName,hasImage:Boolean(imageData),updatedAt:new Date().toISOString()});return rowToFeaturedCombo(item)}
  const result=await pool.query(`UPDATE mr_featured_combos SET name=$1,description=$2,price=$3,active=$4,sort_order=$5,image_data=$6,image_mime=$7,image_name=$8,updated_at=NOW() WHERE id=$9 RETURNING *, (image_data IS NOT NULL AND octet_length(image_data)>0) AS has_image`,[cleanName,cleanDescription,cleanPrice,Boolean(active),cleanSort,imageData,imageMime,imageName,comboId]);return result.rows[0]?rowToFeaturedCombo(result.rows[0]):null;
}
async function deleteFeaturedCombo(id) {
  const comboId=Number.parseInt(id,10); if(!Number.isInteger(comboId)||comboId<1)throw new Error("Combo inválido.");
  if(!databaseReady||!pool){const pos=memoryFeaturedCombos.findIndex(x=>Number(x.id)===comboId);if(pos<0)return false;memoryFeaturedCombos.splice(pos,1);return true}
  const result=await pool.query(`DELETE FROM mr_featured_combos WHERE id=$1`,[comboId]);return result.rowCount>0;
}

function sanitizeCartToken(value) {
  const token = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return token.length >= 8 ? token : "";
}

async function upsertAbandonedCart({ cartToken, customerName, customerPhone, deliveryType, address, items, recoveryOptIn }) {
  const token = sanitizeCartToken(cartToken);
  if (!token) throw new Error("Identificação do carrinho inválida.");
  if (!recoveryOptIn) throw new Error("A recuperação do carrinho não foi autorizada.");
  const digits = String(customerPhone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) throw new Error("Informe um WhatsApp válido para salvar o carrinho.");
  const phone = normalizeRecipientNumber(digits.startsWith("55") ? digits : `55${digits}`);
  const name = cleanSiteText(customerName, 80);
  const type = ["Entrega", "Retirada", "Consumir no local"].includes(deliveryType) ? deliveryType : "Entrega";
  const builtItems = await buildSiteOrderItems(items);
  const subtotal = builtItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const cleanAddress = {
    street: cleanSiteText(address?.street, 120),
    number: cleanSiteText(address?.number, 20),
    district: cleanSiteText(address?.district, 80),
    reference: cleanSiteText(address?.reference, 150)
  };

  if (!databaseReady || !pool) {
    let cart = memoryAbandonedCarts.find((item) => item.cartToken === token);
    const now = new Date().toISOString();
    if (!cart) {
      cart = { id: ++memoryAbandonedCartSequence, cartToken: token, createdAt: now };
      memoryAbandonedCarts.unshift(cart);
    }
    Object.assign(cart, {
      updatedAt: now,
      customerName: name,
      customerPhone: phone,
      deliveryType: type,
      address: cleanAddress,
      items: builtItems,
      subtotal,
      recoveryOptIn: true,
      status: cart.status === "Convertido" ? "Convertido" : "Pendente",
      recoveredAt: cart.recoveredAt || null,
      convertedOrderNumber: cart.convertedOrderNumber || null
    });
    return deepClone(cart);
  }

  const result = await pool.query(
    `INSERT INTO mr_abandoned_carts
      (cart_token, customer_name, customer_phone, delivery_type, address, items, subtotal, recovery_opt_in, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,TRUE,'Pendente',NOW(),NOW())
     ON CONFLICT (cart_token) DO UPDATE SET
       customer_name = EXCLUDED.customer_name,
       customer_phone = EXCLUDED.customer_phone,
       delivery_type = EXCLUDED.delivery_type,
       address = EXCLUDED.address,
       items = EXCLUDED.items,
       subtotal = EXCLUDED.subtotal,
       recovery_opt_in = TRUE,
       status = CASE WHEN mr_abandoned_carts.status = 'Convertido' THEN mr_abandoned_carts.status ELSE 'Pendente' END,
       updated_at = NOW()
     RETURNING *`,
    [token, name, phone, type, JSON.stringify(cleanAddress), JSON.stringify(builtItems), subtotal]
  );
  return rowToAbandonedCart(result.rows[0]);
}

async function listAbandonedCarts({ limit = 300, includeClosed = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  if (!databaseReady || !pool) {
    return memoryAbandonedCarts
      .filter((cart) => includeClosed || cart.status === "Pendente")
      .slice(0, safeLimit)
      .map(deepClone);
  }
  const where = includeClosed ? "" : "WHERE status = 'Pendente'";
  const result = await pool.query(`SELECT * FROM mr_abandoned_carts ${where} ORDER BY updated_at DESC LIMIT $1`, [safeLimit]);
  return result.rows.map(rowToAbandonedCart);
}

async function updateAbandonedCartStatus(id, status) {
  const cartId = Number.parseInt(id, 10);
  const allowed = new Set(["Pendente", "Recuperado", "Ignorado"]);
  if (!Number.isInteger(cartId) || cartId < 1 || !allowed.has(status)) throw new Error("Status de recuperação inválido.");
  if (!databaseReady || !pool) {
    const cart = memoryAbandonedCarts.find((item) => Number(item.id) === cartId);
    if (!cart) return null;
    cart.status = status;
    cart.updatedAt = new Date().toISOString();
    cart.recoveredAt = status === "Recuperado" ? cart.updatedAt : cart.recoveredAt || null;
    return deepClone(cart);
  }
  const result = await pool.query(
    `UPDATE mr_abandoned_carts
     SET status=$1, recovered_at=CASE WHEN $1='Recuperado' THEN NOW() ELSE recovered_at END, updated_at=NOW()
     WHERE id=$2 RETURNING *`,
    [status, cartId]
  );
  return result.rows[0] ? rowToAbandonedCart(result.rows[0]) : null;
}

async function markAbandonedCartConverted(cartToken, orderNumber) {
  const token = sanitizeCartToken(cartToken);
  if (!token) return null;
  if (!databaseReady || !pool) {
    const cart = memoryAbandonedCarts.find((item) => item.cartToken === token);
    if (!cart) return null;
    cart.status = "Convertido";
    cart.convertedOrderNumber = Number(orderNumber) || null;
    cart.updatedAt = new Date().toISOString();
    return deepClone(cart);
  }
  const result = await pool.query(
    `UPDATE mr_abandoned_carts SET status='Convertido', converted_order_number=$1, updated_at=NOW() WHERE cart_token=$2 RETURNING *`,
    [Number(orderNumber) || null, token]
  );
  return result.rows[0] ? rowToAbandonedCart(result.rows[0]) : null;
}

async function saveConfirmedOrder(orderData) {
  if (orderData.deliveryType === "Consumir no local") {
    const tableNumber = normalizeTableNumber(orderData.tableNumber);
    if (!tableNumber) throw new Error(`Informe uma mesa entre 1 e ${CONFIG.tableCount}.`);
    const tab = await ensureTableTab({
      tableNumber,
      tabCode: orderData.tabCode,
      customerName: orderData.commandName || orderData.customerName || "Comanda geral",
      waiterName: orderData.waiterName || "",
      people: orderData.people || 0
    });
    orderData = {
      ...orderData,
      tableNumber: String(tableNumber),
      tabCode: tab.tabCode,
      commandName: tab.customerName,
      waiterName: orderData.waiterName || tab.waiterName || ""
    };
  }

  if (!databaseReady || !pool) {
    const saved = {
      ...orderData,
      number: ++memoryOrderSequence,
      id: memoryOrderSequence,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pizzaPrintedAt: null,
      kitchenPrintedAt: null
    };
    memoryOrders.unshift(saved);
    return saved;
  }

  const result = await pool.query(
    `INSERT INTO mr_orders (
      customer_name, customer_phone, delivery_type, address, location, items,
      subtotal, discount, coupon_code, delivery_fee, total, payment, change_for,
      pickup_name, table_number, tab_code, command_name, waiter_name, reservation_number, scheduled_for, payment_receipt_id, payment_receipt_type,
      payment_provider, payment_status, payment_link_id, payment_link_url, payment_external_id, marketing_consent, abandoned_cart_token, payment_updated_at, status
    ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
    RETURNING *`,
    [
      orderData.customerName,
      orderData.customerPhone,
      orderData.deliveryType,
      JSON.stringify(orderData.address || {}),
      JSON.stringify(orderData.location || {}),
      JSON.stringify(orderData.items || []),
      orderData.subtotal,
      orderData.discount || 0,
      orderData.couponCode || "",
      orderData.deliveryFee,
      orderData.total,
      orderData.payment,
      orderData.changeFor,
      orderData.pickupName || "",
      orderData.tableNumber || "",
      orderData.tabCode || "",
      orderData.commandName || "",
      orderData.waiterName || "",
      orderData.reservationNumber || null,
      orderData.scheduledFor || null,
      orderData.paymentReceiptId || "",
      orderData.paymentReceiptType || "",
      orderData.paymentProvider || "",
      orderData.paymentStatus || "",
      orderData.paymentLinkId || "",
      orderData.paymentLinkUrl || "",
      orderData.paymentExternalId || "",
      Boolean(orderData.marketingConsent),
      orderData.abandonedCartToken || "",
      orderData.paymentUpdatedAt || null,
      orderData.status || "Novo"
    ]
  );

  const saved = rowToOrder(result.rows[0]);
  await pool.query(
    `INSERT INTO mr_order_events (order_number, event_type, details) VALUES ($1, 'CREATED', $2::jsonb)`,
    [saved.number, JSON.stringify({ source: orderData.source || "whatsapp", scheduledFor: saved.scheduledFor })]
  );
  return saved;
}


function pagarmeBasicAuthHeader() {
  return `Basic ${Buffer.from(`${PAGARME_SECRET_KEY}:`, "utf8").toString("base64")}`;
}
function cents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}
function pagarmeOrderCode(number) {
  return `MR-${Number(number)}`;
}
function pagarmeCartItems(order) {
  const items = [];
  for (const item of order.items || []) {
    const amount = cents(item.unit ?? item.unitPrice ?? (Number(item.qty) ? Number(item.total || 0) / Number(item.qty) : 0));
    if (amount <= 0) continue;
    items.push({
      name: String(item.name || "Item MR Pizzaria").slice(0, 100),
      description: String(item.note || item.category || "Pedido MR Pizzaria").slice(0, 255),
      amount,
      default_quantity: Math.max(1, Math.floor(Number(item.qty || 1)))
    });
  }
  if (Number(order.deliveryFee || 0) > 0) {
    items.push({ name: "Taxa de entrega", description: "Entrega MR Pizzaria", amount: cents(order.deliveryFee), default_quantity: 1 });
  }
  return items;
}
function pagarmeErrorMessage(data, fallback) {
  const direct = data?.message || data?.error_description || data?.error;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const errors = data?.errors;
  if (Array.isArray(errors)) {
    const parts = errors.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (entry && typeof entry === "object") return Object.entries(entry).map(([k,v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
      return [];
    }).filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  if (errors && typeof errors === "object") {
    const parts = Object.entries(errors).flatMap(([field, value]) => {
      if (Array.isArray(value)) return value.map(v => `${field}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
      return [`${field}: ${typeof value === "string" ? value : JSON.stringify(value)}`];
    }).filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  return fallback;
}
async function createPagarmePaymentLink(order) {
  if (!PAGARME_ENABLED) throw new Error("Pagamento online ainda não está configurado.");
  const totalCents = cents(order.total);
  const isPix = normalize(order.payment) === normalize("Pix online");
  const isCard = normalize(order.payment) === normalize("Cartão de crédito online");
  if (!isPix && !isCard) throw new Error("Forma de pagamento online inválida.");

  const buildPaymentSettings = (includePixSettings = true) => {
    const settings = { accepted_payment_methods: [isPix ? "pix" : "credit_card"] };
    if (isPix && includePixSettings) {
      // O SDK oficial do Pagar.me expõe expires_in dentro da configuração
      // específica do Pix. Aqui usamos a mesma validade do link, convertida
      // para segundos para o QR Code Pix.
      settings.pix_settings = {
        expires_in: PAGARME_PAYMENT_LINK_EXPIRES_MINUTES * 60
      };
    }
    if (isCard) {
      settings.credit_card_settings = {
        operation_type: "auth_and_capture",
        installments: [{ number: 1, total: totalCents }]
      };
    }
    return settings;
  };

  const basePayload = {
    is_building: false,
    name: `MR Pizzaria pedido ${order.number}`.slice(0, 64),
    order_code: pagarmeOrderCode(order.number),
    type: "order",
    expires_in: PAGARME_PAYMENT_LINK_EXPIRES_MINUTES,
    max_paid_sessions: 1,
    cart_settings: { items: pagarmeCartItems(order) }
  };
  if (!basePayload.cart_settings.items.length) throw new Error("O pedido não possui itens cobrados para gerar o pagamento.");

  async function requestPaymentLink(includePixSettings = true) {
    const payload = { ...basePayload, payment_settings: buildPaymentSettings(includePixSettings) };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${PAGARME_BASE_URL}/paymentlinks`, {
        method: "POST",
        headers: {
          Authorization: pagarmeBasicAuthHeader(),
          "Content-Type": "application/json",
          "User-Agent": "pagarme-skill-generated/1.0"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const raw = await response.text().catch(() => "");
      let data = {};
      if (raw) {
        try { data = JSON.parse(raw); } catch (_) { data = {}; }
      }
      const message = pagarmeErrorMessage(data, raw.trim() || `HTTP ${response.status}`);
      return { response, data, raw, message, payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let result = await requestPaymentLink(true);

    // Há uma inconsistência entre páginas atuais da documentação do Checkout:
    // uma descreve pix_settings como obrigatório, enquanto o guia de integração
    // por IA mostra o Pix apenas em accepted_payment_methods. Para suportar as
    // duas variantes do backend, se a forma com pix_settings for rejeitada com
    // HTTP 400, fazemos uma única tentativa no formato simplificado oficial.
    if (isPix && result.response.status === 400) {
      console.warn("Pagar.me Pix: primeira tentativa recusada; tentando formato simplificado", {
        orderNumber: order.number,
        status: result.response.status,
        error: String(result.message || "").slice(0, 600),
        responseBody: String(result.raw || "").slice(0, 1200)
      });
      result = await requestPaymentLink(false);
    }

    const { response, data, raw, message } = result;
    if (!response.ok || !data?.url || !data?.id) {
      console.error("Pagar.me: falha ao criar checkout", {
        status: response.status,
        orderNumber: order.number,
        paymentMethod: isPix ? "pix" : "credit_card",
        error: String(message || `HTTP ${response.status}`).slice(0, 1000),
        responseBody: String(raw || "").slice(0, 1600)
      });
      throw new Error(`Não foi possível abrir o pagamento online (${String(message || `HTTP ${response.status}`).slice(0, 180)}).`);
    }
    console.log("Pagar.me: checkout criado", { orderNumber: order.number, paymentLinkId: data.id, test: PAGARME_TEST_MODE, paymentMethod: isPix ? "pix" : "credit_card" });
    return { id: String(data.id), url: String(data.url), status: String(data.status || "active") };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("O Pagar.me demorou para responder. Tente novamente.");
    throw error;
  }
}

async function updateOrderPaymentState(number, patch = {}) {
  const orderNumber = Number(number);
  if (!Number.isFinite(orderNumber)) return null;
  const safe = {
    status: patch.status == null ? null : String(patch.status),
    paymentStatus: patch.paymentStatus == null ? null : String(patch.paymentStatus).slice(0, 40),
    paymentLinkId: patch.paymentLinkId == null ? null : String(patch.paymentLinkId).slice(0, 160),
    paymentLinkUrl: patch.paymentLinkUrl == null ? null : String(patch.paymentLinkUrl).slice(0, 1500),
    paymentExternalId: patch.paymentExternalId == null ? null : String(patch.paymentExternalId).slice(0, 160)
  };
  if (!databaseReady || !pool) {
    const order = memoryOrders.find((item) => item.number === orderNumber);
    if (!order) return null;
    if (safe.status != null) order.status = safe.status;
    if (safe.paymentStatus != null) order.paymentStatus = safe.paymentStatus;
    if (safe.paymentLinkId != null) order.paymentLinkId = safe.paymentLinkId;
    if (safe.paymentLinkUrl != null) order.paymentLinkUrl = safe.paymentLinkUrl;
    if (safe.paymentExternalId != null) order.paymentExternalId = safe.paymentExternalId;
    order.paymentUpdatedAt = new Date().toISOString();
    order.updatedAt = order.paymentUpdatedAt;
    const updatedMemoryOrder = deepClone(order);
    publishPaymentStatus(updatedMemoryOrder);
    return updatedMemoryOrder;
  }
  const result = await pool.query(
    `UPDATE mr_orders SET
       status = COALESCE($2, status),
       payment_status = COALESCE($3, payment_status),
       payment_link_id = COALESCE($4, payment_link_id),
       payment_link_url = COALESCE($5, payment_link_url),
       payment_external_id = COALESCE($6, payment_external_id),
       payment_updated_at = NOW(), updated_at = NOW()
     WHERE order_number = $1 RETURNING *`,
    [orderNumber, safe.status, safe.paymentStatus, safe.paymentLinkId, safe.paymentLinkUrl, safe.paymentExternalId]
  );
  const updated = rowToOrder(result.rows[0]);
  if (updated) {
    await pool.query(
      `INSERT INTO mr_order_events (order_number, event_type, details) VALUES ($1, 'PAYMENT_CHANGED', $2::jsonb)`,
      [orderNumber, JSON.stringify({ paymentStatus: updated.paymentStatus, externalId: updated.paymentExternalId })]
    ).catch(() => null);
  }
  if (updated) publishPaymentStatus(updated);
  return updated;
}
const paymentStatusStreams = new Map();
function paymentStatusStreamKey(orderNumber, paymentLinkId) { return `${Number(orderNumber)}:${String(paymentLinkId || "")}`; }
function paymentStatusPayload(order) { return { ok: true, orderNumber: Number(order.number), paymentStatus: order.paymentStatus || "pending", status: order.status || "Aguardando pagamento", total: Number(order.total || 0) }; }
function publishPaymentStatus(order) {
  if (!order?.paymentLinkId) return;
  const key = paymentStatusStreamKey(order.number, order.paymentLinkId);
  const clients = paymentStatusStreams.get(key);
  if (!clients?.size) return;
  const msg = `data: ${JSON.stringify(paymentStatusPayload(order))}\n\n`;
  for (const client of [...clients]) { try { client.write(msg); } catch (_) { clients.delete(client); } }
  if (!clients.size) paymentStatusStreams.delete(key);
}
function addPaymentStatusStream(order, res) {
  const key = paymentStatusStreamKey(order.number, order.paymentLinkId);
  if (!paymentStatusStreams.has(key)) paymentStatusStreams.set(key, new Set());
  paymentStatusStreams.get(key).add(res);
  try { res.write(`data: ${JSON.stringify(paymentStatusPayload(order))}\n\n`); } catch (_) {}
  return () => { const set = paymentStatusStreams.get(key); if (!set) return; set.delete(res); if (!set.size) paymentStatusStreams.delete(key); };
}
function pagarmeOrderNumberFromWebhook(data) {
  // O Pagar.me também possui códigos internos numéricos (ex.: data.code).
  // Para nunca associar um webhook ao pedido errado, só aceitamos o identificador
  // que nós mesmos enviamos no payment link: MR-<numero>.
  const candidates = [data?.order_code, data?.code, data?.metadata?.order_code, data?.metadata?.order_number];
  for (const value of candidates) {
    const text = String(value || "").trim();
    const mr = text.match(/^MR[-_ ]?(\d+)$/i);
    if (mr) return Number(mr[1]);
  }
  return null;
}
function pagarmePaymentLinkIdFromWebhook(data) {
  const candidates = [
    data?.payment_link_id,
    data?.payment_link?.id,
    data?.checkout?.payment_link_id,
    data?.checkout?.id,
    data?.metadata?.payment_link_id
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (/^pl_[A-Za-z0-9_-]{6,}$/.test(text)) return text;
  }
  return "";
}
async function getOrderByPagarmePaymentLinkId(paymentLinkId) {
  const id = String(paymentLinkId || "").trim();
  if (!id) return null;
  if (!databaseReady || !pool) {
    const found = memoryOrders.find((item) => item.paymentProvider === "pagarme" && item.paymentLinkId === id);
    return found ? deepClone(found) : null;
  }
  const result = await pool.query(`SELECT * FROM mr_orders WHERE payment_provider = 'pagarme' AND payment_link_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
  return result.rows[0] ? rowToOrder(result.rows[0]) : null;
}
async function notifyPaymentResult(order, text) {
  const recipient = normalizeRecipientNumber(order?.customerPhone || "");
  if (!/^\d{10,15}$/.test(recipient)) return false;
  if (await sendText(recipient, text)) return true;
  if (WHATSAPP_STATUS_TEMPLATE) {
    return sendTemplateMessage(recipient, WHATSAPP_STATUS_TEMPLATE, WHATSAPP_STATUS_TEMPLATE_LANGUAGE, [String(order.number), String(text).replace(/^\S+\s*/, "").slice(0, 180)]);
  }
  return false;
}

async function listOrders({ limit = 200, status = "" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  if (!databaseReady || !pool) {
    return memoryOrders.filter((order) => !status || order.status === status).slice(0, safeLimit);
  }
  const values = [];
  let where = "";
  if (status) {
    values.push(status);
    where = `WHERE status = $${values.length}`;
  }
  values.push(safeLimit);
  const result = await pool.query(`SELECT * FROM mr_orders ${where} ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT $${values.length}`, values);
  return result.rows.map(rowToOrder);
}

function ymdInStoreZone(date=new Date()){const p=getZonedParts(date);return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`}
function parseYmd(v){const m=String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const y=+m[1],mo=+m[2],d=+m[3],x=new Date(Date.UTC(y,mo-1,d));return x.getUTCFullYear()===y&&x.getUTCMonth()===mo-1&&x.getUTCDate()===d?{year:y,month:mo,day:d}:null}
function addDaysYmd(v,days){const p=parseYmd(v);if(!p)return"";const x=new Date(Date.UTC(p.year,p.month-1,p.day+Number(days||0)));return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,"0")}-${String(x.getUTCDate()).padStart(2,"0")}`}
function reportRange(q={}){const today=ymdInStoreZone();let from=parseYmd(q.from)?String(q.from):today,to=parseYmd(q.to)?String(q.to):today;if(from>to)[from,to]=[to,from];const a=parseYmd(from),b=parseYmd(addDaysYmd(to,1));return{from,to,start:zonedDateTimeToUtc(a.year,a.month,a.day,0,0),endExclusive:zonedDateTimeToUtc(b.year,b.month,b.day,0,0)}}
async function listOrdersForReport({start,endExclusive}){if(!databaseReady||!pool){const a=start.getTime(),b=endExclusive.getTime();return memoryOrders.filter(o=>{const t=new Date(o.createdAt).getTime();return t>=a&&t<b}).map(deepClone)}const r=await pool.query(`SELECT * FROM mr_orders WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at DESC`,[start.toISOString(),endExclusive.toISOString()]);return r.rows.map(rowToOrder)}
async function resetTestSales(){if(!TEST_MODE)throw new Error("A limpeza de vendas só fica disponível quando TEST_MODE=true.");if(!databaseReady||!pool){memoryOrders.splice(0);memoryAbandonedCarts.splice(0);memoryTableTabs.splice(0);memoryOrderSequence=100;memoryTabSequence=0;return true}const c=await pool.connect();try{await c.query("BEGIN");await c.query("TRUNCATE TABLE mr_order_events,mr_orders,mr_abandoned_carts,mr_table_tabs RESTART IDENTITY");await c.query("ALTER SEQUENCE mr_order_number_seq RESTART WITH 101");await c.query("COMMIT");return true}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}}

async function getOrderByNumber(number) {
  const orderNumber = Number(number);
  if (!Number.isFinite(orderNumber)) return null;
  if (!databaseReady || !pool) return memoryOrders.find((order) => order.number === orderNumber) || null;
  const result = await pool.query("SELECT * FROM mr_orders WHERE order_number = $1 LIMIT 1", [orderNumber]);
  return rowToOrder(result.rows[0]);
}

async function getLatestOrderByPhone(phone, { repeatable = false } = {}) {
  if (!databaseReady || !pool) {
    return memoryOrders.find((order) => order.customerPhone === phone && (!repeatable || order.status !== "Cancelado")) || null;
  }
  const values = [phone];
  const extra = repeatable ? "AND status <> 'Cancelado'" : "";
  const result = await pool.query(
    `SELECT * FROM mr_orders WHERE customer_phone = $1 ${extra} ORDER BY created_at DESC LIMIT 1`,
    values
  );
  return rowToOrder(result.rows[0]);
}

async function updateOrderStatus(number, status) {
  if (!ORDER_STATUSES.includes(status)) throw new Error("Status inválido.");
  const orderNumber = Number(number);
  if (!databaseReady || !pool) {
    const order = memoryOrders.find((item) => item.number === orderNumber);
    if (!order) return null;
    order.status = status;
    order.updatedAt = new Date().toISOString();
    return order;
  }
  const result = await pool.query(
    `UPDATE mr_orders SET status = $2, updated_at = NOW() WHERE order_number = $1 RETURNING *`,
    [orderNumber, status]
  );
  const updated = rowToOrder(result.rows[0]);
  if (updated) {
    await pool.query(
      `INSERT INTO mr_order_events (order_number, event_type, details) VALUES ($1, 'STATUS_CHANGED', $2::jsonb)`,
      [orderNumber, JSON.stringify({ status })]
    );
  }
  return updated;
}

async function cancelLatestCustomerOrder(phone) {
  const order = await getLatestOrderByPhone(phone);
  if (!order) return { ok: false, reason: "none" };
  if (!["Agendado", "Novo", "Aceito"].includes(order.status)) {
    return { ok: false, reason: "locked", order };
  }
  const updated = await updateOrderStatus(order.number, "Cancelado");
  return { ok: true, order: updated };
}

async function markOrderPrinted(number, type) {
  if (!["pizza", "kitchen"].includes(type)) throw new Error("Tipo de impressão inválido.");
  const orderNumber = Number(number);
  const field = type === "pizza" ? "pizza_printed_at" : "kitchen_printed_at";
  if (!databaseReady || !pool) {
    const order = memoryOrders.find((item) => item.number === orderNumber);
    if (!order) return null;
    if (type === "pizza") order.pizzaPrintedAt = new Date().toISOString();
    else order.kitchenPrintedAt = new Date().toISOString();
    if (order.status === "Agendado") order.status = "Novo";
    return order;
  }
  const result = await pool.query(
    `UPDATE mr_orders SET ${field} = NOW(), status = CASE WHEN status = 'Agendado' THEN 'Novo' ELSE status END, updated_at = NOW()
     WHERE order_number = $1 RETURNING *`,
    [orderNumber]
  );
  return rowToOrder(result.rows[0]);
}

async function saveReservation(data) {
  if (!databaseReady || !pool) {
    const saved = {
      ...data,
      id: ++memoryReservationSequence,
      number: memoryReservationSequence,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "Pendente"
    };
    memoryReservations.unshift(saved);
    return saved;
  }
  const result = await pool.query(
    `INSERT INTO mr_reservations (customer_name, customer_phone, reservation_for, people, notes, status)
     VALUES ($1,$2,$3,$4,$5,'Pendente') RETURNING *`,
    [data.customerName, data.customerPhone, data.reservationFor, data.people, data.notes || ""]
  );
  return rowToReservation(result.rows[0]);
}

async function listReservations({ limit = 250, status = "" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 250, 1), 1000);
  if (!databaseReady || !pool) {
    return memoryReservations.filter((item) => !status || item.status === status).slice(0, safeLimit);
  }
  const values = [];
  let where = "";
  if (status) {
    values.push(status);
    where = `WHERE status = $${values.length}`;
  }
  values.push(safeLimit);
  const result = await pool.query(`SELECT * FROM mr_reservations ${where} ORDER BY reservation_for ASC LIMIT $${values.length}`, values);
  return result.rows.map(rowToReservation);
}

async function updateReservationStatus(number, status) {
  if (!RESERVATION_STATUSES.includes(status)) throw new Error("Status de reserva inválido.");
  const reservationNumber = Number(number);
  if (!databaseReady || !pool) {
    const reservation = memoryReservations.find((item) => item.number === reservationNumber);
    if (!reservation) return null;
    reservation.status = status;
    reservation.updatedAt = new Date().toISOString();
    return reservation;
  }
  const result = await pool.query(
    `UPDATE mr_reservations SET status = $2, updated_at = NOW() WHERE reservation_number = $1 RETURNING *`,
    [reservationNumber, status]
  );
  return rowToReservation(result.rows[0]);
}

async function saveServiceRequest(data) {
  if (!databaseReady || !pool) {
    const saved = { ...data, id: ++memoryServiceSequence, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "Pendente" };
    memoryServiceRequests.unshift(saved);
    return saved;
  }
  const result = await pool.query(
    `INSERT INTO mr_service_requests (customer_name, customer_phone, message, status) VALUES ($1,$2,$3,'Pendente') RETURNING *`,
    [data.customerName, data.customerPhone, data.message || "Solicitação pelo WhatsApp"]
  );
  return rowToServiceRequest(result.rows[0]);
}

async function listServiceRequests({ limit = 250, status = "" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 250, 1), 1000);
  if (!databaseReady || !pool) return memoryServiceRequests.filter((item) => !status || item.status === status).slice(0, safeLimit);
  const values = [];
  let where = "";
  if (status) {
    values.push(status);
    where = `WHERE status = $${values.length}`;
  }
  values.push(safeLimit);
  const result = await pool.query(`SELECT * FROM mr_service_requests ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
  return result.rows.map(rowToServiceRequest);
}

async function updateServiceRequestStatus(id, status) {
  if (!SERVICE_STATUSES.includes(status)) throw new Error("Status de atendimento inválido.");
  const requestId = Number(id);
  if (!databaseReady || !pool) {
    const item = memoryServiceRequests.find((request) => request.id === requestId);
    if (!item) return null;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    return item;
  }
  const result = await pool.query(
    `UPDATE mr_service_requests SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [requestId, status]
  );
  return rowToServiceRequest(result.rows[0]);
}


function normalizeTableNumber(value) {
  const number = Number.parseInt(String(value || "").replace(/\D/g, ""), 10);
  return Number.isInteger(number) && number >= 1 && number <= CONFIG.tableCount ? number : null;
}

function makeTabCode(tableNumber, sequenceNo) {
  return `M${String(tableNumber).padStart(2, "0")}-C${String(sequenceNo).padStart(2, "0")}`;
}

async function getTableTab(tabCode) {
  const code = String(tabCode || "").trim().toUpperCase();
  if (!code) return null;
  if (!databaseReady || !pool) return memoryTableTabs.find((item) => item.tabCode === code) || null;
  const result = await pool.query("SELECT * FROM mr_table_tabs WHERE tab_code = $1 LIMIT 1", [code]);
  return rowToTableTab(result.rows[0]);
}

async function createTableTab({ tableNumber, customerName = "Comanda geral", waiterName = "", people = 0 }) {
  const table = normalizeTableNumber(tableNumber);
  if (!table) throw new Error(`Mesa inválida. Use um número de 1 a ${CONFIG.tableCount}.`);
  const cleanName = String(customerName || "Comanda geral").trim().slice(0, 80) || "Comanda geral";
  const cleanWaiter = String(waiterName || "").trim().slice(0, 80);
  const cleanPeople = Math.max(0, Math.min(50, Number.parseInt(people, 10) || 0));

  if (!databaseReady || !pool) {
    const next = Math.max(0, ...memoryTableTabs.filter((item) => item.tableNumber === table).map((item) => item.sequenceNo)) + 1;
    const now = new Date().toISOString();
    const saved = { id: ++memoryTabSequence + 100000, tabCode: makeTabCode(table, next), tableNumber: table, sequenceNo: next, customerName: cleanName, waiterName: cleanWaiter, people: cleanPeople, status: "Aberta", createdAt: now, updatedAt: now, closedAt: null };
    memoryTableTabs.unshift(saved);
    return saved;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nextResult = await pool.query("SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM mr_table_tabs WHERE table_number = $1", [table]);
    const next = Number(nextResult.rows[0].next);
    const code = makeTabCode(table, next);
    try {
      const result = await pool.query(
        `INSERT INTO mr_table_tabs (tab_code, table_number, sequence_no, customer_name, waiter_name, people, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Aberta') RETURNING *`,
        [code, table, next, cleanName, cleanWaiter, cleanPeople]
      );
      return rowToTableTab(result.rows[0]);
    } catch (error) {
      if (error?.code !== "23505" || attempt === 3) throw error;
    }
  }
  throw new Error("Não foi possível abrir a comanda.");
}

async function ensureTableTab({ tableNumber, tabCode = "", customerName = "Comanda geral", waiterName = "", people = 0 }) {
  if (tabCode) {
    const existing = await getTableTab(tabCode);
    if (!existing) throw new Error("A comanda informada não existe.");
    if (existing.status === "Fechada") throw new Error("Esta comanda já foi fechada.");
    if (existing.tableNumber !== normalizeTableNumber(tableNumber)) throw new Error("A comanda não pertence à mesa informada.");
    return existing;
  }
  return createTableTab({ tableNumber, customerName, waiterName, people });
}

async function listTableTabs({ includeClosed = true, tableNumber = null, limit = 1000 } = {}) {
  if (!databaseReady || !pool) {
    return memoryTableTabs.filter((item) => (includeClosed || item.status !== "Fechada") && (!tableNumber || item.tableNumber === Number(tableNumber))).slice(0, limit);
  }
  const values = [];
  const where = [];
  if (!includeClosed) { values.push("Fechada"); where.push(`status <> $${values.length}`); }
  if (tableNumber) { values.push(Number(tableNumber)); where.push(`table_number = $${values.length}`); }
  values.push(Math.min(Math.max(Number(limit) || 1000, 1), 2000));
  const result = await pool.query(`SELECT * FROM mr_table_tabs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY table_number, created_at DESC LIMIT $${values.length}`, values);
  return result.rows.map(rowToTableTab);
}

async function updateTableTabStatus(tabCode, status) {
  if (!TAB_STATUSES.includes(status)) throw new Error("Status de comanda inválido.");
  const code = String(tabCode || "").trim().toUpperCase();
  if (!databaseReady || !pool) {
    const tab = memoryTableTabs.find((item) => item.tabCode === code);
    if (!tab) return null;
    tab.status = status;
    tab.updatedAt = new Date().toISOString();
    tab.closedAt = status === "Fechada" ? tab.updatedAt : null;
    if (status === "Fechada") {
      for (const order of memoryOrders.filter((item) => item.tabCode === code && item.status !== "Cancelado")) order.status = "Finalizado";
    }
    return tab;
  }
  const result = await pool.query(
    `UPDATE mr_table_tabs SET status = $2, updated_at = NOW(), closed_at = CASE WHEN $2 = 'Fechada' THEN NOW() ELSE NULL END WHERE tab_code = $1 RETURNING *`,
    [code, status]
  );
  const updated = rowToTableTab(result.rows[0]);
  if (updated && status === "Fechada") {
    await pool.query("UPDATE mr_orders SET status = 'Finalizado', updated_at = NOW() WHERE tab_code = $1 AND status <> 'Cancelado'", [code]);
  }
  return updated;
}

async function listOrdersByTab(tabCode) {
  const code = String(tabCode || "").trim().toUpperCase();
  if (!databaseReady || !pool) return memoryOrders.filter((item) => item.tabCode === code);
  const result = await pool.query("SELECT * FROM mr_orders WHERE tab_code = $1 ORDER BY created_at ASC", [code]);
  return result.rows.map(rowToOrder);
}

function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin || "")).digest("hex");
}

async function listStaff({ activeOnly = false } = {}) {
  if (!databaseReady || !pool) return memoryStaff.filter((item) => !activeOnly || item.active);
  const result = await pool.query(`SELECT * FROM mr_staff ${activeOnly ? "WHERE active = TRUE" : ""} ORDER BY active DESC, name ASC`);
  return result.rows.map(rowToStaff);
}

async function createStaff({ name, role, pin }) {
  const cleanName = String(name || "").trim().slice(0, 80);
  if (cleanName.length < 2) throw new Error("Informe o nome do funcionário.");
  if (!STAFF_ROLES.includes(role)) throw new Error("Função inválida.");
  const cleanPin = String(pin || "").replace(/\D/g, "");
  if (cleanPin.length < 4 || cleanPin.length > 8) throw new Error("O PIN deve ter de 4 a 8 números.");
  if (!databaseReady || !pool) {
    if (memoryStaff.some((item) => normalize(item.name) === normalize(cleanName))) throw new Error("Já existe um funcionário com esse nome.");
    const now = new Date().toISOString();
    const saved = { id: ++memoryStaffSequence, name: cleanName, role, active: true, pinHash: hashPin(cleanPin), createdAt: now, updatedAt: now };
    memoryStaff.push(saved);
    return saved;
  }
  const result = await pool.query(
    "INSERT INTO mr_staff (name, role, pin_hash, active) VALUES ($1,$2,$3,TRUE) RETURNING *",
    [cleanName, role, hashPin(cleanPin)]
  );
  return rowToStaff(result.rows[0]);
}

async function toggleStaff(id) {
  const staffId = Number(id);
  if (!databaseReady || !pool) {
    const item = memoryStaff.find((staff) => staff.id === staffId);
    if (!item) return null;
    item.active = !item.active;
    item.updatedAt = new Date().toISOString();
    return item;
  }
  const result = await pool.query("UPDATE mr_staff SET active = NOT active, updated_at = NOW() WHERE id = $1 RETURNING *", [staffId]);
  return rowToStaff(result.rows[0]);
}

function storageMode() {
  return databaseReady ? "postgres" : "memory";
}

function getZonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(value("year")), month: Number(value("month")), day: Number(value("day")),
    hour: Number(value("hour")), minute: Number(value("minute")), second: Number(value("second")),
    weekday: value("weekday") || ""
  };
}

function timeZoneOffsetMs(date) {
  const p = getZonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(year, month, day, hour, minute) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(naiveUtc);
  for (let i = 0; i < 3; i += 1) {
    result = new Date(naiveUtc - timeZoneOffsetMs(result));
  }
  return result;
}

function localDatePlusDays(days) {
  const p = getZonedParts();
  const noon = zonedDateTimeToUtc(p.year, p.month, p.day, 12, 0);
  noon.setUTCDate(noon.getUTCDate() + days);
  const result = getZonedParts(noon);
  return { year: result.year, month: result.month, day: result.day };
}

function parseDateInput(input) {
  const command = normalize(input);
  if (command === "hoje") return localDatePlusDays(0);
  if (["amanha", "amanhã"].includes(command)) return localDatePlusDays(1);
  const match = String(input || "").trim().match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (!match) return null;
  const current = getZonedParts();
  let year = match[3] ? Number(match[3]) : current.year;
  if (year < 100) year += 2000;
  const month = Number(match[2]);
  const day = Number(match[1]);
  const test = new Date(Date.UTC(year, month - 1, day));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) return null;
  if (!match[3]) {
    const candidate = zonedDateTimeToUtc(year, month, day, 23, 59);
    if (candidate.getTime() < Date.now()) year += 1;
  }
  return { year, month, day };
}

function parseTimeInput(input) {
  const match = String(input || "").trim().match(/^(\d{1,2})(?:[:hH](\d{1,2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildScheduledDate(datePart, timePart) {
  if (!datePart || !timePart) return null;
  return zonedDateTimeToUtc(datePart.year, datePart.month, datePart.day, timePart.hour, timePart.minute);
}

function validateBusinessSchedule(date, maxAdvanceDays) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Data ou horário inválido.";
  const now = Date.now();
  if (date.getTime() < now + 20 * 60 * 1000) return "Escolha um horário com pelo menos 20 minutos de antecedência.";
  if (date.getTime() > now + maxAdvanceDays * 24 * 60 * 60 * 1000) return `Escolha uma data dentro dos próximos ${maxAdvanceDays} dias.`;
  const p = getZonedParts(date);
  if (p.weekday.toLowerCase().startsWith("sun")) return "A MR Pizzaria não abre aos domingos.";
  const minutes = p.hour * 60 + p.minute;
  if (minutes < 18 * 60 || minutes > 22 * 60 + 30) return "Escolha um horário entre 18h e 22h30.";
  return "";
}

function isStoreOpen() {
  if (TEST_MODE) return true;
  const p = getZonedParts();
  const openDay = !p.weekday.toLowerCase().startsWith("sun");
  const total = p.hour * 60 + p.minute;
  return openDay && total >= 18 * 60 && total <= 22 * 60 + 30;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function newOrder() {
  return {
    deliveryType: "",
    items: [],
    address: {},
    location: {},
    payment: "",
    changeFor: null,
    pickupName: "",
    tableNumber: "",
    tabCode: "",
    commandName: "",
    waiterName: "",
    reservationNumber: null,
    scheduledFor: null,
    couponCode: "",
    discount: 0,
    paymentReceiptId: "",
    paymentReceiptType: ""
  };
}

function getSession(waId, customerName) {
  if (!sessions.has(waId)) {
    sessions.set(waId, {
      waId,
      customerName: customerName || "cliente",
      step: "MAIN",
      order: newOrder(),
      draft: {},
      history: [],
      skipHistoryOnce: false,
      updatedAt: Date.now()
    });
  }
  const session = sessions.get(waId);
  if (customerName) session.customerName = customerName;
  session.updatedAt = Date.now();
  return session;
}

function resetSession(session) {
  session.step = "MAIN";
  session.order = newOrder();
  session.draft = {};
  session.history = [];
  session.skipHistoryOnce = true;
  session.updatedAt = Date.now();
}

function itemSubtotal(order) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function calculateDiscount(order) {
  const subtotal = itemSubtotal(order);
  if (!order.couponCode || !COUPON_CODE || order.couponCode !== COUPON_CODE || COUPON_PERCENT <= 0) return 0;
  return Math.round(subtotal * (COUPON_PERCENT / 100) * 100) / 100;
}

function orderTotal(order) {
  const subtotal = itemSubtotal(order);
  const discount = calculateDiscount(order);
  const delivery = order.deliveryType === "Entrega" ? CONFIG.deliveryFee : 0;
  return Math.max(0, subtotal - discount + delivery);
}

function pizzaBasePrice(size, flavor) {
  return SPECIAL_FLAVORS.some((item) => normalize(item) === normalize(flavor)) ? CONFIG.pizzaPrices.special[size] : CONFIG.pizzaPrices.regular[size];
}

function findFlavor(input) {
  const value = normalize(input);
  if (!value) return { match: null, suggestions: [] };
  const exact = FLAVORS.find((flavor) => normalize(flavor) === value);
  if (exact) return { match: exact, suggestions: [] };
  const suggestions = FLAVORS.filter((flavor) => normalize(flavor).includes(value) || value.includes(normalize(flavor)));
  return suggestions.length === 1 ? { match: suggestions[0], suggestions: [] } : { match: null, suggestions: suggestions.slice(0, 6) };
}


function cleanSiteText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

async function buildSiteOrderItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("Adicione pelo menos um item ao carrinho.");
  if (rawItems.length > 50) throw new Error("O carrinho possui itens demais.");
  const built = [];

  for (const raw of rawItems) {
    const qty = Number.parseInt(raw?.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("Quantidade inválida no carrinho.");
    const note = cleanSiteText(raw?.note, 250);

    if (raw?.kind === "pizza") {
      const size = String(raw.size || "").toUpperCase();
      if (!["P", "M", "G"].includes(size)) throw new Error("Tamanho de pizza inválido.");
      const flavor1 = FLAVORS.find((item) => normalize(item) === normalize(raw.flavor1));
      const flavor2 = cleanSiteText(raw.flavor2, 100)
        ? FLAVORS.find((item) => normalize(item) === normalize(raw.flavor2))
        : "";
      if (!flavor1 || (raw.flavor2 && !flavor2)) throw new Error("Sabor de pizza inválido.");
      const border = String(raw.borderKey || "none");
      if (!CONFIG.borders[border]) throw new Error("Borda de pizza inválida.");

      const first = pizzaBasePrice(size, flavor1);
      const second = flavor2 ? pizzaBasePrice(size, flavor2) : first;
      const base = flavor2 ? (first + second) / 2 : first;
      const unit = base + Number(CONFIG.borders[border][size]);
      const name = `Pizza ${sizeLabel(size)} — ${flavor2 ? `½ ${flavor1} / ½ ${flavor2}` : flavor1}${border !== "none" ? ` — ${CONFIG.borders[border].name}` : ""}`;
      built.push({ type: "pizza", category: "Pizzas", name, qty, unit, total: unit * qty, note });
      continue;
    }

    if (raw?.kind === "product") {
      const category = Object.keys(PRODUCTS).find((item) => normalize(item) === normalize(raw.category));
      if (!category) throw new Error("Categoria inválida no carrinho.");
      const product = PRODUCTS[category].find((item) => normalize(item.name) === normalize(raw.name));
      if (!product) throw new Error("Produto inválido no carrinho.");
      built.push({ type: "product", category, name: product.name, qty, unit: product.price, total: product.price * qty, note });
      continue;
    }

    if (raw?.kind === "combo") {
      const comboId = Number.parseInt(raw?.comboId, 10);
      const combos = await listFeaturedCombos({ includeInactive: true });
      const combo = combos.find((item) => item.active && Number(item.id) === comboId);
      if (!combo) throw new Error("Combo indisponível ou inválido.");
      const traditionalFlavors = PIZZA_FLAVORS.filter((item) => item.category === "Tradicional").map((item) => item.name);
      const flavor1 = traditionalFlavors.find((item) => normalize(item) === normalize(raw.flavor1));
      const flavor2 = cleanSiteText(raw.flavor2, 100)
        ? traditionalFlavors.find((item) => normalize(item) === normalize(raw.flavor2))
        : "";
      if (!flavor1) throw new Error("Escolha o primeiro sabor tradicional da pizza grande.");
      if (raw.flavor2 && !flavor2) throw new Error("O segundo sabor do combo é inválido.");
      if (flavor2 && normalize(flavor1) === normalize(flavor2)) {
        throw new Error("Escolha sabores diferentes ou deixe apenas um sabor.");
      }
      const flavorLabel = flavor2 ? `½ ${flavor1} / ½ ${flavor2}` : flavor1;
      built.push({
        type: "product",
        category: "Combos",
        name: `${combo.name} — Pizza grande ${flavorLabel}`,
        qty,
        unit: combo.price,
        total: combo.price * qty,
        note: [note, combo.description].filter(Boolean).join(" — ") || "Combo em destaque"
      });
      continue;
    }

    if (raw?.kind === "promo_combo") {
      const allowedFlavors = ["Calabresa", "Mussarela", "Frango catupiry", "Tomate seco"];
      const flavor1 = allowedFlavors.find((item) => normalize(item) === normalize(raw.flavor1));
      const flavor2 = cleanSiteText(raw.flavor2, 100)
        ? allowedFlavors.find((item) => normalize(item) === normalize(raw.flavor2))
        : "";
      if (!flavor1) throw new Error("Escolha pelo menos um sabor válido da promoção.");
      if (raw.flavor2 && !flavor2) throw new Error("O segundo sabor da promoção é inválido.");
      if (flavor2 && normalize(flavor1) === normalize(flavor2)) {
        throw new Error("Escolha sabores diferentes ou deixe apenas um sabor.");
      }

      const pizzaName = `Combo promoção — Pizza grande ${flavor2 ? `½ ${flavor1} / ½ ${flavor2}` : flavor1}`;
      built.push({
        type: "pizza",
        category: "Promoções",
        name: pizzaName,
        qty,
        unit: 110,
        total: 110 * qty,
        note: note ? `${note} — Inclui brotinha de chocolate com morango` : "Inclui brotinha de chocolate com morango"
      });
      built.push({
        type: "product",
        category: "Promoções",
        name: "Brotinha de chocolate com morango — inclusa no combo",
        qty,
        unit: 0,
        total: 0,
        note: "Item incluso na promoção"
      });
      continue;
    }

    throw new Error("Item inválido no carrinho.");
  }

  return built;
}

const siteOrderAttempts = new Map();
function siteOrderRateAllowed(req) {
  const key = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const previous = (siteOrderAttempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (previous.length >= 10) return false;
  previous.push(now);
  siteOrderAttempts.set(key, previous);
  return true;
}

function mainMenu(name) {
  return [
    `Olá, ${name}! Bem-vindo à *MR Pizzaria* 🍕`,
    "",
    "Escolha uma opção:",
    "*1* — Fazer pedido agora",
    "*2* — Comprar pelo site",
    "*3* — Ver cardápio",
    "*4* — Promoções do dia",
    "*5* — Acompanhar meu pedido",
    "*6* — Repetir meu último pedido",
    "*7* — Agendar pedido",
    "*8* — Reservar mesa / consumir no local",
    "*9* — Endereço e horário",
    "*10* — Falar com atendente",
    "*11* — Entrar no grupo do WhatsApp",
    "*12* — Baixar cardápio em PDF",
    "*0* — Cancelar pedido confirmado",
    "",
    "Digite *MENU* para voltar ao início ou *CANCELAR* para abandonar o que estiver preenchendo."
  ].join("\n");
}

function categoryMenu(order) {
  return [
    "🛒 *Escolha uma categoria:*",
    "*1* — Pizza",
    "*2* — Lanche",
    "*3* — Porção",
    "*4* — Bebida",
    "*5* — Drink",
    "*6* — Doce",
    "*7* — Aplicar cupom",
    "*8* — Finalizar pedido",
    "*9* — Cancelar este pedido",
    "",
    `Itens no carrinho: *${(order.items || []).length}*`,
    `Subtotal: *${money(itemSubtotal(order))}*${order.couponCode ? `\nCupom: *${order.couponCode}*` : ""}`
  ].join("\n");
}

function fullMenuText() {
  return [
    "📖 *Cardápio MR Pizzaria*",
    "",
    "🍕 *Pizzas tradicionais*",
    "Pequena — R$ 60,00 | Média — R$ 70,00 | Grande — R$ 80,00",
    "",
    "⭐ *Pizzas especiais*",
    "Da Casa, Carne seca e Strogonoff de carne",
    "Pequena — R$ 80,00 | Média — R$ 90,00 | Grande — R$ 100,00",
    "",
    "🥔 A pizza de Strogonoff de carne leva batata palha.",
    "Pizza pequena: 1 sabor. Média e grande: até 2 sabores, com valor proporcional.",
    "Entrega: R$ 7,00. Retirada e consumo no local sem taxa.",
    "",
    "Digite *SABORES*, *LANCHES*, *PORÇÕES*, *BEBIDAS*, *DRINKS* ou *DOCES* para ver as opções.",
    "Digite *12* para receber o cardápio completo em PDF.",
    "Digite *1* para fazer um pedido agora, *2* para comprar pelo site ou *7* para agendar.",
    ORDER_SITE_URL ? `🛒 Pedido online: ${ORDER_SITE_URL}` : "",
    CARDAPIO_PDF_URL ? `📄 Cardápio em PDF: ${CARDAPIO_PDF_URL}` : ""
  ].join("\n");
}

function promotionText(promotion) {
  const text = String(promotion?.text || "").trim();
  if (!promotion?.active || (!text && !promotion?.hasImage)) {
    return "No momento não há promoção cadastrada. Consulte novamente mais tarde ou digite *3* para ver o cardápio.";
  }
  const site = ORDER_SITE_URL
    ? `\n\n🛒 *Comprar pelo site:*\n${ORDER_SITE_URL}`
    : "";
  return `${text ? `🔥 *Promoção da MR Pizzaria*\n\n${text}\n\n` : ""}Digite *1* para fazer o pedido pelo WhatsApp ou *7* para agendar.${site}`;
}

function flavorsText() {
  const chunks = [];
  for (const category of ["Tradicional", "Especial", "Doce"]) {
    const items = PIZZA_FLAVORS.filter((item) => item.category === category);
    for (let i = 0; i < items.length; i += 12) {
      const part = items.slice(i, i + 12);
      chunks.push(`🍕 *Pizzas ${category.toLowerCase()}${items.length > 12 ? ` — ${Math.floor(i / 12) + 1}/${Math.ceil(items.length / 12)}` : ""}*\n` + part.map((item) => `• *${item.name}* — ${item.description}`).join("\n"));
    }
  }
  return chunks;
}

function productListText(category) {
  const items = PRODUCTS[category] || [];
  return [
    `*${category}*`,
    ...items.map((item, index) => `*${index + 1}* — ${item.name} — ${money(item.price)}${item.description ? `\n   ${item.description}` : ""}`),
    "",
    "Digite o número do item ou *0* para voltar."
  ].join("\n");
}

function sizeLabel(size) {
  return ({ P: "Pequena", M: "Média", G: "Grande" })[size] || size;
}

function formatAddress(address) {
  const base = [
    [address?.street, address?.number].filter(Boolean).join(", "),
    address?.district,
    address?.reference
  ].filter(Boolean).join(" — ");
  if (address?.mapUrl) return `${base}${base ? " — " : ""}Localização: ${address.mapUrl}`;
  return base;
}

function summarizeOrder(order, orderNumber = null) {
  const subtotal = itemSubtotal(order);
  const discount = calculateDiscount(order);
  const lines = [];
  if (orderNumber) lines.push(`🍕 *MR Pizzaria — Pedido nº ${orderNumber}*`, "");
  if (order.scheduledFor) lines.push(`📅 *Agendado para: ${formatDateTime(order.scheduledFor)}*`, "");
  lines.push(...order.items.map((item) => {
    const obs = item.note ? ` — Obs.: ${item.note}` : "";
    return `• ${item.qty}x ${item.name}${obs} — ${money(item.total)}`;
  }));
  lines.push("", `Subtotal: ${money(subtotal)}`);
  if (discount > 0) lines.push(`Desconto (${order.couponCode}): -${money(discount)}`);
  lines.push(`Entrega: ${money(order.deliveryType === "Entrega" ? CONFIG.deliveryFee : 0)}`);
  lines.push(`*Total: ${money(orderTotal(order))}*`);
  lines.push("", `${order.deliveryType}: ${order.deliveryType === "Entrega" ? formatAddress(order.address) : CONFIG.storeAddress}`);
  if (order.deliveryType === "Retirada" && order.pickupName) lines.push(`Retirada em nome de: ${order.pickupName}`);
  if (order.deliveryType === "Consumir no local") {
    if (order.reservationNumber) lines.push(`Reserva vinculada: nº ${order.reservationNumber}`);
    lines.push(`Mesa: ${order.tableNumber || "A definir"}`);
    if (order.tabCode) lines.push(`Comanda: ${order.tabCode}`);
    if (order.commandName) lines.push(`Nome da comanda: ${order.commandName}`);
    if (order.waiterName) lines.push(`Garçom: ${order.waiterName}`);
  }
  lines.push(`Pagamento: ${order.payment}${order.changeFor ? ` — troco para ${money(order.changeFor)}` : ""}`);
  if (order.payment === "Pix") lines.push(`Chave Pix: ${CONFIG.pix}${order.paymentReceiptId ? " — comprovante recebido" : ""}`);
  lines.push(`Previsão: ${order.scheduledFor ? "conforme horário agendado" : CONFIG.estimate}.`);
  return lines.join("\n");
}

function orderTrackingText(order) {
  if (!order) return "Não encontrei nenhum pedido ligado a este WhatsApp.";
  const when = order.scheduledFor ? `\nAgendado para: *${formatDateTime(order.scheduledFor)}*` : "";
  return `📦 *Pedido nº ${order.number}*\nStatus: *${order.status}*${when}\nTotal: ${money(order.total)}\nCriado em: ${formatDateTime(order.createdAt)}`;
}

function reservationSummary(draft, number = null) {
  return [
    number ? `🍽️ *Reserva nº ${number}*` : "🍽️ *Solicitação de reserva*",
    "Atendimento: *Consumir no local*",
    `Data e horário: *${formatDateTime(draft.reservationFor)}*`,
    `Pessoas: *${draft.people}*`,
    `Nome: *${draft.customerName}*`,
    `Observação: ${draft.notes || "Nenhuma"}`
  ].join("\n");
}

function normalizeRecipientNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 12 && ["6", "7", "8", "9"].includes(digits.charAt(4))) {
    return digits.slice(0, 4) + "9" + digits.slice(4);
  }
  return digits;
}

async function sendText(to, text, options = {}) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.");
    return false;
  }
  const recipient = String(to);
  let bodyText = String(text || "");
  if (activeInteractiveMessages.has(recipient) && !bodyText.includes("*VOLTAR*") && !bodyText.includes("Digite *MENU* para voltar ao início")) {
    bodyText += "\n\n↩️ Digite *VOLTAR* para retornar à tela anterior.";
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: Boolean(options.previewUrl), body: bodyText }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao enviar mensagem:", response.status, data);
    return false;
  }
  lastBotMessages.set(recipient, bodyText);
  console.log("Mensagem enviada:", data.messages?.[0]?.id || data);
  return true;
}

async function sendTemplateMessage(to, templateName, languageCode, parameters = []) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !templateName) return false;
  const recipient = normalizeRecipientNumber(to);
  const components = parameters.length ? [{
    type: "body",
    parameters: parameters.map((value) => ({ type: "text", text: String(value ?? "") }))
  }] : undefined;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "template",
    template: { name: templateName, language: { code: languageCode || "pt_BR" } }
  };
  if (components) body.template.components = components;
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao enviar template de status:", response.status, data);
    return false;
  }
  console.log("Template de status enviado:", data.messages?.[0]?.id || data);
  return true;
}

function statusTemplateValue(order) {
  const details = {
    "Agendado": `agendado para ${order.scheduledFor ? formatDateTime(order.scheduledFor) : "o horário combinado"}`,
    "Aceito": `aceito pela MR Pizzaria. Previsão: ${CONFIG.estimate}`,
    "Em preparo": "está em preparo",
    "Pronto": order.deliveryType === "Retirada" ? "está pronto para retirada" : order.deliveryType === "Consumir no local" ? "está pronto para servir" : "está pronto e será encaminhado para entrega",
    "Saiu para entrega": "saiu para entrega",
    "Finalizado": "foi finalizado. Obrigado pela preferência!",
    "Cancelado": "foi cancelado"
  };
  return details[order.status] || order.status;
}

async function sendOrderStatusNotification(order) {
  const recipient = normalizeRecipientNumber(order?.customerPhone || "");
  const notification = statusNotification(order);
  if (!notification || !/^\d{10,15}$/.test(recipient)) return { sent: false, mode: "none", reason: "telefone inválido" };
  const direct = await sendText(recipient, notification);
  if (direct) return { sent: true, mode: "text" };
  if (WHATSAPP_STATUS_TEMPLATE) {
    const templated = await sendTemplateMessage(recipient, WHATSAPP_STATUS_TEMPLATE, WHATSAPP_STATUS_TEMPLATE_LANGUAGE, [String(order.number), statusTemplateValue(order)]);
    if (templated) return { sent: true, mode: "template" };
  }
  return { sent: false, mode: "none", reason: WHATSAPP_STATUS_TEMPLATE ? "Meta recusou texto e template" : "janela do WhatsApp fechada e template não configurado" };
}

async function sendImage(to, imageUrl, caption = "") {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.");
    return false;
  }
  const image = { link: String(imageUrl) };
  if (caption) image.caption = String(caption).slice(0, 1000);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "image",
      image
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao enviar imagem:", response.status, data);
    return false;
  }
  console.log("Imagem enviada:", data.messages?.[0]?.id || data);
  return true;
}

async function sendDocument(to, documentUrl, filename, caption = "") {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.");
    return false;
  }
  const document = {
    link: String(documentUrl),
    filename: String(filename || "documento.pdf").slice(0, 240)
  };
  if (caption) document.caption = String(caption).slice(0, 1000);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "document",
      document
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao enviar documento por URL:", response.status, data);
    return false;
  }
  console.log("Documento por URL aceito pela Meta:", data.messages?.[0]?.id || data);
  return true;
}

async function uploadDocumentToWhatsApp(filePath, filename, mimeType = "application/pdf") {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.");
  const fileBuffer = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: form
  });
  const data = await response.json();
  if (!response.ok || !data.id) {
    console.error("Erro ao enviar PDF para a biblioteca de mídia da Meta:", response.status, data);
    throw new Error(data?.error?.message || "A Meta não devolveu o ID da mídia.");
  }
  console.log("PDF carregado na Meta. media_id:", data.id);
  return String(data.id);
}

async function sendDocumentById(to, mediaId, filename, caption = "") {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurado.");
    return false;
  }
  const document = {
    id: String(mediaId),
    filename: String(filename || "documento.pdf").slice(0, 240)
  };
  if (caption) document.caption = String(caption).slice(0, 1000);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "document",
      document
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao enviar documento por media_id:", response.status, data);
    return false;
  }
  console.log("Documento por media_id aceito pela Meta:", data.messages?.[0]?.id || data);
  return true;
}

async function sendCardapioPdf(to) {
  let sent = false;
  try {
    if (!cachedCardapioMediaId) {
      cachedCardapioMediaId = await uploadDocumentToWhatsApp(
        CARDAPIO_PDF_PATH,
        CARDAPIO_PDF_FILENAME,
        "application/pdf"
      );
    }
    sent = await sendDocumentById(
      to,
      cachedCardapioMediaId,
      CARDAPIO_PDF_FILENAME,
      "📖 Cardápio completo da MR Pizzaria"
    );
    if (!sent) {
      console.warn("O media_id armazenado pode ter expirado. Fazendo novo upload do PDF.");
      cachedCardapioMediaId = await uploadDocumentToWhatsApp(
        CARDAPIO_PDF_PATH,
        CARDAPIO_PDF_FILENAME,
        "application/pdf"
      );
      sent = await sendDocumentById(
        to,
        cachedCardapioMediaId,
        CARDAPIO_PDF_FILENAME,
        "📖 Cardápio completo da MR Pizzaria"
      );
    }
  } catch (error) {
    console.error("Falha no envio do cardápio por media_id:", error);
  }

  if (sent) {
    await sendText(to, `✅ Enviei o cardápio em PDF acima.\n\nSe o documento não aparecer, abra pelo link:\n${CARDAPIO_PDF_URL}`, { previewUrl: true });
    return;
  }

  const acceptedByUrl = await sendDocument(
    to,
    CARDAPIO_PDF_URL,
    CARDAPIO_PDF_FILENAME,
    "📖 Cardápio completo da MR Pizzaria"
  );
  await sendText(to, `${acceptedByUrl ? "📄 Também tentei enviar o documento." : "⚠️ Não consegui anexar o documento agora."}\n\nBaixe o cardápio por este link:\n${CARDAPIO_PDF_URL}`, { previewUrl: true });
}

async function sendCurrentPromotion(to) {
  const promotion = await getPromotion();
  if (!promotion.active || (!promotion.text && !promotion.hasImage)) {
    await sendText(to, promotionText(promotion));
    return;
  }
  if (promotion.hasImage) {
    const version = encodeURIComponent(new Date(promotion.updatedAt).getTime() || Date.now());
    await sendImage(to, `${PUBLIC_BASE_URL}/promocao/imagem?v=${version}`, "🔥 Promoção da MR Pizzaria");
  }
  await sendText(to, promotionText(promotion), { previewUrl: Boolean(ORDER_SITE_URL) });
}

async function sendMany(to, messages) {
  for (const message of messages) await sendText(to, message);
}

function paymentMenu(order = {}) {
  const lines = [
    "💳 *Forma de pagamento:*",
    "*1* — Pix",
    "*2* — Dinheiro",
    "*3* — Cartão de crédito",
    "*4* — Cartão de débito"
  ];
  if (order.deliveryType === "Consumir no local") lines.push("*5* — Lançar na conta da mesa");
  return lines.join("\n");
}

function parseQuantity(input) {
  const qty = Number.parseInt(String(input || "").trim(), 10);
  return Number.isInteger(qty) && qty >= 1 && qty <= 20 ? qty : null;
}

function confirmationPrompt(session) {
  session.step = "CONFIRM";
  return `${summarizeOrder(session.order)}\n\nEstá correto?\n*1* — Confirmar pedido\n*2* — Adicionar mais itens\n*3* — Cancelar`;
}

function startFinalization(session) {
  if (!session.order.items.length) {
    return { text: "Seu carrinho está vazio. Adicione algum item antes de finalizar.\n\n" + categoryMenu(session.order) };
  }
  if (session.order.deliveryType === "Retirada" && !session.order.pickupName) {
    session.step = "PICKUP_NAME";
    return { text: "Em nome de quem será feita a retirada?" };
  }
  if (session.order.deliveryType === "Entrega" && !session.order.address.street && !session.order.address.mapUrl) {
    session.step = "ADDRESS_STREET";
    return { text: "Informe a *rua/avenida e o número* ou envie sua *localização pelo WhatsApp*." };
  }
  if (session.order.deliveryType === "Consumir no local" && !session.order.tableNumber && !session.order.reservationNumber) {
    session.step = "LOCAL_TABLE";
    return { text: `Informe o *número da mesa*, de 1 a ${CONFIG.tableCount}.` };
  }
  if (session.order.deliveryType === "Consumir no local" && !session.order.commandName) {
    session.step = "LOCAL_COMMAND";
    return { text: "Informe o *nome da comanda* (ex.: João). Digite *0* para Comanda geral." };
  }
  session.step = "PAYMENT";
  return { text: paymentMenu(session.order) };
}

async function beginOrder(session, scheduled = false) {
  session.order = newOrder();
  session.draft = {};
  if (scheduled) {
    session.step = "ORDER_SCHEDULE_DATE";
    await sendText(session.waId, "Para qual dia deseja agendar?\nDigite *hoje*, *amanhã* ou uma data como *30/07/2026*.");
    return;
  }
  if (!isStoreOpen()) {
    await sendText(session.waId, `No momento estamos fechados. Funcionamos de ${CONFIG.hours}.\nDigite *6* para agendar um pedido ou *2* para consultar o cardápio.`);
    return;
  }
  session.step = "DELIVERY_TYPE";
  await sendText(session.waId, "Seu pedido será:\n*1* — Entrega (+ R$ 7,00)\n*2* — Retirada\n*3* — Consumir no local");
}

async function handleMainMenu(session, command) {
  if (["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "hello"].includes(command)) {
    await sendText(session.waId, mainMenu(session.customerName));
    return true;
  }
  if (command === "1" || command === "pedir" || command === "pedido") {
    await beginOrder(session, false);
    return true;
  }
  if (command === "2" || command === "site" || command.includes("comprar no site") || command.includes("pedido online")) {
    await sendText(session.waId, `🛒 *Comprar pelo site da MR Pizzaria*

Acesse o link abaixo, escolha os produtos e finalize seu pedido:
${ORDER_SITE_URL}

Você também pode digitar *1* para pedir diretamente por este WhatsApp.`, { previewUrl: true });
    return true;
  }
  if (
    command === "12" ||
    command === "cardapio pdf" ||
    command === "cardápio pdf" ||
    command.includes("baixar cardapio") ||
    command.includes("baixar cardápio") ||
    command.includes("cardapio em pdf") ||
    command.includes("cardápio em pdf")
  ) {
    await sendCardapioPdf(session.waId);
    return true;
  }
  if (command === "3" || command === "cardapio" || command === "cardápio") {
    await sendText(session.waId, fullMenuText(), { previewUrl: true });
    return true;
  }
  if (command === "4" || command.includes("promoc")) {
    await sendCurrentPromotion(session.waId);
    return true;
  }
  if (command === "5" || command.includes("acompanhar") || command.includes("status")) {
    const order = await getLatestOrderByPhone(session.waId);
    await sendText(session.waId, orderTrackingText(order));
    return true;
  }
  if (command === "6" || command.includes("repetir")) {
    const previous = await getLatestOrderByPhone(session.waId, { repeatable: true });
    if (!previous) {
      await sendText(session.waId, "Não encontrei um pedido anterior para repetir.");
      return true;
    }
    session.order = newOrder();
    session.order.items = deepClone(previous.items || []);
    session.draft = { repeatedFrom: previous.number };
    session.step = "DELIVERY_TYPE";
    await sendText(session.waId, `Repeti os itens do pedido nº ${previous.number}.
Subtotal: *${money(itemSubtotal(session.order))}*

Agora escolha:
*1* — Entrega (+ R$ 7,00)
*2* — Retirada
*3* — Consumir no local`);
    return true;
  }
  if (command === "7" || command.includes("agendar")) {
    await beginOrder(session, true);
    return true;
  }
  if (command === "8" || command.includes("reserv")) {
    session.draft = { reservation: { serviceType: "Consumir no local", continueToOrder: false } };
    session.step = "RESERVATION_DATE";
    await sendText(session.waId, `🍽️ *Reserva para consumir no local*

Para qual dia deseja reservar a mesa?
Digite *hoje*, *amanhã* ou uma data como *30/07/2026*.`);
    return true;
  }
  if (command === "9") {
    await sendText(session.waId, `📍 *MR Pizzaria*
${CONFIG.storeAddress}.

🕕 Funcionamos de ${CONFIG.hours}.
⏱️ Entrega, retirada e consumo no local: ${CONFIG.estimate}.`);
    return true;
  }
  if (command === "10" || command.includes("atendente")) {
    const request = await saveServiceRequest({
      customerName: session.customerName,
      customerPhone: session.waId,
      message: "Cliente solicitou atendimento humano pelo menu."
    });
    session.step = "HANDOFF";
    session.draft = { serviceRequestId: request.id };
    await sendText(session.waId, `👤 Sua solicitação foi registrada no painel. Um atendente responderá assim que possível.
Digite *MENU* para voltar ao atendimento automático.`);
    return true;
  }
  if (command === "11" || command.includes("grupo")) {
    if (!WHATSAPP_GROUP_URL) {
      await sendText(session.waId, "O link do grupo ainda não foi configurado. Digite *10* para pedir o link a um atendente.");
      return true;
    }
    await sendText(session.waId, `📲 *Grupo da MR Pizzaria*

Entre pelo link abaixo para receber promoções e novidades:
${WHATSAPP_GROUP_URL}`);
    return true;
  }
  if (command === "0" || command === "cancelar pedido") {
    const result = await cancelLatestCustomerOrder(session.waId);
    if (result.ok) {
      await sendText(session.waId, `Pedido nº ${result.order.number} cancelado com sucesso.`);
    } else if (result.reason === "none") {
      await sendText(session.waId, "Não encontrei um pedido confirmado para cancelar.");
    } else {
      await sendText(session.waId, `O pedido nº ${result.order.number} já está com status *${result.order.status}* e não pode ser cancelado automaticamente. Digite *10* para falar com um atendente.`);
    }
    return true;
  }
  return false;
}

async function processIncomingMessageCore(session, message) {
  const messageType = message?.type || "text";
  const text = messageType === "text" ? String(message.text?.body || "").trim() : "";
  const command = normalize(text);

  if (messageType === "text" && ["menu", "inicio", "início"].includes(command)) {
    resetSession(session);
    await sendText(session.waId, mainMenu(session.customerName));
    return;
  }

  if (messageType === "text" && ["cancelar", "cancela", "cancel"].includes(command)) {
    if (session.step === "MAIN") {
      await sendText(session.waId, "Para cancelar um pedido já confirmado, digite *0*.\n\n" + mainMenu(session.customerName));
      return;
    }
    resetSession(session);
    await sendText(session.waId, "Preenchimento cancelado.\n\n" + mainMenu(session.customerName));
    return;
  }

  if (messageType === "text" && command === "sabores") {
    await sendMany(session.waId, flavorsText());
    return;
  }

  const globalCategories = {
    lanches: "Lanches", porcoes: "Porções", porcao: "Porções",
    bebidas: "Bebidas", bebida: "Bebidas", drinks: "Drinks", drink: "Drinks",
    doces: "Doces", doce: "Doces"
  };
  if (messageType === "text" && globalCategories[command]) {
    await sendText(session.waId, productListText(globalCategories[command]));
    return;
  }

  if (session.step === "PIX_RECEIPT" && ["image", "document"].includes(messageType)) {
    const media = message[messageType] || {};
    session.order.paymentReceiptId = media.id || "recebido";
    session.order.paymentReceiptType = messageType;
    await sendText(session.waId, confirmationPrompt(session));
    return;
  }

  if (session.step === "ADDRESS_STREET" && messageType === "location") {
    const location = message.location || {};
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    session.order.location = { latitude, longitude, name: location.name || "", address: location.address || "" };
    session.order.address.street = location.address || location.name || "Localização compartilhada pelo WhatsApp";
    session.order.address.number = "";
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      session.order.address.mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
    }
    session.step = "ADDRESS_DISTRICT";
    await sendText(session.waId, "📍 Localização recebida. Agora informe o *bairro*.");
    return;
  }

  if (messageType !== "text") {
    await sendText(session.waId, "Neste ponto, envie a informação em texto. Você também pode digitar *MENU* para voltar ao início.");
    return;
  }

  switch (session.step) {
    case "MAIN": {
      const handled = await handleMainMenu(session, command);
      if (!handled) await sendText(session.waId, mainMenu(session.customerName));
      return;
    }

    case "HANDOFF": {
      await sendText(session.waId, "Sua solicitação continua no painel do atendente. Digite *MENU* para voltar ao atendimento automático.");
      return;
    }

    case "ORDER_SCHEDULE_DATE": {
      const date = parseDateInput(text);
      if (!date) {
        await sendText(session.waId, "Não entendi a data. Digite, por exemplo, *amanhã* ou *30/07/2026*.");
        return;
      }
      session.draft.scheduleDate = date;
      session.step = "ORDER_SCHEDULE_TIME";
      await sendText(session.waId, "Qual horário? Digite, por exemplo, *19:30*.\nAceitamos agendamentos entre 18h e 22h30.");
      return;
    }

    case "ORDER_SCHEDULE_TIME": {
      const time = parseTimeInput(text);
      if (!time) {
        await sendText(session.waId, "Digite um horário válido, por exemplo, *19:30*.");
        return;
      }
      const scheduled = buildScheduledDate(session.draft.scheduleDate, time);
      const error = validateBusinessSchedule(scheduled, ORDER_ADVANCE_DAYS);
      if (error) {
        await sendText(session.waId, `${error}\nDigite outro horário ou escreva *CANCELAR*.`);
        return;
      }
      session.order.scheduledFor = scheduled.toISOString();
      session.step = "DELIVERY_TYPE";
      await sendText(session.waId, `Pedido agendado para *${formatDateTime(scheduled)}*.\nSerá:\n*1* — Entrega (+ R$ 7,00)\n*2* — Retirada\n*3* — Consumir no local`);
      return;
    }

    case "DELIVERY_TYPE": {
      if (command === "1" || command === "entrega") {
        session.order.deliveryType = "Entrega";
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      if (command === "2" || command === "retirada") {
        session.order.deliveryType = "Retirada";
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      if (command === "3" || command.includes("consumir") || command.includes("local")) {
        session.order.deliveryType = "Consumir no local";
        session.step = "LOCAL_CHOICE";
        await sendText(session.waId, "🍽️ *Consumir no local*\n\n*1* — Já estou na pizzaria / informar mesa depois\n*2* — Quero reservar uma mesa e fazer o pedido");
        return;
      }
      await sendText(session.waId, "Digite *1* para entrega, *2* para retirada ou *3* para consumir no local.");
      return;
    }

    case "LOCAL_CHOICE": {
      if (command === "1" || command.includes("ja estou") || command.includes("já estou")) {
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      if (command === "2" || command.includes("reserv")) {
        const pendingOrder = deepClone(session.order);
        session.draft = { reservation: { serviceType: "Consumir no local", continueToOrder: true, pendingOrder } };
        if (pendingOrder.scheduledFor) {
          session.draft.reservation.reservationFor = pendingOrder.scheduledFor;
          session.step = "RESERVATION_PEOPLE";
          await sendText(session.waId, `Vamos reservar a mesa para o mesmo horário do pedido: *${formatDateTime(pendingOrder.scheduledFor)}*.\nPara quantas pessoas? Informe de 1 a ${RESERVATION_MAX_PEOPLE}.`);
          return;
        }
        session.step = "RESERVATION_DATE";
        await sendText(session.waId, "Para qual dia deseja reservar a mesa?\nDigite *hoje*, *amanhã* ou uma data como *30/07/2026*.");
        return;
      }
      await sendText(session.waId, "Digite *1* se já está na pizzaria ou *2* para reservar uma mesa.");
      return;
    }

    case "CATEGORY": {
      const categories = { "2": "Lanches", "3": "Porções", "4": "Bebidas", "5": "Drinks", "6": "Doces" };
      if (command === "1") {
        session.draft = { ...session.draft, type: "pizza" };
        session.step = "PIZZA_SIZE";
        await sendText(session.waId, "Escolha o tamanho:\n*1* — Pequena (1 sabor)\n*2* — Média (até 2 sabores)\n*3* — Grande (até 2 sabores)");
        return;
      }
      if (categories[command]) {
        session.draft = { ...session.draft, type: "product", category: categories[command] };
        session.step = "PRODUCT_SELECT";
        await sendText(session.waId, productListText(categories[command]));
        return;
      }
      if (command === "7" || command.includes("cupom")) {
        session.step = "COUPON";
        await sendText(session.waId, "Digite o código do cupom. Digite *0* para voltar.");
        return;
      }
      if (command === "8" || command === "finalizar") {
        const next = startFinalization(session);
        await sendText(session.waId, next.text);
        return;
      }
      if (command === "9") {
        resetSession(session);
        await sendText(session.waId, "Pedido em preenchimento cancelado.\n\n" + mainMenu(session.customerName));
        return;
      }
      await sendText(session.waId, categoryMenu(session.order));
      return;
    }

    case "COUPON": {
      if (command === "0") {
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      const code = String(text || "").trim().toUpperCase();
      if (!COUPON_CODE || COUPON_PERCENT <= 0) {
        await sendText(session.waId, "Não há cupom ativo no sistema neste momento.\n\n" + categoryMenu(session.order));
        session.step = "CATEGORY";
        return;
      }
      if (code !== COUPON_CODE) {
        await sendText(session.waId, "Cupom inválido. Digite novamente ou *0* para voltar.");
        return;
      }
      session.order.couponCode = code;
      session.order.discount = calculateDiscount(session.order);
      session.step = "CATEGORY";
      await sendText(session.waId, `✅ Cupom aplicado: *${COUPON_PERCENT}% de desconto*.\n\n${categoryMenu(session.order)}`);
      return;
    }

    case "PIZZA_SIZE": {
      const sizes = { "1": "P", p: "P", pequena: "P", "2": "M", m: "M", media: "M", média: "M", "3": "G", g: "G", grande: "G" };
      const size = sizes[command];
      if (!size) {
        await sendText(session.waId, "Digite *1* para pequena, *2* para média ou *3* para grande.");
        return;
      }
      session.draft.size = size;
      session.step = "PIZZA_FLAVOR_1";
      await sendText(session.waId, "Digite o *primeiro sabor* da pizza.\nDigite *SABORES* para ver a lista completa.");
      return;
    }

    case "PIZZA_FLAVOR_1": {
      const result = findFlavor(text);
      if (!result.match) {
        const suggestion = result.suggestions.length ? `\nTalvez você quis dizer:\n${result.suggestions.map((item) => `• ${item}`).join("\n")}` : "";
        await sendText(session.waId, `Não encontrei esse sabor.${suggestion}\nDigite novamente ou escreva *SABORES*.`);
        return;
      }
      session.draft.flavor1 = result.match;
      if (session.draft.size === "P") {
        session.draft.flavor2 = null;
        session.step = "PIZZA_BORDER";
        await sendText(session.waId, "Escolha a borda:\n*1* — Sem borda\n*2* — Catupiry\n*3* — Cheddar\n*4* — Chocolate");
        return;
      }
      session.step = "PIZZA_SPLIT";
      await sendText(session.waId, "A pizza será:\n*1* — Sabor inteiro\n*2* — Meio a meio");
      return;
    }

    case "PIZZA_SPLIT": {
      if (command === "1" || command.includes("inteir")) {
        session.draft.flavor2 = null;
        session.step = "PIZZA_BORDER";
        await sendText(session.waId, "Escolha a borda:\n*1* — Sem borda\n*2* — Catupiry\n*3* — Cheddar\n*4* — Chocolate");
        return;
      }
      if (command === "2" || command.includes("meio")) {
        session.step = "PIZZA_FLAVOR_2";
        await sendText(session.waId, "Digite o *segundo sabor* da pizza.");
        return;
      }
      await sendText(session.waId, "Digite *1* para pizza inteira ou *2* para meio a meio.");
      return;
    }

    case "PIZZA_FLAVOR_2": {
      const result = findFlavor(text);
      if (!result.match) {
        const suggestion = result.suggestions.length ? `\nTalvez você quis dizer:\n${result.suggestions.map((item) => `• ${item}`).join("\n")}` : "";
        await sendText(session.waId, `Não encontrei esse sabor.${suggestion}\nDigite novamente ou escreva *SABORES*.`);
        return;
      }
      session.draft.flavor2 = result.match;
      session.step = "PIZZA_BORDER";
      await sendText(session.waId, "Escolha a borda:\n*1* — Sem borda\n*2* — Catupiry\n*3* — Cheddar\n*4* — Chocolate");
      return;
    }

    case "PIZZA_BORDER": {
      const borders = { "1": "none", sem: "none", "2": "catupiry", catupiry: "catupiry", "3": "cheddar", cheddar: "cheddar", "4": "chocolate", chocolate: "chocolate" };
      const border = borders[command];
      if (!border) {
        await sendText(session.waId, "Digite *1*, *2*, *3* ou *4* para escolher a borda.");
        return;
      }
      session.draft.border = border;
      session.step = "PIZZA_QTY";
      await sendText(session.waId, "Qual a quantidade dessa pizza?");
      return;
    }

    case "PIZZA_QTY": {
      const qty = parseQuantity(text);
      if (!qty) {
        await sendText(session.waId, "Informe uma quantidade de 1 a 20.");
        return;
      }
      session.draft.qty = qty;
      session.step = "PIZZA_NOTE";
      await sendText(session.waId, "Deseja remover algum ingrediente ou incluir uma observação?\nExemplo: *sem cebola*.\nDigite *0* se não houver observação.");
      return;
    }

    case "PIZZA_NOTE": {
      const note = ["0", "nao", "não"].includes(command) ? "" : text;
      const { size, flavor1, flavor2, border, qty } = session.draft;
      const first = pizzaBasePrice(size, flavor1);
      const second = flavor2 ? pizzaBasePrice(size, flavor2) : first;
      const base = flavor2 ? (first + second) / 2 : first;
      const borderPrice = CONFIG.borders[border][size];
      const unit = base + borderPrice;
      const name = `Pizza ${sizeLabel(size)} — ${flavor2 ? `½ ${flavor1} / ½ ${flavor2}` : flavor1}${border !== "none" ? ` — ${CONFIG.borders[border].name}` : ""}`;
      session.order.items.push({ type: "pizza", category: "Pizzas", name, qty, unit, total: unit * qty, note });
      session.draft = {};
      session.step = "CATEGORY";
      await sendText(session.waId, `✅ Adicionado: ${qty}x ${name}\nValor: ${money(unit * qty)}\n\n${categoryMenu(session.order)}`);
      return;
    }

    case "PRODUCT_SELECT": {
      if (command === "0") {
        session.draft = {};
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      const items = PRODUCTS[session.draft.category] || [];
      const index = Number.parseInt(command, 10) - 1;
      if (!Number.isInteger(index) || !items[index]) {
        await sendText(session.waId, productListText(session.draft.category));
        return;
      }
      session.draft.product = items[index];
      session.step = "PRODUCT_QTY";
      await sendText(session.waId, `Quantos ${items[index].name} deseja?`);
      return;
    }

    case "PRODUCT_QTY": {
      const qty = parseQuantity(text);
      if (!qty) {
        await sendText(session.waId, "Informe uma quantidade de 1 a 20.");
        return;
      }
      session.draft.qty = qty;
      session.step = "PRODUCT_NOTE";
      await sendText(session.waId, "Deseja remover algum ingrediente ou incluir uma observação?\nDigite *0* se não houver.");
      return;
    }

    case "PRODUCT_NOTE": {
      const note = ["0", "nao", "não"].includes(command) ? "" : text;
      const product = session.draft.product;
      const qty = session.draft.qty;
      session.order.items.push({ type: "product", category: session.draft.category, name: product.name, qty, unit: product.price, total: product.price * qty, note });
      session.draft = {};
      session.step = "CATEGORY";
      await sendText(session.waId, `✅ Adicionado: ${qty}x ${product.name}\nValor: ${money(product.price * qty)}\n\n${categoryMenu(session.order)}`);
      return;
    }

    case "LOCAL_TABLE": {
      const table = normalizeTableNumber(text);
      if (!table) {
        await sendText(session.waId, `Informe uma mesa válida, de *1 a ${CONFIG.tableCount}*.`);
        return;
      }
      session.order.tableNumber = String(table);
      session.step = "LOCAL_COMMAND";
      await sendText(session.waId, "Informe o *nome da comanda* (ex.: João). Digite *0* para usar Comanda geral.");
      return;
    }

    case "LOCAL_COMMAND": {
      session.order.commandName = command === "0" ? "Comanda geral" : text.trim().slice(0, 80);
      if (!session.order.commandName) {
        await sendText(session.waId, "Informe o nome da comanda ou digite *0* para Comanda geral.");
        return;
      }
      session.step = "PAYMENT";
      await sendText(session.waId, paymentMenu(session.order));
      return;
    }

    case "PICKUP_NAME": {
      if (text.length < 2) {
        await sendText(session.waId, "Informe o nome de quem fará a retirada.");
        return;
      }
      session.order.pickupName = text;
      session.step = "PAYMENT";
      await sendText(session.waId, paymentMenu(session.order));
      return;
    }

    case "ADDRESS_STREET": {
      if (text.length < 5) {
        await sendText(session.waId, "Informe a rua/avenida e o número ou envie sua localização pelo WhatsApp.");
        return;
      }
      const match = text.match(/^(.*?)[,\s]+(\d+[A-Za-z-]*)$/);
      if (match) {
        session.order.address.street = match[1].trim();
        session.order.address.number = match[2].trim();
      } else {
        session.order.address.street = text;
        session.order.address.number = "";
      }
      session.step = "ADDRESS_DISTRICT";
      await sendText(session.waId, "Informe o *bairro*.");
      return;
    }

    case "ADDRESS_DISTRICT": {
      if (text.length < 2) {
        await sendText(session.waId, "Informe o bairro.");
        return;
      }
      session.order.address.district = text;
      session.step = "ADDRESS_REFERENCE";
      await sendText(session.waId, "Informe um *ponto de referência*.\nDigite *0* se não houver.");
      return;
    }

    case "ADDRESS_REFERENCE": {
      session.order.address.reference = command === "0" ? "" : text;
      session.step = "PAYMENT";
      await sendText(session.waId, paymentMenu(session.order));
      return;
    }

    case "PAYMENT": {
      const methods = {
        "1": "Pix", pix: "Pix", "2": "Dinheiro", dinheiro: "Dinheiro",
        "3": "Cartão de crédito", credito: "Cartão de crédito", crédito: "Cartão de crédito",
        "4": "Cartão de débito", debito: "Cartão de débito", débito: "Cartão de débito",
        "5": "Conta da mesa", conta: "Conta da mesa", mesa: "Conta da mesa"
      };
      const payment = methods[command];
      if (!payment) {
        await sendText(session.waId, paymentMenu(session.order));
        return;
      }
      if (payment === "Conta da mesa" && session.order.deliveryType !== "Consumir no local") {
        await sendText(session.waId, paymentMenu(session.order));
        return;
      }
      session.order.payment = payment;
      if (payment === "Dinheiro") {
        session.step = "CHANGE";
        await sendText(session.waId, `O total atual é ${money(orderTotal(session.order))}.\nTroco para quanto?\nDigite *0* se não precisar de troco.`);
        return;
      }
      if (payment === "Pix") {
        session.step = "PIX_RECEIPT";
        await sendText(session.waId, `Chave Pix: *${CONFIG.pix}*\n\nEnvie a imagem ou o PDF do comprovante. Digite *0* para confirmar o pedido e enviar o comprovante depois.`);
        return;
      }
      await sendText(session.waId, confirmationPrompt(session));
      return;
    }

    case "PIX_RECEIPT": {
      if (["0", "depois", "nao", "não"].includes(command)) {
        await sendText(session.waId, confirmationPrompt(session));
        return;
      }
      await sendText(session.waId, "Envie a imagem ou o PDF do comprovante, ou digite *0* para continuar sem anexar.");
      return;
    }

    case "CHANGE": {
      if (["0", "nao", "não"].includes(command)) session.order.changeFor = null;
      else {
        const normalizedNumber = text.replace(/[^0-9,.-]/g, "").replace(",", ".");
        const value = Number(normalizedNumber);
        if (!Number.isFinite(value) || value < orderTotal(session.order)) {
          await sendText(session.waId, `Informe um valor igual ou maior que ${money(orderTotal(session.order))}, ou digite *0* se não precisar de troco.`);
          return;
        }
        session.order.changeFor = value;
      }
      await sendText(session.waId, confirmationPrompt(session));
      return;
    }

    case "CONFIRM": {
      if (command === "1" || command === "confirmar") {
        const discount = calculateDiscount(session.order);
        const scheduled = session.order.scheduledFor ? new Date(session.order.scheduledFor) : null;
        const status = scheduled && scheduled.getTime() > Date.now() + 20 * 60 * 1000 ? "Agendado" : "Novo";
        const orderData = {
          customerName: session.customerName,
          customerPhone: session.waId,
          ...deepClone(session.order),
          subtotal: itemSubtotal(session.order),
          discount,
          deliveryFee: session.order.deliveryType === "Entrega" ? CONFIG.deliveryFee : 0,
          total: orderTotal(session.order),
          status
        };
        try {
          const confirmedOrder = await saveConfirmedOrder(orderData);
          session.order.tabCode = confirmedOrder.tabCode || session.order.tabCode;
          session.order.commandName = confirmedOrder.commandName || session.order.commandName;
          session.order.waiterName = confirmedOrder.waiterName || session.order.waiterName;
          console.log("PEDIDO_CONFIRMADO", JSON.stringify(confirmedOrder));
          const finalLine = status === "Agendado"
            ? "✅ Pedido agendado! Ele aparecerá no painel e será impresso próximo do horário escolhido."
            : "✅ Pedido confirmado! Em breve iniciaremos o preparo.";
          await sendText(session.waId, `${summarizeOrder(session.order, confirmedOrder.number)}\n\n${finalLine}`);
          resetSession(session);
        } catch (error) {
          console.error("Erro ao salvar pedido:", error);
          await sendText(session.waId, "Não consegui registrar o pedido agora. Aguarde um atendente ou tente confirmar novamente em alguns instantes.");
        }
        return;
      }
      if (command === "2") {
        session.step = "CATEGORY";
        await sendText(session.waId, categoryMenu(session.order));
        return;
      }
      if (command === "3") {
        resetSession(session);
        await sendText(session.waId, "Pedido cancelado.\n\n" + mainMenu(session.customerName));
        return;
      }
      await sendText(session.waId, "Digite *1* para confirmar, *2* para adicionar mais itens ou *3* para cancelar.");
      return;
    }

    case "RESERVATION_DATE": {
      const date = parseDateInput(text);
      if (!date) {
        await sendText(session.waId, "Não entendi a data. Digite *amanhã* ou uma data como *30/07/2026*.");
        return;
      }
      session.draft.reservation.date = date;
      session.step = "RESERVATION_TIME";
      await sendText(session.waId, "Qual horário da reserva? Exemplo: *20:00*.\nReservas entre 18h e 22h30.");
      return;
    }

    case "RESERVATION_TIME": {
      const time = parseTimeInput(text);
      if (!time) {
        await sendText(session.waId, "Digite um horário válido, por exemplo, *20:00*.");
        return;
      }
      const reservationFor = buildScheduledDate(session.draft.reservation.date, time);
      const error = validateBusinessSchedule(reservationFor, RESERVATION_ADVANCE_DAYS);
      if (error) {
        await sendText(session.waId, `${error}\nDigite outro horário ou escreva *CANCELAR*.`);
        return;
      }
      session.draft.reservation.reservationFor = reservationFor.toISOString();
      session.step = "RESERVATION_PEOPLE";
      await sendText(session.waId, `Para quantas pessoas? Informe de 1 a ${RESERVATION_MAX_PEOPLE}.`);
      return;
    }

    case "RESERVATION_PEOPLE": {
      const people = Number.parseInt(text, 10);
      if (!Number.isInteger(people) || people < 1 || people > RESERVATION_MAX_PEOPLE) {
        await sendText(session.waId, `Informe uma quantidade de 1 a ${RESERVATION_MAX_PEOPLE} pessoas.`);
        return;
      }
      session.draft.reservation.people = people;
      session.step = "RESERVATION_NAME";
      await sendText(session.waId, `Em nome de quem será a reserva?\nDigite *1* para usar: ${session.customerName}`);
      return;
    }

    case "RESERVATION_NAME": {
      const name = command === "1" ? session.customerName : text;
      if (name.length < 2) {
        await sendText(session.waId, "Informe um nome válido para a reserva.");
        return;
      }
      session.draft.reservation.customerName = name;
      session.step = "RESERVATION_NOTE";
      await sendText(session.waId, "Deseja acrescentar alguma observação?\nExemplo: aniversário ou cadeira infantil.\nDigite *0* se não houver.");
      return;
    }

    case "RESERVATION_NOTE": {
      session.draft.reservation.notes = ["0", "nao", "não"].includes(command) ? "" : text;
      session.step = "RESERVATION_CONFIRM";
      await sendText(session.waId, `${reservationSummary(session.draft.reservation)}\n\nConfirma a solicitação?\n*1* — Confirmar\n*2* — Cancelar`);
      return;
    }

    case "RESERVATION_CONFIRM": {
      if (command === "1" || command === "confirmar") {
        try {
          const reservationDraft = session.draft.reservation;
          const saved = await saveReservation({
            customerName: reservationDraft.customerName,
            customerPhone: session.waId,
            reservationFor: reservationDraft.reservationFor,
            people: reservationDraft.people,
            notes: reservationDraft.notes
          });

          if (reservationDraft.continueToOrder) {
            const pendingOrder = reservationDraft.pendingOrder ? deepClone(reservationDraft.pendingOrder) : newOrder();
            pendingOrder.deliveryType = "Consumir no local";
            pendingOrder.scheduledFor = saved.reservationFor;
            pendingOrder.reservationNumber = saved.number;
            pendingOrder.tableNumber = "";
            session.order = pendingOrder;
            session.draft = { linkedReservationNumber: saved.number };
            session.step = "CATEGORY";
            await sendText(session.waId, `${reservationSummary(saved, saved.number)}\n\n✅ Solicitação registrada como *pendente*. Agora monte o pedido que será consumido no local:\n\n${categoryMenu(session.order)}`);
            return;
          }

          session.draft = { savedReservation: deepClone(saved) };
          session.step = "RESERVATION_ORDER_CHOICE";
          await sendText(session.waId, `${reservationSummary(saved, saved.number)}\n\n✅ Solicitação registrada. A reserva fica *pendente* até a confirmação da MR Pizzaria.\n\nDeseja também adiantar um pedido para consumir no local?\n*1* — Sim, montar pedido agora\n*2* — Não, somente a reserva`);
        } catch (error) {
          console.error("Erro ao salvar reserva:", error);
          await sendText(session.waId, "Não consegui registrar a reserva agora. Digite *10* para falar com um atendente.");
        }
        return;
      }
      if (command === "2") {
        resetSession(session);
        await sendText(session.waId, "Solicitação de reserva cancelada.\n\n" + mainMenu(session.customerName));
        return;
      }
      await sendText(session.waId, "Digite *1* para confirmar ou *2* para cancelar.");
      return;
    }

    case "RESERVATION_ORDER_CHOICE": {
      const saved = session.draft.savedReservation;
      if (!saved) {
        resetSession(session);
        await sendText(session.waId, mainMenu(session.customerName));
        return;
      }
      if (command === "1" || command.includes("sim")) {
        session.order = newOrder();
        session.order.deliveryType = "Consumir no local";
        session.order.scheduledFor = saved.reservationFor;
        session.order.reservationNumber = saved.number;
        session.draft = { linkedReservationNumber: saved.number };
        session.step = "CATEGORY";
        await sendText(session.waId, `Pedido vinculado à *reserva nº ${saved.number}*, para ${formatDateTime(saved.reservationFor)}.\n\n${categoryMenu(session.order)}`);
        return;
      }
      if (command === "2" || command.includes("nao") || command.includes("não")) {
        resetSession(session);
        await sendText(session.waId, "Reserva registrada. Aguarde a confirmação da MR Pizzaria.\n\n" + mainMenu(session.customerName));
        return;
      }
      await sendText(session.waId, "Digite *1* para montar o pedido ou *2* para ficar somente com a reserva.");
      return;
    }

    default:
      resetSession(session);
      await sendText(session.waId, mainMenu(session.customerName));
  }
}

function sessionSnapshot(session) {
  return {
    step: session.step,
    order: deepClone(session.order),
    draft: deepClone(session.draft)
  };
}

function sessionSnapshotSignature(snapshot) {
  return JSON.stringify(snapshot);
}

async function processIncomingMessage(session, message) {
  const messageType = message?.type || "text";
  const text = messageType === "text" ? String(message.text?.body || "").trim() : "";
  const command = normalize(text);
  const recipient = String(session.waId);

  if (messageType === "text" && ["voltar", "volta", "retornar", "back"].includes(command)) {
    activeInteractiveMessages.add(recipient);
    try {
      const previous = Array.isArray(session.history) ? session.history.pop() : null;
      if (!previous) {
        resetSession(session);
        session.skipHistoryOnce = false;
        await sendText(recipient, mainMenu(session.customerName));
        return;
      }
      session.step = previous.step;
      session.order = deepClone(previous.order);
      session.draft = deepClone(previous.draft);
      session.skipHistoryOnce = false;
      session.updatedAt = Date.now();
      await sendText(recipient, previous.prompt || mainMenu(session.customerName));
    } finally {
      activeInteractiveMessages.delete(recipient);
    }
    return;
  }

  const before = sessionSnapshot(session);
  const beforePrompt = lastBotMessages.get(recipient) || mainMenu(session.customerName);
  session.skipHistoryOnce = false;
  activeInteractiveMessages.add(recipient);
  try {
    await processIncomingMessageCore(session, message);
  } finally {
    activeInteractiveMessages.delete(recipient);
    const after = sessionSnapshot(session);
    const afterPrompt = lastBotMessages.get(recipient) || "";
    const changed = sessionSnapshotSignature(before) !== sessionSnapshotSignature(after) || beforePrompt !== afterPrompt;
    if (!session.skipHistoryOnce && changed) {
      if (!Array.isArray(session.history)) session.history = [];
      session.history.push({ ...before, prompt: beforePrompt });
      if (session.history.length > 30) session.history.shift();
    }
    session.skipHistoryOnce = false;
    session.updatedAt = Date.now();
  }
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").map((part) => part.trim().split("=")).reduce((cookies, [key, ...rest]) => {
    if (key) cookies[key] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

function adminCookieValue() {
  if (!ADMIN_KEY) return "";
  return crypto.createHmac("sha256", ADMIN_KEY).update("mr-pizzaria-admin").digest("hex");
}

function isAdminRequest(req) {
  if (!ADMIN_KEY) return false;
  const cookies = parseCookies(req);
  return cookies.mr_admin === adminCookieValue() || req.query.key === ADMIN_KEY;
}

function isApiRequestAuthorized(req) {
  if (!PRINT_API_KEY) return false;
  return req.headers["x-api-key"] === PRINT_API_KEY || req.query.key === PRINT_API_KEY;
}

function statusClass(status) {
  return {
    "Aguardando pagamento": "agendado", "Pagamento recusado": "cancelado",
    "Agendado": "agendado", "Novo": "novo", "Aceito": "aceito", "Em preparo": "preparo",
    "Pronto": "pronto", "Saiu para entrega": "entrega", "Finalizado": "finalizado", "Cancelado": "cancelado",
    "Pendente": "novo", "Confirmada": "pronto", "Concluída": "finalizado", "Cancelada": "cancelado", "Atendido": "finalizado"
  }[status] || "novo";
}

function statusNotification(order) {
  const scheduledText = order.scheduledFor ? ` Agendado para ${formatDateTime(order.scheduledFor)}.` : "";
  const messages = {
    "Agendado": `📅 Pedido nº ${order.number} agendado com sucesso.${scheduledText}`,
    "Aceito": `✅ Pedido nº ${order.number} aceito pela MR Pizzaria.${scheduledText} Previsão: ${CONFIG.estimate}.`,
    "Em preparo": `👨‍🍳 Seu pedido nº ${order.number} está em preparo.`,
    "Pronto": order.deliveryType === "Retirada"
      ? `✅ Seu pedido nº ${order.number} está pronto para retirada.`
      : order.deliveryType === "Consumir no local"
        ? `✅ Seu pedido nº ${order.number} está pronto para servir${order.tableNumber ? ` na mesa ${order.tableNumber}` : ""}.`
        : `✅ Seu pedido nº ${order.number} está pronto e será encaminhado para entrega.`,
    "Saiu para entrega": `🛵 Seu pedido nº ${order.number} saiu para entrega.`,
    "Finalizado": `🍕 Pedido nº ${order.number} finalizado. Obrigado por pedir na MR Pizzaria!`,
    "Cancelado": `Pedido nº ${order.number} foi cancelado. Para falar com um atendente, digite *9*.`
  };
  return messages[order.status] || "";
}

function reservationStatusNotification(reservation) {
  const messages = {
    "Confirmada": `✅ Sua reserva nº ${reservation.number} foi confirmada para ${formatDateTime(reservation.reservationFor)}, para ${reservation.people} pessoa(s).`,
    "Concluída": `Obrigado pela visita! A reserva nº ${reservation.number} foi concluída.`,
    "Cancelada": `Sua reserva nº ${reservation.number} foi cancelada. Para falar com um atendente, digite *9*.`
  };
  return messages[reservation.status] || "";
}

function orderHasPizza(order) {
  return (order.items || []).some((item) => item.type === "pizza");
}

function orderHasKitchen(order) {
  return (order.items || []).some((item) => item.type !== "pizza");
}

function renderAdminLogin(error = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar — MR Pizzaria</title><style>body{font-family:Arial;background:#f7efe5;display:grid;place-items:center;min-height:100vh;margin:0}.box{width:min(92%,390px);background:#fff;padding:24px;border-radius:16px;box-shadow:0 12px 35px #0002}h1{color:#941a1e}input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:9px;margin-top:8px}input{border:1px solid #ccc}button{border:0;background:#941a1e;color:#fff;font-weight:bold}.error{color:#a00}</style></head><body><form class="box" method="post" action="/admin/login"><h1>MR Pizzaria</h1><p>Painel de atendimento</p>${error ? `<p class="error">${safeHtml(error)}</p>` : ""}<label>Senha administrativa</label><input type="password" name="key" required autofocus><button type="submit">Entrar</button></form></body></html>`;
}

function adminShell(title, body, extras = "", autoRefresh = true) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${autoRefresh ? '<meta http-equiv="refresh" content="30">' : ""}<title>${safeHtml(title)} — MR Pizzaria</title><style>:root{font-family:Arial,sans-serif;color:#252525}body{margin:0;background:#f6eee3}.top{background:#8e171c;color:#fff;padding:16px 4vw;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}.top h1{margin:0;font-size:22px}.top a{color:#fff;text-decoration:none;font-weight:bold}.nav{display:flex;gap:12px;flex-wrap:wrap}.wrap{max-width:1250px;margin:auto;padding:20px}.ok,.warn{padding:12px;border-radius:10px;margin-bottom:14px}.ok{background:#e3f5e7;color:#256437}.warn{background:#fff0cf;color:#7b4b00}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.kpi{background:#fff;border-radius:12px;padding:14px;box-shadow:0 5px 18px #0001}.kpi b{font-size:23px;color:#941a1e;display:block}.card,.order{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 6px 20px #0001}.order header,.card header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.order header strong,.card header strong{font-size:20px;color:#941a1e}.status{padding:7px 10px;border-radius:999px;font-weight:bold;height:max-content}.agendado{background:#d8f1ff;color:#075979}.novo{background:#ffe1e1;color:#8d1515}.aceito{background:#dce9ff;color:#164f94}.preparo{background:#ffefc8;color:#7a4c00}.pronto{background:#dff4e4;color:#236738}.entrega{background:#e8e1ff;color:#503899}.finalizado{background:#e7e7e7;color:#555}.cancelado{background:#222;color:#fff}.columns{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.columns ul{padding-left:20px}.total{font-size:20px;color:#941a1e;font-weight:bold}.actions{display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid #eee;padding-top:10px;margin-top:10px}.actions button,.actions a{border:0;border-radius:8px;padding:8px 11px;font-weight:bold;text-decoration:none;background:#eee;color:#222;cursor:pointer}.actions a.primary{background:#941a1e;color:#fff}.empty{background:#fff;padding:35px;text-align:center;border-radius:14px}.tag{display:inline-block;background:#f3e8d9;padding:5px 8px;border-radius:8px;margin:2px}.map{color:#8e171c;font-weight:bold}@media(max-width:800px){.kpis{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}}</style>${extras}</head><body><div class="top"><h1>MR Pizzaria — ${safeHtml(title)}</h1><nav class="nav"><a href="/admin">Pedidos</a><a href="/admin/mesas">Mesas</a><a href="/admin/equipe">Equipe</a><a href="/admin/reservas">Reservas</a><a href="/admin/atendimentos">Atendimentos</a><a href="/admin/promocao">Promoções</a><a href="/admin/combos">Combos</a><a href="/admin/recuperacao">Recuperar vendas</a><a href="/admin/relatorios">Relatórios</a><a href="/admin/export.json">Backup</a><a href="/admin/logout">Sair</a></nav></div><main class="wrap">${body}</main></body></html>`;
}

function renderOrdersPage(orderList, reservationPending, servicePending, notice = "", error = "") {
  const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0]));
  let sales = 0;
  for (const order of orderList) {
    counts[order.status] = (counts[order.status] || 0) + 1;
    if (order.status !== "Cancelado" && order.status !== "Pagamento recusado" && !(order.paymentProvider === "pagarme" && order.paymentStatus !== "paid")) sales += order.total;
  }
  const cards = orderList.map((order) => {
    const items = order.items.map((item) => `<li><b>${item.qty}x</b> ${safeHtml(item.name)}${item.note ? `<br><small>Obs.: ${safeHtml(item.note)}</small>` : ""}</li>`).join("");
    const unpaidOnline = order.paymentProvider === "pagarme" && order.paymentStatus !== "paid";
    const buttons = (unpaidOnline ? ["Cancelado"] : ORDER_STATUSES.filter((status) => !["Aguardando pagamento","Pagamento recusado"].includes(status))).filter((status) => status !== order.status).map((status) => `<button name="status" value="${safeHtml(status)}">${safeHtml(status)}</button>`).join("");
    const address = order.deliveryType === "Entrega" ? formatAddress(order.address) : CONFIG.storeAddress;
    return `<article class="order"><header><div><strong>Pedido nº ${order.number}</strong><br><span>${formatDateTime(order.createdAt)} • ${safeHtml(order.customerName)} • ${safeHtml(order.customerPhone)}</span>${order.scheduledFor ? `<br><span class="tag">📅 Agendado: ${formatDateTime(order.scheduledFor)}</span>` : ""}${order.reservationNumber ? `<span class="tag">🍽️ Reserva nº ${order.reservationNumber}</span>` : ""}${order.tabCode ? `<span class="tag">🧾 ${safeHtml(order.tabCode)} — Mesa ${safeHtml(order.tableNumber)}</span>` : ""}</div><span class="status ${statusClass(order.status)}">${safeHtml(order.status)}</span></header><div class="columns"><section><h3>Itens</h3><ul>${items}</ul>${order.couponCode ? `<p><b>Cupom:</b> ${safeHtml(order.couponCode)} — desconto ${money(order.discount)}</p>` : ""}${order.paymentReceiptId ? `<p><b>Comprovante Pix:</b> recebido ✓</p>` : ""}</section><section><h3>${safeHtml(order.deliveryType)}</h3><p>${safeHtml(address)}</p>${order.address?.mapUrl ? `<p><a class="map" target="_blank" href="${safeHtml(order.address.mapUrl)}">Abrir localização</a></p>` : ""}${order.pickupName ? `<p><b>Retirada em nome de:</b> ${safeHtml(order.pickupName)}</p>` : ""}${order.deliveryType === "Consumir no local" ? `${order.reservationNumber ? `<p><b>Reserva vinculada:</b> nº ${order.reservationNumber}</p>` : ""}<p><b>Mesa:</b> ${safeHtml(order.tableNumber || "A definir")}</p>${order.tabCode ? `<p><b>Comanda:</b> ${safeHtml(order.tabCode)} — ${safeHtml(order.commandName || "Comanda geral")}</p>` : ""}${order.waiterName ? `<p><b>Garçom:</b> ${safeHtml(order.waiterName)}</p>` : ""}` : ""}<p><b>Pagamento:</b> ${safeHtml(order.payment)}${order.changeFor ? ` — troco para ${money(order.changeFor)}` : ""}</p>${order.paymentProvider === "pagarme" ? `<p><b>Status do pagamento:</b> ${order.paymentStatus === "paid" ? "✅ Pago online" : order.paymentStatus === "failed" ? "❌ Recusado" : order.paymentStatus === "refunded" ? "↩️ Estornado" : "⏳ Aguardando pagamento"}${order.paymentLinkUrl && order.paymentStatus !== "paid" ? ` — <a target="_blank" rel="noopener" href="${safeHtml(order.paymentLinkUrl)}">abrir checkout</a>` : ""}</p>` : ""}<p class="total">Total: ${money(order.total)}</p></section></div><div class="actions">${unpaidOnline ? `<span class="tag">🔒 Impressão liberada após o pagamento</span>` : `${orderHasPizza(order) ? `<a class="primary" target="_blank" href="/admin/orders/${order.number}/print?type=pizza">Imprimir pizza${order.pizzaPrintedAt ? " ✓" : ""}</a>` : ""}${orderHasKitchen(order) ? `<a class="primary" target="_blank" href="/admin/orders/${order.number}/print?type=kitchen">Imprimir cozinha${order.kitchenPrintedAt ? " ✓" : ""}</a>` : ""}<a class="primary" target="_blank" href="/admin/orders/${order.number}/print?type=all">Pedido completo</a>`}</div><form class="actions" method="post" action="/admin/orders/${order.number}/status">${buttons}</form></article>`;
  }).join("");
  const warning = storageMode() === "postgres" ? `<div class="ok">Banco conectado e atualizado para pedidos, reservas e atendimentos.</div>` : `<div class="warn">DATABASE_URL não configurado. Os dados podem ser perdidos quando o Render reiniciar.</div>`;
  const body = `${notice ? `<div class="ok">${safeHtml(notice)}</div>` : ""}${error ? `<div class="warn">${safeHtml(error)}</div>` : ""}${warning}<div class="kpis"><div class="kpi">Agendados/novos<b>${(counts.Agendado || 0) + (counts.Novo || 0)}</b></div><div class="kpi">Em preparo<b>${(counts.Aceito || 0) + (counts["Em preparo"] || 0)}</b></div><div class="kpi">Reservas/atendimentos<b>${reservationPending}/${servicePending}</b></div><div class="kpi">Vendas exibidas<b>${money(sales)}</b></div></div>${cards || '<div class="empty">Nenhum pedido registrado.</div>'}`;
  return adminShell("Pedidos", body);
}

function renderReservationsPage(reservations) {
  const cards = reservations.map((reservation) => {
    const buttons = RESERVATION_STATUSES.filter((status) => status !== reservation.status).map((status) => `<button name="status" value="${safeHtml(status)}">${safeHtml(status)}</button>`).join("");
    return `<article class="card"><header><div><strong>Reserva nº ${reservation.number}</strong><br><span>${safeHtml(reservation.customerName)} • ${safeHtml(reservation.customerPhone)}</span></div><span class="status ${statusClass(reservation.status)}">${safeHtml(reservation.status)}</span></header><h3>📅 ${formatDateTime(reservation.reservationFor)}</h3><p><b>Pessoas:</b> ${reservation.people}</p><p><b>Observação:</b> ${safeHtml(reservation.notes || "Nenhuma")}</p><form class="actions" method="post" action="/admin/reservas/${reservation.number}/status">${buttons}</form></article>`;
  }).join("");
  return adminShell("Reservas", cards || '<div class="empty">Nenhuma reserva registrada.</div>');
}

function renderServicePage(requests) {
  const cards = requests.map((request) => `<article class="card"><header><div><strong>${safeHtml(request.customerName)}</strong><br><span>${safeHtml(request.customerPhone)} • ${formatDateTime(request.createdAt)}</span></div><span class="status ${statusClass(request.status)}">${safeHtml(request.status)}</span></header><p>${safeHtml(request.message)}</p>${request.status !== "Atendido" ? `<form class="actions" method="post" action="/admin/atendimentos/${request.id}/status"><button name="status" value="Atendido">Marcar como atendido</button></form>` : ""}</article>`).join("");
  return adminShell("Atendimentos", cards || '<div class="empty">Nenhuma solicitação de atendente.</div>');
}


function orderTotalForTab(orders, tabCode) {
  return orders.filter((order) => order.tabCode === tabCode && order.status !== "Cancelado").reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function renderTablesPage(tabs, orders) {
  const cards = Array.from({ length: CONFIG.tableCount }, (_, index) => index + 1).map((tableNumber) => {
    const openTabs = tabs.filter((tab) => tab.tableNumber === tableNumber && tab.status !== "Fechada");
    const requested = openTabs.some((tab) => tab.status === "Conta solicitada");
    const total = openTabs.reduce((sum, tab) => sum + orderTotalForTab(orders, tab.tabCode), 0);
    const status = !openTabs.length ? "Livre" : requested ? "Conta solicitada" : "Ocupada";
    const cls = status === "Livre" ? "table-free" : status === "Conta solicitada" ? "table-request" : "table-busy";
    const details = openTabs.length ? `<div class="table-tabs">${openTabs.map((tab) => `<span>${safeHtml(tab.tabCode)} — ${safeHtml(tab.customerName)}</span>`).join("")}</div>` : '<p class="muted">Nenhuma comanda aberta.</p>';
    return `<a class="table-card ${cls}" href="/admin/mesas/${tableNumber}"><div class="table-number">Mesa ${String(tableNumber).padStart(2, "0")}</div><div class="table-status">${status}</div><div>${openTabs.length} comanda(s)</div><strong>${money(total)}</strong>${details}</a>`;
  }).join("");
  const body = `<div class="table-help">As 17 mesas mostram comandas individuais, total em aberto e solicitação de conta. Toque em uma mesa para abrir comandas ou lançar pedidos.</div><div class="table-grid">${cards}</div>`;
  const extras = `<style>.table-help{background:#fff;padding:14px;border-radius:12px;margin-bottom:14px}.table-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}.table-card{display:block;text-decoration:none;color:#222;background:#fff;border-radius:15px;padding:16px;box-shadow:0 6px 20px #0001;border:3px solid transparent}.table-free{border-color:#67ad78}.table-busy{border-color:#e5a531}.table-request{border-color:#c94b4b}.table-number{font-size:22px;font-weight:900;color:#8e171c}.table-status{font-weight:bold;margin:5px 0}.table-card strong{font-size:20px;display:block;margin-top:8px}.table-tabs{display:grid;gap:4px;margin-top:8px;font-size:12px}.table-tabs span{background:#f5eee6;padding:5px;border-radius:6px}.muted{color:#666}@media(max-width:900px){.table-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.table-grid{grid-template-columns:repeat(2,1fr)}}</style>`;
  return adminShell("Mesas", body, extras, false);
}

function renderTableDetailPage(tableNumber, tabs, orders, staff, notice = "", error = "") {
  const openTabs = tabs.filter((tab) => tab.status !== "Fechada");
  const closedTabs = tabs.filter((tab) => tab.status === "Fechada").slice(0, 10);
  const waiterOptions = ['<option value="">Sem garçom definido</option>', ...staff.filter((item) => item.active && item.role === "Garçom").map((item) => `<option value="${safeHtml(item.name)}">${safeHtml(item.name)}</option>`)].join("");
  const tabCard = (tab) => {
    const tabOrders = orders.filter((order) => order.tabCode === tab.tabCode);
    const activeOrders = tabOrders.filter((order) => order.status !== "Cancelado");
    const total = activeOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const items = activeOrders.flatMap((order) => order.items || []).map((item) => `<li>${item.qty}x ${safeHtml(item.name)}</li>`).join("");
    const addUrl = `/comprar?modo=garcom&mesa=${tableNumber}&comanda=${encodeURIComponent(tab.tabCode)}&cliente=${encodeURIComponent(tab.customerName)}&garcom=${encodeURIComponent(tab.waiterName || "")}`;
    return `<article class="tab-card"><header><div><strong>${safeHtml(tab.tabCode)} — ${safeHtml(tab.customerName)}</strong><br><span>Garçom: ${safeHtml(tab.waiterName || "Não definido")} • ${formatDateTime(tab.createdAt)}</span></div><span class="status ${tab.status === "Conta solicitada" ? "cancelado" : tab.status === "Fechada" ? "finalizado" : "pronto"}">${safeHtml(tab.status)}</span></header><div class="tab-columns"><div><h3>Consumo</h3><ul>${items || "<li>Nenhum item lançado.</li>"}</ul></div><div><h3>Total</h3><div class="tab-total">${money(total)}</div><p>${activeOrders.length} pedido(s)</p></div></div><div class="actions"><a class="primary" href="${addUrl}" target="_blank">Adicionar pedido</a><a target="_blank" href="/admin/comandas/${encodeURIComponent(tab.tabCode)}/print">Imprimir comanda</a></div>${tab.status !== "Fechada" ? `<form class="actions" method="post" action="/admin/comandas/${encodeURIComponent(tab.tabCode)}/status">${tab.status !== "Conta solicitada" ? '<button name="status" value="Conta solicitada">Solicitar conta</button>' : '<button name="status" value="Aberta">Voltar para aberta</button>'}<button class="danger" name="status" value="Fechada">Fechar comanda</button></form>` : ""}</article>`;
  };
  const body = `${notice ? `<div class="ok">${safeHtml(notice)}</div>` : ""}${error ? `<div class="warn">${safeHtml(error)}</div>` : ""}<div class="back"><a href="/admin/mesas">← Voltar às mesas</a></div><section class="card open-form"><header><div><strong>Mesa ${String(tableNumber).padStart(2, "0")}</strong><br><span>Abra quantas comandas individuais forem necessárias.</span></div></header><form method="post" action="/admin/mesas/${tableNumber}/comandas"><div><label>Nome da comanda</label><input name="customerName" required maxlength="80" placeholder="Ex.: João"></div><div><label>Garçom</label><select name="waiterName">${waiterOptions}</select></div><div><label>Pessoas</label><input name="people" type="number" min="0" max="50" value="1"></div><button type="submit">Abrir comanda</button></form></section><h2>Comandas abertas</h2>${openTabs.map(tabCard).join("") || '<div class="empty">Nenhuma comanda aberta nesta mesa.</div>'}${closedTabs.length ? `<h2>Últimas comandas fechadas</h2>${closedTabs.map(tabCard).join("")}` : ""}`;
  const extras = `<style>.back{margin-bottom:12px}.back a{color:#8e171c;font-weight:bold}.open-form form{display:grid;grid-template-columns:2fr 1.3fr .7fr auto;gap:10px;align-items:end;margin-top:12px}.open-form label{display:block;font-weight:bold;margin-bottom:5px}.open-form input,.open-form select{width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:8px}.open-form button{padding:12px 16px;border:0;border-radius:8px;background:#8e171c;color:#fff;font-weight:bold}.tab-card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 6px 20px #0001}.tab-card header{display:flex;justify-content:space-between;gap:12px}.tab-card header strong{font-size:20px;color:#8e171c}.tab-columns{display:grid;grid-template-columns:1.4fr .6fr;gap:15px}.tab-total{font-size:25px;font-weight:900;color:#8e171c}.danger{background:#3b1e1e!important;color:#fff!important}@media(max-width:760px){.open-form form{grid-template-columns:1fr}.tab-columns{grid-template-columns:1fr}}</style>`;
  return adminShell(`Mesa ${tableNumber}`, body, extras, false);
}

function renderStaffPage(staff, notice = "", error = "") {
  const rows = staff.map((item) => `<tr><td><b>${safeHtml(item.name)}</b></td><td>${safeHtml(item.role)}</td><td>${item.active ? "Ativo" : "Inativo"}</td><td><form method="post" action="/admin/equipe/${item.id}/toggle"><button>${item.active ? "Desativar" : "Ativar"}</button></form></td></tr>`).join("");
  const roleOptions = STAFF_ROLES.map((role) => `<option>${safeHtml(role)}</option>`).join("");
  const body = `${notice ? `<div class="ok">${safeHtml(notice)}</div>` : ""}${error ? `<div class="warn">${safeHtml(error)}</div>` : ""}<section class="card staff-form"><header><div><strong>Cadastrar funcionário</strong><br><span>A quantidade é livre. O PIN fica preparado para o acesso individual.</span></div></header><form method="post" action="/admin/equipe"><input name="name" required maxlength="80" placeholder="Nome"><select name="role">${roleOptions}</select><input name="pin" required inputmode="numeric" pattern="[0-9]{4,8}" placeholder="PIN de 4 a 8 números"><button>Cadastrar</button></form></section><section class="card"><table><thead><tr><th>Nome</th><th>Função</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Nenhum funcionário cadastrado.</td></tr>'}</tbody></table></section>`;
  const extras = `<style>.staff-form form{display:grid;grid-template-columns:2fr 1.2fr 1fr auto;gap:10px;margin-top:14px}.staff-form input,.staff-form select{padding:11px;border:1px solid #ccc;border-radius:8px}.staff-form button,table button{border:0;border-radius:8px;padding:10px 13px;background:#8e171c;color:#fff;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #eee}@media(max-width:700px){.staff-form form{grid-template-columns:1fr}table{font-size:13px}}</style>`;
  return adminShell("Equipe", body, extras, false);
}

function renderCommandPrintPage(tab, orders) {
  const activeOrders = orders.filter((order) => order.status !== "Cancelado");
  const total = activeOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const items = activeOrders.flatMap((order) => (order.items || []).map((item) => ({ ...item, orderNumber: order.number })));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeHtml(tab.tabCode)}</title><style>body{font-family:Arial,sans-serif;width:76mm;margin:0;padding:2mm;color:#000}h1,h2{text-align:center;margin:3px 0}.meta{font-size:12px;margin:4px 0}.line{border-top:1px dashed #000;padding:6px 0;font-size:13px}.total{font-size:18px;font-weight:bold;border-top:2px solid #000;padding-top:7px}@media print{@page{size:80mm auto;margin:0}button{display:none}}</style></head><body><h1>MR PIZZARIA</h1><h2>MESA ${tab.tableNumber} — ${safeHtml(tab.tabCode)}</h2><div class="meta"><b>Comanda:</b> ${safeHtml(tab.customerName)}</div><div class="meta"><b>Garçom:</b> ${safeHtml(tab.waiterName || "Não definido")}</div><div class="meta"><b>Abertura:</b> ${formatDateTime(tab.createdAt)}</div>${items.map((item) => `<div class="line"><b>${item.qty}x ${safeHtml(item.name)}</b><br><small>Pedido nº ${item.orderNumber}${item.note ? ` — Obs.: ${safeHtml(item.note)}` : ""}</small></div>`).join("") || '<div class="line">Nenhum item lançado.</div>'}<div class="total">TOTAL: ${money(total)}</div><button onclick="window.print()">Imprimir</button><script>setTimeout(()=>window.print(),400)</script></body></html>`;
}

function renderPromotionPage(promotion, notice = "", error = "") {
  const checked = promotion.active ? "checked" : "";
  const preview = promotion.hasImage
    ? `<div class="promo-preview"><p><b>Imagem atual:</b> ${safeHtml(promotion.imageName || "promoção")}</p><img src="/promocao/imagem?v=${encodeURIComponent(new Date(promotion.updatedAt).getTime() || Date.now())}" alt="Promoção cadastrada"><label class="remove"><input type="checkbox" name="removeImage" value="1"> Remover a imagem atual ao salvar</label></div>`
    : '<p class="muted">Nenhuma imagem cadastrada.</p>';
  const body = `${notice ? `<div class="ok">${safeHtml(notice)}</div>` : ""}${error ? `<div class="warn">${safeHtml(error)}</div>` : ""}<section class="card promo-form"><header><div><strong>Promoção do WhatsApp</strong><br><span>Esta promoção aparece quando o cliente escolhe a opção 3.</span></div><span class="status ${promotion.active ? "pronto" : "finalizado"}">${promotion.active ? "Ativa" : "Desativada"}</span></header><form method="post" action="/admin/promocao" enctype="multipart/form-data"><label class="active"><input type="checkbox" name="active" value="1" ${checked}> Exibir esta promoção para os clientes</label><label>Texto da promoção</label><textarea name="text" maxlength="4000" rows="9" placeholder="Ex.: Pizza grande de Calabresa + Amstel 600 ml por R$ 89,90.">${safeHtml(promotion.text)}</textarea><label>Imagem da promoção</label><input type="file" name="image" accept="image/jpeg,image/png,image/webp"><small>Formatos: JPG, PNG ou WEBP. Tamanho máximo: 5 MB.</small><small>O link <b>Comprar pelo site</b> é acrescentado automaticamente à mensagem da promoção.</small>${preview}<button class="save" type="submit">Salvar promoção</button></form></section>`;
  const extras = `<style>.promo-form{max-width:760px;margin:auto}.promo-form form{display:grid;gap:10px;margin-top:18px}.promo-form label{font-weight:bold}.promo-form .active,.promo-form .remove{display:flex;gap:9px;align-items:center;font-weight:normal}.promo-form input[type=file],.promo-form textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid #ccc;border-radius:9px;font:inherit}.promo-form textarea{resize:vertical}.promo-form .save{border:0;border-radius:9px;padding:13px;background:#941a1e;color:#fff;font-weight:bold;font-size:16px;cursor:pointer}.promo-preview{border-top:1px solid #eee;margin-top:8px;padding-top:12px}.promo-preview img{display:block;max-width:100%;max-height:520px;border-radius:12px;border:1px solid #ddd;margin:8px 0 12px}.muted{color:#666}</style>`;
  return adminShell("Promoções", body, extras, false);
}

function renderRecoveryPage(carts, notice = "") {
  const now = Date.now();
  const minAgeMs = ABANDONED_CART_MIN_AGE_MINUTES * 60 * 1000;
  const cards = carts.map((cart) => {
    const ageMs = Math.max(0, now - new Date(cart.updatedAt || cart.createdAt || now).getTime());
    const eligible = cart.status === "Pendente" && ageMs >= minAgeMs;
    const ageMin = Math.max(0, Math.floor(ageMs / 60000));
    const items = (cart.items || []).map((item) => `<li>${Number(item.qty || 0)}x ${safeHtml(item.name)} — ${money(item.total)}</li>`).join("");
    const phone = String(cart.customerPhone || "").replace(/\D/g, "");
    const recoveryText = `Olá${cart.customerName ? `, ${cart.customerName}` : ""}! 🍕 Você deixou alguns itens no carrinho da MR Pizzaria. Se quiser concluir seu pedido, é só abrir: ${ORDER_SITE_URL}`;
    const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(recoveryText)}` : "#";
    return `<article class="recover-card"><header><div><strong>${safeHtml(cart.customerName || "Cliente sem nome")}</strong><br><span>${safeHtml(cart.customerPhone)} • atualizado há ${ageMin} min</span></div><span class="status ${cart.status === "Pendente" ? "novo" : "finalizado"}">${safeHtml(cart.status)}</span></header><div class="recover-cols"><div><h3>Carrinho</h3><ul>${items || "<li>Sem itens.</li>"}</ul></div><div><h3>Total dos itens</h3><div class="recover-total">${money(cart.subtotal)}</div><p>${safeHtml(cart.deliveryType)}</p></div></div><div class="actions">${eligible && phone ? `<a class="primary" target="_blank" rel="noopener" href="${safeHtml(waUrl)}">Abrir WhatsApp para recuperar</a>` : cart.status === "Pendente" ? `<span class="wait">Disponível após ${ABANDONED_CART_MIN_AGE_MINUTES} min sem atividade</span>` : ""}</div>${cart.status === "Pendente" ? `<form class="actions" method="post" action="/admin/recuperacao/${cart.id}/status"><button name="status" value="Recuperado">Marcar recuperado</button><button name="status" value="Ignorado">Ignorar</button></form>` : ""}</article>`;
  }).join("");
  const body = `${notice ? `<div class="ok">${safeHtml(notice)}</div>` : ""}<div class="table-help"><b>Recuperação de vendas:</b> aparecem aqui somente clientes que marcaram no site que aceitam receber um lembrete do carrinho. O botão de WhatsApp é liberado após ${ABANDONED_CART_MIN_AGE_MINUTES} minutos sem atividade, evitando abordar quem ainda está montando o pedido.</div>${cards || '<div class="empty">Nenhum carrinho para recuperar.</div>'}`;
  const extras = `<style>.recover-card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 6px 20px #0001}.recover-card header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.recover-card header span{color:#6d625b}.recover-cols{display:grid;grid-template-columns:1.6fr .7fr;gap:18px;margin-top:12px}.recover-cols ul{padding-left:20px}.recover-cols li{margin:6px 0}.recover-total{font-size:26px;font-weight:900;color:#941a1e}.wait{display:inline-block;background:#fff4c7;border:1px solid #ecd26f;padding:9px 11px;border-radius:8px}.table-help{background:#fff7df;border:1px solid #edcf74;border-radius:10px;padding:14px;margin-bottom:14px}@media(max-width:700px){.recover-cols{grid-template-columns:1fr}}</style>`;
  return adminShell("Recuperação de vendas", body, extras, false);
}

function renderFeaturedCombosPage(combos, notice="", error="") {
 const rows=combos.map(c=>`<article class="combo-admin"><div class="combo-head"><strong>#${c.id} — ${safeHtml(c.name)}</strong><span>${c.active?"Ativo":"Inativo"}</span></div>${c.hasImage?`<img class="combo-preview" src="/combo/${c.id}/imagem?v=${encodeURIComponent(c.updatedAt||"1")}" alt="Foto do combo">`:'<div class="no-photo">Sem foto</div>'}<form method="post" action="/admin/combos/${c.id}" enctype="multipart/form-data"><div class="fields"><label>Nome<input name="name" required value="${safeHtml(c.name)}"></label><label>Preço<input name="price" required value="${Number(c.price).toFixed(2).replace(".",",")}"></label><label>Ordem<input name="sortOrder" type="number" value="${c.sortOrder||0}"></label></div><label>Descrição<textarea name="description" rows="3">${safeHtml(c.description)}</textarea></label><label>Foto<input class="file" type="file" name="image" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WEBP, até 5 MB.</small></label>${c.hasImage?'<label class="active"><input type="checkbox" name="removeImage" value="1"> Remover foto atual</label>':""}<label class="active"><input type="checkbox" name="active" value="1" ${c.active?"checked":""}> Exibir no site</label><button class="save">Salvar alterações</button></form><form method="post" action="/admin/combos/${c.id}/delete" onsubmit="return confirm('Excluir este combo?')"><button class="danger">Excluir combo</button></form></article>`).join("");
 const body=`${notice?`<div class="ok">${safeHtml(notice)}</div>`:""}${error?`<div class="warn">${safeHtml(error)}</div>`:""}<section class="card combo-form"><header><div><strong>Combos em destaque</strong><br><span>Cadastre uma foto para chamar mais atenção no site.</span></div></header><form method="post" action="/admin/combos" enctype="multipart/form-data"><div class="fields"><label>Nome<input name="name" required placeholder="Ex.: Combo Casal"></label><label>Preço<input name="price" required placeholder="Ex.: 89,90"></label><label>Ordem<input name="sortOrder" type="number" value="0"></label></div><label>Descrição<textarea name="description" rows="3"></textarea></label><label>Foto<input class="file" type="file" name="image" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WEBP, até 5 MB.</small></label><label class="active"><input type="checkbox" name="active" value="1" checked> Exibir no site</label><button class="save">Adicionar combo</button></form></section><h2>Combos cadastrados</h2>${rows||'<div class="empty">Nenhum combo cadastrado.</div>'}`;
 const extras=`<style>.combo-form,.combo-admin{max-width:900px;margin:0 auto 14px}.combo-form form,.combo-admin form{display:grid;gap:10px}.fields{display:grid;grid-template-columns:2fr 1fr .6fr;gap:10px}.fields input,textarea,.file{width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:8px;font:inherit;margin-top:5px}.active{display:flex;gap:8px;align-items:center}.save,.danger{border:0;border-radius:8px;padding:11px 14px;font-weight:bold}.save{background:#941a1e;color:#fff}.danger{background:#3b1e1e;color:#fff;margin-top:10px}.combo-admin{background:#fff;border-radius:14px;padding:16px;box-shadow:0 6px 20px #0001}.combo-head{display:flex;justify-content:space-between}.combo-preview{width:100%;max-height:320px;object-fit:cover;border-radius:12px;margin:12px 0}.no-photo{background:#f3eee8;padding:22px;text-align:center;border-radius:10px;margin:12px 0}small{display:block;color:#766b64}@media(max-width:700px){.fields{grid-template-columns:1fr}}</style>`;return adminShell("Combos",body,extras,false)
}
function salesReportSummary(orders){const valid=orders.filter(o=>o.status!=="Cancelado"&&o.status!=="Pagamento recusado"&&!(o.paymentProvider==="pagarme"&&o.paymentStatus!=="paid")),finalizados=valid.filter(o=>o.status==="Finalizado"),total=valid.reduce((s,o)=>s+Number(o.total||0),0),avg=valid.length?total/valid.length:0,payments=new Map(),channels=new Map(),products=new Map();for(const o of valid){payments.set(o.payment||"Não informado",(payments.get(o.payment||"Não informado")||0)+Number(o.total||0));channels.set(o.deliveryType||"Não informado",(channels.get(o.deliveryType||"Não informado")||0)+Number(o.total||0));for(const i of o.items||[]){const k=i.name||i.label||"Item",v=products.get(k)||{qty:0,total:0};v.qty+=Number(i.qty||0);v.total+=Number(i.total||0);products.set(k,v)}}return{valid,finalizados,total,avg,payments,channels,products}}
function renderSalesReportPage(orders,range,notice="",error=""){const r=salesReportSummary(orders),today=ymdInStoreZone(),d7=addDaysYmd(today,-6),d30=addDaysYmd(today,-29),rows=m=>[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<tr><td>${safeHtml(n)}</td><td>${money(v)}</td></tr>`).join(""),prod=[...r.products.entries()].sort((a,b)=>b[1].qty-a[1].qty).slice(0,20).map(([n,v])=>`<tr><td>${safeHtml(n)}</td><td>${v.qty}</td><td>${money(v.total)}</td></tr>`).join(""),recent=r.valid.slice(0,50).map(o=>`<tr><td>#${o.number}</td><td>${safeHtml(formatDateTime(o.createdAt))}</td><td>${safeHtml(o.customerName)}</td><td>${safeHtml(o.deliveryType)}</td><td>${safeHtml(o.payment)}</td><td>${money(o.total)}</td><td>${safeHtml(o.status)}</td></tr>`).join("");const test=TEST_MODE?`<section class="danger-zone"><h2>🧪 Fase de testes</h2><p>Apaga pedidos/vendas, carrinhos abandonados e comandas de mesa de teste. <b>Não apaga cardápio, combos, equipe ou promoção.</b></p><form method="post" action="/admin/test/reset-sales" onsubmit="return confirm('Apagar TODAS as vendas de teste?')"><label>Digite <b>ZERAR VENDAS</b><input name="confirm" required></label><button>Zerar vendas de teste</button></form></section>`:"";const body=`${notice?`<div class="ok">${safeHtml(notice)}</div>`:""}${error?`<div class="warn">${safeHtml(error)}</div>`:""}<section class="filter"><form><label>De<input type="date" name="from" value="${range.from}"></label><label>Até<input type="date" name="to" value="${range.to}"></label><button>Atualizar</button></form><div class="quick"><a href="/admin/relatorios?from=${today}&to=${today}">Hoje</a><a href="/admin/relatorios?from=${d7}&to=${today}">7 dias</a><a href="/admin/relatorios?from=${d30}&to=${today}">30 dias</a></div></section><div class="kpis"><div class="kpi"><span>Faturamento</span><b>${money(r.total)}</b></div><div class="kpi"><span>Pedidos válidos</span><b>${r.valid.length}</b></div><div class="kpi"><span>Ticket médio</span><b>${money(r.avg)}</b></div><div class="kpi"><span>Finalizados</span><b>${r.finalizados.length}</b></div></div><div class="report-grid"><section class="card"><h2>Por pagamento</h2><table>${rows(r.payments)||'<tr><td>Sem vendas</td><td>—</td></tr>'}</table></section><section class="card"><h2>Por canal</h2><table>${rows(r.channels)||'<tr><td>Sem vendas</td><td>—</td></tr>'}</table></section></div><section class="card"><h2>Produtos mais vendidos</h2><table><tr><th>Produto</th><th>Qtd.</th><th>Valor</th></tr>${prod||'<tr><td colspan="3">Sem vendas.</td></tr>'}</table></section><section class="card"><h2>Pedidos do período</h2><div class="scroll"><table><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Canal</th><th>Pagamento</th><th>Total</th><th>Status</th></tr>${recent||'<tr><td colspan="7">Sem pedidos.</td></tr>'}</table></div></section>${test}`;const extras=`<style>.filter{background:#fff;padding:14px;border-radius:12px;margin-bottom:14px}.filter form{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.filter input{display:block;padding:9px}.filter button,.quick a{padding:10px 13px;border:0;border-radius:8px;background:#941a1e;color:#fff;text-decoration:none;font-weight:bold}.quick{display:flex;gap:8px;margin-top:10px}.quick a{background:#ece2d7;color:#5a3026}.report-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.kpi span{display:block;color:#666}.scroll{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #eee;white-space:nowrap}.danger-zone{background:#fff0f0;border:2px solid #c33;padding:16px;border-radius:14px}.danger-zone input{display:block;padding:10px;margin-top:5px}.danger-zone button{background:#a20d14;color:#fff;border:0;padding:11px;border-radius:8px;font-weight:bold}@media(max-width:800px){.report-grid{grid-template-columns:1fr}}</style>`;return adminShell("Relatórios de vendas",body,extras,false)}

function printableItems(order, type) {
  if (type === "pizza") return order.items.filter((item) => item.type === "pizza");
  if (type === "kitchen") return order.items.filter((item) => item.type !== "pizza");
  return order.items;
}

function renderPrintPage(order, type) {
  const items = printableItems(order, type);
  const title = type === "pizza" ? "COMANDA — PIZZAS" : type === "kitchen" ? "COMANDA — COZINHA" : "PEDIDO COMPLETO";
  const address = order.deliveryType === "Entrega" ? formatAddress(order.address) : CONFIG.storeAddress;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${order.number}</title><style>body{font-family:Arial,sans-serif;width:76mm;margin:0;padding:2mm;color:#000}h1,h2{text-align:center;margin:3px 0}h1{font-size:18px}h2{font-size:15px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px}.line{border-top:1px dashed #000;padding:6px 0;font-size:13px}.meta{font-size:12px;margin:4px 0}.total{font-size:16px;font-weight:bold;border-top:2px solid #000;padding-top:6px}@media print{@page{size:80mm auto;margin:0}button{display:none}}</style></head><body><h1>MR PIZZARIA</h1><div class="meta" style="text-align:center">Pedido nº ${order.number}</div><h2>${title}</h2>${order.scheduledFor ? `<div class="meta"><b>AGENDADO:</b> ${formatDateTime(order.scheduledFor)}</div>` : ""}<div class="meta"><b>Recebido:</b> ${formatDateTime(order.createdAt)}</div><div class="meta"><b>Cliente:</b> ${safeHtml(order.customerName)}</div><div class="meta"><b>${safeHtml(order.deliveryType)}:</b> ${safeHtml(address)}</div>${order.pickupName ? `<div class="meta"><b>Retirada em nome de:</b> ${safeHtml(order.pickupName)}</div>` : ""}${order.deliveryType === "Consumir no local" ? `${order.reservationNumber ? `<div class="meta"><b>RESERVA:</b> nº ${order.reservationNumber}</div>` : ""}<div class="meta"><b>Mesa:</b> ${safeHtml(order.tableNumber || "A definir")}</div>${order.tabCode ? `<div class="meta"><b>Comanda:</b> ${safeHtml(order.tabCode)} — ${safeHtml(order.commandName || "Comanda geral")}</div>` : ""}${order.waiterName ? `<div class="meta"><b>Garçom:</b> ${safeHtml(order.waiterName)}</div>` : ""}` : ""}${items.map((item) => `<div class="line"><b>${item.qty}x ${safeHtml(item.name)}</b>${item.note ? `<br>OBS.: ${safeHtml(item.note)}` : ""}</div>`).join("")}${type === "all" ? `<div class="meta"><b>Pagamento:</b> ${safeHtml(order.payment)}${order.changeFor ? ` — troco para ${money(order.changeFor)}` : ""}${order.paymentProvider === "pagarme" ? ` — ${order.paymentStatus === "paid" ? "PAGO ONLINE" : "AGUARDANDO PAGAMENTO"}` : ""}</div>${order.couponCode ? `<div class="meta"><b>Cupom:</b> ${safeHtml(order.couponCode)} — ${money(order.discount)}</div>` : ""}<div class="total">TOTAL: ${money(order.total)}</div>` : ""}<p class="meta" style="text-align:center">${order.scheduledFor ? "HORÁRIO AGENDADO" : CONFIG.estimate}</p><button onclick="window.print()">Imprimir</button><script>setTimeout(()=>window.print(),400)</script></body></html>`;
}


function metaPixelBootstrapHtml() {
  return `<script>window.MR_META_PIXEL_ID=${JSON.stringify(META_PIXEL_ID)};window.MR_META_CAPI_ENABLED=${JSON.stringify(META_CAPI_ENABLED)};window.MR_BUSINESS_WHATSAPP=${JSON.stringify(BUSINESS_WHATSAPP_NUMBER)};window.MR_PAGARME_ENABLED=${JSON.stringify(PAGARME_ENABLED)};window.MR_PAGARME_TEST=${JSON.stringify(PAGARME_TEST_MODE)};<\/script>`;
}

function sendCustomerOrderSite(_req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const html = CUSTOMER_ORDER_SITE_HTML.replace("<!--META_PIXEL_BOOTSTRAP-->", metaPixelBootstrapHtml());
  res.status(200).type("html").send(html);
}

function sendCardapioPdfFile(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${CARDAPIO_PDF_FILENAME}"`);
  res.sendFile(CARDAPIO_PDF_PATH);
}

app.get("/cardapio-mr-pizzaria.pdf", sendCardapioPdfFile);
app.get(["/cardapio.pdf", "/cardapio-pdf"], (_req, res) => res.redirect(302, "/cardapio-mr-pizzaria.pdf"));
app.get("/baixar-cardapio", (_req, res) => res.download(CARDAPIO_PDF_PATH, CARDAPIO_PDF_FILENAME));

// Rotas equivalentes para evitar “Not Found” em links antigos, com ou sem barra final.
app.get(["/comprar", "/comprar/", "/pedido", "/pedido/", "/pedir", "/pedir/", "/loja", "/loja/", "/site", "/site/"], sendCustomerOrderSite);

app.get("/api/site/catalog", async (_req, res) => {
  try {
    const featuredCombos = await listFeaturedCombos();
    res.json({
      deliveryFee: CONFIG.deliveryFee,
      estimate: CONFIG.estimate,
      hours: CONFIG.hours,
      storeAddress: CONFIG.storeAddress,
      pizzaPrices: CONFIG.pizzaPrices,
      borders: CONFIG.borders,
      flavors: FLAVORS,
      flavorDetails: PIZZA_FLAVORS,
      specialFlavors: SPECIAL_FLAVORS,
      products: PRODUCTS,
      featuredCombos,
      onlinePayment: { enabled: PAGARME_ENABLED, testMode: PAGARME_TEST_MODE, provider: "Pagar.me" }
    });
  } catch (error) {
    res.status(500).json({ error: "Não foi possível carregar o cardápio." });
  }
});

app.get("/api/site/promotion", async (_req, res) => {
  try {
    const promotion = await getPromotion();
    res.json({
      active: Boolean(promotion.active && (promotion.text || promotion.hasImage)),
      text: promotion.text || "",
      hasImage: Boolean(promotion.hasImage),
      imageUrl: promotion.hasImage ? `${PUBLIC_BASE_URL}/promocao/imagem?v=${encodeURIComponent(new Date(promotion.updatedAt).getTime() || Date.now())}` : ""
    });
  } catch (error) {
    res.status(500).json({ error: "Não foi possível carregar a promoção." });
  }
});

app.get("/api/meta/capi/status", (_req, res) => {
  res.json({ ok:true, pixelId:META_PIXEL_ID||null, capiEnabled:META_CAPI_ENABLED, graphApiVersion:META_GRAPH_API_VERSION, testEventCodeEnabled:Boolean(META_CAPI_TEST_EVENT_CODE) });
});
app.post("/api/meta/event", async (req, res) => {
  try {
    if (!req.body?.consent) return res.status(204).end();
    if (!META_CAPI_ENABLED) return res.status(202).json({ ok:false, disabled:true });
    const result = await sendMetaCapiEvent({
      req,
      eventName:cleanSiteText(req.body?.eventName,50),
      eventId:cleanSiteText(req.body?.eventId,100),
      eventSourceUrl:cleanSiteText(req.body?.eventSourceUrl,2048)||`${PUBLIC_BASE_URL}/comprar`,
      phone:cleanSiteText(req.body?.phone,40),
      customerName:cleanSiteText(req.body?.customerName,100),
      browserId:cleanSiteText(req.body?.browserId,120),
      fbp:cleanSiteText(req.body?.fbp,255),
      fbc:cleanSiteText(req.body?.fbc,255),
      customData:req.body?.customData
    });
    res.status(result.ok?200:202).json(result);
  } catch(error) { res.status(202).json({ok:false,error:error.message||"Falha ao enviar evento para a Meta."}); }
});

app.post("/api/site/abandoned-cart", async (req, res) => {
  try {
    if (cleanSiteText(req.body?.company, 100)) return res.status(400).json({ error: "Carrinho inválido." });
    if (!req.body?.recoveryOptIn) return res.status(204).end();
    const cart = await upsertAbandonedCart({
      cartToken: req.body?.cartToken,
      customerName: req.body?.customerName,
      customerPhone: req.body?.phone,
      deliveryType: cleanSiteText(req.body?.deliveryType, 40),
      address: req.body?.address || {},
      items: req.body?.items,
      recoveryOptIn: true
    });
    res.status(200).json({ ok: true, id: cart.id, updatedAt: cart.updatedAt });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível salvar o carrinho." });
  }
});

app.post("/api/site/orders", async (req, res) => {
  try {
    if (!siteOrderRateAllowed(req)) return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    if (cleanSiteText(req.body?.company, 100)) return res.status(400).json({ error: "Pedido inválido." });

    const customerName = cleanSiteText(req.body?.customerName, 80);
    if (customerName.length < 2) throw new Error("Informe o nome do cliente.");

    const deliveryTypes = { entrega: "Entrega", retirada: "Retirada", "consumir no local": "Consumir no local" };
    const deliveryType = deliveryTypes[normalize(req.body?.deliveryType)];
    if (!deliveryType) throw new Error("Escolha entrega, retirada ou consumo no local.");

    const tableNumber = deliveryType === "Consumir no local" ? normalizeTableNumber(req.body?.tableNumber) : null;
    if (deliveryType === "Consumir no local" && !tableNumber) throw new Error(`Informe uma mesa de 1 a ${CONFIG.tableCount}.`);
    const phoneDigits = String(req.body?.phone || "").replace(/\D/g, "");
    let customerPhone = "";
    if (phoneDigits.length >= 10 && phoneDigits.length <= 13) customerPhone = normalizeRecipientNumber(phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`);
    else if (deliveryType === "Consumir no local") customerPhone = `local-mesa-${tableNumber}-${Date.now()}`;
    else throw new Error("Informe um WhatsApp válido com DDD.");

    const address = {
      street: cleanSiteText(req.body?.address?.street, 120),
      number: cleanSiteText(req.body?.address?.number, 20),
      district: cleanSiteText(req.body?.address?.district, 80),
      reference: cleanSiteText(req.body?.address?.reference, 150)
    };
    if (deliveryType === "Entrega" && (!address.street || !address.number || !address.district)) {
      throw new Error("Para entrega, informe rua, número e bairro.");
    }

    const payments = ["Pix online", "Cartão de crédito online", "Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito", "Conta da mesa"];
    const payment = payments.find((item) => normalize(item) === normalize(req.body?.payment));
    if (!payment) throw new Error("Escolha uma forma de pagamento.");
    if (payment === "Conta da mesa" && deliveryType !== "Consumir no local") throw new Error("Conta da mesa só pode ser usada no salão.");
    const onlinePayment = payment === "Pix online" || payment === "Cartão de crédito online";
    if (onlinePayment && !PAGARME_ENABLED) throw new Error("Pagamento online temporariamente indisponível.");
    const changeFor = payment === "Dinheiro" && Number(req.body?.changeFor) > 0 ? Number(req.body.changeFor) : null;
    const items = await buildSiteOrderItems(req.body?.items);
    const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const deliveryFee = deliveryType === "Entrega" ? CONFIG.deliveryFee : 0;
    const total = subtotal + deliveryFee;

    const saved = await saveConfirmedOrder({
      source: "site",
      customerName,
      customerPhone,
      deliveryType,
      address: deliveryType === "Entrega" ? address : {},
      location: {},
      items,
      subtotal,
      discount: 0,
      couponCode: "",
      deliveryFee,
      total,
      payment,
      changeFor,
      pickupName: deliveryType === "Retirada" ? customerName : "",
      tableNumber: deliveryType === "Consumir no local" ? String(tableNumber) : "",
      tabCode: deliveryType === "Consumir no local" ? cleanSiteText(req.body?.tabCode, 30).toUpperCase() : "",
      commandName: deliveryType === "Consumir no local" ? (cleanSiteText(req.body?.commandName, 80) || customerName) : "",
      waiterName: deliveryType === "Consumir no local" ? cleanSiteText(req.body?.waiterName, 80) : "",
      reservationNumber: null,
      scheduledFor: null,
      paymentReceiptId: "",
      paymentReceiptType: "",
      paymentProvider: onlinePayment ? "pagarme" : "local",
      paymentStatus: onlinePayment ? "pending" : "local",
      paymentLinkId: "",
      paymentLinkUrl: "",
      paymentExternalId: "",
      marketingConsent: Boolean(req.body?.marketingConsent),
      abandonedCartToken: sanitizeCartToken(req.body?.abandonedCartToken),
      status: onlinePayment ? "Aguardando pagamento" : "Novo"
    });

    if (onlinePayment) {
      try {
        const link = await createPagarmePaymentLink(saved);
        const pending = await updateOrderPaymentState(saved.number, { paymentStatus: "pending", paymentLinkId: link.id, paymentLinkUrl: link.url });
        return res.status(201).json({ ok: true, orderNumber: saved.number, total: saved.total, status: pending?.status || saved.status, paymentStatus: "pending", paymentUrl: link.url, paymentLinkId: link.id, testMode: PAGARME_TEST_MODE });
      } catch (paymentError) {
        await updateOrderPaymentState(saved.number, { status: "Pagamento recusado", paymentStatus: "link_error" }).catch(() => null);
        throw paymentError;
      }
    }

    await markAbandonedCartConverted(req.body?.abandonedCartToken, saved.number).catch(() => null);
    if (req.body?.marketingConsent && META_CAPI_ENABLED) {
      const meta = req.body?.meta || {};
      await sendMetaCapiEvent({
        req,eventName:"Purchase",eventId:cleanSiteText(meta.eventId,100)||`Purchase_order_${saved.number}`,
        eventSourceUrl:cleanSiteText(meta.eventSourceUrl,2048)||`${PUBLIC_BASE_URL}/comprar`,
        phone:customerPhone,customerName,browserId:cleanSiteText(meta.browserId,120),fbp:cleanSiteText(meta.fbp,255),fbc:cleanSiteText(meta.fbc,255),
        customData:{currency:"BRL",value:Number(saved.total||total),num_items:items.reduce((sum,item)=>sum+Number(item.qty||0),0),content_name:"Pedido confirmado MR Pizzaria",content_type:"product",content_ids:items.map((item)=>item.name).filter(Boolean),contents:items.map((item)=>({id:item.name,quantity:Number(item.qty||1),item_price:Number(item.unitPrice||0)})),order_id:String(saved.number),delivery_category:deliveryType}
      }).catch(()=>null);
    }
    res.status(201).json({ ok: true, orderNumber: saved.number, total: saved.total, status: saved.status, tabCode: saved.tabCode || "" });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível registrar o pedido." });
  }
});


app.get("/", (_req, res) => res.status(200).send("Webhook da MR Pizzaria está online — versão 6.4.4."));

app.get("/api/site/orders/:number/payment-status", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const orderNumber = Number(req.params.number);
    const paymentLinkId = cleanSiteText(req.query?.link, 180);
    if (!Number.isInteger(orderNumber) || orderNumber < 1 || !paymentLinkId) return res.status(400).json({ error: "invalid_request" });
    const order = await getOrderByNumber(orderNumber);
    if (!order || order.paymentProvider !== "pagarme" || !order.paymentLinkId || order.paymentLinkId !== paymentLinkId) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, orderNumber: order.number, paymentStatus: order.paymentStatus || "pending", status: order.status || "Aguardando pagamento", total: Number(order.total || 0) });
  } catch (error) {
    return res.status(500).json({ error: "status_error" });
  }
});

app.get("/api/site/orders/:number/payment-events", async (req, res) => {
  try {
    const orderNumber = Number(req.params.number);
    const paymentLinkId = cleanSiteText(req.query?.link, 180);
    if (!Number.isInteger(orderNumber) || orderNumber < 1 || !paymentLinkId) return res.status(400).end();
    const order = await getOrderByNumber(orderNumber);
    if (!order || order.paymentProvider !== "pagarme" || !order.paymentLinkId || order.paymentLinkId !== paymentLinkId) return res.status(404).end();
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    const remove = addPaymentStatusStream(order, res);
    const heartbeat = setInterval(() => { try { res.write(": keepalive\n\n"); } catch (_) {} }, 20000);
    req.on("close", () => { clearInterval(heartbeat); remove(); });
  } catch (_) {
    if (!res.headersSent) res.status(500).end(); else res.end();
  }
});

app.get("/health", async (_req, res) => {
  try {
    const [orders, reservations, requests] = await Promise.all([listOrders({ limit: 1000 }), listReservations({ limit: 1000 }), listServiceRequests({ limit: 1000 })]);
    res.json({ ok: true, version: "6.4.4", testMode: TEST_MODE, storage: storageMode(), sessions: sessions.size, orders: orders.length, reservations: reservations.length, serviceRequests: requests.length, pagarme: { enabled: PAGARME_ENABLED, environment: PAGARME_TEST_MODE ? "test" : "production", webhookProtected: Boolean(PAGARME_WEBHOOK_TOKEN) } });
  } catch (error) {
    res.status(500).json({ ok: false, storage: storageMode(), error: error.message });
  }
});

app.get("/privacy", (_req, res) => {
  res.status(200).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Política de Privacidade — MR Pizzaria</title><style>body{font-family:Arial,sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:32px 20px;color:#252525}h1,h2{color:#8f171b}.box{background:#f7f3ee;border:1px solid #e4d8ca;border-radius:10px;padding:16px}</style></head><body><h1>Política de Privacidade</h1><p>MR Pizzaria — atualização: 14 de agosto de 2026.</p><div class="box"><b>Endereço:</b> Av. Paraná, 897, Centro, Loanda — Paraná<br><b>Contato:</b> WhatsApp (44) 3425-2285</div><h2>Dados tratados</h2><p>Podemos tratar nome, telefone, mensagens, endereço, localização compartilhada, itens e observações do pedido, forma de pagamento, indicação de comprovante, informações de agendamento, número da mesa para consumo no local, reservas de mesa, solicitações de atendimento e, quando autorizado, eventos de navegação e conversão do site para medição de anúncios com o Meta Pixel. Se o cliente optar pela recuperação de carrinho, também guardamos temporariamente o telefone e os itens não finalizados para permitir um lembrete pelo WhatsApp.</p><h2>Finalidades</h2><p>Os dados são usados para montar e acompanhar pedidos, realizar entrega ou retirada, organizar reservas, prestar atendimento, operar o painel e a impressão, medir campanhas de Facebook e Instagram quando houver consentimento para marketing, recuperar carrinhos somente quando o cliente solicitar esse lembrete, prevenir erros e cumprir obrigações legais.</p><h2>Compartilhamento e segurança</h2><p>Os dados podem ser processados por fornecedores necessários ao serviço, como WhatsApp/Meta, Pagar.me/Stone para pagamentos online e hospedagem. Quando o cliente escolhe pagamento online, os dados financeiros sensíveis do cartão são preenchidos diretamente no checkout hospedado pelo Pagar.me; a MR Pizzaria não armazena o número completo do cartão nem o CVV. Não vendemos dados pessoais. Limitamos o acesso e adotamos medidas razoáveis de segurança.</p><h2>Direitos e exclusão</h2><p>Para solicitar acesso, correção ou exclusão, envie “Privacidade de dados” ao WhatsApp (44) 3425-2285. Mais instruções em <a href="/data-deletion">/data-deletion</a>.</p></body></html>`);
});

app.get("/data-deletion", (_req, res) => {
  res.status(200).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exclusão de Dados — MR Pizzaria</title><style>body{font-family:Arial,sans-serif;line-height:1.6;max-width:800px;margin:0 auto;padding:32px 20px;color:#252525}h1{color:#8f171b}.box{background:#f7f3ee;border:1px solid #e4d8ca;border-radius:10px;padding:16px}</style></head><body><h1>Solicitação de exclusão de dados</h1><div class="box"><ol><li>Envie uma mensagem para o WhatsApp <b>(44) 3425-2285</b>.</li><li>Escreva: <b>Solicitação de exclusão de dados</b>.</li><li>Informe o telefone usado no atendimento.</li><li>Aguarde a confirmação de identidade e conclusão.</li></ol></div><p>Alguns dados poderão ser conservados quando necessários para obrigação legal ou exercício regular de direitos.</p></body></html>`);
});

app.get("/promocao/imagem", async (_req, res) => {
  try {
    const promotion = await getPromotion({ includeImage: true });
    if (!promotion.hasImage || !promotion.imageData) return res.sendStatus(404);
    res.setHeader("Content-Type", promotion.imageMime || "application/octet-stream");
    res.setHeader("Content-Length", promotion.imageData.length);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(promotion.imageData);
  } catch (error) {
    console.error("Erro ao carregar imagem da promoção:", error);
    res.sendStatus(500);
  }
});

app.get("/combo/:id/imagem", async (req,res)=>{try{const c=await getFeaturedCombo(req.params.id,{includeImage:true});if(!c||!c.hasImage||!c.imageData)return res.sendStatus(404);res.setHeader("Content-Type",c.imageMime||"application/octet-stream");res.setHeader("Content-Length",c.imageData.length);res.setHeader("Cache-Control","public, max-age=3600");res.send(c.imageData)}catch(e){console.error("Erro na foto do combo:",e);res.sendStatus(500)}});

app.get("/admin/login", (req, res) => {
  if (isAdminRequest(req)) return res.redirect("/admin");
  res.send(renderAdminLogin());
});

app.post("/admin/login", (req, res) => {
  if (!ADMIN_KEY || req.body.key !== ADMIN_KEY) return res.status(401).send(renderAdminLogin("Senha incorreta."));
  res.setHeader("Set-Cookie", `mr_admin=${adminCookieValue()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
  return res.redirect("/admin");
});

app.get("/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "mr_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  res.redirect("/admin/login");
});

app.get("/admin", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    const [orders, reservations, requests] = await Promise.all([
      listOrders({ limit: 250, status: String(req.query.status || "") }),
      listReservations({ limit: 1000, status: "Pendente" }),
      listServiceRequests({ limit: 1000, status: "Pendente" })
    ]);
    res.send(renderOrdersPage(orders, reservations.length, requests.length, String(req.query.ok || ""), String(req.query.error || "")));
  } catch (error) {
    console.error("Erro ao abrir painel:", error);
    res.status(500).send("Erro ao carregar os pedidos.");
  }
});


app.get("/admin/mesas", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    const [tabs, orders] = await Promise.all([listTableTabs({ includeClosed: false }), listOrders({ limit: 1000 })]);
    res.send(renderTablesPage(tabs, orders));
  } catch (error) {
    res.status(500).send(safeHtml(error.message));
  }
});

app.get("/admin/mesas/:number", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  const tableNumber = normalizeTableNumber(req.params.number);
  if (!tableNumber) return res.status(404).send("Mesa inválida.");
  try {
    const [tabs, orders, staff] = await Promise.all([listTableTabs({ includeClosed: true, tableNumber }), listOrders({ limit: 1000 }), listStaff()]);
    res.send(renderTableDetailPage(tableNumber, tabs, orders, staff, req.query.ok || "", req.query.error || ""));
  } catch (error) {
    res.status(500).send(safeHtml(error.message));
  }
});

app.post("/admin/mesas/:number/comandas", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  const tableNumber = normalizeTableNumber(req.params.number);
  if (!tableNumber) return res.status(400).send("Mesa inválida.");
  try {
    const tab = await createTableTab({ tableNumber, customerName: req.body.customerName, waiterName: req.body.waiterName, people: req.body.people });
    res.redirect(`/admin/mesas/${tableNumber}?ok=${encodeURIComponent(`Comanda ${tab.tabCode} aberta.`)}`);
  } catch (error) {
    res.redirect(`/admin/mesas/${tableNumber}?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/admin/comandas/:code/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const tab = await updateTableTabStatus(req.params.code, req.body.status);
    if (!tab) return res.status(404).send("Comanda não encontrada.");
    res.redirect(`/admin/mesas/${tab.tableNumber}?ok=${encodeURIComponent(`Comanda ${tab.tabCode}: ${tab.status}.`)}`);
  } catch (error) {
    res.status(400).send(safeHtml(error.message));
  }
});

app.get("/admin/comandas/:code/print", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  const tab = await getTableTab(req.params.code);
  if (!tab) return res.status(404).send("Comanda não encontrada.");
  const orders = await listOrdersByTab(tab.tabCode);
  res.send(renderCommandPrintPage(tab, orders));
});

app.get("/admin/equipe", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    res.send(renderStaffPage(await listStaff(), req.query.ok || "", req.query.error || ""));
  } catch (error) {
    res.status(500).send(safeHtml(error.message));
  }
});

app.post("/admin/equipe", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const staff = await createStaff({ name: req.body.name, role: req.body.role, pin: req.body.pin });
    res.redirect(`/admin/equipe?ok=${encodeURIComponent(`${staff.name} cadastrado.`)}`);
  } catch (error) {
    res.redirect(`/admin/equipe?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/admin/equipe/:id/toggle", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const staff = await toggleStaff(req.params.id);
    if (!staff) return res.status(404).send("Funcionário não encontrado.");
    res.redirect("/admin/equipe");
  } catch (error) {
    res.status(400).send(safeHtml(error.message));
  }
});

app.get("/admin/reservas", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    res.send(renderReservationsPage(await listReservations({ limit: 500, status: String(req.query.status || "") })));
  } catch (error) {
    console.error("Erro ao abrir reservas:", error);
    res.status(500).send("Erro ao carregar as reservas.");
  }
});

app.get("/admin/atendimentos", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    res.send(renderServicePage(await listServiceRequests({ limit: 500, status: String(req.query.status || "") })));
  } catch (error) {
    console.error("Erro ao abrir atendimentos:", error);
    res.status(500).send("Erro ao carregar os atendimentos.");
  }
});

app.get("/admin/promocao", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    const promotion = await getPromotion();
    res.send(renderPromotionPage(promotion, String(req.query.ok || "")));
  } catch (error) {
    console.error("Erro ao abrir promoção:", error);
    res.status(500).send("Erro ao carregar a promoção.");
  }
});

app.post("/admin/promocao", (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  promotionUpload.single("image")(req, res, async (uploadError) => {
    try {
      if (uploadError) throw uploadError;
      await savePromotion({
        text: req.body.text,
        active: req.body.active === "1",
        file: req.file || null,
        removeImage: req.body.removeImage === "1"
      });
      res.redirect("/admin/promocao?ok=" + encodeURIComponent("Promoção salva com sucesso."));
    } catch (error) {
      console.error("Erro ao salvar promoção:", error);
      const current = await getPromotion().catch(() => ({
        text: req.body?.text || "",
        active: req.body?.active === "1",
        hasImage: false,
        imageName: "",
        updatedAt: new Date().toISOString()
      }));
      res.status(400).send(renderPromotionPage({
        ...current,
        text: req.body?.text ?? current.text,
        active: req.body?.active === "1"
      }, "", error.message));
    }
  });
});

app.get("/admin/recuperacao", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    const carts = await listAbandonedCarts({ limit: 500, includeClosed: req.query.all === "1" });
    res.send(renderRecoveryPage(carts, String(req.query.ok || "")));
  } catch (error) {
    res.status(500).send("Erro ao carregar carrinhos para recuperação.");
  }
});

app.post("/admin/recuperacao/:id/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const updated = await updateAbandonedCartStatus(req.params.id, String(req.body.status || ""));
    if (!updated) return res.status(404).send("Carrinho não encontrado.");
    res.redirect("/admin/recuperacao?ok=" + encodeURIComponent(`Carrinho marcado como ${updated.status}.`));
  } catch (error) {
    res.status(400).send(safeHtml(error.message));
  }
});

app.get("/admin/relatorios",async(req,res)=>{if(!isAdminRequest(req))return res.redirect("/admin/login");try{const range=reportRange(req.query||{}),orders=await listOrdersForReport(range);res.send(renderSalesReportPage(orders,range,String(req.query.ok||""),String(req.query.error||"")))}catch(e){console.error(e);res.status(500).send("Erro ao gerar relatório de vendas.")}});
app.post("/admin/test/reset-sales",async(req,res)=>{if(!isAdminRequest(req))return res.status(401).send("Acesso não autorizado.");if(!TEST_MODE)return res.status(403).send("Limpeza disponível apenas em TEST_MODE=true.");if(String(req.body.confirm||"").trim().toUpperCase()!=="ZERAR VENDAS")return res.redirect("/admin/relatorios?error="+encodeURIComponent("Digite ZERAR VENDAS para confirmar."));try{await resetTestSales();res.redirect("/admin/relatorios?ok="+encodeURIComponent("Vendas de teste zeradas com sucesso."))}catch(e){res.redirect("/admin/relatorios?error="+encodeURIComponent(e.message))}});

app.get("/admin/combos", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  try {
    const combos = await listFeaturedCombos({ includeInactive: true });
    res.send(renderFeaturedCombosPage(combos, String(req.query.ok || ""), String(req.query.error || "")));
  } catch (error) {
    res.status(500).send("Erro ao carregar os combos.");
  }
});

app.post("/admin/combos",(req,res)=>{if(!isAdminRequest(req))return res.status(401).send("Acesso não autorizado.");comboUpload.single("image")(req,res,async e=>{try{if(e)throw e;await createFeaturedCombo({name:req.body.name,description:req.body.description,price:req.body.price,active:req.body.active==="1",sortOrder:req.body.sortOrder,file:req.file||null});res.redirect("/admin/combos?ok="+encodeURIComponent("Combo adicionado com sucesso."))}catch(error){const combos=await listFeaturedCombos({includeInactive:true}).catch(()=>[]);res.status(400).send(renderFeaturedCombosPage(combos,"",error.message))}})});

app.post("/admin/combos/:id",(req,res)=>{if(!isAdminRequest(req))return res.status(401).send("Acesso não autorizado.");comboUpload.single("image")(req,res,async e=>{try{if(e)throw e;const updated=await updateFeaturedCombo(req.params.id,{name:req.body.name,description:req.body.description,price:req.body.price,active:req.body.active==="1",sortOrder:req.body.sortOrder,file:req.file||null,removeImage:req.body.removeImage==="1"});if(!updated)return res.status(404).send("Combo não encontrado.");res.redirect("/admin/combos?ok="+encodeURIComponent("Combo atualizado."))}catch(error){res.redirect("/admin/combos?error="+encodeURIComponent(error.message))}})});

app.post("/admin/combos/:id/delete", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    await deleteFeaturedCombo(req.params.id);
    res.redirect("/admin/combos?ok=" + encodeURIComponent("Combo excluído."));
  } catch (error) {
    res.redirect("/admin/combos?error=" + encodeURIComponent(error.message));
  }
});

app.post("/admin/orders/:number/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const current = await getOrderByNumber(req.params.number);
    if (!current) return res.status(404).send("Pedido não encontrado.");
    if (current.paymentProvider === "pagarme" && current.paymentStatus !== "paid" && req.body.status !== "Cancelado") {
      throw new Error("Este pedido online ainda não foi pago. Aguarde a confirmação automática do Pagar.me.");
    }
    const updated = await updateOrderStatus(req.params.number, req.body.status);
    if (!updated) return res.status(404).send("Pedido não encontrado.");
    const result = await sendOrderStatusNotification(updated);
    const message = result.sent
      ? `Pedido nº ${updated.number}: status alterado para ${updated.status} e WhatsApp enviado${result.mode === "template" ? " por template" : ""}.`
      : `Pedido nº ${updated.number}: status alterado para ${updated.status}, mas a mensagem do WhatsApp não foi entregue (${result.reason || "erro de envio"}).`;
    res.redirect(`/admin?${result.sent ? "ok" : "error"}=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(`/admin?error=${encodeURIComponent(error.message || "Erro ao atualizar pedido.")}`);
  }
});

app.post("/admin/reservas/:number/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const updated = await updateReservationStatus(req.params.number, req.body.status);
    if (!updated) return res.status(404).send("Reserva não encontrada.");
    const notification = reservationStatusNotification(updated);
    if (notification && /^\d{10,15}$/.test(String(updated.customerPhone || ""))) await sendText(updated.customerPhone, notification);
    res.redirect("/admin/reservas");
  } catch (error) {
    res.status(400).send(safeHtml(error.message));
  }
});

app.post("/admin/atendimentos/:id/status", async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).send("Acesso não autorizado.");
  try {
    const updated = await updateServiceRequestStatus(req.params.id, req.body.status);
    if (!updated) return res.status(404).send("Atendimento não encontrado.");
    res.redirect("/admin/atendimentos");
  } catch (error) {
    res.status(400).send(safeHtml(error.message));
  }
});

app.get("/admin/orders/:number/print", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  const type = ["pizza", "kitchen", "all"].includes(req.query.type) ? req.query.type : "all";
  const order = await getOrderByNumber(req.params.number);
  if (!order) return res.status(404).send("Pedido não encontrado.");
  if (order.paymentProvider === "pagarme" && order.paymentStatus !== "paid") return res.status(409).send("Pedido online aguardando pagamento. A impressão será liberada após a confirmação do Pagar.me.");
  if (!printableItems(order, type).length) return res.status(400).send("Não há itens para esta comanda.");
  if (type === "pizza" || type === "kitchen") await markOrderPrinted(order.number, type);
  res.send(renderPrintPage(order, type));
});

app.get("/admin/export.json", async (req, res) => {
  if (!isAdminRequest(req)) return res.redirect("/admin/login");
  const [orders, reservations, serviceRequests, promotion, tableTabs, staff, featuredCombos] = await Promise.all([listOrders({ limit: 1000 }), listReservations({ limit: 1000 }), listServiceRequests({ limit: 1000 }), getPromotion(), listTableTabs({ includeClosed: true }), listStaff(), listFeaturedCombos({ includeInactive: true })]);
  res.setHeader("Content-Disposition", `attachment; filename=backup-mr-${new Date().toISOString().slice(0, 10)}.json`);
  res.json({ exportedAt: new Date().toISOString(), orders, reservations, serviceRequests, promotion, tableTabs, staff, featuredCombos });
});

app.get("/api/orders", async (req, res) => {
  if (!isApiRequestAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
  res.json({ storage: storageMode(), orders: await listOrders({ limit: req.query.limit || 200, status: String(req.query.status || "") }) });
});

app.get("/api/print-queue", async (req, res) => {
  if (!isApiRequestAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
  const orders = await listOrders({ limit: 500 });
  const jobs = [];
  const printUntil = Date.now() + SCHEDULE_PRINT_LEAD_MINUTES * 60 * 1000;
  for (const order of orders) {
    if (["Finalizado", "Cancelado", "Pagamento recusado"].includes(order.status)) continue;
    if (order.paymentProvider === "pagarme" && order.paymentStatus !== "paid") continue;
    if (order.scheduledFor && new Date(order.scheduledFor).getTime() > printUntil) continue;
    if (orderHasPizza(order) && !order.pizzaPrintedAt) jobs.push({ type: "pizza", order });
    if (orderHasKitchen(order) && !order.kitchenPrintedAt) jobs.push({ type: "kitchen", order });
  }
  res.json({ leadMinutes: SCHEDULE_PRINT_LEAD_MINUTES, jobs });
});

app.post("/api/orders/:number/printed", async (req, res) => {
  if (!isApiRequestAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const order = await markOrderPrinted(req.params.number, req.body.type);
    if (!order) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, order });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


app.post("/webhooks/pagarme", async (req, res) => {
  try {
    if (!PAGARME_WEBHOOK_TOKEN) {
      console.error("Pagar.me webhook recusado: PAGARME_WEBHOOK_TOKEN não configurado.");
      return res.status(503).json({ error: "webhook_not_configured" });
    }
    if (String(req.query.token || "") !== PAGARME_WEBHOOK_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const type = String(req.body?.type || "");
    const data = req.body?.data || {};
    let orderNumber = pagarmeOrderNumberFromWebhook(data);
    let current = orderNumber ? await getOrderByNumber(orderNumber) : null;
    if (!current) {
      const paymentLinkId = pagarmePaymentLinkIdFromWebhook(data);
      if (paymentLinkId) {
        current = await getOrderByPagarmePaymentLinkId(paymentLinkId);
        if (current) orderNumber = current.number;
      }
    }
    console.log("Pagar.me webhook:", { type, orderNumber, externalId: data?.id || "" });
    if (!orderNumber || !current) return res.status(200).json({ ok: true, ignored: "order_not_correlated" });
    if (current.paymentProvider !== "pagarme") return res.status(200).json({ ok: true, ignored: "order_not_found" });

    if (type === "order.paid" || type === "charge.paid") {
      if (current.paymentStatus === "paid") return res.status(200).json({ ok: true, duplicate: true });
      const paid = await updateOrderPaymentState(orderNumber, { status: "Novo", paymentStatus: "paid", paymentExternalId: data?.id || current.paymentExternalId || "" });
      if (paid?.abandonedCartToken) await markAbandonedCartConverted(paid.abandonedCartToken, paid.number).catch(() => null);
      if (!PAGARME_TEST_MODE && paid?.marketingConsent && META_CAPI_ENABLED) {
        await sendMetaCapiEvent({
          eventName: "Purchase", eventId: `Purchase_order_${paid.number}`, eventSourceUrl: `${PUBLIC_BASE_URL}/comprar`,
          phone: paid.customerPhone, customerName: paid.customerName,
          customData: { currency: "BRL", value: Number(paid.total || 0), num_items: (paid.items || []).reduce((sum,item)=>sum+Number(item.qty||0),0), content_name: "Pedido pago MR Pizzaria", content_type: "product", content_ids: (paid.items || []).map((item)=>item.name).filter(Boolean), contents: (paid.items || []).map((item)=>({id:item.name,quantity:Number(item.qty||1),item_price:Number(item.unit||0)})), order_id: String(paid.number), delivery_category: paid.deliveryType }
        }).catch(() => null);
      }
      await notifyPaymentResult(paid, `✅ Pagamento do pedido nº ${paid.number} aprovado. Seu pedido foi recebido pela MR Pizzaria.`).catch(() => null);
      return res.status(200).json({ ok: true, orderNumber, paymentStatus: "paid" });
    }

    if (type === "order.payment_failed" || type === "charge.payment_failed") {
      const failed = await updateOrderPaymentState(orderNumber, { status: "Pagamento recusado", paymentStatus: "failed", paymentExternalId: data?.id || current.paymentExternalId || "" });
      await notifyPaymentResult(failed || current, `❌ O pagamento do pedido nº ${orderNumber} não foi aprovado. Você pode tentar novamente pelo site ou escolher pagamento no local.`).catch(() => null);
      return res.status(200).json({ ok: true, orderNumber, paymentStatus: "failed" });
    }

    if (type === "order.canceled" || type === "checkout.canceled") {
      await updateOrderPaymentState(orderNumber, { status: "Cancelado", paymentStatus: "canceled", paymentExternalId: data?.id || current.paymentExternalId || "" });
      return res.status(200).json({ ok: true, orderNumber, paymentStatus: "canceled" });
    }

    if (type === "charge.refunded") {
      const refunded = await updateOrderPaymentState(orderNumber, { status: "Cancelado", paymentStatus: "refunded", paymentExternalId: data?.id || current.paymentExternalId || "" });
      await notifyPaymentResult(refunded || current, `↩️ O pagamento do pedido nº ${orderNumber} foi estornado.`).catch(() => null);
      return res.status(200).json({ ok: true, orderNumber, paymentStatus: "refunded" });
    }

    return res.status(200).json({ ok: true, ignored: type || "unknown" });
  } catch (error) {
    console.error("Pagar.me webhook erro:", error);
    return res.status(500).json({ error: "webhook_error" });
  }
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!VERIFY_TOKEN) return res.sendStatus(500);
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  void (async () => {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          for (const status of value.statuses || []) {
            const errors = Array.isArray(status.errors) ? status.errors : [];
            if (status.status === "failed" || errors.length) {
              console.error("Falha de entrega informada pela Meta:", {
                messageId: status.id,
                recipientId: status.recipient_id,
                status: status.status,
                errors
              });
            } else {
              console.log("Status de mensagem:", {
                messageId: status.id,
                recipientId: status.recipient_id,
                status: status.status
              });
            }
          }
          const contacts = value.contacts || [];
          for (const message of value.messages || []) {
            if (!message.id || processedMessages.has(message.id)) continue;
            processedMessages.add(message.id);
            if (processedMessages.size > 5000) processedMessages.clear();
            const rawFrom = String(message.from || "").replace(/\D/g, "");
            const replyTo = normalizeRecipientNumber(rawFrom);
            const contact = contacts.find((item) => item.wa_id === rawFrom || normalizeRecipientNumber(item.wa_id) === replyTo);
            const customerName = contact?.profile?.name || "cliente";
            const session = getSession(replyTo, customerName);
            console.log("Nova mensagem recebida:", { customerName, from: rawFrom, replyTo, messageId: message.id, type: message.type });
            await processIncomingMessage(session, message);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
    }
  })();
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, session] of sessions.entries()) if (session.updatedAt < cutoff) sessions.delete(id);
}, 30 * 60 * 1000).unref();

async function startServer() {
  try {
    await initializeDatabase();
  } catch (error) {
    databaseReady = false;
    console.error("Falha ao preparar o banco de dados:", error);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor iniciado na porta ${PORT}.`);
    console.log(`TEST_MODE=${TEST_MODE}`);
    console.log(`STORAGE=${storageMode()}`);
    console.log("VERSAO=6.3.6");
  });
}

startServer().catch((error) => {
  console.error("Falha fatal ao iniciar servidor:", error);
  process.exit(1);
});
