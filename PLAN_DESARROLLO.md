# Plan de Desarrollo — Monitor SD (Sales-to-Cash Traceability)

**Proyecto:** `monitor_sd`  
**Directorio:** `workspace/monitor_sd/`  
**Fecha de planificación:** 2026-04-26  
**Arquitectura base:** SAP CAP (Node.js) + Fiori Elements + External Services S/4HANA  

---

## Visión General

Aplicación Side-by-Side sobre SAP BTP que consolida la trazabilidad del flujo logístico Pedido → Entrega → Factura en una sola vista jerárquica de tres niveles. Los datos provienen de tres APIs estándar de S/4HANA; **no se persiste nada localmente**.

```
Nivel 1  →  Monitor de Pedidos        (Sales Order List Report)
Nivel 2  →  Detalle de Pedido         (Sales Order Object Page + tabla Deliveries)
Nivel 3  →  Detalle de Entrega        (Delivery Object Page + tabla Billing Docs)
```

### APIs S/4HANA consumidas

| API | Servicio EDMX | Entidades principales |
|---|---|---|
| Sales Orders | `API_SALES_ORDER_SRV` | `A_SalesOrderType`, `A_SalesOrderSubsqntProcFlowType` |
| Outbound Deliveries | `OP_API_OUTBOUND_DELIVERY_SRV_0002` | `A_OutbDeliveryHeaderType`, `A_OutbDeliveryItemType`, `A_OutbDeliveryDocFlowType` |
| Billing Documents | `API_BILLING_DOCUMENT_SRV` | `A_BillingDocumentType`, `A_BillingDocumentItemType` |

### Estrategia de fases

```
Fase 1  →  Entorno y scaffolding del proyecto CAP
Fase 2  →  Importación de EDMX y modelo CDS de servicio
Fase 3  →  Mocks en-proceso (datos ficticios sin S/4)
Fase 4  →  Handlers: resolución del flujo de documentos
Fase 5  →  Fiori Elements UI (3 niveles)
Fase 6  →  Tests automatizados
Fase 7  →  Conexión real a S/4HANA (futura, no en este sprint)
```

---

## Fase 1 — Entorno y Scaffolding

**Objetivo:** proyecto CAP inicializado, dependencias instaladas, estructura de carpetas lista.

### 1.1 Inicializar el proyecto

```bash
cd workspace/monitor_sd
cds init . --add hana,approuter
npm install
```

> No usar `--add samples` para no generar artefactos de ejemplo que contaminen el modelo.

### 1.2 Instalar dependencias adicionales

```bash
npm install @sap-cloud-sdk/http-client
npm install --save-dev @cap-js/cds-test jest
```

### 1.3 Estructura de carpetas esperada al final de Fase 1

```
monitor_sd/
├── app/                        # Fiori Elements apps (vacío hasta Fase 5)
├── db/                         # Sin schema.cds — no hay persistencia local
├── srv/
│   ├── external/               # Modelos CDS + mocks generados en Fase 2/3
│   └── monitor-sd-service.cds  # Servicio principal (Fase 2)
├── test/                       # Tests (Fase 6)
├── package.json
└── .cdsrc.json                 # Configuración CAP
```

### 1.4 Configurar `.cdsrc.json` base

```json
{
  "requires": {
    "[production]": {
      "API_SALES_ORDER_SRV": {
        "kind": "odata-v2",
        "model": "srv/external/API_SALES_ORDER_SRV",
        "credentials": { "destination": "S4HANA_SALES_ORDER" }
      },
      "OP_API_OUTBOUND_DELIVERY_SRV_0002": {
        "kind": "odata-v2",
        "model": "srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002",
        "credentials": { "destination": "S4HANA_DELIVERY" }
      },
      "API_BILLING_DOCUMENT_SRV": {
        "kind": "odata-v2",
        "model": "srv/external/API_BILLING_DOCUMENT_SRV",
        "credentials": { "destination": "S4HANA_BILLING" }
      }
    }
  }
}
```

> El perfil `[production]` se activa en BTP. En local siempre se usa el mock en-proceso (Fase 3).

---

## Fase 2 — Importación de EDMX y Modelo CDS de Servicio

**Objetivo:** importar los tres EDMX como modelos CAP externos y definir el servicio de proyección limpio (use-case oriented).

### 2.1 Importar los EDMX

```bash
cds import API_SALES_ORDER_SRV.edmx --as odata-v2
cds import OP_API_OUTBOUND_DELIVERY_SRV_0002.edmx --as odata-v2
cds import API_BILLING_DOCUMENT_SRV.edmx --as odata-v2
```

