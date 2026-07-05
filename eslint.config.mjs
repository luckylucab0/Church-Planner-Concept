// Gemeinsame ESLint-Konfiguration (Flat Config) für alle Workspace-Pakete.
// Jedes Paket ruft `eslint <dirs>` auf; ESLint findet diese Datei über die
// Verzeichnis-Hierarchie.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Explizite Rückgabetypen erhöhen Lesbarkeit bei Services/Controllern,
      // sind aber bei trivialen Callbacks Lärm → nur für exportierte Funktionen
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // DTO-/Decorator-Pattern von Nest braucht leere Klassen gelegentlich
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
);
