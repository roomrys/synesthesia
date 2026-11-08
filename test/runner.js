// A tiny test runner for the browser. Serve the repo and open test/run.html,
// or run everything headless with test/run-headless.sh.

const tests = [];

export function test(name, fn) {
    tests.push({ name, fn });
}

export function assert(condition, message = 'assertion failed') {
    if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertClose(actual, expected, tolerance, message = '') {
    if (!(Math.abs(actual - expected) <= tolerance)) {
        throw new Error(`${message} expected ${expected} ± ${tolerance}, got ${actual}`);
    }
}

export async function assertRejects(promise, check = () => true, message = 'expected rejection') {
    try {
        await promise;
    } catch (err) {
        if (!check(err)) throw new Error(`${message}: wrong error ${err}`);
        return;
    }
    throw new Error(message);
}

export async function run(output) {
    let passed = 0;
    const lines = [];
    for (const { name, fn } of tests) {
        const t0 = performance.now();
        try {
            await fn();
            passed++;
            lines.push(`ok   ${name} (${Math.round(performance.now() - t0)} ms)`);
        } catch (err) {
            lines.push(`FAIL ${name}\n     ${err?.stack ?? err}`);
        }
    }
    const failed = tests.length - passed;
    lines.push('', `${passed} passed, ${failed} failed`);
    output.textContent = lines.join('\n');
    document.title = failed ? `FAIL (${failed})` : `PASS (${passed})`;
    // Read by test/run-headless.sh.
    console.log(`TEST RESULTS\n${lines.join('\n')}\nTESTS DONE`);
    document.body.dataset.done = failed ? 'fail' : 'pass';
}