Esto genera en `srv/external/`:
- `API_SALES_ORDER_SRV.cds` + `API_SALES_ORDER_SRV.json`
- `OP_API_OUTBOUND_DELIVERY_SRV_0002.cds` + `OP_API_OUTBOUND_DELIVERY_SRV_0002.json`
- `API_BILLING_DOCUMENT_SRV.cds` + `API_BILLING_DOCUMENT_SRV.json`

> Inspeccionar los `.cds` generados para confirmar los nombres de campo exactos antes de escribir la proyección.

### 2.2 Modelo de servicio principal: `srv/monitor-sd-service.cds`

El servicio expone solo los campos necesarios para los tres niveles de la UI. No expone las entidades externas en crudo.

```cds
using { API_SALES_ORDER_SRV as SalesOrderAPI }
  from './external/API_SALES_ORDER_SRV';
using { OP_API_OUTBOUND_DELIVERY_SRV_0002 as DeliveryAPI }
  from './external/OP_API_OUTBOUND_DELIVERY_SRV_0002';
using { API_BILLING_DOCUMENT_SRV as BillingAPI }
  from './external/API_BILLING_DOCUMENT_SRV';

service MonitorSDService @(path: '/odata/v4/MonitorSDService') {

  // ─── Nivel 1: Lista de Pedidos ───────────────────────────────────────────
  @readonly
  entity SalesOrders as projection on SalesOrderAPI.A_SalesOrderType {
    key SalesOrder,
        SalesOrderType,
        SalesOrganization,
        SoldToParty,
        PurchaseOrderByCustomer,
        CreationDate,
        RequestedDeliveryDate,
        TotalNetAmount,
        TransactionCurrency,
        OverallSDProcessStatus,
        // Campo virtual: texto legible del estado (resuelto en handler)
        virtual OverallSDProcessStatusText : String
  };

  // ─── Nivel 2: Entregas de un Pedido ─────────────────────────────────────
  @readonly
  entity Deliveries as projection on DeliveryAPI.A_OutbDeliveryHeaderType {
    key DeliveryDocument,
        DeliveryDocumentType,
        ShippingPoint,
        DeliveryDate,
        ActualGoodsMovementDate,
        OverallGoodsMovementStatus,
        OverallPickingStatus,
        // Campo de enlace: pedido de origen (resuelto en handler vía DocFlow)
        virtual SalesOrderRef         : String,
        virtual OverallGoodsMovementStatusText : String,
        virtual OverallPickingStatusText       : String
  };

  // ─── Nivel 3: Facturas de una Entrega ────────────────────────────────────
  @readonly
  entity BillingDocuments as projection on BillingAPI.A_BillingDocumentType {
    key BillingDocument,
        BillingDocumentType,
        BillingDocumentCategory,
        BillingDocumentDate,
        SalesOrganization,
        TotalGrossAmount,
        TransactionCurrency,
        AccountingDocument,
        OverallBillingStatus,
        BillingDocumentIsCancelled,
        // Campo de enlace: entrega de origen (resuelto en handler)
        virtual DeliveryRef          : String,
        virtual OverallBillingStatusText : String
  };

  // ─── Flujo de documentos: SO → Entregas ─────────────────────────────────
  // Entidad auxiliar usada por el handler para resolver la cadena
  @readonly
  entity SODocFlow as projection on SalesOrderAPI.A_SalesOrderSubsqntProcFlowType {
    key SalesOrder,
    key SubsqntDocument,
        SubsqntDocumentCategory,
        SubsqntDocumentItem
  };

  // ─── Flujo de documentos: Entrega → Facturas ────────────────────────────
  @readonly
  entity DeliveryDocFlow as projection on DeliveryAPI.A_OutbDeliveryDocFlowType {
    key DeliveryDocument,
    key DeliveryDocumentItem,
        PrecedingDocument,
        PrecedingDocumentCategory,
        PrecedingDocumentItem
  };
}
```

### 2.3 Mapeo de estados (referencia para el handler)

| Campo | Código | Texto usuario |
|---|---|---|
| `OverallSDProcessStatus` | `A` | Abierto |
| `OverallSDProcessStatus` | `B` | En proceso |
| `OverallSDProcessStatus` | `C` | Completado |
| `OverallGoodsMovementStatus` | `A` | Sin salida de mercancía |
| `OverallGoodsMovementStatus` | `B` | GI parcial |
| `OverallGoodsMovementStatus` | `C` | GI completa |
| `OverallPickingStatus` | `A` | Picking pendiente |
| `OverallPickingStatus` | `B` | Picking parcial |
| `OverallPickingStatus` | `C` | Picking completado |
| `OverallBillingStatus` | `A` | Sin facturar |
| `OverallBillingStatus` | `B` | Facturación parcial |
| `OverallBillingStatus` | `C` | Completamente facturado |

---

## Fase 3 — Mocks En-Proceso

**Objetivo:** datos ficticios coherentes que simulen el flujo SO → Entrega → Factura sin necesidad de S/4. Permite desarrollar y probar localmente.

