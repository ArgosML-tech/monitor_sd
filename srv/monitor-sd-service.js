'use strict';
const cds = require('@sap/cds');
const {
  sdProcessText, goodsMovementText, pickingText, billingText,
  deliveryHdrText, billingHdrText, billingCategoryText, deliveryDelayDays
} = require('./lib/status-mapper');
const { getFilter, getNavParentKey } = require('./lib/mock-filter');
const { runRemote, runAction } = require('./lib/remote-error');
const { TtlCache }  = require('./lib/ttl-cache');

const soCache    = new TtlCache(60);
const delivCache = new TtlCache(30);

module.exports = class MonitorSDService extends cds.ApplicationService {

  async init() {
    const soAPI       = await cds.connect.to('API_SALES_ORDER_SRV');
    const deliveryAPI = await cds.connect.to('OP_API_OUTBOUND_DELIVERY_SRV_0002');
    const billingAPI  = await cds.connect.to('API_BILLING_DOCUMENT_SRV');
    const auditLog    = await cds.connect.to('audit-log');

    const {
      SalesOrders, Deliveries, BillingDocuments,
      SalesOrderItems, DeliveryItems, BillingDocumentItems
    } = this.entities;

    // ── READ SalesOrders ─────────────────────────────────────────────────
    this.on('READ', SalesOrders, async req => {
      const sel   = req.query.SELECT;
      const soKey = getFilter(sel, 'SalesOrder');

      const cacheKey = soKey ? null : JSON.stringify({ where: sel.where, limit: sel.limit, orderBy: sel.orderBy, count: !!sel.count });
      if (cacheKey) {
        const cached = soCache.get(cacheKey);
        if (cached) return cached;
      }

      const query = SELECT.from('API_SALES_ORDER_SRV.A_SalesOrder');
      if (soKey) {
        const ids = Array.isArray(soKey) ? soKey : [soKey];
        query.where({ SalesOrder: { in: ids } });
      }
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const orders = await runRemote(req, soAPI, query, 'Pedidos');
      if (!orders) return;

      const result = orders.map(o => ({
        ...o,
        OverallSDProcessStatusText:      sdProcessText(o.OverallSDProcessStatus),
        OverallDeliveryStatusText:       deliveryHdrText(o.OverallDeliveryStatus),
        OverallOrdReltdBillgStatusText:  billingHdrText(o.OverallOrdReltdBillgStatus),
        TotalBlockStatusText:            o.TotalBlockStatus ? `Bloqueado (${o.TotalBlockStatus})` : '',
        DeliveryDelayDays:               deliveryDelayDays(o.RequestedDeliveryDate, o.OverallDeliveryStatus)
      }));

      if (sel.count) result.$count = result.length;
      if (cacheKey) soCache.set(cacheKey, result);
      return result;
    });

    // ── READ Deliveries ──────────────────────────────────────────────────
    this.on('READ', Deliveries, async req => {
      const sel      = req.query.SELECT;
      const soRef    = getFilter(sel, 'SalesOrderRef') ?? getNavParentKey(sel, 'SalesOrder');
      const delivKey = getFilter(sel, 'DeliveryDocument');

      let deliveryIds = [];
      if (soRef) {
        const flows = await runRemote(req, soAPI,
          SELECT.from('API_SALES_ORDER_SRV.A_SalesOrderSubsqntProcFlow')
            .where({ SalesOrder: soRef, SubsequentDocumentCategory: 'J' }),
          'DocFlow SO→Entrega'
        );
        if (!flows) return;
        deliveryIds = flows.map(f => f.SubsequentDocument);
        if (!deliveryIds.length) return [];
      }

      const query = SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryHeader');
      if (deliveryIds.length) {
        query.where({ DeliveryDocument: { in: deliveryIds } });
      } else if (delivKey) {
        const ids = Array.isArray(delivKey) ? delivKey : [delivKey];
        query.where({ DeliveryDocument: { in: ids } });
      }
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const deliveries = await runRemote(req, deliveryAPI, query, 'Entregas');
      if (!deliveries) return;

      const result = deliveries.map(d => ({
        ...d,
        SalesOrderRef:                  soRef ?? null,
        OverallGoodsMovementStatusText: goodsMovementText(d.OverallGoodsMovementStatus),
        OverallPickingStatusText:       pickingText(d.OverallPickingStatus)
      }));

      if (sel.count) result.$count = result.length;
      return result;
    });

    // ── READ BillingDocuments ────────────────────────────────────────────
    // DocFlow expandido: M (factura) + N (nota crédito) + O (nota débito) + P (pro-forma)
    this.on('READ', BillingDocuments, async req => {
      const sel      = req.query.SELECT;
      const delivRef = getFilter(sel, 'DeliveryRef') ?? getNavParentKey(sel, 'DeliveryDocument');
      const billKey  = getFilter(sel, 'BillingDocument');

      let billingIds = [];
      if (delivRef) {
        const flows = await runRemote(req, deliveryAPI,
          SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryDocFlow')
            .where({ PrecedingDocument: delivRef,
                     SubsequentDocumentCategory: { in: ['M', 'N', 'O', 'P'] } }),
          'DocFlow Entrega→Factura'
        );
        if (!flows) return;
        billingIds = [...new Set(flows.map(f => f.Subsequentdocument))];
        if (!billingIds.length) return [];
      }

      const query = SELECT.from('API_BILLING_DOCUMENT_SRV.A_BillingDocument');
      if (billingIds.length) {
        query.where({ BillingDocument: { in: billingIds } });
      } else if (billKey) {
        const ids = Array.isArray(billKey) ? billKey : [billKey];
        query.where({ BillingDocument: { in: ids } });
      }
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const bills = await runRemote(req, billingAPI, query, 'Facturas');
      if (!bills) return;

      const result = bills.map(b => ({
        ...b,
        DeliveryRef:                delivRef ?? null,
        OverallBillingStatusText:   billingText(b.OverallBillingStatus),
        BillingDocumentCategoryText: billingCategoryText(b.BillingDocumentCategory)
      }));

      if (sel.count) result.$count = result.length;
      return result;
    });

    // ── ACTION PostGoodsIssue ────────────────────────────────────────────
    this.on('PostGoodsIssue', Deliveries, async req => {
      const { DeliveryDocument } = req.params[0];

      await runAction(req,
        deliveryAPI.send('PostGoodsIssue', { DeliveryDocument }),
        'PostGoodsIssue'
      );

      delivCache.invalidateAll();

      const [updated] = await runRemote(req, deliveryAPI,
        SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryHeader')
          .where({ DeliveryDocument }),
        'PostGoodsIssue-refresh'
      );
      if (!updated) return;

      await auditLog.log('MonitorSD.PostGoodsIssue', {
        user: req.user?.id ?? 'unknown', deliveryDocument: DeliveryDocument,
        timestamp: new Date().toISOString()
      });

      return {
        ...updated,
        SalesOrderRef:                  null,
        OverallGoodsMovementStatusText: goodsMovementText(updated.OverallGoodsMovementStatus),
        OverallPickingStatusText:       pickingText(updated.OverallPickingStatus)
      };
    });

    // ── ACTION ReleaseDeliveryBlock ──────────────────────────────────────
    this.on('ReleaseDeliveryBlock', SalesOrders, async req => {
      const { SalesOrder } = req.params[0];

      // En producción con S/4 real: soAPI.send({ method:'PATCH', path:`A_SalesOrder(SalesOrder='X')`, data:{DeliveryBlockReason:''} })
      // En mock: soAPI.send('ReleaseDeliveryBlock', { SalesOrder })
      await runAction(req,
        soAPI.send('ReleaseDeliveryBlock', { SalesOrder }),
        'ReleaseDeliveryBlock'
      );

      soCache.invalidateAll();

      const [updated] = await runRemote(req, soAPI,
        SELECT.from('API_SALES_ORDER_SRV.A_SalesOrder').where({ SalesOrder }),
        'ReleaseDeliveryBlock-refresh'
      );
      if (!updated) return;

      await auditLog.log('MonitorSD.ReleaseDeliveryBlock', {
        user: req.user?.id ?? 'unknown', salesOrder: SalesOrder,
        timestamp: new Date().toISOString()
      });

      return {
        ...updated,
        OverallSDProcessStatusText:      sdProcessText(updated.OverallSDProcessStatus),
        OverallDeliveryStatusText:       deliveryHdrText(updated.OverallDeliveryStatus),
        OverallOrdReltdBillgStatusText:  billingHdrText(updated.OverallOrdReltdBillgStatus),
        TotalBlockStatusText:            updated.TotalBlockStatus ? `Bloqueado (${updated.TotalBlockStatus})` : '',
        DeliveryDelayDays:               deliveryDelayDays(updated.RequestedDeliveryDate, updated.OverallDeliveryStatus)
      };
    });

    // ── READ SalesOrderItems ─────────────────────────────────────────────
    this.on('READ', SalesOrderItems, async req => {
      const sel   = req.query.SELECT;
      const soKey = getFilter(sel, 'SalesOrder') ?? getNavParentKey(sel, 'SalesOrder');

      const query = SELECT.from('API_SALES_ORDER_SRV.A_SalesOrderItem');
      if (soKey) query.where({ SalesOrder: soKey });
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const items = await runRemote(req, soAPI, query, 'Posiciones Pedido');
      if (!items) return;

      const result = items.map(i => ({
        ...i,
        SDProcessStatusText: sdProcessText(i.SDProcessStatus),
        DeliveryStatusText:  deliveryHdrText(i.DeliveryStatus)
      }));

      if (sel.count) result.$count = result.length;
      return result;
    });

    // ── READ DeliveryItems ───────────────────────────────────────────────
    this.on('READ', DeliveryItems, async req => {
      const sel      = req.query.SELECT;
      const delivKey = getFilter(sel, 'DeliveryDocument') ?? getNavParentKey(sel, 'DeliveryDocument');

      const query = SELECT.from('OP_API_OUTBOUND_DELIVERY_SRV_0002.A_OutbDeliveryItem');
      if (delivKey) query.where({ DeliveryDocument: delivKey });
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const items = await runRemote(req, deliveryAPI, query, 'Posiciones Entrega');
      if (!items) return;

      const result = items.map(i => ({
        ...i,
        GoodsMovementStatusText: goodsMovementText(i.GoodsMovementStatus),
        PickingStatusText:       pickingText(i.PickingStatus)
      }));

      if (sel.count) result.$count = result.length;
      return result;
    });

    // ── READ BillingDocumentItems ────────────────────────────────────────
    this.on('READ', BillingDocumentItems, async req => {
      const sel     = req.query.SELECT;
      const billKey = getFilter(sel, 'BillingDocument') ?? getNavParentKey(sel, 'BillingDocument');

      const query = SELECT.from('API_BILLING_DOCUMENT_SRV.A_BillingDocumentItem');
      if (billKey) query.where({ BillingDocument: billKey });
      if (sel.limit?.rows?.val !== undefined) query.limit(sel.limit.rows.val, sel.limit.offset?.val ?? 0);
      if (sel.orderBy)                        query.orderBy(sel.orderBy);

      const items = await runRemote(req, billingAPI, query, 'Posiciones Factura');
      if (!items) return;

      if (sel.count) items.$count = items.length;
      return items;
    });

    await super.init();
  }
};
