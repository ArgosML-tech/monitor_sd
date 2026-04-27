# ABAPer Navigation Map — monitor_sd

> Última actualización: 2026-04-26
> Runtime CAP: @sap/cds 9.9.0
> Servicios: MonitorSDService → `/odata/v4/MonitorSDService/`
> Entidades principales: SalesOrders, Deliveries, BillingDocuments (todas proyecciones de APIs S/4 — sin persistencia local)
> UI / Fiori Elements: Sí — `app/monitor/`

---

## 1. Resumen de orientación

| Elemento | Valor |
|---|---|
| Proyecto | monitor_sd — Trazabilidad Sales-to-Cash |
| Runtime CAP | @sap/cds 9.9.0 |
| Servicios | MonitorSDService → `/odata/v4/MonitorSDService/` |
| Entidades expuestas | SalesOrders, Deliveries, BillingDocuments, SODocFlow, DeliveryDocFlow |
| Persistencia local | **Ninguna** — todos los datos vienen de S/4HANA en tiempo real |
| APIs S/4 consumidas | API_SALES_ORDER_SRV, OP_API_OUTBOUND_DELIVERY_SRV_0002, API_BILLING_DOCUMENT_SRV |
| Fiori Elements | Sí — `app/monitor/` — 3 niveles: ListReport → ObjectPage SO → ObjectPage Entrega |
| Última actualización del mapa | 2026-04-26 |

---

## 2. Equivalencias mentales ABAP → CAP

| En ABAP buscarías… | En CAP mira… | Archivos concretos | Notas |
|---|---|---|---|
| SE11 — tabla / estructura | No aplica — sin persistencia local | — | Los datos viven en S/4; CAP solo proyecta |
| CDS view / projection | `entity X as projection on / select from` | `srv/monitor-sd-service.cds` — entidades SalesOrders, Deliveries, BillingDocuments | `select from` en Deliveries y BillingDocuments para permitir campos `null as` en asociaciones |
| SEGW / OData service | `service MonitorSDService` | `srv/monitor-sd-service.cds` línea 5 | Path `/odata/v4/MonitorSDService/` |
| User-exit / BAdI — READ | `this.on('READ', ...)` | `srv/monitor-sd-service.js` líneas 16, 36, 74 | Tres handlers: SalesOrders, Deliveries, BillingDocuments |
| PBO / PAI / screen attributes | `@UI.*` en annotations | `srv/annotations.cds` | LineItem, DataPoint (criticidad), FieldGroup, Facets, HeaderInfo, Hidden |
| AUTHORITY-CHECK | No configurado | xs-security.json — **No existe** | Auth pendiente para Fase 7 |
| BAPI / RFC / external call | `srv/external/*.js` + `cds.connect.to()` | `srv/external/API_SALES_ORDER_SRV.js`, `OP_API_OUTBOUND_DELIVERY_SRV_0002.js`, `API_BILLING_DOCUMENT_SRV.js` | En local: mocks en-proceso. En producción: destinos BTP (ver §8) |
| Batch job / background | No encontrado | — | No aplica en este proyecto |

---

## 3. Modelo de datos

Este proyecto **no tiene `db/schema.cds`**. No hay tablas propias ni persistencia local. Las entidades son proyecciones de lectura sobre tres APIs OData V2 de S/4HANA.

| Pregunta ABAPer | Archivo | Entidad / aspecto | Campos clave | Notas |
|---|---|---|---|---|
| ¿Dónde está la tabla de pedidos? | `srv/monitor-sd-service.cds` línea 9 | `SalesOrders` | `SalesOrder` (String) | Proyección sobre `API_SALES_ORDER_SRV.A_SalesOrder` |
| ¿Dónde está la tabla de entregas? | `srv/monitor-sd-service.cds` línea 29 | `Deliveries` | `DeliveryDocument` (String) | Proyección sobre `A_OutbDeliveryHeader`; `SalesOrderRef = null as` para asociación |
| ¿Dónde está la tabla de facturas? | `srv/monitor-sd-service.cds` línea 48 | `BillingDocuments` | `BillingDocument` (String) | Proyección sobre `A_BillingDocument`; `DeliveryRef = null as` para asociación |
| ¿Dónde está el flujo de documentos SO→Entrega? | `srv/monitor-sd-service.cds` línea 65 | `SODocFlow` | `SalesOrder` + `DocRelationshipUUID` | Proyección sobre `A_SalesOrderSubsqntProcFlow`; `SubsequentDocumentCategory = 'J'` = entregas |
| ¿Dónde está el flujo de documentos Entrega→Factura? | `srv/monitor-sd-service.cds` línea 74 | `DeliveryDocFlow` | `PrecedingDocument` + `PrecedingDocumentItem` + `SubsequentDocumentCategory` | Proyección sobre `A_OutbDeliveryDocFlow`; `SubsequentDocumentCategory = 'M'` = facturas de venta |
| ¿Hay campos virtuales? | `srv/monitor-sd-service.cds` líneas 20, 40–41, 60 | SalesOrders, Deliveries, BillingDocuments | `*StatusText` | Calculados en handler; no se envían a S/4 |
| ¿Hay asociaciones entre entidades? | `srv/monitor-sd-service.cds` líneas 21, 42 | SalesOrders→Deliveries, Deliveries→BillingDocuments | `SalesOrderRef`, `DeliveryRef` | Resueltas por el handler vía DocFlow, no por JOIN de BD |

