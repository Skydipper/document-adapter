const Router = require('koa-router');
const logger = require('logger');
const queryService = require('services/queryService');
const taskQueueService = require('services/taskQueueService');
const fieldSerializer = require('serializers/fieldSerializer');
const Json2sql = require('sql2json').json2sql;
const passThrough = require('stream').PassThrough;

const ctRegisterMicroservice = require('ct-register-microservice-node');

const router = new Router({
    prefix: '/document'
});

const JSONAPIDeserializer = require('jsonapi-serializer').Deserializer;

const deserializer = function (obj) {
    return function (callback) {
        new JSONAPIDeserializer({
            keyForAttribute: 'camelCase'
        }).deserialize(obj, callback);
    };
};

const serializeObjToQuery = function (obj) {
    return Object.keys(obj).reduce((a, k) => {
        a.push(`${k}=${encodeURIComponent(obj[k])}`);
        return a;
    }, []).join('&');
};


class QueryRouter {

    static* query() {
        logger.info('Do Query with dataset', this.request.body);
        logger.debug('Checking if is delete or select');

        try {
            if (this.state.parsed.delete) {
                logger.debug('Doing delete');
                this.state.parsed.from = this.request.body.dataset.tableName;
                const sql = Json2sql.toSQL(this.state.parsed);
                this.body = yield taskQueueService.delete({
                    datasetId: this.request.body.dataset.id,
                    query: sql,
                    index: this.request.body.dataset.tableName
                });
            } else if (this.state.parsed.select) {
                this.body = passThrough();
                const cloneUrl = QueryRouter.getCloneUrl(this.request.url, this.params.dataset);
                this.state.parsed.from = this.request.body.dataset.tableName;
                const sql = Json2sql.toSQL(this.state.parsed);
                logger.debug(this.request.body.dataset);
                logger.debug('ElasticSearch query', sql);
                yield queryService.doQuery(sql, this.state.parsed, this.request.body.dataset.tableName, this.request.body.dataset.id, this.body, cloneUrl, this.query.format);
            } else {
                this.throw(400, 'Query not valid');
            }
        } catch (err) {
            logger.error(err);
            throw err;
        }
    }

    static* queryV2() {
        logger.info('Doing query V2');
        logger.info('Do Query with dataset', this.request.body);
        logger.debug('Checking if is delete or select');

        try {
            if (this.state.parsed.delete) {
                logger.debug('Doing delete');
                this.state.parsed.from = this.request.body.dataset.tableName;
                const sql = Json2sql.toSQL(this.state.parsed);
                this.body = yield taskQueueService.delete({
                    datasetId: this.request.body.dataset.id,
                    query: sql,
                    index: this.request.body.dataset.tableName
                });
            } else if (this.state.parsed.select) {
                this.body = passThrough();
                const cloneUrl = QueryRouter.getCloneUrl(this.request.url, this.params.dataset);
                this.state.parsed.from = this.request.body.dataset.tableName;
                const sql = Json2sql.toSQL(this.state.parsed);
                logger.debug(this.request.body.dataset);
                yield queryService.doQueryV2(sql, this.state.parsed, this.request.body.dataset.tableName, this.request.body.dataset.id, this.body, cloneUrl, this.query.format);
            } else {
                this.throw(400, 'Query not valid');
            }
        } catch (err) {
            logger.error(err);
            throw err;
        }
    }

    static* download() {
        this.body = passThrough();
        const format = this.query.format ? this.query.format : 'csv';
        this.set('Content-disposition', `attachment; filename=${this.request.body.dataset.id}.${format}`);
        let mimetype;
        switch (format) {

        case 'csv':
            mimetype = 'text/csv';
            break;
        case 'json':
        case 'geojson':
            mimetype = 'application/json';
            break;
        default:
            logger.debug('default');

        }
        this.set('Content-type', mimetype);
        this.state.parsed.from = this.request.body.dataset.tableName;
        const sql = Json2sql.toSQL(this.state.parsed);
        yield queryService.downloadQuery(sql, this.state.parsed, this.request.body.dataset.tableName, this.request.body.dataset.id, this.body, format);


    }

