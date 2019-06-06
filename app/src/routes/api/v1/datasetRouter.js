const logger = require('logger');
const Router = require('koa-router');
const taskQueueService = require('services/taskQueueService');
const JSONAPIDeserializer = require('jsonapi-serializer').Deserializer;
const ctRegisterMicroservice = require('ct-register-microservice-node');

const deserializer = function (obj) {
    return function (callback) {
        new JSONAPIDeserializer({
            keyForAttribute: 'camelCase'
        }).deserialize(obj, callback);
    };
};

const router = new Router({
    prefix: '/document'
});

class DatasetRouter {

    static* import() {
        logger.info('Adding dataset with dataset id: ', this.request.body);
        yield taskQueueService.import({
            datasetId: this.request.body.connector.id,
            fileUrl: this.request.body.connector.connectorUrl,
            data: this.request.body.connector.data,
            dataPath: this.request.body.connector.dataPath,
            provider: this.params.provider || 'csv',
            legend: this.request.body.connector.legend,
            verified: this.request.body.connector.verified
        });
        this.body = '';
    }

    static* updateData() {
        // logger.info(`Update data with id ${this.params.id}  of dataset ${this.request.body.dataset.id}`);
        // this.assert(this.request.body.data, 400, 'Data is required');
        // if (this.request.body.dataset && this.request.body.dataset.status !== 'saved') {
        //     this.throw(400, 'Dataset is not in saved status');
        //     return;
        // }
        // const result = yield queryService.updateElement(this.request.body.dataset.tableName, this.params.id, this.request.body.data);
        // yield redisDeletePatternProm(this.request.body.dataset.id);
        // this.set('cache-control', 'flush');
        // this.body = null;
    }

    static* overwrite() {
        logger.info('Overwrite dataset with dataset id: ', this.params.dataset);
        this.assert(this.request.body.url || this.request.body.data, 400, 'Url or data is required');
        this.assert(this.request.body.provider, 400, 'Provider required');
        if (this.request.body.dataset && (this.request.body.dataset.status !== 'saved' && this.request.body.dataset.status !== 'failed')) {
            this.throw(400, 'Dataset is not in saved status');
            return;
        }
        yield taskQueueService.overwrite({
            datasetId: this.params.dataset,
            fileUrl: this.request.body.url,
            data: this.request.body.data,
            dataPath: this.request.body.dataPath,
            provider: this.request.body.provider || 'csv',
            legend: this.request.body.legend,
            index: this.request.body.dataset.tableName
        });
        this.set('cache-control', 'flush');
        this.body = '';
    }

    static* concat() {
        logger.info('Concat dataset with dataset id: ', this.params.dataset);
        this.assert(this.request.body.url || this.request.body.data, 400, 'Url or data is required');
        this.assert(this.request.body.provider, 400, 'Provider required');
        if (this.request.body.dataset && (this.request.body.dataset.status !== 'saved' && this.request.body.dataset.status !== 'failed')) {
            this.throw(400, 'Dataset is not in saved status');
            return;
        }
        yield taskQueueService.concat({
            datasetId: this.params.dataset,
            fileUrl: this.request.body.url,
            data: this.request.body.data,
            dataPath: this.request.body.dataPath,
            provider: this.request.body.provider || 'csv',
            legend: this.request.body.dataset.legend,
            index: this.request.body.dataset.tableName
        });
        this.set('cache-control', 'flush');
        this.body = '';
    }

    static* append() {
        logger.info('Concat dataset with dataset id: ', this.params.dataset);
        this.assert(this.request.body.url || this.request.body.data, 400, 'Url or data is required');
        this.assert(this.request.body.provider, 400, 'Provider required');
        if (this.request.body.dataset && (this.request.body.dataset.status !== 'saved' && this.request.body.dataset.status !== 'failed')) {
            this.throw(400, 'Dataset is not in saved status');
            return;
        }
        yield taskQueueService.append({
            datasetId: this.params.dataset,
            fileUrl: this.request.body.url,
            data: this.request.body.data,
            dataPath: this.request.body.dataPath,
            provider: this.request.body.provider || 'csv',
            legend: this.request.body.dataset.legend,
            index: this.request.body.dataset.tableName
        });
        this.set('cache-control', 'flush');
        this.body = '';
    }

    static* deleteIndex() {
        logger.info('Deleting index with dataset', this.request.body);
        const response = yield ctRegisterMicroservice.requestToMicroservice({
            method: 'GET',
            json: true,
            uri: `/dataset/${this.params.dataset}`
        });
        yield taskQueueService.deleteIndex({
            datasetId: this.params.dataset,
            index: response.data.attributes.tableName
        });
        this.set('cache-control', 'flush');
        this.body = '';
    }

}

const containApps = function (apps1, apps2) {
    if (!apps1 || !apps2) {
        return false;
    }
    for (let i = 0, { length } = apps1; i < length; i += 1) {
        for (let j = 0, length2 = apps2.length; j < length2; j += 1) {
            if (apps1[i] === apps2[j]) {
                return true;
            }
        }
    }
    return false;
};

const checkUserHasPermission = function (user, dataset) {
    if (user && dataset) {
        if (user.id === 'microservice') {
            return true;
        }
        // check if user is admin of any application of the dataset or manager and owner of the dataset
        if (user.role === 'MANAGER' && user.id === dataset.userId) {
            return true;
        }
        if (user.role === 'ADMIN' && containApps(dataset.application, user.extraUserData ? user.extraUserData.apps : null)) {
            return true;
        }

    }
    return false;
};

const checkPermissionModify = function* (next) {
    logger.debug('Checking if the user has permissions');
    const user = this.request.body.loggedUser;
    const { dataset } = this.request.body;
    if (!user) {
        logger.debug(`User data missing`);
        this.throw(401, 'User credentials invalid or missing');
    }
    if (!dataset) {
        this.throw(400, 'Dataset not found');
    }
    if (checkUserHasPermission(user, dataset)) {
        if (dataset.overwrite) {
            yield next;
            return;
        }
        this.throw(409, 'Dataset locked. Overwrite false.');
    } else {
        logger.debug(`User ${user.id} with role ${user.role} and app(s) '${(user.extraUserData ? user.extraUserData.apps : []).join(', ')}' does not have permissions to modify dataset ${dataset.id}`);
        this.throw(403, 'Not authorized');
    }
};

const deserializeDataset = function* (next) {
    logger.debug('Body', this.request.body);
    if (this.request.body.dataset && this.request.body.dataset.data) {
        this.request.body.dataset = yield deserializer(this.request.body.dataset);
    } else if (this.request.body.dataset && this.request.body.dataset.table_name) {
        this.request.body.dataset.tableName = this.request.body.dataset.table_name;
    }
    yield next;
};

router.post('/:provider', DatasetRouter.import);
router.post('/data/:dataset/:id', deserializeDataset, DatasetRouter.updateData);
router.post('/:dataset/data-overwrite', deserializeDataset, checkPermissionModify, DatasetRouter.overwrite);
router.post('/:dataset/concat', deserializeDataset, checkPermissionModify, DatasetRouter.concat);
router.post('/:dataset/append', deserializeDataset, checkPermissionModify, DatasetRouter.append);
router.delete('/:dataset', DatasetRouter.deleteIndex);
module.exports = router;
