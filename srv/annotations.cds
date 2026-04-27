using MonitorSDService from './monitor-sd-service';

// Ocultar los campos de enlace interno — son nulos en OData y no son para el usuario
annotate MonitorSDService.Deliveries       with { SalesOrderRef @UI.Hidden; }
annotate MonitorSDService.BillingDocuments with { DeliveryRef   @UI.Hidden; }

// ════════════════════════════════════════════════════════════════════════════
// NIVEL 1 — SalesOrders: ListReport + cabecera ObjectPage
// ════════════════════════════════════════════════════════════════════════════

annotate MonitorSDService.SalesOrders with @(

  UI.HeaderInfo: {
    TypeName:       'Pedido de venta',
    TypeNamePlural: 'Pedidos de venta',
    Title:          { Value: SalesOrder },
    Description:    { Value: SoldToParty }
  },

  UI.SelectionFields: [ SoldToParty, SalesOrganization, CreationDate, OverallSDProcessStatus ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: SalesOrder,              Label: 'Pedido'           },
    { $Type: 'UI.DataField', Value: SoldToParty,             Label: 'Cliente'          },
    { $Type: 'UI.DataField', Value: PurchaseOrderByCustomer, Label: 'Ref. cliente'     },
    { $Type: 'UI.DataField', Value: CreationDate,            Label: 'Creación'         },
    { $Type: 'UI.DataField', Value: RequestedDeliveryDate,   Label: 'Entrega solicit.' },
    { $Type: 'UI.DataField', Value: TotalNetAmount,          Label: 'Importe neto'     },
    { $Type: 'UI.DataField', Value: TransactionCurrency,     Label: 'Moneda'           },
    {
      $Type:  'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#SOStatus',
      Label:  'Estado'
    },
    {
      $Type:  'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#BlockStatus',
      Label:  'Bloqueo'
    },
    {
      $Type:  'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#DelayDays',
      Label:  'Retraso'
    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'MonitorSDService.ReleaseDeliveryBlock',
      Label:  'Quitar bloqueo',
      Inline: true
    }
  ],

  UI.DataPoint #SOStatus: {
    Value:       OverallSDProcessStatus,
    Title:       'Estado del pedido',
    Criticality: { $edmJson: {
      $If: [
        { $Eq: [ { $Path: 'OverallSDProcessStatus' }, 'A' ] }, 3,
        { $If: [
          { $Eq: [ { $Path: 'OverallSDProcessStatus' }, 'B' ] }, 2,
          5
        ]}
      ]
    }}
  },

  UI.DataPoint #BlockStatus: {
    Value:       TotalBlockStatus,
    Title:       'Bloqueo',
    Criticality: { $edmJson: {
      $If: [{ $Ne: [{ $Path: 'TotalBlockStatus' }, ''] }, 1, 0]
    }}
  },

  UI.DataPoint #DelayDays: {
    Value:       DeliveryDelayDays,
    Title:       'Días de retraso',
    Criticality: { $edmJson: {
      $If: [{ $Gt: [{ $Path: 'DeliveryDelayDays' }, 7] }, 1,
      { $If: [{ $Gt: [{ $Path: 'DeliveryDelayDays' }, 0] }, 2, 5]}]
    }}
  },

  // ── ObjectPage: secciones ────────────────────────────────────────────────
  UI.FieldGroup #SOHeader: {
    Label: 'Datos generales',
    Data: [
      { $Type: 'UI.DataField', Value: SalesOrder,              Label: 'Pedido'           },
      { $Type: 'UI.DataField', Value: SalesOrderType,          Label: 'Tipo'             },
      { $Type: 'UI.DataField', Value: SalesOrganization,       Label: 'Org. ventas'      },
      { $Type: 'UI.DataField', Value: SoldToParty,             Label: 'Cliente'          },
      { $Type: 'UI.DataField', Value: PurchaseOrderByCustomer, Label: 'Ref. cliente'     },
      { $Type: 'UI.DataField', Value: CreationDate,            Label: 'Creación'         },
      { $Type: 'UI.DataField', Value: RequestedDeliveryDate,   Label: 'Entrega solicit.' }
    ]
  },

  UI.FieldGroup #SOFinancials: {
    Label: 'Importes',
    Data: [
      { $Type: 'UI.DataField', Value: TotalNetAmount,                  Label: 'Importe neto'       },
      { $Type: 'UI.DataField', Value: TransactionCurrency,             Label: 'Moneda'             },
      { $Type: 'UI.DataField', Value: OverallSDProcessStatusText,      Label: 'Estado'             },
      { $Type: 'UI.DataField', Value: OverallDeliveryStatusText,       Label: 'Estado entrega'     },
      { $Type: 'UI.DataField', Value: OverallOrdReltdBillgStatusText,  Label: 'Estado facturación' }
    ]
  },

  UI.Facets: [
    {
      $Type:  'UI.CollectionFacet',
      ID:     'SOInfo',
      Label:  'Información del pedido',
      Facets: [
        { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#SOHeader',     Label: 'General'  },
        { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#SOFinancials', Label: 'Importes' }
      ]
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'SOItems',
      Target: 'Items/@UI.LineItem',
      Label:  'Posiciones del pedido'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'Deliveries',
      Target: 'Deliveries/@UI.LineItem',
      Label:  'Entregas'
    }
  ]
);

// ════════════════════════════════════════════════════════════════════════════
// NIVEL 2 — Deliveries: tabla en SO ObjectPage + ObjectPage propio
// ════════════════════════════════════════════════════════════════════════════

annotate MonitorSDService.Deliveries with @(

  UI.HeaderInfo: {
    TypeName:       'Entrega',
    TypeNamePlural: 'Entregas',
    Title:          { Value: DeliveryDocument },
    Description:    { Value: ShippingPoint }
  },

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: DeliveryDocument,        Label: 'Entrega'     },
    { $Type: 'UI.DataField', Value: ShippingPoint,           Label: 'Punto envío' },
    { $Type: 'UI.DataField', Value: DeliveryDate,            Label: 'Fecha prev.' },
    { $Type: 'UI.DataField', Value: ActualGoodsMovementDate, Label: 'Fecha GI'    },
    { $Type: 'UI.DataField', Value: OverallPickingStatusText,Label: 'Picking'     },
    {
      $Type:  'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#DeliveryStatus',
      Label:  'Estado GI'
    },
    {
      $Type:  'UI.DataFieldForAction',
      Action: 'MonitorSDService.PostGoodsIssue',
      Label:  'Registrar GI',
      Inline: true
    }
  ],

  UI.DataPoint #DeliveryStatus: {
    Value:       OverallGoodsMovementStatus,
    Title:       'Estado GI',
    Criticality: { $edmJson: {
      $If: [
        { $Eq: [ { $Path: 'OverallGoodsMovementStatus' }, 'A' ] }, 1,
        { $If: [
          { $Eq: [ { $Path: 'OverallGoodsMovementStatus' }, 'B' ] }, 2,
          3
        ]}
      ]
    }}
  },

  UI.Identification: [{
    $Type:  'UI.DataFieldForAction',
    Action: 'MonitorSDService.PostGoodsIssue',
    Label:  'Registrar salida de mercancía'
  }],

  UI.FieldGroup #DeliveryHeader: {
    Label: 'Datos de entrega',
    Data: [
      { $Type: 'UI.DataField', Value: DeliveryDocument,               Label: 'Entrega'         },
      { $Type: 'UI.DataField', Value: DeliveryDocumentType,           Label: 'Tipo'            },
      { $Type: 'UI.DataField', Value: ShippingPoint,                  Label: 'Punto envío'     },
      { $Type: 'UI.DataField', Value: SalesOrganization,              Label: 'Org. ventas'     },
      { $Type: 'UI.DataField', Value: ShipToParty,                    Label: 'Dest. mercancía' },
      { $Type: 'UI.DataField', Value: DeliveryDate,                   Label: 'Fecha prevista'  },
      { $Type: 'UI.DataField', Value: ActualGoodsMovementDate,        Label: 'Fecha GI real'   },
      { $Type: 'UI.DataField', Value: OverallGoodsMovementStatusText, Label: 'Estado GI'       },
      { $Type: 'UI.DataField', Value: OverallPickingStatusText,       Label: 'Estado picking'  }
    ]
  },

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'DeliveryInfo',
      Target: '@UI.FieldGroup#DeliveryHeader',
      Label:  'Datos de entrega'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'DelivItems',
      Target: 'Items/@UI.LineItem',
      Label:  'Posiciones de entrega'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'BillingDocuments',
      Target: 'BillingDocuments/@UI.LineItem',
      Label:  'Facturas'
    }
  ]
);

