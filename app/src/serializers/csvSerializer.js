const Json2sql = require('sql2json').json2sql;
const GeoJSON = require('geojson');


class CSVSerializer {

    static serializeBucket(key, buckets) {
        let list = [];
        let alias = key;
        if (key.indexOf('geohash') >= 0) {
            alias = 'geohash';
        }
        alias = alias.replace('.keyword', '');
        for (let i = 0, { length } = buckets; i < length; i += 1) {
            const keys = Object.keys(buckets[i]).filter(el => el !== 'doc_count' && el !== 'key');
            if (keys.length === 1 && buckets[i][keys[0]].buckets && keys[0].indexOf('NESTED') === -1) {
                const partialList = CSVSerializer.serializeBucket(keys[0], buckets[i][keys[0]].buckets);
                for (let j = 0, { length } = partialList; j < length; j += 1) {
                    partialList[j][alias] = buckets[i].key;
                }
                list = list.concat(partialList);
            } else if (keys.length === 1 && keys[0].indexOf('NESTED') > -1) {
                const partialList = CSVSerializer.serializeBucket(keys[0].replace('@NESTED', ''), buckets[i][keys[0]][keys[0].replace('@NESTED', '')].buckets);
                for (let j = 0, { length } = partialList; j < length; j += 1) {
                    partialList[j][alias] = buckets[i].key;
                }
                list = list.concat(partialList);
            } else {
                const obj = {
                    [alias]: buckets[i].key
                };
                for (let j = 0, lengthSublist = keys.length; j < lengthSublist; j += 1) {
                    if (buckets[i][keys[j]].value) {
                        obj[keys[j]] = buckets[i][keys[j]].value;
                    }
                }
                list.push(obj);
            }
        }
        return list;
    }

    static formatAlias(el, parsedQuery) {
        if (!parsedQuery || !el) {
            return el;
        }

        const target = Object.assign({}, el);
        for (let i = 0, { length } = parsedQuery.select; i < length; i += 1) {
            const currentSelectElement = parsedQuery.select[i];

            if (currentSelectElement.alias) {

                if (currentSelectElement.type === 'literal') {
                    if (parsedQuery.select[i - 1] && parsedQuery.select[i - 1].type === 'dot' && parsedQuery.select[i - 2]) {
                        target[currentSelectElement.alias] = el[`${parsedQuery.select[i - 2].value}.${parsedQuery.select[i].value}`];
                        delete target[`${parsedQuery.select[i - 2].value}.${parsedQuery.select[i].value}`];
                    } else {
                        target[currentSelectElement.alias] = el[currentSelectElement.value];
                    }

                } else if (currentSelectElement.type === 'function') {
                    const name = Json2sql.parseFunction(currentSelectElement);
                    if (el[name]) {
                        target[currentSelectElement.alias] = el[name];
                    }
                }

            } else if (currentSelectElement.type === 'literal') {
                target[currentSelectElement.value] = el[currentSelectElement.value];
            } else if (currentSelectElement.type === 'function') {
                const name = Json2sql.parseFunction(currentSelectElement);
                if (el[name]) {
                    target[name] = el[name];
                }
            }
        }
        return target;
    }

    static serialize(data, parsed, id, format = 'json') {
        if (!data || data.length <= 0) {
            return {
                data: []
            };
        }

        if (data[0].aggregations) {

            const keys = Object.keys(data[0].aggregations);
            const attributes = {};
            if (!data[0].aggregations[keys[0]].buckets && keys[0].indexOf('NESTED') === -1) {
                for (let i = 0, { length } = keys; i < length; i += 1) {
                    attributes[keys[i]] = data[0].aggregations[keys[i]].value;
                }
                return {
                    data: [attributes]
                };
            }
            if (!data[0].aggregations[keys[0]].buckets && keys[0].indexOf('NESTED') > -1) {
                const nestedKeys = Object.keys(data[0].aggregations[keys[0]]);
                const nested = data[0].aggregations[keys[0]];
                for (let i = 0, { length } = nestedKeys; i < length; i += 1) {
                    if (nested[nestedKeys[i]].buckets) {
                        const values = CSVSerializer.serializeBucket(nestedKeys[i], nested[nestedKeys[i]].buckets);
                        const list = values.map(el => CSVSerializer.formatAlias(el, parsed));
                        return {
                            data: list
                        };
                    }
                }
            }
            const values = CSVSerializer.serializeBucket(keys[0], data[0].aggregations[keys[0]].buckets);
            const list = values.map(el => CSVSerializer.formatAlias(el, parsed));
            return {
                data: list
            };

        }

        if (data[0].hits && data[0].hits.hits && data[0].hits.hits.length > 0) {

            return {
                data: data[0].hits.hits.map((el) => {
                    const formatted = CSVSerializer.formatAlias(Object.assign(el._source, {
                        _id: el._id
                    }), parsed);
                    if (format === 'geojson') {
                        return GeoJSON.parse(formatted, { exclude: ['the_geom'], GeoJSON: 'the_geom' });
                    }
                    return formatted;
                })
            };
        }

    }

}

module.exports = CSVSerializer;