---

## 4. Servicios OData y contrato público

| Servicio | Archivo | Entidades expuestas | Actions | Path | Auth |
|---|---|---|---|---|---|
| `MonitorSDService` | `srv/monitor-sd-service.cds` | SalesOrders, Deliveries, BillingDocuments, SalesOrderItems, DeliveryItems, BillingDocumentItems, SODocFlow, DeliveryDocFlow | `ReleaseDeliveryBlock` (en SalesOrders), `PostGoodsIssue` (en Deliveries) | `/odata/v4/MonitorSDService/` | `SalesViewer` / `LogisticsUser` (`@requires` en servicio) |

Entidades de lectura: todas `@readonly`. Escritura solo via actions bound.

---

## 5. Lógica de negocio

| Comportamiento | Archivo | Handler / evento | Entidad | Test relacionado | Notas |
|---|---|---|---|---|---|
| Lectura pedidos + enriquecimiento + caché | `srv/monitor-sd-service.js` | `on('READ', SalesOrders)` | SalesOrders | `test/monitor-sd-service.test.js` | Caché TTL 60s; enriquece StatusText, DeliveryDelayDays, TotalBlockStatusText; paginación |
| Resolución SO→Entregas via DocFlow | `srv/monitor-sd-service.js` | `on('READ', Deliveries)` | Deliveries | `test/monitor-sd-service.test.js` | Consulta `A_SalesOrderSubsqntProcFlow` con `SubsequentDocumentCategory='J'` |
| Resolución Entrega→Facturas via DocFlow completo | `srv/monitor-sd-service.js` | `on('READ', BillingDocuments)` | BillingDocuments | `test/monitor-sd-service.test.js` | Consulta `A_OutbDeliveryDocFlow` con `SubsequentDocumentCategory: { in: ['M','N','O','P'] }` |
| Lectura posiciones pedido | `srv/monitor-sd-service.js` | `on('READ', SalesOrderItems)` | SalesOrderItems | `test/monitor-sd-service.test.js` | Extrae clave por `getFilter`/`getNavParentKey`; enriquece StatusText |
| Lectura posiciones entrega | `srv/monitor-sd-service.js` | `on('READ', DeliveryItems)` | DeliveryItems | `test/monitor-sd-service.test.js` | Extrae clave DeliveryDocument; enriquece GoodsMovementStatusText |
| Lectura posiciones factura | `srv/monitor-sd-service.js` | `on('READ', BillingDocumentItems)` | BillingDocumentItems | `test/monitor-sd-service.test.js` | Extrae clave BillingDocument |
| Acción: Registrar GI | `srv/monitor-sd-service.js` | `on('PostGoodsIssue', Deliveries)` | Deliveries | `test/monitor-sd-service.test.js` | `svc.send('PostGoodsIssue', ...)` + invalidar caché + re-leer entidad actualizada |
| Acción: Quitar bloqueo entrega | `srv/monitor-sd-service.js` | `on('ReleaseDeliveryBlock', SalesOrders)` | SalesOrders | `test/monitor-sd-service.test.js` | PATCH via `soAPI.send({method:'PATCH', ...})` + invalidar caché + re-leer |
| Traducción códigos de estado | `srv/lib/status-mapper.js` | funciones exportadas | todos | `test/status-mapper.test.js` | sdProcessText, goodsMovementText, pickingText, billingText, deliveryHdrText, billingHdrText, billingCategoryText, deliveryDelayDays |
| Manejo de errores S/4 centralizado | `srv/lib/remote-error.js` | `runRemote()`, `runAction()` | todos | — | `runRemote` para queries CQN vía `svc.run()`; `runAction` para `svc.send()` Promises |
| Extracción de filtros del CQN | `srv/lib/mock-filter.js` | `getFilter()`, `getNavParentKey()` | — | — | Busca en `SELECT.where` Y `SELECT.from.ref[n].where`; necesario para key lookups y navegación N-nivel |

---

## 6. Pantalla / Fiori Elements