// ════════════════════════════════════════════════════════════════════════════
// NIVEL 3 — BillingDocuments: tabla en Delivery ObjectPage + ObjectPage propio
// ════════════════════════════════════════════════════════════════════════════

annotate MonitorSDService.BillingDocuments with @(

  UI.HeaderInfo: {
    TypeName:       'Factura',
    TypeNamePlural: 'Facturas',
    Title:          { Value: BillingDocument },
    Description:    { Value: BillingDocumentType }
  },

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: BillingDocumentCategoryText, Label: 'Tipo'           },
    { $Type: 'UI.DataField', Value: BillingDocument,             Label: 'Factura'        },
    { $Type: 'UI.DataField', Value: BillingDocumentDate,         Label: 'Fecha'          },
    { $Type: 'UI.DataField', Value: TotalGrossAmount,            Label: 'Importe bruto'  },
    { $Type: 'UI.DataField', Value: TransactionCurrency,         Label: 'Moneda'         },
    { $Type: 'UI.DataField', Value: AccountingDocument,          Label: 'Doc. contable'  },
    { $Type: 'UI.DataField', Value: OverallBillingStatusText,    Label: 'Estado'         },
    {
      $Type:  'UI.DataFieldForAnnotation',
      Target: '@UI.DataPoint#BillingCancelled',
      Label:  'Cancelada'
    }
  ],

  UI.DataPoint #BillingCancelled: {
    Value:       BillingDocumentIsCancelled,
    Title:       'Factura cancelada',
    Criticality: { $edmJson: {
      $If: [ { $Path: 'BillingDocumentIsCancelled' }, 1, 5 ]
    }}
  },

  UI.FieldGroup #BillingHeader: {
    Label: 'Datos de factura',
    Data: [
      { $Type: 'UI.DataField', Value: BillingDocument,             Label: 'Factura'        },
      { $Type: 'UI.DataField', Value: BillingDocumentCategoryText, Label: 'Tipo documento' },
      { $Type: 'UI.DataField', Value: BillingDocumentType,         Label: 'Clase factura'  },
      { $Type: 'UI.DataField', Value: BillingDocumentDate,         Label: 'Fecha'          },
      { $Type: 'UI.DataField', Value: SalesOrganization,           Label: 'Org. ventas'    },
      { $Type: 'UI.DataField', Value: TotalGrossAmount,            Label: 'Importe bruto'  },
      { $Type: 'UI.DataField', Value: TransactionCurrency,         Label: 'Moneda'         },
      { $Type: 'UI.DataField', Value: AccountingDocument,          Label: 'Doc. contable'  },
      { $Type: 'UI.DataField', Value: OverallBillingStatusText,    Label: 'Estado'         }
    ]
  },

  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'BillingInfo',
      Target: '@UI.FieldGroup#BillingHeader',
      Label:  'Datos de factura'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'BillItems',
      Target: 'Items/@UI.LineItem',
      Label:  'Posiciones de factura'
    }
  ]
);

