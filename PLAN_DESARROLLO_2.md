# Plan de Desarrollo 2 — monitor_sd (Productivización + Funcionalidad completa)

**Proyecto:** `monitor_sd`
**Fecha:** 2026-04-26
**Prerequisito:** Plan 1 completado — 29 tests verdes, FE 3 niveles validado con playwright-praman

---

## Principios de organización

Este plan resuelve las deudas técnicas del MVP y añade funcionalidad de posiciones y anexos.
Las fases están ordenadas para **minimizar retrabajo**: cada fase produce una base que las siguientes aprovechan sin necesidad de reabrir los mismos archivos.

```
Fase 1  →  Infraestructura de handlers      (runRemote + paginación + caché)
Fase 2  →  Modelo CDS completo              (todos los cambios al .cds en un solo paso)
Fase 3  →  Handlers de lectura completos    (nuevos + enriquecidos, sobre la infra de F1)
Fase 4  →  Acciones de escritura + seguridad
Fase 5  →  UI: anotaciones FE en un solo paso
Fase 6  →  Gestión de anexos               (independiente — nueva persistencia local)
```

### Mapa de dependencias

```
Fase 1 ──────────────────────────────────────────────────────────────► Fase 3
         \                                                              /
          └──── Fase 2 (modelo) ──────────────────────────────────────┘
                                  \
                                   └──── Fase 4 ──── Fase 5
                                                          \
                                   Fase 6 ────────────────► (independiente, entra tras F2)
```

### Por qué este orden evita retrabajo

| Riesgo | Si se ignora |
|---|---|
| Fase 2 (errores) antes que F3 y F4 | Los handlers de posiciones (F3) y acciones (F4) deben usar `runRemote`. Sin él, habría que reescribirlos al añadirlo después. |
| Paginación (F1) antes que F3 | Los 3 nuevos handlers de posiciones ya incluyen `sel.limit?.rows?.val`. Sin la infra de paginación, ese código no funciona. |
| Modelo CDS en un solo paso (F2) | `monitor-sd-service.cds` lo tocan: DocFlow, posiciones, bloqueos, retraso, estado entrega/factura, xs-security. Si se hace en 7 pasadas, hay 6 reaperturas del mismo archivo y pruebas de compilación redundantes. |
| Anotaciones FE al final (F5) | `annotations.cds` lo tocan F3, F4, bloqueos, retraso, posiciones, Excel. Si se hace incremental, cada cambio puede romper la UI anterior. Mejor hacer todo una vez, con el modelo definitivo ya compilado. |
| Mejora K (posiciones) no es opcional | Es funcionalidad core que el usuario necesita. Integrarla en F2 y F3 elimina aperturas extra de los mismos archivos. |

---

## Fase 1 — Infraestructura de Handlers

**Objetivo:** establecer los patrones de código que todos los handlers posteriores usarán. Nada de esto es visible para el usuario; todo reduce retrabajo en las fases siguientes.

**Archivos creados/modificados:**
- `srv/lib/remote-error.js` ← nuevo
- `srv/lib/ttl-cache.js` ← nuevo
- `srv/monitor-sd-service.js` ← refactor de los 3 handlers existentes
- `package.json` ← paginación configurable
- `.cdsrc.json` ← timeouts de producción

### 1.1 Manejo centralizado de errores S/4

Crear `srv/lib/remote-error.js`:

```javascript
'use strict';

async function runRemote(req, remoteSvc, query, context = '') {
  try {
    return await remoteSvc.run(query);
  } catch (err) {
    const isTimeout    = err.message?.includes('timeout') || err.code === 'ECONNABORTED';
    const isUnreachable = ['ECONNREFUSED', 'ENOTFOUND'].includes(err.code);
    const status = err.status ?? 503;
    const ctx = context ? ` (${context})` : '';

    if (isTimeout)     req.reject(504, `S/4HANA no respondió a tiempo${ctx}. Inténtalo de nuevo.`);
    else if (isUnreachable) req.reject(503, `No se puede conectar con S/4HANA${ctx}.`);
    else if (status >= 400 && status < 500) req.reject(status, err.message ?? 'Error en S/4HANA');
    else req.reject(502, `Error inesperado en S/4HANA${ctx}: ${err.message}`);
    // req.reject lanza una excepción internamente; el return es inalcanzable
  }
}

module.exports = { runRemote };
```

Sustituir todos los `await xxxAPI.run(query)` en `srv/monitor-sd-service.js` por `await runRemote(req, xxxAPI, query, 'Contexto')`.

### 1.2 Paginación server-side

Añadir a `srv/monitor-sd-service.cds` (antes del `service`):

```cds
@cds.query.limit.default: 50
@cds.query.limit.max:     500
service MonitorSDService @(path: '/odata/v4/MonitorSDService') { ... }
```

En cada handler READ, añadir el forwarding de límites hacia el servicio externo:

```javascript
// Patrón a aplicar en los 3 handlers existentes y en todos los nuevos de F3
if (sel.limit?.rows?.val) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
if (sel.orderBy)          query.orderBy(sel.orderBy);

// Soporte de $count=true
if (sel.count) {
  const countQ = SELECT.from('<EntityExterna>').columns('count(*) as $count');
  // ... mismo where que la query principal ...
  const [{ $count }] = await runRemote(req, xxxAPI, countQ, 'count');
  result.$count = $count;
}
```

Añadir a `package.json`:
```json
"cds": {
  "query": { "limit": { "reliablePaging": true, "default": 50, "max": 500 } }
}
```

Añadir `requestTimeout: 15000` a cada servicio en `.cdsrc.json` perfil `[production]`.

### 1.3 Caché in-memory con TTL

Crear `srv/lib/ttl-cache.js`:

```javascript
'use strict';

class TtlCache {
  #store = new Map();
  #ttlMs;

  constructor(ttlSeconds = 60) { this.#ttlMs = ttlSeconds * 1000; }

  get(key) {
    const e = this.#store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { this.#store.delete(key); return null; }
    return e.data;
  }

  set(key, data) {
    this.#store.set(key, { data, expiresAt: Date.now() + this.#ttlMs });
  }

  invalidate(key)  { this.#store.delete(key); }
  invalidateAll()  { this.#store.clear(); }
}

module.exports = { TtlCache };
```

Integrar en el handler de SalesOrders (lecturas repetitivas de la misma lista):

