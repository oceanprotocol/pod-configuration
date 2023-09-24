[![banner](https://raw.githubusercontent.com/oceanprotocol/art/master/github/repo-banner%402x.png)](https://oceanprotocol.com)

<h1 align="center">Pod-Configuration</h1>

The Pod-Configuration repository operates in conjunction with the Operator Engine, and it initiates at the beginning of a job. It performs crucial functions that set up the environment for the job execution.

The Pod-Configuration is a node.js script that dynamically manages the environment set-up at the start of a job by the operator-engine. Its role involves fetching and preparing necessary assets and files to ensure a seamless job execution.

1. **Fetching Dataset Assets**: It fetches the files corresponding to datasets and saves them in the location `/data/inputs/DID/`. The files are named based on their array index ranging from 0 to X, depending on the total number of files associated with the dataset.

2. **Fetching Algorithm Files**: The script then retrieves the algorithm files and stores them in the `/data/transformations/` directory. The first file is named 'algorithm', and the subsequent files are indexed from 1 to X, based on the number of files present for the algorithm.

3. **Fetching DDOS**: Additionally, the Pod-Configuration fetches Decentralized Document Oriented Storage (DDOS) and saves them to the disk at the location `/data/ddos/`.

4. **Error Handling**: In case of any provisioning failures, whether during data fetching or algorithm processing, the script updates the job status in a PostgreSQL database, and logs the relevant error messages.

Once the Pod-Configuration successfully completes these tasks, it closes and signals the operator-engine to initiate the algorithm pod for the next steps. This repository provides the basis for smooth job processing by effectively managing assets and algorithm files, and handling potential provisioning errors.

## Main Functionalities

The functionalities of the script include:

1. **PostgreSQL Connection**: Interacts with a PostgreSQL database to fetch and update job statuses based on workflow execution.
2. **Command-line Interface**: Defines command-line options for the workflow configuration path, volume path, workflow ID, and verbose mode.
3. **Directory Management**: Manages local directories for inputs, transformations, logs, DDOs, and outputs related to the workflow.
4. **Web3 Interaction**: Connects with web3 and Ethereum accounts for blockchain-related functionalities. It uses Ethereum account if private key is provided.
5. **Asset Download**: Downloads and organizes assets based on the defined workflow. It fetches DDO (Decentralized Document Object) for each asset and saves them in a designated directory.
6. **Status Update**: Upon completion of asset downloads, the status of the job is updated in the database.

## How to Use

This application is run via command line. Here are the options that you can use:

```bash
-w, --workflow <path>      Workflow configuration path
-l, --path <path>          Volume path
--workflowid <workflowid>  Workflow ID
-v, --verbose              Enables verbose mode
```

Here's an example of how you can use the script:

```bash
node src/index.js -w /path/to/workflow.json -l /path/to/volume/ -v --workflowid 1234
```

After running the script, check the specified volume path. You'll find directories for inputs, transformations, logs, DDOs, and outputs.

## Environment Variables

You need to set the following environment variables:

- `POSTGRES_USER`: The user for the PostgreSQL database.
- `POSTGRES_DB`: The database name.
- `POSTGRES_PASSWORD`: The password for the PostgreSQL database.
- `POSTGRES_HOST`: The host for the PostgreSQL database.
- `POSTGRES_PORT`: The port for the PostgreSQL database.
- `PRIVATE_KEY`: The private key of your Ethereum account.

## Dependencies

The script uses the following Node.js libraries:

- `commander`: for handling command line interfaces.
- `fs`: for handling file system operations.
- `web3`: for interacting with Ethereum blockchain.
- `web3-eth-accounts`: for creating and managing Ethereum accounts.
- `pg`: for interacting with PostgreSQL databases.
- `got`: for HTTP requests.
- `stream`: for handling node.js streams.
- `util.promisify`: for promisifying node.js callback-style functions.
- `cross-fetch`: for making fetch requests.

## Installation

You can install the dependencies by running the following command:

```bash
npm install
```

## Note

Please make sure you have Node.js and NPM installed in your system before running the script. If not, you can download and install them from [here](https://nodejs.org/).
