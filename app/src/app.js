const config = require('config');
const logger = require('logger');
const Koa = require('koa');
const compress = require('koa-compress');
const bodyParser = require('koa-bodyparser');
const koaLogger = require('koa-logger');
const loader = require('loader');
const validate = require('koa-validate');
const ErrorSerializer = require('serializers/errorSerializer');
const ctRegisterMicroservice = require('ct-register-microservice-node');

// const nock = require('nock');
// nock.recorder.rec();

const app = new Koa();

app.use(compress());
// if environment is dev then load koa-logger
if (process.env.NODE_ENV === 'dev') {
    app.use(koaLogger());
}

app.use(bodyParser({
    jsonLimit: '50mb'
}));

// catch errors and send in jsonapi standard. Always return vnd.api+json
app.use(function* (next) {
    try {
        yield next;
    } catch (err) {
        this.status = err.status || err.statusCode || 500;
        if (this.status >= 500) {
            logger.error(err);
        } else {
            logger.info(err);
        }

        this.body = ErrorSerializer.serializeError(this.status, err.message);
        if (process.env.NODE_ENV === 'prod' && this.status === 500) {
            this.body = 'Unexpected error';
        }
    }
    this.response.type = 'application/vnd.api+json';
});

// load custom validator
app.use(validate());

// load routes
loader.loadRoutes(app);
// Instance of http module
const server = require('http').Server(app.callback());

// get port of environment, if not exist obtain of the config.
// In production environment, the port must be declared in environment variable
const port = process.env.PORT || config.get('service.port');

server.listen(port, () => {
    ctRegisterMicroservice.register({
        info: require('../microservice/register.json'),
        swagger: require('../microservice/public-swagger.json'),
        mode: (process.env.CT_REGISTER_MODE && process.env.CT_REGISTER_MODE === 'auto') ? ctRegisterMicroservice.MODE_AUTOREGISTER : ctRegisterMicroservice.MODE_NORMAL,
        framework: ctRegisterMicroservice.KOA1,
        app,
        logger,
        name: config.get('service.name'),
        ctUrl: process.env.CT_URL,
        url: process.env.LOCAL_URL,
        token: process.env.CT_TOKEN,
        active: true,
    }).then(() => {
        // nock.recorder.rec();  // Use to record http calls for testing
    }, (err) => {
        logger.error(err);
        process.exit(1);
    });
});

logger.info(`Server started in port:${port}`);

module.exports = server;
