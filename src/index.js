#!/usr/bin/env node

const program = require('commander')
// const { Ocean, Account } = require('@oceanprotocol/squid')
// const Wallet = require('ethereumjs-wallet')
const fs = require('fs')
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
  //fs.mkdirSync(inputsDir)   - /data/inputs is already mounted, no need to create it
  const transformationsDir = `${path}/transformations`
  fs.mkdirSync(transformationsDir)

  const { stages } = JSON.parse(fs.readFileSync(workflowPath).toString())
  /* .service
    .find(({type}) => type === 'Metadata')
    .attributes
    .workflow
*/
  const inputs = stages.reduce((acc, { input }) => [...acc, ...input], [])
  for (var i = 0; i < inputs.length; i++) {
    var ainput = inputs[i]
    var folder = inputsDir + '/' + ainput.id.replace('did:op:', '') + '/'
    try {
      fs.mkdirSync(folder)
    } catch (e) {
      console.error(e)
    }
    for (var x = 0; x < ainput.url.length; x++) {
      console.log('===')
      var aurl = ainput.url[x]
      var localfile = folder + x
      const downloadresult = await downloadurl(aurl, localfile)
      if (downloadresult !== true) {
        // download failed, bail out
        status = 31
      }
    }
  }

  if (status === 30) {
    // no need to download algo if input failed
    const algos = stages.reduce((acc, { algorithm }) => [...acc, algorithm], [])
    folder = transformationsDir + '/'
    localfile = folder + 'algorithm'
    if (algos[0].rawcode != null) {
      if (algos[0].rawcode.length > 10) {
        fs.writeFileSync(localfile, algos[0].rawcode)
      } else {
        const downloadresult = await downloadurl(algos[0].url, localfile)
        if (downloadresult !== true) {
          // download failed, bail out
          status = 32
        }
      }
    } else {
      const downloadresult = await downloadurl(algos[0].url, localfile)
      if (downloadresult !== true) {
        // download failed, bail out
        status = 32
      }
    }
    // make the file executable
    try {
      fs.chmodSync(localfile, '777')
    } catch (e) {
      console.error(e)
    }
  }
  // update sql status
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

async function downloadurl(url, target) {
  /**
   * Download URL to target
   */
  let retval = true
  console.log('Downloading ' + url + ' to ' + target)
  try {
    await pipeline(got.stream(url), fs.createWriteStream(target))
    console.log('Done download???')
  } catch (e) {
    console.log('Download error')
    console.log(e)
    retval = false
  }
  try {
    var stats = fs.statSync(target)
    console.log('Stats for ' + target + ':' + JSON.stringify(stats))
  } catch (e) {
    console.log('Failed stats for ' + target)
  }
  return retval
}
