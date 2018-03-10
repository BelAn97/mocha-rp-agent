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

    let self = this;
    Base.call(self, runner);
    new mocha.reporters.Spec(runner);

    let config = Object.assign({
        token: '',
        endpoint: '',
        project: '',
    }, reporterOpts);
    let client = new RPClient(config);
    let tempLaunchId = null;
    let status = STATUS.PASSED;
    let suitStatus = STATUS.PASSED;
    let testStatus = STATUS.PASSED;
    let hookStatus = STATUS.PASSED;
    let parentIds = [];

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
        rpObj.promise.then(() => {
            finish = true;
        });
        deasync.loopWhile(() => {
            return !finish;
        });
    }

    async function takeScreenshot(name) {
        return await SpecificUtils.takeScreenshot(name);
    }

    function attachScreenshot(test) {
        if (reporterOpts.attachPicturesToLogs) {
            let parentId = getParentId();
            SpecificUtils.takeScreenshot(test.fullTitle()).then((fileObj) => {
                Promise.resolve(client.sendLog(parentId, {
                    message: test.err.message,
                    level: LEVEL.ERROR
                }, fileObj))
            });
            deasync.sleep(1000);
        }
    }

    function startLaunch() {
        let rpObj = client.startLaunch({});
        setLaunchId(rpObj.tempId);
        waitForPromise(rpObj);
    }

    function finishLaunch() {
        waitForPromise(client.finishLaunch(tempLaunchId, {
            status
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

    function finishHook(test) {
        if (test.logr) {
            waitForPromise(client.sendLog(getParentId(), {
                message: test.logr,
                level: LEVEL.INFO
            }));
        }
        waitForPromise(client.finishTestItem(getParentId(), {
            status: hookStatus
        }));
        removeParent();
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
        if (test.logr) {
            waitForPromise(client.sendLog(getParentId(), {
                message: test.logr,
                level: LEVEL.INFO
            }));
        }
        let rpObj = client.finishTestItem(getParentId(), {
            status: testStatus
        });
        removeParent();
        waitForPromise(rpObj);
    }

    function finishFailedTest(test) {
        if (test.logr) {
            waitForPromise(client.sendLog(getParentId(), {
                message: test.logr,
                level: LEVEL.INFO
            }));
        }
        waitForPromise(client.sendLog(getParentId(), {
            message: test.err.stack,
            level: LEVEL.TRACE
        }));
        waitForPromise(client.finishTestItem(getParentId(), {
            status: testStatus
        }));
        removeParent();
    }

    function finishAll() {
        waitForPromise(client.getPromiseFinishAllItems(tempLaunchId));
    }

    runner.on('start', function () {
        status = STATUS.PASSED;
        try {
            startLaunch();
        } catch (err) {
            console.log('Failed to start launch: '.concat(err));
        }
    });

    runner.on('end', function () {
        try {
            finishLaunch();
        } catch (err) {
            console.log('Failed to finish launch: '.concat(err));
        }
    });

    runner.on('exit', function () {
        finishAll();
    });

    runner.on('suite', function (suite) {
        if (suite.title !== '') {
            try {
                suitStatus = STATUS.PASSED;
                startSuit(suite);
            } catch (err) {
                console.log('Failed to log suit: '.concat(err));
            }
        }
    });

    runner.on('suite end', function (suite) {
        if (suite.title !== '') {
            try {
                finishSuit();
            } catch (err) {
                console.log('Failed to finish suit: '.concat(err));
            }
        }
    });

    runner.on('hook', function (test) {
        hookStatus = STATUS.PASSED;
        if (test.title !== '"after each" hook: ret') {
            try {
                startHook(test);
            } catch (err) {
                console.log('Failed to log hook: '.concat(err));
            }
        }
    });

    runner.on('hook end', function (test) {
        if (test.title !== '"after each" hook: ret') {
            try {
                finishHook(test);
            } catch (err) {
                console.log('Failed to finish hook: '.concat(err));
            }
        }
    });

    runner.on('test', function (test) {
        try {
            startTest(test);
        } catch (err) {
            console.log('Failed to log test: '.concat(err));
        }
    });

    runner.on('pass', function () {
        testStatus = STATUS.PASSED;
    });

    runner.on('fail', function (test) {
        try {
            testStatus = STATUS.FAILED;
            suitStatus = STATUS.FAILED;
            status = STATUS.FAILED;
            attachScreenshot(test);
            if (test.type === 'hook') {
                hookStatus = STATUS.FAILED;
                finishHook(test);
            }
        } catch (err) {
            console.log('Failed to log fail: '.concat(err));
        }
    });

    runner.on('pending', function (test) {
        try {
            testStatus = STATUS.SKIPPED;
            startTest(test);
            finishTest(test)
        } catch (err) {
            console.log('Failed to log pending: '.concat(err));
        }
    });

    runner.on('test end', function (test) {
        try {
            if (testStatus === STATUS.FAILED){
                finishFailedTest(test);
            } else {
                finishTest(test)
            }
        } catch (err) {
            console.log('Failed to finish test: '.concat(err));
        }
    });

}

module.exports = MochaRPReporter;
