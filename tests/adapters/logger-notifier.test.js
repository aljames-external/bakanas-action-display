import '../setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger, log, notify } from '../../src/lib/logger.js';

test('Logger class encapsulates console logging and unified UI notification dispatching', async () => {
    const customLogger = new Logger();
    assert.ok(customLogger instanceof Logger);
    assert.equal(typeof customLogger.error, 'function');
    assert.equal(typeof customLogger.warn, 'function');
    assert.equal(typeof customLogger.info, 'function');
    assert.equal(typeof customLogger.debug, 'function');
    assert.equal(typeof customLogger.notify.info, 'function');
    assert.equal(typeof customLogger.notify.warn, 'function');
    assert.equal(typeof customLogger.notify.error, 'function');

    assert.doesNotThrow(() => {
        log.notify.info('Test log.notify.info');
        log.notify.warn('Test log.notify.warn');
        log.notify.error('Test log.notify.error');
        notify.info('Test Info Notification');
        notify.warn('Test Warn Notification');
        notify.error('Test Error Notification');
    });
});

test('Logger._flushQueues formats single message directly and multiple messages with bullet points and header', () => {
    const customLogger = new Logger();
    const calls = [];
    const origNotifications = ui.notifications;
    ui.notifications = {
        info: (msg) => calls.push({ level: 'info', msg }),
        warn: (msg) => calls.push({ level: 'warn', msg }),
        error: (msg) => calls.push({ level: 'error', msg })
    };

    try {
        // Single message
        customLogger.notify.info('Single info message');
        customLogger._flushQueues();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].level, 'info');
        assert.equal(calls[0].msg, 'Single info message');

        // Multiple messages grouped
        calls.length = 0;
        customLogger.notify.error('First error');
        customLogger.notify.error('Second error');
        customLogger.notify.warn('First warn');
        customLogger.notify.warn('Second warn');
        customLogger._flushQueues();

        assert.equal(calls.length, 2);
        const warnCall = calls.find((c) => c.level === 'warn');
        const errorCall = calls.find((c) => c.level === 'error');

        assert.ok(warnCall.msg.includes("Bakana's Action Display — Warnings (2):"));
        assert.ok(warnCall.msg.includes('• First warn\n• Second warn'));
        assert.ok(errorCall.msg.includes("Bakana's Action Display — Errors (2):"));
        assert.ok(errorCall.msg.includes('• First error\n• Second error'));
    } finally {
        ui.notifications = origNotifications;
    }
});
