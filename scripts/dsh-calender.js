#!/usr/bin/env node
/**
 * dsh-calender helper CLI.
 *
 *   node scripts/dsh-calender.js status                # is the plugin mounted in a profile?
 *   node scripts/dsh-calender.js mount [--profile P]   # dsh plugin add link:<dir>
 *   node scripts/dsh-calender.js unmount [--profile P] # dsh plugin remove dsh-calender
 *
 * Depends only on Node stdlib; shells out to the `dsh` CLI for mount/unmount and
 * reads the profile manifest (package.json "dsh.profile.bundles") for status.
 */
'use strict'
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')

const PACKAGE = 'dsh-calender'
const DEFAULT_PROFILE = process.env.DSH_PROFILE || 'web'

function profileDir(profile) {
  return join(homedir(), '.dsh', 'profiles', profile)
}

function profileManifest(profile) {
  const pkgPath = join(profileDir(profile), 'package.json')
  if (!existsSync(pkgPath)) return undefined
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return undefined
  }
}

function isMounted(profile) {
  const manifest = profileManifest(profile)
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  return bundles.some(b => String(b).toLowerCase().includes(PACKAGE))
}

function status(profile) {
  const manifest = profileManifest(profile)
  if (!manifest) {
    console.log(`profile "${profile}" not found under ~/.dsh/profiles`)
    return 1
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  console.log(`profile    : ${profile}`)
  console.log(`mounted    : ${isMounted(profile) ? 'yes' : 'no'}`)
  console.log(`bundles    : ${bundles.join(', ')}`)
  return 0
}

function run(profile, args) {
  try {
    execFileSync('dsh', args, { stdio: 'inherit', shell: process.platform === 'win32' })
    return 0
  } catch (e) {
    console.error(`failed: dsh ${args.join(' ')}`, e?.message ?? '')
    return 1
  }
}

function parseProfile(argv) {
  const i = argv.indexOf('--profile')
  if (i !== -1 && argv[i + 1]) return argv[i + 1]
  return DEFAULT_PROFILE
}

const args = process.argv.slice(2)
const profile = parseProfile(args)
const command = args.find(a => a !== '--profile' && a !== profile)

switch (command) {
  case 'status':
    process.exit(status(profile))
    break
  case 'mount': {
    const dir = resolve(__dirname, '..')
    process.exit(run(profile, ['plugin', '--profile', profile, 'add', 'link:' + dir]))
    break
  }
  case 'unmount':
    process.exit(run(profile, ['plugin', '--profile', profile, 'remove', PACKAGE]))
    break
  default:
    console.log(`
dsh-calender helper

  node scripts/dsh-calender.js status [--profile P]
  node scripts/dsh-calender.js mount   [--profile P]
  node scripts/dsh-calender.js unmount [--profile P]

default profile: ${DEFAULT_PROFILE}
`)
    process.exit(command ? 2 : 0)
}
