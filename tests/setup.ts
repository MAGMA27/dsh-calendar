// jsdom setup for component tests: React needs the act-environment flag to
// treat act() as the scheduler entry; without it React logs a warning on every
// act() call in tests.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
