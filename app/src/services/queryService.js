const logger = require('logger');
const config = require('config');
const elasticsearch = require('elasticsearch');
const Scroll = require('services/scroll');
const co = require('co');
const Json2sql = require('sql2json').json2sql;
const Terraformer = require('terraformer-wkt-parser');
const DocumentNotFound = require('errors/documentNotFound');
const ctRegisterMicroservice = require('ct-register-microservice-node');

const elasticUri = process.env.ELASTIC_URI || `${config.get('elasticsearch.host')}:${config.get('elasticsearch.port')}`;


class QueryService {

    constructor() {
        logger.info('Connecting with elasticsearch');

        const sqlAPI = {
            sql(opts) {
                return function (cb) {
                    this.transport.requestTimeout = 60000;
                    this.transport.request({
                        method: 'POST',
                        path: encodeURI('/_sql'),
                        body: opts.sql
                    }, cb);
                }.bind(this);
            },
            explain(opts) {
                return function (cb) {
                    const call = function (err, data) {
                        if (data) {
                            try {
                                data = JSON.parse(data);
                            } catch (e) {
                                data = null;
                            }
                        }
                        cb(err, data);
                    };
                    this.transport.request({
                        method: 'POST',
                        path: encodeURI('/_sql/_explain'),
                        body: opts.sql
                    }, call);
                }.bind(this);
            },
            mapping(opts) {
                return function (cb) {
                    this.transport.request({
                        method: 'GET',
                        path: `/${opts.index}/_mapping`
                    }, cb);
                }.bind(this);
            },
            delete(opts) {
                return function (cb) {
                    this.transport.request({
                        method: 'DELETE',
                        path: `/${opts.index}`
                    }, cb);
                }.bind(this);
            },
            createScroll(opts) {
                this.transport.requestTimeout = 60000;
                return function (cb) {
                    this.transport.request({
                        method: 'POST',
                        path: encodeURI(`/${opts.index}/_search?scroll=${opts.duration}`),
                        body: JSON.stringify(opts.query),
                        requestTimeout: 60000
                    }, cb);
                }.bind(this);
            },
            getScroll(opts) {
                logger.debug('GETSCROLL ', opts);
                this.transport.requestTimeout = 60000;
                return function (cb) {
                    this.transport.request({
                        method: 'GET',
                        path: encodeURI(`/_search/scroll?scroll=${opts.scroll}&scroll_id=${opts.scroll_id}`),
                        requestTimeout: 60000
                    }, cb);
                }.bind(this);
            },
            deleteByQuery(opts) {
                logger.debug('Delete by query ', opts);
                return function (cb) {
                    this.transport.request({
                        method: 'POST',
                        path: encodeURI(`/${opts.index}/_delete_by_query?slices=5&wait_for_completion=${opts.waitForCompletion ? 'true' : 'false'}`),
                        body: JSON.stringify(opts.body)
                    }, cb);
                }.bind(this);
            },
            update(opts) {
                logger.debug('Update element ', opts);
                return function (cb) {
                    this.transport.request({
                        method: 'POST',
                        path: encodeURI(`/${opts.index}/${opts.type}/${opts.id}/_update`),
                        body: JSON.stringify(opts.body)
                    }, cb);
                }.bind(this);
            },
            ping(opts) {
                // logger.debug('ping ');
                return function (cb) {
                    this.transport.request({
                        method: 'GET',
                        path: ''
                    }, cb);
                }.bind(this);
            },
            getTask(opts) {
                logger.debug('get task ', opts);
                return function (cb) {
                    this.transport.request({
                        method: 'GET',
                        path: encodeURI(`/_tasks/${opts.task}`)
                    }, cb);
                }.bind(this);
            },
            putSettings(opts) {
                logger.debug('put settings ', opts);
                return function (cb) {
                    this.transport.request({
                        method: 'PUT',
                        path: encodeURI(`/${opts.index}/_settings`),
                        body: JSON.stringify(opts.body)
                    }, cb);
                }.bind(this);
            }
        };
        elasticsearch.Client.apis.sql = sqlAPI;

        this.elasticClient = new elasticsearch.Client({
            host: elasticUri,
            log: 'info',
            apiVersion: 'sql'
        });
        this.elasticClientV2 = new elasticsearch.Client({
            host: 'elasticsearch-v2.default.svc.cluster.local:9200',
            log: 'info',
            apiVersion: 'sql'
        });
        setInterval(() => {
            this.elasticClient.ping({
                // ping usually has a 3000ms timeout
                requestTimeout: 10000
            }, (error) => {
                if (error) {
                    logger.error('elasticsearch cluster is down!');
                    process.exit(1);
                }
            });
        }, 3000);

    }

