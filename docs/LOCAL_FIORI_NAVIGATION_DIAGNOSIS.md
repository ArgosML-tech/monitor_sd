# Diagnóstico y resolución local — navegación Pedido → Entrega → Factura

> Proyecto: `monitor_sd`  
> Fecha de cierre: 2026-04-27  
> Alcance: validación local de la app Fiori Elements real `monitor.sd` en `/home/juanma/workspace/sap/cap-n8n/workspace/monitor_sd`

---

## 1. Resumen ejecutivo

El problema revisado era la aparente imposibilidad de navegar desde el flujo completo:

```text
SalesOrders → Deliveries → BillingDocuments
```

En concreto, al usar:

```text
/$fiori-preview/MonitorSDService/SalesOrders#preview-app
```

la tabla de facturas dentro del ObjectPage de entrega no mostraba navegación hacia el ObjectPage de factura.

La causa final no era un fallo de OData, ni de handlers, ni de asociaciones CDS. El problema era que `/$fiori-preview` genera un manifest temporal y limitado para la entidad raíz que se le indica. Cuando se entra desde `SalesOrders`, ese manifest generado no contiene toda la ruta profunda hacia `BillingDocuments`.

La app real `monitor.sd`, cargada con su propio `app/monitor/webapp/manifest.json`, sí navega correctamente:

```text
SalesOrders('10000001')
  → Deliveries('80000001')
  → BillingDocuments('90000001')
```

Se resolvió creando una vía local fiable de validación mediante un FLP sandbox local:

```text
app/monitor/webapp/test/flpSandbox.html
```

---

## 2. Síntoma inicial

En desarrollo local se usaba esta URL:

```text
http://localhost:4004/$fiori-preview/MonitorSDService/SalesOrders#preview-app
```

El flujo observado era:

```text
ListReport SalesOrders
  → ObjectPage SalesOrder
  → tabla Deliveries
  → ObjectPage Delivery
  → tabla BillingDocuments sin navegación completa
```

Esto generaba la sospecha de que Fiori Elements no soportaba bien el tercer nivel de navegación, o que el manifest real estaba mal configurado.

---

## 3. Qué estaba correcto desde el principio

### 3.1. Modelo CDS

El modelo expone correctamente las entidades y asociaciones principales:

```text
SalesOrders
  → Deliveries
    → BillingDocuments
      → BillingDocumentItems
```

Archivo:

```text
srv/monitor-sd-service.cds
```

Puntos relevantes:

- `SalesOrders` tiene asociación `Deliveries`.
- `Deliveries` tiene asociación `BillingDocuments`.
- `BillingDocuments` tiene asociación `Items`.
- `SalesOrderRef` y `DeliveryRef` son campos técnicos no virtuales (`null as ...`) para permitir asociaciones CDS válidas.

### 3.2. Handlers

Archivo:

```text
srv/monitor-sd-service.js
```

La lógica de lectura resuelve las navegaciones mediante DocFlow:

- `SalesOrders → Deliveries`: usando `A_SalesOrderSubsqntProcFlow`.
- `Deliveries → BillingDocuments`: usando `A_OutbDeliveryDocFlow`.
- `BillingDocuments → Items`: usando `A_BillingDocumentItem`.

Además, `getNavParentKey` soporta rutas profundas, no solo navegación de un nivel.

### 3.3. Anotaciones FE

Archivo:

```text
srv/annotations.cds
```

Las anotaciones definen:

- ListReport de pedidos.
- ObjectPage de pedido.
- Tabla de entregas.
- ObjectPage de entrega.
- Tabla de facturas.
- ObjectPage de factura.
- Tabla de posiciones de factura.

### 3.4. Manifest real de la app

Archivo:

```text
app/monitor/webapp/manifest.json
```

El manifest real contiene rutas para:

```text
""
SalesOrders({SalesOrdersKey})
SalesOrders({SalesOrdersKey})/Deliveries({DeliveriesKey})
SalesOrders({SalesOrdersKey})/Deliveries({DeliveriesKey})/BillingDocuments({BillingDocumentsKey})
```

Por tanto, el problema no estaba en que faltara la ruta profunda en la app real.

---

## 4. Causa raíz acotada

`/$fiori-preview` no carga necesariamente el manifest real de `app/monitor/webapp/manifest.json`.

Cuando se abre:

```text
/$fiori-preview/MonitorSDService/SalesOrders#preview-app
```

CAP genera un componente `preview` temporal con un manifest temporal. Ese manifest se construye alrededor de la entidad raíz `SalesOrders`.

Ese manifest generado incluye navegación directa desde `SalesOrders`, pero no reproduce toda la navegación profunda configurada en la app real `monitor.sd`.

La prueba que acotó esto fue abrir:

```text
/$fiori-preview/MonitorSDService/Deliveries#preview-app
```

Al tomar `Deliveries` como entidad raíz, el manifest generado por preview sí incluía `BillingDocuments`, y la navegación:

```text
Deliveries → BillingDocuments → ObjectPage de factura
```