```javascript
const { TtlCache } = require('./lib/ttl-cache');
const soCache    = new TtlCache(60);
const delivCache = new TtlCache(30); // más corto — las entregas cambian más

this.on('READ', SalesOrders, async req => {
  const cacheKey = JSON.stringify(req.query.SELECT);
  const cached   = soCache.get(cacheKey);
  if (cached) return cached;
  // ... lógica existente ...
  soCache.set(cacheKey, result);
  return result;
});
```

> **Tradeoff documentado:** caché per-instancia. En despliegue multi-pod (CF con 2+ instancias, Kyma) no se comparte entre pods. Para ese escenario valorar Redis. Con 1–2 instancias CF es suficiente.

### 1.4 Tests de Fase 1

```javascript
it('respeta $top', async () => {
  const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$top=1');
  expect(data.value).toHaveLength(1);
});

it('devuelve @odata.count cuando se solicita', async () => {
  const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$count=true');
  expect(data['@odata.count']).toBeGreaterThanOrEqual(3);
});

it('devuelve 504 si S/4 no responde', async () => {
  jest.spyOn(soAPI, 'run').mockRejectedValueOnce(
    Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
  );
  const res = await GET('/odata/v4/MonitorSDService/SalesOrders').catch(e => e.response);
  expect(res.status).toBe(504);
});
```

**Verificación de cierre:** `npm test` verde, `GET /SalesOrders?$top=1` → 1 registro, `?$count=true` → `@odata.count` presente.

---

## Fase 2 — Modelo CDS Completo

**Objetivo:** hacer todos los cambios a `monitor-sd-service.cds` y `status-mapper.js` en un único paso. Esto incluye enriquecimiento de campos existentes, posiciones de documentos, y la corrección del DocFlow.

> **Regla de esta fase:** solo modelo y mocks. Cero lógica de handler. Cero UI. Si todo compila con `cds build` al final, la fase es correcta.

**Archivos modificados:**
- `srv/monitor-sd-service.cds` ← toda la restructuración
- `srv/lib/status-mapper.js` ← nuevas funciones de texto
- `srv/external/API_SALES_ORDER_SRV.js` ← datos mock de posiciones SO
- `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js` ← datos mock posiciones entrega + nota crédito
- `srv/external/API_BILLING_DOCUMENT_SRV.js` ← datos mock posiciones factura

### 2.1 Campos nuevos en entidades de cabecera (SalesOrders)

Añadir a la proyección `SalesOrders` en `srv/monitor-sd-service.cds`:

```cds
// Campos de estado adicionales (ya en A_SalesOrder — confirmado en CSN)
OverallDeliveryStatus,           // A=Sin entregar B=Parcial C=Completo
OverallOrdReltdBillgStatus,      // A=Sin facturar B=Parcial C=Completo
TotalBlockStatus,                // vacío=sin bloqueo; valor=tipo de bloqueo
DeliveryBlockReason,             // código bloqueo de entrega
HeaderBillingBlockReason,        // código bloqueo de factura
TotalCreditCheckStatus,          // A=OK B=Bloqueado por crédito

// Campos virtuales calculados en handler
virtual OverallDeliveryStatusText      : String,
virtual OverallOrdReltdBillgStatusText : String,
virtual TotalBlockStatusText           : String,
virtual DeliveryDelayDays              : Integer,   // días desde RequestedDeliveryDate
```

Añadir a `BillingDocuments`:
```cds
virtual BillingDocumentCategoryText : String    // Factura / Nota de crédito / Nota de débito / Pro-forma
```

### 2.2 Posiciones de documento — tres entidades nuevas

```cds
// ─── Posiciones de Pedido ────────────────────────────────────────────────
@readonly
entity SalesOrderItems as projection on SalesOrderAPI.A_SalesOrderItem {
  key SalesOrder,
  key SalesOrderItem,
      SalesOrderItemCategory,
      SalesOrderItemText,
      Material,
      MaterialByCustomer,
      RequestedQuantity,
      RequestedQuantityUnit,
      NetAmount,
      TransactionCurrency,
      SDProcessStatus,
      DeliveryStatus,              // A=Sin entrega  B=Parcial  C=Completa
      OrderRelatedBillingStatus,
      ItemBillingBlockReason,
      SalesDocumentRjcnReason,
      HigherLevelItem,
      ReferenceSDDocument,
      ReferenceSDDocumentItem,
      virtual SDProcessStatusText  : String,
      virtual DeliveryStatusText   : String
};

// ─── Posiciones de Entrega ───────────────────────────────────────────────
@readonly
entity DeliveryItems as projection on DeliveryAPI.A_OutbDeliveryItem {
  key DeliveryDocument,
  key DeliveryDocumentItem,
      Material,
      DeliveryDocumentItemText,
      ActualDeliveryQuantity,
      OriginalDeliveryQuantity,
      DeliveryQuantityUnit,
      GoodsMovementStatus,
      PickingStatus,
      PickingConfirmationStatus,
      Batch,
      StorageLocation,
      ItemGrossWeight,
      ItemNetWeight,
      ItemWeightUnit,
      ReferenceSDDocument,         // = SalesOrder de origen
      ReferenceSDDocumentItem,     // = SalesOrderItem de origen
      virtual GoodsMovementStatusText : String,
      virtual PickingStatusText       : String
};

// ─── Posiciones de Factura ───────────────────────────────────────────────
@readonly
entity BillingDocumentItems as projection on BillingAPI.A_BillingDocumentItem {
  key BillingDocument,
  key BillingDocumentItem,
      SalesDocumentItemCategory,
      Material,
      BillingDocumentItemText,
      BillingQuantity,
      BillingQuantityUnit,
      NetAmount,
      TaxAmount,
      GrossAmount,
      TransactionCurrency,
      ReferenceSDDocument,         // = DeliveryDocument de origen
      ReferenceSDDocumentItem      // = DeliveryDocumentItem de origen
};
```

### 2.3 Asociaciones nuevas en cabeceras

Añadir a `SalesOrders`, `Deliveries` y `BillingDocuments` sus nuevas asociaciones:

```cds
// En SalesOrders (junto a la asociación Deliveries existente):
Items : Association to many SalesOrderItems
        on Items.SalesOrder = $self.SalesOrder,

// En Deliveries (junto a la asociación BillingDocuments existente):
Items : Association to many DeliveryItems
        on Items.DeliveryDocument = $self.DeliveryDocument,

// En BillingDocuments (nueva):
Items : Association to many BillingDocumentItems
        on Items.BillingDocument = $self.BillingDocument
```

