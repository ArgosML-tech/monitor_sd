'use strict';
const cds = require('@sap/cds');
const { getFilter } = require('../lib/mock-filter');

const DELIVERIES = [
  {
    DeliveryDocument: '80000001', DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP01', SalesOrganization: '1010', ShipToParty: 'C001',
    DeliveryDate: '2025-01-18T00:00:00Z',
    ActualGoodsMovementDate: '2025-01-19T08:30:00Z',
    OverallGoodsMovementStatus: 'C', OverallPickingStatus: 'C'
  },
  {
    DeliveryDocument: '80000002', DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP01', SalesOrganization: '1010', ShipToParty: 'C001',
    DeliveryDate: '2025-01-22T00:00:00Z',
    ActualGoodsMovementDate: null,
    OverallGoodsMovementStatus: 'A', OverallPickingStatus: 'B'
  },
  {
    DeliveryDocument: '80000003', DeliveryDocumentType: 'LF',
    ShippingPoint: 'SP02', SalesOrganization: '1010', ShipToParty: 'C002',
    DeliveryDate: '2025-02-14T00:00:00Z',
    ActualGoodsMovementDate: '2025-02-14T10:00:00Z',
    OverallGoodsMovementStatus: 'C', OverallPickingStatus: 'C'
  }
];

// PrecedingDocument = entrega; Subsequentdocument = factura
// Incluye factura estándar (M) y nota de crédito (N) para probar DocFlow completo
const DELIVERY_DOC_FLOW = [
  { PrecedingDocument: '80000001', PrecedingDocumentItem: '000010',
    SubsequentDocumentCategory: 'M', Subsequentdocument: '90000001',
    PrecedingDocumentCategory: 'J' },
  // Nota de crédito vinculada a la misma entrega (Fase 3 — DocFlow completo)
  { PrecedingDocument: '80000001', PrecedingDocumentItem: '000010',
    SubsequentDocumentCategory: 'N', Subsequentdocument: '90000099',
    PrecedingDocumentCategory: 'J' },
  { PrecedingDocument: '80000003', PrecedingDocumentItem: '000010',
    SubsequentDocumentCategory: 'M', Subsequentdocument: '90000002',
    PrecedingDocumentCategory: 'J' }
];

const DELIVERY_ITEMS = [
  { DeliveryDocument: '80000001', DeliveryDocumentItem: '000010',
    Material: 'MAT-001', DeliveryDocumentItemText: 'Producto A',
    ActualDeliveryQuantity: 5, OriginalDeliveryQuantity: 5, DeliveryQuantityUnit: 'PC',
    GoodsMovementStatus: 'C', PickingStatus: 'C', PickingConfirmationStatus: 'C',
    Batch: '', StorageLocation: 'SL01',
    ItemGrossWeight: 25, ItemNetWeight: 22, ItemWeightUnit: 'KG',
    ReferenceSDDocument: '10000001', ReferenceSDDocumentItem: '000010' },
  { DeliveryDocument: '80000003', DeliveryDocumentItem: '000010',
    Material: 'MAT-003', DeliveryDocumentItemText: 'Producto C',
    ActualDeliveryQuantity: 10, OriginalDeliveryQuantity: 10, DeliveryQuantityUnit: 'PC',
    GoodsMovementStatus: 'C', PickingStatus: 'C', PickingConfirmationStatus: 'C',
    Batch: 'B001', StorageLocation: 'SL02',
    ItemGrossWeight: 50, ItemNetWeight: 45, ItemWeightUnit: 'KG',
    ReferenceSDDocument: '10000002', ReferenceSDDocumentItem: '000010' }
];

module.exports = class OP_API_OUTBOUND_DELIVERY_SRV_0002 extends cds.Service {
  async init() {
    this.on('READ', 'A_OutbDeliveryHeader', req => {
      const delivVal = getFilter(req.query.SELECT, 'DeliveryDocument');
      if (!delivVal) return DELIVERIES;
      const ids = Array.isArray(delivVal) ? delivVal : [delivVal];
      return DELIVERIES.filter(d => ids.includes(d.DeliveryDocument));
    });

    this.on('READ', 'A_OutbDeliveryItem', req => {
      const sel      = req.query.SELECT;
      const delivVal = getFilter(sel, 'DeliveryDocument') ?? null;
      let results = delivVal
        ? DELIVERY_ITEMS.filter(i => i.DeliveryDocument === delivVal)
        : DELIVERY_ITEMS;
      const offset = sel.limit?.offset?.val ?? 0;
      const rows   = sel.limit?.rows?.val;
      if (rows !== undefined) results = results.slice(offset, offset + rows);
      else if (offset)        results = results.slice(offset);
      return results;
    });

    this.on('PostGoodsIssue', req => {
      const { DeliveryDocument } = req.data;
      const d = DELIVERIES.find(d => d.DeliveryDocument === DeliveryDocument);
      if (!d) return req.reject(404, `Entrega ${DeliveryDocument} no encontrada`);
      if (d.OverallGoodsMovementStatus === 'C') return req.reject(400, 'GI ya registrada para esta entrega');
      d.OverallGoodsMovementStatus = 'C';
      d.ActualGoodsMovementDate    = new Date().toISOString();
      return d;
    });

    this.on('READ', 'A_OutbDeliveryDocFlow', req => {
      const sel      = req.query.SELECT;
      const precVal  = getFilter(sel, 'PrecedingDocument');
      const catVal   = getFilter(sel, 'SubsequentDocumentCategory');
      let rows = DELIVERY_DOC_FLOW;
      if (precVal) rows = rows.filter(r => r.PrecedingDocument === precVal);
      // catVal puede ser string (eq) o array (in)
      if (catVal)  rows = rows.filter(r =>
        Array.isArray(catVal) ? catVal.includes(r.SubsequentDocumentCategory)
                              : r.SubsequentDocumentCategory === catVal
      );
      return rows;
    });

    await super.init();
  }
};
