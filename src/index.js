#!/usr/bin/env node
const program = require('commander')
const fs = require('fs')
const { Ocean, ConfigHelper } = require('@oceanprotocol/lib')
const web3 = require('web3')
const Web3EthAccounts = require('web3-eth-accounts');
const pg = require('pg')
const got = require('got')
const stream = require('stream')
const { promisify } = require('util')

const pipeline = promisify(stream.pipeline)

var pgpool = new pg.Pool({
  user: process.env.POSTGRES_USER,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  max: 10, // max number of clients in the pool
  idleTimeoutMillis: 30000 // how long a client is allowed to remain idle before being closed
})
let Web3
let web3Accounts
let ocean
let account

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-l, --path <path>', 'Volume path')
  .option('--workflowid <workflowid>', 'Workflow id')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    const { workflow, path, workflowid, verbose } = program
    const config = { workflow, path, workflowid, verbose }

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

async function main({ workflow: workflowPath, path, workflowid, verbose }) {
  let status = 30
  const inputsDir = `${path}/inputs`
  try {
    fs.mkdirSync(inputsDir)
    fs.chmodSync(inputsDir, 777)
  }
  catch (e) { console.error(e) }
  const transformationsDir = `${path}/transformations`
  try { 
    fs.mkdirSync(transformationsDir)
  }
  catch (e) { 
    console.error(e) 
  }
  const logsDir = `${path}/logs`
  try {
    fs.mkdirSync(logsDir)
    fs.chmodSync(logsDir, 777)
    // create the algo log as well
    const algoLogPath = `${path}/logs/algorithm.log`
    fs.writeFileSync(algoLogPath, '');
    fs.chmodSync(algoLogPath, 777)
  }
  catch (e) { console.error(e) }
  const ddoDir = `${path}/ddos`
  try { fs.mkdirSync(ddoDir) }
  catch (e) { console.error(e) }
  const outputsDir = `${path}/outputs`
  try {
    fs.mkdirSync(outputsDir)
    fs.chmodSync(outputsDir, 777)
  }
  catch (e) { console.error(e) }
  const { stages } = JSON.parse(fs.readFileSync(workflowPath).toString())
  if (process.env.PRIVATE_KEY) {
    Web3 = new web3()
    web3Accounts = new Web3EthAccounts()
    account = web3Accounts.privateKeyToAccount(process.env.PRIVATE_KEY).address
    console.log("Using address " + account + " as consumer if we connect to remote providers.")
  }
  const oceanconfig = new ConfigHelper().getConfig('development')
  oceanconfig.metadataCacheUri = stages[0].output.metadataUri
  console.log("Set metadatacache to " + oceanconfig.metadataCacheUri)
  ocean = await Ocean.getInstance(oceanconfig)
  console.log("========== Fetching input assets ============")
  const inputs = stages.reduce((acc, { input }) => [...acc, ...input], [])
  for (var i = 0; i < inputs.length; i++) {
    console.log("========\nProcessing input " + i + " (" + inputs[i].id + ")")
    const folder = inputsDir + '/' + inputs[i].id.replace('did:op:', '') + '/'
    try {
      fs.mkdirSync(folder)
    } catch (e) {
      console.error(e)
    }
    const thisStatus = await dowloadAsset(inputs[i], folder, ddoDir)
    if (!thisStatus) status = 31
  }
  console.log("========== Done with inputs, moving to algo ============")
  if (status === 30) {
    // no need to download algo if input failed
    const algos = stages.reduce((acc, { algorithm }) => [...acc, algorithm], [])
    const algoPath = transformationsDir + '/'
    // write algo custom data if exists
    if('algocustomdata' in algos[0]){
      fs.writeFileSync(inputsDir + '/algoCustomData.json', JSON.stringify(algos[0].algocustomdata));
      console.log("AlgoCustomData saved to " + inputsDir + '/algoCustomData.json')
    }
    if (algos[0].rawcode != null) {
      if (algos[0].rawcode.length > 10) {
        fs.writeFileSync(algoPath + 'algorithm', algos[0].rawcode)
        console.log("Wrote algorithm code to " + algoPath + 'algorithm')
      } else {
        const thisStatus = await dowloadAsset(algos[0], algoPath, ddoDir, true)
        if (!thisStatus) status = 32
      }
    } else {
      const thisStatus = await dowloadAsset(algos[0], algoPath, ddoDir, true)
      if (!thisStatus) status = 32
    }
    // make the file executable
    try {
      fs.chmodSync(algoPath + 'algorithm', '777')
    } catch (e) {
      console.error(e)
    }
  }
  else {
    console.log("Input fetch failed, so we don't need to download the algo")
  }
  // update sql status
  console.log("============ Done , setting the status =============")
  try {
    var query = 'UPDATE jobs SET status=$1,statusText=$2 WHERE workflowId=$3'
    var sqlarr = []
    sqlarr[0] = status
    switch (status) {
      default:
        sqlarr[1] = 'Provisioning success'
        break
      case 31:
        sqlarr[1] = 'Data provisioning failed'
        break
      case 32:
        sqlarr[1] = 'Algorithm provisioning failed'
        break
    }
    sqlarr[2] = workflowid
    await pgpool.query(query, sqlarr)
    console.log('Updated ' + workflowid + ' with status ' + status)
  } catch (e) {
    console.error('Failed sql status update')
    console.error(e)
  }
}


