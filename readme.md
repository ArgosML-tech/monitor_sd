# monitor_sd — Monitor Sales-to-Cash

Aplicación SAP CAP + Fiori Elements para trazabilidad 360 grados del flujo Sales-to-Cash:

```text
Pedido de venta → Entrega → Factura → Posiciones
```

El objetivo es dar una vista única para seguir un pedido desde SD hasta logística y facturación, sin tener que saltar entre transacciones o apps estándar de SAP.

---

## Estado actual

- Backend CAP OData V4: `MonitorSDService`.
- Frontend Fiori Elements V4: app `monitor.sd`.
- Datos locales mockeados mediante servicios externos en proceso.
- Sin persistencia propia de negocio: la app está pensada para consultar S/4HANA en tiempo real.
- Flujo local validado con FLP sandbox real:

```text
SalesOrders('10000001')
  → Deliveries('80000001')
  → BillingDocuments('90000001')
```

Ver diagnóstico completo:

```text
docs/LOCAL_FIORI_NAVIGATION_DIAGNOSIS.md
```

---

## Requisitos

- Node.js compatible con el proyecto actual.
- Dependencias instaladas con `npm install`.
- CAP local mediante `npx cds ...`.

Dependencias principales:

- `@sap/cds`
- `@cap-js/sqlite`
- `@cap-js/hana`
- `@cap-js/audit-logging`
- SAP Cloud SDK connectivity/http/resilience
- Jest
- Playwright

---

## Arranque local

Desde la raíz del proyecto:

```bash
npx cds watch
```

Si el puerto `4004` está libre, CAP servirá en:

```text
http://localhost:4004
```

Si `4004` está ocupado, `cds watch` puede arrancar en un puerto alternativo. Usa el puerto indicado en consola.

---

## URL recomendada para probar la app

Para probar el flujo completo con el manifest real de la app:

```text
http://localhost:4004/monitor/webapp/test/flpSandbox.html
```

Si CAP arrancó en otro puerto:

```text
http://localhost:<PUERTO>/monitor/webapp/test/flpSandbox.html
```

Esta URL carga:

- `app/monitor/webapp/Component.js`
- `app/monitor/webapp/manifest.json`
- FLP sandbox local
- `MonitorSDService`
- mocks locales de S/4

---

## Importante sobre `$fiori-preview`

No uses esta URL como prueba completa del flujo profundo:

```text
http://localhost:4004/$fiori-preview/MonitorSDService/SalesOrders#preview-app
```

`$fiori-preview` genera un manifest temporal basado en la entidad raíz indicada. Para `SalesOrders`, ese manifest no reproduce toda la navegación profunda hacia facturas.

Sí puede usarse para pruebas parciales:

```text
http://localhost:4004/$fiori-preview/MonitorSDService/SalesOrders#preview-app
http://localhost:4004/$fiori-preview/MonitorSDService/Deliveries#preview-app
http://localhost:4004/$fiori-preview/MonitorSDService/BillingDocuments#preview-app
```

Pero la validación local buena del componente real es:

```text
/monitor/webapp/test/flpSandbox.html
```

---

## Flujo esperado en la UI

1. Abrir el FLP sandbox local.
2. Ver la ListReport `Pedidos de venta`.
3. Seleccionar el pedido `10000001`.
4. En el ObjectPage del pedido, revisar:
   - datos generales
   - importes
   - posiciones del pedido
   - entregas
5. Seleccionar la entrega `80000001`.
6. En el ObjectPage de entrega, revisar:
   - datos de entrega
   - posiciones de entrega
   - facturas
7. Seleccionar la factura `90000001`.
8. En el ObjectPage de factura, revisar:
   - datos de factura
   - documento contable
   - estado de facturación
   - posiciones de factura
   - IVA e importes

---

## Servicio OData principal

Servicio:

```text
MonitorSDService
```

Path:

```text
/odata/v4/MonitorSDService
```

Metadata:

```text
http://localhost:4004/odata/v4/MonitorSDService/$metadata
```

Entidades principales:

