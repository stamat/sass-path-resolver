import type { FileImporter } from 'sass';

export function pathExists(...pathSegments: string[]): boolean;
export function pathIsDirectory(...pathSegments: string[]): boolean;
export function tryToFindFile(filePath: string, extensions: string[]): string | null;
export function readPackageJson(packageDir: string): Record<string, unknown> | null;
export function extractPathFromExports(exports: unknown, subpath?: string): string | null;
export function extractMainPathFromPackageJson(packageJsonPath: string): string | null;
export function getPackagePath(url: string): string | null;
export function resolvePath(url: string, includePath: string): URL | null;

export function sassPathResolver(includePaths: string | string[]): FileImporter<'sync'>;

export default sassPathResolver;