### 3.1 Por qué in-process mock (no ficheros CSV)

Los datos no tienen persistencia local (`@cds.persistence.skip` implícito al proyectar sobre external services). Los fixtures deben estar en los archivos `impl` de cada servicio externo.

### 3.2 Fichero mock Sales Orders: `srv/external/API_SALES_ORDER_SRV.js`

```javascript
const cds = require('@sap/cds');

const SALES_ORDERS = [
  {
    SalesOrder: '10000001',
    SalesOrderType: 'OR',
    SalesOrganization: '1010',
    SoldToParty: 'C001',
    PurchaseOrderByCustomer: 'PO-2025-001',
    CreationDate: new Date('2025-01-10'),
    RequestedDeliveryDate: new Date('2025-01-20'),
    TotalNetAmount: 15000.00,
    TransactionCurrency: 'EUR',
    OverallSDProcessStatus: 'B'
  },
  {
    SalesOrder: '10000002',
    SalesOrderType: 'OR',
    SalesOrganization: '1010',
    SoldToParty: 'C002',
    PurchaseOrderByCustomer: 'PO-2025-045',
    CreationDate: new Date('2025-02-01'),
    RequestedDeliveryDate: new Date('2025-02-15'),
    TotalNetAmount: 8500.00,
    TransactionCurrency: 'EUR',
    OverallSDProcessStatus: 'C'
  },
  {
    SalesOrder: '10000003',
    SalesOrderType: 'OR',
    SalesOrganization: '2020',
    SoldToParty: 'C003',
    PurchaseOrderByCustomer: '',
    CreationDate: new Date('2025-03-05'),
    RequestedDeliveryDate: new Date('2025-03-20'),
    TotalNetAmount: 22000.00,
    TransactionCurrency: 'USD',
    OverallSDProcessStatus: 'A'
  }
];

const SO_SUBSEQPROCFLOW = [
  { SalesOrder: '10000001', SubsqntDocument: '80000001', SubsqntDocumentCategory: 'J' },
  { SalesOrder: '10000001', SubsqntDocument: '80000002', SubsqntDocumentCategory: 'J' },
  { SalesOrder: '10000002', SubsqntDocument: '80000003', SubsqntDocumentCategory: 'J' }
];

module.exports = class API_SALES_ORDER_SRV extends cds.Service {
  async init() {
    this.on('READ', 'A_SalesOrderType', req => {
      const { SalesOrder } = req.query.SELECT.where?.[0] || {};
      if (SalesOrder) return SALES_ORDERS.filter(o => o.SalesOrder === SalesOrder);
      return SALES_ORDERS;
    });
    this.on('READ', 'A_SalesOrderSubsqntProcFlowType', req => {
      const soFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'SalesOrder')?.val;
      if (soFilter) return SO_SUBSEQPROCFLOW.filter(r => r.SalesOrder === soFilter);
      return SO_SUBSEQPROCFLOW;
    });
    await super.init();
  }
};
```

### 3.3 Fichero mock Deliveries: `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js`

```javascript
const cds = require('@sap/cds');

const DELIVERIES = [
  {
    DeliveryDocument: '80000001',
    DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP01',
    DeliveryDate: new Date('2025-01-18'),
    ActualGoodsMovementDate: new Date('2025-01-19'),
    OverallGoodsMovementStatus: 'C',
    OverallPickingStatus: 'C'
  },
  {
    DeliveryDocument: '80000002',
    DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP01',
    DeliveryDate: new Date('2025-01-22'),
    ActualGoodsMovementDate: null,
    OverallGoodsMovementStatus: 'A',
    OverallPickingStatus: 'B'
  },
  {
    DeliveryDocument: '80000003',
    DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP02',
    DeliveryDate: new Date('2025-02-14'),
    ActualGoodsMovementDate: new Date('2025-02-14'),
    OverallGoodsMovementStatus: 'C',
    OverallPickingStatus: 'C'
  }
];

// DocFlow: entrega → factura (PrecedingDocument = BillingDocument desde la perspectiva de la entrega)
// Nota: en la API real, el DocFlow de la entrega apunta al documento precedente (SO),
// pero también existe a nivel de item la referencia a Billing via ReferenceSDDocument.
// Para la cadena Entrega→Factura usamos una entidad auxiliar simplificada.
const DELIVERY_DOC_FLOW = [
  { DeliveryDocument: '80000001', DeliveryDocumentItem: '000010', PrecedingDocument: '90000001', PrecedingDocumentCategory: 'M' },
  { DeliveryDocument: '80000003', DeliveryDocumentItem: '000010', PrecedingDocument: '90000002', PrecedingDocumentCategory: 'M' }
];

module.exports = class OP_API_OUTBOUND_DELIVERY_SRV_0002 extends cds.Service {
  async init() {
    this.on('READ', 'A_OutbDeliveryHeaderType', req => {
      const delivFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'DeliveryDocument')?.val;
      if (delivFilter) return DELIVERIES.filter(d => d.DeliveryDocument === delivFilter);
      return DELIVERIES;
    });
    this.on('READ', 'A_OutbDeliveryDocFlowType', req => {
      const delivFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'DeliveryDocument')?.val;
      if (delivFilter) return DELIVERY_DOC_FLOW.filter(r => r.DeliveryDocument === delivFilter);
      return DELIVERY_DOC_FLOW;
    });
    await super.init();
  }
};
```

