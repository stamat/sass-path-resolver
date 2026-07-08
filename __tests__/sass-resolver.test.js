import { beforeEach, afterEach, it, describe, expect } from '@jest/globals'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import {
  tryToFindFile,
  extractMainPathFromPackageJson,
  getPackagePath,
  resolvePath,
  sassPathResolver,
} from '../sass-path-resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = path.join(__dirname, 'fixtures')
const FAKE_MODULES = path.join(FIXTURE_ROOT, 'fake_modules')

let originalCwd

beforeEach(() => {
  originalCwd = process.cwd()
  process.chdir(FIXTURE_ROOT)
})

afterEach(() => {
  process.chdir(originalCwd)
})

describe('getPackagePath', () => {
  it('returns the first directory segment for unscoped packages', () => {
    expect(getPackagePath('my-pkg/src/index.scss')).toBe('my-pkg')
  })

  it('returns scoped package path for @scoped packages', () => {
    expect(getPackagePath('@scoped/my-pkg/src/index.scss')).toBe('@scoped/my-pkg')
  })

  it('returns first segment for deeper paths', () => {
    expect(getPackagePath('my-pkg/core/utils/helpers')).toBe('my-pkg')
  })

  it('returns null for bare names with no directory', () => {
    expect(getPackagePath('my-pkg')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(getPackagePath('')).toBeNull()
  })
})

describe('tryToFindFile', () => {
  it('finds a file with an explicit extension', () => {
    const result = tryToFindFile('src/direct-file.scss', ['sass', 'scss', 'css'])
    expect(result).toBe('src/direct-file.scss')
  })

  it('appends extension when not provided', () => {
    const result = tryToFindFile('src/direct-file', ['sass', 'scss', 'css'])
    expect(result).toBe('src/direct-file.scss')
  })

  it('finds underscore partials at root level', () => {
    const result = tryToFindFile('src/partial', ['sass', 'scss', 'css'])
    expect(result).toBe(path.join('src', '_partial.scss'))
  })

  it('returns null for nonexistent files', () => {
    const result = tryToFindFile('src/nonexistent', ['sass', 'scss', 'css'])
    expect(result).toBeNull()
  })

  it('finds underscore partials when an explicit extension is given', () => {
    const result = tryToFindFile('src/partial.scss', ['sass', 'scss', 'css'])
    expect(result).toBe(path.join('src', '_partial.scss'))
  })

  it('does not double-underscore already-prefixed names', () => {
    const result = tryToFindFile('src/_partial', ['sass', 'scss', 'css'])
    expect(result).toBe('src/_partial.scss')
  })

  it('finds files in subdirectories', () => {
    const result = tryToFindFile('src/subdir/item', ['sass', 'scss', 'css'])
    expect(result).toBe(path.join('src', 'subdir', '_item.scss'))
  })

  it('finds underscore partials in nested paths without extension', () => {
    const result = tryToFindFile(
      path.join('fake_modules', 'my-pkg', 'src', 'core', 'config'),
      ['sass', 'scss', 'css']
    )
    expect(result).toBe(path.join('fake_modules', 'my-pkg', 'src', 'core', '_config.scss'))
  })
})

describe('extractMainPathFromPackageJson', () => {
  it('returns sass field when present', () => {
    const result = extractMainPathFromPackageJson('fake_modules/my-pkg')
    expect(result).toBe('src/index.scss')
  })

  it('returns style field when sass is absent', () => {
    const result = extractMainPathFromPackageJson('fake_modules/style-field-pkg')
    expect(result).toBe('dist/main.css')
  })

  it('returns null when no style fields exist', () => {
    const result = extractMainPathFromPackageJson('fake_modules/no-style-pkg')
    expect(result).toBeNull()
  })

  it('returns null for nonexistent package', () => {
    const result = extractMainPathFromPackageJson('fake_modules/nonexistent-pkg')
    expect(result).toBeNull()
  })
})

describe('resolvePath', () => {
  const includePath = FAKE_MODULES

  it('resolves a package directory to its index file', () => {
    const result = resolvePath('my-pkg/src/core', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'core', 'index.scss'))
  })

  it('resolves a package root via package.json sass field', () => {
    const result = resolvePath('my-pkg', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
  })

  it('resolves a direct file with extension', () => {
    const result = resolvePath('my-pkg/src/index.scss', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
  })

  it('resolves a direct file without extension', () => {
    const result = resolvePath('my-pkg/src/index', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
  })

  it('resolves scoped packages', () => {
    const result = resolvePath('@scoped/my-pkg', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('@scoped', 'my-pkg', 'src', 'index.scss'))
  })

  it('resolves a subdirectory with index file', () => {
    const result = resolvePath('my-pkg/src/core/utils', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'core', 'utils', 'index.scss'))
  })

  it('returns null for nonexistent resolve path', () => {
    const result = resolvePath('my-pkg', '/nonexistent/path')
    expect(result).toBeNull()
  })

  it('returns null for nonexistent package', () => {
    const result = resolvePath('nonexistent-pkg/index', includePath)
    expect(result).toBeNull()
  })

  it('returns null for a directory without index or style fields', () => {
    const result = resolvePath('no-style-pkg', includePath)
    expect(result).toBeNull()
  })

  it('resolves packages behind symlinks (pnpm-style node_modules)', () => {
    const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sass-resolver-'))
    try {
      fs.symlinkSync(path.join(FAKE_MODULES, 'my-pkg'), path.join(linkRoot, 'my-pkg'), 'dir')
      const result = resolvePath('my-pkg', linkRoot)
      expect(result).not.toBeNull()
      expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
    } finally {
      fs.rmSync(linkRoot, { recursive: true, force: true })
    }
  })

  it('resolves my-pkg/core/config (underscore partial via package path)', () => {
    const result = resolvePath('my-pkg/core/config', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'core', '_config.scss'))
  })

  it('resolves my-pkg/core/utils/helpers (underscore partial via package path)', () => {
    const result = resolvePath('my-pkg/core/utils/helpers', includePath)
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'core', 'utils', '_helpers.scss'))
  })
})

