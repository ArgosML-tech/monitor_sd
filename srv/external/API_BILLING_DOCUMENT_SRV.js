'use strict';
const cds = require('@sap/cds');
const { getFilter } = require('../lib/mock-filter');

const BILLING_DOCS = [
  {
    BillingDocument: '90000001', BillingDocumentType: 'F2',
    BillingDocumentCategory: 'M', BillingDocumentDate: '2025-01-20',
    SalesOrganization: '1010',
    TotalGrossAmount: 15000.00, TransactionCurrency: 'EUR',
    AccountingDocument: 'ACC0001',
    OverallBillingStatus: 'C', BillingDocumentIsCancelled: false
  },
  {
    BillingDocument: '90000002', BillingDocumentType: 'F2',
    BillingDocumentCategory: 'M', BillingDocumentDate: '2025-02-15',
    SalesOrganization: '1010',
    TotalGrossAmount: 8500.00, TransactionCurrency: 'EUR',
    AccountingDocument: 'ACC0002',
    OverallBillingStatus: 'C', BillingDocumentIsCancelled: false
  },
  // Nota de crédito pendiente de contabilizar (AccountingDocument null)
  {
    BillingDocument: '90000099', BillingDocumentType: 'G2',
    BillingDocumentCategory: 'N', BillingDocumentDate: '2025-01-25',
    SalesOrganization: '1010',
    TotalGrossAmount: -2000.00, TransactionCurrency: 'EUR',
    AccountingDocument: null,
    OverallBillingStatus: 'C', BillingDocumentIsCancelled: false
  }
];

const BILLING_ITEMS = [
  { BillingDocument: '90000001', BillingDocumentItem: '000010',
    SalesDocumentItemCategory: 'TAN', Material: 'MAT-001',
    BillingDocumentItemText: 'Producto A',
    BillingQuantity: 5, BillingQuantityUnit: 'PC',
    NetAmount: 10000.00, TaxAmount: 2100.00, GrossAmount: 12100.00,
    TransactionCurrency: 'EUR',
    ReferenceSDDocument: '80000001', ReferenceSDDocumentItem: '000010' },
  { BillingDocument: '90000002', BillingDocumentItem: '000010',
    SalesDocumentItemCategory: 'TAN', Material: 'MAT-003',
    BillingDocumentItemText: 'Producto C',
    BillingQuantity: 10, BillingQuantityUnit: 'PC',
    NetAmount: 8500.00, TaxAmount: 1785.00, GrossAmount: 10285.00,
    TransactionCurrency: 'EUR',
    ReferenceSDDocument: '80000003', ReferenceSDDocumentItem: '000010' },
  { BillingDocument: '90000099', BillingDocumentItem: '000010',
    SalesDocumentItemCategory: 'G2N', Material: 'MAT-001',
    BillingDocumentItemText: 'Dev. parcial Producto A',
    BillingQuantity: -1, BillingQuantityUnit: 'PC',
    NetAmount: -2000.00, TaxAmount: -420.00, GrossAmount: -2420.00,
    TransactionCurrency: 'EUR',
    ReferenceSDDocument: '80000001', ReferenceSDDocumentItem: '000010' }
];

module.exports = class API_BILLING_DOCUMENT_SRV extends cds.Service {
  async init() {
    this.on('READ', 'A_BillingDocument', req => {
      const billVal = getFilter(req.query.SELECT, 'BillingDocument');
      if (!billVal) return BILLING_DOCS;
      const ids = Array.isArray(billVal) ? billVal : [billVal];
      return BILLING_DOCS.filter(b => ids.includes(b.BillingDocument));
    });

    this.on('READ', 'A_BillingDocumentItem', req => {
      const sel     = req.query.SELECT;
      const billVal = getFilter(sel, 'BillingDocument') ?? null;
      let results = billVal
        ? BILLING_ITEMS.filter(i => i.BillingDocument === billVal)
        : BILLING_ITEMS;
      const offset = sel.limit?.offset?.val ?? 0;
      const rows   = sel.limit?.rows?.val;
      if (rows !== undefined) results = results.slice(offset, offset + rows);
      else if (offset)        results = results.slice(offset);
      return results;
    });

    await super.init();
  }
};