### 2.4 Nuevas funciones en status-mapper.js

```javascript
// DocFlow: tipo de documento de facturación
const BILLING_DOC_CATEGORY = {
  M: 'Factura', N: 'Nota de crédito', O: 'Nota de débito', P: 'Pro-forma'
};
module.exports.billingCategoryText = code => BILLING_DOC_CATEGORY[code] ?? code;

// Estado de entrega / facturación a nivel cabecera SO (misma tabla A/B/C)
const DELIVERY_STATUS  = { A: 'Sin entregar', B: 'Entrega parcial', C: 'Completamente entregado' };
const BILLING_HDR_STATUS = { A: 'Sin facturar', B: 'Facturación parcial', C: 'Completamente facturado' };
module.exports.deliveryHdrText   = code => DELIVERY_STATUS[code]     ?? code;
module.exports.billingHdrText    = code => BILLING_HDR_STATUS[code]  ?? code;

// Días de retraso (0 si entregado o sin fecha)
module.exports.deliveryDelayDays = (requestedDate, overallDeliveryStatus) => {
  if (overallDeliveryStatus === 'C' || !requestedDate) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(requestedDate).getTime()) / 86_400_000));
};
```

### 2.5 Datos mock para posiciones

Añadir en cada archivo de mock los arrays de posiciones y sus handlers READ:

**`API_SALES_ORDER_SRV.js`** — SO_ITEMS con al menos una posición sin entrega (DeliveryStatus: 'A'):
```javascript
const SO_ITEMS = [
  { SalesOrder: '10000001', SalesOrderItem: '000010', Material: 'MAT-001',
    SalesOrderItemText: 'Producto A', RequestedQuantity: 5, RequestedQuantityUnit: 'PC',
    NetAmount: 10000, TransactionCurrency: 'EUR',
    SDProcessStatus: 'B', DeliveryStatus: 'C', OrderRelatedBillingStatus: 'C',
    ItemBillingBlockReason: '', SalesDocumentRjcnReason: '', HigherLevelItem: '' },
  { SalesOrder: '10000001', SalesOrderItem: '000020', Material: 'MAT-002',
    SalesOrderItemText: 'Producto B', RequestedQuantity: 2, RequestedQuantityUnit: 'PC',
    NetAmount: 5000, TransactionCurrency: 'EUR',
    SDProcessStatus: 'A', DeliveryStatus: 'A',  // <── posición SIN entrega
    OrderRelatedBillingStatus: 'A', ItemBillingBlockReason: '',
    SalesDocumentRjcnReason: '', HigherLevelItem: '' },
  { SalesOrder: '10000002', SalesOrderItem: '000010', Material: 'MAT-003',
    SalesOrderItemText: 'Producto C', RequestedQuantity: 10, RequestedQuantityUnit: 'PC',
    NetAmount: 8500, TransactionCurrency: 'EUR',
    SDProcessStatus: 'C', DeliveryStatus: 'C', OrderRelatedBillingStatus: 'C',
    ItemBillingBlockReason: '', SalesDocumentRjcnReason: '', HigherLevelItem: '' }
];
// Handler: this.on('READ', 'A_SalesOrderItem', req => { ... filtrar por SalesOrder ... });
```

**`OP_API_OUTBOUND_DELIVERY_SRV_0002.js`** — DELIVERY_ITEMS y nota de crédito en DocFlow:
```javascript
const DELIVERY_ITEMS = [
  { DeliveryDocument: '80000001', DeliveryDocumentItem: '000010',
    Material: 'MAT-001', DeliveryDocumentItemText: 'Producto A',
    ActualDeliveryQuantity: 5, OriginalDeliveryQuantity: 5, DeliveryQuantityUnit: 'PC',
    GoodsMovementStatus: 'C', PickingStatus: 'C', PickingConfirmationStatus: 'C',
    Batch: '', StorageLocation: 'SL01', ItemGrossWeight: 25, ItemNetWeight: 22, ItemWeightUnit: 'KG',
    ReferenceSDDocument: '10000001', ReferenceSDDocumentItem: '000010' },
  { DeliveryDocument: '80000003', DeliveryDocumentItem: '000010',
    Material: 'MAT-003', DeliveryDocumentItemText: 'Producto C',
    ActualDeliveryQuantity: 10, OriginalDeliveryQuantity: 10, DeliveryQuantityUnit: 'PC',
    GoodsMovementStatus: 'C', PickingStatus: 'C', PickingConfirmationStatus: 'C',
    Batch: 'B001', StorageLocation: 'SL02', ItemGrossWeight: 50, ItemNetWeight: 45, ItemWeightUnit: 'KG',
    ReferenceSDDocument: '10000002', ReferenceSDDocumentItem: '000010' }
];

// Nota de crédito en DocFlow (para la corrección de Fase 3)
// Añadir en DELIVERY_DOC_FLOW existente:
{ PrecedingDocument: '80000001', PrecedingDocumentItem: '000010',
  SubsequentDocumentCategory: 'N', Subsequentdocument: '90000099', PrecedingDocumentCategory: 'J' }
```

**`API_BILLING_DOCUMENT_SRV.js`** — BILLING_ITEMS y nota de crédito en cabecera:
```javascript
const BILLING_ITEMS = [
  { BillingDocument: '90000001', BillingDocumentItem: '000010', Material: 'MAT-001',
    SalesDocumentItemCategory: 'TAN', BillingDocumentItemText: 'Producto A',
    BillingQuantity: 5, BillingQuantityUnit: 'PC',
    NetAmount: 10000, TaxAmount: 2100, GrossAmount: 12100, TransactionCurrency: 'EUR',
    ReferenceSDDocument: '80000001', ReferenceSDDocumentItem: '000010' },
  { BillingDocument: '90000002', BillingDocumentItem: '000010', Material: 'MAT-003',
    SalesDocumentItemCategory: 'TAN', BillingDocumentItemText: 'Producto C',
    BillingQuantity: 10, BillingQuantityUnit: 'PC',
    NetAmount: 8500, TaxAmount: 1785, GrossAmount: 10285, TransactionCurrency: 'EUR',
    ReferenceSDDocument: '80000003', ReferenceSDDocumentItem: '000010' }
];

// Nota de crédito en BILLING_DOCS (existente):
{ BillingDocument: '90000099', BillingDocumentType: 'G2', BillingDocumentCategory: 'N',
  BillingDocumentDate: '2025-01-25', SalesOrganization: '1010',
  TotalGrossAmount: -2000, TransactionCurrency: 'EUR',
  AccountingDocument: null, OverallBillingStatus: 'C', BillingDocumentIsCancelled: false }
```