### 3.4 Fichero mock Billing: `srv/external/API_BILLING_DOCUMENT_SRV.js`

```javascript
const cds = require('@sap/cds');

const BILLING_DOCS = [
  {
    BillingDocument: '90000001',
    BillingDocumentType: 'F2',
    BillingDocumentCategory: 'M',
    BillingDocumentDate: new Date('2025-01-20'),
    SalesOrganization: '1010',
    TotalGrossAmount: 15000.00,
    TransactionCurrency: 'EUR',
    AccountingDocument: 'ACC0001',
    OverallBillingStatus: 'C',
    BillingDocumentIsCancelled: false
  },
  {
    BillingDocument: '90000002',
    BillingDocumentType: 'F2',
    BillingDocumentCategory: 'M',
    BillingDocumentDate: new Date('2025-02-15'),
    SalesOrganization: '1010',
    TotalGrossAmount: 8500.00,
    TransactionCurrency: 'EUR',
    AccountingDocument: 'ACC0002',
    OverallBillingStatus: 'C',
    BillingDocumentIsCancelled: false
  }
];

module.exports = class API_BILLING_DOCUMENT_SRV extends cds.Service {
  async init() {
    this.on('READ', 'A_BillingDocumentType', req => {
      const billFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'BillingDocument')?.val;
      if (billFilter) return BILLING_DOCS.filter(b => b.BillingDocument === billFilter);
      return BILLING_DOCS;
    });
    await super.init();
  }
};
```

### 3.5 Registrar los mocks en `package.json` (sección `cds.requires`)

```json
{
  "cds": {
    "requires": {
      "API_SALES_ORDER_SRV": {
        "kind": "odata-v2",
        "model": "srv/external/API_SALES_ORDER_SRV",
        "impl": "srv/external/API_SALES_ORDER_SRV.js"
      },
      "OP_API_OUTBOUND_DELIVERY_SRV_0002": {
        "kind": "odata-v2",
        "model": "srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002",
        "impl": "srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js"
      },
      "API_BILLING_DOCUMENT_SRV": {
        "kind": "odata-v2",
        "model": "srv/external/API_BILLING_DOCUMENT_SRV",
        "impl": "srv/external/API_BILLING_DOCUMENT_SRV.js"
      }
    }
  }
}
```

> **Verificación de Fase 3:** `npx cds watch` debe arrancar sin errores. `GET /odata/v4/MonitorSDService/SalesOrders` debe devolver los 3 pedidos mock.

---

## Fase 4 — Handlers: Resolución del Flujo de Documentos

**Objetivo:** handler principal que resuelve la cadena SO→Entrega→Factura y enriquece los campos virtuales de estado.

### 4.1 Helper de estados: `srv/lib/status-mapper.js`

```javascript
const SD_PROCESS_STATUS = { A: 'Abierto', B: 'En proceso', C: 'Completado' };
const GOODS_MOVEMENT_STATUS = {
  A: 'Sin salida de mercancía',
  B: 'GI parcial',
  C: 'GI completa'
};
const PICKING_STATUS = {
  A: 'Picking pendiente',
  B: 'Picking parcial',
  C: 'Picking completado'
};
const BILLING_STATUS = {
  A: 'Sin facturar',
  B: 'Facturación parcial',
  C: 'Completamente facturado'
};

module.exports = {
  sdProcessText:       code => SD_PROCESS_STATUS[code]       ?? code,
  goodsMovementText:   code => GOODS_MOVEMENT_STATUS[code]   ?? code,
  pickingText:         code => PICKING_STATUS[code]           ?? code,
  billingText:         code => BILLING_STATUS[code]           ?? code
};
```

### 4.2 Handler principal: `srv/monitor-sd-service.js`

