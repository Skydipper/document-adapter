const logger = require('logger');
const json2csv = require('json2csv');
const csvSerializer = require('serializers/csvSerializer');
const IndexNotFound = require('errors/indexNotFound');

class Scroll {

    constructor(elasticClient, sql, parsed, index, datasetId, stream, download, cloneUrl, format) {
        this.elasticClient = elasticClient;
        this.sql = sql;
        this.parsed = parsed;
        this.index = index;
        this.datasetId = datasetId;
        this.stream = stream;
        this.download = download;
        this.cloneUrl = cloneUrl;
        this.format = format || 'json';
        this.timeout = false;
    }

    * init() {
        logger.debug('Scroll init');
        this.timeoutFunc = setTimeout(() => {
            this.timeout = true;
        }, 60000);

        let resultQueryElastic;
        try {
            logger.debug('Scroll init - Query explain: ', this.sql);
            resultQueryElastic = yield this.elasticClient.explain({
                sql: this.sql
            });
        } catch (e) {
            if (e.message.includes('index_out_of_bounds_exception')) {
                throw new Error('Semantically invalid query', e);
            }

            throw e;
        }

        if (this.parsed.group) {
            logger.debug('Config size of aggregations');
            const name = null;
            let aggregations = resultQueryElastic.aggregations;
            const finish = false;
            while (aggregations) {
                const keys = Object.keys(aggregations);
                if (keys.length === 1) {
                    if (aggregations[keys[0]] && aggregations[keys[0]].terms) {
                        aggregations[keys[0]].terms.size = this.parsed.limit || 999999;
                        aggregations = aggregations[keys[0]].aggregations;
                    } else if (keys[0].indexOf('NESTED') >= -1) {
                        aggregations = aggregations[keys[0]].aggregations;
                    } else {
                        aggregations = null;
                    }
                } else {
                    aggregations = null;
                }
            }
        }
        this.limit = -1;
        if (this.sql.toLowerCase().indexOf('limit') >= 0) {
            this.limit = resultQueryElastic.size;
        }

        if (resultQueryElastic.size > 10000 || this.limit === -1) {
            resultQueryElastic.size = 10000;
        }
        logger.debug('Creating params to scroll with query', resultQueryElastic);
        const params = {
            query: resultQueryElastic,
            duration: '1m',
            index: this.index
        };

        try {
            const size = resultQueryElastic.size;
            logger.debug('Creating scroll');
            this.resultScroll = yield this.elasticClient.createScroll(params);
            this.first = true;
            this.total = 0;

        } catch (err) {
            if (err.statusCode === 404) {
                throw new IndexNotFound(404, 'Table not found');
            }
            throw err;
        }
    }

    convertDataToDownload(data, type, first, more, cloneUrl) {
        if (type === 'csv') {
            return `${json2csv({
                data: data ? data.data : [],
                hasCSVColumnTitle: first
            })}\n`;
        } if (type === 'json' || type === 'geojson') {
            let dataString = '';
            if (data) {
                dataString = JSON.stringify(data);
                dataString = dataString.substring(9, dataString.length - 2); // remove {"data": [ and ]}
            }
            if (first) {
                if (type === 'geojson') {
                    dataString = `{"data":[{"type": "FeatureCollection", "features": [${dataString}`;
                } else {
                    dataString = `{"data":[${dataString}`;
                }
            }
            if (more) {
                dataString += ',';
            } else if (!this.download) {
                if (type === 'geojson') {
                    dataString += ']}';
                }
                dataString += '],';
                const meta = {
                    cloneUrl
                };

                dataString += `"meta": ${JSON.stringify(meta)} }`;
            } else {
                if (type === 'geojson') {
                    dataString += ']}';
                }
                dataString += ']}';
            }
            return dataString;
        }
    }

    * continue() {

        if (this.resultScroll[0].aggregations) {
            const data = csvSerializer.serialize(this.resultScroll, this.parsed, this.datasetId, this.format);
            this.stream.write(this.convertDataToDownload(data, this.format, true, false, this.cloneUrl), {
                encoding: 'binary'
            });
        } else {
            this.first = true;
            while (!this.timeout && this.resultScroll[0].hits && this.resultScroll[0].hits && this.resultScroll[0].hits.hits.length > 0 && (this.total < this.limit || this.limit === -1)) {
                logger.debug('Writting data');
                let more = false;
                const data = csvSerializer.serialize(this.resultScroll, this.parsed, this.datasetId, this.format);

                this.total += this.resultScroll[0].hits.hits.length;
                if (this.total < this.limit || this.limit === -1) {
                    this.resultScroll = yield this.elasticClient.getScroll({
                        scroll: '1m',
                        scroll_id: this.resultScroll[0]._scroll_id,
                    });
                    if (this.resultScroll[0].hits && this.resultScroll[0].hits && this.resultScroll[0].hits.hits.length > 0) {
                        more = true;
                    }
                } else {
                    more = false;
                }
                this.stream.write(this.convertDataToDownload(data, this.format, this.first, more, this.cloneUrl), {
                    encoding: 'binary'
                });
                this.first = false;

            }
            if (this.total === 0) {
                this.stream.write(this.convertDataToDownload(null, this.format, true, false, this.cloneUrl), {
                    encoding: 'binary'
                });
            }
        }
        this.stream.end();
        if (this.timeout) {
            throw new Error('Timeout exceed');
        }
        clearTimeout(this.timeoutFunc);

        logger.info('Write correctly');
    }

}


module.exports = Scroll;