### 2.6 Verificación de cierre de Fase 2

```bash
cds build   # debe completar sin errores
```

Ningún test de comportamiento en esta fase — los mocks todavía no están conectados a los handlers nuevos. Eso es trabajo de Fase 3.

---

## Fase 3 — Handlers de Lectura Completos

**Objetivo:** implementar toda la lógica de lectura sobre la infraestructura de Fase 1 y el modelo de Fase 2. Al final de esta fase, todos los endpoints GET funcionan y los tests pasan.

**Archivos modificados:**
- `srv/monitor-sd-service.js` ← único archivo de handlers

### 3.1 Fix DocFlow — categorías de facturación completas

En el handler de `BillingDocuments`, cambiar el filtro de DocFlow:

```javascript
// ANTES: solo facturas estándar
.where({ PrecedingDocument: delivRef, SubsequentDocumentCategory: 'M' })

// DESPUÉS: facturas + notas de crédito/débito + pro-forma
.where({ PrecedingDocument: delivRef,
         SubsequentDocumentCategory: { in: ['M', 'N', 'O', 'P'] } })
```

Añadir `BillingDocumentCategoryText` en el map final:
```javascript
return bills.map(b => ({
  ...b,
  DeliveryRef:                delivRef ?? null,
  OverallBillingStatusText:   billingText(b.OverallBillingStatus),
  BillingDocumentCategoryText: billingCategoryText(b.BillingDocumentCategory)
}));
```

### 3.2 Enriquecimiento del handler SalesOrders

```javascript
const { sdProcessText, goodsMovementText, billingHdrText,
        deliveryHdrText, deliveryDelayDays } = require('./lib/status-mapper');

this.on('READ', SalesOrders, async req => {
  // ... construcción de query existente con runRemote + paginación ...
  return orders.map(o => ({
    ...o,
    OverallSDProcessStatusText:      sdProcessText(o.OverallSDProcessStatus),
    OverallDeliveryStatusText:       deliveryHdrText(o.OverallDeliveryStatus),
    OverallOrdReltdBillgStatusText:  billingHdrText(o.OverallOrdReltdBillgStatus),
    TotalBlockStatusText:            o.TotalBlockStatus ? `Bloqueado (${o.TotalBlockStatus})` : '',
    DeliveryDelayDays:               deliveryDelayDays(o.RequestedDeliveryDate, o.OverallDeliveryStatus)
  }));
});
```

### 3.3 Handlers de posiciones — los tres nuevos

```javascript
const { SalesOrderItems, DeliveryItems, BillingDocumentItems } = this.entities;

// ── READ SalesOrderItems ──────────────────────────────────────────────────
this.on('READ', SalesOrderItems, async req => {
  const sel   = req.query.SELECT;
  const soKey = getFilter(sel, 'SalesOrder') ?? getNavParentKey(sel, 'SalesOrder');

  const query = SELECT.from('API_SALES_ORDER_SRV.A_SalesOrderItem');
  if (soKey) query.where({ SalesOrder: soKey });
  if (sel.limit?.rows?.val) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);

  const items = await runRemote(req, soAPI, query, 'Posiciones Pedido');
  if (!items) return;
  return items.map(i => ({
    ...i,
    SDProcessStatusText: sdProcessText(i.SDProcessStatus),
    DeliveryStatusText:  deliveryHdrText(i.DeliveryStatus)
  }));
});

// ── READ DeliveryItems ────────────────────────────────────────────────────
this.on('READ', DeliveryItems, async req => {
  const sel      = req.query.SELECT;
  const delivKey = getFilter(sel, 'DeliveryDocument') ?? getNavParentKey(sel, 'DeliveryDocument');

  const query = SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryItem');
  if (delivKey) query.where({ DeliveryDocument: delivKey });
  if (sel.limit?.rows?.val) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);

  const items = await runRemote(req, deliveryAPI, query, 'Posiciones Entrega');
  if (!items) return;
  return items.map(i => ({
    ...i,
    GoodsMovementStatusText: goodsMovementText(i.GoodsMovementStatus),
    PickingStatusText:        pickingText(i.PickingStatus)
  }));
});

// ── READ BillingDocumentItems ─────────────────────────────────────────────
this.on('READ', BillingDocumentItems, async req => {
  const sel     = req.query.SELECT;
  const billKey = getFilter(sel, 'BillingDocument') ?? getNavParentKey(sel, 'BillingDocument');

  const query = SELECT.from('API_BILLING_DOCUMENT_SRV.A_BillingDocumentItem');
  if (billKey) query.where({ BillingDocument: billKey });
  if (sel.limit?.rows?.val) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);

  return await runRemote(req, billingAPI, query, 'Posiciones Factura');
});
```

### 3.4 Nombre del cliente — opcional (API_BUSINESS_PARTNER)

Si se decide incluir el nombre del cliente en la lista de pedidos, importar el EDMX y añadir en el handler de SalesOrders:

```javascript
const bpAPI = await cds.connect.to('API_BUSINESS_PARTNER');

// En el handler, en paralelo con la query de pedidos:
const soIds = orders.map(o => o.SalesOrder); // ya no necesitamos dos queries
const partnerIds = [...new Set(orders.map(o => o.SoldToParty))];
const partners = await runRemote(req, bpAPI,
  SELECT.from('API_BUSINESS_PARTNER.A_BusinessPartner')
    .columns('BusinessPartner', 'BusinessPartnerFullName')
    .where({ BusinessPartner: { in: partnerIds } }),
  'BusinessPartner'
);
const nameById = Object.fromEntries((partners ?? []).map(p =>
  [p.BusinessPartner, p.BusinessPartnerFullName]
));
return orders.map(o => ({ ...o, SoldToPartyName: nameById[o.SoldToParty] ?? o.SoldToParty, ... }));
```

> Requiere `cds import API_BUSINESS_PARTNER.edmx` y mock asociado. Combinar con el caché de Fase 1 (TTL largo, 10 min) porque los nombres de cliente cambian raramente.

