#!/usr/bin/env node

const program = require('commander')
const { Ocean, Account } = require('@oceanprotocol/squid')
const Wallet = require('ethereumjs-wallet')
const fs = require('fs')

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-n, --node <url>', 'Node URL')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-l, --path <path>', 'Volume path')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    let {workflow, node, credentials, password, path, verbose} = program
    const config = {workflow, node, credentials, password, path, verbose}

    main(config)
      .then(() => {
        if (verbose) {
          console.log('Finished!')
        }
        process.exit(0)
      })
      .catch(e => console.error(e))
  })
  .parse(process.argv)

async function main({
  workflow: workflowPath,
  node: nodeUri,
  credentials,
  password,
  path,
  verbose,
}) {

  const inputsDir = `${path}/inputs`
  const transformationsDir = `${path}/transformations`

  // Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = '0x' + credentialsWallet.getAddress().toString('hex')

  const ocean = await Ocean.getInstance({
    nodeUri,
    parityUri: nodeUri,
    threshold: 0,
    verbose,
  })

  const consumer = new Account(publicKey, ocean.instanceConfig)
  consumer.setPassword(password)

  // DIDs to be consumed
  const cleanList = (id, i, list) => id && list.indexOf(id) === i

  const {stages} = JSON.parse(fs.readFileSync(workflowPath).toString())
    .service
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
    try {
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
    } catch (error) {
      console.error({
        did,
        error,
      })
      throw error
    }
  }

  const consumeInputs = inputs.map(consumeToFolder(inputsDir))
  const consumeTransformations = transformations.map(consumeToFolder(transformationsDir))

  await Promise.all(consumeInputs)
  await Promise.all(consumeTransformations)
}