```javascript
const cds = require('@sap/cds');
const { sdProcessText, goodsMovementText, pickingText, billingText } = require('./lib/status-mapper');

module.exports = class MonitorSDService extends cds.ApplicationService {
  async init() {

    const soAPI      = await cds.connect.to('API_SALES_ORDER_SRV');
    const deliveryAPI = await cds.connect.to('OP_API_OUTBOUND_DELIVERY_SRV_0002');
    const billingAPI  = await cds.connect.to('API_BILLING_DOCUMENT_SRV');

    const { SalesOrders, Deliveries, BillingDocuments, SODocFlow, DeliveryDocFlow } = this.entities;

    // ── READ SalesOrders: enriquecer estado ──────────────────────────────
    this.on('READ', SalesOrders, async req => {
      const query = SELECT.from('API_SALES_ORDER_SRV.A_SalesOrderType');
      if (req.query.SELECT.where) query.where(req.query.SELECT.where);
      const orders = await soAPI.run(query);
      return orders.map(o => ({
        ...o,
        OverallSDProcessStatusText: sdProcessText(o.OverallSDProcessStatus)
      }));
    });

    // ── READ Deliveries: filtrar por SalesOrder vía SODocFlow ──────────
    this.on('READ', Deliveries, async req => {
      const soFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'SalesOrderRef')?.val;

      let deliveryIds = [];
      if (soFilter) {
        // Resolver SO → Entregas via SubsequentProcFlowDoc
        const flows = await soAPI.run(
          SELECT.from('API_SALES_ORDER_SRV.A_SalesOrderSubsqntProcFlowType')
            .where({ SalesOrder: soFilter, SubsqntDocumentCategory: 'J' })
        );
        deliveryIds = flows.map(f => f.SubsqntDocument);
        if (!deliveryIds.length) return [];
      }

      const query = SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryHeaderType');
      if (deliveryIds.length) query.where({ DeliveryDocument: { in: deliveryIds } });
      const deliveries = await deliveryAPI.run(query);

      return deliveries.map(d => ({
        ...d,
        SalesOrderRef:                soFilter ?? null,
        OverallGoodsMovementStatusText: goodsMovementText(d.OverallGoodsMovementStatus),
        OverallPickingStatusText:        pickingText(d.OverallPickingStatus)
      }));
    });

    // ── READ BillingDocuments: filtrar por Delivery vía DocFlow ────────
    this.on('READ', BillingDocuments, async req => {
      const delivFilter = req.query.SELECT.where?.find(w => w.ref?.[0] === 'DeliveryRef')?.val;

      let billingIds = [];
      if (delivFilter) {
        // Resolver Entrega → Facturas via DocFlow
        const flows = await deliveryAPI.run(
          SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryDocFlowType')
            .where({ DeliveryDocument: delivFilter, PrecedingDocumentCategory: 'M' })
        );
        billingIds = [...new Set(flows.map(f => f.PrecedingDocument))];
        if (!billingIds.length) return [];
      }

      const query = SELECT.from('API_BILLING_DOCUMENT_SRV.A_BillingDocumentType');
      if (billingIds.length) query.where({ BillingDocument: { in: billingIds } });
      const bills = await billingAPI.run(query);

      return bills.map(b => ({
        ...b,
        DeliveryRef:             delivFilter ?? null,
        OverallBillingStatusText: billingText(b.OverallBillingStatus)
      }));
    });

    await super.init();
  }
};
```

> **Verificación de Fase 4:**
> - `GET /odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000001'` → retorna 2 entregas
> - `GET /odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000001'` → retorna 1 factura
> - Los campos `*Text` están poblados en ambas respuestas

---

## Fase 5 — Fiori Elements UI (3 Niveles)

**Objetivo:** tres vistas FE que implementan la navegación jerárquica definida en el requisito.

### 5.1 Estructura de carpetas de la UI

```
app/
├── salesorders/          ← Nivel 1: ListReport de Pedidos
│   └── webapp/
│       ├── manifest.json
│       └── Component.js
├── salesorder-detail/    ← Nivel 2: ObjectPage Pedido (si se implementa separado)
│   └── webapp/
│       ├── manifest.json
│       └── Component.js
└── delivery-detail/      ← Nivel 3: ObjectPage Entrega
    └── webapp/
        ├── manifest.json
        └── Component.js
```

> **Decisión arquitectónica:** implementar como **una sola app FE** con routing interno (ListReport → ObjectPage SO → ObjectPage Delivery) es más simple y el enfoque recomendado por CAP para navegación N-niveles dentro del mismo servicio. Solo se necesita un `manifest.json`.

### 5.2 App única: `app/monitor/webapp/manifest.json` (borrador)

