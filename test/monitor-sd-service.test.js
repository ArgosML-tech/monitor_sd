'use strict';
const cds = require('@sap/cds');

// Arranca un servidor CAP en puerto aleatorio antes de todos los tests.
// El servidor usa los mocks en-proceso definidos en srv/external/*.js
const { GET, POST } = cds.test(__dirname + '/..');

describe('MonitorSDService — integración', () => {

  // ── SalesOrders ────────────────────────────────────────────────────────

  describe('SalesOrders', () => {

    it('devuelve los 3 pedidos con OverallSDProcessStatusText', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      expect(data.value).toHaveLength(3);
      expect(data.value[0]).toHaveProperty('OverallSDProcessStatusText');
      expect(data.value[0].OverallSDProcessStatusText).toBeTruthy();
    });

    it('mapea correctamente los tres códigos de estado', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      const byId = Object.fromEntries(data.value.map(o => [o.SalesOrder, o]));
      expect(byId['10000001'].OverallSDProcessStatusText).toBe('En proceso');
      expect(byId['10000002'].OverallSDProcessStatusText).toBe('Completado');
      expect(byId['10000003'].OverallSDProcessStatusText).toBe('Abierto');
    });

    it('lookup por clave devuelve el pedido correcto', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000002')");
      expect(data.SalesOrder).toBe('10000002');
      expect(data.TotalNetAmount).toBe(8500);
      expect(data.TransactionCurrency).toBe('EUR');
    });

  });

  // ── Deliveries ─────────────────────────────────────────────────────────

  describe('Deliveries', () => {

    it('resuelve SO→Entregas vía DocFlow para SO con 2 entregas', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000001'"
      );
      expect(data.value).toHaveLength(2);
      const ids = data.value.map(d => d.DeliveryDocument).sort();
      expect(ids).toEqual(['80000001', '80000002']);
    });

    it('resuelve SO→Entregas vía DocFlow para SO con 1 entrega', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000002'"
      );
      expect(data.value).toHaveLength(1);
      expect(data.value[0].DeliveryDocument).toBe('80000003');
    });

    it('devuelve vacío para SO sin entregas en DocFlow', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/Deliveries?$filter=SalesOrderRef eq '10000003'"
      );
      expect(data.value).toHaveLength(0);
    });

    it('lookup por clave devuelve la entrega correcta con StatusText', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/Deliveries('80000001')");
      expect(data.DeliveryDocument).toBe('80000001');
      expect(data.OverallGoodsMovementStatusText).toBe('GI completa');
      expect(data.OverallPickingStatusText).toBe('Picking completado');
    });

    it('entrega sin GI tiene StatusText correcto', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/Deliveries('80000002')");
      expect(data.OverallGoodsMovementStatusText).toBe('Sin salida de mercancía');
      expect(data.OverallPickingStatusText).toBe('Picking parcial');
    });

  });

  // ── BillingDocuments ───────────────────────────────────────────────────

  describe('BillingDocuments', () => {

    it('resuelve Entrega→Facturas vía DocFlow (factura + nota de crédito)', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000001'"
      );
      // Fase 2 añadió nota de crédito 90000099 → ahora son 2 documentos
      expect(data.value).toHaveLength(2);
      const ids = data.value.map(b => b.BillingDocument);
      expect(ids).toContain('90000001');
      expect(ids).toContain('90000099');
    });

    it('devuelve vacío para entrega sin facturas en DocFlow', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000002'"
      );
      expect(data.value).toHaveLength(0);
    });

    it('lookup por clave devuelve la factura correcta', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000002')");
      expect(data.BillingDocument).toBe('90000002');
      expect(data.OverallBillingStatusText).toBe('Completamente facturado');
      expect(data.BillingDocumentIsCancelled).toBe(false);
    });

  });

  // ── Navegación OData (asociaciones) ───────────────────────────────────

  describe('Navegación OData', () => {

    it('GET /Deliveries entrega→facturas por navegación devuelve factura y nota de crédito', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/Deliveries('80000001')/BillingDocuments"
      );
      // Fase 2: DocFlow incluye M + N → 2 documentos
      expect(data.value).toHaveLength(2);
      const ids = data.value.map(b => b.BillingDocument);
      expect(ids).toContain('90000001');
      expect(ids).toContain('90000099');
    });

    it('GET /Deliveries entrega sin facturas → colección vacía', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/Deliveries('80000002')/BillingDocuments"
      );
      expect(data.value).toHaveLength(0);
    });

  });

  // ── Fase 1: Paginación ────────────────────────────────────────────────

  describe('Paginación', () => {

    it('$top=1 devuelve exactamente 1 pedido', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$top=1');
      expect(data.value).toHaveLength(1);
    });

    it('$top=2 devuelve exactamente 2 pedidos', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$top=2');
      expect(data.value).toHaveLength(2);
    });

    it('$top=1&$skip=1 devuelve el segundo pedido', async () => {
      const { data: all  } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      const { data: paged } = await GET('/odata/v4/MonitorSDService/SalesOrders?$top=1&$skip=1');
      expect(paged.value).toHaveLength(1);
      expect(paged.value[0].SalesOrder).toBe(all.value[1].SalesOrder);
    });

    it('$count=true adjunta @odata.count', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders?$count=true');
      expect(data['@odata.count']).toBeGreaterThanOrEqual(3);
    });

  });

  // ── Fase 1: Caché ─────────────────────────────────────────────────────

  describe('Caché', () => {

    it('dos llamadas consecutivas a SalesOrders devuelven el mismo resultado', async () => {
      const { data: r1 } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      const { data: r2 } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      expect(r1.value.map(o => o.SalesOrder)).toEqual(r2.value.map(o => o.SalesOrder));
    });

  });

  // ── Fase 3: Enriquecimiento SalesOrders ───────────────────────────────

  describe('Enriquecimiento SalesOrders', () => {

    it('incluye campos de estado de entrega y facturación', async () => {
      const { data } = await GET('/odata/v4/MonitorSDService/SalesOrders');
      const so = data.value[0];
      expect(so).toHaveProperty('OverallDeliveryStatusText');
      expect(so).toHaveProperty('OverallOrdReltdBillgStatusText');
      expect(so).toHaveProperty('DeliveryDelayDays');
      expect(so).toHaveProperty('TotalBlockStatusText');
    });

    it('pedido bloqueado tiene TotalBlockStatusText no vacío', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000003')");
      expect(data.TotalBlockStatusText).toBeTruthy();
      expect(data.TotalBlockStatusText).toMatch(/Bloqueado/);
    });

    it('pedido completado tiene DeliveryDelayDays = 0', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000002')");
      expect(data.DeliveryDelayDays).toBe(0);
    });

  });

  // ── Fase 3: DocFlow completo (notas de crédito) ───────────────────────

  describe('DocFlow completo', () => {

    it('BillingDocuments incluye factura estándar (M) y nota de crédito (N)', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/BillingDocuments?$filter=DeliveryRef eq '80000001'"
      );
      const cats = data.value.map(b => b.BillingDocumentCategory);
      expect(cats).toContain('M');
      expect(cats).toContain('N');
    });

    it('BillingDocumentCategoryText es legible', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000099')");
      expect(data.BillingDocumentCategoryText).toBe('Nota de crédito');
    });

    it('nota de crédito tiene AccountingDocument null', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000099')");
      expect(data.AccountingDocument).toBeNull();
    });

  });

  // ── Fase 3: Posiciones de documentos ────────────────────────────────

  describe('Posiciones de pedido (SalesOrderItems)', () => {

    it('devuelve posiciones navegando desde SO', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000001')/Items");
      expect(data.value.length).toBeGreaterThanOrEqual(2);
    });

    it('contiene al menos una posición SIN entrega', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/SalesOrders('10000001')/Items");
      const sinEntrega = data.value.filter(i => i.DeliveryStatus === 'A');
      expect(sinEntrega.length).toBeGreaterThanOrEqual(1);
      expect(sinEntrega[0].DeliveryStatusText).toBe('Sin entregar');
    });

    it('lookup por clave compuesta funciona', async () => {
      const { data } = await GET(
        "/odata/v4/MonitorSDService/SalesOrderItems(SalesOrder='10000001',SalesOrderItem='000010')"
      );
      expect(data.Material).toBe('MAT-001');
      expect(data.SDProcessStatusText).toBeTruthy();
    });

  });

  describe('Posiciones de entrega (DeliveryItems)', () => {

    it('devuelve posiciones navegando desde Delivery', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/Deliveries('80000001')/Items");
      expect(data.value.length).toBeGreaterThanOrEqual(1);
    });

    it('incluye referencia al pedido de origen', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/Deliveries('80000001')/Items");
      expect(data.value[0].ReferenceSDDocument).toBe('10000001');
      expect(data.value[0].GoodsMovementStatusText).toBeTruthy();
    });

  });

  describe('Posiciones de factura (BillingDocumentItems)', () => {

    it('devuelve posiciones navegando desde BillingDocument', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000001')/Items");
      expect(data.value.length).toBeGreaterThanOrEqual(1);
    });

    it('incluye importes neto, impuesto y bruto', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000001')/Items");
      const item = data.value[0];
      expect(item).toHaveProperty('NetAmount');
      expect(item).toHaveProperty('TaxAmount');
      expect(item).toHaveProperty('GrossAmount');
    });

    it('posición de nota de crédito tiene importes negativos', async () => {
      const { data } = await GET("/odata/v4/MonitorSDService/BillingDocuments('90000099')/Items");
      expect(data.value[0].NetAmount).toBeLessThan(0);
    });

  });

  // ── Fase 4: Acciones de escritura ─────────────────────────────────────

  describe('PostGoodsIssue', () => {

    it('cambia OverallGoodsMovementStatus a C', async () => {
      const { data } = await POST(
        "/odata/v4/MonitorSDService/Deliveries('80000002')/MonitorSDService.PostGoodsIssue", {}
      );
      expect(data.OverallGoodsMovementStatus).toBe('C');
      expect(data.OverallGoodsMovementStatusText).toBe('GI completa');
      expect(data.ActualGoodsMovementDate).toBeTruthy();
    });

    it('rechaza con 400 si la GI ya estaba completada', async () => {
      const res = await POST(
        "/odata/v4/MonitorSDService/Deliveries('80000001')/MonitorSDService.PostGoodsIssue", {}
      ).catch(e => e.response ?? e);
      expect(res.status).toBe(400);
    });

  });

  describe('ReleaseDeliveryBlock', () => {

    it('quita el bloqueo de entrega del pedido', async () => {
      const { data } = await POST(
        "/odata/v4/MonitorSDService/SalesOrders('10000003')/MonitorSDService.ReleaseDeliveryBlock", {}
      );
      expect(data.DeliveryBlockReason).toBe('');
      expect(data.TotalBlockStatusText).toBe('');
    });

    it('rechaza con 400 si el pedido no tiene bloqueo activo', async () => {
      const res = await POST(
        "/odata/v4/MonitorSDService/SalesOrders('10000001')/MonitorSDService.ReleaseDeliveryBlock", {}
      ).catch(e => e.response ?? e);
      expect(res.status).toBe(400);
    });

  });

});
