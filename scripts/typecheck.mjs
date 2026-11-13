import ts from 'typescript';
import path from 'node:path';

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('tsconfig.json not found');
const read = ts.readConfigFile(configPath, ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(config.fileNames, config.options);
// Hydro publishes TypeScript source with its own non-strict compiler settings.
// Check our code strictly against its actual API types, without rechecking the host's source.
const diagnostics = [...(read.error ? [read.error] : []), ...config.errors, ...ts.getPreEmitDiagnostics(program)]
    .filter((diagnostic) => !diagnostic.file || !diagnostic.file.fileName.includes('/node_modules/'));
if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n',
    }));
    process.exitCode = 1;
} else console.log('Plugin typecheck passed against the installed Hydro API.');