funcionó correctamente.

Conclusión:

```text
El backend y las anotaciones funcionaban.
El manifest real funcionaba conceptualmente.
Lo que no servía como prueba completa era /$fiori-preview/MonitorSDService/SalesOrders.
```

---

## 5. Problemas encontrados al intentar validar localmente el manifest real

Se intentaron dos aproximaciones locales:

### 5.1. Standalone HTML

Archivo:

```text
app/monitor/webapp/test/standalone.html
```

Problema:

- Fiori Elements carga parcialmente.
- Faltan servicios de shell (`ShellUIService`, inner app state, etc.).
- Aparecen placeholders o estados incompletos.

Decisión final:

```text
standalone.html no se usa como vía de validación.
Ahora redirige al FLP sandbox local.
```

### 5.2. FLP sandbox manual con UI5 1.145

Problemas encontrados:

- `sap.fe.core.AppRouter.js` no se carga como archivo directo desde CDN.
- El shell podía intentar resolver `monitor/manifest.json` desde el CDN si faltaba el resource root adecuado.
- Con UI5 1.145 aparecía un problema de parseo de metadata interna de filtros:

```text
Unexpected token '\', "[\{"key":"S"... is not valid JSON
```

Se dejó un workaround local de `JSON.parse` en el HTML de sandbox, pero la solución robusta para este proyecto fue fijar el sandbox local a UI5 `1.120.0`, que coincide con la versión mínima declarada en el manifest.

---

## 6. Solución local final

La vía local válida es:

```text
app/monitor/webapp/test/flpSandbox.html
```

URL con `cds watch`:

```text
http://localhost:4004/monitor/webapp/test/flpSandbox.html
```

Si CAP arranca en puerto alternativo:

```text
http://localhost:<PUERTO>/monitor/webapp/test/flpSandbox.html
```

Durante la validación de esta sesión, CAP arrancó en:

```text
http://localhost:43529/monitor/webapp/test/flpSandbox.html
```

### 6.1. Qué hace el sandbox

El sandbox:

- Arranca `sap.ushell` en modo FLP sandbox.
- Registra la app `monitor.sd`.
- Apunta al componente real:

```text
app/monitor/webapp/Component.js
```

- Carga el manifest real:

```text
app/monitor/webapp/manifest.json
```

- Usa UI5:

```text
1.120.0
```

### 6.2. Por qué UI5 1.120.0

El manifest declara:

```json
"minUI5Version": "1.120.0"
```

Con `1.120.0`, el FLP sandbox local:

- Carga el shell.
- Carga el componente real.
- Ejecuta `$batch`.
- Pinta datos reales de mock.
- Navega por todos los niveles.

Con `1.145.0`, en esta configuración local manual aparecieron problemas no relacionados con el backend ni con el manifest funcional, especialmente en filtros/macros y parseo de metadata interna.

---

## 7. Cambios aplicados para hacer viable la validación

### 7.1. `manifest.json`

Archivo:

```text
app/monitor/webapp/manifest.json
```

Cambios relevantes:

1. Se eliminó `routerClass: "sap.fe.core.AppRouter"`.

Motivo:

```text
En el bootstrap local, UI5 intentaba cargar sap/fe/core/AppRouter.js como archivo directo.
Ese recurso no está disponible así en el CDN.
El preview generado por CAP tampoco define routerClass explícito.
```

2. Se eliminaron settings manuales de `routing.config`.

Motivo:

```text
Dejar que sap.fe.core.AppComponent gestione el enrutado como hace el preview generado.
```

3. Se cambió `entitySet` por `contextPath`.

Ejemplo:

```json
"contextPath": "/SalesOrders"
```

Motivo:

```text
Es el formato usado por los manifests generados por CAP Fiori preview y funciona mejor con FE V4.
```

4. Se añadieron settings de modelo alineados con CAP preview:

```json
"preload": true,
"settings": {
  "synchronizationMode": "None",
  "operationMode": "Server",
  "autoExpandSelect": true,
  "earlyRequests": true,
  "groupId": "$direct"
}
```

### 7.2. `flpSandbox.html`

Archivo:

```text
app/monitor/webapp/test/flpSandbox.html
```

Responsabilidad:

```text
Validar localmente la app real monitor.sd dentro de un shell FLP sandbox.
```

Puntos clave:

- Usa `sap-ushell-bootstrap`.
- Usa `sap-ui-core.js`.
- Declara `MonitorSD-display`.
- Tiene resource roots:

```json
{
  "monitor.sd": "/monitor/webapp",
  "monitor": "/monitor/webapp"
}
```

El segundo resource root (`monitor`) evita que UI5 intente resolver `monitor/manifest.json` desde el CDN.

### 7.3. `standalone.html`

Archivo:

```text
app/monitor/webapp/test/standalone.html
```

Estado final:

```text
Redirige a flpSandbox.html.
```

Motivo:

```text
El standalone puro no es una validación fiable para esta app FE porque faltan servicios de shell.
```