```json
{
  "_version": "1.49.0",
  "sap.app": {
    "id": "monitor.sd",
    "type": "application",
    "title": "Monitor Sales-to-Cash",
    "description": "Trazabilidad Pedido > Entrega > Factura",
    "dataSources": {
      "mainService": {
        "uri": "/odata/v4/MonitorSDService/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  },
  "sap.ui5": {
    "dependencies": {
      "libs": {
        "sap.fe.templates": {},
        "sap.m": {},
        "sap.ui.core": {}
      }
    },
    "routing": {
      "config": {
        "routerClass": "sap.fe.core.AppRouter"
      },
      "routes": [
        {
          "name": "SalesOrdersList",
          "pattern": "",
          "target": "SalesOrdersList"
        },
        {
          "name": "SalesOrdersObjectPage",
          "pattern": "SalesOrders({SalesOrderKey})",
          "target": "SalesOrdersObjectPage"
        },
        {
          "name": "DeliveriesObjectPage",
          "pattern": "SalesOrders({SalesOrderKey})/Deliveries({DeliveryKey})",
          "target": "DeliveriesObjectPage"
        }
      ],
      "targets": {
        "SalesOrdersList": {
          "type": "Component",
          "id": "SalesOrdersList",
          "name": "sap.fe.templates.ListReport",
          "options": {
            "settings": {
              "entitySet": "SalesOrders",
              "variantManagement": "Page"
            }
          }
        },
        "SalesOrdersObjectPage": {
          "type": "Component",
          "id": "SalesOrdersObjectPage",
          "name": "sap.fe.templates.ObjectPage",
          "options": {
            "settings": {
              "entitySet": "SalesOrders",
              "navigation": {
                "Deliveries": { "detail": { "route": "DeliveriesObjectPage" } }
              }
            }
          }
        },
        "DeliveriesObjectPage": {
          "type": "Component",
          "id": "DeliveriesObjectPage",
          "name": "sap.fe.templates.ObjectPage",
          "options": {
            "settings": {
              "entitySet": "Deliveries"
            }
          }
        }
      }
    }
  }
}
```

### 5.3 Anotaciones UI: `srv/annotations.cds`

```cds
using MonitorSDService from './monitor-sd-service';

// ─── Nivel 1: SalesOrders ListReport ──────────────────────────────────────

annotate MonitorSDService.SalesOrders with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: SalesOrder,              Label: 'Pedido'           },
    { $Type: 'UI.DataField', Value: SoldToParty,             Label: 'Cliente'          },
    { $Type: 'UI.DataField', Value: PurchaseOrderByCustomer, Label: 'Ref. cliente'     },
    { $Type: 'UI.DataField', Value: CreationDate,            Label: 'Fecha creación'   },
    { $Type: 'UI.DataField', Value: RequestedDeliveryDate,   Label: 'Entrega solicit.' },
    { $Type: 'UI.DataField', Value: TotalNetAmount,          Label: 'Importe neto'     },
    { $Type: 'UI.DataField', Value: TransactionCurrency,     Label: 'Moneda'           },
    {
      $Type: 'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#StatusSO',
      Label: 'Estado'
    }
  ],

  UI.DataPoint #StatusSO: {
    Value:         OverallSDProcessStatus,
    Title:         'Estado del pedido',
    Criticality:   OverallSDProcessStatus = 'A' ? #Negative
                 : OverallSDProcessStatus = 'B' ? #Critical
                 : #Positive
  },

  UI.SelectionFields: [ SoldToParty, SalesOrganization, CreationDate, OverallSDProcessStatus ],

  UI.HeaderInfo: {
    TypeName:       'Pedido',
    TypeNamePlural: 'Pedidos',
    Title:          { Value: SalesOrder }
  }
);

// ─── Nivel 2: SalesOrders ObjectPage ──────────────────────────────────────

annotate MonitorSDService.SalesOrders with @(
  UI.FieldGroup #Header: {
    Data: [
      { $Type: 'UI.DataField', Value: SalesOrder            },
      { $Type: 'UI.DataField', Value: SoldToParty           },
      { $Type: 'UI.DataField', Value: SalesOrganization     },
      { $Type: 'UI.DataField', Value: TotalNetAmount        },
      { $Type: 'UI.DataField', Value: TransactionCurrency   },
      { $Type: 'UI.DataField', Value: OverallSDProcessStatusText }
    ]
  },
  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Target: '@UI.FieldGroup#Header',
      Label:  'Datos generales'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Target: 'Deliveries/@UI.LineItem',
      Label:  'Entregas'
    }
  ]
);

// ─── Nivel 2: Deliveries table (dentro del ObjectPage de SO) ─────────────

annotate MonitorSDService.Deliveries with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: DeliveryDocument,    Label: 'Entrega'      },
    { $Type: 'UI.DataField', Value: DeliveryDate,        Label: 'Fecha prev.'  },
    { $Type: 'UI.DataField', Value: ActualGoodsMovementDate, Label: 'Fecha GI' },
    { $Type: 'UI.DataField', Value: OverallPickingStatusText,       Label: 'Picking'  },
    {
      $Type: 'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#StatusDelivery',
      Label: 'Estado GI'
    }
  ],

  UI.DataPoint #StatusDelivery: {
    Value:       OverallGoodsMovementStatus,
    Title:       'Estado GI',
    Criticality: OverallGoodsMovementStatus = 'A' ? #Negative
               : OverallGoodsMovementStatus = 'B' ? #Critical
               : #Positive
  },

  UI.HeaderInfo: {
    TypeName:       'Entrega',
    TypeNamePlural: 'Entregas',
    Title:          { Value: DeliveryDocument }
  }
);

// ─── Nivel 3: Deliveries ObjectPage ──────────────────────────────────────

annotate MonitorSDService.Deliveries with @(
  UI.FieldGroup #DeliveryHeader: {
    Data: [
      { $Type: 'UI.DataField', Value: DeliveryDocument               },
      { $Type: 'UI.DataField', Value: ShippingPoint                  },
      { $Type: 'UI.DataField', Value: DeliveryDate                   },
      { $Type: 'UI.DataField', Value: ActualGoodsMovementDate        },
      { $Type: 'UI.DataField', Value: OverallGoodsMovementStatusText },
      { $Type: 'UI.DataField', Value: OverallPickingStatusText       }
    ]
  },
  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      Target: '@UI.FieldGroup#DeliveryHeader',
      Label:  'Datos de entrega'
    },
    {
      $Type:  'UI.ReferenceFacet',
      Target: 'BillingDocuments/@UI.LineItem',
      Label:  'Facturas'
    }
  ]
);

// ─── Nivel 3: BillingDocuments table (dentro del ObjectPage de Delivery) ─

annotate MonitorSDService.BillingDocuments with @(
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: BillingDocument,      Label: 'Factura'         },
    { $Type: 'UI.DataField', Value: BillingDocumentDate,  Label: 'Fecha factura'   },
    { $Type: 'UI.DataField', Value: TotalGrossAmount,     Label: 'Importe bruto'   },
    { $Type: 'UI.DataField', Value: TransactionCurrency,  Label: 'Moneda'          },
    { $Type: 'UI.DataField', Value: AccountingDocument,   Label: 'Doc. contable'   },
    { $Type: 'UI.DataField', Value: OverallBillingStatusText, Label: 'Estado'      },
    { $Type: 'UI.DataField', Value: BillingDocumentIsCancelled, Label: 'Cancelada' }
  ],

  UI.DataPoint #StatusBilling: {
    Value:       OverallBillingStatus,
    Title:       'Estado facturación',
    Criticality: OverallBillingStatus = 'A' ? #Critical
               : OverallBillingStatus = 'B' ? #Critical
               : #Positive
  },

  UI.HeaderInfo: {
    TypeName:       'Factura',
    TypeNamePlural: 'Facturas',
    Title:          { Value: BillingDocument }
  }
);
```

