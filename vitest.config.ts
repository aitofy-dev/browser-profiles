import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Only this checkout: .claude/worktrees holds sibling checkouts with their own suites.
        include: ['src/**/*.test.ts'],
    },
});