/**
* Downloads url to target. Returns true is success, false otherwise
*/
async function downloadurl(url, target) {
  console.log('Downloading ' + url + ' to ' + target)
  try {
    await pipeline(got.stream(url, {
      timeout: {
        request: 10000
      }
    }), fs.createWriteStream(target))
    console.log("Downloaded OK")
    return true
  } catch (e) {
    console.log('Download error:')
    console.log(e)
    return false
  }
}

/**
* Downloads an asset (dataset or algo), based on object describing access (see workflows) to folder.
* Also, it tries to fetch the ddo and save it to ddoFolder.
* If useAlgorithmNameInsteadOfIndex, then first file is named 'algorithm' instead of '0'
* Returns true if all went all
*/
async function dowloadAsset(what, folder, ddoFolder, useAlgorithmNameInsteadOfIndex = false) {
  let ddo = null
  console.log("Downloading:")
  console.log(what)
  //first, fetch the ddo if we can
  try {
    ddo = await ocean.assets.resolve(what.id)
    fs.writeFileSync(ddoFolder + '/' + what.id.replace('did:op:', ''), JSON.stringify(ddo));
    console.log("DDO saved to " + ddoFolder + '/' + what.id)
  } catch (e) {
    console.error('Failed to fetch ddo')
    console.error(e)
  }
  //fetch the asset files
  let filePath
  if ('url' in what) {
    if (Array.isArray(what.url)) {
      for (var x = 0; x < what.url.length; x++) {
        if (x == 0 && useAlgorithmNameInsteadOfIndex) filePath = folder + 'algorithm'
        else filePath = folder + x
        const downloadresult = await downloadurl(what.url[x], filePath)
        if (downloadresult !== true) {
          // download failed, bail out
          return (false)
        }
      }
    }
    else {
      filePath = useAlgorithmNameInsteadOfIndex ? folder + 'algorithm' : folder + '0'
      const downloadresult = await downloadurl(what.url, filePath)
      if (downloadresult !== true) {
        // download failed, bail out
        return (false)
      }
    }
  }
  else if ('remote' in what) {
    //remote provider, we need to fetch it
    if (!process.env.PRIVATE_KEY) {
      console.error("Cannot connect to remote providers without a private key")
      return false
    }
    const txId = what.remote.txId
    const serviceIndex = what.remote.serviceIndex
    if (txId && ddo) {
      const { attributes } = ddo.findServiceByType('metadata')
      const service = ddo.findServiceById(serviceIndex)
      const { files } = attributes.main
      
      console.log("Setting provider to: " + service.serviceEndpoint)
      await ocean.provider.setBaseUrl(service.serviceEndpoint)
      let urlPath
      try{
        urlPath = ocean.provider.getDownloadEndpoint().urlPath
      }
      catch(e){
        console.error("Failed to get provider download endpoint")
        console.error(e)
        return false
      }
      for (let i = 0; i < files.length; i++) {
        await ocean.provider.getNonce(account)
        const hash = Web3.utils.utf8ToHex(what.id + ocean.provider.nonce)
        const sign = web3Accounts.sign(hash, process.env.PRIVATE_KEY)
        const checksumAddress = Web3.utils.toChecksumAddress(account)
        const signature = sign.signature
        let consumeUrl = urlPath
        consumeUrl += `?fileIndex=${files[i].index}`
        consumeUrl += `&documentId=${what.id}`
        consumeUrl += `&serviceId=${serviceIndex}`
        consumeUrl += `&serviceType=${service.type}`
        consumeUrl += `&dataToken=${ddo.dataToken}`
        consumeUrl += `&transferTxId=${txId}`
        consumeUrl += `&consumerAddress=${checksumAddress}`
        consumeUrl += `&signature=${signature}`
        if (what.remote.userdata)
          consumeUrl += '&userdata=' + encodeURI(JSON.stringify(what.remote.userdata))
        if (what.remote.algouserdata)
          consumeUrl += '&userdata=' + encodeURI(JSON.stringify(what.remote.algouserdata))
          
        if (i == 0 && useAlgorithmNameInsteadOfIndex) filePath = folder + 'algorithm'
        else filePath = folder + i
        console.log("Trying to download "+consumeUrl + "to " + filePath)
        const downloadresult = await downloadurl(consumeUrl, filePath)
        if (downloadresult !== true) {
          // download failed, bail out
          return (false)
        }
      }
    }
    else {
      console.log("Either txId is not set, or we could not fetch ddo")
    }
  }
  else {
    console.log("No url or remote key? Skipping this input ")
  }
  return (true)
}
