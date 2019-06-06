const logger = require('logger');
const QueueService = require('services/queueService');
const { task } = require('rw-doc-importer-messages');
const config = require('config');

class TaskQueueService extends QueueService {

    constructor() {
        super(config.get('queues.tasks'));
    }

    async sendMessage(msg) {
        logger.info(`Sending message to ${this.q}`, msg);
        try {
            // Sending to queue
            (await this.channel).sendToQueue(this.q, Buffer.from(JSON.stringify(msg)));
        } catch (err) {
            logger.error(`Error sending message to ${this.q}: ${err}`);
        }
    }

    async import(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_CREATE, data);
        await this.sendMessage(taskMessage);
    }

    async overwrite(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_OVERWRITE, data);
        await this.sendMessage(taskMessage);
    }

    async concat(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_CONCAT, data);
        await this.sendMessage(taskMessage);
    }

    async append(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_APPEND, data);
        await this.sendMessage(taskMessage);
    }

    async delete(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_DELETE, data);
        await this.sendMessage(taskMessage);
    }

    async deleteIndex(data) {
        const taskMessage = task.createMessage(task.MESSAGE_TYPES.TASK_DELETE_INDEX, data);
        await this.sendMessage(taskMessage);
    }

}

module.exports = new TaskQueueService();
