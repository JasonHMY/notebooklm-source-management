const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(REPO_ROOT, 'src/utils/storage-contract.js');

describe('storage contract', () => {
    let storageContract;

    beforeAll(() => {
        const createStorageContract = require(CONTRACT_PATH);
        storageContract = createStorageContract();
    });

    it('builds every notebook-scoped storage key exactly', () => {
        const stateKey = storageContract.getStateKey('123');

        expect(stateKey).toBe('sourcesPlusState_123');
        expect(storageContract.getStateKey('')).toBe('');
        expect(storageContract.getStateBackupKey(stateKey)).toBe('sourcesPlusState_123__backup');
        expect(storageContract.getStateBackupKey('')).toBe('');
        expect(storageContract.getStateHistoryKey(stateKey)).toBe('sourcesPlusHistory_123');
        expect(storageContract.getStateHistoryKey('')).toBe('');
        expect(storageContract.getRecoveryKey('123')).toBe('sourcesPlusRecovery_123');
        expect(storageContract.getRecoveryKey('')).toBe('');
        expect(storageContract.getDeveloperLogKey('123')).toBe('sourcesPlusDeveloperLogs_123');
        expect(storageContract.getDeveloperLogKey('')).toBe('');
    });

    it('converts history keys back to state keys only for the exact history prefix', () => {
        expect(storageContract.getStateKeyFromHistoryKey('sourcesPlusHistory_123'))
            .toBe('sourcesPlusState_123');
        expect(storageContract.getStateKeyFromHistoryKey('sourcesPlusState_123')).toBe('');
        expect(storageContract.getStateKeyFromHistoryKey('prefix_sourcesPlusHistory_123')).toBe('');
        expect(storageContract.getStateKeyFromHistoryKey('')).toBe('');
    });

    it('checks notebook ownership by exact key construction instead of suffix matching', () => {
        expect(storageContract.isNotebookScopedKeyForProject(
            'sourcesPlusState_123',
            storageContract.STATE_KEY_PREFIX,
            '123'
        )).toBe(true);
        expect(storageContract.isNotebookScopedKeyForProject(
            'sourcesPlusState_1234',
            storageContract.STATE_KEY_PREFIX,
            '123'
        )).toBe(false);
        expect(storageContract.isNotebookScopedKeyForProject(
            'sourcesPlusState_123__backup',
            storageContract.STATE_KEY_PREFIX,
            '123'
        )).toBe(false);
        expect(storageContract.isNotebookScopedKeyForProject(
            'sourcesPlusHistory_123',
            storageContract.STATE_HISTORY_KEY_PREFIX,
            '123'
        )).toBe(true);
    });

    it.each([
        [null, 'legacy'],
        [{}, 'legacy'],
        [{ schemaVersion: 1 }, 'legacy'],
        [{ schemaVersion: 2 }, 'supported'],
        [{ schemaVersion: 5 }, 'supported'],
        [{ schemaVersion: 6 }, 'future'],
        [{ schemaVersion: 0 }, 'invalid'],
        [{ schemaVersion: -1 }, 'invalid'],
        [{ schemaVersion: 2.5 }, 'invalid'],
        [{ schemaVersion: '5' }, 'invalid'],
        [[], 'invalid'],
        ['invalid', 'invalid']
    ])('classifies schema compatibility for %p as %s', (value, expected) => {
        expect(storageContract.getStateSchemaCompatibility(value)).toBe(expected);
    });

    it('returns an immutable contract without mutable runtime state', () => {
        expect(Object.isFrozen(storageContract)).toBe(true);
        expect(Object.keys(storageContract).sort()).toEqual([
            'DEVELOPER_LOG_KEY_PREFIX',
            'IMPORT_EXPORT_FORMAT',
            'IMPORT_EXPORT_FORMAT_VERSION',
            'RECOVERY_KEY_PREFIX',
            'STATE_HISTORY_KEY_PREFIX',
            'STATE_KEY_PREFIX',
            'STORAGE_SCHEMA_VERSION',
            'getDeveloperLogKey',
            'getRecoveryKey',
            'getStateBackupKey',
            'getStateHistoryKey',
            'getStateKey',
            'getStateKeyFromHistoryKey',
            'getStateSchemaCompatibility',
            'isNotebookScopedKeyForProject'
        ].sort());
        expect(Object.values(storageContract).some(value => (
            value instanceof Map
            || value instanceof Set
            || Array.isArray(value)
            || (value && typeof value === 'object')
        ))).toBe(false);
    });

    it('keeps all storage contract definitions out of background and content modules', () => {
        const sourceRoots = [
            path.join(REPO_ROOT, 'src/background'),
            path.join(REPO_ROOT, 'src/content')
        ];
        const files = sourceRoots.flatMap((root) => (
            fs.readdirSync(root)
                .filter(file => file.endsWith('.js'))
                .map(file => path.join(root, file))
        ));
        const duplicateDefinitionPattern = new RegExp([
            '(?:const|let|var) (?:STORAGE_SCHEMA_VERSION|IMPORT_EXPORT_FORMAT|IMPORT_EXPORT_FORMAT_VERSION|STATE_KEY_PREFIX|STATE_HISTORY_KEY_PREFIX|RECOVERY_KEY_PREFIX|DEVELOPER_LOG_KEY_PREFIX)',
            'function (?:getStateKey|getStateBackupKey|getStateHistoryKey|getStateKeyFromHistoryKey|getRecoveryKey|getDeveloperLogKey|isNotebookScopedKeyForProject|getStateSchemaCompatibility)',
            '(?:const|let|var) (?:getStateKey|getStateBackupKey|getStateHistoryKey|getStateKeyFromHistoryKey|getRecoveryKey|getDeveloperLogKey|isNotebookScopedKeyForProject|getStateSchemaCompatibility) =',
            '[\'"`]sourcesPlus(?:State|History|Recovery|DeveloperLogs)_',
            '[\'"`]notebooklm-source-management-config[\'"`]',
            '\\$\\{[^}]+\\}__backup',
            '\\+\\s*[\'"]__backup[\'"]'
        ].join('|'));
        const matches = files.flatMap((file) => {
            const source = fs.readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            return duplicateDefinitionPattern.test(source)
                ? [path.relative(REPO_ROOT, file)]
                : [];
        });

        expect(matches).toEqual([]);
    });
});
