/* eslint-disable no-unused-vars,no-undef,no-await-in-loop */
const nock = require('nock');
const chai = require('chai');
const amqp = require('amqplib');
const config = require('config');
const { task } = require('rw-doc-importer-messages');
const sleep = require('sleep');
const RabbitMQConnectionError = require('errors/rabbitmq-connection.error');
const { getTestServer } = require('./test-server');
const { ROLES } = require('./test.constants');

const should = chai.should();

const requester = getTestServer();
let rabbitmqConnection = null;
let channel;

nock.disableNetConnect();
nock.enableNetConnect(`${process.env.HOST_IP}:${process.env.PORT}`);

describe('Dataset create tests', () => {

    before(async () => {
        if (process.env.NODE_ENV !== 'test') {
            throw Error(`Running the test suite with NODE_ENV ${process.env.NODE_ENV} may result in permanent data loss. Please use NODE_ENV=test.`);
        }

        let connectAttempts = 10;
        while (connectAttempts >= 0 && rabbitmqConnection === null) {
            try {
                rabbitmqConnection = await amqp.connect(config.get('rabbitmq.url'));
            } catch (err) {
                connectAttempts -= 1;
                await sleep.sleep(5);
            }
        }
        if (!rabbitmqConnection) {
            throw new RabbitMQConnectionError();
        }
    });

    beforeEach(async () => {
        channel = await rabbitmqConnection.createConfirmChannel();

        await channel.assertQueue(config.get('queues.tasks'));
        await channel.purgeQueue(config.get('queues.tasks'));

        const tasksQueueStatus = await channel.checkQueue(config.get('queues.tasks'));
        tasksQueueStatus.messageCount.should.equal(0);
    });

    /* Create a CSV Dataset */
    it('Create a CSV dataset should be successful (happy case)', async () => {
        const preQueueStatus = await channel.assertQueue(config.get('queues.tasks'));
        preQueueStatus.messageCount.should.equal(0);

        const timestamp = new Date().getTime();
        const connector = {
            id: timestamp,
            name: `Carto DB Dataset - ${timestamp}`,
            application: ['rw'],
            connectorType: 'rest',
            env: 'production',
            connectorUrl: 'https://wri-01.carto.com/tables/wdpa_protected_areas/table.csv',
            overwrite: true
        };
        const response = await requester
            .post(`/api/v1/document/csv`)
            .send({
                connector,
                loggedUser: ROLES.ADMIN
            });

        response.status.should.equal(200);

        sleep.sleep(2);

        const postQueueStatus = await channel.assertQueue(config.get('queues.tasks'));
        postQueueStatus.messageCount.should.equal(1);

        const validateMessage = async (msg) => {
            const content = JSON.parse(msg.content.toString());
            content.should.have.property('datasetId').and.equal(connector.id);
            content.should.have.property('fileUrl').and.equal(connector.connectorUrl);
            content.should.have.property('provider').and.equal('csv');
            content.should.have.property('type').and.equal(task.MESSAGE_TYPES.TASK_CREATE);

            await channel.ack(msg);
        };

        await channel.consume(config.get('queues.tasks'), validateMessage);

        process.on('unhandledRejection', (error) => {
            should.fail(error);
        });
    });

    /* Create a JSON Dataset */
    it('Create a JSON dataset should be successful (happy case)', async () => {
        const preQueueStatus = await channel.assertQueue(config.get('queues.tasks'));
        preQueueStatus.messageCount.should.equal(0);

        const timestamp = new Date().getTime();
        const connector = {
            id: timestamp,
            name: `Carto DB Dataset - ${timestamp}`,
            application: ['rw'],
            connectorType: 'rest',
            env: 'production',
            connectorUrl: 'https://wri-01.carto.com/tables/wdpa_protected_areas/table.json',
            overwrite: true
        };
        const response = await requester
            .post(`/api/v1/document/json`)
            .send({
                connector,
                loggedUser: ROLES.ADMIN
            });

        response.status.should.equal(200);

        sleep.sleep(2);

        const postQueueStatus = await channel.assertQueue(config.get('queues.tasks'));
        postQueueStatus.messageCount.should.equal(1);

        const validateMessage = async (msg) => {
            const content = JSON.parse(msg.content.toString());
            content.should.have.property('datasetId').and.equal(connector.id);
            content.should.have.property('fileUrl').and.equal(connector.connectorUrl);
            content.should.have.property('provider').and.equal('json');
            content.should.have.property('type').and.equal(task.MESSAGE_TYPES.TASK_CREATE);

            await channel.ack(msg);
        };

        await channel.consume(config.get('queues.tasks'), validateMessage);

        process.on('unhandledRejection', (error) => {
            should.fail(error);
        });
    });

    afterEach(async () => {
        await channel.assertQueue(config.get('queues.tasks'));
        await channel.purgeQueue(config.get('queues.tasks'));
        const tasksQueueStatus = await channel.checkQueue(config.get('queues.tasks'));
        tasksQueueStatus.messageCount.should.equal(0);

        if (!nock.isDone()) {
            const pendingMocks = nock.pendingMocks();
            nock.cleanAll();
            throw new Error(`Not all nock interceptors were used: ${pendingMocks}`);
        }

        await channel.close();
        channel = null;
    });

    after(async () => {
        rabbitmqConnection.close();
    });
});
