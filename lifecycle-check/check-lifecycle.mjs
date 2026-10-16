import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryArgument = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
assert.ok(repositoryArgument, "Pass the patched react-native-screens checkout path");
const repository = path.resolve(repositoryArgument);
const sources = path.join(repository, "android/src/main/java/com/swmansion/rnscreens/legacy");
const files = {
  screen: path.join(sources, "Screen.kt"),
  delegate: path.join(sources, "bottomsheet/SheetDelegate.kt"),
  proxy: path.join(sources, "InsetsObserverProxy.kt"),
};
const text = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.readFileSync(file, "utf8")]));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function method(source, signature) {
  // Restrict to methods on the outer class; nested callbacks share some names.
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^    ${escaped}`, "gm"))];
  assert.equal(matches.length, 1, `Expected one production method: ${signature}`);
  const start = matches[0].index + 4;
  const body = source.indexOf("{", start);
  assert.ok(body >= 0, `Missing method body: ${signature}`);
  let depth = 1;
  let end = body + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}") depth -= 1;
    end += 1;
  }
  assert.equal(depth, 0, `Unbalanced method body: ${signature}`);
  return source.slice(start, end);
}

const destroySignature = "private fun handleHostFragmentOnDestroy()";
const unsubscribe = "        InsetsObserverProxy.removeOnApplyWindowInsetsListener(this)\n";
const destroy = method(text.delegate, destroySignature);
assert.equal(destroy.split(unsubscribe).length, 2, "Expected one destroy unsubscribe in the fixed source");
const replacements = {
  SCREEN_ATTACH: method(text.screen, "override fun onAttachedToWindow()"),
  DELEGATE_METHODS: [
    "override fun onStateChanged(",
    "private fun handleHostFragmentOnCreate()",
    "private fun handleHostFragmentOnStart()",
    "private fun handleHostFragmentOnResume()",
    "private fun handleHostFragmentOnPause()",
    destroySignature,
    "private fun preserveBackgroundFocus()",
    "private fun restoreBackgroundFocus()",
  ].map((signature) => method(text.delegate, signature)).join("\n\n"),
  PROXY_METHODS: [
    "fun addOnApplyWindowInsetsListener(",
    "fun removeOnApplyWindowInsetsListener(",
    "override fun onApplyWindowInsets(",
  ].map((signature) => method(text.proxy, signature)).join("\n\n"),
};
let fixed = fs.readFileSync(path.join(directory, "harness.kt"), "utf8");
for (const [name, value] of Object.entries(replacements)) {
  const marker = `// @${name}@`;
  assert.equal(fixed.split(marker).length, 2, `Expected one harness marker: ${marker}`);
  fixed = fixed.replace(marker, value);
}
const withoutUnsubscribe = fixed.replace(destroy, destroy.replace(unsubscribe, ""));
assert.notEqual(fixed, withoutUnsubscribe);
assert.equal(fixed.length - withoutUnsubscribe.length, unsubscribe.length);

const output = path.join(directory, "out");
const variants = [
  { name: "without-destroy-unsubscribe", source: withoutUnsubscribe },
  { name: "fixed", source: fixed },
].map((variant) => {
  const folder = path.join(output, variant.name);
  fs.mkdirSync(folder, { recursive: true });
  const sourceFile = path.join(folder, "SheetLifecycleCheck.kt");
  fs.writeFileSync(sourceFile, variant.source);
  return { ...variant, folder, sourceFile };
});
const manifest = {
  baseCommit: "561feef37a2713bafd3652f8ed140b452e26ccbb",
  sourceFiles: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, {
    path: file, sha256: sha256(text[name]),
  }])),
  harnessSha256: sha256(fs.readFileSync(path.join(directory, "harness.kt"))),
  generated: Object.fromEntries(variants.map(({ name, source }) => [name, sha256(source)])),
  ablation: "Only remove the destroy-handler unsubscribe line from the extracted fixed methods; never modify the checkout.",
};
fs.writeFileSync(path.join(output, "sources.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (process.argv.includes("--generate-only")) {
  console.log(`Generated both variants and source hashes in ${output}; no compilation or tests run.`);
  process.exit(0);
}

const cache = path.join(process.env.GRADLE_USER_HOME ?? path.join(os.homedir(), ".gradle"), "caches/modules-2/files-2.1");
function artifact(group, name, version) {
  const location = path.join(cache, group, name, version);
  if (fs.existsSync(location)) {
    for (const hash of fs.readdirSync(location).sort()) {
      const file = path.join(location, hash, `${name}-${version}.jar`);
      if (fs.existsSync(file)) return file;
    }
  }
  throw new Error(`Missing cached ${group}:${name}:${version}; this check does not download dependencies.`);
}
const kotlinVersion = "2.2.10";
const stdlib = artifact("org.jetbrains.kotlin", "kotlin-stdlib", kotlinVersion);
const annotations = artifact("org.jetbrains", "annotations", "13.0");
const compilerClasspath = [
  ...["kotlin-compiler-embeddable", "kotlin-stdlib", "kotlin-script-runtime", "kotlin-daemon-embeddable"]
    .map((name) => artifact("org.jetbrains.kotlin", name, kotlinVersion)),
  artifact("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
  artifact("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.0"),
  annotations,
].join(path.delimiter);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin/java") : "java";
function javaRun(args, folder, name) {
  const result = spawnSync(java, args, { cwd: directory, encoding: "utf8", timeout: 60_000 });
  fs.writeFileSync(path.join(folder, `${name}.stdout.txt`), result.stdout ?? "");
  fs.writeFileSync(path.join(folder, `${name}.stderr.txt`), result.stderr ?? "");
  assert.ifError(result.error);
  return result;
}

const results = [];
for (const variant of variants) {
  const classes = path.join(variant.folder, "classes");
  fs.rmSync(classes, { recursive: true, force: true });
  const compile = javaRun(["-cp", compilerClasspath, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
    "-no-stdlib", "-no-reflect", "-nowarn", "-jvm-target", "17",
    "-classpath", [stdlib, annotations].join(path.delimiter), "-d", classes, variant.sourceFile], variant.folder, "compile");
  assert.equal(compile.status, 0, `${variant.name} compilation failed:\n${compile.stderr}`);
  const run = javaRun(["-cp", [classes, stdlib].join(path.delimiter), "SheetLifecycleCheckKt"], variant.folder, "run");
  process.stdout.write(`${variant.name}:\n${run.stdout}`);
  if (variant.name === "fixed") {
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /PASS all 4 lifecycle checks/);
  } else {
    assert.equal(run.status, 1, "Ablation must fail on the lifecycle assertion, not compilation or setup");
    assert.match(run.stdout, /FAIL destroyed-before-resume: destroy retained delegate=true; post-destroy inset callbacks=1/);
    assert.match(run.stdout, /FAIL other-early-subscription-survives-destroy:/);
    assert.match(run.stdout, /PASS normal-pause-destroy-is-idempotent/);
    assert.match(run.stdout, /PASS focus-restoration-still-runs/);
    assert.equal((run.stdout.match(/^FAIL /gm) ?? []).length, 2);
  }
  results.push({ variant: variant.name, compileExitCode: compile.status, runExitCode: run.status });
}
fs.writeFileSync(path.join(output, "results.json"), `${JSON.stringify({ ...manifest, results }, null, 2)}\n`);
console.log(`PASS red/green lifecycle regression; source hashes and logs: ${output}`);
