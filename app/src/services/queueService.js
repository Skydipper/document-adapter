/* eslint-disable import/no-extraneous-dependencies */
const logger = require('logger');
const config = require('config');
const amqp = require('amqplib');
const sleep = require('sleep');

class QueueService {

    constructor(q, consume = false) {
        this.channel = new Promise(() => {}); // Hack-ish way to ensure we can wait for a channel, and not crash if it's undefined

        this.q = q;
        logger.debug(`Connecting to queue ${this.q}`);
        try {
            this.init(consume).then(() => {
                logger.debug('Connected');
            }, (err) => {
                logger.error(err);
                process.exit(1);
            });
        } catch (err) {
            logger.error(err);
            process.exit(1);
        }
    }

    async init(consume) {
        let retryAttempts = 10;
        let conn;

        while (typeof conn === 'undefined' && retryAttempts > 0) {
            try {
                logger.debug(`Attempting RabbitMQ connection using URL ${config.get('rabbitmq.url')}`);
                const connAttempt = await amqp.connect(config.get('rabbitmq.url'));
                conn = connAttempt;
            } catch (err) {
                if (err.code === 'ECONNREFUSED') {
                    retryAttempts -= 1;
                    sleep.sleep(5);
                    logger.debug(`Failed RabbitMQ connection using URL ${config.get('rabbitmq.url')}`);
                } else {
                    throw err;
                }
            }
        }

        this.channel = await conn.createConfirmChannel();
        await this.channel.assertQueue(this.q, { durable: true });
        if (consume) {
            this.channel.prefetch(1);
            logger.debug(` [*] Waiting for messages in ${this.q}`);
            this.channel.consume(this.q, this.consume.bind(this), {
                noAck: false
            });
        }
    }

    returnMsg(msg) {
        logger.debug(`Sending message to ${this.q}`);
        try {
            // Sending to queue
            let count = msg.properties.headers['x-redelivered-count'] || 0;
            count += 1;
            this.channel.sendToQueue(this.q, msg.content, { headers: { 'x-redelivered-count': count } });
        } catch (err) {
            logger.error(`Error sending message to ${this.q}`);
            throw err;
        }
    }

    consume() {

    }

}

module.exports = QueueService;
