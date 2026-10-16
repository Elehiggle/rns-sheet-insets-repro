# Android form-sheet insets reproduction

This app has two native-stack form sheets and a plain `TextInput`. It uses public,
pinned dependencies, needs no account or server, and starts with unmodified
`react-native-screens` 4.30.0. Do not use Expo Go: this test needs its own native
build with `react-native-keyboard-controller` 1.22.7.

Based on [wwisheess/rns-formsheet-inset-repro](https://github.com/wwisheess/rns-formsheet-inset-repro/tree/9ab4bf8ea9459f8d138d5b4d5ed2b24c6d73a524),
the reproduction linked from [RNS #4863](https://github.com/software-mansion/react-native-screens/issues/4863).
The original MIT license is included. This version adds an open-sheet fold case,
pins package versions, and uses a separate application ID.

## Build the failing baseline

Use Node 24, npm, JDK 17, and an Android SDK with API 36 and Build Tools 36.0.0.
Configure `ANDROID_HOME` and put `adb` on `PATH`. The verified device was a Pixel
Fold arm64 emulator running Android 16 / API 36.1. Other devices and API levels
have not been run with this reproduction.

Clone this repository outside any existing JavaScript workspace:

```sh
git clone https://github.com/Elehiggle/rns-sheet-insets-repro.git
cd rns-sheet-insets-repro
npm ci
npm run typecheck
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 \
  -Dorg.gradle.jvmargs='-Xmx2048m -XX:MaxMetaspaceSize=512m'
```

The release APK embeds JavaScript and needs no Metro process. Change the ABI if
your device is not arm64. Use a development or test device:

```sh
export ANDROID_SERIAL=emulator-5556 # replace with your device from adb devices
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.repro.rnssheetkeyboardfold/.MainActivity
```

`expo.autolinking.buildFromSource` in `package.json` includes Screens and Keyboard
Controller so the comparison below compiles the changed Kotlin source.

## Case 1: fold an open sheet, then show the keyboard

1. Start with the Pixel Fold unfolded and the keyboard hidden.
2. Open **Open keyboard sheet**.
3. Fold the emulator using its fold control, keeping the sheet open.
4. Focus the input.

Expected: the sheet expands and the input stays above the keyboard.
Baseline: the sheet stays at its previous height and the keyboard covers the
input. The same screen with the patch expands correctly.

For a repeat on the same build, force-stop the app, unfold the device, and launch
it again before step 2. Do not reuse a process that has already lost its listener
when checking a fresh baseline.

## Case 2: change the theme between sheet presentations

Start a fresh process on the unfolded device with the system in light mode:

```sh
adb shell cmd uimode night no
adb shell am force-stop com.repro.rnssheetkeyboardfold
adb shell am start -n com.repro.rnssheetkeyboardfold/.MainActivity
```

1. Open **Open full-height sheet**. Note its top edge below the status bar.
2. Close it with **Close sheet**.
3. Run `adb shell cmd uimode night yes`.
4. Open **Open full-height sheet** again.

Baseline: the sheet now starts at the screen's top edge. On the verified device,
it loses 74 physical pixels of top inset. With the patch, its top edge stays at
74 pixels. Restore the device's original theme setting when finished.

## Compare the fix

Keep the same app and dependencies. From the repository root, apply the
[4.30.0 patch](patches/fix-4.30.0.patch):

```sh
patch -p1 -d node_modules/react-native-screens < patches/fix-4.30.0.patch
```

After applying the patch, repeat only the Gradle build, APK installation and launch
steps above, then repeat both cases from a fresh process. Do not rerun `npm ci`
before testing the fix: it restores the unpatched baseline. The patch is deliberately
not applied by an install hook. [`patches/fix-main.patch`](patches/fix-main.patch) targets the upstream `main` checkout
and its `legacy/` paths, so it is not interchangeable with this package patch.

## Control runs

Rebuild after each change to `App.tsx`, and restore the default source afterward:

- No KeyboardProvider: set `reproOptions.includeKeyboardProvider` to `false`.
- Disabled provider: leave that constant `true`, and add `enabled={false}` to
  `<KeyboardProvider>` in `App`.

These controls use the same fixed native source. They check that observing insets
still works without the provider and does not break its disabled mode. These runs
use Android 16 / API 36.1 with edge-to-edge enabled; they do not cover legacy opaque
system bars.

For the default-provider regression, focus the input before folding, fold and
unfold with the keyboard open, then hide/reopen the keyboard and close/reopen the
sheet. The input and sheet title should remain visible.

Folding with the keyboard already open passes on both the unmodified baseline
and the patch. Case 1 reproduces the failure by opening the keyboard after folding.

## Versions

The lockfile pins the full dependency graph. Direct runtime versions are Expo
57.0.27, React Native 0.86.3, React 19.2.3, Screens 4.30.0, Keyboard Controller
1.22.7, React Navigation 7.5.0 / native-stack 7.20.0, Reanimated 4.5.1, Worklets
0.10.1, and Safe Area Context 5.7.0. Native verification used Fabric and Hermes.