- `SalesOrders`
- `Deliveries`
- `BillingDocuments`
- `SalesOrderItems`
- `DeliveryItems`
- `BillingDocumentItems`
- `SODocFlow`
- `DeliveryDocFlow`

Ejemplos:

```text
/odata/v4/MonitorSDService/SalesOrders
/odata/v4/MonitorSDService/SalesOrders('10000001')/Deliveries
/odata/v4/MonitorSDService/SalesOrders('10000001')/Deliveries('80000001')/BillingDocuments
/odata/v4/MonitorSDService/SalesOrders('10000001')/Deliveries('80000001')/BillingDocuments('90000001')/Items
```

---

## Arquitectura

```text
app/
  monitor/
    webapp/
      Component.js
      manifest.json
      test/
        flpSandbox.html
        standalone.html
  appconfig/
    fioriSandboxConfig.json
  router/
    xs-app.json
    package.json

srv/
  monitor-sd-service.cds
  monitor-sd-service.js
  annotations.cds
  external/
    API_SALES_ORDER_SRV.*
    OP_API_OUTBOUND_DELIVERY_SRV_0002.*
    API_BILLING_DOCUMENT_SRV.*
  lib/
    mock-filter.js
    remote-error.js
    status-mapper.js
    ttl-cache.js

test/
  monitor-sd-service.test.js
  status-mapper.test.js

docs/
  ABAPER_NAVIGATION_MAP.md
  LOCAL_FIORI_NAVIGATION_DIAGNOSIS.md
```

---

## Backend

Archivo principal:

```text
srv/monitor-sd-service.cds
```

Define el servicio público y las proyecciones sobre APIs S/4:

- `API_SALES_ORDER_SRV`
- `OP_API_OUTBOUND_DELIVERY_SRV_0002`
- `API_BILLING_DOCUMENT_SRV`

Implementación:

```text
srv/monitor-sd-service.js
```

Responsabilidades:

- Leer pedidos.
- Resolver `SalesOrders → Deliveries` mediante DocFlow.
- Resolver `Deliveries → BillingDocuments` mediante DocFlow.
- Leer posiciones de pedido, entrega y factura.
- Enriquecer códigos SAP con textos legibles.
- Ejecutar acciones:
  - `ReleaseDeliveryBlock`
  - `PostGoodsIssue`
- Centralizar errores remotos con `runRemote` / `runAction`.
- Usar caché TTL para lecturas repetitivas.

---

## Frontend

App Fiori Elements:

```text
app/monitor/webapp
```

Componente:

```text
monitor.sd
```

Manifest:

```text
app/monitor/webapp/manifest.json
```

Anotaciones:

```text
srv/annotations.cds
```

Rutas principales:

```text
""
SalesOrders({SalesOrdersKey})
SalesOrders({SalesOrdersKey})/Deliveries({DeliveriesKey})
SalesOrders({SalesOrdersKey})/Deliveries({DeliveriesKey})/BillingDocuments({BillingDocumentsKey})
```

---

## Mocks locales

En local, los servicios externos usan implementaciones mock:

```text
srv/external/API_SALES_ORDER_SRV.js
srv/external/OP_API_OUTBOUND_DELIVERY_SRV_0002.js
srv/external/API_BILLING_DOCUMENT_SRV.js
```

Están configurados en `package.json` mediante `cds.requires.*.impl`.

En producción, esos `impl` no deben usarse. El perfil `[production]` de `.cdsrc.json` apunta a destinos BTP:

```text
S4HANA_SALES_ORDER
S4HANA_DELIVERY
S4HANA_BILLING
```

---

## Tests

Ejecutar tests:

```bash
npm test -- --runInBand
```

Resultado esperado:

```text
Test Suites: 2 passed, 2 total
Tests:       52 passed, 52 total
```

Notas:

- En entornos con sandbox estricto puede fallar `cds-test` con `listen EPERM`.
- En ese caso, ejecutar los tests fuera del sandbox de sistema.

---

## Build

Compilar CAP:

```bash
npx cds build
```

Salida generada:

```text
gen/srv
```

---

## Deploy a BTP (Cloud Foundry)

