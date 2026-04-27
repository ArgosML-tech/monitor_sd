using { API_SALES_ORDER_SRV           as SalesOrderAPI } from './external/API_SALES_ORDER_SRV';
using { OP_API_OUTBOUND_DELIVERY_SRV_0002 as DeliveryAPI  } from './external/OP_API_OUTBOUND_DELIVERY_SRV_0002';
using { API_BILLING_DOCUMENT_SRV      as BillingAPI    } from './external/API_BILLING_DOCUMENT_SRV';

@cds.query.limit.default: 50
@cds.query.limit.max:     500
service MonitorSDService @(path: '/odata/v4/MonitorSDService') {

  // ─── Nivel 1: Lista de Pedidos ───────────────────────────────────────────
  @readonly
  entity SalesOrders as projection on SalesOrderAPI.A_SalesOrder {
    key SalesOrder,
        SalesOrderType,
        SalesOrganization,
        SoldToParty,
        PurchaseOrderByCustomer,
        CreationDate,
        RequestedDeliveryDate,
        TotalNetAmount,
        TransactionCurrency,
        OverallSDProcessStatus,
        // Campos de estado adicionales (ya en A_SalesOrder)
        OverallDeliveryStatus,
        OverallOrdReltdBillgStatus,
        TotalBlockStatus,
        DeliveryBlockReason,
        HeaderBillingBlockReason,
        TotalCreditCheckStatus,
        // Campos virtuales calculados en handler
        virtual OverallSDProcessStatusText       : String,
        virtual OverallDeliveryStatusText        : String,
        virtual OverallOrdReltdBillgStatusText   : String,
        virtual TotalBlockStatusText             : String,
        virtual DeliveryDelayDays                : Integer,
        // Asociaciones de navegación
        Deliveries : Association to many Deliveries
                     on Deliveries.SalesOrderRef = $self.SalesOrder,
        Items      : Association to many SalesOrderItems
                     on Items.SalesOrder = $self.SalesOrder
  } actions {
    // Quitar bloqueo de entrega del pedido (solo disponible si hay bloqueo activo)
    @(
      Core.OperationAvailable: { $edmJson: {
        $Ne: [{ $Path: 'DeliveryBlockReason' }, '']
      }},
      Common.SideEffects: {
        TargetProperties: ['DeliveryBlockReason', 'TotalBlockStatus', 'TotalBlockStatusText']
      }
    )
    action ReleaseDeliveryBlock() returns SalesOrders;
  };

  // ─── Nivel 2: Entregas ───────────────────────────────────────────────────
  @readonly
  entity Deliveries as select from DeliveryAPI.A_OutbDeliveryHeader {
    key DeliveryDocument,
        DeliveryDocumentType,
        ShippingPoint,
        SalesOrganization,
        ShipToParty,
        DeliveryDate,
        ActualGoodsMovementDate,
        OverallGoodsMovementStatus,
        OverallPickingStatus,
        null as SalesOrderRef                  : String,
        virtual OverallGoodsMovementStatusText : String,
        virtual OverallPickingStatusText       : String,
        BillingDocuments : Association to many BillingDocuments
                           on BillingDocuments.DeliveryRef = $self.DeliveryDocument,
        Items            : Association to many DeliveryItems
                           on Items.DeliveryDocument = $self.DeliveryDocument
  } actions {
    // Registrar salida de mercancía (solo disponible si GI no está completa)
    @(
      Core.OperationAvailable: { $edmJson: {
        $Ne: [{ $Path: 'OverallGoodsMovementStatus' }, 'C']
      }},
      Common.SideEffects: {
        TargetProperties: ['OverallGoodsMovementStatus', 'OverallGoodsMovementStatusText',
                           'ActualGoodsMovementDate']
      }
    )
    action PostGoodsIssue() returns Deliveries;
  };

  // ─── Nivel 3: Facturas ───────────────────────────────────────────────────
  @readonly
  entity BillingDocuments as select from BillingAPI.A_BillingDocument {
    key BillingDocument,
        BillingDocumentType,
        BillingDocumentCategory,
        BillingDocumentDate,
        SalesOrganization,
        TotalGrossAmount,
        TransactionCurrency,
        AccountingDocument,
        OverallBillingStatus,
        BillingDocumentIsCancelled,
        null as DeliveryRef              : String,
        virtual OverallBillingStatusText    : String,
        virtual BillingDocumentCategoryText : String,
        Items : Association to many BillingDocumentItems
                on Items.BillingDocument = $self.BillingDocument
  };

  // ─── Posiciones de Pedido ────────────────────────────────────────────────
  @readonly
  entity SalesOrderItems as projection on SalesOrderAPI.A_SalesOrderItem {
    key SalesOrder,
    key SalesOrderItem,
        SalesOrderItemCategory,
        SalesOrderItemText,
        Material,
        MaterialByCustomer,
        RequestedQuantity,
        RequestedQuantityUnit,
        NetAmount,
        TransactionCurrency,
        SDProcessStatus,
        DeliveryStatus,
        OrderRelatedBillingStatus,
        ItemBillingBlockReason,
        SalesDocumentRjcnReason,
        HigherLevelItem,
        ReferenceSDDocument,
        ReferenceSDDocumentItem,
        virtual SDProcessStatusText  : String,
        virtual DeliveryStatusText   : String
  };

  // ─── Posiciones de Entrega ───────────────────────────────────────────────
  @readonly
  entity DeliveryItems as projection on DeliveryAPI.A_OutbDeliveryItem {
    key DeliveryDocument,
    key DeliveryDocumentItem,
        Material,
        DeliveryDocumentItemText,
        ActualDeliveryQuantity,
        OriginalDeliveryQuantity,
        DeliveryQuantityUnit,
        GoodsMovementStatus,
        PickingStatus,
        PickingConfirmationStatus,
        Batch,
        StorageLocation,
        ItemGrossWeight,
        ItemNetWeight,
        ItemWeightUnit,
        ReferenceSDDocument,
        ReferenceSDDocumentItem,
        virtual GoodsMovementStatusText : String,
        virtual PickingStatusText       : String
  };

  // ─── Posiciones de Factura ───────────────────────────────────────────────
  @readonly
  entity BillingDocumentItems as projection on BillingAPI.A_BillingDocumentItem {
    key BillingDocument,
    key BillingDocumentItem,
        SalesDocumentItemCategory,
        Material,
        BillingDocumentItemText,
        BillingQuantity,
        BillingQuantityUnit,
        NetAmount,
        TaxAmount,
        GrossAmount,
        TransactionCurrency,
        ReferenceSDDocument,
        ReferenceSDDocumentItem
  };

  // ─── DocFlow auxiliar: SO → Entregas ────────────────────────────────────
  @readonly
  entity SODocFlow as projection on SalesOrderAPI.A_SalesOrderSubsqntProcFlow {
    key SalesOrder,
    key DocRelationshipUUID,
        SubsequentDocument,
        SubsequentDocumentCategory
  };

  // ─── DocFlow auxiliar: Entrega → Facturas ────────────────────────────────
  @readonly
  entity DeliveryDocFlow as projection on DeliveryAPI.A_OutbDeliveryDocFlow {
    key PrecedingDocument,
    key PrecedingDocumentItem,
    key SubsequentDocumentCategory,
        Subsequentdocument,
        PrecedingDocumentCategory
  };
}