| Pregunta | Archivo | Anotación | Entidad | Efecto visible |
|---|---|---|---|---|
| ¿Qué columnas hay en el Monitor de Pedidos? | `srv/annotations.cds` | `@UI.LineItem` | `SalesOrders` | Pedido, Cliente, Ref. cliente, Creación, Entrega solicit., Importe neto, Moneda, Estado (semáforo), **Bloqueo** (rojo si bloqueado), **Retraso** (días con criticidad), **Quitar bloqueo** (inline action) |
| ¿Cómo se muestra el estado del pedido con color? | `srv/annotations.cds` | `@UI.DataPoint#SOStatus` | `SalesOrders` | Criticidad: A=verde, B=naranja, C=neutral |
| ¿Cómo se muestra el bloqueo? | `srv/annotations.cds` | `@UI.DataPoint#BlockStatus` | `SalesOrders` | Rojo si `TotalBlockStatus != ''`, neutral si vacío |
| ¿Cómo se muestran los días de retraso? | `srv/annotations.cds` | `@UI.DataPoint#DelayDays` | `SalesOrders` | >7 días = rojo, 1–7 = naranja, 0 = neutral/azul |
| ¿Qué filtros hay en la List Report? | `srv/annotations.cds` | `@UI.SelectionFields` | `SalesOrders` | SoldToParty, SalesOrganization, CreationDate, OverallSDProcessStatus |
| ¿Qué secciones tiene el ObjectPage del pedido? | `srv/annotations.cds` | `@UI.Facets` | `SalesOrders` | "Información del pedido" (General + **Importes** con Estado entrega / facturación) + "Entregas" (tabla) + **"Posiciones del pedido"** |
| ¿Qué columnas hay en la tabla de posiciones de pedido? | `srv/annotations.cds` | `@UI.LineItem` | `SalesOrderItems` | Pos., Material, Descripción, Cantidad, UM, Importe, Mon., Estado entrega, Estado |
| ¿Qué columnas hay en la tabla de entregas? | `srv/annotations.cds` | `@UI.LineItem` | `Deliveries` | Entrega, Punto envío, Fecha prev., Fecha GI, Picking, Estado GI (icono), **Registrar GI** (inline action) |
| ¿Qué secciones tiene el ObjectPage de entrega? | `srv/annotations.cds` | `@UI.Facets` | `Deliveries` | "Datos de entrega" + "Facturas" (tabla) + **"Posiciones de entrega"** |
| ¿Hay botón en la cabecera del ObjectPage de entrega? | `srv/annotations.cds` | `@UI.Identification` | `Deliveries` | "Registrar salida de mercancía" (habilitado si GI no completada) |
| ¿Qué columnas hay en la tabla de facturas? | `srv/annotations.cds` | `@UI.LineItem` | `BillingDocuments` | **Tipo** (Factura/Nota de crédito/…), Factura, Fecha, Importe bruto, Moneda, Doc. contable, Estado, Cancelada (icono) |
| ¿Qué secciones tiene el ObjectPage de factura? | `srv/annotations.cds` | `@UI.Facets` | `BillingDocuments` | "Datos de factura" + **"Posiciones de factura"** |
| ¿Qué columnas hay en la tabla de posiciones de factura? | `srv/annotations.cds` | `@UI.LineItem` | `BillingDocumentItems` | Pos., Material, Descripción, Cantidad, UM, Imp. neto, IVA, Imp. bruto, Mon., Entrega ref. |
| ¿Qué campos están ocultos? | `srv/annotations.cds` líneas 4–5 | `@UI.Hidden` | Deliveries.SalesOrderRef, BillingDocuments.DeliveryRef | Campos de enlace interno — nulos en OData, invisible en UI |
| ¿Cuáles son las rutas de la app? | `app/monitor/webapp/manifest.json` | `sap.ui5.routing.targets` | — | SalesOrdersList (LR), SalesOrdersObjectPage (OP nivel 1), DeliveriesObjectPage (OP nivel 2), **BillingDocumentsObjectPage** (OP nivel 3) |
| ¿Cómo se configura la navegación L1→L2→L3→L4? | `app/monitor/webapp/manifest.json` | `navigation` en targets | SalesOrders→Deliveries→BillingDocuments | Patterns: `""` / `SalesOrders({k})` / `SalesOrders({k})/Deliveries({k})` / `SalesOrders({k})/Deliveries({k})/BillingDocuments({k})` |
| ¿Cuándo se habilita/deshabilita una action? | `srv/monitor-sd-service.cds` | `@Core.OperationAvailable` | SalesOrders, Deliveries | `$edmJson.$Ne` contra `DeliveryBlockReason` (ReleaseDeliveryBlock) y contra `OverallGoodsMovementStatus` (PostGoodsIssue) |

