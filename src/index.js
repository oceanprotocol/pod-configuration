
const { Ocean, Account } = require('@oceanprotocol/squid')
const PrivateKeyProvider = require('truffle-privatekey-provider')
const Wallet = require('ethereumjs-wallet')
const fs = require('fs')

const credentials = '***'
const password = '***'

const dir = '***'
const inputsDir = dir + '/inputs'
const transformationDir = dir + '/transformations'

;(async function() {
  // Config
  const credentialsWallet = Wallet.fromV3(fs.readFileSync(credentials).toString(), password, true)
  const publicKey = credentialsWallet.getAddress().toString('hex')

  const nodeUri = 'http://localhost:8545'
  const ocean = await Ocean.getInstance({
    nodeUri,
    aquariusUri: 'http://172.15.0.15:5000',
    brizoUri: 'http://localhost:8030',
    secretStoreUri: 'http://localhost:12001',
    parityUri: 'http://localhost:9545',
    threshold: 0,
    verbose: false,
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
    const ddo = await ocean.assets.resolve()
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
  const consumeTransformations = transformations.map(consumeToFolder(transformationDir))

  await Promise.all(consumeInputs)
  await Promise.all(consumeTransformations)
})()
  .then(() => console.log('Finished!'))
  .catch(e => console.error(e))
