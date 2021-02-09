[![banner](https://raw.githubusercontent.com/oceanprotocol/art/master/github/repo-banner%402x.png)](https://oceanprotocol.com)

<h1 align="center">Pod-Configuration</h1>

Runned by operator-engine at the begining of a job.

> Fetches the assets files for datasets to /data/inputs/DID/[0-X] (depends how many files are, naming is the array index)

> Fetches the algorithm files to /data/transformations/[algorithm, 1-X] (first file is named 'algorithm', after that it starts from 1 to X, depends how many files are)

> Fetches the DDOS and save them to disk to /data/ddos/

Once all this is done, this pod will close and op-engine will start the algo pod.

