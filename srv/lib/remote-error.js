'use strict';

/**
 * Ejecuta una query CQN sobre un servicio remoto y transforma los errores.
 * Para acciones (send()), usar runAction().
 */
async function runRemote(req, remoteSvc, query, context = '') {
  const ctx = context ? ` (${context})` : '';
  try {
    return await remoteSvc.run(query);
  } catch (err) {
    const isTimeout     = err.message?.includes('timeout') || err.code === 'ECONNABORTED';
    const isUnreachable = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
    const status        = err.status ?? (typeof err.code === 'number' ? err.code : 503);

    if (isTimeout)
      req.reject(504, `S/4HANA no respondió a tiempo${ctx}. Inténtalo de nuevo.`);
    else if (isUnreachable)
      req.reject(503, `No se puede conectar con S/4HANA${ctx}. Verifica la conectividad BTP.`);
    else if (status >= 400 && status < 500)
      req.reject(status, err.message ?? `Error en S/4HANA${ctx}`);
    else
      req.reject(502, `Error inesperado en S/4HANA${ctx}: ${err.message}`);
    // req.reject lanza internamente — este return es inalcanzable pero satisface el linter
    return null;
  }
}

/**
 * Ejecuta una Promise de send() (acción/función remota) y transforma errores.
 * Los CQN queries NO son Promises aunque tengan .then() — usar runRemote para ellos.
 */
async function runAction(req, actionPromise, context = '') {
  const ctx = context ? ` (${context})` : '';
  try {
    return await actionPromise;
  } catch (err) {
    const isTimeout     = err.message?.includes('timeout') || err.code === 'ECONNABORTED';
    const isUnreachable = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
    const status        = err.status ?? (typeof err.code === 'number' ? err.code : 503);

    if (isTimeout)
      req.reject(504, `S/4HANA no respondió a tiempo${ctx}. Inténtalo de nuevo.`);
    else if (isUnreachable)
      req.reject(503, `No se puede conectar con S/4HANA${ctx}.`);
    else if (status >= 400 && status < 500)
      req.reject(status, err.message ?? `Error en S/4HANA${ctx}`);
    else
      req.reject(502, `Error inesperado en S/4HANA${ctx}: ${err.message}`);
    return null;
  }
}

module.exports = { runRemote, runAction };