    * updateElement(index, id, data) {
        logger.info(`Updating index ${index} and id ${id} with data`, data);
        try {
            const result = yield this.elasticClient.update({
                index,
                type: index,
                id,
                body: {
                    doc: data
                }
            });
            return result;
        } catch (err) {
            if (err && err.status === 404) {
                throw new DocumentNotFound(404, `Document with id ${id} not found`);
            }
            throw err;
        }
    }


    findIntersect(node, finded, result) {
        if (node && node.type === 'string' && node.value && finded) {
            try {
                logger.debug(node.value);
                if (node.value.startsWith('\'')) {
                    node.value = node.value.slice(1, node.value.length - 1);
                }

                const geojson = JSON.parse(node.value);

                const newResult = Object.assign({}, result || {}, {
                    geojson
                });

                return newResult;
            } catch (e) {
                logger.error(e);
                return result;
            }
        }
        if (node && node.type === 'number' && node.value && finded) {
            const newResult = Object.assign({}, result || {}, {
                wkid: node.value
            });
            return newResult;
        }
        if (node && node.type === 'function' && (node.value.toLowerCase() === 'st_intersects' || finded)) {
            for (let i = 0, { length } = node.arguments; i < length; i += 1) {
                const newResult = this.findIntersect(node.arguments[i], true, result);
                result = Object.assign(result || {}, newResult);
                return result;
            }
        }
        if (node && node.type === 'conditional') {
            const left = this.findIntersect(node.left);
            const right = this.findIntersect(node.right);
            if (left) {
                return left;
            }
            if (right) {
                return right;
            }
        }
        return null;
    }

    replaceIntersect(node, wkt) {
        if (node && node.type === 'function' && node.value.toLowerCase() === 'st_intersects') {
            return {
                type: 'function',
                value: 'GEO_INTERSECTS',
                arguments: [{
                    type: 'literal',
                    value: 'the_geom'
                }, {
                    type: 'string',
                    value: `${wkt}`
                }]
            };
        }
        if (node && node.type === 'conditional') {
            const left = this.replaceIntersect(node.left, wkt);
            const right = this.replaceIntersect(node.right, wkt);
            node.left = left;
            node.right = right;
        }
        return node;
    }

