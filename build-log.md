# Build log — monitor_sd — 2026-04-26 (actualizado 2026-04-27 verificación navegación)

> Generado automáticamente. Revisar para incorporar gaps al skill.

## Incidencias registradas — Plan 2 Fase 5 (UI: Anotaciones FE)

### Fase 5 — Anotaciones FE / Navegación 3er nivel — CAUSA RAÍZ CORREGIDA (2026-04-27)

- **Síntoma original:** En `/$fiori-preview/MonitorSDService/SalesOrders`, las filas de BillingDocuments no tienen chevron `>` y no navegan al BillingDocumentsObjectPage.
- **Causa real (verificada):** `/$fiori-preview` genera un manifest ad-hoc que SOLO incluye las asociaciones directas de la entidad raíz especificada. Para `SalesOrders`, genera rutas hasta Deliveries (2 niveles) pero NO incluye la ruta `BillingDocumentsRoute`. El manifest del componente `monitor.sd` real (`app/monitor/webapp/manifest.json`) SÍ tiene los 4 niveles correctamente configurados.
- **Verificación:** Usando `/$fiori-preview/MonitorSDService/Deliveries` (que genera un manifest con ruta BillingDocuments), la navegación Entrega → Factura → ObjectPage de Factura funciona correctamente, mostrando datos de cabecera y posiciones (IVA, importes).
- **Conclusión:** No hay limitación de FE para navegación de 3er/4er nivel. El manifest, rutas, navigation config, anotaciones y handlers son correctos. La app `monitor.sd` funcionará end-to-end en producción (BTP Launchpad).
- **Diagnóstico erróneo previo descartado:** No es limitación del FE Preview Framework — es una limitación específica del manifest generado automáticamente por `cds-fiori` para la entidad `SalesOrders`.
- **Reference candidata:** `references/09-cap-frontend-fiori.md` — añadir nota sobre limitación de `/$fiori-preview` manifest generado (solo 2 niveles desde la entidad raíz).

---

## Incidencias registradas — Plan 2 (Fases 1–4)

### Fase 1 — Infraestructura de handlers

- **Síntoma:** `runRemote` detectaba CQN queries como Promises usando `typeof .then === 'function'`, causando que `SELECT.from()` se ejecutara contra la base de datos local en lugar de delegarse al servicio remoto.
- **Causa:** En CAP, los objetos CQN (`SELECT.from(...)`, `INSERT.into(...)`, etc.) implementan la interfaz thenable para permitir `await query` directamente. Son thenables pero NO son Promises — no deben tratarse como el resultado de `send()`.
- **Fix aplicado:** Funciones separadas: `runRemote(req, svc, cqnQuery)` para queries CQN (usa `svc.run()`), y `runAction(req, promise)` para el resultado de `svc.send()` (await directo).
- **Reference candidata:** `references/03-node-handlers.md`

---

- **Síntoma:** `runAction` mapeaba errores de `req.reject(400, ...)` a 502 en lugar de propagar el 400.
- **Causa:** CAP pone el código de error en `err.code` (number `400`), no en `err.status`. El patrón `err.status ?? 503` siempre resolví a 503 porque `err.status` era `undefined`.
- **Fix aplicado:** `err.status ?? (typeof err.code === 'number' ? err.code : 503)` — verifica ambas propiedades.
- **Reference candidata:** `references/03-node-handlers.md`

---

### Fase 2 — Modelo CDS / Mocks

- **Síntoma:** El handler del mock de DocFlow fallaba silenciosamente cuando el filtro de categoría era un array (operador `in`), devolviendo colección vacía en lugar de los documentos esperados.
- **Causa:** `getFilter` devuelve un array `['M','N','O','P']` cuando el WHERE usa el operador `in`. El mock comparaba con `r.field === catVal`, lo que falla contra un array.
- **Fix aplicado:** `Array.isArray(catVal) ? catVal.includes(r.SubsequentDocumentCategory) : r.SubsequentDocumentCategory === catVal`. Patrón necesario en cualquier mock que filtre por campos con operador `in`.
- **Reference candidata:** `references/10-cap-external-services.md`

---

### Fase 4 — Acciones de escritura

- **Síntoma:** `@cap-js/audit-logging` no estaba documentado como plugin plug-and-play en las referencias.
- **Causa:** Gap de conocimiento — no había documentación sobre el comportamiento en desarrollo.
- **Fix aplicado:** Instalar con `npm add @cap-js/audit-logging`; el plugin se auto-registra como servicio `audit-log`; en desarrollo escribe en consola sin configuración adicional; en producción BTP requiere binding del servicio SAP Audit Log Service.
- **Reference candidata:** `references/13-btp-plugins-services.md`

---

## Incidencias registradas — Plan 1 (Fases 1–7 originales)

### Fase 2 — Importación EDMX

- **Síntoma:** `cds import <file> --as odata-v2` lanza error "please specify one of these output file format [cds, csn, json]"
- **Causa:** En CDS 9.x el flag `--as` solo acepta formatos de salida, no el tipo de entrada. El protocolo OData v2 se autodetecta desde el EDMX.
- **Fix aplicado:** `cds import <file>` sin `--as`. El comando detecta OData V2 automáticamente.
- **Reference candidata:** `references/10-cap-external-services.md`

---

- **Síntoma:** Los nombres de entidad en el CSN generado no coinciden con los del EDMX. Ej: `A_SalesOrderType` → `A_SalesOrder`, `A_OutbDeliveryHeaderType` → `A_OutbDeliveryHeader`.
- **Causa:** El compilador CDS elimina el sufijo `Type` al generar los modelos desde EDMX OData V2.
- **Fix aplicado:** Inspeccionar el `.csn` generado antes de escribir proyecciones, no confiar en los nombres del EDMX directamente.
- **Reference candidata:** `references/10-cap-external-services.md`

