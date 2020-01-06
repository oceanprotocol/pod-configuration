#!/usr/bin/env node

const program = require('commander')
const { Ocean, Account } = require('@oceanprotocol/squid')
const Wallet = require('ethereumjs-wallet')
const fs = require('fs')

const got=require("got")
const stream = require('stream');
const {promisify} = require('util');

const pipeline = promisify(stream.pipeline);

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-n, --node <url>', 'Node URL')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-l, --path <path>', 'Volume path')
  .option('-v, --verbose', 'Enables verbose mode')
  .option('-b, --brizo <url>', 'Brizo URL')
  .option('-a, --address <address>', 'Brizo Address')
  .option('-q, --aquarius <url>', 'Aquarius URL')
  .option('-s, --secretstore <url>', 'SecretStore URL')
  .action(() => {
    let {workflow, node, credentials, password, path, verbose,brizo,address,aquarius,secretstore} = program
    const config = {workflow, node, credentials, password, path, verbose,brizo,address,aquarius,secretstore}

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
  brizo,
  address,
  aquarius,
  secretstore
}) {

  const inputsDir = `${path}/inputs`
  fs.mkdirSync(inputsDir)
  const transformationsDir = `${path}/transformations`
  fs.mkdirSync(transformationsDir)
  /* //Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = '0x' + credentialsWallet.getAddress().toString('hex')
  console.log("Addr:"+publicKey)
  const ocean = await Ocean.getInstance({
    nodeUri: nodeUri,
    parityUri: nodeUri,
    aquariusUri: aquarius,
    brizoUri: brizo,
    brizoAddress: address,
    secretStoreUri:secretstore,
    threshold: 0,
    verbose:true,
  })
 
  if (verbose) {
    console.log(await ocean.versions.get())
    console.log("Done ocean dump")
  }

  const consumer = new Account(publicKey, ocean.instanceConfig)
  consumer.setPassword(password)
  */
  // DIDs to be consumed
  const {stages} = JSON.parse(fs.readFileSync(workflowPath).toString())
    /*.service
    .find(({type}) => type === 'Metadata')
    .attributes
    .workflow
*/
    console.log("Stages:"+JSON.stringify(stages))
  
    
    const inputs = stages
    .reduce((acc, {input}) => [...acc, ...input], [])
    
    
console.log("Inputs:")
console.log(inputs)


    for (var i = 0; i < inputs.length; i++) {
        var ainput=inputs[i];
        var folder=inputsDir+"/"+ainput.id.replace("did:op:","")+"/";
        try{
          fs.mkdirSync(folder)
        }catch(e){ }
        for (x = 0; x < ainput.url.length; x++) {
                console.log("===");
                var aurl=ainput.url[x];
                var localfile=folder+x;
                await downloadurl(aurl, localfile)
        }
    }

    const algos = stages
    .reduce((acc, {algorithm}) => [...acc, algorithm], [])
    console.log("Algos:")
    console.log(algos)
    var folder=transformationsDir+"/";
    try{ fs.mkdirSync(folder)} catch(e){}
    var localfile=folder+"algorithm";
    await downloadurl(algos[0].url, localfile)
    //make the file executable
    try{fs.chmodSync(localfile, '777');}catch(e){}
    console.log("Alg:")
    console.log(fs.readFileSync(localfile).toString())

    
}




async function downloadurl(url, target) {
  /**
   * Download URL to target
   */
  console.log("Downloading "+url+" to "+target);
  try{
    
    await pipeline(got.stream(url),fs.createWriteStream(target))
    console.log("Done download???")
  }
  catch(e){
    console.log("Download error")
    console.log(e)
  }
  try{
    var stats=fs.statSync(target)
    console.log("Stats for "+target+":"+JSON.stringify(stats))
  }catch(e){
    console.log("Failed stats for "+target)
  }
}