    * convertQueryToElastic(parsed, index) {
        // search ST_GeoHash
        if (parsed.group || parsed.orderBy) {
            let mapping = yield this.getMapping(index);
            mapping = mapping[0][index].mappings.type ? mapping[0][index].mappings.type.properties : mapping[0][index].mappings[index].properties;
            if (parsed.group) {

                for (let i = 0, { length } = parsed.group; i < length; i += 1) {
                    const node = parsed.group[i];
                    if (node.type === 'function' && node.value.toLowerCase() === 'st_geohash') {
                        const args = [];
                        args.push({
                            type: 'literal',
                            value: 'field=\'the_geom_point\'',
                        }, {
                            type: 'literal',
                            value: `precision=${node.arguments[1].value}`,
                        });
                        node.arguments = args;
                        node.value = 'geohash_grid';
                    } else if (node.type === 'literal') {
                        logger.debug('Checking if it is text');
                        logger.debug(mapping[node.value]);
                        const exists = parsed.select.find(sel => sel.alias === node.value);
                        if (exists) {
                            node.value = exists.value;
                        }
                        if (mapping[node.value] && mapping[node.value].type === 'text') {
                            node.value = `${node.value}.keyword`;
                        }

                    }
                }
            }
            if (parsed.orderBy) {
                for (let i = 0, { length } = parsed.orderBy; i < length; i += 1) {
                    const node = parsed.orderBy[i];
                    if (node.type === 'literal') {
                        logger.debug('Checking if it is text');
                        logger.debug(mapping[node.value]);
                        if (mapping[node.value] && mapping[node.value].type === 'text') {
                            node.value = `${node.value}.keyword`;
                        }
                    }
                }
            }
            if (parsed.select) {
                for (let i = 0, { length } = parsed.select; i < length; i += 1) {
                    const node = parsed.select[i];
                    if (node.type === 'function') {
                        for (let j = 0; j < node.arguments.length; j += 1) {
                            if (node.arguments[j].type === 'literal' && mapping[node.arguments[j].value] && mapping[node.arguments[j].value].type === 'text') {
                                node.arguments[j].value = `${node.arguments[j].value}.keyword`;
                            }
                        }
                    }
                }
            }

            if (!parsed.limit) {
                parsed.limit = 9999999; // in group by is need it because elastic has a 10000 limit by default
            }
        }
        if (parsed.select) {
            const mapping = yield this.getMapping(index);
            for (let i = 0, { length } = parsed.select; i < length; i += 1) {
                const node = parsed.select[i];
                if (node.type === 'function') {
                    if (node.value.toLowerCase() === 'st_geohash') {
                        const args = [];
                        args.push({
                            type: 'literal',
                            value: 'field=\'the_geom_point\'',
                        }, {
                            type: 'literal',
                            value: `precision=${node.arguments[1].value}`,
                        });
                        node.arguments = args;
                        node.value = 'geohash_grid';
                    }
                    for (let j = 0; j < node.arguments.length; j += 1) {
                        if (node.arguments[j].type === 'literal' && mapping[node.arguments[j].value] && mapping[node.arguments[j].value].type === 'text') {
                            node.arguments[j].value = `${node.arguments[j].value}.keyword`;
                        }
                    }
                }
            }
        }
        logger.debug('convertQueryToElastic - Parsed', parsed);
        const geo = this.findIntersect(parsed.where);
        logger.debug('convertQueryToElastic - Intersection found:', geo);
        if (geo) {
            const wkt = Terraformer.convert(geo.geojson);
            parsed.where = this.replaceIntersect(parsed.where, wkt);
        }
        return parsed;
    }

    * doQuery(sql, parsed, index, datasetId, body, cloneUrl, format) {
        logger.info('Doing query...');
        const elasticQuery = yield this.convertQueryToElastic(parsed, index);
        const removeAlias = Object.assign({}, elasticQuery);
        if (removeAlias.select) {
            removeAlias.select = removeAlias.select.map((el) => {
                if (el.type === 'function') {
                    return el;
                }
                return {
                    value: el.value,
                    type: el.type,
                    alias: null,
                    arguments: el.arguments
                };
            });
        }
        const sqlFromJson = Json2sql.toSQL(removeAlias);
        logger.debug('doQuery - Generated sql', sqlFromJson);

        const scroll = new Scroll(this.elasticClient, sqlFromJson, elasticQuery, index, datasetId, body, false, cloneUrl, format);
        yield scroll.init();
        yield scroll.continue();
        logger.info('Finished query');
    }

    * doQueryV2(sql, parsed, index, datasetId, body, cloneUrl, format) {
        logger.info('Doing query...');
        const elasticQuery = yield this.convertQueryToElastic(parsed, index);
        const removeAlias = Object.assign({}, elasticQuery);
        if (removeAlias.select) {
            removeAlias.select = removeAlias.select.map((el) => {
                if (el.type === 'function') {
                    return el;
                }
                return {
                    value: el.value,
                    type: el.type,
                    alias: null,
                    arguments: el.arguments
                };
            });
        }
        const sqlFromJson = Json2sql.toSQL(removeAlias);
        logger.debug('doQueryV2 - sql', sql);

        const scroll = new Scroll(this.elasticClientV2, sqlFromJson, elasticQuery, index, datasetId, body, false, cloneUrl, format);
        yield scroll.init();
        yield scroll.continue();
        logger.info('Finished query');
    }