// ════════════════════════════════════════════════════════════════════════════
// POSICIONES — Tablas de líneas de documento
// ════════════════════════════════════════════════════════════════════════════

annotate MonitorSDService.SalesOrderItems with @(
  UI.HeaderInfo: {
    TypeName:       'Posición',
    TypeNamePlural: 'Posiciones',
    Title:          { Value: SalesOrderItem }
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: SalesOrderItem,        Label: 'Pos.'           },
    { $Type: 'UI.DataField', Value: Material,              Label: 'Material'       },
    { $Type: 'UI.DataField', Value: SalesOrderItemText,    Label: 'Descripción'    },
    { $Type: 'UI.DataField', Value: RequestedQuantity,     Label: 'Cantidad'       },
    { $Type: 'UI.DataField', Value: RequestedQuantityUnit, Label: 'UM'             },
    { $Type: 'UI.DataField', Value: NetAmount,             Label: 'Importe'        },
    { $Type: 'UI.DataField', Value: TransactionCurrency,   Label: 'Mon.'           },
    { $Type: 'UI.DataField', Value: DeliveryStatusText,    Label: 'Estado entrega' },
    { $Type: 'UI.DataField', Value: SDProcessStatusText,   Label: 'Estado'         }
  ]
);

annotate MonitorSDService.DeliveryItems with @(
  UI.HeaderInfo: {
    TypeName:       'Posición entrega',
    TypeNamePlural: 'Posiciones de entrega',
    Title:          { Value: DeliveryDocumentItem }
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: DeliveryDocumentItem,     Label: 'Pos.'           },
    { $Type: 'UI.DataField', Value: Material,                 Label: 'Material'       },
    { $Type: 'UI.DataField', Value: DeliveryDocumentItemText, Label: 'Descripción'    },
    { $Type: 'UI.DataField', Value: ActualDeliveryQuantity,   Label: 'Cantidad real'  },
    { $Type: 'UI.DataField', Value: OriginalDeliveryQuantity, Label: 'Cantidad prev.' },
    { $Type: 'UI.DataField', Value: DeliveryQuantityUnit,     Label: 'UM'             },
    { $Type: 'UI.DataField', Value: GoodsMovementStatusText,  Label: 'Estado GI'      },
    { $Type: 'UI.DataField', Value: PickingStatusText,        Label: 'Picking'        },
    { $Type: 'UI.DataField', Value: Batch,                    Label: 'Lote'           },
    { $Type: 'UI.DataField', Value: StorageLocation,          Label: 'Almacén'        },
    { $Type: 'UI.DataField', Value: ReferenceSDDocument,      Label: 'Pedido ref.'    }
  ]
);

annotate MonitorSDService.BillingDocumentItems with @(
  UI.HeaderInfo: {
    TypeName:       'Posición factura',
    TypeNamePlural: 'Posiciones de factura',
    Title:          { Value: BillingDocumentItem }
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: BillingDocumentItem,     Label: 'Pos.'        },
    { $Type: 'UI.DataField', Value: Material,                Label: 'Material'    },
    { $Type: 'UI.DataField', Value: BillingDocumentItemText, Label: 'Descripción' },
    { $Type: 'UI.DataField', Value: BillingQuantity,         Label: 'Cantidad'    },
    { $Type: 'UI.DataField', Value: BillingQuantityUnit,     Label: 'UM'          },
    { $Type: 'UI.DataField', Value: NetAmount,               Label: 'Imp. neto'   },
    { $Type: 'UI.DataField', Value: TaxAmount,               Label: 'IVA'         },
    { $Type: 'UI.DataField', Value: GrossAmount,             Label: 'Imp. bruto'  },
    { $Type: 'UI.DataField', Value: TransactionCurrency,     Label: 'Mon.'        },
    { $Type: 'UI.DataField', Value: ReferenceSDDocument,     Label: 'Entrega ref.'}
  ]
);
