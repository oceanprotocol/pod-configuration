#!/usr/bin/env node
const program = require('commander')
const fs = require('fs')
const web3 = require('web3')
const Web3EthAccounts = require('web3-eth-accounts');
const pg = require('pg')
const got = require('got')
const stream = require('stream')
const { promisify } = require('util')
const fetch = require('cross-fetch')

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
  const aquariusURL = stages[0].output.metadataUri
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
    const thisStatus = await dowloadAsset(aquariusURL, inputs[i], folder, ddoDir)
    if (!thisStatus) status = 31
  }
  console.log("========== Done with inputs, moving to algo ============")
  if (status === 30) {
    // no need to download algo if input failed
    const algos = stages.reduce((acc, { algorithm }) => [...acc, algorithm], [])
    const algoPath = transformationsDir + '/'
    // write algo custom data if exists
    if ('algocustomdata' in algos[0]) {
      fs.writeFileSync(inputsDir + '/algoCustomData.json', JSON.stringify(algos[0].algocustomdata));
      console.log("AlgoCustomData saved to " + inputsDir + '/algoCustomData.json')
    }
    if (algos[0].rawcode != null) {
      if (algos[0].rawcode.length > 10) {
        fs.writeFileSync(algoPath + 'algorithm', algos[0].rawcode)
        console.log("Wrote algorithm code to " + algoPath + 'algorithm')
      } else {
        const thisStatus = await dowloadAsset(aquariusURL, algos[0], algoPath, ddoDir, true)
        if (!thisStatus) status = 32
      }
    } else {
      const thisStatus = await dowloadAsset(aquariusURL, algos[0], algoPath, ddoDir, true)
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
* Downloads an asset (dataset or algo), based on object describing access (see workflows) to folder.
* Also, it tries to fetch the ddo and save it to ddoFolder.
* If useAlgorithmNameInsteadOfIndex, then first file is named 'algorithm' instead of '0'
* Returns true if all went all
*/
async function dowloadAsset(aquariusURL, what, folder, ddoFolder, useAlgorithmNameInsteadOfIndex = false) {
  let ddo = null
  console.log("Downloading:")
  console.log(what)
  //first, fetch the ddo if we can
  try {
    ddo = await resolveAsset(aquariusURL, what.id)
    fs.writeFileSync(ddoFolder + '/' + what.id.replace('did:op:', ''), JSON.stringify(ddo));
    console.log("DDO saved to " + ddoFolder + '/' + what.id)
  } catch (e) {
    console.error('Failed to fetch ddo')
    console.error(e)
  }
  //fetch the asset files
  let filePath
  if ('url' in what) {
    // provider already has urls, this is going to be removed in the future
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
    const serviceId = what.remote.serviceId
    if (txId && ddo) {
      const service = ddo.services.find((s) => s.id === serviceId)
      if (!service) {
        console.error("Cannot find that serviceId in the DDO")
        return false
      }
      const providerURL = service['serviceEndpoint']
      const files = await getFilesInfo(providerURL, what.id, serviceId)
      console.log(files)
      for (let i = 0; i < files.length; i++) {
        let userdata = null
        if (what.remote.userdata)
          userdata = what.remote.userdata
        if (what.remote.algouserdata)
          userdata = what.remote.algouserdata
        const consumeUrl = await getProviderDownloadUrl(providerURL, what.id, account, serviceId, i, txId, userdata)
        if (i == 0 && useAlgorithmNameInsteadOfIndex) filePath = folder + 'algorithm'
        else filePath = folder + i
        console.log("Trying to download " + consumeUrl + "to " + filePath)
        const downloadresult = await downloadurl(consumeUrl, filePath)
        if (downloadresult !== true) {
          // download failed, bail out
          return (false)
        }
      }
    }
    else {
      console.log("Either txId is not set, or we could not fetch ddo")
      return (false)
    }
  }
  else {
    console.log("No url or remote key? Skipping this input ")
  }
  return (true)
}

// helpers functions below

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


async function resolveAsset(aquariusURL, did) {
  const path = aquariusURL + '/api/aquarius/assets/ddo/' + did
  try {
    const response = await fetch(path, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const raw = await response.json()
      return raw
    } else {
      console.error('HTTP request failed with status ' + response.status)
      throw new Error('HTTP request failed with status ' + response.status)
    }
  } catch (e) {
    console.error(e)
    throw new Error('HTTP request failed')

  }
}


//provider helpers
async function getEndpointURL(providerURL, serviceName) {
  const response = await fetch(providerURL, {
    method: 'GET',
    headers: {
      'Content-type': 'application/json'
    }
  })
  const providerData = await response.json()
  for (const i in providerData['serviceEndpoints']) {
    if (i === serviceName) {
      return (providerData['serviceEndpoints'][i])
    }
  }
  return null
}

async function getFilesInfo(providerUrl, did, serviceId) {
  const args = { did: did, serviceId: serviceId }
  const endpoint = await getEndpointURL(providerUrl, 'fileinfo')
  const url = providerUrl + "/" + endpoint[1]
  console.log(url)
  try {
    const response = await fetch(url, {
      method: endpoint[0],
      body: JSON.stringify(args),
      headers: {
        'Content-Type': 'application/json'
      }
    })
    return (await response.json())
  } catch (e) {
    return null
  }
}

async function getProviderDownloadUrl(providerURL, did, accountId, serviceId, fileIndex, transferTxId, userdata) {
  const endpoint = await getEndpointURL(providerURL, 'download')
  const nonce = Date.now()
  const hash = Web3.utils.utf8ToHex(did + nonce)
  const sign = web3Accounts.sign(hash, process.env.PRIVATE_KEY)
  const signature = sign.signature
  const checksumAddress = Web3.utils.toChecksumAddress(accountId)

  let consumeUrl = providerURL + endpoint[1]
  consumeUrl += `?fileIndex=${fileIndex}`
  consumeUrl += `&documentId=${did}`
  consumeUrl += `&transferTxId=${transferTxId}`
  consumeUrl += `&serviceId=${serviceId}`
  consumeUrl += `&consumerAddress=${checksumAddress}`
  consumeUrl += `&nonce=${nonce}`
  consumeUrl += `&signature=${signature}`
  if (userdata)
    consumeUrl += '&userdata=' + encodeURI(JSON.stringify(userdata))
  return consumeUrl
}