### 7.4. `fioriSandboxConfig.json`

Archivo:

```text
app/appconfig/fioriSandboxConfig.json
```

Contenido:

```json
{
  "services": {},
  "renderers": {}
}
```

Motivo:

```text
Evita un 404 del FLP sandbox al buscar /appconfig/fioriSandboxConfig.json.
```

---

## 8. Cómo repetir la validación local

### 8.1. Arrancar CAP

Desde la raíz del proyecto:

```bash
cd /home/juanma/workspace/sap/cap-n8n/workspace/monitor_sd
npx cds watch
```

Si el puerto `4004` está libre, abrir:

```text
http://localhost:4004/monitor/webapp/test/flpSandbox.html
```

Si CAP indica otro puerto, usar ese puerto:

```text
http://localhost:<PUERTO>/monitor/webapp/test/flpSandbox.html
```

### 8.2. Flujo manual esperado

1. Se abre la app `Monitor Sales-to-Cash`.
2. La ListReport muestra `Pedidos de venta (3)`.
3. Click en pedido:

```text
10000001
```

4. Se abre el ObjectPage del pedido:

```text
SalesOrders('10000001')
```

5. En la sección `Entregas`, click en:

```text
80000001
```

6. Se abre el ObjectPage de entrega:

```text
SalesOrders('10000001')/Deliveries('80000001')
```

7. En la sección `Facturas`, se muestran:

```text
90000001
90000099
```

8. Click en:

```text
90000001
```

9. Se abre el ObjectPage de factura:

```text
SalesOrders('10000001')/Deliveries('80000001')/BillingDocuments('90000001')
```

10. Se muestran:

- Datos de factura.
- Clase factura `F2`.
- Fecha.
- Importe bruto.
- Documento contable.
- Estado de facturación.
- Posiciones de factura.
- IVA / importe neto.

---

## 9. Evidencia de validación realizada

Durante la prueba local se confirmó:

### 9.1. ListReport

URL:

```text
.../flpSandbox.html#MonitorSD-display
```

Datos visibles:

```text
Pedidos de venta (3)
10000001
10000002
10000003
```

### 9.2. ObjectPage de pedido

URL:

```text
...#MonitorSD-display&/SalesOrders('10000001')
```

Datos visibles:

```text
Pedido de venta
10000001
C001
Posiciones del pedido (2)
Entregas (2)
80000001
80000002
```

### 9.3. ObjectPage de entrega

URL:

```text
...#MonitorSD-display&/SalesOrders('10000001')/Deliveries('80000001')
```

Datos visibles:

```text
Entrega
80000001
Facturas (2)
90000001
90000099
```

### 9.4. ObjectPage de factura

URL:

```text
...#MonitorSD-display&/SalesOrders('10000001')/Deliveries('80000001')/BillingDocuments('90000001')
```

Datos visibles:

```text
Factura
90000001
Clase factura F2
Doc. contable ACC0001
Posiciones de factura (1)
MAT-001
Imp. neto 10.000,000
IVA 2.100,000
```

---

## 10. Verificaciones técnicas ejecutadas

### 10.1. Tests

Comando:

```bash
npm test -- --runInBand
```

Resultado:

```text
Test Suites: 2 passed, 2 total
Tests:       52 passed, 52 total
Snapshots:   0 total
```

Nota:

```text
Dentro del sandbox restringido de Codex, cds-test no podía abrir puerto y fallaba con EPERM.
Ejecutado fuera del sandbox, pasó correctamente.
```

### 10.2. Build CAP

Comando:

```bash
npx cds build
```

Resultado:

```text
build completed
```

---

## 11. Conclusión final

El problema está acotado y resuelto localmente.

No era un bug del flujo OData ni de los handlers. Tampoco faltaban anotaciones para `BillingDocuments`.

La confusión venía de usar `/$fiori-preview/MonitorSDService/SalesOrders` como si fuera una prueba completa de la app real. Esa URL prueba un manifest generado por CAP para preview, no el manifest productivo de `monitor.sd`.

La validación correcta local es:

```text
http://localhost:<PUERTO>/monitor/webapp/test/flpSandbox.html
```

Esa URL carga:

```text
Component.js real
manifest.json real
MonitorSDService real local
mocks locales
FLP sandbox
```

Y permite validar de punta a punta:

```text
Pedido → Entrega → Factura → Posiciones de factura
```

---

## 12. Implicación para BTP

La prueba local con `flpSandbox.html` reduce mucho el riesgo antes de desplegar a BTP.

Para BTP, lo importante será que el Launchpad / HTML5 Application Repository cargue el componente real `monitor.sd` y no un preview generado.

El siguiente bloque pendiente ya no es la navegación FE, sino la productivización:

- `mta.yaml`
- HTML5 Application Repository
- Approuter / destinations
- XSUAA
- bindings de Audit Log
- destinos S/4 reales:

```text
S4HANA_SALES_ORDER
S4HANA_DELIVERY
S4HANA_BILLING
```