### 3.5 Tests de Fase 3

```javascript
// DocFlow completo
it('BillingDocuments incluye nota de crédito', async () => {
  const { data } = await GET(
    "/odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000001'"
  );
  const cats = data.value.map(b => b.BillingDocumentCategory);
  expect(cats).toContain('M');
  expect(cats).toContain('N');
});

// Posiciones
it('SalesOrderItems de SO 10000001 incluye posición sin entrega', async () => {
  const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000001')/Items");
  const sinEntrega = data.value.filter(i => i.DeliveryStatus === 'A');
  expect(sinEntrega.length).toBeGreaterThanOrEqual(1);
  expect(sinEntrega[0].DeliveryStatusText).toBeTruthy();
});

it('DeliveryItems de entrega 80000001 enlaza al pedido origen', async () => {
  const { data } = await GET("/odata/v4/MonitorSDService/Deliveries('80000001')/Items");
  expect(data.value[0].ReferenceSDDocument).toBe('10000001');
});

it('BillingDocumentItems incluye importes fiscales', async () => {
  const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000001')/Items");
  expect(data.value[0]).toHaveProperty('TaxAmount');
  expect(data.value[0]).toHaveProperty('GrossAmount');
});

// Paginación
it('respeta $top en SalesOrders', async () => {
  const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$top=1');
  expect(data.value).toHaveLength(1);
});

// Enriquecimiento
it('SalesOrders incluye DeliveryDelayDays y TotalBlockStatusText', async () => {
  const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders');
  expect(data.value[0]).toHaveProperty('DeliveryDelayDays');
  expect(data.value[0]).toHaveProperty('TotalBlockStatusText');
});
```

**Verificación de cierre:** `npm test` verde. `GET /SalesOrders('10000001')/Items` → posiciones con `DeliveryStatus`. `GET /Deliveries('80000001')/BillingDocuments` → factura + nota de crédito.

---

## Fase 4 — Acciones de Escritura y Seguridad

**Objetivo:** añadir capacidad de modificación de S/4 desde la app y establecer la base de autorización.

**Archivos modificados/creados:**
- `srv/monitor-sd-service.cds` ← bloque actions en Deliveries + @restrict
- `srv/monitor-sd-service.js` ← handlers de acciones
- `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js` ← mock de la acción
- `xs-security.json` ← nuevo
- `package.json` ← audit-logging

### 4.1 Acción PostGoodsIssue (registrar salida de mercancía)

En `srv/monitor-sd-service.cds`, añadir bloque actions a `Deliveries`:

```cds
entity Deliveries as select from DeliveryAPI.A_OutbDeliveryHeader {
  ...campos actuales...
} actions {
  @(
    Core.OperationAvailable: { $edmJson: {
      $Ne: [{ $Path: 'OverallGoodsMovementStatus' }, 'C']
    }},
    Common.SideEffects: {
      TargetProperties: ['OverallGoodsMovementStatus', 'OverallGoodsMovementStatusText']
    }
  )
  action PostGoodsIssue() returns Deliveries;
};
```

Handler en `srv/monitor-sd-service.js`:

```javascript
this.on('PostGoodsIssue', Deliveries, async req => {
  const { DeliveryDocument } = req.params[0];

  // srv.send(actionName, data) es la API correcta para function imports OData V2
  await runRemote(req, deliveryAPI,
    deliveryAPI.send('PostGoodsIssue', { DeliveryDocument }),
    'PostGoodsIssue'
  );

  // Invalidar caché de entregas — el estado ha cambiado
  delivCache.invalidateAll();

  const [updated] = await runRemote(req, deliveryAPI,
    SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryHeader')
      .where({ DeliveryDocument }),
    'PostGoodsIssue-refresh'
  );
  return { ...updated,
    OverallGoodsMovementStatusText: goodsMovementText(updated.OverallGoodsMovementStatus),
    OverallPickingStatusText:       pickingText(updated.OverallPickingStatus)
  };
});
```

### 4.2 Acción ReleaseDeliveryBlock (quitar bloqueo de entrega)

```cds
// En SalesOrders actions block (nuevo):
entity SalesOrders ... actions {
  @(Common.SideEffects: {
    TargetProperties: ['DeliveryBlockReason', 'TotalBlockStatus', 'TotalBlockStatusText']
  })
  action ReleaseDeliveryBlock() returns SalesOrders;
};
```

```javascript
this.on('ReleaseDeliveryBlock', SalesOrders, async req => {
  const { SalesOrder } = req.params[0];
  // UPDATE.entity() no está soportado en Node.js remote OData V2 — usar send() con PATCH
  await runRemote(req, soAPI,
    soAPI.send({
      method: 'PATCH',
      path:   `A_SalesOrder(SalesOrder='${SalesOrder}')`,
      data:   { DeliveryBlockReason: '' }
    }),
    'ReleaseDeliveryBlock'
  );
  soCache.invalidateAll();
  const [updated] = await runRemote(req, soAPI,
    SELECT.from('API_SALES_ORDER_SRV.A_SalesOrder').where({ SalesOrder }),
    'ReleaseDeliveryBlock-refresh'
  );
  return { ...updated, OverallSDProcessStatusText: sdProcessText(updated.OverallSDProcessStatus) };
});
```

> Requiere que el usuario de comunicación S/4 tenga autorización `02` (modificar) sobre `A_SALESORDER`.

### 4.3 Mock de la acción PostGoodsIssue

En `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js`:

```javascript
this.on('PostGoodsIssue', async req => {
  const { DeliveryDocument } = req.data;
  const d = DELIVERIES.find(d => d.DeliveryDocument === DeliveryDocument);
  if (!d) return req.reject(404, `Entrega ${DeliveryDocument} no encontrada`);
  if (d.OverallGoodsMovementStatus === 'C') return req.reject(400, 'GI ya registrada');
  d.OverallGoodsMovementStatus = 'C';
  d.ActualGoodsMovementDate    = new Date().toISOString();
  return d;
});
```

### 4.4 CSRF token para escrituras en S/4 (obligatorio en producción)

Las operaciones de escritura sobre OData V2 de S/4 requieren token CSRF. Sin esto, los POSTs y PATCHs fallan con `403 Forbidden` en producción. Añadir a `.cdsrc.json` perfil `[production]`:

