'use strict';
const cds = require('@sap/cds');
const { getFilter } = require('../lib/mock-filter');

const SALES_ORDERS = [
  {
    SalesOrder: '10000001', SalesOrderType: 'OR',
    SalesOrganization: '1010', SoldToParty: 'C001',
    PurchaseOrderByCustomer: 'PO-2025-001',
    CreationDate: '2025-01-10', RequestedDeliveryDate: '2025-01-20',
    TotalNetAmount: 15000.00, TransactionCurrency: 'EUR',
    OverallSDProcessStatus: 'B',
    OverallDeliveryStatus: 'B', OverallOrdReltdBillgStatus: 'B',
    TotalBlockStatus: '', DeliveryBlockReason: '',
    HeaderBillingBlockReason: '', TotalCreditCheckStatus: 'A'
  },
  {
    SalesOrder: '10000002', SalesOrderType: 'OR',
    SalesOrganization: '1010', SoldToParty: 'C002',
    PurchaseOrderByCustomer: 'PO-2025-045',
    CreationDate: '2025-02-01', RequestedDeliveryDate: '2025-02-15',
    TotalNetAmount: 8500.00, TransactionCurrency: 'EUR',
    OverallSDProcessStatus: 'C',
    OverallDeliveryStatus: 'C', OverallOrdReltdBillgStatus: 'C',
    TotalBlockStatus: '', DeliveryBlockReason: '',
    HeaderBillingBlockReason: '', TotalCreditCheckStatus: 'A'
  },
  {
    SalesOrder: '10000003', SalesOrderType: 'OR',
    SalesOrganization: '2020', SoldToParty: 'C003',
    PurchaseOrderByCustomer: '',
    CreationDate: '2025-03-05', RequestedDeliveryDate: '2025-03-20',
    TotalNetAmount: 22000.00, TransactionCurrency: 'USD',
    OverallSDProcessStatus: 'A',
    // Pedido con bloqueo de entrega por crédito — caso de uso de la Mejora A
    OverallDeliveryStatus: 'A', OverallOrdReltdBillgStatus: 'A',
    TotalBlockStatus: 'B', DeliveryBlockReason: '01',
    HeaderBillingBlockReason: '', TotalCreditCheckStatus: 'B'
  }
];

const SO_DOC_FLOW = [
  { SalesOrder: '10000001', DocRelationshipUUID: 'uuid-so1-del1', SubsequentDocument: '80000001', SubsequentDocumentCategory: 'J' },
  { SalesOrder: '10000001', DocRelationshipUUID: 'uuid-so1-del2', SubsequentDocument: '80000002', SubsequentDocumentCategory: 'J' },
  { SalesOrder: '10000002', DocRelationshipUUID: 'uuid-so2-del1', SubsequentDocument: '80000003', SubsequentDocumentCategory: 'J' }
];

const SO_ITEMS = [
  // SO 10000001: pos 10 entregada, pos 20 SIN entrega
  { SalesOrder: '10000001', SalesOrderItem: '000010',
    SalesOrderItemCategory: 'TAN', SalesOrderItemText: 'Producto A',
    Material: 'MAT-001', MaterialByCustomer: 'CUST-A',
    RequestedQuantity: 5, RequestedQuantityUnit: 'PC',
    NetAmount: 10000.00, TransactionCurrency: 'EUR',
    SDProcessStatus: 'B', DeliveryStatus: 'C',
    OrderRelatedBillingStatus: 'C', ItemBillingBlockReason: '',
    SalesDocumentRjcnReason: '', HigherLevelItem: '',
    ReferenceSDDocument: '', ReferenceSDDocumentItem: '' },
  { SalesOrder: '10000001', SalesOrderItem: '000020',
    SalesOrderItemCategory: 'TAN', SalesOrderItemText: 'Producto B',
    Material: 'MAT-002', MaterialByCustomer: 'CUST-B',
    RequestedQuantity: 2, RequestedQuantityUnit: 'PC',
    NetAmount: 5000.00, TransactionCurrency: 'EUR',
    SDProcessStatus: 'A', DeliveryStatus: 'A',   // ← SIN entrega
    OrderRelatedBillingStatus: 'A', ItemBillingBlockReason: '',
    SalesDocumentRjcnReason: '', HigherLevelItem: '',
    ReferenceSDDocument: '', ReferenceSDDocumentItem: '' },
  // SO 10000002: posición completamente procesada
  { SalesOrder: '10000002', SalesOrderItem: '000010',
    SalesOrderItemCategory: 'TAN', SalesOrderItemText: 'Producto C',
    Material: 'MAT-003', MaterialByCustomer: '',
    RequestedQuantity: 10, RequestedQuantityUnit: 'PC',
    NetAmount: 8500.00, TransactionCurrency: 'EUR',
    SDProcessStatus: 'C', DeliveryStatus: 'C',
    OrderRelatedBillingStatus: 'C', ItemBillingBlockReason: '',
    SalesDocumentRjcnReason: '', HigherLevelItem: '',
    ReferenceSDDocument: '', ReferenceSDDocumentItem: '' }
];

module.exports = class API_SALES_ORDER_SRV extends cds.Service {
  async init() {
    this.on('READ', 'A_SalesOrder', req => {
      const sel   = req.query.SELECT;
      const soVal = getFilter(sel, 'SalesOrder');
      let results = soVal
        ? SALES_ORDERS.filter(o => (Array.isArray(soVal) ? soVal : [soVal]).includes(o.SalesOrder))
        : SALES_ORDERS;
      const offset = sel.limit?.offset?.val ?? 0;
      const rows   = sel.limit?.rows?.val;
      if (rows !== undefined) results = results.slice(offset, offset + rows);
      else if (offset)        results = results.slice(offset);
      return results;
    });

    this.on('READ', 'A_SalesOrderItem', req => {
      const sel   = req.query.SELECT;
      const soVal = getFilter(sel, 'SalesOrder') ?? null;
      let results = soVal
        ? SO_ITEMS.filter(i => i.SalesOrder === soVal)
        : SO_ITEMS;
      const offset = sel.limit?.offset?.val ?? 0;
      const rows   = sel.limit?.rows?.val;
      if (rows !== undefined) results = results.slice(offset, offset + rows);
      else if (offset)        results = results.slice(offset);
      return results;
    });

    this.on('ReleaseDeliveryBlock', req => {
      const { SalesOrder } = req.data;
      const o = SALES_ORDERS.find(o => o.SalesOrder === SalesOrder);
      if (!o) return req.reject(404, `Pedido ${SalesOrder} no encontrado`);
      if (!o.DeliveryBlockReason) return req.reject(400, 'El pedido no tiene bloqueo de entrega activo');
      o.DeliveryBlockReason = '';
      o.TotalBlockStatus    = '';
      return o;
    });

    this.on('READ', 'A_SalesOrderSubsqntProcFlow', req => {
      const sel    = req.query.SELECT;
      const soVal  = getFilter(sel, 'SalesOrder');
      const catVal = getFilter(sel, 'SubsequentDocumentCategory');
      let rows = SO_DOC_FLOW;
      if (soVal)  rows = rows.filter(r => r.SalesOrder === soVal);
      if (catVal) rows = rows.filter(r => r.SubsequentDocumentCategory === catVal);
      return rows;
    });

    await super.init();
  }
};