---

- **Síntoma:** `A_SalesOrderSubsqntProcFlow` tiene campos `SubsequentDocument` y `SubsequentDocumentCategory` (no `SubsqntDocument` / `SubsqntDocumentCategory` como en el EDMX), y su clave es compuesta: `SalesOrder` + `DocRelationshipUUID`.
- **Causa:** Los alias en el EDMX V2 se normalizan durante la compilación CDS. Los nombres cortos del EDMX no son los nombres definitivos del modelo.
- **Fix aplicado:** Leer el CSN generado para confirmar nombres exactos antes de escribir handlers.
- **Reference candidata:** `references/10-cap-external-services.md`

---

- **Síntoma:** En `A_OutbDeliveryDocFlow`, el campo que apunta al documento posterior (factura) es `Subsequentdocument` con 'd' minúscula.
- **Causa:** Inconsistencia de capitalización en la API estándar de SAP — el compilador CDS preserva el casing del EDMX tal cual.
- **Fix aplicado:** Verificar capitalización exacta en el CSN antes de referenciar campos en handlers y mocks.
- **Reference candidata:** `references/10-cap-external-services.md`

---

### Fase 2/3 — CDS init

- **Síntoma:** `cds init . --add hana,approuter` falla con "First decide if this is a Node.js or Java project".
- **Causa:** CDS 9.x exige elegir explícitamente `--nodejs` o `--java`.
- **Fix aplicado:** `cds init . --nodejs --add hana,approuter`.
- **Reference candidata:** `references/01-cap-core.md`

---

### Fase 3 — Mocks en-proceso / CQN

- **Síntoma:** El handler de mocks extrae filtros de `req.query.SELECT.where`, pero para accesos por clave (`EntitySet('key')`) el filtro llega en `req.query.SELECT.from.ref[0].where`.
- **Causa:** CAP representa el key lookup como un filtro en el `from` del CQN, no en el `where` del SELECT.
- **Fix aplicado:** Helper `getFilter(selectClause, field)` que busca en ambas ubicaciones: `SELECT.where` y `SELECT.from.ref[0].where`.
- **Reference candidata:** `references/03-node-handlers.md` y `references/10-cap-external-services.md`

---

### Fase 4 — Handler + navegación OData

- **Síntoma:** Para rutas de navegación de 3 niveles (`SalesOrders('X')/Deliveries('Y')/BillingDocuments`), la clave del padre inmediato (`DeliveryDocument`) está en `SELECT.from.ref[1].where`, no en `from.ref[0].where`.
- **Causa:** CAP codifica en el `from.ref` la cadena completa de navegación: `ref[0]` = entidad raíz, `ref[1]` = entidad intermedia, `ref[2]` = propiedad de navegación final. La clave del padre inmediato está en el penúltimo segmento.
- **Fix aplicado:** `getNavParentKey` itera todos los segmentos de `from.ref` buscando el campo clave, en vez de asumir posición fija.
- **Reference candidata:** `references/03-node-handlers.md`

---

### Fase 5 — CDS model + asociaciones

- **Síntoma:** Error de compilación: "Virtual elements can't be used in expressions" al definir `Association to many X on X.VirtualField = $self.KeyField`.
- **Causa:** CDS no permite campos `virtual` en condiciones ON de asociaciones — las asociaciones son metadatos estructurales que deben poder evaluarse estáticamente.
- **Fix aplicado:** Cambiar la entidad de `projection on` a `select from` y añadir `null as FieldName : Type` para crear un campo no-virtual con valor nulo por defecto. El handler lo sobrescribe en tiempo de ejecución.
- **Reference candidata:** `references/11-cds-modeling-guardrails.md`

---

- **Síntoma:** `cds.serve(...).from(...).catch(...)` lanza "is not a function" en CAP 9.x.
- **Causa:** La API de `cds.serve()` cambió en CAP 9 — ya no devuelve una Promise encadenable con `.from().catch()`.
- **Fix aplicado:** Usar `cds.serve('all').from('.')` sin `.catch()` encadenado; gestionar errores con try/catch o con el event `'error'`.
- **Reference candidata:** `references/01-cap-core.md`

---

### Fase 5 — Fiori Elements / playwright-praman

- **Síntoma:** `waitForUI5Stable` de playwright-praman agota el timeout aunque la aplicación FE se renderiza correctamente.
- **Causa:** `waitForUI5Stable` espera señales de red OData batch que S/4 emite de forma específica. Los mocks en-proceso de CAP no replican esas señales, por lo que el bridge de praman nunca detecta la estabilidad. El DOM sí está completo.
- **Fix aplicado:** Usar Playwright nativo (`page.waitForTimeout` + `page.screenshot`) para la validación visual cuando los mocks en-proceso no satisfacen `waitForUI5Stable`. Documentar que praman estará completamente funcional contra S/4 real en Fase 7.
- **Reference candidata:** `references/09-cap-frontend-fiori.md`

---

### Fase 6 — Tests

- **Síntoma:** `jest --testPathPattern=test/` falla con "Option was replaced by --testPathPatterns".
- **Causa:** Jest 30 renombró `--testPathPattern` (singular) a `--testPathPatterns` (plural).
- **Fix aplicado:** Actualizar el script de test en `package.json`.
- **Reference candidata:** `references/05-testing-deployment.md`
