/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const bunyan = require('bunyan'),
  _ = require('lodash'),
  web3ProvidersService = require('../services/web3ProvidersService'),
  crypto = require('crypto'),
  sem = require('semaphore')(3),
  Promise = require('bluebird'),
  blockModel = require('../models/blockModel'),
  txModel = require('../models/txModel'),
  txLogModel = require('../models/txLogModel'),
  log = bunyan.createLogger({name: 'app.services.addBlock'});

/**
 * @service
 * @description filter txs by registered addresses
 * @param block - an array of txs
 * @returns {Promise.<*>}
 */

const addBlock = async (block, removePending = false) => {

  return new Promise((res, rej) => {

    sem.take(async () => {
      try {
        await updateDbStateWithBlock(block, removePending);
        res();
      } catch (err) {
        log.error(err);
        await rollbackStateFromBlock(block);
        rej(err);
      }
      sem.leave();
    });

  });

};

const updateDbStateWithBlock = async (block, removePending) => {

  let txs = block.transactions.map(tx => ({
      _id: tx.hash,
      index: tx.transactionIndex,
      blockNumber: block.number,
      timestamp: tx.timestamp,
      value: tx.value.toString(),
      to: tx.to,
      nonce: tx.nonce,
      gasPrice: tx.gasPrice,
      gas: tx.gas,
      from: tx.from
    })
  );

  const logs = _.chain(block.transactions)
    .map(tx => tx.logs.map(log => ({
        _id: crypto.createHash('md5').update(`${block.number}x${log.transactionIndex}x${log.logIndex}`).digest('hex'),
        blockNumber: block.number,
        txIndex: log.transactionIndex,
        index: log.logIndex,
        removed: log.removed,
        signature: _.get(log, 'topics.0'), //0 topic
        topics: log.topics,
        address: log.address,
      })
      )
    )
    .flattenDeep()
    .value();

  log.info(`inserting ${txs.length} txs`);
  if (txs.length) {
    let bulkOps = txs.map(tx => ({
      updateOne: {
        filter: {_id: tx._id},
        update: tx,
        upsert: true
      }
    }));

    await txModel.bulkWrite(bulkOps);
  }

  log.info(`inserting ${logs.length} logs`);
  if (logs.length) {
    let bulkOps = logs.map(log => ({
      updateOne: {
        filter: {_id: log._id},
        update: {$set: log},
        upsert: true
      }
    }));

    await txLogModel.bulkWrite(bulkOps);
  }

  if (removePending) {
    log.info('removing confirmed / rejected txs');
    await removeOutDated();
  }

  let blockToSave = {
    _id: block.hash,
    number: block.number,
    timestamp: block.timestamp
  };

  await blockModel.update({number: blockToSave.number}, blockToSave, {upsert: true});

};

const rollbackStateFromBlock = async (block) => {

  log.info('rolling back txs state');
  await txModel.remove({blockNumber: block.number});

  log.info('rolling back tx logs state');
  await txLogModel.remove({blockNumber: block.number});

  log.info('rolling back blocks state');
  await blockModel.remove({number: block.number});
};

const removeOutDated = async () => {

  let web3s = await web3ProvidersService();

  const pendingBlock = await Promise.any(web3s.map(async (web3) => {
    return await Promise.promisify(web3.eth.getBlock)('pending').timeout(5000);
  }));

  if (!_.get(pendingBlock, 'transactions', []).length)
    return;

  if (pendingBlock.transactions.length)
    await txModel.remove({
      _id: {
        $in: pendingBlock.transactions
      }
    });

};

module.exports = addBlock;