> **Atención:** las anotaciones de navegación (`Deliveries/@UI.LineItem`, `BillingDocuments/@UI.LineItem`) dependen de que el modelo CDS declare las asociaciones entre entidades. Si FE no puede resolver la navegación vía OData $expand, habrá que añadir `Association` explícitas en el service y sus resolvers en el handler. Evaluar en la validación de `$metadata`.

### 5.4 Validación de Fiori Elements (protocolo de 3 pasos del CLAUDE.md)

**Paso 1 — Estático:**
```bash
node scripts/validate-metadata.js \
  --project-dir workspace/monitor_sd \
  --service MonitorSDService \
  --entities SalesOrders,Deliveries,BillingDocuments
```

**Paso 2 — $metadata con servidor:**
```bash
npx cds watch &
CDS_PID=$!
sleep 5
node scripts/validate-metadata.js \
  --project-dir workspace/monitor_sd \
  --service MonitorSDService \
  --entities SalesOrders,Deliveries,BillingDocuments \
  --port 4004
kill $CDS_PID 2>/dev/null
```

---

## Fase 6 — Tests Automatizados

**Objetivo:** cobertura mínima viable para garantizar que el flujo de documentos y el mapeo de estados funcionan correctamente.

### 6.1 Test del status mapper: `test/status-mapper.test.js`

```javascript
const { sdProcessText, goodsMovementText, pickingText, billingText } = require('../srv/lib/status-mapper');

describe('Status Mapper', () => {
  test.each([
    ['A', 'Abierto'], ['B', 'En proceso'], ['C', 'Completado'], ['X', 'X']
  ])('sdProcessText(%s) → %s', (code, expected) => {
    expect(sdProcessText(code)).toBe(expected);
  });

  test('goodsMovementText C → GI completa', () => {
    expect(goodsMovementText('C')).toBe('GI completa');
  });

  test('billingText A → Sin facturar', () => {
    expect(billingText('A')).toBe('Sin facturar');
  });
});
```

### 6.2 Test de integración del servicio: `test/monitor-sd-service.test.js`

