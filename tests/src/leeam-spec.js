const crypto = require('crypto');

const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const request = require('supertest');
const expect = chai.expect;

chai.use(sinonChai);

const createLiamInstance = require('../../src/liam');

describe('liam', () => {
    function createInstance(secret = 'foobar') {
        const logger = {
            log: () => {},
            error: () => {}
        };

        return createLiamInstance(logger, secret);
    }

    it('should verify if passed logger has required methods', () => {
        const createEmptyLoggerFunc = createLiamInstance.bind(null, null, 'secret');
        const createLoggerWithLogOnlyFunc = createLiamInstance.bind({ log: () => {} }, null, 'secret');
        const createLoggerWithErrorOnlyFunc = createLiamInstance.bind({ error: () => {} }, null, 'secret');

        expect(createEmptyLoggerFunc).to.throw(Error, 'Logger must have "log" and "error" methods');
        expect(createLoggerWithLogOnlyFunc).to.throw(Error, 'Logger must have "log" and "error" methods');
        expect(createLoggerWithErrorOnlyFunc).to.throw(Error, 'Logger must have "log" and "error" methods');
    });

    it('should expose healthcheck endpoint', (done) => {
        const liam = createInstance();

        request(liam.server)
            .get('/_health')
            .expect(200, 'OK', done);
    });

    context('cron', () => {
        let clock;

        beforeEach(() => {
            clock = sinon.useFakeTimers(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)).getTime());
        });

        afterEach(() => {
            clock.restore();
        });

        it('should add task name and date before each logged message from that task using injected logger', () => {
            const loggerStub = { log: sinon.spy(), error: sinon.spy() };
            const liam = createLiamInstance(loggerStub, 'foobar');
            const dummyHandler = (logger) => {
                logger.log('OK');
                logger.error('FAIL');
            };

            liam.addCron({ time: '* * * * * *', handler: dummyHandler });
            liam.start(12345);
            clock.tick(1500);

            expect(loggerStub.log)
                .to.have.been.calledWithMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[dummyHandler] OK/);
            expect(loggerStub.error)
                .to.have.been.calledWithMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[dummyHandler] FAIL/);

            liam.server.close();
        });

        it('should pass specified arguments to correct task', () => {
            const liam = createInstance();
            const fooTaskSpy = sinon.spy();
            const fooTaskArguments = { foo: 1, bar: 2 };
            const barTaskSpy = sinon.spy();

            liam.addCron({ time: '* * * * * *', handler: fooTaskSpy, arguments: fooTaskArguments });
            liam.addCron({ time: '* * * * * *', handler: barTaskSpy });
            liam.start(12345);
            clock.tick(1500);

            expect(fooTaskSpy.firstCall.args[1]).to.be.deep.equal(fooTaskArguments);
            expect(barTaskSpy.firstCall.args[1]).to.be.undefined;

            liam.server.close();
        });

        it('should schedule tasks correctly', () => {
            const liam = createInstance();
            const taskSpy = sinon.spy();

            liam.addCron({ time: '* * * * * *', handler: taskSpy });
            liam.start(12345);
            clock.tick(4500);

            expect(taskSpy.callCount).to.be.equal(4);

            liam.server.close();
        });

        it('should schedule task correctly when using timezone', () => {
            const liam = createInstance();
            const taskSpy = sinon.spy();

            liam.addCron({ time: '00 10 12,13 * * *', timeZone: 'America/Chicago', handler: taskSpy });
            liam.start(12345);
            clock.tick(3 * 60 * 60 * 1000);

            expect(taskSpy).not.to.have.been.called;

            liam.server.close();
        });

        it('should throw an Error on invalid cron string', () => {
            const liam = createInstance();
            const addCronFunc = liam.addCron.bind(null, {
                time: 'foo bar baz',
                handler: () => {}
            });

            expect(addCronFunc)
                .to.throw(Error, 'Unknown alias: foo');
        });

        it('should throw an Error on invalid cron timezone', () => {
            const liam = createInstance();
            const addCronFunc = liam.addCron.bind(null, {
                time: '* * * * * *',
                handler: () => {},
                timeZone: 'Foo/Bar'
            });

            expect(addCronFunc).to.throw(Error, 'Invalid timezone.');
        });

        it('should throw an Error when handler is missing', () => {
            const liam = createInstance();
            const addCronFunc = liam.addCron.bind(null, {
                time: '* * * * * *'
            });

            expect(addCronFunc)
                .to.throw(Error, '"handler" should be a function');
        });

        it('should throw an Error when handler isn\'t a function', () => {
            const liam = createInstance();
            const addCronFunc = liam.addCron.bind(null, {
                time: '* * * * * *',
                handler: 'foobar'
            });

            expect(addCronFunc)
                .to.throw(Error, '"handler" should be a function');
        });
    });
    context('hook', () => { // eslint-disable-line max-statements
        function createGitHubHeaders(key, data, event) {
            return {
                'X-Hub-Signature': `sha1=${crypto.createHmac('sha1', key).update(data).digest('hex')}`,
                'X-Github-Event': event,
                'X-Github-Delivery': crypto.createHash('md5').update(data).digest('hex')
            };
        }

        function createGitHubPayloadForRepository(repository) {
            return {
                repository: {
                    full_name: repository
                }
            };
        }

        it('should fail on invalid path', (done) => {
            request(createInstance('foobar').server)
                .post('/notexisting')
                .expect('No such endpoint')
                .end(done);
        });

        it('should fail on invalid webhook secret', (done) => {
            const liam = createInstance('foo');
            const headers = createGitHubHeaders('bar', 'lorem ipsum', 'push');

            request(liam.server)
                .post('/')
                .set(headers)
                .expect(400, { error: 'X-Hub-Signature does not match blob signature' }, done);
        });

        it('should throw an Error when handler is missing', () => {
            const liam = createInstance('foobar');
            const addHookFunc = liam.addHook.bind(null, {});

            expect(addHookFunc)
                .to.throw(Error, '"handler" should be a function');
        });

        it('should throw an Error when events are missing', () => {
            const liam = createInstance('foobar');
            const addHookFunc = liam.addHook.bind(null, {
                handler: () => {}
            });

            expect(addHookFunc)
                .to.throw(Error, '"events" property is required');
        });

        it('should call specified handler', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));
            const headers = createGitHubHeaders(secret, payload, 'push');

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push', repository: 'bar/baz' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(payload)
                .expect(200, () => {
                    expect(taskSpy).to.have.been.called;

                    done();
                });
        });

        it('should not call a task when event doesnt match', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));
            const headers = createGitHubHeaders(secret, payload, 'pull_request');

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(payload)
                .expect(200, () => {
                    expect(taskSpy).not.to.have.been.called;

                    done();
                });
        });

        it('should add task name and date before each logged message from that task using injected logger', (done) => {
            const loggerStub = { log: sinon.spy(), error: sinon.spy() };
            const secret = 'foobar';
            const liam = createLiamInstance(loggerStub, secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));
            const headers = createGitHubHeaders(secret, payload, 'push');

            const dummyHandler = (logger) => {
                logger.log('OK');
                logger.error('FAIL');
            };

            liam.addHook({ handler: dummyHandler, events: 'push', repository: 'bar/baz' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(payload)
                .expect(200, () => {
                    expect(loggerStub.log).to.have.been
                        .calledWithMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[dummyHandler] OK/);
                    expect(loggerStub.error).to.have.been
                        .calledWithMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[dummyHandler] FAIL/);

                    done();
                });
        });

        it('should pass arguments to task', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));
            const headers = createGitHubHeaders(secret, payload, 'push');
            const arguments = { foo: 'bar' };

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push', repository: 'bar/baz', arguments });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(payload)
                .expect(200, () => {
                    expect(taskSpy.firstCall.args[1]).to.be.equal(arguments);

                    done();
                });
        });

        it('should log rejected promise value if task returns Promise', (done) => {
            const loggerStub = { log: () => {}, error: sinon.spy() };
            const secret = 'foobar';
            const liam = createLiamInstance(loggerStub, secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));
            const headers = createGitHubHeaders(secret, payload, 'push');

            const dummyHandler = () => {
                return Promise.reject('Error');
            };

            liam.addHook({ handler: dummyHandler, events: 'push', repository: 'bar/baz' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(payload)
                .expect(200, () => {
                    expect(loggerStub.error).to.have.been
                        .calledWithMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[dummyHandler] Error/);

                    done();
                });
        });

        it('should pass payload to task', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = createGitHubPayloadForRepository('bar/baz');
            const headers = createGitHubHeaders(secret, JSON.stringify(payload), 'push');

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push', repository: 'bar/baz' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(JSON.stringify(payload))
                .expect(200, () => {
                    expect(taskSpy.firstCall.args[2]).to.be.deep.equal(payload);

                    done();
                });
        });

        it('shouldn\'t call task when repository doesn\'t match', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = createGitHubPayloadForRepository('bar/baz');
            const headers = createGitHubHeaders(secret, JSON.stringify(payload), 'push');

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push', repository: 'foo/bar' });

            request(liam.server)
                .post('/')
                .set(headers)
                .send(JSON.stringify(payload))
                .expect(200, () => {
                    expect(taskSpy).not.to.have.been.called;

                    done();
                });
        });

        it('should call specified handler for event for all repositories if not specified', (done) => {
            const secret = 'foobar';
            const liam = createInstance(secret);
            const payload = JSON.stringify(createGitHubPayloadForRepository('bar/baz'));

            const taskSpy = sinon.spy();

            liam.addHook({ handler: taskSpy, events: 'push' });
            liam.addHook({ handler: taskSpy, events: 'pull_request' });

            request(liam.server)
                .post('/')
                .set(createGitHubHeaders(secret, payload, 'push'))
                .send(payload)
                .end(() => {
                    request(liam.server)
                        .post('/')
                        .set(createGitHubHeaders(secret, payload, 'pull_request'))
                        .send(payload)
                        .expect(200, () => {
                            expect(taskSpy).to.have.been.calledTwice;

                            done();
                        });
                });
        });
    });
});
