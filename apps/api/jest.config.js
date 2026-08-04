/**
 * Jest-Konfiguration der API.
 * - Unit-Tests liegen neben dem Code (*.spec.ts in src/)
 * - Integrationstests (echte DB/Redis) liegen in test/ (*.int-spec.ts)
 *   und laufen im selben Lauf – CI stellt Postgres/Redis als Services.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Workspace-Paket auf die TS-Quellen mappen, damit Tests ohne
  // vorherigen Build von @serveflow/shared laufen.
  moduleNameMapper: {
    '^@serveflow/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // ESM-only-Pakete (z. B. cookie@2, das @fastify/cookie per dynamischem
  // import() lädt) bleiben unangetastet: Jest lädt sie mit
  // --experimental-vm-modules (siehe test-Script) nativ als ESM. Sie nach CJS
  // zu transpilieren würde sie kaputt machen – die ESM-Runtime kennt kein
  // `exports`.
  transformIgnorePatterns: ['/node_modules/'],
};
