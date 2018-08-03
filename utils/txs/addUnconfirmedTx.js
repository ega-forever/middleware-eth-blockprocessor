/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  models = require('../../models'),
  config = require('../../config'),
  sem = require('semaphore')(1),
  log = bunyan.createLogger({name: 'core.blockProcessor.utils.addUnconfirmedTx', level: config.logs.level});

/**
 * @function
 * @description add unconfirmed tx to cache
 * @param tx - unconfirmed transaction
 * @returns {Promise.<*>}
 */

const addTx = async (tx) => {

  tx = {
    _id: tx.hash,
    blockNumber: -1,
    index: tx.transactionIndex,
    value: tx.value.toString(),
    to: tx.to,
    nonce: tx.nonce,
    input: tx.input,
    gasPrice: tx.gasPrice.toString(),
    gas: tx.gas,
    from: tx.from
  };

  log.info(`inserting unconfirmed tx ${tx._id}`);
  await models.txModel.create(tx);

};


module.exports = async (tx) => {

  return await new Promise((res, rej) => {
    sem.take(async () => {
      try {
        await addTx(tx);
        res();
      } catch (err) {
        rej(err);
      }

      sem.leave();
    });
  });

};