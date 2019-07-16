#!/usr/bin/env node

const program = require('commander')
const { Ocean, Account } = require('@oceanprotocol/squid')
const Wallet = require('ethereumjs-wallet')
const fs = require('fs')

program
  .option('-w, --workflow <json>', 'Workflow configuraton')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-i, --inputs <path>', 'Input path')
  .option('-t, --transformations <path>', 'Transformations path')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    let {workflow, credentials, password, inputs, transformations, verbose} = program
    workflow = JSON.parse(workflow)
    const config = {workflow, credentials, password, inputs, transformations, verbose}

    main(config)
      .then(() => console.log('Finished!'))
      .catch(e => console.error(e))
  })
  .parse(process.argv)

async function main({
  workflow,
  credentials,
  password,
  inputs: inputsDir,
  transformations: transformationsDir,
  verbose,
}) {

  // Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = '0x' + credentialsWallet.getAddress().toString('hex')

  const nodeUri = 'http://localhost:8545'
  const ocean = await Ocean.getInstance({
    nodeUri,
    parityUri: 'http://localhost:9545',
    threshold: 0,
    verbose,
  })

  const consumer = new Account(publicKey, ocean.instanceConfig)
  consumer.setPassword(password)

  // DIDs to be consumed
  const cleanList = (id, i, list) => id && list.indexOf(id) === i

  const {stages} = workflow.service
    .find(({type}) => type === 'Metadata')
    .metadata
    .workflow

  const inputs = stages
    .reduce((acc, {input}) => [...acc, ...input], [])
    .map(({id}) => id)
    .filter(cleanList)

  const transformations = stages
    .reduce((acc, {transformation}) => [...acc, transformation], [])
    .map(({id}) => id)
    .filter(cleanList)

  // Consume the assets
  const consumeToFolder = folder => async did => {
    const ddo = await ocean.assets.resolve(did)
    await ocean.assets.consume(
      undefined,
      did,
      ddo.findServiceByType('Access').serviceDefinitionId,
      consumer,
      folder,
      undefined,
      true
    )
  }

  const consumeInputs = inputs.map(consumeToFolder(inputsDir))
  const consumeTransformations = transformations.map(consumeToFolder(transformationsDir))

  await Promise.all(consumeInputs)
  await Promise.all(consumeTransformations)
}
