'use strict';
const { sdProcessText, goodsMovementText, pickingText, billingText } = require('../srv/lib/status-mapper');

describe('status-mapper', () => {

  describe('sdProcessText', () => {
    test.each([
      ['A', 'Abierto'],
      ['B', 'En proceso'],
      ['C', 'Completado'],
    ])('%s → %s', (code, expected) => {
      expect(sdProcessText(code)).toBe(expected);
    });

    test('código desconocido pasa tal cual', () => {
      expect(sdProcessText('X')).toBe('X');
      expect(sdProcessText('')).toBe('');
    });
  });

  describe('goodsMovementText', () => {
    test.each([
      ['A', 'Sin salida de mercancía'],
      ['B', 'GI parcial'],
      ['C', 'GI completa'],
    ])('%s → %s', (code, expected) => {
      expect(goodsMovementText(code)).toBe(expected);
    });

    test('código desconocido pasa tal cual', () => {
      expect(goodsMovementText('Z')).toBe('Z');
    });
  });

  describe('pickingText', () => {
    test.each([
      ['A', 'Picking pendiente'],
      ['B', 'Picking parcial'],
      ['C', 'Picking completado'],
    ])('%s → %s', (code, expected) => {
      expect(pickingText(code)).toBe(expected);
    });

    test('código desconocido pasa tal cual', () => {
      expect(pickingText('D')).toBe('D');
    });
  });

  describe('billingText', () => {
    test.each([
      ['A', 'Sin facturar'],
      ['B', 'Facturación parcial'],
      ['C', 'Completamente facturado'],
    ])('%s → %s', (code, expected) => {
      expect(billingText(code)).toBe(expected);
    });

    test('código desconocido pasa tal cual', () => {
      expect(billingText('Q')).toBe('Q');
    });
  });
});