```json
"[production]": {
  "OP_API_OUTBOUND_DELIVERY_SRV_0002": {
    "kind": "odata-v2",
    "model": "srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002",
    "credentials": { "destination": "S4HANA_DELIVERY", "requestTimeout": 15000 },
    "csrf": true
  },
  "API_SALES_ORDER_SRV": {
    "kind": "odata-v2",
    "model": "srv/external/API_SALES_ORDER_SRV",
    "credentials": { "destination": "S4HANA_SALES_ORDER", "requestTimeout": 15000 },
    "csrf": true
  }
}
```

> En modo mock local (`kind: odata-v2` con `impl`), el CSRF no aplica. Solo entra en producción con destino BTP real. `API_BILLING_DOCUMENT_SRV` no necesita CSRF porque es solo lectura.

### 4.5 Audit log

```bash
npm add @cap-js/audit-logging
```

```javascript
const audit = await cds.connect.to('audit-log');

this.on('PostGoodsIssue', Deliveries, async req => {
  // ... lógica existente ...
  await audit.log('MonitorSD.PostGoodsIssue', {
    user: req.user.id, deliveryDocument: DeliveryDocument, timestamp: new Date().toISOString()
  });
});
```

### 4.6 Seguridad: xs-security.json y row-level security

Crear `xs-security.json`:

```json
{
  "xsappname": "monitor-sd",
  "tenant-mode": "dedicated",
  "scopes": [
    { "name": "$XSAPPNAME.SalesViewer",    "description": "Consulta pedidos, entregas y facturas" },
    { "name": "$XSAPPNAME.LogisticsUser",  "description": "Puede registrar GI y quitar bloqueos" }
  ],
  "attributes": [
    { "name": "SalesOrganization", "description": "Org. de ventas del usuario", "valueType": "string" }
  ],
  "role-templates": [
    {
      "name": "SalesViewer",
      "scope-references": ["$XSAPPNAME.SalesViewer"],
      "attribute-references": ["SalesOrganization"]
    },
    {
      "name": "LogisticsUser",
      "scope-references": ["$XSAPPNAME.SalesViewer", "$XSAPPNAME.LogisticsUser"],
      "attribute-references": ["SalesOrganization"]
    }
  ]
}
```

En `srv/monitor-sd-service.cds`, añadir `@requires` y `@restrict`:

```cds
@requires: 'SalesViewer'
service MonitorSDService { ... }
```

En el handler de SalesOrders, filtrar por la organización del JWT:

```javascript
this.on('READ', SalesOrders, async req => {
  const orgAttr = req.user?.attr?.SalesOrganization;
  // ...
  if (orgAttr) query.where({ SalesOrganization: orgAttr });
  // ...
});
```

> CAP no puede empujar `@restrict where` automáticamente a servicios externos — debe implementarse en el handler.

### 4.7 Tests de Fase 4

```javascript
it('PostGoodsIssue cambia estado GI a C', async () => {
  const { data } = await POST(
    "/odata/v4/MonitorSDService/Deliveries('80000002')/MonitorSDService.PostGoodsIssue", {}
  );
  expect(data.OverallGoodsMovementStatus).toBe('C');
  expect(data.OverallGoodsMovementStatusText).toBe('GI completa');
});

it('PostGoodsIssue rechaza si GI ya completada', async () => {
  const res = await POST(
    "/odata/v4/MonitorSDService/Deliveries('80000001')/MonitorSDService.PostGoodsIssue", {}
  ).catch(e => e.response);
  expect(res.status).toBe(400);
});
```

---

## Fase 5 — UI: Anotaciones FE Completas

**Objetivo:** hacer todos los cambios de UI en un único paso, con el modelo definitivo ya compilado. Evita el ciclo de parches incrementales sobre `annotations.cds`.

**Archivos modificados:**
- `srv/annotations.cds` ← única apertura, todos los cambios juntos
- `app/monitor/webapp/manifest.json` ← si se necesita añadir rutas

### 5.1 Qué entra en esta fase

| Contenido | Origen |
|---|---|
| Columna "Bloqueo" con criticidad en SalesOrders LineItem | Mejora A |
| Columna "Retraso" con criticidad días en SalesOrders LineItem | Mejora C |
| Estado de entrega y facturación en FieldGroup cabecera SO | Mejora D |
| Exportación a Excel (`@Capabilities.ExportSupported`) | Mejora B |
| Sección "Posiciones" en ObjectPage de los tres niveles | Mejora K |
| Anotaciones LineItem para SalesOrderItems, DeliveryItems, BillingDocumentItems | Mejora K |
| Columna "Tipo" (BillingDocumentCategoryText) en tabla de facturas | Fase 3 |
| Botón "Registrar GI" (`@UI.DataFieldForAction`) en Deliveries | Fase 4 |
| Botón "Quitar bloqueo entrega" en SalesOrders | Fase 4 |

### 5.2 Columnas de alerta en SalesOrders LineItem

```cds
// Añadir en @UI.LineItem de SalesOrders:
{
  $Type:  'UI.DataFieldForAnnotation',
  Target: '@UI.DataPoint#BlockStatus',
  Label:  'Bloqueo'
},
{
  $Type:  'UI.DataFieldForAnnotation',
  Target: '@UI.DataPoint#DelayDays',
  Label:  'Retraso'
},

UI.DataPoint #BlockStatus: {
  Value:       TotalBlockStatus,
  Title:       'Bloqueo',
  Criticality: { $edmJson: { $If: [{ $Ne: [{ $Path: 'TotalBlockStatus' }, ''] }, 1, 0] }}
},

UI.DataPoint #DelayDays: {
  Value:       DeliveryDelayDays,
  Title:       'Días de retraso',
  Criticality: { $edmJson: {
    $If: [{ $Gt: [{ $Path: 'DeliveryDelayDays' }, 7]  }, 1,
    { $If: [{ $Gt: [{ $Path: 'DeliveryDelayDays' }, 0]  }, 2, 5]}]
  }}
},
```

### 5.3 Estado entrega/factura en ObjectPage SO (FieldGroup Importes)

```cds
// Añadir al FieldGroup#SOFinancials existente:
{ $Type: 'UI.DataField', Value: OverallDeliveryStatusText,      Label: 'Estado entrega'    },
{ $Type: 'UI.DataField', Value: OverallOrdReltdBillgStatusText, Label: 'Estado facturación' },
```

### 5.4 Secciones de posiciones en los tres ObjectPages

