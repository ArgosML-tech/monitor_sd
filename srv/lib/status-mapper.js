'use strict';

const SD_PROCESS = {
  A: 'Abierto',
  B: 'En proceso',
  C: 'Completado'
};

const GOODS_MOVEMENT = {
  A: 'Sin salida de mercancía',
  B: 'GI parcial',
  C: 'GI completa'
};

const PICKING = {
  A: 'Picking pendiente',
  B: 'Picking parcial',
  C: 'Picking completado'
};

const BILLING = {
  A: 'Sin facturar',
  B: 'Facturación parcial',
  C: 'Completamente facturado'
};

const DELIVERY_HDR = {
  A: 'Sin entregar',
  B: 'Entrega parcial',
  C: 'Completamente entregado'
};

const BILLING_HDR = {
  A: 'Sin facturar',
  B: 'Facturación parcial',
  C: 'Completamente facturado'
};

const BILLING_DOC_CATEGORY = {
  M: 'Factura',
  N: 'Nota de crédito',
  O: 'Nota de débito',
  P: 'Pro-forma'
};

module.exports = {
  sdProcessText:       code => SD_PROCESS[code]           ?? code,
  goodsMovementText:   code => GOODS_MOVEMENT[code]       ?? code,
  pickingText:         code => PICKING[code]               ?? code,
  billingText:         code => BILLING[code]               ?? code,
  deliveryHdrText:     code => DELIVERY_HDR[code]          ?? code,
  billingHdrText:      code => BILLING_HDR[code]           ?? code,
  billingCategoryText: code => BILLING_DOC_CATEGORY[code]  ?? code,

  deliveryDelayDays: (requestedDate, overallDeliveryStatus) => {
    if (overallDeliveryStatus === 'C' || !requestedDate) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(requestedDate).getTime()) / 86_400_000));
  }
};