    static* fields() {
        logger.info('Get fields of dataset', this.request.body);
        const fields = yield queryService.getMapping(this.request.body.dataset.tableName);
        this.body = fieldSerializer.serialize(fields, this.request.body.dataset.tableName, this.request.body.dataset.id);
    }

    static getCloneUrl(url, idDataset) {
        return {
            http_method: 'POST',
            url: `/${process.env.API_VERSION}/dataset/${idDataset}/clone`,
            body: {
                dataset: {
                    datasetUrl: `/${process.env.API_VERSION}${url.replace('/document', '')}`,
                    application: ['your', 'apps']
                }
            }
        };
    }

}

const deserializeDataset = function* (next) {
    logger.debug('Body', this.request.body);
    if (this.request.body.dataset && this.request.body.dataset.data) {
        this.request.body.dataset = yield deserializer(this.request.body.dataset);
    } else if (this.request.body.dataset && this.request.body.dataset.table_name) {
        this.request.body.dataset.tableName = this.request.body.dataset.table_name;
    }
    yield next;
};


const toSQLMiddleware = function* (next) {

    const options = {
        method: 'GET',
        json: true
    };
    if (!this.query.sql && !this.request.body.sql && !this.query.outFields && !this.query.outStatistics) {
        this.throw(400, 'sql or fs required');
        return;
    }

    if (this.query.sql || this.request.body.sql) {
        logger.debug('Checking sql correct');
        const params = Object.assign({}, this.query, this.request.body);
        options.uri = `/convert/sql2SQL?sql=${encodeURI(params.sql)}`;
        if (params.experimental) {
            options.uri += `&experimental=${params.experimental}`;
        }
        if (params.geostore) {
            options.uri += `&geostore=${params.geostore}`;
        }
        if (params.geojson) {
            options.body = {
                geojson: params.geojson
            };
            options.method = 'POST';
        }
    } else {
        logger.debug('Obtaining sql from featureService');
        const fs = Object.assign({}, this.request.body);
        delete fs.dataset;
        const query = serializeObjToQuery(this.request.query);
        const body = fs;
        const resultQuery = Object.assign({}, query);

        if (resultQuery) {
            options.uri = `/convert/fs2SQL${resultQuery}'&tableName=${this.request.body.dataset.tableName}`;
        } else {
            options.uri = `/convert/fs2SQL?tableName=${this.request.body.dataset.tableName}`;
        }
        options.body = body;
        options.method = 'POST';
    }

    logger.debug(options);
    try {
        const result = yield ctRegisterMicroservice.requestToMicroservice(options);
        this.query.sql = result.data.attributes.query;
        this.state.parsed = result.data.attributes.jsonSql;
        logger.debug(this.query.sql);
        yield next;

    } catch (e) {
        if (e.statusCode === 400 || e.statusCode === 404) {
            this.status = e.statusCode;
            this.body = e.body;
        }
        throw e;
    }
};


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
        } if (user.role === 'ADMIN' && containApps(dataset.application, user.extraUserData ? user.extraUserData.apps : null)) {
            return true;
        }

    }
    return false;
};

const checkPermissionDelete = function* (next) {
    if (this.state.parsed.delete) {
        if (!this.request.body || !this.request.body.loggedUser) {
            this.throw(403, 'Not authorized to execute DELETE query');
            return;
        }
        if (this.request.body && this.request.body.loggedUser) {

            if (checkUserHasPermission(this.request.body.loggedUser, this.request.body.dataset)) {
                yield next;
                return;
            }
            this.throw(403, 'Not authorized to execute DELETE query');
            return;
        }
    }
    yield next;
};

router.post('/query/:dataset', deserializeDataset, toSQLMiddleware, checkPermissionDelete, QueryRouter.query);
router.post('/query-v2/:dataset', deserializeDataset, toSQLMiddleware, checkPermissionDelete, QueryRouter.queryV2);
router.post('/download/:dataset', deserializeDataset, toSQLMiddleware, QueryRouter.download);
router.post('/fields/:dataset', deserializeDataset, QueryRouter.fields);

module.exports = router;