    * activateRefreshIndex(index) {
        const options = {
            index,
            body: {
                index: {
                    refresh_interval: '1s',
                    number_of_replicas: 1
                }
            }
        };
        yield this.elasticClient.putSettings(options);
    }

    * desactivateRefreshIndex(index) {
        const options = {
            index,
            body: {
                index: {
                    refresh_interval: '-1',
                    number_of_replicas: 0
                }
            }
        };
        yield this.elasticClient.putSettings(options);

    }

    * updateState(id, status, errorMessage) {
        logger.info('Updating state of dataset ', id, ' with status ', status);

        const options = {
            uri: `/dataset/${id}`,
            body: {
                status
            },
            method: 'PATCH',
            json: true
        };

        if (errorMessage) {
            options.body.errorMessage = errorMessage;
        }
        // logger.info('Updating', options);
        try {
            const result = yield ctRegisterMicroservice.requestToMicroservice(options);
        } catch (e) {
            logger.error(e);
            throw new Error('Error to updating dataset');
        }
    }

    * doDeleteQuery(id, sql, parsed, tableName) {
        try {
            logger.info(`Doing delete to ${sql}`);
            logger.debug('Obtaining explain with select ', `${sql}`);
            yield this.updateState(id, 0, null);
            yield this.desactivateRefreshIndex(tableName);
            const elasticQuery = yield this.convertQueryToElastic(parsed, tableName);
            elasticQuery.select = [{
                value: '*',
                alias: null,
                type: 'wildcard'
            }];
            delete elasticQuery.delete;
            // logger.debug('sql', sql);
            const sqlFromJson = Json2sql.toSQL(elasticQuery);
            try {
                const resultQueryElastic = yield this.elasticClient.explain({
                    sql
                });
                delete resultQueryElastic.from;
                delete resultQueryElastic.size;
                logger.debug('Doing query');
                const result = yield this.elasticClient.deleteByQuery({
                    index: tableName,
                    timeout: 120000,
                    requestTimeout: 120000,
                    body: resultQueryElastic,

                    waitForCompletion: false
                });
                logger.debug(result);
                const interval = setInterval(() => {
                    co(function* () {
                        try {
                            logger.info('Checking task');
                            const data = yield this.elasticClient.getTask({ task: result[0].task });
                            // logger.debug('data', data);
                            if (data && data.length > 0 && data[0].completed) {
                                logger.info(`Dataset ${id} is completed`);
                                clearInterval(interval);
                                yield this.updateState(id, 1, null);
                                yield this.activateRefreshIndex(tableName);
                            }
                        } catch (err) {
                            clearInterval(interval);
                            yield this.updateState(id, 2, null);
                            yield this.activateRefreshIndex(tableName);
                        }
                    }.bind(this)).then(() => {

                    }, (err) => {
                        logger.error('Error checking task', err);

                    });

                }, 2000);
                return '';
            } catch (e) {
                logger.error(e);
                throw new Error('Query not valid');
            }
        } catch (err) {
            logger.error('Error removing query', err);
            yield this.updateState(id, 2, 'Error deleting items');
        }

    }

    * downloadQuery(sql, parsed, index, datasetId, body, type = 'json') {
        logger.info('Download with query...');
        const elasticQuery = yield this.convertQueryToElastic(parsed, index);
        logger.debug('Download query sql: ', sql);
        const sqlFromJson = Json2sql.toSQL(elasticQuery);
        const scroll = new Scroll(this.elasticClient, sqlFromJson, elasticQuery, index, datasetId, body, true, null, type);
        yield scroll.init();
        yield scroll.continue();
        logger.info('Finished query');
    }

    * getMapping(index) {
        logger.info('Obtaining mapping...');

        return yield this.elasticClient.mapping({
            index
        });
    }

    * deleteIndex(index) {
        logger.info('Deleting index %s...', index);

        return yield this.elasticClient.delete({
            index
        });
    }

}

module.exports = new QueryService();
