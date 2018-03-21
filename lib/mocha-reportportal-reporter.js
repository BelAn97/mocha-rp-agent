const SpecificUtils = require('./specificUtils');
const RPClient = require('reportportal-client');
const mocha = require('mocha');
const deasync = require('deasync');

let Base = mocha.reporters.Base;

function MochaRPReporter(runner, options) {

    let STATUS = {
        PASSED: 'PASSED',
        FAILED: 'FAILED',
        STOPPED: 'STOPPED',
        SKIPPED: 'SKIPPED',
        RESETED: 'RESETED',
        CANCELLED: 'CANCELLED'
    };

    let LEVEL = {
        ERROR: 'ERROR',
        TRACE: 'TRACE',
        DEBUG: 'DEBUG',
        INFO: 'INFO',
        WARN: 'WARN',
        EMPTY: ''
    };

    let TYPE = {
        SUITE: 'SUITE',
        STORY: 'STORY',
        TEST: 'TEST',
        SCENARIO: 'SCENARIO',
        STEP: 'STEP',
        BEFORE_CLASS: 'BEFORE_CLASS',
        BEFORE_GROUPS: 'BEFORE_GROUPS',
        BEFORE_METHOD: 'BEFORE_METHOD',
        BEFORE_SUITE: 'BEFORE_SUITE',
        BEFORE_TEST: 'BEFORE_TEST',
        AFTER_CLASS: 'AFTER_CLASS',
        AFTER_GROUPS: 'AFTER_GROUPS',
        AFTER_METHOD: 'AFTER_METHOD',
        AFTER_SUITE: 'AFTER_SUITE',
        AFTER_TEST: 'AFTER_TEST'
    };

    let reporterOpts = options.reporterOptions || {};

    Base.call(this, runner);

    let config = Object.assign({
        attachScreenshots: true,
        showPassedHooks: false,
        token: '',
        endpoint: '',
        project: '',
        waitTime: 30000
    }, reporterOpts);
    let client = new RPClient(config);
    let tempLaunchId = null;
    let launchStatus = STATUS.PASSED;
    let suitStatus = STATUS.PASSED;
    let testStatus = STATUS.PASSED;
    let hookStatus = STATUS.PASSED;
    let parentIds = [];
    let finishScr = true;

    function invokeHandler(handler) {
        return function() {
            try {
                return handler.apply(this, arguments);
            } catch(error) {
                console.error('Reportportal reporter internal error: ', error);
            }
        };
    }

    function setLaunchId(id) {
        tempLaunchId = id;
    }

    function getParentId() {
        if (!parentIds.length) {
            return null;
        }
        return parentIds[parentIds.length - 1];
    }

    function getHookParentId() {
        if (!parentIds.length) {
            return null;
        }
        return parentIds[parentIds.length - 2];
    }

    function setParentId(id) {
        parentIds.push(id);
    }

    function removeParent() {
        parentIds.pop();
    }

    function getHookType(test) {
        let hType;
        let t = test.title;
        switch (true) {
            case t.startsWith('"before each"'):
                hType = TYPE.BEFORE_METHOD;
                break;
            case t.startsWith('"after each"'):
                hType = TYPE.AFTER_METHOD;
                break;
            case t.startsWith('"before all"'):
                hType = TYPE.BEFORE_CLASS;
                break;
            case t.startsWith('"after all"'):
                hType = TYPE.AFTER_CLASS;
                break;
            default:
                hType = null;
        }
        return hType;
    }

    function waitForPromise(rpObj) {
        let finish = false;
        setTimeout(() => {
            finish = true
        }, config.waitTime);
        rpObj.promise.then(() => {
            finish = true;
        }, (err) => {
            finish = true;
            console.error(err);
        });
        deasync.loopWhile(() => {
            return !finish
        });
    }

    function startLaunch() {
        let rpObj = client.startLaunch({});
        setLaunchId(rpObj.tempId);
        waitForPromise(rpObj);
    }

    function finishLaunch() {
        waitForPromise(client.finishLaunch(tempLaunchId, {
            status: launchStatus
        }));
    }

    function startSuit(suite) {
        let rpObj = client.startTestItem({
            type: TYPE.SUITE,
            description: suite.fullTitle(),
            name: suite.title
        }, tempLaunchId, getParentId());
        setParentId(rpObj.tempId);
        waitForPromise(rpObj);
    }

    function finishSuit() {
        let rpObj = client.finishTestItem(getParentId(), {
            suitStatus
        });
        removeParent();
        waitForPromise(rpObj);
    }

    function startHook(test) {
        let rpObj = client.startTestItem({
            type: getHookType(test),
            name: test.title
        }, tempLaunchId, getHookParentId());
        waitForPromise(rpObj);
        setParentId(rpObj.tempId);
    }

    function startTest(test) {
        let rpObj = client.startTestItem({
            type: TYPE.STEP,
            description: test.fullTitle(),
            name: test.title
        }, tempLaunchId, getParentId());
        waitForPromise(rpObj);
        setParentId(rpObj.tempId);
    }

    function finishTest(test) {
        if (test.log) {
            waitForPromise(client.sendLog(getParentId(), {
                message: test.log,
                level: LEVEL.INFO
            }));
        }
        let rpObj = client.finishTestItem(getParentId(), {
            status: STATUS.PASSED
        });
        removeParent();
        waitForPromise(rpObj);
    }

    function finishFailedTest(test) {
        finishScr = false;
        let parentId = getParentId();
        let promise = Promise.resolve(null);
        if (config.attachScreenshots) {
            promise = SpecificUtils.takeScreenshot(test.fullTitle());
        }
        promise.then((fileObj) => {
            fileObj.name = fileObj.name.replace(/\//g,'');
            waitForPromise(client.sendLog(parentId, {
                message: test.err.message,
                level: LEVEL.ERROR
            }, fileObj));
            if (test.log) {
                waitForPromise(client.sendLog(parentId, {
                    message: test.log,
                    level: LEVEL.INFO
                }));
            }
            waitForPromise(client.sendLog(parentId, {
                message: test.err.stack,
                level: LEVEL.TRACE
            }));
            waitForPromise(client.finishTestItem(parentId, {
                status: STATUS.FAILED
            }));
        });
        removeParent();
    }

    function finishAll() {
        waitForPromise(client.getPromiseFinishAllItems(tempLaunchId));
    }

    runner.on('start', invokeHandler(function () {
        launchStatus = STATUS.PASSED;
        startLaunch();
    }));

    runner.on('end', invokeHandler(function () {
        finishLaunch();
    }));

    runner.on('exit', invokeHandler(function () {
        finishAll();
    }));

    runner.on('suite', invokeHandler(function (suite) {
        if (suite.title !== '') {
            suitStatus = STATUS.PASSED;
            startSuit(suite);
        }
    }));

    runner.on('suite end', invokeHandler(function (suite) {
        if (suite.title !== '') {
            finishSuit();
        }
    }));

    runner.on('hook', invokeHandler(function (test) {
        hookStatus = STATUS.PASSED;
        if (test.title !== '"after each" hook: ret' && config.showPassedHooks) {
            startHook(test);
        }
    }));

    runner.on('hook end', invokeHandler(function (test) {
        if (test.title !== '"after each" hook: ret' && config.showPassedHooks) {
            finishTest(test);
        }
    }));

    runner.on('pass', invokeHandler(function (test) {
        testStatus = STATUS.PASSED;
        startTest(test);
        finishTest(test)
    }));

    runner.on('fail', invokeHandler(function (test) {
        testStatus = STATUS.FAILED;
        suitStatus = STATUS.FAILED;
        launchStatus = STATUS.FAILED;
        if (test.type === 'hook') {
            hookStatus = STATUS.FAILED;
            if (!config.showPassedHooks){
                startHook(test);
            }
            finishFailedTest(test);
        } else {
            startTest(test);
            finishFailedTest(test);
        }
    }));

    runner.on('pending', invokeHandler(function (test) {
        testStatus = STATUS.SKIPPED;
        startTest(test);
        finishTest(test)
    }));

}

module.exports = MochaRPReporter;