### Instalación de herramientas (una sola vez)

```bash
# MBT (Cloud MTA Build Tool)
npm install -g mbt

# CF CLI v8 — Linux sin snap
curl -L "https://packages.cloudfoundry.org/stable?release=linux64-binary&version=v8&source=github" -o /tmp/cf-cli.tar.gz
cd /tmp && tar -xzf cf-cli.tar.gz && mkdir -p ~/.local/bin && cp cf8 ~/.local/bin/cf && chmod +x ~/.local/bin/cf
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# Plugin MultiApps — necesario para cf deploy (sin él falla con "deploy is not a registered command")
cf install-plugin multiapps -f
```

### Requisitos previos

- CF CLI instalado (`cf --version`) con plugin multiapps instalado
- MBT instalado (`mbt --version`)
- Sesión activa: `cf login -a https://api.cf.us10-001.hana.ondemand.com`
- Espacio CF creado en el subaccount de trial

### Archivos de deploy

```text
mta.yaml                        ← descriptor MTA
xs-security.json                ← definición XSUAA (scopes, roles)
app/monitor/xs-app.json         ← routing HTML5 app → CAP service
app/monitor/package.json        ← script de build (zip webapp)
app/monitor/webapp/manifest.json ← incluye sap.cloud.service + crossNavigation
.cdsrc.json                     ← perfil [production] con destinos S/4
```

### Servicios BTP que crea el deploy

| Servicio | Plan | Para qué |
|---|---|---|
| `xsuaa` | `application` | Autenticación |
| `html5-apps-repo` | `app-host` | Hosting del Fiori app |
| `destination` | `lite` | Apuntar al CAP service |

### Pasos

```bash
cd /home/juanma/workspace/sap/cap-n8n/workspace/monitor_sd

mbt build -p cf
cf deploy mta_archives/monitor-sd_1.0.0.mtar
```

El build tarda ~30s. El deploy ~5 min (crea servicios, sube app, arranca).

### Acceder a la app tras el deploy

**URL directa del FLP sandbox** (manifest real, 4 niveles de navegación):

```text
https://3be51d3ftrial-dev-monitor-sd-srv.cfapps.us10-001.hana.ondemand.com/monitor/webapp/test/flpSandbox.html
```

Esta URL funciona sin Work Zone ni configuración adicional. El `mta.yaml` copia
el webapp al paquete del servidor CAP durante el build.

**Via SAP Build Work Zone** (si el trial tiene IAS/OIDC configurado):

1. Suscribirse a SAP Build Work Zone, edición estándar
2. Asignar colección de roles `Launchpad_Admin` al usuario
3. Ir a Channel Manager → HTML5 Apps → sincronizar
4. Añadir tile `monitor.sd` → abre con manifest real

> **Nota trial**: Work Zone requiere confianza OIDC con SAP Cloud Identity Services.
> Si el global account no tiene tenant IAS, usar el `flpSandbox.html` directamente.

### Nota sobre S/4 real

En trial, `NODE_ENV=development` mantiene los mocks activos. Para apuntar a S/4 real:

1. Crear destinos en BTP Destination Service:
   - `S4HANA_SALES_ORDER`
   - `S4HANA_DELIVERY`
   - `S4HANA_BILLING`
2. Quitar `NODE_ENV: development` del `mta.yaml`
3. Hacer nuevo `mbt build -p cf` y `cf deploy`

### Archivos de configuración de seguridad

```text
xs-security.json    ← scopes SalesViewer / LogisticsUser
.cdsrc.json         ← perfil [production] con destinos S/4
```

---

## Documentación útil

Mapa técnico para ABAPers:

```text
docs/ABAPER_NAVIGATION_MAP.md
```

Diagnóstico de navegación local Fiori:

```text
docs/LOCAL_FIORI_NAVIGATION_DIAGNOSIS.md
```

Planes de desarrollo:

```text
PLAN_DESARROLLO.md
PLAN_DESARROLLO_2.md
```

Registro de incidencias:

```text
build-log.md
```

Requisito funcional original:

```text
requisito.txt
```
