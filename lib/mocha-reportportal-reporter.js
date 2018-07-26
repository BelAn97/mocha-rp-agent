const SpecificUtils = require('./specificUtils');
const RPClient = require('reportportal-client');
const mocha = require('mocha');

const STATUS = {
    PASSED: 'PASSED',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED',
    SKIPPED: 'SKIPPED',
    RESETED: 'RESETED',
    CANCELLED: 'CANCELLED'
};
const LEVEL = {
    ERROR: 'ERROR',
    TRACE: 'TRACE',
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    EMPTY: ''
};
const TYPE = {
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

function MochaRPReporter(runner, options) {

    let Base = mocha.reporters.Base;
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
    let promise = Promise.resolve(null);

    let setLaunchId = (id) => {
        tempLaunchId = id;
    };

    let getParentId = () => {
        if (!parentIds.length) {
            return null;
        }
        return parentIds[parentIds.length - 1];
    };

    let getHookParentId = () => {
        if (!parentIds.length) {
            return null;
        }
        return parentIds[parentIds.length - 2];
    };

    let setParentId = (id) => {
        parentIds.push(id);
    };

    let removeParent = () => {
        parentIds.pop();
    };

    let getHookType = (test) => {
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
    };

    let startLaunch = async () => {
        let rpObj = client.startLaunch({});
        setLaunchId(rpObj.tempId);
        promise = rpObj.promise
    };

    let finishLaunch = async () => {
        await promise;
        client.finishLaunch(tempLaunchId, {
            status: launchStatus
        });
    };

    let startSuit = async (suite) => {
        await promise;
        let rpObj = client.startTestItem({
            type: TYPE.SUITE,
            description: suite.fullTitle(),
            name: suite.title
        }, tempLaunchId, getParentId());
        setParentId(rpObj.tempId);
        promise = rpObj.promise
    };

    let finishSuit = async () => {
        await promise;
        let rpObj = client.finishTestItem(getParentId(), {
            status: suitStatus
        }).promise;
        removeParent();
        promise = rpObj.promise
    };

    let startHook = async (test) => {
        await promise;
        let rpObj = client.startTestItem({
            type: getHookType(test),
            name: test.title
        }, tempLaunchId, getHookParentId());
        setParentId(rpObj.tempId);
        promise = rpObj.promise
    };

    let startTest = async (test) => {
        await promise;
        let rpObj = client.startTestItem({
            type: TYPE.STEP,
            description: test.fullTitle(),
            name: test.title
        }, tempLaunchId, getParentId());
        setParentId(rpObj.tempId);
        promise = rpObj.promise
    };

    let finishTest = async (test) => {
        await promise;
        if (test.log) {
            client.sendLog(getParentId(), {
                message: test.log,
                level: LEVEL.INFO
            });
        }
        let rpObj = client.finishTestItem(getParentId(), {
            status: STATUS.PASSED
        });
        removeParent();
        promise = rpObj.promise
    };

    let finishFailedTest = async (test) => {
        await promise;
        let parentId = getParentId();
        if (config.attachScreenshots) {
            promise = SpecificUtils.takeScreenshot(test.fullTitle());
        }
        promise.then((fileObj) => {
            if (fileObj !== null) {
                fileObj.name = fileObj.name.replace(/\//g, '');
                client.sendLog(parentId, {
                    message: test.err.message,
                    level: LEVEL.ERROR
                }, fileObj);
            }
            if (test.err.actual && test.err.expected) {
                client.sendLog(parentId, {
                    message: 'Actual:\n' + test.err.actual + '\nExpected:\n' + test.err.expected,
                    level: LEVEL.ERROR
                });
            }
            if (test.log) {
                client.sendLog(parentId, {
                    message: test.log,
                    level: LEVEL.INFO
                });
            }
            client.sendLog(parentId, {
                message: test.err.stack,
                level: LEVEL.TRACE
            });
            client.finishTestItem(parentId, {
                status: STATUS.FAILED
            });
        });
        removeParent();
    };

    runner.on('start', () => {
        launchStatus = STATUS.PASSED;
        try {
            startLaunch();
        } catch (err) {
            console.error('Failed to start launch: ', err);
        }
    });

    runner.on('end', () => {
        try {
            finishLaunch();
        } catch (err) {
            console.error('Failed to finish launch: ', err);
        }
    });

    runner.on('suite', (suite) => {
        if (suite.title !== '') {
            suitStatus = STATUS.PASSED;
            try {
                startSuit(suite);
            } catch (err) {
                console.error('Failed to start suit: ', err);
            }
        }
    });

    runner.on('suite end', (suite) => {
        if (suite.title !== '') {
            try {
                finishSuit();
            } catch (err) {
                console.error('Failed to finish suit: ', err);
            }
        }
    });

    runner.on('hook', (test) => {
        hookStatus = STATUS.PASSED;
        if (test.title !== '"after each" hook: ret' && config.showPassedHooks) {
            try {
                startHook(test);
            } catch (err) {
                console.error('Failed to start hook: ', err);
            }
        }
    });

    runner.on('hook end', (test) => {
        if (test.title !== '"after each" hook: ret' && config.showPassedHooks) {
            try {
                finishTest(test);
            } catch (err) {
                console.error('Failed to finish hook: ', err);
            }
        }
    });

    runner.on('pass', (test) => {
        testStatus = STATUS.PASSED;
        try {
            startTest(test);
            finishTest(test);
        } catch (err) {
            console.error('Failed to add passed test: ', err);
        }
    });

    runner.on('fail', (test) => {
        testStatus = STATUS.FAILED;
        suitStatus = STATUS.FAILED;
        launchStatus = STATUS.FAILED;
        try {
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
        } catch (err) {
            console.error('Failed to add failed test: ', err);
        }
    });

    runner.on('pending', (test) => {
        testStatus = STATUS.SKIPPED;
        try {
            startTest(test);
            finishTest(test);
        } catch (err) {
            console.error('Failed to add pending test: ', err);
        }
    });


}

module.exports = MochaRPReporter;