---

## 7. Autorizaciones

| Elemento | Estado | Notas |
|---|---|---|
| `xs-security.json` | **Existe** (`xs-security.json`) | Scopes: `SalesViewer`, `LogisticsUser`. Attribute: `SalesOrganization` para row-level filtering |
| `@requires` en el servicio | `@requires: 'SalesViewer'` en `srv/monitor-sd-service.cds` | Activo. En local usa `kind: mocked` que omite auth |
| `@restrict` a nivel entidad | **No configurado** | Las acciones de escritura requieren scope `LogisticsUser` pero no está en CDS — TODO para Fase 7 |
| Filtro row-level por organización | `srv/monitor-sd-service.js` — `on('READ', SalesOrders)` | `if (orgAttr) query.where({ SalesOrganization: orgAttr })` — filtra por atributo JWT en producción |

---

## 8. Integraciones externas

| Sistema / API | Modelo importado | Alias CAP | Mock local | Config producción | Handler consumidor |
|---|---|---|---|---|---|
| S/4HANA — Sales Orders | `srv/external/API_SALES_ORDER_SRV.csn` | `SalesOrderAPI` | `srv/external/API_SALES_ORDER_SRV.js` | Destino BTP: `S4HANA_SALES_ORDER` en `.cdsrc.json` perfil `[production]` | `srv/monitor-sd-service.js` líneas 9, 20–31, 46–52 |
| S/4HANA — Outbound Deliveries | `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.csn` | `DeliveryAPI` | `srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js` | Destino BTP: `S4HANA_DELIVERY` | `srv/monitor-sd-service.js` líneas 10, 54–68, 84–88 |
| S/4HANA — Billing Documents | `srv/external/API_BILLING_DOCUMENT_SRV.csn` | `BillingAPI` | `srv/external/API_BILLING_DOCUMENT_SRV.js` | Destino BTP: `S4HANA_BILLING` | `srv/monitor-sd-service.js` líneas 11, 92–98 |

**Cómo cambia el origen de datos al pasar de mock a S/4 real:** retirar el bloque `"impl"` de los tres servicios en `package.json` → CAP usa automáticamente el `RemoteService` con las credenciales del destino BTP. Los handlers no cambian.

---

## 9. Tests y depuración rápida

| Comportamiento probado | Archivo | Qué valida |
|---|---|---|
| Mapeo A/B/C de los 4 tipos de estado | `test/status-mapper.test.js` | 16 casos: sdProcessText, goodsMovementText, pickingText, billingText + fallback a código crudo |
| GET SalesOrders — lista y StatusText | `test/monitor-sd-service.test.js` | 3 pedidos, campos `OverallSDProcessStatusText` presentes y correctos |
| Lookup por clave SalesOrders | `test/monitor-sd-service.test.js` | SalesOrders('10000002') retorna el pedido correcto |
| DocFlow SO→Entregas | `test/monitor-sd-service.test.js` | SO con 2 entregas, SO con 1 entrega, SO sin entregas |
| DocFlow Entrega→Facturas ($filter) | `test/monitor-sd-service.test.js` | Entrega con 1 factura, entrega sin facturas |
| Navegación OData Deliveries/BillingDocuments | `test/monitor-sd-service.test.js` | Path de navegación 3-nivel retorna solo facturas de la entrega correcta |

Comandos del proyecto:
```bash
# Arrancar en desarrollo (con hot reload)
npx cds watch

# Ejecutar todos los tests
npm test

# Compilar
npx cds build

# URL de preview Fiori Elements (con cds watch activo)
# http://localhost:4004/$fiori-preview/MonitorSDService/SalesOrders#preview-app
```

---

## 10. No encontrado / No aplica

### No aplica (fuera del alcance de este proyecto)
- `db/schema.cds` — sin persistencia local; los datos vienen de S/4 en tiempo real
- `@requires` / `xs-security.json` — autorizaciones pendientes de Fase 7 (deploy BTP)
- `mta.yaml` — pendiente de Fase 7
- Draft workflow (`@odata.draft.enabled`) — aplicación de solo lectura, sin draft
- Batch job / `cds.spawn()` — no aplica en este dominio
- Fiori Elements acciones de escritura (`@UI.DataFieldForAction`) — todas las entidades son `@readonly`

### Pendiente de localizar (debería existir pero no se encontró)
- Tests de autorización — no existen; a crear cuando se añada `xs-security.json` en Fase 7
- `$top`/`$skip` / paginación en los handlers — no implementada; necesaria para volúmenes S/4 reales
- Manejo de errores HTTP de S/4 (timeouts, 4xx, 5xx) — no implementado en los handlers actuales
