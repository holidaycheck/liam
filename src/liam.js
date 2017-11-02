const http = require('http');

const CronJob = require('cron').CronJob;
const createGitHubWebhookHandler = require('github-webhook-handler');

function createScopedLogger(logger, taskName) {
    return {
        log: (message) => logger.log(`${new Date().toISOString()} [${taskName}] ${message}`),
        error: (message) => logger.error(`${new Date().toISOString()} [${taskName}] ${message}`)
    };
}

function ensureHandlerExists(taskConfig) {
    if (!taskConfig.handler || typeof taskConfig.handler !== 'function') {
        throw new Error('"handler" should be a function');
    }
}

function logUnhandledRejection(result, logger) {
    if (result && typeof result.catch === 'function') {
        result.catch(logger.error);
    }
}

module.exports = function createLiamInstance(logger, gitHubWebhookSecret) {
    if (!(logger && typeof logger.log === 'function' && typeof logger.error === 'function')) {
        throw new Error('Logger must have "log" and "error" methods');
    }

    const crons = [];
    const hooks = {};

    function executeHooks(eventData) {
        if (!(eventData.event in hooks)) {
            return;
        }

        let eventHooks = [];

        if (hooks[eventData.event][eventData.payload.repository.full_name]) {
            eventHooks = eventHooks.concat(hooks[eventData.event][eventData.payload.repository.full_name]);
        }

        if (hooks[eventData.event]['*']) {
            eventHooks = eventHooks.concat(hooks[eventData.event]['*']);
        }

        eventHooks.forEach((taskConfig) => {
            const scopedLogger = createScopedLogger(logger, taskConfig.handler.name);
            const callResult = taskConfig.handler(scopedLogger, taskConfig.arguments, eventData.payload);
            logUnhandledRejection(callResult, scopedLogger);
        });
    }

    function createServer(handler) {
        handler.on('error', () => {});
        handler.on('*', executeHooks);

        return http.createServer((req, res) => {
            if (req.url === '/_health') {
                res.statusCode = 200; // eslint-disable-line no-param-reassign
                res.end('OK');
            } else {
                handler(req, res, () => {
                    res.statusCode = 404; // eslint-disable-line no-param-reassign
                    res.end('No such endpoint');
                });
            }
        });
    }

    function addHook(taskConfig) {
        ensureHandlerExists(taskConfig);

        if (!taskConfig.events) {
            throw new Error('"events" property is required');
        }

        [].concat(taskConfig.events).forEach((event) => {
            if (!hooks[event]) {
                hooks[event] = {};
            }

            const repository = taskConfig.repository || '*';

            if (!hooks[event][repository]) {
                hooks[event][repository] = [];
            }

            hooks[event][repository].push({
                handler: taskConfig.handler,
                arguments: taskConfig.arguments,
                repository
            });
        });
    }

    function addCron(taskConfig) {
        ensureHandlerExists(taskConfig);

        const handler = () => {
            const scopedLogger = createScopedLogger(logger, taskConfig.handler.name);
            const callResult = taskConfig.handler(scopedLogger, taskConfig.arguments);
            logUnhandledRejection(callResult, scopedLogger);
        };

        crons.push(new CronJob({
            cronTime: taskConfig.time,
            onTick: handler,
            start: false,
            timeZone: taskConfig.timeZone
        }));
    }

    const server = createServer(
        createGitHubWebhookHandler({
            path: '/',
            secret: gitHubWebhookSecret
        })
    );

    return {
        addCron,
        addHook,
        start(port) {
            crons.forEach((cronTask) => cronTask.start());
            server.listen(port);
        },
        server
    };
};
