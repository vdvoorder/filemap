import { test as kitTest } from 'claude-code/testing'

const TEST_MS = 30_000

export const test: typeof kitTest = (name, ...rest) => (rest.length === 1 ? kitTest(name, { timeoutMs: TEST_MS }, rest[0]) : kitTest(name, { timeoutMs: TEST_MS, ...rest[0] }, rest[1]))
