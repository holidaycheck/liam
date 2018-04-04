**liam** is a simple wrapper around tasks which you would like to run periodically or in response to specific events happening inside your project. What it can do? Examples how it can be used:

* Update JIRA issue label when corresponding PR will be closed/reopened/etc
* Fetch list of tasks which are currently in-progress on your Trello board and post that list to Slack channel
* Use Twilio Voice API to call someone who broke master build
* etc.

## How to start?

1. Create new repository, this will hold liam configuration specific for your project. Recommended approach is to have one liam instance per project.

2. Create `package.json` and add `liam` as dependency.

3. **Optional**: If you want to use some of the tasks defined in `liam-tasks`, add it to `package.json` too. Don't forget to install peer dependencies defined by `liam-tasks` being careful with installing correct versions.

4. Create file where you will configure `liam` for your specific needs, e.g. `index.js`. See example bellow with comments.

5. You need to deploy `liam` somewhere, this part is totally up to you. You can use `docker`, `supervisor`, `systemd` etc.

6. (Optional) If you want to use GitHub events, configure webhook and point it to newly deployed instance.

## Example code

```js
// Require `liam` module
const createLiamInstance = require('@holidaycheck/liam');

// Provide simple logger, this parameter is required
const logger = { log: console.log, error: console.error };

// `add-jira-link` task requires githubClient instance, e.g. for our github.example.com.
// More info: https://www.npmjs.com/package/github
const githubClient = require('github')({
    debug: false,
    protocol: 'https',
    host: 'github.example.com',
    pathPrefix: '/api/v3',
    timeout: 30000
})

// `add-jira-link` task requires authenticated githubClient instance.
// Suggested approach is to generate specific token and use it instead of credentials.
// Remember that user for which you're generating token needs to write access to repository for some tasks.
githubClient.authenticate({
    type: "token",
    token: '..', // you can hardcode token or pass it through ENV
});

// Create `liam` instance passing real webhook secret, as hook task is also used. If you want to use cron tasks only, just pass empty string as second parameter.
const liam = createLiamInstance(logger, process.env.WEBHOOK_SECRET);

// Enable `add-jira-link` task running in response to `pull_request` webhook event.
// Note: such configuration will work for any respository which will point it webhooks into this `liam` instance. You can use `repository` param, to whitelist repository, see examples below.
liam.addHook({
    events: [ 'pull_request' ],
    handler: require('@holidaycheck/liam-tasks/tasks/add-jira-link'),
    arguments: { githubClient }
});

// Run liam server on port 3000
liam.start(3000);
```

Required parameters:

* `logger` - object with methods `log` and `error`. You can use any logger you want, as long as it provides those two methods. This logger will be injected into each task and every message logged using that will be automatically prefixed with current timestamp and task name.
* `secret` - GitHub secret key which you specified while defining webhook. If you use liam for scheduled task only, pass empty string here, but parameter is required.

## Architecture

Everything that `liam` is able to do is considered a `task`. Each task assigned to `liam` **MUST** define at least 2 things: **when** it should be run and **what** should be run.

Each task **MUST** specify a `handler` which should be **named** function (use named function, as handlers `.name` property is used for logging).

It's **highly recommended** that each handler returns a `Promise`, that way not caught `Promise` rejections will be caught automatically by `liam` during execution.

Everything is all about tasks. Task is a **named** function which receives up to three parameters:

* `logger` - scoped logger created from `logger` passed to `createLiamInstance`. It will automatically add current time and task name to every logged message.
* `arguments` - (optional) list of everything which is needed for task to work. Great place for external API clients like `github` or `slack` or configuration parameters. Available only when you specify `arguments` while registering tasks.
* `payload` - (optional) in case of GitHub webhooks, this will contain webhook payload. In case when task is registered as cron, it will be empty.

Cron example:

```javascript
function doSomethingInScheduledWay(logger, args) {
	logger.log(`"foo" value is "${args.foo}"`);
}

liam.addCron({
    time: '* * * * * *',
    handler: doSomethingInScheduledWay
    arguments: { foo: 'bar' }
});
```

Hook example:

```javascript
function doSomethingInResponseToGitHubEvent(logger, _, payload) {
	logger.log("Received GitHub payload");
	logger.log(payload);
}

liam.addHook({    
    handler: doSomethingInResponseToGitHubEvent,
    events: [ 'pull_request' ], //optional - respond to those events only
    repository: 'john/foo' //optional - whitelist repository
});
```

## Healtcheck

Simple healthcheck endpoint is built-in and responds on `/_health` path.

## FAQ

### Why should I inject stuff like `githubClient` or `httpClient` instead of importing  those inside task?

Short answer: **testablity**.

Difference between:

```javascript
function doSomething() {
	const githubClient = require('github');

	return github.issues.search({...});
}
```

and

```javascript
const githubClient = require('github');

function doSomething(githubClient) {
	return github.issues.search({...});
}
```

is the fact, that you can test former one pretty easily, because `githubClient` dependency is injected. In case of first one you would probably end up using `proxyquire` or `nock`.

It's also optimal - you can reuse same GitHub/Slack client for multiple tasks.

### In case of cron task, which timezone is used?

By default, it's `UTC`. You can specify task for timezone using `timeZone` param, like below:

```javascript
liam.addCron({
	time: '00 10 12,13 * * *',
	timeZone: 'America/Chicago',
	handler: task
});
```