describe('sassPathResolver', () => {
  it('returns an object with a findFileUrl method', () => {
    const importer = sassPathResolver(FAKE_MODULES)
    expect(typeof importer.findFileUrl).toBe('function')
  })

  it('resolves a package with a single string path', () => {
    const importer = sassPathResolver(FAKE_MODULES)
    const result = importer.findFileUrl('my-pkg')
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
  })

  it('resolves a package with an array of paths', () => {
    const importer = sassPathResolver(['/nonexistent/path', FAKE_MODULES])
    const result = importer.findFileUrl('my-pkg')
    expect(result).not.toBeNull()
    expect(fileURLToPath(result)).toContain(path.join('my-pkg', 'src', 'index.scss'))
  })

  it('returns null for unresolvable imports', () => {
    const importer = sassPathResolver(FAKE_MODULES)
    const result = importer.findFileUrl('nonexistent-pkg')
    expect(result).toBeNull()
  })

  it('returns null for any URL when given an empty array', () => {
    const importer = sassPathResolver([])
    expect(importer.findFileUrl('my-pkg')).toBeNull()
  })

  it('throws when called without arguments', () => {
    expect(() => sassPathResolver()).toThrow()
  })

  it('throws when called with an invalid argument', () => {
    expect(() => sassPathResolver(123)).toThrow()
  })
})

describe('dart sass integration', () => {
  it('compiles a file that @use imports from fake_modules', () => {
    const entryFile = path.join(FIXTURE_ROOT, 'src', 'entry.scss')
    const result = sass.compile(entryFile, {
      importers: [sassPathResolver(FAKE_MODULES)]
    })
    expect(result.css).toContain('.test')
    expect(result.css).toContain('color: #f00')
  })

  it('compiles a string that @use imports from fake_modules', () => {
    const result = sass.compileString('@use "my-pkg/core/config";\n.test { color: config.$primary-color; }', {
      importers: [sassPathResolver(FAKE_MODULES)]
    })
    expect(result.css).toContain('.test')
    expect(result.css).toContain('color: #f00')
  })

  it('compiles a string that @use imports a partial with explicit extension', () => {
    const result = sass.compileString('@use "my-pkg/core/config.scss";\n.test { color: config.$primary-color; }', {
      importers: [sassPathResolver(FAKE_MODULES)]
    })
    expect(result.css).toContain('color: #f00')
  })

  it('compiles a string that @use imports a CSS package via style field', () => {
    const result = sass.compileString('@use "style-field-pkg";', {
      importers: [sassPathResolver(FAKE_MODULES)]
    })
    expect(result.css).toContain('.style-field-pkg')
    expect(result.css).toContain('display: flex')
  })

  it('throws when importing a nonexistent package', () => {
    expect(() => {
      sass.compileString('@use "nonexistent-pkg";', {
        importers: [sassPathResolver(FAKE_MODULES)]
      })
    }).toThrow()
  })
})
