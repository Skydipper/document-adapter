require('cluster');
// const cluster = require('cluster');
// const importerService = require('services/importerService');
// const logger = require('logger');
// let numWorkers = 2;
//
// console.log('Starting');
// if (cluster.isMaster) {
require('app');
//     for (let i = 0; i < numWorkers; i++) {
//         cluster.fork();
//     }
//     cluster.on('exit', function(worker, code, signal) {
//         console.log('worker ' + worker.process.pid + ' died');
//     });
// } else {
//     logger.info('Creating fork');
//     importerService.addProcess(cluster);
// }