```cds
// ── SalesOrders ObjectPage — añadir facet de posiciones ─────────────────
// (junto a SOInfo y Entregas existentes)
{
  $Type:  'UI.ReferenceFacet',
  ID:     'SOItems',
  Target: 'Items/@UI.LineItem',
  Label:  'Posiciones del pedido'
},

// ── Anotaciones tabla posiciones pedido ─────────────────────────────────
annotate MonitorSDService.SalesOrderItems with @(
  UI.HeaderInfo: { TypeName: 'Posición', TypeNamePlural: 'Posiciones',
                  Title: { Value: SalesOrderItem } },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: SalesOrderItem,          Label: 'Pos.'            },
    { $Type: 'UI.DataField', Value: Material,                Label: 'Material'        },
    { $Type: 'UI.DataField', Value: SalesOrderItemText,      Label: 'Descripción'     },
    { $Type: 'UI.DataField', Value: RequestedQuantity,       Label: 'Cantidad'        },
    { $Type: 'UI.DataField', Value: RequestedQuantityUnit,   Label: 'UM'              },
    { $Type: 'UI.DataField', Value: NetAmount,               Label: 'Importe'         },
    { $Type: 'UI.DataField', Value: TransactionCurrency,     Label: 'Mon.'            },
    { $Type: 'UI.DataField', Value: DeliveryStatusText,      Label: 'Estado entrega'  },
    { $Type: 'UI.DataField', Value: SDProcessStatusText,     Label: 'Estado'          }
  ]
);

// ── Deliveries ObjectPage — añadir facet de posiciones ──────────────────
// (junto a DeliveryHeader y Facturas existentes)
{
  $Type:  'UI.ReferenceFacet',
  ID:     'DelivItems',
  Target: 'Items/@UI.LineItem',
  Label:  'Posiciones de entrega'
},

// ── Anotaciones tabla posiciones entrega ────────────────────────────────
annotate MonitorSDService.DeliveryItems with @(
  UI.HeaderInfo: { TypeName: 'Posición entrega', TypeNamePlural: 'Posiciones de entrega',
                  Title: { Value: DeliveryDocumentItem } },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: DeliveryDocumentItem,    Label: 'Pos.'            },
    { $Type: 'UI.DataField', Value: Material,                Label: 'Material'        },
    { $Type: 'UI.DataField', Value: DeliveryDocumentItemText,Label: 'Descripción'     },
    { $Type: 'UI.DataField', Value: ActualDeliveryQuantity,  Label: 'Cantidad real'   },
    { $Type: 'UI.DataField', Value: OriginalDeliveryQuantity,Label: 'Cantidad prev.'  },
    { $Type: 'UI.DataField', Value: DeliveryQuantityUnit,    Label: 'UM'              },
    { $Type: 'UI.DataField', Value: GoodsMovementStatusText, Label: 'Estado GI'       },
    { $Type: 'UI.DataField', Value: PickingStatusText,       Label: 'Picking'         },
    { $Type: 'UI.DataField', Value: Batch,                   Label: 'Lote'            },
    { $Type: 'UI.DataField', Value: StorageLocation,         Label: 'Almacén'         },
    { $Type: 'UI.DataField', Value: ReferenceSDDocument,     Label: 'Pedido ref.'     }
  ]
);

// ── BillingDocuments ObjectPage — añadir facet de posiciones ────────────
{
  $Type:  'UI.ReferenceFacet',
  ID:     'BillItems',
  Target: 'Items/@UI.LineItem',
  Label:  'Posiciones de factura'
},

// ── Anotaciones tabla posiciones factura ────────────────────────────────
annotate MonitorSDService.BillingDocumentItems with @(
  UI.HeaderInfo: { TypeName: 'Posición factura', TypeNamePlural: 'Posiciones de factura',
                  Title: { Value: BillingDocumentItem } },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: BillingDocumentItem,    Label: 'Pos.'         },
    { $Type: 'UI.DataField', Value: Material,               Label: 'Material'     },
    { $Type: 'UI.DataField', Value: BillingDocumentItemText,Label: 'Descripción'  },
    { $Type: 'UI.DataField', Value: BillingQuantity,        Label: 'Cantidad'     },
    { $Type: 'UI.DataField', Value: BillingQuantityUnit,    Label: 'UM'           },
    { $Type: 'UI.DataField', Value: NetAmount,              Label: 'Imp. neto'    },
    { $Type: 'UI.DataField', Value: TaxAmount,              Label: 'IVA'          },
    { $Type: 'UI.DataField', Value: GrossAmount,            Label: 'Imp. bruto'   },
    { $Type: 'UI.DataField', Value: TransactionCurrency,    Label: 'Mon.'         },
    { $Type: 'UI.DataField', Value: ReferenceSDDocument,    Label: 'Entrega ref.' }
  ]
);
```

### 5.5 Botones de acción

```cds
// En @UI.LineItem de Deliveries — añadir botón inline:
{
  $Type:  'UI.DataFieldForAction',
  Action: 'MonitorSDService.PostGoodsIssue',
  Label:  'Registrar GI',
  Inline: true
},

// En @UI.Identification de Deliveries (botón en ObjectPage header):
UI.Identification: [{ $Type: 'UI.DataFieldForAction',
  Action: 'MonitorSDService.PostGoodsIssue', Label: 'Registrar salida de mercancía' }],

// En @UI.LineItem de SalesOrders — botón quitar bloqueo:
{
  $Type:  'UI.DataFieldForAction',
  Action: 'MonitorSDService.ReleaseDeliveryBlock',
  Label:  'Quitar bloqueo entrega',
  Inline: true
},
```

### 5.6 Exportación a Excel (gratuita)

```cds
annotate MonitorSDService.SalesOrders with @Capabilities.ExportSupported;
```

### 5.7 Tipo de documento en tabla de facturas

Añadir como primera columna en `@UI.LineItem` de `BillingDocuments`:
```cds
{ $Type: 'UI.DataField', Value: BillingDocumentCategoryText, Label: 'Tipo' },
```

### 5.8 Validación visual completa

```bash
npx cds watch &
CDS_PID=$!
sleep 5

node scripts/validate-metadata.js \
  --project-dir workspace/monitor_sd \
  --service MonitorSDService \
  --entities SalesOrders,Deliveries,BillingDocuments,SalesOrderItems,DeliveryItems,BillingDocumentItems \
  --port 4004

node scripts/validate-fe.js \
  --port 4004 \
  --service MonitorSDService \
  --entity SalesOrders \
  --screenshot \
  --timeout 60000

kill $CDS_PID
```