```javascript
const cds = require('@sap/cds/lib');

describe('MonitorSDService', () => {
  const { GET } = cds.test('.').in('workspace/monitor_sd');

  it('GET SalesOrders devuelve pedidos con StatusText', async () => {
    const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders');
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value[0]).toHaveProperty('OverallSDProcessStatusText');
  });

  it('GET Deliveries filtradas por SalesOrderRef', async () => {
    const { data } = await GET(
      "/odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000001'"
    );
    expect(data.value.length).toBe(2);
    expect(data.value[0].SalesOrderRef).toBe('10000001');
  });

  it('GET BillingDocuments filtradas por DeliveryRef', async () => {
    const { data } = await GET(
      "/odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000001'"
    );
    expect(data.value.length).toBe(1);
    expect(data.value[0].BillingDocument).toBe('90000001');
  });

  it('GET Deliveries sin entrega para SO sin DocFlow', async () => {
    const { data } = await GET(
      "/odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000003'"
    );
    expect(data.value).toHaveLength(0);
  });
});
```

---

## Fase 7 — Conexión Real a S/4HANA (Futura)

Esta fase **no está incluida en el sprint actual**. Se documenta aquí para planificación.

### 7.1 Prerequisitos

- Instancia de SAP BTP con servicio de destino (`sap-destination-service`)
- Destinos configurados en BTP Cockpit:
  - `S4HANA_SALES_ORDER` → `https://<tenant>.s4hana.ondemand.com/sap/opu/odata/sap/API_SALES_ORDER_SRV`
  - `S4HANA_DELIVERY` → `https://<tenant>.s4hana.ondemand.com/sap/opu/odata/sap/OP_API_OUTBOUND_DELIVERY_SRV_0002`
  - `S4HANA_BILLING` → `https://<tenant>.s4hana.ondemand.com/sap/opu/odata/sap/API_BILLING_DOCUMENT_SRV`
- Usuario de comunicación en S/4 con autorizaciones para las tres APIs

### 7.2 Cambios en CAP para activar la conexión real

Retirar el bloque `"impl"` de los tres servicios en `package.json` para que CAP use el `RemoteService` por defecto. Los handlers de Fase 4 **no cambian** — solo cambia el origen de los datos.

### 7.3 Consideraciones de rendimiento

- Activar paginación en las proyecciones (`$top`, `$skip`)
- Añadir caché en-memoria para listas de pedidos (TTL ~1 minuto) si el volumen es alto
- El flujo de documentos (`SODocFlow`, `DeliveryDocFlow`) puede ser costoso: considerar llamadas paralelas con `Promise.all`

---

## Resumen de Entregables por Fase

| Fase | Entregable | Verificación |
|------|-----------|-------------|
| 1 | Proyecto CAP inicializado, dependencias instaladas | `npx cds version` sin errores |
| 2 | 3 EDMX importados + `monitor-sd-service.cds` | `npx cds build` verde |
| 3 | 3 ficheros mock `.js` + config en `package.json` | `GET /SalesOrders` → 3 registros |
| 4 | `monitor-sd-service.js` + `status-mapper.js` | Filtros por SalesOrderRef y DeliveryRef funcionan |
| 5 | `manifest.json` + `annotations.cds` | Pasos 1 y 2 del protocolo FE |
| 6 | Tests unitarios e integración verdes | `npm test` verde |
| 7 | (Futura) Destinos BTP + RemoteService activo | Deploy en BTP + smoke test |

---

## Decisiones Técnicas Clave

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Sin persistencia local (`@cds.persistence.skip` implícito) | Almacenar snapshots en HANA | El requisito exige datos en tiempo real de S/4 |
| In-process mock con arrays en memoria | CSV fixtures | Los externos no tienen tabla local; CSV requiere entidad DB |
| Campos virtuales para estados y referencias cruzadas | Calcular en UI | El handler CAP es el lugar correcto; la UI recibe siempre texto semántico |
| App FE única con routing interno | 3 apps independientes | Más simple; el routing N-niveles está soportado de forma nativa en FE |
| DocFlow vía SubsequentProcFlowDoc (SO→Entrega) | Filtrar Deliveries por SalesOrder directamente | La API de Delivery no tiene filtro directo por SalesOrder; la cadena de documentos es el contrato oficial de S/4 |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Los nombres de campo del EDMX importado difieren de los aquí documentados | Media | Verificar los `.cds` generados en Fase 2 antes de escribir la proyección |
| La navegación FE entre SalesOrders y Deliveries no funciona sin asociaciones OData | Alta | Añadir `Association` CDS y resolver con `$expand` en el handler si FE lo necesita |
| El DocFlow de Delivery no cubre todos los escenarios de facturación (facturas parciales, notas de crédito) | Media | El mock cubre el caso base; documentar como deuda técnica para Fase 7 |
| La categoría `'J'` para entregas en `SubsqntDocumentCategory` puede variar por cliente S/4 | Baja | Parametrizar el filtro de categoría en la configuración del servicio |
