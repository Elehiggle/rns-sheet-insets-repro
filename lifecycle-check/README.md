# Local SheetDelegate destruction check

This is an optional local logic regression for the upstream candidate based on
`561feef37a2713bafd3652f8ed140b452e26ccbb`. It is outside the library checkout
and adds no upstream test infrastructure or package dependencies.

From this repository root, after applying [`patches/fix-main.patch`](../patches/fix-main.patch)
to the pinned upstream checkout, run:

```sh
node lifecycle-check/check-lifecycle.mjs /absolute/path/to/react-native-screens
```

Requires Node, Java 17+, and the already cached Kotlin 2.2.10 compiler artifacts
in `GRADLE_USER_HOME` or `~/.gradle`. The script downloads nothing. Set
`JAVA_HOME` if Java is not on PATH. `--generate-only` writes the source variants
and hashes without compiling or running them.

The runner extracts actual methods from the candidate's `Screen`,
`SheetDelegate`, and `InsetsObserverProxy`: attach subscription, lifecycle
dispatch and handlers, focus preservation/restoration, listener add/remove,
and inset dispatch. Small JVM doubles supply the remaining APIs.

Both variants compile. The red variant removes only the new unsubscribe line
from the extracted destroy handler in a generated copy; it never edits the
checkout. It must fail because a sheet destroyed before its first resume stays
registered and receives a later inset callback. Normal pause/destroy and focus
restoration must still pass. The fixed variant must pass all four cases:

- Attach and start receive insets before resume, but destroy without resume
  removes the listener and prevents later inset callbacks.
- Resume does not duplicate attach registration; pause and repeated destroy
  remove idempotently.
- Destroying one sheet preserves another sheet's legitimate early registration.
- Destroy still restores the original focus and clears the saved focus reference.

`out/sources.json` records input SHA-256 hashes and generated variants.
`out/results.json` additionally records compile/run exit codes after a complete
red/green run. Per-variant compiler and JVM stdout/stderr remain under `out/`.

Limits: this checks extracted production logic, not Android lifecycle dispatch.
The STARTED → ON_STOP → ON_DESTROY sequence without ON_PAUSE is supplied as the
AndroidX lifecycle contract. The harness does not reproduce fragment animation,
Android inset scheduling, Material layout, actual focus/IME behavior, or GC.
It proves removal from the strong listener set and absence of stale callbacks;
it does not measure a heap leak. A fresh Android build and native interaction
remain separate evidence.
