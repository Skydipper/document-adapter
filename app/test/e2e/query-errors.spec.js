/* eslint-disable no-unused-vars,no-undef */
const nock = require('nock');
const config = require('config');
const chai = require('chai');
const { getTestServer } = require('./test-server');

const should = chai.should();

const requester = getTestServer();

nock.disableNetConnect();
nock.enableNetConnect(`${process.env.HOST_IP}:${process.env.PORT}`);

describe('Query datasets - Errors', () => {

    before(async () => {
        if (process.env.NODE_ENV !== 'test') {
            throw Error(`Running the test suite with NODE_ENV ${process.env.NODE_ENV} may result in permanent data loss. Please use NODE_ENV=test.`);
        }

        nock.cleanAll();
    });

    it('Invalid query to dataset should return meaningful error message and error code', async () => {
        const requestBody = {
            dataset: {
                name: 'Food Demand',
                slug: 'Food-Demand_3',
                type: null,
                subtitle: null,
                application: [
                    'rw'
                ],
                dataPath: 'data',
                attributesPath: null,
                connectorType: 'document',
                provider: 'json',
                userId: '1a10d7c6e0a37126611fd7a7',
                connectorUrl: 'http://gfw2-data.s3.amazonaws.com/alerts-tsv/output/to-api/output.json',
                tableName: 'index_051364f0fe4446c2bf95fa4b93e2dbd2_1536899613926',
                status: 'saved',
                published: true,
                overwrite: false,
                verified: false,
                blockchain: {},
                mainDateField: null,
                env: 'production',
                geoInfo: false,
                protected: false,
                legend: {
                    date: [],
                    region: [],
                    country: [],
                    nested: []
                },
                clonedHost: {},
                errorMessage: '',
                taskId: '/v1/doc-importer/task/986bd4ee-0bfe-4002-ae17-1d1594dffd0a',
                updatedAt: '2018-09-14T04:33:48.838Z',
                dataLastUpdated: null,
                widgetRelevantProps: [],
                layerRelevantProps: [],
                id: '051364f0-fe44-46c2-bf95-fa4b93e2dbd2'
            },
            loggedUser: null
        };

        const query = `potato ${requestBody.dataset.id}`;

        nock(`${process.env.CT_URL}`, { encodedQueryParams: true })
            .get('/v1/convert/sql2SQL')
            .query({ sql: 'potato%20051364f0-fe44-46c2-bf95-fa4b93e2dbd2' })
            .reply(400, { errors: [{ status: 400, detail: 'Malformed query' }] }, ['Vary',
                'Origin',
                'Content-Type',
                'application/vnd.api+json',
                'X-Response-Time',
                '13 ms',
                'Content-Length',
                '54',
                'Date',
                'Wed, 19 Sep 2018 07:34:38 GMT',
                'Connection',
                'close']);

        const queryResponse = await requester
            .post(`/api/v1/document/query/${requestBody.dataset.id}?sql=${query}`)
            .send(requestBody);

        queryResponse.status.should.equal(400);
        queryResponse.body.should.have.property('errors').and.be.an('array').and.have.lengthOf(1);
        queryResponse.body.errors[0].detail.should.include('Malformed query');
    });


    it('Query with invalid function call should return meaningful error message and error code', async () => {
        const requestBody = {
            dataset: {
                name: 'Food Demand',
                slug: 'Food-Demand_3',
                type: null,
                subtitle: null,
                application: [
                    'rw'
                ],
                dataPath: 'data',
                attributesPath: null,
                connectorType: 'document',
                provider: 'json',
                userId: '1a10d7c6e0a37126611fd7a7',
                connectorUrl: 'http://gfw2-data.s3.amazonaws.com/alerts-tsv/output/to-api/output.json',
                tableName: 'index_051364f0fe4446c2bf95fa4b93e2dbd2_1536899613926',
                status: 'saved',
                published: true,
                overwrite: false,
                verified: false,
                blockchain: {},
                mainDateField: null,
                env: 'production',
                geoInfo: false,
                protected: false,
                legend: {
                    date: [],
                    region: [],
                    country: [],
                    nested: []
                },
                clonedHost: {},
                errorMessage: '',
                taskId: '/v1/doc-importer/task/986bd4ee-0bfe-4002-ae17-1d1594dffd0a',
                updatedAt: '2018-09-14T04:33:48.838Z',
                dataLastUpdated: null,
                widgetRelevantProps: [],
                layerRelevantProps: [],
                id: '051364f0-fe44-46c2-bf95-fa4b93e2dbd2'
            },
            loggedUser: null
        };

        const query = `queryResponse.body.errors[0] ${requestBody.dataset.id}`;

        nock(`${process.env.CT_URL}`, { encodedQueryParams: true })
            .get('/v1/convert/sql2SQL')
            .query({ sql: 'queryResponse.body.errors%5B0%5D%20051364f0-fe44-46c2-bf95-fa4b93e2dbd2' })
            .reply(400, {
                errors: [
                    {
                        status: 400,
                        detail: 'Unsupported query element detected: queryResponse.body.errors[0]'
                    }
                ]
            });

        const queryResponse = await requester
            .post(`/api/v1/document/query/${requestBody.dataset.id}?sql=${query}`)
            .send(requestBody);

        queryResponse.status.should.equal(400);
        queryResponse.body.should.have.property('errors').and.be.an('array').and.have.lengthOf(1);
        queryResponse.body.errors[0].detail.should.include('Unsupported query element detected');
    });


    afterEach(() => {
        if (!nock.isDone()) {
            throw new Error(`Not all nock interceptors were used: ${nock.pendingMocks()}`);
        }
    });
});