Verificar en las capturas:
- SalesOrders LineItem: columnas Bloqueo y Retraso con criticidad
- SO ObjectPage: sección "Posiciones del pedido" con al menos una fila de estado 'A'
- Deliveries ObjectPage: botón "Registrar GI" activo/inactivo según estado
- Deliveries ObjectPage: sección "Posiciones de entrega" con lote y almacén

---

## Fase 6 — Gestión de Anexos

**Objetivo:** subir y descargar documentos adjuntos vinculados a pedidos, entregas y facturas. Fase independiente — puede intercalarse entre F2 y F5 sin afectar al resto.

**Por qué fase separada:** introduce persistencia local (`db/`) — un cambio arquitectónico diferente de todo lo anterior. Tiene sus propios requisitos de despliegue (Object Store en BTP o DMS).

**Archivos creados/modificados:**
- `db/attachments.cds` ← nuevo
- `srv/monitor-sd-service.cds` ← 3 entidades nuevas
- `srv/annotations.cds` ← facets de anexos (se puede añadir en F5 si F6 llega antes)
- `package.json` ← plugin

### 6.1 Instalar plugin

```bash
npm add @cap-js/attachments
```

### 6.2 Modelo local de anclaje

Crear `db/attachments.cds`:

```cds
namespace monitor.sd;
using { cuid, managed }  from '@sap/cds/common';
using { Attachments }    from '@cap-js/attachments';

// Las entidades S/4 no tienen persistencia local, así que usamos entidades
// "holder" que actúan de ancla para el plugin de attachments.
// Solo almacenan la clave del documento S/4; los bytes van al Object Store.

entity SOAttachmentHolder : cuid, managed {
  SalesOrder       : String(10) not null;
  attachments      : Composition of many Attachments;
}

entity DeliveryAttachmentHolder : cuid, managed {
  DeliveryDocument : String(10) not null;
  attachments      : Composition of many Attachments;
}

entity BillingAttachmentHolder : cuid, managed {
  BillingDocument  : String(10) not null;
  attachments      : Composition of many Attachments;
}
```

### 6.3 Exponer en el servicio

```cds
// En srv/monitor-sd-service.cds:
entity SOAttachments    as projection on monitor.sd.SOAttachmentHolder;
entity DelivAttachments as projection on monitor.sd.DeliveryAttachmentHolder;
entity BillAttachments  as projection on monitor.sd.BillingAttachmentHolder;
```

El plugin gestiona upload/download/delete automáticamente. No se necesita handler adicional.

### 6.4 Configuración de almacenamiento

```json
// package.json — para producción BTP Object Store (auto-detecta S3/Azure/GCP):
"cds": {
  "requires": {
    "attachments": { "kind": "standard" }
  }
}
```

> Para SAP DMS (si el cliente ya tiene repositorio corporativo): `"kind": "sdm"`. Los anexos serían visibles también desde SAP GUI.

### 6.5 Anotaciones FE (se puede mover a F5 si F6 llega antes)

```cds
// Añadir en @UI.Facets de SalesOrders (y equivalente en Deliveries y BillingDocuments):
{
  $Type:  'UI.ReferenceFacet',
  Target: 'SOAttachments/@UI.LineItem',
  Label:  'Documentos adjuntos'
},
```

### 6.6 Tests

```javascript
it('crea un holder de anexos para un pedido', async () => {
  const { data } = await POST('/odata/v4/MonitorSDService/SOAttachments',
    { SalesOrder: '10000001' });
  expect(data.SalesOrder).toBe('10000001');
  expect(data.ID).toBeTruthy();
});

it('lista holders filtrados por SalesOrder', async () => {
  const { data } = await GET(
    "/odata/v4/MonitorSDService/SOAttachments?$filter=SalesOrder eq '10000001'&$expand=attachments"
  );
  expect(data.value[0].SalesOrder).toBe('10000001');
  expect(Array.isArray(data.value[0].attachments)).toBe(true);
});
```

---

## Mejoras fuera del alcance de este plan

Documentadas aquí para no perder el contexto, pero sin fase asignada.

| Mejora | Por qué no está en el plan |
|---|---|
| **Nombre del cliente** (API_BUSINESS_PARTNER) | Requiere importar un EDMX adicional y mantener otro mock. Valorar si el beneficio de UX justifica la complejidad. Si se decide, entra en Fase 3. |
| **Vista analítica** (KPI tiles + gráficos) | `$apply=groupby(...)` de OData V4 no está disponible en las APIs V2 de S/4. Requeriría materializar la agregación en JavaScript, lo que escala mal con volumen. Evaluar con datos reales antes de comprometerse. |
| **Notificaciones push** (SAP Event Mesh) | Alta complejidad — requiere suscripción a Business Events de S/4. Valor muy alto para almacén, pero es una integración nueva que va más allá del alcance de este plan. |

---

## Resumen ejecutivo

| Fase | Qué resuelve | Archivos clave | Esfuerzo |
|---|---|---|---|
| **1 — Infraestructura** | Errores, paginación, caché | `srv/lib/remote-error.js`, `ttl-cache.js`, handler existente | ~1 día |
| **2 — Modelo CDS** | Posiciones, bloqueos, retraso, DocFlow fix — todo en un paso | `srv/monitor-sd-service.cds`, `status-mapper.js`, 3 mocks | ~1 día |
| **3 — Handlers lectura** | Posiciones funcionales, DocFlow completo, enriquecimiento campos | `srv/monitor-sd-service.js` | ~1 día |
| **4 — Escritura + Seguridad** | PostGoodsIssue, ReleaseDeliveryBlock, xs-security.json | `srv/monitor-sd-service.js`, `xs-security.json` | ~1–2 días |
| **5 — UI completa** | Todas las anotaciones FE en un solo paso | `srv/annotations.cds` | ~1 día |
| **6 — Anexos** | Upload/download de documentos por pedido/entrega/factura | `db/attachments.cds`, plugin | ~1 día |

**Total estimado: 6–7 días de desarrollo.**

Las fases 1–3 son independientes de S/4 real (solo afectan a mocks y lógica interna). Las fases 4 y 6 necesitan validación contra S/4 real y BTP respectivamente.
